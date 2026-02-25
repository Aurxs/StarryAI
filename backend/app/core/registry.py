"""阶段 A: 节点类型注册中心。"""

from __future__ import annotations

from dataclasses import dataclass, field

from .spec import (
    NodeMode,
    NodeSpec,
    PortSpec,
    SyncConfig,
    SyncStrategy,
)


class RegistryError(ValueError):
    """注册中心错误。"""


@dataclass(slots=True)
class NodeTypeRegistry:
    """节点类型注册表。

    职责:
    - 保存 NodeSpec（按 type_name 索引）
    - 提供查询与覆盖控制
    """

    _specs: dict[str, NodeSpec] = field(default_factory=dict)

    def register(self, spec: NodeSpec, *, overwrite: bool = False) -> None:
        if spec.type_name in self._specs and not overwrite:
            raise RegistryError(f"节点类型已存在: {spec.type_name}")
        self._specs[spec.type_name] = spec

    def bulk_register(self, specs: list[NodeSpec], *, overwrite: bool = False) -> None:
        for spec in specs:
            self.register(spec, overwrite=overwrite)

    def get(self, type_name: str) -> NodeSpec:
        try:
            return self._specs[type_name]
        except KeyError as exc:
            raise RegistryError(f"未找到节点类型: {type_name}") from exc

    def has(self, type_name: str) -> bool:
        return type_name in self._specs

    def list_specs(self) -> list[NodeSpec]:
        return list(self._specs.values())


def create_default_registry() -> NodeTypeRegistry:
    """创建默认注册中心（内置 mock 规格）。"""

    registry = NodeTypeRegistry()

    mock_input = NodeSpec(
        type_name="mock.input",
        mode=NodeMode.ASYNC,
        inputs=[],
        outputs=[
            PortSpec(
                name="text",
                frame_schema="text.final",
                is_stream=False,
                required=True,
                description="完整文本输出",
            )
        ],
        description="模拟输入节点，周期性产出完整文本",
    )

    mock_llm = NodeSpec(
        type_name="mock.llm",
        mode=NodeMode.ASYNC,
        inputs=[
            PortSpec(name="prompt", frame_schema="text.final", required=True),
        ],
        outputs=[
            PortSpec(name="answer", frame_schema="text.final", required=True),
        ],
        description="模拟 LLM 节点（非流式）",
    )

    mock_tts = NodeSpec(
        type_name="mock.tts",
        mode=NodeMode.ASYNC,
        inputs=[
            PortSpec(name="text", frame_schema="text.final", required=True),
        ],
        outputs=[
            PortSpec(name="audio", frame_schema="audio.full", required=True),
        ],
        description="模拟 TTS 节点（完整音频）",
    )

    mock_motion = NodeSpec(
        type_name="mock.motion",
        mode=NodeMode.ASYNC,
        inputs=[
            PortSpec(name="text", frame_schema="text.final", required=True),
        ],
        outputs=[
            PortSpec(name="motion", frame_schema="motion.timeline", required=True),
        ],
        description="模拟动作规划节点（完整动作轨迹）",
    )

    timeline_sync = NodeSpec(
        type_name="sync.timeline",
        mode=NodeMode.SYNC,
        inputs=[
            PortSpec(name="audio", frame_schema="audio.full", required=True),
            PortSpec(name="motion", frame_schema="motion.timeline", required=True),
        ],
        outputs=[
            PortSpec(name="sync", frame_schema="sync.timeline", required=True),
        ],
        sync_config=SyncConfig(
            required_ports=["audio", "motion"],
            strategy=SyncStrategy.CLOCK_LOCK,
            window_ms=40,
        ),
        description="时间轴同步节点，输出统一播放计划",
    )

    mock_output = NodeSpec(
        type_name="mock.output",
        mode=NodeMode.ASYNC,
        inputs=[
            PortSpec(name="in", frame_schema="any", required=True),
        ],
        outputs=[],
        description="模拟输出节点",
    )

    registry.bulk_register(
        [mock_input, mock_llm, mock_tts, mock_motion, timeline_sync, mock_output]
    )
    return registry
