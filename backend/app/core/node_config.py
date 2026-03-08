"""节点配置模型。

本模块提供节点级公共配置字段，用于统一执行策略参数的声明方式。
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class CommonNodeConfig(BaseModel):
    """所有节点共享的执行策略配置。"""

    # 允许节点在子类中扩展业务字段；未迁移节点保持宽松兼容。
    model_config = ConfigDict(extra="allow")

    timeout_s: float | None = Field(default=None, gt=0, description="Per-execution timeout in seconds.")
    max_retries: int = Field(default=0, ge=0, description="Maximum number of retries after a failure.")
    retry_backoff_ms: int = Field(default=0, ge=0, description="Backoff interval between retries in milliseconds.")
    continue_on_error: bool = Field(
        default=False,
        description="Whether the workflow may continue after this node fails.",
    )
    critical: bool = Field(default=False, description="Whether this node is treated as critical.")
