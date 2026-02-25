"""阶段 A: 图编译与静态校验。"""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass

from .registry import NodeTypeRegistry
from .spec import (
    EdgeSpec,
    GraphSpec,
    GraphValidationReport,
    NodeMode,
    NodeSpec,
    ValidationIssue,
)


class GraphBuildError(ValueError):
    """图编译失败。"""

    def __init__(self, report: GraphValidationReport) -> None:
        messages = [f"[{i.code}] {i.message}" for i in report.issues]
        super().__init__("Graph validation failed: " + "; ".join(messages))
        self.report = report


@dataclass(slots=True)
class CompiledGraph:
    """编译后的图结构。

    该结构用于后续阶段 B 调度器初始化队列和任务。
    """

    graph: GraphSpec
    node_specs: dict[str, NodeSpec]          # node_id -> NodeSpec
    outgoing_edges: dict[str, list[EdgeSpec]]
    incoming_edges: dict[str, list[EdgeSpec]]
    topo_order: list[str]


class GraphBuilder:
    """图编译器。"""

    def __init__(self, registry: NodeTypeRegistry) -> None:
        self.registry = registry

    def validate(self, graph: GraphSpec) -> GraphValidationReport:
        issues: list[ValidationIssue] = []

        if not graph.nodes:
            issues.append(
                ValidationIssue(
                    level="error",
                    code="graph.empty_nodes",
                    message="图中没有节点",
                )
            )
            return GraphValidationReport(graph_id=graph.graph_id, valid=False, issues=issues)

        node_specs = self._collect_node_specs(graph, issues)
        outgoing, incoming = self._collect_edges(graph, node_specs, issues)

        if node_specs:
            self._validate_required_inputs(node_specs, incoming, issues)
            self._validate_sync_nodes(node_specs, incoming, issues)
            self._validate_acyclic(node_specs, outgoing, issues)

        valid = all(issue.level != "error" for issue in issues)
        return GraphValidationReport(graph_id=graph.graph_id, valid=valid, issues=issues)

    def build(self, graph: GraphSpec) -> CompiledGraph:
        report = self.validate(graph)
        if not report.valid:
            raise GraphBuildError(report)

        # 重新收集，确保 build 结果不依赖 validate 内部临时对象。
        issues: list[ValidationIssue] = []
        node_specs = self._collect_node_specs(graph, issues)
        outgoing, incoming = self._collect_edges(graph, node_specs, issues)
        topo_order = self._topological_sort(node_specs.keys(), outgoing)

        return CompiledGraph(
            graph=graph,
            node_specs=node_specs,
            outgoing_edges=outgoing,
            incoming_edges=incoming,
            topo_order=topo_order,
        )

    def _collect_node_specs(
        self, graph: GraphSpec, issues: list[ValidationIssue]
    ) -> dict[str, NodeSpec]:
        node_specs: dict[str, NodeSpec] = {}
        for node in graph.nodes:
            if not self.registry.has(node.type_name):
                issues.append(
                    ValidationIssue(
                        level="error",
                        code="node.unknown_type",
                        message=f"节点 {node.node_id} 引用未知类型: {node.type_name}",
                    )
                )
                continue
            node_specs[node.node_id] = self.registry.get(node.type_name)
        return node_specs

    def _collect_edges(
        self,
        graph: GraphSpec,
        node_specs: dict[str, NodeSpec],
        issues: list[ValidationIssue],
    ) -> tuple[dict[str, list[EdgeSpec]], dict[str, list[EdgeSpec]]]:
        outgoing: dict[str, list[EdgeSpec]] = defaultdict(list)
        incoming: dict[str, list[EdgeSpec]] = defaultdict(list)

        for edge in graph.edges:
            src_spec = node_specs.get(edge.source_node)
            dst_spec = node_specs.get(edge.target_node)

            if src_spec is None:
                issues.append(
                    ValidationIssue(
                        level="error",
                        code="edge.missing_source_node",
                        message=f"边 source_node 不存在: {edge.source_node}",
                    )
                )
                continue

            if dst_spec is None:
                issues.append(
                    ValidationIssue(
                        level="error",
                        code="edge.missing_target_node",
                        message=f"边 target_node 不存在: {edge.target_node}",
                    )
                )
                continue

            src_port = self._find_output_port(src_spec, edge.source_port)
            if src_port is None:
                issues.append(
                    ValidationIssue(
                        level="error",
                        code="edge.invalid_source_port",
                        message=f"节点 {edge.source_node} 不存在输出口 {edge.source_port}",
                    )
                )
                continue

            dst_port = self._find_input_port(dst_spec, edge.target_port)
            if dst_port is None:
                issues.append(
                    ValidationIssue(
                        level="error",
                        code="edge.invalid_target_port",
                        message=f"节点 {edge.target_node} 不存在输入口 {edge.target_port}",
                    )
                )
                continue

            if not self._is_schema_compatible(src_port.frame_schema, dst_port.frame_schema):
                issues.append(
                    ValidationIssue(
                        level="error",
                        code="edge.schema_mismatch",
                        message=(
                            f"边 schema 不兼容: {edge.source_node}.{edge.source_port}"
                            f"({src_port.frame_schema}) -> {edge.target_node}.{edge.target_port}"
                            f"({dst_port.frame_schema})"
                        ),
                    )
                )
                continue

            outgoing[edge.source_node].append(edge)
            incoming[edge.target_node].append(edge)

        return dict(outgoing), dict(incoming)

    def _validate_required_inputs(
        self,
        node_specs: dict[str, NodeSpec],
        incoming: dict[str, list[EdgeSpec]],
        issues: list[ValidationIssue],
    ) -> None:
        for node_id, spec in node_specs.items():
            incoming_ports = {e.target_port for e in incoming.get(node_id, [])}
            for port in spec.inputs:
                if port.required and port.name not in incoming_ports:
                    issues.append(
                        ValidationIssue(
                            level="error",
                            code="node.required_input_unconnected",
                            message=f"节点 {node_id} 必填输入口未连接: {port.name}",
                        )
                    )

    def _validate_sync_nodes(
        self,
        node_specs: dict[str, NodeSpec],
        incoming: dict[str, list[EdgeSpec]],
        issues: list[ValidationIssue],
    ) -> None:
        for node_id, spec in node_specs.items():
            if spec.mode != NodeMode.SYNC:
                continue

            if spec.sync_config is None:
                issues.append(
                    ValidationIssue(
                        level="error",
                        code="sync.missing_config",
                        message=f"同步节点 {node_id} 缺少 sync_config",
                    )
                )
                continue

            incoming_ports = {e.target_port for e in incoming.get(node_id, [])}
            for required_port in spec.sync_config.required_ports:
                if required_port not in incoming_ports:
                    issues.append(
                        ValidationIssue(
                            level="error",
                            code="sync.required_port_unconnected",
                            message=f"同步节点 {node_id} 的 required_port 未连接: {required_port}",
                        )
                    )

    def _validate_acyclic(
        self,
        node_specs: dict[str, NodeSpec],
        outgoing: dict[str, list[EdgeSpec]],
        issues: list[ValidationIssue],
    ) -> None:
        order = self._topological_sort(node_specs.keys(), outgoing)
        if len(order) != len(node_specs):
            issues.append(
                ValidationIssue(
                    level="error",
                    code="graph.cycle_detected",
                    message="图中存在环路，当前 MVP 仅支持有向无环图 (DAG)",
                )
            )

    @staticmethod
    def _topological_sort(
        node_ids: list[str] | set[str], outgoing: dict[str, list[EdgeSpec]]
    ) -> list[str]:
        node_list = list(node_ids)
        indegree: dict[str, int] = {node_id: 0 for node_id in node_list}

        for src, edges in outgoing.items():
            if src not in indegree:
                continue
            for edge in edges:
                if edge.target_node in indegree:
                    indegree[edge.target_node] += 1

        queue: deque[str] = deque([node_id for node_id, deg in indegree.items() if deg == 0])
        order: list[str] = []

        while queue:
            cur = queue.popleft()
            order.append(cur)
            for edge in outgoing.get(cur, []):
                if edge.target_node not in indegree:
                    continue
                indegree[edge.target_node] -= 1
                if indegree[edge.target_node] == 0:
                    queue.append(edge.target_node)

        return order

    @staticmethod
    def _find_input_port(spec: NodeSpec, port_name: str):
        for port in spec.inputs:
            if port.name == port_name:
                return port
        return None

    @staticmethod
    def _find_output_port(spec: NodeSpec, port_name: str):
        for port in spec.outputs:
            if port.name == port_name:
                return port
        return None

    @staticmethod
    def _is_schema_compatible(source_schema: str, target_schema: str) -> bool:
        # any 兼容所有 schema
        if source_schema == "any" or target_schema == "any":
            return True
        return source_schema == target_schema
