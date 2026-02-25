from app.core.graph_builder import GraphBuilder
from app.core.registry import create_default_registry
from app.core.spec import EdgeSpec, GraphSpec, NodeInstanceSpec


def test_graph_validation_passes_for_basic_chain() -> None:
    graph = GraphSpec(
        graph_id="g1",
        nodes=[
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
    graph = GraphSpec(
        graph_id="g2",
        nodes=[
            NodeInstanceSpec(node_id="n1", type_name="mock.tts"),
            NodeInstanceSpec(node_id="n2", type_name="mock.llm"),
        ],
        edges=[
            EdgeSpec(source_node="n1", source_port="audio", target_node="n2", target_port="prompt"),
        ],
    )

    report = GraphBuilder(create_default_registry()).validate(graph)
    assert report.valid is False
    assert any(i.code == "edge.schema_mismatch" for i in report.issues)
