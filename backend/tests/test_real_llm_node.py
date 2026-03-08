"""Real LLM node tests."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.core.node_base import NodeContext
from app.core.registry import create_default_registry
from app.nodes.llm_openai_compatible import OpenAICompatibleLLMNode


def _context() -> NodeContext:
    return NodeContext(
        run_id="run_real_llm_test",
        node_id="n_real_llm",
        metadata={"stream_id": "stream_real_llm"},
    )


def test_openai_compatible_llm_processes_chat_completion_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def _fake_send_request(
        self: OpenAICompatibleLLMNode,
        *,
        url: str,
        headers: dict[str, str],
        body: dict[str, Any],
        timeout_s: float | None,
    ) -> dict[str, Any]:
        captured["url"] = url
        captured["headers"] = headers
        captured["body"] = body
        captured["timeout_s"] = timeout_s
        return {
            "model": "gpt-4o-mini",
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "hello from real llm",
                    }
                }
            ],
            "usage": {
                "prompt_tokens": 12,
                "completion_tokens": 7,
                "total_tokens": 19,
            },
        }

    monkeypatch.setattr(OpenAICompatibleLLMNode, "send_request", _fake_send_request)

    async def _run() -> None:
        registry = create_default_registry()
        node = OpenAICompatibleLLMNode(
            "n_real_llm",
            registry.get("llm.openai_compatible"),
            config={
                "base_url": "https://api.openai.com",
                "api_path": "/v1/chat/completions",
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
        assert output["answer"] == "hello from real llm"
        assert output["__node_metrics"]["llm_model"] == "gpt-4o-mini"
        assert output["__node_metrics"]["llm_prompt_tokens"] == 12
        assert output["__node_metrics"]["llm_completion_tokens"] == 7
        assert output["__node_metrics"]["llm_total_tokens"] == 19

    asyncio.run(_run())

    assert captured["url"] == "https://api.openai.com/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer sk-test"
    assert captured["body"]["model"] == "gpt-4o-mini"
    assert captured["body"]["messages"][0]["role"] == "system"
    assert captured["body"]["messages"][1]["content"] == "say hello"
    assert captured["body"]["response_format"] == {"type": "json_schema"}
    assert captured["timeout_s"] == 15


def test_openai_compatible_llm_extracts_responses_api_style_payload() -> None:
    payload = {
        "output": [
            {
                "content": [
                    {"type": "output_text", "text": "first line"},
                    {"type": "output_text", "text": "second line"},
                ]
            }
        ],
        "usage": {
            "input_tokens": 9,
            "output_tokens": 4,
        },
    }

    text = OpenAICompatibleLLMNode.extract_text(payload)
    metrics = OpenAICompatibleLLMNode.extract_usage_metrics(payload, fallback_model="demo-model")

    assert text == "first line\nsecond line"
    assert metrics["llm_model"] == "demo-model"
    assert metrics["llm_prompt_tokens"] == 9
    assert metrics["llm_completion_tokens"] == 4
    assert metrics["llm_total_tokens"] == 13


def test_openai_compatible_llm_requires_api_key() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        node = OpenAICompatibleLLMNode(
            "n_real_llm",
            registry.get("llm.openai_compatible"),
            config={
                "model": "gpt-4o-mini",
            },
        )
        with pytest.raises(ValueError, match="api_key"):
            await node.process(inputs={"prompt": "say hello"}, context=_context())

    asyncio.run(_run())


def test_openai_compatible_llm_rejects_invalid_extra_body_json() -> None:
    registry = create_default_registry()
    with pytest.raises(ValueError, match="extra_body_json"):
        OpenAICompatibleLLMNode(
            "n_real_llm",
            registry.get("llm.openai_compatible"),
            config={
                "model": "gpt-4o-mini",
                "api_key": "sk-test",
                "extra_body_json": "[]",
            },
        )
