"""错误分类与统一错误码测试（T4）。"""

from __future__ import annotations

import asyncio

from app.core.errors import (
    ErrorCode,
    NodeTimeoutError,
    RuntimeNodeError,
    classify_exception,
    is_retryable_exception,
)


def test_classify_runtime_node_error_preserves_code_and_retryable() -> None:
    exc = RuntimeNodeError(
        "custom",
        code=ErrorCode.NODE_INPUT_UNAVAILABLE,
        retryable=False,
    )
    code, retryable = classify_exception(exc)
    assert code == ErrorCode.NODE_INPUT_UNAVAILABLE
    assert retryable is False


def test_classify_timeout_error_as_retryable() -> None:
    code, retryable = classify_exception(asyncio.TimeoutError())
    assert code == ErrorCode.NODE_TIMEOUT
    assert retryable is True


def test_classify_type_error_as_non_retryable_output_error() -> None:
    code, retryable = classify_exception(TypeError("bad output"))
    assert code == ErrorCode.NODE_OUTPUT_INVALID
    assert retryable is False


def test_classify_runtime_error_as_retryable_execution_error() -> None:
    code, retryable = classify_exception(RuntimeError("transient"))
    assert code == ErrorCode.NODE_EXECUTION_FAILED
    assert retryable is True


def test_node_timeout_error_helper() -> None:
    exc = NodeTimeoutError()
    code, retryable = classify_exception(exc)
    assert code == ErrorCode.NODE_TIMEOUT
    assert retryable is True
    assert is_retryable_exception(exc) is True
