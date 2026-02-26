"""内置节点行为测试。"""

from __future__ import annotations

import asyncio
from typing import Any

from app.core.node_base import NodeContext
from app.core.registry import create_default_registry
from app.nodes.mock_input import MockInputNode
from app.nodes.mock_llm import MockLLMNode
from app.nodes.mock_motion import MockMotionNode
from app.nodes.mock_output import MockOutputNode
from app.nodes.mock_tts import MockTTSNode
from app.nodes.timeline_sync import TimelineSyncNode


def _context(*, node_id: str, stream_id: str = "stream_test") -> NodeContext:
    return NodeContext(run_id="run_test", node_id=node_id, metadata={"stream_id": stream_id})


def test_mock_input_node_uses_config_content() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        node = MockInputNode("n1", registry.get("mock.input"), config={"content": "hello"})
        output = await node.process(inputs={}, context=_context(node_id="n1"))
        assert output == {"text": "hello"}

    asyncio.run(_run())


def test_mock_llm_node_generates_answer() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        node = MockLLMNode("n2", registry.get("mock.llm"))
        output = await node.process(inputs={"prompt": "Hi"}, context=_context(node_id="n2"))
        assert output["answer"].startswith("[MockLLM回复]")
        assert "Hi" in output["answer"]

    asyncio.run(_run())


def test_mock_tts_node_enforces_min_duration() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        node = MockTTSNode("n3", registry.get("mock.tts"))
        output = await node.process(inputs={"text": ""}, context=_context(node_id="n3"))
        assert output["audio"]["duration_ms"] >= 400
        assert output["audio"]["format"] == "wav"

    asyncio.run(_run())


def test_mock_motion_node_builds_timeline() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        node = MockMotionNode("n4", registry.get("mock.motion"))
        output = await node.process(inputs={"text": "abc"}, context=_context(node_id="n4"))
        timeline: list[dict[str, Any]] = output["motion"]["timeline"]
        assert len(timeline) == 3
        assert timeline[0]["action"] == "idle"
        assert timeline[2]["t"] > timeline[1]["t"]

    asyncio.run(_run())


def test_timeline_sync_node_uses_context_stream_id() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        node = TimelineSyncNode("n5", registry.get("sync.timeline"))
        output = await node.process(
            inputs={"audio": {"duration_ms": 1000}, "motion": {"timeline": []}},
            context=_context(node_id="n5", stream_id="stream_custom"),
        )
        sync_payload = output["sync"]
        assert sync_payload["stream_id"] == "stream_custom"
        assert sync_payload["seq"] == 0
        assert sync_payload["play_at"] > 0
        assert sync_payload["strategy"] == "clock_lock"

    asyncio.run(_run())


def test_mock_output_node_consumes_any_payload() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        node = MockOutputNode("n6", registry.get("mock.output"))
        output = await node.process(inputs={"in": {"anything": 1}}, context=_context(node_id="n6"))
        assert output == {}

    asyncio.run(_run())
