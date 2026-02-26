"""Service 层包。

阶段 A 说明：
- 当前业务逻辑较轻，尚未引入独立 service。
- 阶段 B 将在此增加 GraphService / RunService，
  承担编译、调度、状态查询等核心业务编排。
"""

from .run_service import (
    RunNotFoundError,
    RunRecord,
    RunService,
    get_run_service,
    reset_run_service_for_testing,
)

__all__ = [
    "RunNotFoundError",
    "RunRecord",
    "RunService",
    "get_run_service",
    "reset_run_service_for_testing",
]
