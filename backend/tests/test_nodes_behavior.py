"""内置节点行为测试（同步重构版）。"""

from __future__ import annotations

import asyncio

from app.core.data_registry import GraphDataVariable
from app.core.node_base import NodeContext
from app.core.registry import create_default_registry
from app.core.runtime_data import RuntimeDataEntry, RuntimeDataStore
from app.core.sync_coordinator import SyncCoordinator
from app.nodes.audio_play_base import AudioPlayBaseNode
from app.nodes.audio_play_sync import AudioPlaySyncNode
from app.nodes.data_nodes import DataRequesterNode, DataWriterNode
from app.nodes.mock_input import MockInputNode
from app.nodes.mock_llm import MockLLMNode
from app.nodes.mock_motion import MockMotionNode
from app.nodes.mock_output import MockOutputNode
from app.nodes.mock_tts import MockTTSNode
from app.nodes.motion_play_sync import MotionPlaySyncNode
from app.nodes.sync_initiator_dual import SyncInitiatorDualNode


def _context(
    *,
    node_id: str,
    stream_id: str = "stream_test",
    seq: int = 0,
    coordinator: SyncCoordinator | None = None,
    participants: dict[str, list[str]] | None = None,
) -> NodeContext:
    metadata = {"stream_id": stream_id, "seq": seq}
    if coordinator is not None:
        metadata["sync_coordinator"] = coordinator
    if participants is not None:
        metadata["sync_group_participants"] = participants
    metadata.setdefault("reference_bindings", {})
    metadata.setdefault("writer_targets", {})
    return NodeContext(run_id="run_test", node_id=node_id, metadata=metadata)


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


def test_mock_tts_and_motion_nodes_produce_raw_payloads() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        tts = MockTTSNode("n3", registry.get("mock.tts"))
        motion = MockMotionNode("n4", registry.get("mock.motion"))
        tts_output = await tts.process(inputs={"text": "abc"}, context=_context(node_id="n3"))
        motion_output = await motion.process(inputs={"text": "abc"}, context=_context(node_id="n4"))
        assert tts_output["audio"]["duration_ms"] >= 400
        assert motion_output["motion"]["timeline"][0]["action"] == "idle"
        assert tts_output["audio"]["stream_id"] == "stream_test"
        assert motion_output["motion"]["stream_id"] == "stream_test"

    asyncio.run(_run())


def test_sync_initiator_dual_wraps_two_inputs_into_sync_envelopes() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        node = SyncInitiatorDualNode(
            "n4",
            registry.get("sync.initiator.dual"),
            config={"sync_group": "g1", "sync_round": 3},
        )
        output = await node.process(
            inputs={"in_a": {"audio": 1}, "in_b": {"motion": 1}},
            context=_context(node_id="n4", stream_id="s_custom"),
        )
        assert output["out_a"]["data"] == {"audio": 1}
        assert output["out_b"]["data"] == {"motion": 1}
        assert output["out_a"]["sync"]["sync_group"] == "g1"
        assert output["out_a"]["sync"]["stream_id"] == "s_custom"
        assert output["out_a"]["sync"]["seq"] == 3
        assert output["out_a"]["sync"]["sync_round"] == 3
        assert output["out_a"]["sync"]["sync_key"] == "s_custom:g1:3"
        assert output["out_a"]["sync"]["ready_timeout_ms"] == 800
        assert output["out_a"]["sync"]["commit_lead_ms"] == 50
        assert isinstance(output["out_a"]["sync"]["issued_at"], float)
        assert output["out_b"]["sync"]["sync_key"] == "s_custom:g1:3"
        assert output["__node_metrics"]["sync_packets_emitted"] == 2

    asyncio.run(_run())


def test_sync_initiator_dual_requires_explicit_sync_group() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        node = SyncInitiatorDualNode(
            "n4",
            registry.get("sync.initiator.dual"),
            config={},
        )
        try:
            await node.process(
                inputs={"in_a": {"audio": 1}, "in_b": {"motion": 1}},
                context=_context(node_id="n4", stream_id="s_custom"),
            )
            raise AssertionError("expected sync_group missing to fail")
        except ValueError as exc:
            assert "sync_group" in str(exc)

    asyncio.run(_run())


def test_audio_play_base_consumes_without_outputs() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        node = AudioPlayBaseNode("n5", registry.get("audio.play.base"))
        output = await node.process(inputs={"in": {"audio": "raw"}}, context=_context(node_id="n5"))
        assert output == {}

    asyncio.run(_run())


def test_sync_executor_nodes_commit_when_group_all_ready() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        coordinator = SyncCoordinator()
        participants = {"g_ok": ["n5", "n6"]}

        audio_node = AudioPlaySyncNode(
            "n5",
            registry.get("audio.play.sync"),
            config={"sync_group": "g_ok", "ready_timeout_ms": 300, "commit_lead_ms": 10},
        )
        motion_node = MotionPlaySyncNode(
            "n6",
            registry.get("motion.play.sync"),
            config={"sync_group": "g_ok", "ready_timeout_ms": 300, "commit_lead_ms": 10},
        )
        payload_audio = {"data": {"audio": 1}, "sync": {"sync_group": "g_ok", "sync_round": 0}}
        payload_motion = {"data": {"motion": 1}, "sync": {"sync_group": "g_ok", "sync_round": 0}}

        out_audio, out_motion = await asyncio.gather(
            audio_node.process(
                inputs={"in": payload_audio},
                context=_context(
                    node_id="n5",
                    coordinator=coordinator,
                    participants=participants,
                ),
            ),
            motion_node.process(
                inputs={"in": payload_motion},
                context=_context(
                    node_id="n6",
                    coordinator=coordinator,
                    participants=participants,
                ),
            ),
        )
        assert out_audio["__node_metrics"]["sync_committed"] == 1
        assert out_motion["__node_metrics"]["sync_committed"] == 1

    asyncio.run(_run())


