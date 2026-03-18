"""数据容器、请求器与写入器节点。"""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Literal

from pydantic import model_validator

from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext
from app.core.node_config import CommonNodeConfig, NodeField
from app.core.node_definition import NodeDefinition
from app.core.payload_path import parse_field_path, set_value_at_path
from app.core.runtime_data import RuntimeDataStore
from app.core.spec import InputBehavior, NodeMode, NodeSpec, PortSpec


ScalarType = Literal["integer", "float", "string"]
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
OperandMode = Literal["literal", "container"]


class PassiveDataContainerNode(AsyncNode):
    """被动数据容器占位实现。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = inputs
        _ = context
        return {}


class ScalarContainerConfig(CommonNodeConfig):
    value_type: ScalarType = NodeField(
        default="integer",
        description="Declared scalar type for this container.",
    )
    initial_value: int | float | str | None = NodeField(
        default=0,
        description="Initial scalar value for the container.",
    )

    @model_validator(mode="after")
    def validate_initial_value(self) -> "ScalarContainerConfig":
        value = self.initial_value
        if self.value_type == "integer":
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError("initial_value 必须是 integer")
        elif self.value_type == "float":
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError("initial_value 必须是 float")
        elif self.value_type == "string":
            if not isinstance(value, str):
                raise ValueError("initial_value 必须是 string")
        return self


class JsonContainerConfig(CommonNodeConfig):
    initial_value: Any = NodeField(
        default=None,
        description="Initial JSON-like value for the container.",
    )


class DataRequesterConfig(CommonNodeConfig):
    pass


class DataWriterConfig(CommonNodeConfig):
    target_node_id: str = NodeField(
        default="",
        description="Target data container node id.",
    )
    operation: WriterOperation = NodeField(
        default="set_from_input",
        description="Write operation executed on the target container.",
    )
    operand_mode: OperandMode = NodeField(
        default="literal",
        description="Operand source for scalar arithmetic operations.",
    )
    operand_node_id: str | None = NodeField(
        default=None,
        description="Container id used as arithmetic operand when operand_mode=container.",
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
        if not self.target_node_id.strip():
            raise ValueError("target_node_id 不能为空")
        if self.operation in {"add", "subtract", "multiply", "divide"}:
            if self.operand_mode == "container":
                if not isinstance(self.operand_node_id, str) or not self.operand_node_id.strip():
                    raise ValueError("operand_mode=container 时必须提供 operand_node_id")
            elif self.literal_value is None:
                raise ValueError("operand_mode=literal 时必须提供 literal_value")
        if self.operation == "set_path_from_input":
            if not isinstance(self.field_path, str) or not self.field_path.strip():
                raise ValueError("set_path_from_input 必须提供 field_path")
        return self


class DataRequesterNode(AsyncNode):
    """被触发时从数据容器读取当前值。"""

    ConfigModel = DataRequesterConfig

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = inputs
        reference_bindings = context.metadata.get("reference_bindings")
        if not isinstance(reference_bindings, dict):
            raise ValueError("缺少 reference_bindings 上下文")
        node_bindings = reference_bindings.get(context.node_id)
        if not isinstance(node_bindings, dict):
            raise ValueError(f"数据请求器 {context.node_id} 缺少 source 绑定")
        container_node_id = node_bindings.get("source")
        if not isinstance(container_node_id, str) or not container_node_id.strip():
            raise ValueError(f"数据请求器 {context.node_id} 缺少 source 容器")

        awaiter = context.metadata.get("await_container_writes")
        trigger_token = context.metadata.get("trigger_token")
        if callable(awaiter) and isinstance(trigger_token, str) and trigger_token:
            await awaiter(container_node_id, trigger_token)

        data_store = context.metadata.get("data_store")
        if not isinstance(data_store, RuntimeDataStore):
            raise ValueError("缺少 data_store 上下文")
        return {"value": data_store.read(container_node_id)}


class DataWriterNode(AsyncNode):
    """对目标容器执行副作用写入。"""

    ConfigModel = DataWriterConfig

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        data_store = context.metadata.get("data_store")
        if not isinstance(data_store, RuntimeDataStore):
            raise ValueError("缺少 data_store 上下文")
        writer_targets = context.metadata.get("writer_targets")
        if not isinstance(writer_targets, dict):
            raise ValueError("缺少 writer_targets 上下文")
        target_node_id = writer_targets.get(context.node_id)
        if not isinstance(target_node_id, str) or not target_node_id.strip():
            raise ValueError(f"数据写入器 {context.node_id} 缺少目标容器")

        cfg = self.cfg
        if not isinstance(cfg, DataWriterConfig):
            raise ValueError("数据写入器配置非法")
        current_value = data_store.read(target_node_id)
        next_value = self._apply_operation(
            current_value=current_value,
            incoming_value=inputs.get("in"),
            cfg=cfg,
            data_store=data_store,
        )
        data_store.write(target_node_id, next_value)
        return {"__node_metrics": {"data_writes": 1}}

    def _apply_operation(
        self,
        *,
        current_value: Any,
        incoming_value: Any,
        cfg: DataWriterConfig,
        data_store: RuntimeDataStore,
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

        operand = self._resolve_operand(cfg=cfg, data_store=data_store)
        return self._apply_scalar_arithmetic(
            operation=operation,
            current_value=current_value,
            operand=operand,
        )

    @staticmethod
    def _resolve_operand(*, cfg: DataWriterConfig, data_store: RuntimeDataStore) -> int | float | str:
        if cfg.operand_mode == "container":
            operand = data_store.read(cfg.operand_node_id or "")
        else:
            operand = cfg.literal_value
        if not isinstance(operand, (int, float, str)) or isinstance(operand, bool):
            raise ValueError("算术操作数必须是 int/float/string")
        return operand

    @staticmethod
    def _apply_scalar_arithmetic(*, operation: str, current_value: Any, operand: int | float | str) -> Any:
        if operation == "add":
            if isinstance(current_value, str):
                if not isinstance(operand, str):
                    raise ValueError("字符串容器仅支持字符串拼接")
                return current_value + operand
            if isinstance(current_value, (int, float)) and not isinstance(current_value, bool):
                if isinstance(operand, str):
                    raise ValueError("数值容器不支持字符串拼接")
                return current_value + operand
            raise ValueError("add 仅支持数值或字符串容器")

        if not isinstance(current_value, (int, float)) or isinstance(current_value, bool):
            raise ValueError(f"{operation} 仅支持数值容器")
        if isinstance(operand, str):
            raise ValueError(f"{operation} 仅支持数值操作数")
        if operation == "subtract":
            return current_value - operand
        if operation == "multiply":
            return current_value * operand
        if operation == "divide":
            if operand == 0:
                raise ValueError("divide 不允许除以 0")
            return current_value / operand
        raise ValueError(f"未知写入操作: {operation}")


DATA_CONSTANT_SPEC = NodeSpec(
    type_name="data.constant",
    mode=NodeMode.PASSIVE,
    inputs=[],
    outputs=[PortSpec(name="value", frame_schema="any", required=True)],
    description="Passive scalar constant container.",
    config_schema=ScalarContainerConfig.model_json_schema(),
    tags=["data_container"],
)

DATA_VARIABLE_SPEC = NodeSpec(
    type_name="data.variable",
    mode=NodeMode.PASSIVE,
    inputs=[],
    outputs=[PortSpec(name="value", frame_schema="any", required=True)],
    description="Passive scalar variable container.",
    config_schema=ScalarContainerConfig.model_json_schema(),
    tags=["data_container"],
)

DATA_LIST_SPEC = NodeSpec(
    type_name="data.list",
    mode=NodeMode.PASSIVE,
    inputs=[],
    outputs=[PortSpec(name="value", frame_schema="json.list", required=True)],
    description="Passive list container.",
    config_schema=JsonContainerConfig.model_json_schema(),
    tags=["data_container"],
)

DATA_DICT_SPEC = NodeSpec(
    type_name="data.dict",
    mode=NodeMode.PASSIVE,
    inputs=[],
    outputs=[PortSpec(name="value", frame_schema="json.dict", required=True)],
    description="Passive dictionary container.",
    config_schema=JsonContainerConfig.model_json_schema(),
    tags=["data_container"],
)

DATA_STAGING_SPEC = NodeSpec(
    type_name="data.staging",
    mode=NodeMode.PASSIVE,
    inputs=[],
    outputs=[PortSpec(name="value", frame_schema="json.any", required=True)],
    description="Passive staging container for any JSON-like value.",
    config_schema=JsonContainerConfig.model_json_schema(),
    tags=["data_container"],
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
            description="Reference binding to the source data container.",
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
    description="Request current data from a passive container when triggered.",
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
        spec=DATA_CONSTANT_SPEC,
        impl_cls=PassiveDataContainerNode,
        config_model=ScalarContainerConfig,
    ),
    NodeDefinition(
        spec=DATA_VARIABLE_SPEC,
        impl_cls=PassiveDataContainerNode,
        config_model=ScalarContainerConfig,
    ),
    NodeDefinition(
        spec=DATA_LIST_SPEC,
        impl_cls=PassiveDataContainerNode,
        config_model=JsonContainerConfig,
    ),
    NodeDefinition(
        spec=DATA_DICT_SPEC,
        impl_cls=PassiveDataContainerNode,
        config_model=JsonContainerConfig,
    ),
    NodeDefinition(
        spec=DATA_STAGING_SPEC,
        impl_cls=PassiveDataContainerNode,
        config_model=JsonContainerConfig,
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
