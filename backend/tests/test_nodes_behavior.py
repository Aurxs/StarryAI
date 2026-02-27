"""内置节点行为测试。"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.core.node_base import NodeContext
from app.core.registry import create_default_registry
from app.core.spec import LatePolicy, SyncConfig, SyncStrategy
from app.nodes.mock_input import MockInputNode
from app.nodes.mock_llm import MockLLMNode
from app.nodes.mock_motion import MockMotionNode
from app.nodes.mock_output import MockOutputNode
from app.nodes.mock_tts import MockTTSNode
from app.nodes.timeline_sync import TimelineSyncNode


def _context(*, node_id: str, stream_id: str = "stream_test", seq: int = 0) -> NodeContext:
    return NodeContext(
        run_id="run_test",
        node_id=node_id,
        metadata={"stream_id": stream_id, "seq": seq},
    )


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
        assert output["audio"]["stream_id"] == "stream_test"
        assert output["audio"]["seq"] == 0
        assert output["audio"]["play_at"] > 0

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
        assert output["motion"]["stream_id"] == "stream_test"
        assert output["motion"]["seq"] == 0
        assert output["motion"]["play_at"] > 0

    asyncio.run(_run())


def test_timeline_sync_node_outputs_sync_packet_with_metrics() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        node = TimelineSyncNode("n5", registry.get("sync.timeline"))
        output = await node.process(
            inputs={
                "audio": {"duration_ms": 1000, "stream_id": "stream_custom", "seq": 3},
                "motion": {"timeline": [], "stream_id": "stream_custom", "seq": 3},
            },
            context=_context(node_id="n5", stream_id="stream_fallback"),
        )
        sync_payload = output["sync"]
        assert sync_payload["stream_id"] == "stream_custom"
        assert sync_payload["seq"] == 3
        assert sync_payload["play_at"] > 0
        assert sync_payload["strategy"] == "clock_lock"
        assert sync_payload["decision"] == "emit"
        assert output["__node_metrics"]["sync_emitted"] == 1

    asyncio.run(_run())


def test_timeline_sync_node_rejects_mismatched_seq() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        node = TimelineSyncNode("n5", registry.get("sync.timeline"))
        with pytest.raises(ValueError, match="seq"):
            await node.process(
                inputs={
                    "audio": {"duration_ms": 1000, "stream_id": "stream_test", "seq": 1},
                    "motion": {"timeline": [], "stream_id": "stream_test", "seq": 2},
                },
                context=_context(node_id="n5"),
            )

    asyncio.run(_run())


def test_timeline_sync_node_late_policy_drop() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        node = TimelineSyncNode(
            "n5",
            registry.get("sync.timeline"),
            config={"lead_time_ms": 0, "late_tolerance_ms": 100},
            sync_config=SyncConfig(
                required_ports=["audio", "motion"],
                strategy=SyncStrategy.BARRIER,
                late_policy=LatePolicy.DROP,
                window_ms=40,
            ),
        )
        output = await node.process(
            inputs={
                "audio": {"duration_ms": 1000, "stream_id": "stream_test", "seq": 0, "play_at": 0.0},
                "motion": {"timeline": [], "stream_id": "stream_test", "seq": 0, "play_at": 0.0},
            },
            context=_context(node_id="n5"),
        )
        sync_payload = output["sync"]
        assert sync_payload["decision"] == "drop"
        assert sync_payload["audio_command"] == {}
        assert sync_payload["motion_command"] == {}
        assert sync_payload["metrics"]["dropped_late"] == 1

    asyncio.run(_run())


def test_timeline_sync_node_late_policy_reclock() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        node = TimelineSyncNode(
            "n5",
            registry.get("sync.timeline"),
            config={"lead_time_ms": 0, "late_tolerance_ms": 50, "reclock_offset_ms": 20},
            sync_config=SyncConfig(
                required_ports=["audio", "motion"],
                strategy=SyncStrategy.BARRIER,
                late_policy=LatePolicy.RECLOCK,
                window_ms=40,
            ),
        )
        output = await node.process(
            inputs={
                "audio": {"duration_ms": 1000, "stream_id": "stream_test", "seq": 0, "play_at": 0.0},
                "motion": {"timeline": [], "stream_id": "stream_test", "seq": 0, "play_at": 0.0},
            },
            context=_context(node_id="n5"),
        )
        sync_payload = output["sync"]
        assert sync_payload["decision"] == "reclock"
        assert sync_payload["audio_command"] != {}
        assert sync_payload["motion_command"] != {}
        assert sync_payload["metrics"]["reclocked"] == 1
        assert sync_payload["play_at"] > 0.05

    asyncio.run(_run())


def test_timeline_sync_node_emit_partial_with_missing_port() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        node = TimelineSyncNode(
            "n5",
            registry.get("sync.timeline"),
            sync_config=SyncConfig(
                required_ports=["audio", "motion"],
                strategy=SyncStrategy.BARRIER,
                late_policy=LatePolicy.EMIT_PARTIAL,
                window_ms=40,
            ),
        )
        output = await node.process(
            inputs={
                "audio": {"duration_ms": 900, "stream_id": "s_partial", "seq": 7, "play_at": 1.0},
            },
            context=_context(node_id="n5", stream_id="fallback_stream", seq=5),
        )
        sync_payload = output["sync"]
        assert sync_payload["decision"] == "emit_partial"
        assert sync_payload["stream_id"] == "s_partial"
        assert sync_payload["seq"] == 7
        assert sync_payload["audio_command"] != {}
        assert sync_payload["motion_command"] == {}
        assert "motion" in sync_payload["missing_ports"]
        assert sync_payload["metrics"]["emit_partial"] == 1

    asyncio.run(_run())


def test_mock_output_node_consumes_any_payload() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        node = MockOutputNode("n6", registry.get("mock.output"))
        output = await node.process(inputs={"in": {"anything": 1}}, context=_context(node_id="n6"))
        assert output == {}

    asyncio.run(_run())
