"""图兼容检测单测。"""

from __future__ import annotations

from app.core.graph_compatibility import (
    enrich_graph_compat_metadata,
    evaluate_graph_compatibility,
)
from app.core.registry import create_default_registry
from app.core.spec import EdgeSpec, GraphSpec, NodeInstanceSpec


def _build_basic_graph(*, version: str = "0.1.0", metadata: dict[str, object] | None = None) -> GraphSpec:
    return GraphSpec(
        graph_id="graph_compat",
        version=version,
        nodes=[
            NodeInstanceSpec(node_id="n1", type_name="mock.input"),
            NodeInstanceSpec(node_id="n2", type_name="mock.output"),
        ],
        edges=[
            EdgeSpec(
                source_node="n1",
                source_port="text",
                target_node="n2",
                target_port="in",
            )
        ],
        metadata=metadata or {},
    )


def test_compatibility_passes_for_matching_versions() -> None:
    registry = create_default_registry()
    graph = _build_basic_graph(
        metadata={
            "compat": {
                "node_type_versions": {
                    "mock.input": "0.1.0",
                    "mock.output": "0.1.0",
                }
            }
        }
    )

    report = evaluate_graph_compatibility(graph, registry)
    assert report.compatible is True
    assert report.issues == []


def test_compatibility_rejects_unsupported_graph_major() -> None:
    registry = create_default_registry()
    graph = _build_basic_graph(version="1.0.0")

    report = evaluate_graph_compatibility(graph, registry)
    assert report.compatible is False
    assert any(issue.code == "compat.graph_major_unsupported" for issue in report.issues)


def test_compatibility_rejects_unknown_node_type() -> None:
    registry = create_default_registry()
    graph = GraphSpec(
        graph_id="graph_unknown_type",
        version="0.1.0",
        nodes=[NodeInstanceSpec(node_id="n1", type_name="mock.unknown")],
        edges=[],
        metadata={},
    )

    report = evaluate_graph_compatibility(graph, registry)
    assert report.compatible is False
    assert any(issue.code == "compat.node_type_missing" for issue in report.issues)


def test_compatibility_rejects_when_runtime_version_is_older() -> None:
    registry = create_default_registry()
    graph = _build_basic_graph(
        metadata={"compat": {"node_type_versions": {"mock.input": "0.2.0"}}}
    )

    report = evaluate_graph_compatibility(graph, registry)
    assert report.compatible is False
    assert any(
        issue.code == "compat.node_runtime_older_than_required" for issue in report.issues
    )


def test_compatibility_rejects_when_node_major_mismatches() -> None:
    registry = create_default_registry()
    graph = _build_basic_graph(
        metadata={"compat": {"node_type_versions": {"mock.input": "1.0.0"}}}
    )

    report = evaluate_graph_compatibility(graph, registry)
    assert report.compatible is False
    assert any(issue.code == "compat.node_major_mismatch" for issue in report.issues)


def test_compatibility_rejects_invalid_required_node_version() -> None:
    registry = create_default_registry()
    graph = _build_basic_graph(
        metadata={"compat": {"node_type_versions": {"mock.input": "latest"}}}
    )

    report = evaluate_graph_compatibility(graph, registry)
    assert report.compatible is False
    assert any(issue.code == "compat.node_required_version_invalid" for issue in report.issues)


def test_compatibility_rejects_invalid_graph_version_format() -> None:
    registry = create_default_registry()
    graph = _build_basic_graph(version="v1")

    report = evaluate_graph_compatibility(graph, registry)
    assert report.compatible is False
    assert any(issue.code == "compat.graph_version_invalid" for issue in report.issues)


def test_enrich_graph_compat_metadata_backfills_versions_and_preserves_metadata() -> None:
    registry = create_default_registry()
    graph = GraphSpec(
        graph_id="graph_enrich",
        version="0.1.0",
        nodes=[
            NodeInstanceSpec(node_id="n1", type_name="mock.input"),
            NodeInstanceSpec(node_id="n2", type_name="custom.unknown"),
        ],
        edges=[],
        metadata={
            "ui_layout": {"node_positions": {"n1": {"x": 10, "y": 20}}},
            "compat": {
                "node_type_versions": {
                    "custom.unknown": "9.9.9",
                }
            },
        },
    )

    enriched = enrich_graph_compat_metadata(graph, registry)
    compat = enriched.metadata["compat"]
    assert isinstance(compat, dict)
    assert compat["graph_format_version"] == "0.1.0"

    node_versions = compat["node_type_versions"]
    assert isinstance(node_versions, dict)
    assert node_versions["mock.input"] == "0.1.0"
    assert node_versions["custom.unknown"] == "9.9.9"
    assert enriched.metadata["ui_layout"] == {"node_positions": {"n1": {"x": 10, "y": 20}}}

