"""图版本兼容检测与兼容元数据补齐。"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .registry import NodeTypeRegistry
from .spec import GraphSpec

SUPPORTED_GRAPH_FORMAT_MAJOR = 0
_SEMVER_PATTERN = re.compile(r"^\s*(\d+)\.(\d+)\.(\d+)\s*$")


@dataclass(slots=True)
class GraphCompatibilityIssue:
    """图兼容问题。"""

    code: str
    message: str
    details: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class GraphCompatibilityReport:
    """图兼容检查报告。"""

    graph_id: str
    compatible: bool
    issues: list[GraphCompatibilityIssue] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        """转换为可序列化对象。"""
        return {
            "graph_id": self.graph_id,
            "compatible": self.compatible,
            "issues": [
                {
                    "code": issue.code,
                    "message": issue.message,
                    "details": issue.details,
                }
                for issue in self.issues
            ],
        }


def evaluate_graph_compatibility(
    graph: GraphSpec,
    registry: NodeTypeRegistry,
    *,
    supported_graph_format_major: int = SUPPORTED_GRAPH_FORMAT_MAJOR,
) -> GraphCompatibilityReport:
    """评估图是否与当前运行时兼容。"""
    issues: list[GraphCompatibilityIssue] = []

    graph_version_raw = graph.version.strip()
    parsed_graph_version = _parse_semver(graph_version_raw)
    if parsed_graph_version is None:
        issues.append(
            GraphCompatibilityIssue(
                code="compat.graph_version_invalid",
                message=f"图版本不是合法 semver: {graph.version}",
                details={"version": graph.version},
            )
        )
    elif parsed_graph_version[0] != supported_graph_format_major:
        issues.append(
            GraphCompatibilityIssue(
                code="compat.graph_major_unsupported",
                message=(
                    "图结构主版本不受支持: "
                    f"{graph.version} (支持 major={supported_graph_format_major})"
                ),
                details={
                    "version": graph.version,
                    "supported_major": supported_graph_format_major,
                },
            )
        )

    required_node_versions = _extract_required_node_versions(graph)
    used_types = sorted({node.type_name.strip() for node in graph.nodes if node.type_name.strip()})
    for type_name in used_types:
        if not registry.has(type_name):
            issues.append(
                GraphCompatibilityIssue(
                    code="compat.node_type_missing",
                    message=f"当前节点库缺少图中节点类型: {type_name}",
                    details={"type_name": type_name},
                )
            )
            continue

        runtime_raw = registry.get(type_name).version
        runtime_version = _parse_semver(runtime_raw)
        if runtime_version is None:
            issues.append(
                GraphCompatibilityIssue(
                    code="compat.node_runtime_version_invalid",
                    message=f"节点运行时版本不是合法 semver: {type_name}={runtime_raw}",
                    details={"type_name": type_name, "runtime_version": runtime_raw},
                )
            )
            continue

        if type_name not in required_node_versions:
            continue
        required_raw = required_node_versions[type_name]
        if not isinstance(required_raw, str):
            issues.append(
                GraphCompatibilityIssue(
                    code="compat.node_required_version_invalid",
                    message=f"图中节点版本快照非法: {type_name}",
                    details={"type_name": type_name, "required_version": required_raw},
                )
            )
            continue
        required_version_text = required_raw.strip()
        required_version = _parse_semver(required_version_text)
        if required_version is None:
            issues.append(
                GraphCompatibilityIssue(
                    code="compat.node_required_version_invalid",
                    message=f"图中节点版本不是合法 semver: {type_name}={required_raw}",
                    details={"type_name": type_name, "required_version": required_raw},
                )
            )
            continue

        if runtime_version[0] != required_version[0]:
            issues.append(
                GraphCompatibilityIssue(
                    code="compat.node_major_mismatch",
                    message=(
                        f"节点版本主版本不兼容: {type_name} "
                        f"(required={required_version_text}, runtime={runtime_raw})"
                    ),
                    details={
                        "type_name": type_name,
                        "required_version": required_version_text,
                        "runtime_version": runtime_raw,
                    },
                )
            )
            continue

        if runtime_version < required_version:
            issues.append(
                GraphCompatibilityIssue(
                    code="compat.node_runtime_older_than_required",
                    message=(
                        f"节点运行时版本低于图要求: {type_name} "
                        f"(required={required_version_text}, runtime={runtime_raw})"
                    ),
                    details={
                        "type_name": type_name,
                        "required_version": required_version_text,
                        "runtime_version": runtime_raw,
                    },
                )
            )

    return GraphCompatibilityReport(
        graph_id=graph.graph_id,
        compatible=len(issues) == 0,
        issues=issues,
    )


def enrich_graph_compat_metadata(graph: GraphSpec, registry: NodeTypeRegistry) -> GraphSpec:
    """补齐图的兼容元数据（保存前调用）。"""
    metadata = dict(graph.metadata)
    compat_raw = metadata.get("compat")
    compat = dict(compat_raw) if isinstance(compat_raw, dict) else {}

    existing_versions_raw = compat.get("node_type_versions")
    existing_versions = (
        dict(existing_versions_raw) if isinstance(existing_versions_raw, dict) else {}
    )

    node_type_versions: dict[str, str] = {}
    for node in graph.nodes:
        type_name = node.type_name.strip()
        if not type_name:
            continue
        if registry.has(type_name):
            runtime_version = registry.get(type_name).version.strip()
            if runtime_version:
                node_type_versions[type_name] = runtime_version
            continue

        fallback = existing_versions.get(type_name)
        if isinstance(fallback, str) and fallback.strip():
            node_type_versions[type_name] = fallback.strip()

    compat["graph_format_version"] = graph.version.strip() or graph.version
    compat["node_type_versions"] = {
        type_name: node_type_versions[type_name]
        for type_name in sorted(node_type_versions)
    }
    metadata["compat"] = compat

    return graph.model_copy(update={"metadata": metadata}, deep=True)


def get_primary_incompatibility(
    report: GraphCompatibilityReport,
) -> GraphCompatibilityIssue | None:
    """返回首个不兼容问题（用于列表摘要提示）。"""
    if not report.issues:
        return None
    return report.issues[0]


def _extract_required_node_versions(graph: GraphSpec) -> dict[str, object]:
    compat = graph.metadata.get("compat")
    if not isinstance(compat, dict):
        return {}
    node_type_versions = compat.get("node_type_versions")
    if not isinstance(node_type_versions, dict):
        return {}

    normalized: dict[str, object] = {}
    for key, value in node_type_versions.items():
        type_name = str(key).strip()
        if not type_name:
            continue
        normalized[type_name] = value
    return normalized


def _parse_semver(value: str) -> tuple[int, int, int] | None:
    match = _SEMVER_PATTERN.fullmatch(value)
    if match is None:
        return None
    major, minor, patch = match.groups()
    return int(major), int(minor), int(patch)


__all__ = [
    "GraphCompatibilityIssue",
    "GraphCompatibilityReport",
    "SUPPORTED_GRAPH_FORMAT_MAJOR",
    "enrich_graph_compat_metadata",
    "evaluate_graph_compatibility",
    "get_primary_incompatibility",
]
