"""阶段 A: 图引擎统一消息协议。"""

from __future__ import annotations

import time
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class FrameType(str, Enum):
    """帧类型。"""

    DATA = "data"
    CONTROL = "control"
    SYNC = "sync"


class Frame(BaseModel):
    """节点之间流转的统一数据结构。

    设计说明:
    - run_id: 一次工作流运行的唯一标识。
    - stream_id: 同一条业务流的标识。非流式阶段可将单次结果视为一个 stream。
    - seq: 在同一 stream 内的顺序编号。非流式阶段通常固定为 0。
    - sync_key/play_at: 为同步节点预留，用于音频与动作对齐。
    """

    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(..., min_length=1)
    stream_id: str = Field(..., min_length=1)
    seq: int = Field(default=0, ge=0)

    source_node: str = Field(..., min_length=1)
    source_port: str = Field(..., min_length=1)
    frame_type: FrameType = Field(default=FrameType.DATA)

    ts: float = Field(default_factory=time.time)
    end: bool = Field(default=False)

    sync_key: str | None = Field(default=None)
    play_at: float | None = Field(default=None)

    payload: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class SyncFrame(BaseModel):
    """同步播放层使用的标准帧。

    一个 SyncFrame 对应一次可调度的时间片(seq)；
    audio_command 与 motion_command 在同一个 play_at 时刻触发。
    """

    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(..., min_length=1)
    stream_id: str = Field(..., min_length=1)
    seq: int = Field(..., ge=0)
    play_at: float = Field(..., ge=0)

    audio_command: dict[str, Any] = Field(default_factory=dict)
    motion_command: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class RuntimeEventType(str, Enum):
    """运行事件类型（供 WebSocket/日志系统使用）。"""

    RUN_STARTED = "run_started"
    RUN_STOPPED = "run_stopped"
    NODE_STARTED = "node_started"
    NODE_FINISHED = "node_finished"
    NODE_FAILED = "node_failed"
    FRAME_EMITTED = "frame_emitted"
    SYNC_FRAME_EMITTED = "sync_frame_emitted"


class RuntimeEvent(BaseModel):
    """引擎对外事件。"""

    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(..., min_length=1)
    event_type: RuntimeEventType
    ts: float = Field(default_factory=time.time)
    node_id: str | None = None
    message: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)
