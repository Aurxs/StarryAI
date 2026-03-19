"""通用数据引用节点、请求器与写入器节点。"""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Literal

from pydantic import model_validator

from app.core.data_registry import GraphDataVariable
from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext
from app.core.node_config import CommonNodeConfig, NodeField
from app.core.node_definition import NodeDefinition
from app.core.payload_path import parse_field_path, set_value_at_path
from app.core.runtime_data import RuntimeDataStore
from app.core.spec import InputBehavior, NodeMode, NodeSpec, PortSpec

WriterOperation = Literal[
    "add",
    "subtract",
    "multiply",
    "divide",
    "set_from_input",
    "append_from_input",
    "extend_from_input",
    "merge_from_input",
    "set_path_from_input",
]
OperandMode = Literal["literal", "variable"]


class DataReferenceConfig(CommonNodeConfig):
    variable_name: str = NodeField(
        default="",
        description="Bound graph-level variable name.",
    )


class PassiveDataReferenceNode(AsyncNode):
    """被动数据引用节点占位实现。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = inputs
        _ = context
        return {}


class DataRequesterConfig(CommonNodeConfig):
    pass


class DataWriterConfig(CommonNodeConfig):
    target_variable_name: str = NodeField(
        default="",
        description="Target graph-level variable name.",
    )
    operation: WriterOperation = NodeField(
        default="set_from_input",
        description="Write operation executed on the target container.",
    )
    operand_mode: OperandMode = NodeField(
        default="literal",
        description="Operand source for scalar arithmetic operations.",
    )
    operand_variable_name: str | None = NodeField(
        default=None,
        description="Variable name used as arithmetic operand when operand_mode=variable.",
    )
    literal_value: int | float | str | None = NodeField(
        default=0,
        description="Literal operand used when operand_mode=literal.",
    )
    field_path: str | None = NodeField(
        default=None,
        description="Payload path used by set_path_from_input.",
    )

    @model_validator(mode="after")
    def validate_operation_fields(self) -> "DataWriterConfig":
        if not self.target_variable_name.strip():
            raise ValueError("target_variable_name 不能为空")
        if self.operation in {"add", "subtract", "multiply", "divide"}:
            if self.operand_mode == "variable":
                if not isinstance(self.operand_variable_name, str) or not self.operand_variable_name.strip():
                    raise ValueError("operand_mode=variable 时必须提供 operand_variable_name")
            elif self.literal_value is None:
                raise ValueError("operand_mode=literal 时必须提供 literal_value")
        if self.operation == "set_path_from_input":
            if not isinstance(self.field_path, str) or not self.field_path.strip():
                raise ValueError("set_path_from_input 必须提供 field_path")
        return self


class DataRequesterNode(AsyncNode):
    """被触发时通过数据引用节点读取当前值。"""

    ConfigModel = DataRequesterConfig

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = inputs
        reference_bindings = context.metadata.get("reference_bindings")
        if not isinstance(reference_bindings, dict):
            raise ValueError("缺少 reference_bindings 上下文")
        node_bindings = reference_bindings.get(context.node_id)
        if not isinstance(node_bindings, dict):
            raise ValueError(f"数据请求器 {context.node_id} 缺少 source 绑定")
        source_node_id = node_bindings.get("source")
        if not isinstance(source_node_id, str) or not source_node_id.strip():
            raise ValueError(f"数据请求器 {context.node_id} 缺少 source 数据节点")
        data_node_bindings = context.metadata.get("data_node_bindings")
        if not isinstance(data_node_bindings, dict):
            raise ValueError("缺少 data_node_bindings 上下文")
        variable_name = data_node_bindings.get(source_node_id)
        if not isinstance(variable_name, str) or not variable_name.strip():
            raise ValueError(f"数据请求器 {context.node_id} 的 source 未绑定真实变量")

        awaiter = context.metadata.get("await_container_writes")
        trigger_token = context.metadata.get("trigger_token")
        if callable(awaiter) and isinstance(trigger_token, str) and trigger_token:
            await awaiter(variable_name, trigger_token)

        data_store = context.metadata.get("data_store")
        if not isinstance(data_store, RuntimeDataStore):
            raise ValueError("缺少 data_store 上下文")
        return {"value": data_store.read(variable_name)}


class DataWriterNode(AsyncNode):
    """对目标真实变量执行副作用写入。"""

    ConfigModel = DataWriterConfig

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        data_store = context.metadata.get("data_store")
        if not isinstance(data_store, RuntimeDataStore):
            raise ValueError("缺少 data_store 上下文")
        writer_targets = context.metadata.get("writer_targets")
        if not isinstance(writer_targets, dict):
            raise ValueError("缺少 writer_targets 上下文")
        target_variable_name = writer_targets.get(context.node_id)
        if not isinstance(target_variable_name, str) or not target_variable_name.strip():
            raise ValueError(f"数据写入器 {context.node_id} 缺少目标变量")
        variables_by_name = context.metadata.get("variables_by_name")
        if not isinstance(variables_by_name, dict):
            raise ValueError("缺少 variables_by_name 上下文")
        target_variable = variables_by_name.get(target_variable_name)
        if not isinstance(target_variable, GraphDataVariable):
            raise ValueError(f"数据写入器 {context.node_id} 目标变量不存在: {target_variable_name}")

        cfg = self.cfg
        if not isinstance(cfg, DataWriterConfig):
            raise ValueError("数据写入器配置非法")
        current_value = data_store.read(target_variable_name)
        next_value = self._apply_operation(
            current_value=current_value,
            incoming_value=inputs.get("in"),
            cfg=cfg,
            data_store=data_store,
            variables_by_name=variables_by_name,
            target_variable=target_variable,
        )
        data_store.write(target_variable_name, next_value)
        return {"__node_metrics": {"data_writes": 1}}

    def _apply_operation(
        self,
        *,
        current_value: Any,
        incoming_value: Any,
        cfg: DataWriterConfig,
        data_store: RuntimeDataStore,
        variables_by_name: dict[str, GraphDataVariable],
        target_variable: GraphDataVariable,
    ) -> Any:
        operation = cfg.operation
        if operation == "set_from_input":
            return incoming_value
        if operation == "append_from_input":
            if not isinstance(current_value, list):
                raise ValueError("append_from_input 仅支持 list 容器")
            next_value = deepcopy(current_value)
            next_value.append(deepcopy(incoming_value))
            return next_value
        if operation == "extend_from_input":
            if not isinstance(current_value, list) or not isinstance(incoming_value, list):
                raise ValueError("extend_from_input 要求目标与输入均为 list")
            next_value = deepcopy(current_value)
            next_value.extend(deepcopy(incoming_value))
            return next_value
        if operation == "merge_from_input":
            if not isinstance(current_value, dict) or not isinstance(incoming_value, dict):
                raise ValueError("merge_from_input 要求目标与输入均为 dict")
            next_value = deepcopy(current_value)
            next_value.update(deepcopy(incoming_value))
            return next_value
        if operation == "set_path_from_input":
            if not isinstance(current_value, (dict, list)):
                raise ValueError("set_path_from_input 仅支持 list/dict 容器")
            next_value = deepcopy(current_value)
            set_value_at_path(next_value, parse_field_path(cfg.field_path or ""), deepcopy(incoming_value))
            return next_value

        operand = self._resolve_operand(cfg=cfg, data_store=data_store, variables_by_name=variables_by_name)
        return self._apply_scalar_arithmetic(
            operation=operation,
            current_value=current_value,
            operand=operand,
            value_kind=target_variable.value_kind,
        )

    @staticmethod
    def _resolve_operand(
        *,
        cfg: DataWriterConfig,
        data_store: RuntimeDataStore,
        variables_by_name: dict[str, GraphDataVariable],
    ) -> int | float | str:
        if cfg.operand_mode == "variable":
            variable_name = cfg.operand_variable_name or ""
            variable = variables_by_name.get(variable_name)
            if not isinstance(variable, GraphDataVariable):
                raise ValueError("operand_variable_name 指向的变量不存在")
            operand = data_store.read(variable_name)
        else:
            operand = cfg.literal_value
        if not isinstance(operand, (int, float, str)) or isinstance(operand, bool):
            raise ValueError("算术操作数必须是 int/float/string")
        return operand

    @staticmethod
    def _apply_scalar_arithmetic(
        *,
        operation: str,
        current_value: Any,
        operand: int | float | str,
        value_kind: str,
    ) -> Any:
        if operation == "add" and value_kind == "scalar.string":
            if not isinstance(current_value, str) or not isinstance(operand, str):
                raise ValueError("字符串变量仅支持字符串拼接")
            return current_value + operand

        if not isinstance(current_value, (int, float)) or isinstance(current_value, bool):
            raise ValueError(f"{operation} 仅支持数值变量")
        if isinstance(operand, str):
            raise ValueError(f"{operation} 仅支持数值操作数")
        if operation == "add":
            return current_value + operand
        if operation == "subtract":
            return current_value - operand
        if operation == "multiply":
            return current_value * operand
        if operation == "divide":
            if operand == 0:
                raise ValueError("divide 不允许除以 0")
            return current_value / operand
        raise ValueError(f"未知写入操作: {operation}")


DATA_REF_SPEC = NodeSpec(
    type_name="data.ref",
    mode=NodeMode.PASSIVE,
    inputs=[],
    outputs=[PortSpec(name="value", frame_schema="any", required=True)],
    description="Passive data reference node bound to a graph variable.",
    config_schema=DataReferenceConfig.model_json_schema(),
    tags=["data_ref"],
)

DATA_REQUESTER_SPEC = NodeSpec(
    type_name="data.requester",
    mode=NodeMode.ASYNC,
    inputs=[
        PortSpec(
            name="source",
            frame_schema="any",
            required=True,
            input_behavior=InputBehavior.REFERENCE,
            description="Reference binding to the source data node.",
        ),
        PortSpec(
            name="trigger",
            frame_schema="any",
            required=True,
            input_behavior=InputBehavior.TRIGGER,
            description="Trigger input used to request container data.",
        ),
    ],
    outputs=[
        PortSpec(
            name="value",
            frame_schema="any",
            required=True,
            derived_from_input="source",
            description="Current container value.",
        )
    ],
    description="Request current data from a passive data reference node when triggered.",
    config_schema=DataRequesterConfig.model_json_schema(),
    tags=["data_requester"],
)

DATA_WRITER_SPEC = NodeSpec(
    type_name="data.writer",
    mode=NodeMode.ASYNC,
    inputs=[
        PortSpec(
            name="in",
            frame_schema="any",
            required=True,
            input_behavior=InputBehavior.PAYLOAD,
            description="Trigger payload used by the configured write operation.",
        )
    ],
    outputs=[],
    description="Write to a passive data container with configured side effects.",
    config_schema=DataWriterConfig.model_json_schema(),
    tags=["data_writer"],
)


NODE_DEFINITIONS = [
    NodeDefinition(
        spec=DATA_REF_SPEC,
        impl_cls=PassiveDataReferenceNode,
        config_model=DataReferenceConfig,
    ),
    NodeDefinition(
        spec=DATA_REQUESTER_SPEC,
        impl_cls=DataRequesterNode,
        config_model=DataRequesterConfig,
    ),
    NodeDefinition(
        spec=DATA_WRITER_SPEC,
        impl_cls=DataWriterNode,
        config_model=DataWriterConfig,
    ),
]
