"""控制流节点。"""

from __future__ import annotations

from typing import Any, Literal

from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext
from app.core.node_config import CommonNodeConfig, NodeField
from app.core.node_definition import NodeDefinition
from app.core.payload_path import parse_field_path
from app.core.spec import NodeMode, NodeSpec, PortSpec

ConditionOperator = Literal[
    "truthy",
    "falsy",
    "exists",
    "missing",
    "equals",
    "not_equals",
    "contains",
    "greater_than",
    "greater_or_equal",
    "less_than",
    "less_or_equal",
]

_MISSING = object()


class BranchIfConfig(CommonNodeConfig):
    """条件分支配置。"""

    field_path: str = NodeField(
        default="<root>",
        description="Payload field path used by the condition. Use <root> for the full payload.",
    )
    operator: ConditionOperator = NodeField(
        default="truthy",
        description="Condition operator used to choose the true or false output.",
    )
    compare_value: Any = NodeField(
        default=None,
        description="Value used by comparison operators.",
    )


class BranchIfNode(AsyncNode):
    """一进二出条件分支节点。"""

    ConfigModel = BranchIfConfig

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context
        payload = inputs.get("in")
        cfg = self.cfg if isinstance(self.cfg, BranchIfConfig) else BranchIfConfig()
        candidate = self._read_candidate(payload, cfg.field_path)
        matched = self._evaluate(candidate=candidate, operator=cfg.operator, compare_value=cfg.compare_value)
        output_port = "true" if matched else "false"
        return {
            output_port: payload,
            "__node_metrics": {
                "branch_true": 1 if matched else 0,
                "branch_false": 0 if matched else 1,
            },
        }

    @staticmethod
    def _read_candidate(payload: Any, field_path: str) -> Any:
        path = field_path.strip() if isinstance(field_path, str) else "<root>"
        if not path or path == "<root>":
            return payload
        current = payload
        try:
            for part in parse_field_path(path):
                if isinstance(part, int):
                    if not isinstance(current, list):
                        return _MISSING
                    current = current[part]
                    continue
                if not isinstance(current, dict):
                    return _MISSING
                current = current[part]
        except (KeyError, IndexError, ValueError):
            return _MISSING
        return current

    @staticmethod
    def _evaluate(*, candidate: Any, operator: ConditionOperator, compare_value: Any) -> bool:
        if operator == "exists":
            return candidate is not _MISSING
        if operator == "missing":
            return candidate is _MISSING
        if candidate is _MISSING:
            return False
        if operator == "truthy":
            return bool(candidate)
        if operator == "falsy":
            return not bool(candidate)
        if operator == "equals":
            return candidate == compare_value
        if operator == "not_equals":
            return candidate != compare_value
        if operator == "contains":
            if isinstance(candidate, dict):
                return compare_value in candidate
            if isinstance(candidate, (list, tuple, set, str)):
                return compare_value in candidate
            return False

        left = BranchIfNode._as_number(candidate)
        right = BranchIfNode._as_number(compare_value)
        if left is None or right is None:
            return False
        if operator == "greater_than":
            return left > right
        if operator == "greater_or_equal":
            return left >= right
        if operator == "less_than":
            return left < right
        if operator == "less_or_equal":
            return left <= right
        return False

    @staticmethod
    def _as_number(value: Any) -> float | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                return None
        return None


class LoopRangeConfig(CommonNodeConfig):
    """for 循环范围配置。"""

    start_index: int = NodeField(
        default=0,
        description="First loop index emitted by loop.start.",
    )
    end_index: int = NodeField(
        default=3,
        description="Exclusive loop end index by default.",
    )
    step: int = NodeField(
        default=1,
        description="Loop index step. Must not be 0.",
    )
    include_end: bool = NodeField(
        default=False,
        description="Whether end_index is included.",
    )


class LoopStartNode(AsyncNode):
    """for 循环开始节点。"""

    ConfigModel = LoopRangeConfig

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context
        cfg = self.cfg if isinstance(self.cfg, LoopRangeConfig) else LoopRangeConfig()
        step = self._safe_step(cfg.step)
        if "continue" in inputs:
            next_index = self._read_next_index(inputs.get("continue"), cfg.start_index)
        else:
            next_index = cfg.start_index
        if not self._index_in_range(next_index, cfg.end_index, step, cfg.include_end):
            return {"__node_metrics": {"loop_start_skipped": 1}}
        payload = {
            "index": next_index,
            "value": next_index,
            "_loop": {
                "index": next_index,
                "next_index": next_index + step,
                "end_index": cfg.end_index,
                "step": step,
                "include_end": cfg.include_end,
            },
        }
        return {
            "item": payload,
            "__node_metrics": {"loop_iterations_started": 1},
        }

    @staticmethod
    def _read_next_index(payload: Any, fallback: int) -> int:
        if isinstance(payload, dict):
            raw_next = payload.get("next_index")
            if isinstance(raw_next, int) and not isinstance(raw_next, bool):
                return raw_next
            loop_meta = payload.get("_loop")
            if isinstance(loop_meta, dict):
                raw_loop_next = loop_meta.get("next_index")
                if isinstance(raw_loop_next, int) and not isinstance(raw_loop_next, bool):
                    return raw_loop_next
        return fallback

    @staticmethod
    def _safe_step(step: int) -> int:
        return step if step != 0 else 1

    @staticmethod
    def _index_in_range(index: int, end_index: int, step: int, include_end: bool) -> bool:
        if step > 0:
            return index <= end_index if include_end else index < end_index
        return index >= end_index if include_end else index > end_index


