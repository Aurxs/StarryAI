"""Mock LLM 节点（非流式）。"""

from __future__ import annotations

from typing import Any

from pydantic import Field

from app.core.config_validation import SECRET_FIELD_KEY, SECRET_WIDGET, SECRET_WIDGET_KEY, TEXTAREA_WIDGET
from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext
from app.core.node_config import CommonNodeConfig
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec, PortSpec


class MockLLMConfig(CommonNodeConfig):
    """Mock LLM 节点配置。"""

    model: str = Field(
        default="mock-llm-v1",
        description="模拟模型名称",
        json_schema_extra={"x-starryai-order": 10},
    )
    temperature: float = Field(
        default=0.7,
        ge=0.0,
        le=2.0,
        description="模拟采样温度",
        json_schema_extra={"x-starryai-order": 20},
    )
    system_prompt: str = Field(
        default="你是 StarryAI 的本地模拟 LLM。",
        description="系统提示词",
        json_schema_extra={
            "x-starryai-order": 30,
            SECRET_WIDGET_KEY: TEXTAREA_WIDGET,
        },
    )
    api_key: str | None = Field(
        default=None,
        description="用于演示 Secret 引用的模拟 API Key",
        json_schema_extra={
            "x-starryai-order": 40,
            SECRET_FIELD_KEY: True,
            SECRET_WIDGET_KEY: SECRET_WIDGET,
            "x-starryai-group": "auth",
            "x-starryai-placeholder": "Select or create a secret",
        },
    )


class MockLLMNode(AsyncNode):
    """模拟大语言模型节点。

    端口约定：
    - 输入：`prompt`（完整文本）
    - 输出：`answer`（完整文本）

    当前行为：
    - 不调用真实模型，仅进行字符串拼接模拟。
    """

    ConfigModel = MockLLMConfig

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        """处理 prompt 并返回模拟答案。"""
        _ = context

        # 从规范输入端口读取 prompt，不存在时按空字符串处理。
        prompt = str(inputs.get("prompt", ""))
        cfg = self.cfg if isinstance(self.cfg, MockLLMConfig) else None
        model_name = cfg.model if cfg is not None else str(self.config.get("model", "mock-llm-v1"))
        system_prompt = cfg.system_prompt if cfg is not None else str(
            self.config.get("system_prompt", "你是 StarryAI 的本地模拟 LLM。")
        )

        # 生成可观察的 mock 输出，便于验证流程连通。
        answer = f"[MockLLM回复] model={model_name} | {system_prompt} | 已收到: {prompt}"
        return {"answer": answer}


MOCK_LLM_SPEC = NodeSpec(
    type_name="mock.llm",
    mode=NodeMode.ASYNC,
    inputs=[PortSpec(name="prompt", frame_schema="text.final", required=True)],
    outputs=[PortSpec(name="answer", frame_schema="text.final", required=True)],
    description="模拟 LLM 节点（输入完整文本，输出完整回复）",
    config_schema=MockLLMConfig.model_json_schema(),
)


NODE_DEFINITION = NodeDefinition(
    spec=MOCK_LLM_SPEC,
    impl_cls=MockLLMNode,
    config_model=MockLLMConfig,
)
