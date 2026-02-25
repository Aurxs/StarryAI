"""阶段 A：图引擎统一消息协议定义。

该文件定义了三个核心概念：
1. `Frame`：通用节点间消息。
2. `SyncFrame`：同步播放编排消息。
3. `RuntimeEvent`：运行态事件消息（日志/WS 使用）。

注意：当前阶段默认非流式处理，但协议中已预留流式与同步字段，
后续阶段可以平滑升级，无需推翻已有模型。
"""

from __future__ import annotations

import time
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class FrameType(str, Enum):
    """框架内消息类型枚举。"""

    # 常规业务数据帧（例如文本、音频信息、动作信息）。
    DATA = "data"
    # 控制帧（例如停止、重置、阶段切换）。
    CONTROL = "control"
    # 同步帧（用于时间轴或同步调度的专用消息）。
    SYNC = "sync"


class Frame(BaseModel):
    """节点间流转的统一消息结构。

    字段语义：
    - run_id: 一次工作流运行实例 ID。
    - stream_id: 同一业务流 ID（如一次问答或一次播报）。
    - seq: stream 内顺序号；当前非流式阶段通常为 0。
    - source_node/source_port: 产生该帧的节点与端口。
    - frame_type: 帧类型，区分数据帧与控制帧。
    - ts: 帧创建时间戳（Unix 时间）。
    - end: 业务流是否结束。
    - sync_key/play_at: 为同步节点保留的对齐字段。
    - payload: 实际业务数据。
    - metadata: 额外上下文信息，不参与核心语义。
    """

    # 严禁未声明字段，防止接口输入悄悄漂移。
    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(..., min_length=1, description="运行实例 ID")
    stream_id: str = Field(..., min_length=1, description="业务流 ID")
    seq: int = Field(default=0, ge=0, description="业务流顺序号")

    source_node: str = Field(..., min_length=1, description="来源节点 ID")
    source_port: str = Field(..., min_length=1, description="来源输出端口")
    frame_type: FrameType = Field(default=FrameType.DATA, description="帧类型")

    ts: float = Field(default_factory=time.time, description="创建时间戳")
    end: bool = Field(default=False, description="是否结束")

    # 同步相关字段：
    # sync_key 用于归并多路消息；play_at 用于执行对齐时刻。
    sync_key: str | None = Field(default=None)
    play_at: float | None = Field(default=None)

    payload: dict[str, Any] = Field(default_factory=dict, description="业务数据")
    metadata: dict[str, Any] = Field(default_factory=dict, description="附加信息")


class SyncFrame(BaseModel):
    """同步播放层标准消息。

    一个 SyncFrame 代表一个可执行的同步片段，包含：
    - 统一 `stream_id` 和 `seq`
    - 统一触发时刻 `play_at`
    - 同步执行所需的音频/动作命令
    """

    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(..., min_length=1, description="运行实例 ID")
    stream_id: str = Field(..., min_length=1, description="业务流 ID")
    seq: int = Field(..., ge=0, description="同步片段序号")
    play_at: float = Field(..., ge=0, description="计划触发时间（单调时钟）")

    audio_command: dict[str, Any] = Field(default_factory=dict, description="音频命令")
    motion_command: dict[str, Any] = Field(default_factory=dict, description="动作命令")
    metadata: dict[str, Any] = Field(default_factory=dict, description="附加信息")


class RuntimeEventType(str, Enum):
    """引擎运行事件类型枚举。"""

    RUN_STARTED = "run_started"
    RUN_STOPPED = "run_stopped"
    NODE_STARTED = "node_started"
    NODE_FINISHED = "node_finished"
    NODE_FAILED = "node_failed"
    FRAME_EMITTED = "frame_emitted"
    SYNC_FRAME_EMITTED = "sync_frame_emitted"


class RuntimeEvent(BaseModel):
    """引擎对外发布的运行事件。

    该模型可用于：
    1. WebSocket 实时推送
    2. 运行日志结构化记录
    3. 前端运行面板状态展示
    """

    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(..., min_length=1, description="运行实例 ID")
    event_type: RuntimeEventType = Field(..., description="事件类型")
    ts: float = Field(default_factory=time.time, description="事件时间")
    node_id: str | None = Field(default=None, description="相关节点 ID")
    message: str | None = Field(default=None, description="可读消息")
    details: dict[str, Any] = Field(default_factory=dict, description="扩展详情")