class LoopEndNode(AsyncNode):
    """for 循环结束节点。"""

    ConfigModel = LoopRangeConfig

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context
        cfg = self.cfg if isinstance(self.cfg, LoopRangeConfig) else LoopRangeConfig()
        step = LoopStartNode._safe_step(cfg.step)
        payload = inputs.get("in")
        next_index = self._read_next_index(payload, cfg.start_index + step)
        if LoopStartNode._index_in_range(next_index, cfg.end_index, step, cfg.include_end):
            return {
                "continue": {
                    "next_index": next_index,
                    "_loop": {
                        "next_index": next_index,
                        "end_index": cfg.end_index,
                        "step": step,
                        "include_end": cfg.include_end,
                    },
                },
                "__node_metrics": {"loop_continue": 1},
            }
        return {
            "done": payload,
            "__node_metrics": {"loop_done": 1},
        }

    @staticmethod
    def _read_next_index(payload: Any, fallback: int) -> int:
        if isinstance(payload, dict):
            loop_meta = payload.get("_loop")
            if isinstance(loop_meta, dict):
                raw_next = loop_meta.get("next_index")
                if isinstance(raw_next, int) and not isinstance(raw_next, bool):
                    return raw_next
            raw_next = payload.get("next_index")
            if isinstance(raw_next, int) and not isinstance(raw_next, bool):
                return raw_next
        return fallback


BRANCH_IF_SPEC = NodeSpec(
    type_name="branch.if",
    mode=NodeMode.ASYNC,
    inputs=[
        PortSpec(
            name="in",
            frame_schema="any",
            required=True,
            description="Payload evaluated by the branch condition.",
        ),
    ],
    outputs=[
        PortSpec(
            name="true",
            frame_schema="any",
            required=False,
            derived_from_input="in",
            description="Payload emitted when the condition matches.",
        ),
        PortSpec(
            name="false",
            frame_schema="any",
            required=False,
            derived_from_input="in",
            description="Payload emitted when the condition does not match.",
        ),
    ],
    description="Route one input payload to true or false output according to a condition.",
    config_schema=BranchIfConfig.model_json_schema(),
    tags=["branch"],
)

LOOP_START_SPEC = NodeSpec(
    type_name="loop.start",
    mode=NodeMode.ASYNC,
    inputs=[
        PortSpec(
            name="continue",
            frame_schema="any",
            required=False,
            description="Loop continuation state from loop.end.",
        ),
    ],
    outputs=[
        PortSpec(
            name="item",
            frame_schema="json.dict",
            required=False,
            description="Current loop item and metadata.",
        ),
    ],
    description="Start a configured for loop and emit the current loop item.",
    config_schema=LoopRangeConfig.model_json_schema(),
    tags=["loop_start"],
)

LOOP_END_SPEC = NodeSpec(
    type_name="loop.end",
    mode=NodeMode.ASYNC,
    inputs=[
        PortSpec(
            name="in",
            frame_schema="any",
            required=True,
            description="Payload from the loop body.",
        ),
    ],
    outputs=[
        PortSpec(
            name="continue",
            frame_schema="any",
            required=False,
            description="Continuation state routed back to loop.start.",
        ),
        PortSpec(
            name="done",
            frame_schema="any",
            required=False,
            derived_from_input="in",
            description="Final payload emitted when the loop exits.",
        ),
    ],
    description="End a configured for loop, continuing or exiting according to the range.",
    config_schema=LoopRangeConfig.model_json_schema(),
    tags=["loop_end"],
)


NODE_DEFINITIONS = [
    NodeDefinition(
        spec=BRANCH_IF_SPEC,
        impl_cls=BranchIfNode,
        config_model=BranchIfConfig,
    ),
    NodeDefinition(
        spec=LOOP_START_SPEC,
        impl_cls=LoopStartNode,
        config_model=LoopRangeConfig,
    ),
    NodeDefinition(
        spec=LOOP_END_SPEC,
        impl_cls=LoopEndNode,
        config_model=LoopRangeConfig,
    ),
]
