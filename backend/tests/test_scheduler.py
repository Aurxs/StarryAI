"""GraphScheduler 运行测试（同步重构版）。"""

from __future__ import annotations

import asyncio
from typing import Any

from app.core.frame import RuntimeEventType
from app.core.graph_builder import GraphBuilder
from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext
from app.core.node_factory import NodeFactory, create_default_node_factory
from app.core.registry import create_default_registry
from app.core.scheduler import GraphScheduler
from app.core.spec import EdgeSpec, GraphSpec, NodeInstanceSpec, NodeMode, NodeSpec, PortSpec, SyncConfig, SyncRole


class IncompleteOutputNode(AsyncNode):
    """返回不完整输出的节点（缺少已连接端口的数据）。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = inputs
        _ = context
        return {}


class BadSyncEnvelopeNode(AsyncNode):
    """输出非法同步包（非 data/sync envelope）。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = inputs
        _ = context
        return {"out": {"bad": "payload"}}


class SlowSyncConsumerNode(AsyncNode):
    """模拟未参与 ready 协调的慢同步节点，用于触发超时中止。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = inputs
        _ = context
        await asyncio.sleep(float(self.config.get("delay_s", 0.25)))
        return {}


CAPTURED_VALUES: list[Any] = []


class CaptureNode(AsyncNode):
    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context
        CAPTURED_VALUES.append(inputs.get("in"))
        return {}


def _build_registry_with_custom_nodes() -> GraphBuilder:
    registry = create_default_registry()
    registry.register(
        NodeSpec(
            type_name="test.incomplete_output",
            mode=NodeMode.ASYNC,
            inputs=[],
            outputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
            description="returns empty output despite connected edge",
        )
    )
    registry.register(
        NodeSpec(
            type_name="test.bad_sync_envelope",
            mode=NodeMode.ASYNC,
            inputs=[],
            outputs=[PortSpec(name="out", frame_schema="audio.full.sync", required=True)],
            description="emits malformed sync envelope",
        )
    )
    registry.register(
        NodeSpec(
            type_name="test.slow_sync_consumer",
            mode=NodeMode.SYNC,
            inputs=[PortSpec(name="in", frame_schema="motion.timeline.sync", required=True)],
            outputs=[],
            sync_config=SyncConfig(
                required_ports=["in"],
                role=SyncRole.EXECUTOR,
                sync_group="g_timeout",
                ready_timeout_ms=120,
                commit_lead_ms=20,
            ),
            description="sync consumer that never calls coordinator.ready",
        )
    )
    registry.register(
        NodeSpec(
            type_name="test.capture",
            mode=NodeMode.ASYNC,
            inputs=[PortSpec(name="in", frame_schema="any", required=True)],
            outputs=[],
            description="capture sink",
        )
    )
    return GraphBuilder(registry)


def _build_factory_with_custom_nodes() -> NodeFactory:
    factory = create_default_node_factory()
    factory.register("test.incomplete_output", IncompleteOutputNode)
    factory.register("test.bad_sync_envelope", BadSyncEnvelopeNode)
    factory.register("test.slow_sync_consumer", SlowSyncConsumerNode)
    factory.register("test.capture", CaptureNode)
    return factory


def test_scheduler_runs_basic_chain() -> None:
    """最小链路应可执行完成。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_basic",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="mock.input"),
                NodeInstanceSpec(node_id="n2", type_name="mock.llm"),
                NodeInstanceSpec(node_id="n3", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="prompt"),
                EdgeSpec(source_node="n2", source_port="answer", target_node="n3", target_port="in"),
            ],
        )
        compiled = _build_registry_with_custom_nodes().build(graph)
        scheduler = GraphScheduler()
        state = await scheduler.run(compiled, run_id="run_scheduler_basic", stream_id="s_basic")

        assert state.status == "completed"
        assert state.node_states["n1"].status == "finished"
        assert state.node_states["n2"].status == "finished"
        assert state.node_states["n3"].status == "finished"

        events, _ = scheduler.get_events(since=0, limit=100)
        event_types = {event.event_type for event in events}
        assert RuntimeEventType.RUN_STARTED in event_types
        assert RuntimeEventType.NODE_FINISHED in event_types
        assert RuntimeEventType.RUN_STOPPED in event_types

    asyncio.run(_run())


