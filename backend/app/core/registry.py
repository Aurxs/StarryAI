"""阶段 A：节点类型注册中心。

注册中心职责：
1. 管理 NodeSpec（按 type_name 索引）。
2. 为图校验器提供节点类型查询能力。
3. 提供默认内置节点规格，便于前端和后端共享契约。
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .spec import NodeMode, NodeSpec, PortSpec, SyncConfig, SyncStrategy


class RegistryError(ValueError):
    """节点注册中心相关异常。"""


@dataclass(slots=True)
class NodeTypeRegistry:
    """节点类型注册表。"""

    # 内部存储：type_name -> NodeSpec
    _specs: dict[str, NodeSpec] = field(default_factory=dict)

    def register(self, spec: NodeSpec, *, overwrite: bool = False) -> None:
        """注册一个节点类型。

        参数：
        - spec: 节点类型规范。
        - overwrite: 若为 True，允许覆盖同名类型。
        """
        if spec.type_name in self._specs and not overwrite:
            raise RegistryError(f"节点类型已存在: {spec.type_name}")
        self._specs[spec.type_name] = spec

    def bulk_register(self, specs: list[NodeSpec], *, overwrite: bool = False) -> None:
        """批量注册节点类型。"""
        for spec in specs:
            self.register(spec, overwrite=overwrite)

    def get(self, type_name: str) -> NodeSpec:
        """获取指定节点类型规范。"""
        try:
            return self._specs[type_name]
        except KeyError as exc:
            raise RegistryError(f"未找到节点类型: {type_name}") from exc

    def has(self, type_name: str) -> bool:
        """判断节点类型是否已注册。"""
        return type_name in self._specs

    def list_specs(self) -> list[NodeSpec]:
        """返回全部已注册节点规范。"""
        return list(self._specs.values())


def create_default_registry() -> NodeTypeRegistry:
    """创建默认注册中心并注入内置 mock 类型。

    设计目标：
    - 前端可直接拉取节点类型元数据进行渲染。
    - 后端 GraphBuilder 可直接据此做端口/schema 校验。
    """

    registry = NodeTypeRegistry()

    # 1) 输入节点：无输入，输出完整文本。
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
        description="模拟输入节点，产出完整文本",
    )

    # 2) LLM 节点：输入 prompt，输出 answer（非流式）。
    mock_llm = NodeSpec(
        type_name="mock.llm",
        mode=NodeMode.ASYNC,
        inputs=[PortSpec(name="prompt", frame_schema="text.final", required=True)],
        outputs=[PortSpec(name="answer", frame_schema="text.final", required=True)],
        description="模拟 LLM 节点（输入完整文本，输出完整回复）",
    )

    # 3) TTS 节点：输入文本，输出完整音频信息。
    mock_tts = NodeSpec(
        type_name="mock.tts",
        mode=NodeMode.ASYNC,
        inputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
        outputs=[PortSpec(name="audio", frame_schema="audio.full", required=True)],
        description="模拟 TTS 节点（输入文本，输出完整音频元信息）",
    )

    # 4) 动作节点：输入文本，输出动作时间线。
    mock_motion = NodeSpec(
        type_name="mock.motion",
        mode=NodeMode.ASYNC,
        inputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
        outputs=[PortSpec(name="motion", frame_schema="motion.timeline", required=True)],
        description="模拟动作规划节点（输出完整动作轨迹）",
    )

    # 5) 同步节点：汇总音频和动作，输出统一时间轴。
    timeline_sync = NodeSpec(
        type_name="sync.timeline",
        mode=NodeMode.SYNC,
        inputs=[
            PortSpec(name="audio", frame_schema="audio.full", required=True),
            PortSpec(name="motion", frame_schema="motion.timeline", required=True),
        ],
        outputs=[PortSpec(name="sync", frame_schema="sync.timeline", required=True)],
        sync_config=SyncConfig(
            required_ports=["audio", "motion"],
            strategy=SyncStrategy.CLOCK_LOCK,
            window_ms=40,
        ),
        description="时间轴同步节点，生成统一播放计划",
    )

    # 6) 输出节点：用于消费任何数据并展示。
    mock_output = NodeSpec(
        type_name="mock.output",
        mode=NodeMode.ASYNC,
        inputs=[PortSpec(name="in", frame_schema="any", required=True)],
        outputs=[],
        description="模拟输出节点",
    )

    registry.bulk_register(
        [mock_input, mock_llm, mock_tts, mock_motion, timeline_sync, mock_output]
    )
    return registry
