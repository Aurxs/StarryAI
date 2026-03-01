"""Mock 输出节点。"""

from __future__ import annotations

from typing import Any

from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext
from app.core.node_config import CommonNodeConfig
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec, PortSpec


class MockOutputConfig(CommonNodeConfig):
    """Mock 输出节点配置。"""


class MockOutputNode(AsyncNode):
    """模拟终端输出节点。

    端口约定：
    - 输入：`in`
    - 输出：无

    当前行为：
    - 将收到的 payload 打印到终端，便于人工观察链路是否连通。
    """

    ConfigModel = MockOutputConfig

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        """消费输入并打印，不再向下游输出。"""
        print(f"[MockOutput] run={context.run_id} node={context.node_id} payload={inputs}")
        return {}


MOCK_OUTPUT_SPEC = NodeSpec(
    type_name="mock.output",
    mode=NodeMode.ASYNC,
    inputs=[PortSpec(name="in", frame_schema="any", required=True)],
    outputs=[],
    description="模拟输出节点",
    config_schema=MockOutputConfig.model_json_schema(),
)


NODE_DEFINITION = NodeDefinition(
    spec=MOCK_OUTPUT_SPEC,
    impl_cls=MockOutputNode,
    config_model=MockOutputConfig,
)