def test_sync_executor_aborts_on_ready_timeout() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        coordinator = SyncCoordinator()
        participants = {"g_timeout": ["n5", "n6"]}
        audio_node = AudioPlaySyncNode(
            "n5",
            registry.get("audio.play.sync"),
            config={"sync_group": "g_timeout", "ready_timeout_ms": 60, "commit_lead_ms": 10},
        )

        output = await audio_node.process(
            inputs={"in": {"data": {"audio": 1}, "sync": {"sync_group": "g_timeout", "sync_round": 0}}},
            context=_context(
                node_id="n5",
                coordinator=coordinator,
                participants=participants,
            ),
        )
        assert output["__node_metrics"]["sync_aborted"] == 1
        assert output["__node_metrics"]["sync_abort_reason"] == "ready_timeout"

    asyncio.run(_run())


def test_sync_executor_requires_sync_group_in_payload() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        coordinator = SyncCoordinator()
        participants = {"g_missing": ["n5", "n6"]}
        audio_node = AudioPlaySyncNode(
            "n5",
            registry.get("audio.play.sync"),
            config={"sync_group": "g_missing", "ready_timeout_ms": 60, "commit_lead_ms": 10},
        )

        try:
            await audio_node.process(
                inputs={"in": {"data": {"audio": 1}, "sync": {"sync_round": 0}}},
                context=_context(
                    node_id="n5",
                    coordinator=coordinator,
                    participants=participants,
                ),
            )
            raise AssertionError("expected sync_group missing to fail")
        except ValueError as exc:
            assert "sync_group" in str(exc)

    asyncio.run(_run())


def test_sync_executor_uses_sync_round_only_for_compat() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        coordinator = SyncCoordinator()
        participants = {"g_seq_only": ["n5", "n6"]}

        audio_node = AudioPlaySyncNode(
            "n5",
            registry.get("audio.play.sync"),
            config={"sync_group": "g_seq_only", "ready_timeout_ms": 300, "commit_lead_ms": 10},
        )
        motion_node = MotionPlaySyncNode(
            "n6",
            registry.get("motion.play.sync"),
            config={"sync_group": "g_seq_only", "ready_timeout_ms": 300, "commit_lead_ms": 10},
        )

        payload_audio = {"data": {"audio": 1}, "sync": {"sync_group": "g_seq_only", "seq": 1}}
        payload_motion = {"data": {"motion": 1}, "sync": {"sync_group": "g_seq_only", "seq": 2}}

        out_audio, out_motion = await asyncio.gather(
            audio_node.process(
                inputs={"in": payload_audio},
                context=_context(
                    node_id="n5",
                    coordinator=coordinator,
                    participants=participants,
                ),
            ),
            motion_node.process(
                inputs={"in": payload_motion},
                context=_context(
                    node_id="n6",
                    coordinator=coordinator,
                    participants=participants,
                ),
            ),
        )
        assert out_audio["__node_metrics"]["sync_committed"] == 1
        assert out_motion["__node_metrics"]["sync_committed"] == 1

    asyncio.run(_run())


def test_data_requester_reads_current_value_from_runtime_store() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        node = DataRequesterNode("n_req", registry.get("data.requester"))
        store = RuntimeDataStore(
            entries={
                "counter": RuntimeDataEntry(variable_name="counter", value_kind="scalar.int", value=7),
            },
        )
        output = await node.process(
            inputs={"trigger": "go"},
            context=NodeContext(
                run_id="run_test",
                node_id="n_req",
                metadata={
                    "data_store": store,
                    "reference_bindings": {"n_req": {"source": "v1"}},
                    "data_node_bindings": {"v1": "counter"},
                    "trigger_token": "tt-1",
                    "await_container_writes": _noop_wait,
                },
            ),
        )
        assert output == {"value": 7}

    asyncio.run(_run())


async def _noop_wait(_container_id: str, _trigger_token: str) -> None:
    return None


def test_data_writer_applies_literal_add_operation() -> None:
    async def _run() -> None:
            registry = create_default_registry()
            node = DataWriterNode(
                "n_writer",
                registry.get("data.writer"),
                config={
                    "target_variable_name": "counter",
                    "operation": "add",
                    "operand_mode": "literal",
                    "literal_value": 2,
                },
            )
            store = RuntimeDataStore(
                entries={
                    "counter": RuntimeDataEntry(variable_name="counter", value_kind="scalar.int", value=5),
                },
            )
            output = await node.process(
            inputs={"in": "trigger"},
            context=NodeContext(
                run_id="run_test",
                node_id="n_writer",
                    metadata={
                        "data_store": store,
                        "writer_targets": {"n_writer": "counter"},
                        "variables_by_name": {
                            "counter": GraphDataVariable(
                                name="counter",
                                value_kind="scalar.int",
                                initial_value=5,
                            )
                        },
                    },
                ),
            )
            assert output["__node_metrics"]["data_writes"] == 1
            assert store.read("counter") == 7

    asyncio.run(_run())


def test_mock_output_node_consumes_any_payload() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        node = MockOutputNode("n7", registry.get("mock.output"))
        output = await node.process(inputs={"in": {"anything": 1}}, context=_context(node_id="n7"))
        assert output == {}

    asyncio.run(_run())
