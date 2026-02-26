"""API Schema 包。

阶段 A 说明：
- 当前接口直接复用了 core 层的数据模型（如 GraphSpec）。
- 阶段 B 开始建议在该目录定义 API 专用 DTO，
  避免 core 模型和对外模型强耦合。
"""

from .runs import (
    CreateRunRequest,
    CreateRunResponse,
    RunEventsResponse,
    RunStatusResponse,
    StopRunResponse,
)

__all__ = [
    "CreateRunRequest",
    "CreateRunResponse",
    "StopRunResponse",
    "RunStatusResponse",
    "RunEventsResponse",
]
