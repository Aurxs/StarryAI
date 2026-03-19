"""阶段 A：图编译与静态校验。

GraphBuilder 是后端图引擎的“编译前检查器”，负责在运行前发现结构问题，
避免把错误留到运行时。

本阶段只做静态校验与编译结果组织，不执行真实调度。
"""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Callable

from .config_validation import validate_node_config
from .data_registry import (
    DICT_LIKE_VALUE_KINDS,
    LIST_LIKE_VALUE_KINDS,
    PATH_VALUE_KINDS,
    SCALAR_VALUE_KINDS,
    GraphDataVariable,
    build_variable_index,
    try_parse_data_registry,
)
from .registry import NodeTypeRegistry
from .spec import (
    EdgeSpec,
    GraphSpec,
    GraphValidationReport,
    InputBehavior,
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
    - runtime_edges: 参与真实运行转发的边（不含 reference 输入边）。
    - reference_bindings: 节点引用输入绑定到的上游节点。
    - writer_targets: 写入节点 -> 目标真实变量名。
    - data_node_bindings: 数据引用节点 -> 绑定真实变量名。
    - variables_by_name: 图级真实变量索引。
    """

    graph: GraphSpec
    node_specs: dict[str, NodeSpec]
    outgoing_edges: dict[str, list[EdgeSpec]]
    incoming_edges: dict[str, list[EdgeSpec]]
    topo_order: list[str]
    resolved_input_schemas: dict[str, dict[str, str]]
    resolved_output_schemas: dict[str, dict[str, str]]
    sync_group_participants: dict[str, list[str]]
    runtime_edges: list[EdgeSpec]
    reference_bindings: dict[str, dict[str, str]]
    writer_targets: dict[str, str]
    data_node_bindings: dict[str, str | None]
    variables_by_name: dict[str, GraphDataVariable]


class GraphBuilder:
    """图编译器。"""

    def __init__(
            self,
            registry: NodeTypeRegistry,
            *,
            secret_exists: Callable[[str], bool] | None = None,
    ) -> None:
        """注入节点类型注册中心。"""
        self.registry = registry
        self.secret_exists = secret_exists

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
            variables_by_name = self._collect_variables_by_name(graph, issues)
            data_node_bindings = self._build_data_node_bindings(
                graph=graph,
                node_specs=node_specs,
                variables_by_name=variables_by_name,
                issues=issues,
            )
            self._validate_node_configs(graph, node_specs, issues)
            self._validate_required_inputs(node_specs, incoming, attempted_targets, issues)
            self._validate_sync_nodes(graph, node_specs, incoming, issues)
            self._validate_data_nodes(
                graph=graph,
                node_specs=node_specs,
                incoming=incoming,
                outgoing=outgoing,
                variables_by_name=variables_by_name,
                data_node_bindings=data_node_bindings,
                issues=issues,
            )
            self._validate_acyclic(node_specs, outgoing, issues)
            if not any(issue.code == "graph.cycle_detected" for issue in issues):
                resolved_inputs, resolved_outputs = self._resolve_port_schemas(
                    graph=graph,
                    node_specs=node_specs,
                    incoming=incoming,
                    outgoing=outgoing,
                    variables_by_name=variables_by_name,
                    data_node_bindings=data_node_bindings,
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
        runtime_edges = self._filter_runtime_edges(graph=graph, node_specs=node_specs)
        runtime_outgoing, runtime_incoming = self._index_edges(runtime_edges)
        topo_order = self._topological_sort(
            self._runtime_node_ids(node_specs),
            runtime_outgoing,
        )
        variables_by_name = self._collect_variables_by_name(graph, [])
        data_node_bindings = self._build_data_node_bindings(
            graph=graph,
            node_specs=node_specs,
            variables_by_name=variables_by_name,
            issues=[],
        )
        resolved_inputs, resolved_outputs = self._resolve_port_schemas(
            graph=graph,
            node_specs=node_specs,
            incoming=incoming,
            outgoing=outgoing,
            variables_by_name=variables_by_name,
            data_node_bindings=data_node_bindings,
        )
        sync_group_participants = self._build_sync_group_participants(
            graph=graph,
            node_specs=node_specs,
        )
        reference_bindings = self._build_reference_bindings(graph=graph, node_specs=node_specs)
        writer_targets = self._build_writer_targets(graph=graph, node_specs=node_specs)

        return CompiledGraph(
            graph=graph,
            node_specs=node_specs,
            outgoing_edges=runtime_outgoing,
            incoming_edges=runtime_incoming,
            topo_order=topo_order,
            resolved_input_schemas=resolved_inputs,
            resolved_output_schemas=resolved_outputs,
            sync_group_participants=sync_group_participants,
            runtime_edges=runtime_edges,
            reference_bindings=reference_bindings,
            writer_targets=writer_targets,
            data_node_bindings=data_node_bindings,
            variables_by_name=variables_by_name,
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

    def _validate_node_configs(
        self,
        graph: GraphSpec,
        node_specs: dict[str, NodeSpec],
        issues: list[ValidationIssue],
    ) -> None:
        node_instances = {node.node_id: node for node in graph.nodes}
        for node_id, spec in node_specs.items():
            node_instance = node_instances.get(node_id)
            if node_instance is None:
                continue
            issues.extend(
                validate_node_config(
                    node_id=node_id,
                    config_schema=spec.config_schema,
                    config=node_instance.config,
                    secret_exists=self.secret_exists,
                )
            )

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
                if spec.mode == NodeMode.PASSIVE:
                    continue
                if port.input_behavior == InputBehavior.REFERENCE:
                    continue
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
                instance = node_instances.get(node_id)
                configured_group = instance.config.get("sync_group") if instance is not None else None
                if not isinstance(configured_group, str) or not configured_group.strip():
                    issues.append(
                        ValidationIssue(
                            level="error",
                            code="sync.initiator_group_missing",
                            message=f"同步发起器 {node_id} 缺少 sync_group 配置",
                        )
                    )

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
                    issues.append(
                        ValidationIssue(
                            level="error",
                            code="sync.executor_group_missing",
                            message=f"同步执行节点 {node_id} 缺少 sync_group 配置",
                        )
                    )

        self._validate_sync_group_alignment(
            graph=graph,
            node_specs=node_specs,
            issues=issues,
        )

    def _validate_data_nodes(
        self,
        graph: GraphSpec,
        node_specs: dict[str, NodeSpec],
        incoming: dict[str, list[EdgeSpec]],
        outgoing: dict[str, list[EdgeSpec]],
        variables_by_name: dict[str, GraphDataVariable],
        data_node_bindings: dict[str, str | None],
        issues: list[ValidationIssue],
    ) -> None:
        node_instances = {node.node_id: node for node in graph.nodes}

        for node_id, spec in node_specs.items():
            if self._has_tag(spec, "data_ref"):
                for edge in outgoing.get(node_id, []):
                    target_spec = node_specs.get(edge.target_node)
                    target_port = self._find_input_port(target_spec, edge.target_port) if target_spec else None
                    if target_port is None or target_port.input_behavior != InputBehavior.REFERENCE:
                        issues.append(
                            ValidationIssue(
                                level="error",
                                code="data.ref_invalid_consumer",
                                message=(
                                    f"数据引用节点 {node_id} 仅允许连接到引用输入端口，"
                                    f"当前连接到 {edge.target_node}.{edge.target_port}"
                                ),
                            )
                        )

            if self._has_tag(spec, "data_requester"):
                source_edges = [
                    edge for edge in incoming.get(node_id, [])
                    if edge.target_port == "source"
                ]
                trigger_edges = [
                    edge for edge in incoming.get(node_id, [])
                    if edge.target_port == "trigger"
                ]
                if len(source_edges) != 1:
                    issues.append(
                        ValidationIssue(
                            level="error",
                            code="data.requester_source_missing",
                            message=f"数据请求器 {node_id} 必须绑定一个 source 数据节点",
                        )
                    )
                else:
                    source_spec = node_specs.get(source_edges[0].source_node)
                    if source_spec is None or not self._has_tag(source_spec, "data_ref"):
                        issues.append(
                            ValidationIssue(
                                level="error",
                                code="data.requester_source_not_data_ref",
                                message=(
                                    f"数据请求器 {node_id} 的 source 必须连接 data.ref，"
                                    f"当前为 {source_edges[0].source_node}"
                                ),
                            )
                        )
                    elif not isinstance(data_node_bindings.get(source_edges[0].source_node), str):
                        issues.append(
                            ValidationIssue(
                                level="error",
                                code="data.requester_source_unbound",
                                message=(
                                    f"数据请求器 {node_id} 的 source 数据节点未绑定真实变量: "
                                    f"{source_edges[0].source_node}"
                                ),
                            )
                        )
                if len(trigger_edges) != 1:
                    issues.append(
                        ValidationIssue(
                            level="error",
                            code="data.requester_trigger_missing",
                            message=f"数据请求器 {node_id} 必须连接一个 trigger 输入",
                        )
                    )

            if self._has_tag(spec, "data_writer"):
                writer_instance = node_instances.get(node_id)
                target_variable_name = writer_instance.config.get("target_variable_name") if writer_instance else None
                if not isinstance(target_variable_name, str) or not target_variable_name.strip():
                    issues.append(
                        ValidationIssue(
                            level="error",
                            code="data.writer_target_missing",
                            message=f"数据写入器 {node_id} 缺少 target_variable_name 配置",
                        )
                    )
                else:
                    target_variable = variables_by_name.get(target_variable_name.strip())
                    if target_variable is None:
                        issues.append(
                            ValidationIssue(
                                level="error",
                                code="data.writer_target_variable_missing",
                                message=(
                                    f"数据写入器 {node_id} 的 target_variable_name 必须指向真实变量，"
                                    f"当前为 {target_variable_name}"
                                ),
                            )
                        )
                    elif target_variable.is_constant:
                        issues.append(
                            ValidationIssue(
                                level="error",
                                code="data.writer_target_constant_forbidden",
                                message=(
                                    f"数据写入器 {node_id} 的 target_variable_name 不能指向常量，"
                                    f"当前为 {target_variable_name}"
                                ),
                            )
                        )
                    else:
                        self._validate_writer_operation(
                            writer_node_id=node_id,
                            writer_config=writer_instance.config if writer_instance else {},
                            target_variable=target_variable,
                            variables_by_name=variables_by_name,
                            issues=issues,
                        )

                trigger_edges = incoming.get(node_id, [])
                if len(trigger_edges) != 1:
                    issues.append(
                        ValidationIssue(
                            level="error",
                            code="data.writer_input_missing",
                            message=f"数据写入器 {node_id} 必须且只能有一个输入",
                        )
                    )
                if outgoing.get(node_id):
                    issues.append(
                        ValidationIssue(
                            level="error",
                            code="data.writer_output_forbidden",
                            message=f"数据写入器 {node_id} 不允许有输出连线",
                        )
                    )

    def _validate_sync_group_alignment(
        self,
        *,
        graph: GraphSpec,
        node_specs: dict[str, NodeSpec],
        issues: list[ValidationIssue],
    ) -> None:
        """校验发起器与下游执行节点的 sync_group 一致性。"""
        node_instances = {node.node_id: node for node in graph.nodes}

        for edge in graph.edges:
            source_spec = node_specs.get(edge.source_node)
            target_spec = node_specs.get(edge.target_node)
            if source_spec is None or target_spec is None:
                continue
            if source_spec.sync_config is None or target_spec.sync_config is None:
                continue
            if source_spec.sync_config.role != SyncRole.INITIATOR:
                continue
            if target_spec.sync_config.role != SyncRole.EXECUTOR:
                continue

            source_node = node_instances.get(edge.source_node)
            target_node = node_instances.get(edge.target_node)
            source_group = source_node.config.get("sync_group") if source_node is not None else None
            target_group = target_node.config.get("sync_group") if target_node is not None else None

            if not isinstance(source_group, str) or not source_group.strip():
                continue
            if not isinstance(target_group, str) or not target_group.strip():
                continue
            if source_group.strip() == target_group.strip():
                continue
            issues.append(
                ValidationIssue(
                    level="error",
                    code="sync.group_mismatch",
                    message=(
                        f"同步组不一致: 发起器 {edge.source_node}({source_group.strip()}) "
                        f"-> 执行节点 {edge.target_node}({target_group.strip()})"
                    ),
                )
            )

    def _validate_acyclic(
        self,
        node_specs: dict[str, NodeSpec],
        outgoing: dict[str, list[EdgeSpec]],
        issues: list[ValidationIssue],
    ) -> None:
        """检查图是否存在环。"""
        runtime_node_ids = self._runtime_node_ids(node_specs)
        runtime_outgoing = {
            node_id: [
                edge for edge in edges
                if not self._is_reference_edge(edge=edge, node_specs=node_specs)
            ]
            for node_id, edges in outgoing.items()
        }
        order = self._topological_sort(runtime_node_ids, runtime_outgoing)
        if len(order) != len(runtime_node_ids):
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
        variables_by_name: dict[str, GraphDataVariable],
        data_node_bindings: dict[str, str | None],
    ) -> tuple[dict[str, dict[str, str]], dict[str, dict[str, str]]]:
        """解析节点输入/输出端口在当前图中的真实 schema。"""
        topo_order = self._topological_sort(list(node_specs.keys()), outgoing)
        node_instances = {node.node_id: node for node in graph.nodes}

        resolved_inputs: dict[str, dict[str, str]] = {}
        resolved_outputs: dict[str, dict[str, str]] = {}

        for node_id in topo_order:
            spec = node_specs[node_id]
            node_instance = node_instances.get(node_id)
            node_config = node_instance.config if node_instance is not None else {}
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
                    node_output_schemas[output_port.name] = self._resolve_declared_output_schema(
                        spec=spec,
                        node_config=node_config,
                        output_port=output_port,
                        variables_by_name=variables_by_name,
                        data_node_bindings=data_node_bindings,
                        node_id=node_id,
                    )
                    continue
                source_input = dynamic_input_schemas.get(output_port.derived_from_input, "any")
                resolved_schema = base_schema(source_input)
                if is_sync_schema(output_port.frame_schema):
                    node_output_schemas[output_port.name] = to_sync_schema(resolved_schema)
                else:
                    node_output_schemas[output_port.name] = normalize_schema(resolved_schema)

        # 处理“无出边的独立节点”或拓扑排序未覆盖场景。
        for node_id, spec in node_specs.items():
            if node_id in resolved_inputs:
                continue
            node_instance = node_instances.get(node_id)
            node_config = node_instance.config if node_instance is not None else {}
            resolved_inputs[node_id] = {
                port.name: normalize_schema(port.frame_schema) for port in spec.inputs
            }
            resolved_outputs[node_id] = {
                port.name: self._resolve_declared_output_schema(
                    spec=spec,
                    node_config=node_config,
                    output_port=port,
                    variables_by_name=variables_by_name,
                    data_node_bindings=data_node_bindings,
                    node_id=node_id,
                )
                for port in spec.outputs
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
            if not isinstance(raw_group, str):
                continue
            group_name = raw_group.strip()
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
            # 动态输出在编译后再做精确解析；首轮按声明类型的宽松版本保守放行。
            if is_sync_schema(port.frame_schema):
                return "any.sync"
            return "any"
        return port.frame_schema

    def _resolve_declared_output_schema(
        self,
        *,
        spec: NodeSpec,
        node_config: dict[str, object],
        output_port: PortSpec,
        variables_by_name: dict[str, GraphDataVariable],
        data_node_bindings: dict[str, str | None],
        node_id: str,
    ) -> str:
        _ = node_config
        if self._has_tag(spec, "data_ref") and output_port.name == "value":
            variable_name = data_node_bindings.get(node_id)
            if isinstance(variable_name, str):
                variable = variables_by_name.get(variable_name)
                if variable is not None:
                    return variable.value_kind
            return "any"
        return normalize_schema(output_port.frame_schema)

    @staticmethod
    def _runtime_node_ids(node_specs: dict[str, NodeSpec]) -> list[str]:
        return [
            node_id for node_id, spec in node_specs.items()
            if spec.mode != NodeMode.PASSIVE
        ]

    @staticmethod
    def _index_edges(edges: list[EdgeSpec]) -> tuple[dict[str, list[EdgeSpec]], dict[str, list[EdgeSpec]]]:
        outgoing: dict[str, list[EdgeSpec]] = defaultdict(list)
        incoming: dict[str, list[EdgeSpec]] = defaultdict(list)
        for edge in edges:
            outgoing[edge.source_node].append(edge)
            incoming[edge.target_node].append(edge)
        return dict(outgoing), dict(incoming)

    def _filter_runtime_edges(
        self,
        *,
        graph: GraphSpec,
        node_specs: dict[str, NodeSpec],
    ) -> list[EdgeSpec]:
        return [
            edge for edge in graph.edges
            if not self._is_reference_edge(edge=edge, node_specs=node_specs)
        ]

    def _build_reference_bindings(
        self,
        *,
        graph: GraphSpec,
        node_specs: dict[str, NodeSpec],
    ) -> dict[str, dict[str, str]]:
        bindings: dict[str, dict[str, str]] = defaultdict(dict)
        for edge in graph.edges:
            if not self._is_reference_edge(edge=edge, node_specs=node_specs):
                continue
            bindings[edge.target_node][edge.target_port] = edge.source_node
        return {node_id: dict(port_map) for node_id, port_map in bindings.items()}

    def _build_writer_targets(
        self,
        *,
        graph: GraphSpec,
        node_specs: dict[str, NodeSpec],
    ) -> dict[str, str]:
        targets: dict[str, str] = {}
        for node in graph.nodes:
            spec = node_specs.get(node.node_id)
            if spec is None or not self._has_tag(spec, "data_writer"):
                continue
            raw_target = node.config.get("target_variable_name")
            if isinstance(raw_target, str) and raw_target.strip():
                targets[node.node_id] = raw_target.strip()
        return targets

    def _collect_variables_by_name(
        self,
        graph: GraphSpec,
        issues: list[ValidationIssue],
    ) -> dict[str, GraphDataVariable]:
        registry, error = try_parse_data_registry(graph.metadata)
        if error is not None:
            issues.append(
                ValidationIssue(
                    level="error",
                    code="data.registry_invalid",
                    message=f"data_registry 非法: {error.errors()[0]['msg']}",
                )
            )
            return {}
        assert registry is not None
        return build_variable_index(registry.variables)

    def _build_data_node_bindings(
        self,
        *,
        graph: GraphSpec,
        node_specs: dict[str, NodeSpec],
        variables_by_name: dict[str, GraphDataVariable],
        issues: list[ValidationIssue],
    ) -> dict[str, str | None]:
        bindings: dict[str, str | None] = {}
        for node in graph.nodes:
            spec = node_specs.get(node.node_id)
            if spec is None or not self._has_tag(spec, "data_ref"):
                continue
            raw_variable_name = node.config.get("variable_name")
            if raw_variable_name is None or raw_variable_name == "":
                bindings[node.node_id] = None
                continue
            if not isinstance(raw_variable_name, str) or not raw_variable_name.strip():
                issues.append(
                    ValidationIssue(
                        level="error",
                        code="data.ref_variable_invalid",
                        message=f"数据引用节点 {node.node_id} 的 variable_name 非法",
                    )
                )
                bindings[node.node_id] = None
                continue
            variable_name = raw_variable_name.strip()
            if variable_name not in variables_by_name:
                issues.append(
                    ValidationIssue(
                        level="error",
                        code="data.ref_variable_missing",
                        message=f"数据引用节点 {node.node_id} 绑定了不存在的变量: {variable_name}",
                    )
                )
                bindings[node.node_id] = None
                continue
            bindings[node.node_id] = variable_name
        return bindings

    def _is_reference_edge(self, *, edge: EdgeSpec, node_specs: dict[str, NodeSpec]) -> bool:
        target_spec = node_specs.get(edge.target_node)
        if target_spec is None:
            return False
        target_port = self._find_input_port(target_spec, edge.target_port)
        if target_port is None:
            return False
        return target_port.input_behavior == InputBehavior.REFERENCE

    @staticmethod
    def _has_tag(spec: NodeSpec, tag: str) -> bool:
        return tag in spec.tags

    def _validate_writer_operation(
        self,
        *,
        writer_node_id: str,
        writer_config: dict[str, object],
        target_variable: GraphDataVariable,
        variables_by_name: dict[str, GraphDataVariable],
        issues: list[ValidationIssue],
    ) -> None:
        operation = writer_config.get("operation")
        if not isinstance(operation, str) or not operation.strip():
            issues.append(
                ValidationIssue(
                    level="error",
                    code="data.writer_operation_missing",
                    message=f"数据写入器 {writer_node_id} 缺少 operation 配置",
                )
            )
            return
        operation = operation.strip()

        if operation in {"add", "subtract", "multiply", "divide"} and target_variable.value_kind not in SCALAR_VALUE_KINDS:
            issues.append(
                ValidationIssue(
                    level="error",
                    code="data.writer_scalar_target_invalid",
                    message=(
                        f"数据写入器 {writer_node_id} 的算术操作仅允许标量变量，"
                        f"当前目标变量类型为 {target_variable.value_kind}"
                    ),
                )
            )

        if operation in {"append_from_input", "extend_from_input"} and target_variable.value_kind not in LIST_LIKE_VALUE_KINDS:
            issues.append(
                ValidationIssue(
                    level="error",
                    code="data.writer_list_target_invalid",
                    message=(
                        f"数据写入器 {writer_node_id} 的 {operation} 仅允许列表变量，"
                        f"当前目标变量类型为 {target_variable.value_kind}"
                    ),
                )
            )

        if operation == "merge_from_input" and target_variable.value_kind not in DICT_LIKE_VALUE_KINDS:
            issues.append(
                ValidationIssue(
                    level="error",
                    code="data.writer_dict_target_invalid",
                    message=(
                        f"数据写入器 {writer_node_id} 的 merge_from_input 仅允许字典变量，"
                        f"当前目标变量类型为 {target_variable.value_kind}"
                    ),
                )
            )

        if operation == "set_path_from_input" and target_variable.value_kind not in PATH_VALUE_KINDS:
            issues.append(
                ValidationIssue(
                    level="error",
                    code="data.writer_path_target_invalid",
                    message=(
                        f"数据写入器 {writer_node_id} 的 set_path_from_input 仅允许列表/字典变量，"
                        f"当前目标变量类型为 {target_variable.value_kind}"
                    ),
                )
            )

        if operation in {"add", "subtract", "multiply", "divide"}:
            numeric_scalar_kinds = {"scalar.int", "scalar.float"}

            def _is_scalar_literal(value: object) -> bool:
                return isinstance(value, (int, float, str)) and not isinstance(value, bool)

            operand_mode = writer_config.get("operand_mode")
            if operand_mode == "variable":
                operand_variable_name = writer_config.get("operand_variable_name")
                if not isinstance(operand_variable_name, str) or not operand_variable_name.strip():
                    issues.append(
                        ValidationIssue(
                            level="error",
                            code="data.writer_operand_variable_missing",
                            message=f"数据写入器 {writer_node_id} 缺少 operand_variable_name 配置",
                        )
                    )
                else:
                    operand_variable = variables_by_name.get(operand_variable_name.strip())
                    if operand_variable is None or operand_variable.value_kind not in SCALAR_VALUE_KINDS:
                        issues.append(
                            ValidationIssue(
                                level="error",
                                code="data.writer_operand_variable_invalid",
                                message=(
                                    f"数据写入器 {writer_node_id} 的 operand_variable_name 必须指向标量变量，"
                                    f"当前为 {operand_variable_name}"
                                ),
                            )
                        )
                    elif target_variable.value_kind == "scalar.string":
                        if operation != "add" or operand_variable.value_kind != "scalar.string":
                            issues.append(
                                ValidationIssue(
                                    level="error",
                                    code="data.writer_operand_variable_incompatible",
                                    message=(
                                        f"数据写入器 {writer_node_id} 的字符串变量仅支持 add 且操作数变量必须是 scalar.string，"
                                        f"当前 operation={operation}、operand={operand_variable.value_kind}"
                                    ),
                                )
                            )
                    elif target_variable.value_kind in numeric_scalar_kinds and operand_variable.value_kind not in numeric_scalar_kinds:
                        issues.append(
                            ValidationIssue(
                                level="error",
                                code="data.writer_operand_variable_incompatible",
                                message=(
                                    f"数据写入器 {writer_node_id} 的数值算术操作仅允许数值操作数变量，"
                                    f"当前目标类型={target_variable.value_kind}、operand={operand_variable.value_kind}"
                                ),
                            )
                        )
            elif operand_mode == "literal":
                literal_value = writer_config.get("literal_value")
                if not _is_scalar_literal(literal_value):
                    issues.append(
                        ValidationIssue(
                            level="error",
                            code="data.writer_operand_literal_invalid",
                            message=(
                                f"数据写入器 {writer_node_id} 的 literal_value 必须是 int/float/string，"
                                f"当前为 {literal_value!r}"
                            ),
                        )
                    )
                elif target_variable.value_kind == "scalar.string":
                    if operation != "add" or not isinstance(literal_value, str):
                        issues.append(
                            ValidationIssue(
                                level="error",
                                code="data.writer_operand_literal_incompatible",
                                message=(
                                    f"数据写入器 {writer_node_id} 的字符串变量仅支持 add 且 literal_value 必须是字符串，"
                                    f"当前 operation={operation}、literal_value={literal_value!r}"
                                ),
                            )
                        )
                elif target_variable.value_kind in numeric_scalar_kinds and isinstance(literal_value, str):
                    issues.append(
                        ValidationIssue(
                            level="error",
                            code="data.writer_operand_literal_incompatible",
                            message=(
                                f"数据写入器 {writer_node_id} 的数值算术操作不允许字符串 literal_value，"
                                f"当前目标类型={target_variable.value_kind}、literal_value={literal_value!r}"
                            ),
                        )
                    )
