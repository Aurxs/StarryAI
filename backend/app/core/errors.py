"""运行时错误分类与错误码定义（Phase D / T4）。"""

from __future__ import annotations

import asyncio
from enum import Enum
from typing import Any


class ErrorCode(str, Enum):
    """统一错误码。"""

    NODE_EXECUTION_FAILED = "node.execution_failed"
    NODE_TIMEOUT = "node.timeout"
    NODE_OUTPUT_INVALID = "node.output_invalid"
    NODE_INPUT_UNAVAILABLE = "node.input_unavailable"
    NODE_RETRY_EXHAUSTED = "node.retry_exhausted"
    SCHEDULER_INTERNAL = "scheduler.internal_error"


class RuntimeNodeError(Exception):
    """带错误码与重试属性的节点运行错误。"""

    def __init__(
            self,
            message: str,
            *,
            code: ErrorCode,
            retryable: bool,
            details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.details = details or {}


class NodeTimeoutError(RuntimeNodeError):
    """节点执行超时。"""

    def __init__(self, message: str = "节点执行超时") -> None:
        super().__init__(message, code=ErrorCode.NODE_TIMEOUT, retryable=True)


def classify_exception(exc: Exception) -> tuple[ErrorCode, bool]:
    """将异常归类到统一错误码并返回是否可重试。"""
    if isinstance(exc, RuntimeNodeError):
        return exc.code, exc.retryable

    if isinstance(exc, asyncio.TimeoutError):
        return ErrorCode.NODE_TIMEOUT, True

    # 合同类错误默认不可重试，避免无意义重试。
    if isinstance(exc, (TypeError, ValueError, KeyError)):
        if isinstance(exc, TypeError):
            return ErrorCode.NODE_OUTPUT_INVALID, False
        return ErrorCode.NODE_EXECUTION_FAILED, False

    # 其它运行时错误保守视为可重试，交给上层策略决定是否继续重试。
    if isinstance(exc, RuntimeError):
        return ErrorCode.NODE_EXECUTION_FAILED, True

    return ErrorCode.SCHEDULER_INTERNAL, False


def is_retryable_exception(exc: Exception) -> bool:
    """返回异常是否可重试。"""
    _code, retryable = classify_exception(exc)
    return retryable


__all__ = [
    "ErrorCode",
    "RuntimeNodeError",
    "NodeTimeoutError",
    "classify_exception",
    "is_retryable_exception",
]
