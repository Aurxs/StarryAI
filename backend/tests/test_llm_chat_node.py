"""Unified llm.chat node tests."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.core.node_base import NodeContext
from app.core.registry import create_default_registry
from app.nodes.llm_chat import LLMChatNode, TransportResponse


def _context() -> NodeContext:
    return NodeContext(
        run_id="run_llm_chat_test",
        node_id="n_llm_chat",
        metadata={"stream_id": "stream_llm_chat"},
    )


def test_llm_chat_processes_openai_compatible_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def _fake_send_request(
        self: LLMChatNode,
        *,
        url: str,
        headers: dict[str, str],
        body: dict[str, Any],
        timeout_s: float | None,
    ) -> TransportResponse:
        captured["url"] = url
        captured["headers"] = headers
        captured["body"] = body
        captured["timeout_s"] = timeout_s
        return TransportResponse(
            payload={
                "id": "chatcmpl-openai-1",
                "model": "gpt-4o-mini",
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "hello from llm.chat",
                        },
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 12,
                    "completion_tokens": 7,
                    "total_tokens": 19,
                },
            },
            headers={"x-request-id": "req-openai-1"},
        )

    monkeypatch.setattr(LLMChatNode, "send_request", _fake_send_request)

    async def _run() -> None:
        registry = create_default_registry()
        node = LLMChatNode(
            "n_llm_chat",
            registry.get("llm.chat"),
            config={
                "preset_id": "openai",
                "model": "gpt-4o-mini",
                "api_key": "sk-test",
                "system_prompt": "You are a node.",
                "temperature": 0.1,
                "max_tokens": 128,
                "top_p": 0.9,
                "timeout_s": 15,
                "extra_body_json": '{"response_format":{"type":"json_schema"}}',
            },
        )
        output = await node.process(inputs={"prompt": "say hello"}, context=_context())
        assert output["answer"] == "hello from llm.chat"
        assert output["result"] == {
            "answer": "hello from llm.chat",
            "provider": "openai",
            "preset_id": "openai",
            "model": "gpt-4o-mini",
            "finish_reason": "stop",
            "request_id": "req-openai-1",
            "response_id": "chatcmpl-openai-1",
            "usage": {
                "prompt_tokens": 12,
                "completion_tokens": 7,
                "total_tokens": 19,
            },
        }
        assert output["__node_metrics"]["llm_provider"] == "openai"
        assert output["__node_metrics"]["llm_model"] == "gpt-4o-mini"
        assert output["__node_metrics"]["llm_total_tokens"] == 19

    asyncio.run(_run())

    assert captured["url"] == "https://api.openai.com/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer sk-test"
    assert captured["body"]["model"] == "gpt-4o-mini"
    assert captured["body"]["messages"][0]["role"] == "system"
    assert captured["body"]["messages"][1]["content"] == "say hello"
    assert captured["body"]["response_format"] == {"type": "json_schema"}
    assert captured["timeout_s"] == 15


def test_llm_chat_processes_anthropic_messages_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def _fake_send_request(
        self: LLMChatNode,
        *,
        url: str,
        headers: dict[str, str],
        body: dict[str, Any],
        timeout_s: float | None,
    ) -> TransportResponse:
        captured["url"] = url
        captured["headers"] = headers
        captured["body"] = body
        captured["timeout_s"] = timeout_s
        return TransportResponse(
            payload={
                "id": "msg_123",
                "model": "claude-sonnet-4-20250514",
                "stop_reason": "end_turn",
                "content": [
                    {"type": "text", "text": "hello from anthropic"},
                ],
                "usage": {
                    "input_tokens": 21,
                    "output_tokens": 9,
                },
            },
            headers={"request-id": "req-anthropic-1"},
        )

    monkeypatch.setattr(LLMChatNode, "send_request", _fake_send_request)

    async def _run() -> None:
        registry = create_default_registry()
        node = LLMChatNode(
            "n_llm_chat",
            registry.get("llm.chat"),
            config={
                "preset_id": "anthropic",
                "api_key": "anthropic-key",
                "system_prompt": "Be concise.",
                "temperature": 0.3,
                "top_p": 0.8,
            },
        )
        output = await node.process(inputs={"prompt": "say hello"}, context=_context())
        assert output["answer"] == "hello from anthropic"
        assert output["result"]["provider"] == "anthropic"
        assert output["result"]["preset_id"] == "anthropic"
        assert output["result"]["finish_reason"] == "end_turn"
        assert output["result"]["request_id"] == "req-anthropic-1"
        assert output["result"]["usage"] == {
            "prompt_tokens": 21,
            "completion_tokens": 9,
            "total_tokens": 30,
        }

    asyncio.run(_run())

    assert captured["url"] == "https://api.anthropic.com/v1/messages"
    assert captured["headers"]["x-api-key"] == "anthropic-key"
    assert captured["headers"]["anthropic-version"] == "2023-06-01"
    assert captured["body"]["system"] == "Be concise."
    assert captured["body"]["messages"] == [{"role": "user", "content": "say hello"}]
    assert captured["body"]["model"] == "claude-sonnet-4-20250514"
    assert captured["body"]["max_tokens"] == 1024


def test_llm_chat_processes_gemini_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def _fake_send_request(
        self: LLMChatNode,
        *,
        url: str,
        headers: dict[str, str],
        body: dict[str, Any],
        timeout_s: float | None,
    ) -> TransportResponse:
        captured["url"] = url
        captured["headers"] = headers
        captured["body"] = body
        captured["timeout_s"] = timeout_s
        return TransportResponse(
            payload={
                "responseId": "gemini-response-1",
                "modelVersion": "gemini-2.5-flash",
                "candidates": [
                    {
                        "finishReason": "STOP",
                        "content": {
                            "parts": [{"text": "hello from gemini"}],
                        },
                    }
                ],
                "usageMetadata": {
                    "promptTokenCount": 8,
                    "candidatesTokenCount": 4,
                    "totalTokenCount": 12,
                },
            },
            headers={"x-goog-request-id": "req-gemini-1"},
        )

    monkeypatch.setattr(LLMChatNode, "send_request", _fake_send_request)

    async def _run() -> None:
        registry = create_default_registry()
        node = LLMChatNode(
            "n_llm_chat",
            registry.get("llm.chat"),
            config={
                "preset_id": "gemini",
                "model": "models/gemini-2.5-flash",
                "api_key": "gemini-key",
                "system_prompt": "Speak plainly.",
                "temperature": 0.4,
                "max_tokens": 64,
            },
        )
        output = await node.process(inputs={"prompt": "say hello"}, context=_context())
        assert output["answer"] == "hello from gemini"
        assert output["result"]["provider"] == "gemini"
        assert output["result"]["request_id"] == "req-gemini-1"
        assert output["result"]["response_id"] == "gemini-response-1"
        assert output["result"]["usage"]["total_tokens"] == 12

    asyncio.run(_run())

    assert captured["url"] == (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        "gemini-2.5-flash:generateContent"
    )
    assert captured["headers"]["x-goog-api-key"] == "gemini-key"
    assert captured["body"]["system_instruction"] == {
        "parts": [{"text": "Speak plainly."}],
    }
    assert captured["body"]["contents"] == [
        {"role": "user", "parts": [{"text": "say hello"}]}
    ]
    assert captured["body"]["generationConfig"]["maxOutputTokens"] == 64


def test_llm_chat_requires_api_key() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        node = LLMChatNode(
            "n_llm_chat",
            registry.get("llm.chat"),
            config={
                "preset_id": "openai",
            },
        )
        with pytest.raises(ValueError, match="api_key"):
            await node.process(inputs={"prompt": "say hello"}, context=_context())

    asyncio.run(_run())


def test_llm_chat_rejects_invalid_extra_body_json() -> None:
    registry = create_default_registry()
    with pytest.raises(ValueError, match="extra_body_json"):
        LLMChatNode(
            "n_llm_chat",
            registry.get("llm.chat"),
            config={
                "preset_id": "openai",
                "api_key": "sk-test",
                "extra_body_json": "[]",
            },
        )


def test_llm_chat_rejects_invalid_preset_id() -> None:
    registry = create_default_registry()
    with pytest.raises(ValueError, match="preset_id"):
        LLMChatNode(
            "n_llm_chat",
            registry.get("llm.chat"),
            config={
                "preset_id": "not-a-real-provider",
                "api_key": "sk-test",
            },
        )
