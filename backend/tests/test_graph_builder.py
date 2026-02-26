"""GraphBuilder 核心校验测试。"""

from app.core.graph_builder import GraphBuilder
from app.core.registry import create_default_registry
from app.core.spec import EdgeSpec, GraphSpec, NodeInstanceSpec


def test_graph_validation_passes_for_basic_chain() -> None:
    """验证：最小有效链路可通过校验。"""
    graph = GraphSpec(
        graph_id="g1",
        nodes=[
            # 输入 -> LLM -> 输出
            NodeInstanceSpec(node_id="n1", type_name="mock.input"),
            NodeInstanceSpec(node_id="n2", type_name="mock.llm"),
            NodeInstanceSpec(node_id="n3", type_name="mock.output"),
        ],
        edges=[
            EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="prompt"),
            EdgeSpec(source_node="n2", source_port="answer", target_node="n3", target_port="in"),
        ],
    )

    report = GraphBuilder(create_default_registry()).validate(graph)
    assert report.valid is True
    assert report.issues == []


def test_graph_validation_fails_for_schema_mismatch() -> None:
    """验证：schema 不匹配时应返回失败。"""
    graph = GraphSpec(
        graph_id="g2",
        nodes=[
            NodeInstanceSpec(node_id="n1", type_name="mock.tts"),
            NodeInstanceSpec(node_id="n2", type_name="mock.llm"),
        ],
        edges=[
            # mock.tts.audio = audio.full，与 mock.llm.prompt = text.final 不兼容。
            EdgeSpec(source_node="n1", source_port="audio", target_node="n2", target_port="prompt"),
        ],
    )

    report = GraphBuilder(create_default_registry()).validate(graph)
    assert report.valid is False
    assert any(issue.code == "edge.schema_mismatch" for issue in report.issues)


def test_graph_validation_fails_for_duplicate_target_port_binding() -> None:
    """验证：同一目标输入口不允许多个来源。"""
    graph = GraphSpec(
        graph_id="g3",
        nodes=[
            NodeInstanceSpec(node_id="n1", type_name="mock.input"),
            NodeInstanceSpec(node_id="n2", type_name="mock.input"),
            NodeInstanceSpec(node_id="n3", type_name="mock.output"),
        ],
        edges=[
            EdgeSpec(source_node="n1", source_port="text", target_node="n3", target_port="in"),
            EdgeSpec(source_node="n2", source_port="text", target_node="n3", target_port="in"),
        ],
    )

    report = GraphBuilder(create_default_registry()).validate(graph)
    assert report.valid is False
    assert any(issue.code == "edge.duplicate_target_port_binding" for issue in report.issues)


def test_schema_mismatch_does_not_produce_redundant_unconnected_error() -> None:
    """验证：schema 不匹配时不应额外报告 required_input_unconnected。

    当边已声明但因 schema 不兼容被拒绝时，目标端口不应被再次报告为
    "未连接"，因为 schema_mismatch 错误已足够说明问题。
    """
    graph = GraphSpec(
        graph_id="g_no_dup_err",
        nodes=[
            # mock.input 无输入端口（源节点），不会触发 unconnected 错误。
            NodeInstanceSpec(node_id="n1", type_name="mock.input"),
            # mock.llm 有必填输入 prompt（text.final），但下面连的是 text.final -> text.final，
            # 需要用 mock.motion 的 motion.timeline 来制造 schema 不兼容。
            NodeInstanceSpec(node_id="n2", type_name="mock.motion"),
            NodeInstanceSpec(node_id="n3", type_name="mock.llm"),
        ],
        edges=[
            # text.final -> text.final：n1.text -> n2.text（兼容）
            EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="text"),
            # motion.timeline -> text.final：schema 不兼容
            EdgeSpec(source_node="n2", source_port="motion", target_node="n3", target_port="prompt"),
        ],
    )

    report = GraphBuilder(create_default_registry()).validate(graph)
    assert report.valid is False

    issue_codes = [issue.code for issue in report.issues]
    assert "edge.schema_mismatch" in issue_codes
    # 关键断言：n3.prompt 已有边声明（虽然 schema 不兼容），不应被报告为"未连接"。
    assert "node.required_input_unconnected" not in issue_codes