def test_scheduler_fails_when_node_omits_connected_output() -> None:
    """节点未输出已连接端口的数据时，运行应失败而非死锁。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_incomplete",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="test.incomplete_output"),
                NodeInstanceSpec(node_id="n2", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="in"),
            ],
        )
        builder = _build_registry_with_custom_nodes()
        compiled = builder.build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())

        state = await scheduler.run(compiled, run_id="run_scheduler_incomplete")
        assert state.status == "failed"
        assert state.node_states["n1"].status == "failed"
        assert "text" in (state.node_states["n1"].last_error or "")

    asyncio.run(_run())


def test_scheduler_emits_sync_events_for_initiator_outputs() -> None:
    """同步发起器输出应被识别为 sync_frame_emitted。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_sync_events",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="mock.input"),
                NodeInstanceSpec(node_id="n2", type_name="mock.tts"),
                NodeInstanceSpec(node_id="n3", type_name="mock.motion"),
                NodeInstanceSpec(
                    node_id="n4",
                    type_name="sync.initiator.dual",
                    config={"sync_group": "g_sched", "sync_round": 0},
                ),
                NodeInstanceSpec(
                    node_id="n5",
                    type_name="audio.play.sync",
                    config={"sync_group": "g_sched"},
                ),
                NodeInstanceSpec(
                    node_id="n6",
                    type_name="motion.play.sync",
                    config={"sync_group": "g_sched"},
                ),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="text"),
                EdgeSpec(source_node="n1", source_port="text", target_node="n3", target_port="text"),
                EdgeSpec(source_node="n2", source_port="audio", target_node="n4", target_port="in_a"),
                EdgeSpec(source_node="n3", source_port="motion", target_node="n4", target_port="in_b"),
                EdgeSpec(source_node="n4", source_port="out_a", target_node="n5", target_port="in"),
                EdgeSpec(source_node="n4", source_port="out_b", target_node="n6", target_port="in"),
            ],
        )
        compiled = _build_registry_with_custom_nodes().build(graph)
        scheduler = GraphScheduler()
        state = await scheduler.run(compiled, run_id="run_scheduler_sync_events", stream_id="s_sync")
        assert state.status == "completed"
        assert state.node_states["n4"].metrics["sync_packets_emitted"] == 2
        assert state.node_states["n5"].metrics["sync_committed"] == 1
        assert state.node_states["n6"].metrics["sync_committed"] == 1

        events, _ = scheduler.get_events(since=0, limit=500)
        sync_events = [e for e in events if e.event_type == RuntimeEventType.SYNC_FRAME_EMITTED]
        assert len(sync_events) >= 2
        assert all(event.details["sync_group"] == "g_sched" for event in sync_events)
        assert all(event.details["sync_round"] == 0 for event in sync_events)
        assert {e.edge_key for e in sync_events} >= {"n4.out_a->n5.in", "n4.out_b->n6.in"}

    asyncio.run(_run())


def test_scheduler_sync_executor_aborts_when_peer_not_ready() -> None:
    """同组节点未全员 ready 时，ready 超时的一方应中止。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_sync_timeout",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="mock.input"),
                NodeInstanceSpec(node_id="n2", type_name="mock.tts"),
                NodeInstanceSpec(node_id="n3", type_name="mock.motion"),
                NodeInstanceSpec(
                    node_id="n4",
                    type_name="sync.initiator.dual",
                    config={"sync_group": "g_timeout", "sync_round": 0},
                ),
                NodeInstanceSpec(
                    node_id="n5",
                    type_name="audio.play.sync",
                    config={
                        "sync_group": "g_timeout",
                        "ready_timeout_ms": 120,
                        "commit_lead_ms": 20,
                    },
                ),
                NodeInstanceSpec(
                    node_id="n6",
                    type_name="test.slow_sync_consumer",
                    config={"sync_group": "g_timeout", "delay_s": 0.3},
                ),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="text"),
                EdgeSpec(source_node="n1", source_port="text", target_node="n3", target_port="text"),
                EdgeSpec(source_node="n2", source_port="audio", target_node="n4", target_port="in_a"),
                EdgeSpec(source_node="n3", source_port="motion", target_node="n4", target_port="in_b"),
                EdgeSpec(source_node="n4", source_port="out_a", target_node="n5", target_port="in"),
                EdgeSpec(source_node="n4", source_port="out_b", target_node="n6", target_port="in"),
            ],
        )
        builder = _build_registry_with_custom_nodes()
        compiled = builder.build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())
        state = await scheduler.run(compiled, run_id="run_scheduler_sync_timeout")
        assert state.status == "completed"
        assert state.node_states["n5"].metrics["sync_aborted"] == 1
        assert state.node_states["n5"].metrics["sync_abort_reason"] == "ready_timeout"
        assert state.node_states["n6"].status == "finished"

    asyncio.run(_run())


def test_scheduler_data_writer_completes_before_requester_reads_same_container() -> None:
    async def _run() -> None:
        CAPTURED_VALUES.clear()
        graph = GraphSpec(
            graph_id="g_scheduler_data_writer_requester",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="mock.input"),
                NodeInstanceSpec(
                    node_id="v1",
                    type_name="data.variable",
                    config={"value_type": "integer", "initial_value": 1},
                ),
                NodeInstanceSpec(
                    node_id="n2",
                    type_name="data.writer",
                    config={
                        "target_node_id": "v1",
                        "operation": "add",
                        "operand_mode": "literal",
                        "literal_value": 2,
                    },
                ),
                NodeInstanceSpec(node_id="n3", type_name="data.requester"),
                NodeInstanceSpec(node_id="n4", type_name="test.capture"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="in"),
                EdgeSpec(source_node="n1", source_port="text", target_node="n3", target_port="trigger"),
                EdgeSpec(source_node="v1", source_port="value", target_node="n3", target_port="source"),
                EdgeSpec(source_node="n3", source_port="value", target_node="n4", target_port="in"),
            ],
        )
        compiled = _build_registry_with_custom_nodes().build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())

        state = await scheduler.run(compiled, run_id="run_scheduler_data_writer_requester")
        assert state.status == "completed"
        assert CAPTURED_VALUES == [3]

    asyncio.run(_run())


def test_scheduler_fails_on_malformed_sync_envelope_output() -> None:
    """当上游声明 *.sync 输出但未提供 data/sync envelope 时应失败。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_bad_sync_envelope",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="test.bad_sync_envelope"),
                NodeInstanceSpec(
                    node_id="n2",
                    type_name="audio.play.sync",
                    config={"sync_group": "g_bad"},
                ),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="out", target_node="n2", target_port="in"),
            ],
        )
        builder = _build_registry_with_custom_nodes()
        compiled = builder.build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())
        state = await scheduler.run(compiled, run_id="run_scheduler_bad_sync_envelope")
        assert state.status == "failed"
        assert state.node_states["n1"].status == "failed"
        assert "sync" in (state.node_states["n1"].last_error or "")

    asyncio.run(_run())
