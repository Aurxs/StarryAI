"""阶段 A：边队列背压策略定义。

当前阶段先定义策略模型，阶段 B 在调度器中落地具体行为。
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class BackpressurePolicy(str, Enum):
    """队列满时策略。"""

    # 阻塞等待，优先完整性。
    BLOCK = "block"
    # 丢弃最旧数据，优先实时性。
    DROP_OLDEST = "drop_oldest"
    # 丢弃最新数据，优先历史连续性。
    DROP_NEWEST = "drop_newest"


class QueuePolicy(BaseModel):
    """边队列策略配置。"""

    model_config = ConfigDict(extra="forbid")

    # 0 表示无界队列。
    maxsize: int = Field(default=0, ge=0)
    # 队列满时如何处理。
    policy: BackpressurePolicy = Field(default=BackpressurePolicy.BLOCK)
