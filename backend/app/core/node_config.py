"""节点配置模型。

本模块提供节点级公共配置字段，用于统一执行策略参数的声明方式。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


def NodeField(*args: Any, readonly: bool = False, **kwargs: Any) -> Any:
    """包装 pydantic.Field，补充 StarryAI 节点配置字段元信息。

    当前支持：
    - `readonly=True`：前端按只读文本展示，不渲染输入框。
    """

    json_schema_extra = kwargs.pop("json_schema_extra", None)
    if readonly:
        if isinstance(json_schema_extra, Mapping):
            kwargs["json_schema_extra"] = {
                **dict(json_schema_extra),
                "readOnly": True,
            }
        elif callable(json_schema_extra):
            original_mutator = json_schema_extra

            def _with_readonly(schema: dict[str, Any]) -> None:
                original_mutator(schema)
                schema["readOnly"] = True

            kwargs["json_schema_extra"] = _with_readonly
        else:
            kwargs["json_schema_extra"] = {"readOnly": True} if json_schema_extra is None else json_schema_extra
    elif json_schema_extra is not None:
        kwargs["json_schema_extra"] = json_schema_extra
    return Field(*args, **kwargs)


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
