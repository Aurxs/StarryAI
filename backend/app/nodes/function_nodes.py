"""自定义函数节点。"""

from __future__ import annotations

import ast
import math
from typing import Any

from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext
from app.core.node_config import CommonNodeConfig, NodeField
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec, PortSpec


_ALLOWED_FUNCTIONS = {
    "abs": abs,
    "bool": bool,
    "float": float,
    "int": int,
    "len": len,
    "max": max,
    "min": min,
    "round": round,
    "str": str,
    "sum": sum,
}
_MAX_EXPRESSION_LENGTH = 1_000
_MAX_AST_NODES = 128
_MAX_LITERAL_STRING_LENGTH = 1_000
_MAX_LITERAL_NUMBER = 10_000
_ALLOWED_MATH_NAMES = {
    name: getattr(math, name)
    for name in {
        "acos", "acosh", "asin", "asinh", "atan", "atan2", "atanh",
        "ceil", "copysign", "cos", "cosh", "degrees", "dist", "erf", "erfc",
        "exp", "expm1", "fabs", "floor", "fmod", "frexp", "fsum", "gamma",
        "hypot", "isclose", "isfinite", "isinf", "isnan", "ldexp", "lgamma",
        "log", "log10", "log1p", "log2", "modf", "nextafter", "radians",
        "remainder", "sin", "sinh", "sqrt", "tan", "tanh", "trunc", "ulp",
        "pi", "e", "tau", "inf", "nan",
    }
}
_ALLOWED_NAMES = {"input", "inputs", "config", "math", *_ALLOWED_FUNCTIONS.keys()}
_ALLOWED_NODE_TYPES = (
    ast.Expression,
    ast.BoolOp,
    ast.BinOp,
    ast.UnaryOp,
    ast.IfExp,
    ast.Compare,
    ast.Call,
    ast.Name,
    ast.Load,
    ast.Constant,
    ast.Subscript,
    ast.Slice,
    ast.List,
    ast.Tuple,
    ast.Dict,
    ast.And,
    ast.Or,
    ast.Not,
    ast.Eq,
    ast.NotEq,
    ast.Lt,
    ast.LtE,
    ast.Gt,
    ast.GtE,
    ast.Is,
    ast.IsNot,
    ast.In,
    ast.NotIn,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.FloorDiv,
    ast.Mod,
    ast.Pow,
    ast.USub,
    ast.UAdd,
)


class FunctionExpressionConfig(CommonNodeConfig):
    """表达式函数配置。"""

    expression: str = NodeField(
        default="input",
        description="Safe Python expression. Use input for the main payload and inputs for all ports.",
    )


class _ExpressionValidator(ast.NodeVisitor):
    """校验表达式只包含安全节点和允许的函数调用。"""

    def __init__(self) -> None:
        self._node_count = 0

    def visit(self, node: ast.AST) -> Any:  # type: ignore[override]
        if not isinstance(node, _ALLOWED_NODE_TYPES):
            raise ValueError(f"不支持的表达式语法: {type(node).__name__}")
        self._node_count += 1
        if self._node_count > _MAX_AST_NODES:
            raise ValueError(f"表达式过于复杂，最多允许 {_MAX_AST_NODES} 个语法节点")
        return super().visit(node)

    def visit_Name(self, node: ast.Name) -> None:  # noqa: N802 - ast visitor API
        if node.id not in _ALLOWED_NAMES:
            raise ValueError(f"不允许的名称: {node.id}")

    def visit_Attribute(self, node: ast.Attribute) -> None:  # noqa: N802 - ast visitor API
        if not isinstance(node.value, ast.Name) or node.value.id != "math":
            raise ValueError("仅允许访问 math.<name>")
        if node.attr not in _ALLOWED_MATH_NAMES:
            raise ValueError(f"不允许的 math 名称: {node.attr}")

    def visit_Constant(self, node: ast.Constant) -> None:  # noqa: N802 - ast visitor API
        value = node.value
        if isinstance(value, str) and len(value) > _MAX_LITERAL_STRING_LENGTH:
            raise ValueError(f"字符串字面量过长，最多允许 {_MAX_LITERAL_STRING_LENGTH} 个字符")
        if isinstance(value, int) and not isinstance(value, bool):
            if abs(value) > _MAX_LITERAL_NUMBER:
                raise ValueError(f"数值字面量超出允许范围: ±{_MAX_LITERAL_NUMBER}")
        if isinstance(value, float):
            if not math.isfinite(value) or abs(value) > _MAX_LITERAL_NUMBER:
                raise ValueError(f"数值字面量超出允许范围: ±{_MAX_LITERAL_NUMBER}")

    def visit_BinOp(self, node: ast.BinOp) -> None:  # noqa: N802 - ast visitor API
        if isinstance(node.op, ast.Pow):
            raise ValueError("不允许幂运算；请使用受限的 math 函数")
        self.visit(node.left)
        self.visit(node.right)

    def visit_Call(self, node: ast.Call) -> None:  # noqa: N802 - ast visitor API
        if isinstance(node.func, ast.Name):
            if node.func.id not in _ALLOWED_FUNCTIONS:
                raise ValueError(f"不允许调用函数: {node.func.id}")
        elif isinstance(node.func, ast.Attribute):
            self.visit_Attribute(node.func)
        else:
            raise ValueError("不允许的函数调用")
        for arg in node.args:
            self.visit(arg)
        for keyword in node.keywords:
            self.visit(keyword.value)


class FunctionExpressionNode(AsyncNode):
    """安全表达式自定义函数节点。"""

    ConfigModel = FunctionExpressionConfig

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context
        cfg = self.cfg if isinstance(self.cfg, FunctionExpressionConfig) else FunctionExpressionConfig()
        expression = cfg.expression.strip()
        if not expression:
            raise ValueError("expression 不能为空")
        if len(expression) > _MAX_EXPRESSION_LENGTH:
            raise ValueError(f"expression 过长，最多允许 {_MAX_EXPRESSION_LENGTH} 个字符")
        tree = ast.parse(expression, mode="eval")
        _ExpressionValidator().visit(tree)
        compiled = compile(tree, filename="<function.expression>", mode="eval")
        locals_map = {
            "input": inputs.get("in"),
            "inputs": inputs,
            "config": self.config,
            "math": math,
            **_ALLOWED_FUNCTIONS,
        }
        result = eval(compiled, {"__builtins__": {}}, locals_map)  # noqa: S307 - AST allowlist enforced above
        return {
            "out": result,
            "__node_metrics": {"function_evaluations": 1},
        }


FUNCTION_EXPRESSION_SPEC = NodeSpec(
    type_name="function.expression",
    mode=NodeMode.ASYNC,
    inputs=[
        PortSpec(
            name="in",
            frame_schema="any",
            required=True,
            description="Input payload available as input in the expression.",
        ),
    ],
    outputs=[
        PortSpec(
            name="out",
            frame_schema="any",
            required=True,
            description="Expression result.",
        ),
    ],
    description="Evaluate a safe user-defined expression over the input payload.",
    config_schema=FunctionExpressionConfig.model_json_schema(),
    tags=["function"],
)


NODE_DEFINITION = NodeDefinition(
    spec=FUNCTION_EXPRESSION_SPEC,
    impl_cls=FunctionExpressionNode,
    config_model=FunctionExpressionConfig,
)
