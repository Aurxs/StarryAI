"""阶段 A: 队列与背压策略定义。"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class BackpressurePolicy(str, Enum):
    """队列满时的策略。"""

    BLOCK = "block"
    DROP_OLDEST = "drop_oldest"
    DROP_NEWEST = "drop_newest"


class QueuePolicy(BaseModel):
    """边队列策略。

    说明:
    - maxsize=0 表示无界队列。
    - policy 在阶段 B 的运行时执行器中生效。
    """

    model_config = ConfigDict(extra="forbid")

    maxsize: int = Field(default=0, ge=0)
    policy: BackpressurePolicy = Field(default=BackpressurePolicy.BLOCK)
