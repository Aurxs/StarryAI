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
    SyncRole,
    ValidationIssue,
    base_schema,
    is_none_schema,
    is_schema_compatible,
    is_sync_schema,
    normalize_schema,
    to_sync_schema,
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
    - resolved_input_schemas: 节点输入端口解析后的 schema。
    - resolved_output_schemas: 节点输出端口解析后的 schema。
    - sync_group_participants: 同步组参与者（仅 executor）。
    """

    graph: GraphSpec
    node_specs: dict[str, NodeSpec]
    outgoing_edges: dict[str, list[EdgeSpec]]
    incoming_edges: dict[str, list[EdgeSpec]]
    topo_order: list[str]
    resolved_input_schemas: dict[str, dict[str, str]]
    resolved_output_schemas: dict[str, dict[str, str]]
    sync_group_participants: dict[str, list[str]]


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
        outgoing, incoming, attempted_targets = self._collect_edges(graph, node_specs, issues)

        # 只有在节点类型成功解析后，才有意义做进一步校验。
        if node_specs:
            self._validate_required_inputs(node_specs, incoming, attempted_targets, issues)
            self._validate_sync_nodes(graph, node_specs, incoming, issues)
            self._validate_acyclic(node_specs, outgoing, issues)
            if not any(issue.code == "graph.cycle_detected" for issue in issues):
                resolved_inputs, resolved_outputs = self._resolve_port_schemas(
                    graph=graph,
                    node_specs=node_specs,
                    incoming=incoming,
                    outgoing=outgoing,
                )
                self._validate_resolved_edge_schemas(
                    graph=graph,
                    resolved_output_schemas=resolved_outputs,
                    resolved_input_schemas=resolved_inputs,
                    issues=issues,
                )

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
        outgoing, incoming, _attempted = self._collect_edges(graph, node_specs, issues)
        topo_order = self._topological_sort(list(node_specs.keys()), outgoing)
        resolved_inputs, resolved_outputs = self._resolve_port_schemas(
            graph=graph,
            node_specs=node_specs,
            incoming=incoming,
            outgoing=outgoing,
        )
        sync_group_participants = self._build_sync_group_participants(
            graph=graph,
            node_specs=node_specs,
        )

        return CompiledGraph(
            graph=graph,
            node_specs=node_specs,
            outgoing_edges=outgoing,
            incoming_edges=incoming,
            topo_order=topo_order,
            resolved_input_schemas=resolved_inputs,
            resolved_output_schemas=resolved_outputs,
            sync_group_participants=sync_group_participants,
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
    ) -> tuple[dict[str, list[EdgeSpec]], dict[str, list[EdgeSpec]], set[tuple[str, str]]]:
        """校验并收集边信息。

        返回值：
        - outgoing: 节点到其出边列表的映射。
        - incoming: 节点到其入边列表的映射。
        - attempted_targets: 所有声明了边连接的目标端口集合（含校验失败的边）。
        """
        outgoing: dict[str, list[EdgeSpec]] = defaultdict(list)
        incoming: dict[str, list[EdgeSpec]] = defaultdict(list)
        used_target_bindings: set[tuple[str, str]] = set()
        attempted_targets: set[tuple[str, str]] = set()

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

            source_schema = self._effective_output_schema(src_port)
            target_schema = dst_port.frame_schema

            if is_none_schema(source_schema):
                attempted_targets.add((edge.target_node, edge.target_port))
                issues.append(
                    ValidationIssue(
                        level="error",
                        code="edge.none_source_forbidden",
                        message=(
                            f"边不允许从 none 输出连线: {edge.source_node}.{edge.source_port}"
                            f" -> {edge.target_node}.{edge.target_port}"
                        ),
                    )
                )
                continue

            if is_none_schema(target_schema):
                attempted_targets.add((edge.target_node, edge.target_port))
                issues.append(
                    ValidationIssue(
                        level="error",
                        code="edge.none_target_forbidden",
                        message=(
                            f"边不允许连接到 none 输入: {edge.source_node}.{edge.source_port}"
                            f" -> {edge.target_node}.{edge.target_port}"
                        ),
                    )
                )
                continue

            # 端口 schema 不兼容。
            if not is_schema_compatible(source_schema, target_schema):
                attempted_targets.add((edge.target_node, edge.target_port))
                issues.append(
                    ValidationIssue(
                        level="error",
                        code="edge.schema_mismatch",
                        message=(
                            f"边 schema 不兼容: {edge.source_node}.{edge.source_port}"
                            f"({source_schema}) -> {edge.target_node}.{edge.target_port}"
                            f"({target_schema})"
                        ),
                    )
                )
                continue

            target_binding = (edge.target_node, edge.target_port)
            attempted_targets.add(target_binding)
            if target_binding in used_target_bindings:
                issues.append(
                    ValidationIssue(
                        level="error",
                        code="edge.duplicate_target_port_binding",
                        message=(
                            "同一输入端口不允许多个来源: "
                            f"{edge.target_node}.{edge.target_port}"
                        ),
                    )
                )
                continue
            used_target_bindings.add(target_binding)

            outgoing[edge.source_node].append(edge)
            incoming[edge.target_node].append(edge)

        return dict(outgoing), dict(incoming), attempted_targets

    def _validate_required_inputs(
        self,
        node_specs: dict[str, NodeSpec],
        incoming: dict[str, list[EdgeSpec]],
        attempted_targets: set[tuple[str, str]],
        issues: list[ValidationIssue],
    ) -> None:
        """检查所有必填输入端口是否连接。

        跳过已有边声明但因其它校验失败（如 schema 不匹配）而被拒绝的端口，
        避免与上游校验重复报错。
        """
        for node_id, spec in node_specs.items():
            incoming_ports = {edge.target_port for edge in incoming.get(node_id, [])}
            for port in spec.inputs:
                if port.required and port.name not in incoming_ports:
                    if (node_id, port.name) in attempted_targets:
                        continue
                    issues.append(
                        ValidationIssue(
                            level="error",
                            code="node.required_input_unconnected",
                            message=f"节点 {node_id} 必填输入口未连接: {port.name}",
                        )
                    )

    def _validate_sync_nodes(
        self,
        graph: GraphSpec,
        node_specs: dict[str, NodeSpec],
        incoming: dict[str, list[EdgeSpec]],
        issues: list[ValidationIssue],
    ) -> None:
        """对同步节点做额外检查。"""
        node_instances = {node.node_id: node for node in graph.nodes}
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

            sync_role = spec.sync_config.role
            if sync_role == SyncRole.INITIATOR:
                if len(spec.inputs) != 2 or len(spec.outputs) != 2:
                    issues.append(
                        ValidationIssue(
                            level="error",
                            code="sync.initiator_arity_invalid",
                            message=f"同步发起器 {node_id} 必须是 2 输入 2 输出",
                        )
                    )
                input_names = {port.name for port in spec.inputs}
                for output_port in spec.outputs:
                    if output_port.derived_from_input is None:
                        issues.append(
                            ValidationIssue(
                                level="error",
                                code="sync.initiator_missing_binding",
                                message=(
                                    f"同步发起器 {node_id} 输出口 {output_port.name} "
                                    "缺少 derived_from_input 绑定"
                                ),
                            )
                        )
                        continue
                    if output_port.derived_from_input not in input_names:
                        issues.append(
                            ValidationIssue(
                                level="error",
                                code="sync.initiator_invalid_binding",
                                message=(
                                    f"同步发起器 {node_id} 输出口 {output_port.name} 绑定了不存在输入口: "
                                    f"{output_port.derived_from_input}"
                                ),
                            )
                        )
                    if not is_sync_schema(output_port.frame_schema):
                        issues.append(
                            ValidationIssue(
                                level="error",
                                code="sync.initiator_output_not_sync",
                                message=(
                                    f"同步发起器 {node_id} 输出口 {output_port.name} "
                                    "必须声明 *.sync schema"
                                ),
                            )
                        )
                continue

            # executor 规则
            if sync_role == SyncRole.EXECUTOR:
                for input_port in spec.inputs:
                    if not is_sync_schema(input_port.frame_schema):
                        issues.append(
                            ValidationIssue(
                                level="error",
                                code="sync.executor_input_not_sync",
                                message=(
                                    f"同步执行节点 {node_id} 输入口 {input_port.name} "
                                    f"必须为 *.sync，当前为 {input_port.frame_schema}"
                                ),
                            )
                        )
                instance = node_instances.get(node_id)
                configured_group = instance.config.get("sync_group") if instance is not None else None
                if not isinstance(configured_group, str) or not configured_group.strip():
                    if not (isinstance(spec.sync_config.sync_group, str) and spec.sync_config.sync_group.strip()):
                        issues.append(
                            ValidationIssue(
                                level="error",
                                code="sync.executor_group_missing",
                                message=f"同步执行节点 {node_id} 缺少 sync_group 配置",
                            )
                        )

    def _validate_acyclic(
        self,
        node_specs: dict[str, NodeSpec],
        outgoing: dict[str, list[EdgeSpec]],
        issues: list[ValidationIssue],
    ) -> None:
        """检查图是否存在环。"""
        order = self._topological_sort(list(node_specs.keys()), outgoing)
        if len(order) != len(node_specs):
            issues.append(
                ValidationIssue(
                    level="error",
                    code="graph.cycle_detected",
                    message="图中存在环路，当前 MVP 仅支持有向无环图 (DAG)",
                )
            )

    def _resolve_port_schemas(
        self,
        *,
        graph: GraphSpec,
        node_specs: dict[str, NodeSpec],
        incoming: dict[str, list[EdgeSpec]],
        outgoing: dict[str, list[EdgeSpec]],
    ) -> tuple[dict[str, dict[str, str]], dict[str, dict[str, str]]]:
        """解析节点输入/输出端口在当前图中的真实 schema。"""
        topo_order = self._topological_sort(list(node_specs.keys()), outgoing)

        resolved_inputs: dict[str, dict[str, str]] = {}
        resolved_outputs: dict[str, dict[str, str]] = {}

        for node_id in topo_order:
            spec = node_specs[node_id]
            node_input_schemas: dict[str, str] = {}
            dynamic_input_schemas: dict[str, str] = {}
            node_output_schemas: dict[str, str] = {}
            resolved_inputs[node_id] = node_input_schemas
            resolved_outputs[node_id] = node_output_schemas

            # 输入 schema：
            # - resolved_inputs 记录节点声明的契约（用于连线兼容检查）。
            # - dynamic_input_schemas 用于动态输出推导（允许 any 被上游收窄）。
            for input_port in spec.inputs:
                declared_schema = normalize_schema(input_port.frame_schema)
                schema_for_dynamic = declared_schema
                source_edges = [
                    edge for edge in incoming.get(node_id, []) if edge.target_port == input_port.name
                ]
                if source_edges and declared_schema in {"any", "any.sync"}:
                    source_edge = source_edges[0]
                    source_schema = resolved_outputs.get(source_edge.source_node, {}).get(
                        source_edge.source_port
                    )
                    if isinstance(source_schema, str) and source_schema:
                        schema_for_dynamic = source_schema
                node_input_schemas[input_port.name] = declared_schema
                dynamic_input_schemas[input_port.name] = schema_for_dynamic

            # 再解析输出 schema：动态输出由绑定输入口推导。
            for output_port in spec.outputs:
                if output_port.derived_from_input is None:
                    node_output_schemas[output_port.name] = normalize_schema(output_port.frame_schema)
                    continue
                source_input = dynamic_input_schemas.get(output_port.derived_from_input, "any")
                node_output_schemas[output_port.name] = to_sync_schema(base_schema(source_input))

        # 处理“无出边的独立节点”或拓扑排序未覆盖场景。
        for node_id, spec in node_specs.items():
            if node_id in resolved_inputs:
                continue
            resolved_inputs[node_id] = {
                port.name: normalize_schema(port.frame_schema) for port in spec.inputs
            }
            resolved_outputs[node_id] = {
                port.name: normalize_schema(port.frame_schema) for port in spec.outputs
            }

        return resolved_inputs, resolved_outputs

    def _validate_resolved_edge_schemas(
        self,
        *,
        graph: GraphSpec,
        resolved_output_schemas: dict[str, dict[str, str]],
        resolved_input_schemas: dict[str, dict[str, str]],
        issues: list[ValidationIssue],
    ) -> None:
        """基于解析后的真实 schema 再做一次严格连线校验。"""
        for edge in graph.edges:
            source_schema = resolved_output_schemas.get(edge.source_node, {}).get(edge.source_port)
            target_schema = resolved_input_schemas.get(edge.target_node, {}).get(edge.target_port)
            if source_schema is None or target_schema is None:
                continue
            if is_none_schema(source_schema) or is_none_schema(target_schema):
                continue
            if not is_schema_compatible(source_schema, target_schema):
                issues.append(
                    ValidationIssue(
                        level="error",
                        code="edge.schema_mismatch_resolved",
                        message=(
                            f"解析后 schema 不兼容: {edge.source_node}.{edge.source_port}"
                            f"({source_schema}) -> {edge.target_node}.{edge.target_port}"
                            f"({target_schema})"
                        ),
                    )
                )

    def _build_sync_group_participants(
        self,
        *,
        graph: GraphSpec,
        node_specs: dict[str, NodeSpec],
    ) -> dict[str, list[str]]:
        """构建同步执行组参与者列表。"""
        participants: dict[str, list[str]] = defaultdict(list)
        node_instances = {node.node_id: node for node in graph.nodes}

        for node_id, spec in node_specs.items():
            if spec.mode != NodeMode.SYNC or spec.sync_config is None:
                continue
            if spec.sync_config.role != SyncRole.EXECUTOR:
                continue
            instance = node_instances.get(node_id)
            if instance is None:
                continue
            raw_group = instance.config.get("sync_group")
            group = raw_group if isinstance(raw_group, str) and raw_group.strip() else spec.sync_config.sync_group
            if not isinstance(group, str):
                continue
            group_name = group.strip()
            if not group_name:
                continue
            participants[group_name].append(node_id)

        return {group: sorted(nodes) for group, nodes in participants.items()}

    def _validate_sync_group_participants(
        self,
        *,
        graph: GraphSpec,
        node_specs: dict[str, NodeSpec],
        issues: list[ValidationIssue],
    ) -> None:
        """校验同步组至少包含 2 个执行节点。"""
        participants = self._build_sync_group_participants(graph=graph, node_specs=node_specs)
        for group_name, node_ids in participants.items():
            if len(node_ids) >= 2:
                continue
            issues.append(
                ValidationIssue(
                    level="error",
                    code="sync.group_participants_insufficient",
                    message=f"同步组 {group_name} 至少需要 2 个执行节点，当前: {len(node_ids)}",
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
    def _effective_output_schema(port: PortSpec) -> str:
        """返回用于首轮边校验的输出 schema。"""
        if port.derived_from_input is not None:
            # 动态输出在编译后再做精确解析；首轮按 any.sync 保守放行。
            return "any.sync"
        return port.frame_schema
