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
