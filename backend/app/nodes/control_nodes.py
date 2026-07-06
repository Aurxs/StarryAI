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


NODE_DEFINITION = NodeDefinition(
    spec=BRANCH_IF_SPEC,
    impl_cls=BranchIfNode,
    config_model=BranchIfConfig,
)
