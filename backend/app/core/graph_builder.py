"""阶段 A：图编译与静态校验。

GraphBuilder 是后端图引擎的“编译前检查器”，负责在运行前发现结构问题，
避免把错误留到运行时。

本阶段只做静态校验与编译结果组织，不执行真实调度。
"""

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
    PortSpec,
    ValidationIssue,
)


class GraphBuildError(ValueError):
    """图编译失败异常。"""

    def __init__(self, report: GraphValidationReport) -> None:
        """把校验报告中的问题合并成异常消息。"""
        messages = [f"[{issue.code}] {issue.message}" for issue in report.issues]
        super().__init__("Graph validation failed: " + "; ".join(messages))
        self.report = report


@dataclass(slots=True)
class CompiledGraph:
    """编译后的图结构。

    字段说明：
    - graph: 原始图定义。
    - node_specs: 节点实例 ID 到 NodeSpec 的映射。
    - outgoing_edges: 节点到其出边列表的映射。
    - incoming_edges: 节点到其入边列表的映射。
    - topo_order: 拓扑顺序，供后续调度器参考。
    """

    graph: GraphSpec
    node_specs: dict[str, NodeSpec]
    outgoing_edges: dict[str, list[EdgeSpec]]
    incoming_edges: dict[str, list[EdgeSpec]]
    topo_order: list[str]


class GraphBuilder:
    """图编译器。"""

    def __init__(self, registry: NodeTypeRegistry) -> None:
        """注入节点类型注册中心。"""
        self.registry = registry

    def validate(self, graph: GraphSpec) -> GraphValidationReport:
        """校验图定义并输出报告。

        校验流程：
        1. 图节点基础检查。
        2. 节点类型解析。
        3. 边连线合法性检查。
        4. 必填输入端口检查。
        5. 同步节点配置与连线检查。
        6. 有向无环图检查。
        """
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

        # 只有在节点类型成功解析后，才有意义做进一步校验。
        if node_specs:
            self._validate_required_inputs(node_specs, incoming, issues)
            self._validate_sync_nodes(node_specs, incoming, issues)
            self._validate_acyclic(node_specs, outgoing, issues)

        valid = all(issue.level != "error" for issue in issues)
        return GraphValidationReport(graph_id=graph.graph_id, valid=valid, issues=issues)

    def build(self, graph: GraphSpec) -> CompiledGraph:
        """编译图定义。

        - 先调用 validate。
        - 校验失败则抛 GraphBuildError。
        - 校验通过则返回 CompiledGraph。
        """
        report = self.validate(graph)
        if not report.valid:
            raise GraphBuildError(report)

        # 重新收集一次，确保 build 结果不依赖 validate 的临时容器。
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
        """解析图中节点实例引用的 NodeSpec。"""
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
        """校验并收集边信息。"""
        outgoing: dict[str, list[EdgeSpec]] = defaultdict(list)
        incoming: dict[str, list[EdgeSpec]] = defaultdict(list)

        for edge in graph.edges:
            src_spec = node_specs.get(edge.source_node)
            dst_spec = node_specs.get(edge.target_node)

            # 来源节点不存在。
            if src_spec is None:
                issues.append(
                    ValidationIssue(
                        level="error",
                        code="edge.missing_source_node",
                        message=f"边 source_node 不存在: {edge.source_node}",
                    )
                )
                continue

            # 目标节点不存在。
            if dst_spec is None:
                issues.append(
                    ValidationIssue(
                        level="error",
                        code="edge.missing_target_node",
                        message=f"边 target_node 不存在: {edge.target_node}",
                    )
                )
                continue

            # 来源输出端口不存在。
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

            # 目标输入端口不存在。
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

            # 端口 schema 不兼容。
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
        """检查所有必填输入端口是否连接。"""
        for node_id, spec in node_specs.items():
            incoming_ports = {edge.target_port for edge in incoming.get(node_id, [])}
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
        """对同步节点做额外检查。"""
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

            incoming_ports = {edge.target_port for edge in incoming.get(node_id, [])}
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
        """检查图是否存在环。"""
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
        """执行拓扑排序（Kahn 算法）。"""
        node_list = list(node_ids)
        indegree: dict[str, int] = {node_id: 0 for node_id in node_list}

        # 统计入度。
        for src, edges in outgoing.items():
            if src not in indegree:
                continue
            for edge in edges:
                if edge.target_node in indegree:
                    indegree[edge.target_node] += 1

        # 所有入度为 0 的节点可先入队。
        queue: deque[str] = deque([node_id for node_id, degree in indegree.items() if degree == 0])
        order: list[str] = []

        while queue:
            current = queue.popleft()
            order.append(current)

            # 当前节点“删除”后，后继节点入度减 1。
            for edge in outgoing.get(current, []):
                if edge.target_node not in indegree:
                    continue
                indegree[edge.target_node] -= 1
                if indegree[edge.target_node] == 0:
                    queue.append(edge.target_node)

        return order

    @staticmethod
    def _find_input_port(spec: NodeSpec, port_name: str) -> PortSpec | None:
        """在节点输入端口中查找指定端口。"""
        for port in spec.inputs:
            if port.name == port_name:
                return port
        return None

    @staticmethod
    def _find_output_port(spec: NodeSpec, port_name: str) -> PortSpec | None:
        """在节点输出端口中查找指定端口。"""
        for port in spec.outputs:
            if port.name == port_name:
                return port
        return None

    @staticmethod
    def _is_schema_compatible(source_schema: str, target_schema: str) -> bool:
        """判断来源端口 schema 与目标端口 schema 是否兼容。"""
        # `any` 是通配符，和任何 schema 都兼容。
        if source_schema == "any" or target_schema == "any":
            return True
        return source_schema == target_schema
