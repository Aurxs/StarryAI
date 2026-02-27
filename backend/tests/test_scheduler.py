"""GraphScheduler 运行测试。"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.core.frame import RuntimeEventType
from app.core.graph_builder import GraphBuilder
from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext
from app.core.node_factory import NodeFactory, create_default_node_factory
from app.core.registry import create_default_registry
from app.core.scheduler import GraphScheduler
from app.core.spec import EdgeSpec, GraphSpec, NodeInstanceSpec, NodeMode, NodeSpec, PortSpec, SyncConfig


class SlowPassthroughNode(AsyncNode):
    """用于 stop 路径测试的慢节点。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context
        await asyncio.sleep(float(self.config.get("delay_s", 0.5)))
        return {"text": str(inputs.get("text", ""))}


class FailingNode(AsyncNode):
    """用于异常路径测试的失败节点。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = inputs
        _ = context
        raise RuntimeError("boom from failing node")


class IncompleteOutputNode(AsyncNode):
    """返回不完整输出的节点（缺少已连接端口的数据）。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = inputs
        _ = context
        return {}


class FixedAudioMetaNode(AsyncNode):
    """输出带可控 meta 的 audio payload。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = inputs
        _ = context
        return {
            "audio": {
                "duration_ms": 800,
                "stream_id": self.config.get("stream_id", "stream_test"),
                "seq": int(self.config.get("seq", 0)),
                "play_at": float(self.config.get("play_at", 0.1)),
            }
        }


class FixedMotionMetaNode(AsyncNode):
    """输出带可控 meta 的 motion payload。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = inputs
        _ = context
        return {
            "motion": {
                "timeline": [{"t": 0, "action": "idle"}],
                "stream_id": self.config.get("stream_id", "stream_test"),
                "seq": int(self.config.get("seq", 0)),
                "play_at": float(self.config.get("play_at", 0.1)),
            }
        }


class BadSyncOutputNode(AsyncNode):
    """输出非法 seq 的同步 payload，验证调度器边界校验。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = inputs
        _ = context
        return {
            "sync": {
                "stream_id": "stream_bad",
                "seq": -1,
                "play_at": 0.1,
                "audio": {},
                "motion": {},
            }
        }


class MissingPlayAtSyncOutputNode(AsyncNode):
    """输出缺少 play_at 的同步 payload。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = inputs
        _ = context
        return {
            "sync": {
                "stream_id": "stream_bad",
                "seq": 0,
                "audio": {},
                "motion": {},
            }
        }


class NoneSyncKeyOutputNode(AsyncNode):
    """输出 sync_key=None 的同步 payload，用于验证回退逻辑。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = inputs
        _ = context
        return {
            "sync": {
                "stream_id": "stream_key",
                "seq": 3,
                "sync_key": None,
                "play_at": 0.2,
                "audio": {},
                "motion": {},
            }
        }


class ConfigurableSyncOutputNode(AsyncNode):
    """输出可配置同步 payload，用于验证调度器校验边界。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = inputs
        _ = context
        payload: dict[str, Any] = {
            "play_at": self.config.get("play_at", 0.1),
            "audio": {},
            "motion": {},
        }
        if "stream_id" in self.config:
            payload["stream_id"] = self.config["stream_id"]
        if "seq" in self.config:
            payload["seq"] = self.config["seq"]
        return {"sync": payload}


class NonDictSyncOutputNode(AsyncNode):
    """输出非 dict 的同步 payload。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = inputs
        _ = context
        return {"sync": "bad_payload"}


def _build_registry_with_custom_nodes() -> GraphBuilder:
    registry = create_default_registry()
    registry.register(
        NodeSpec(
            type_name="test.slow",
            mode=NodeMode.ASYNC,
            inputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
            outputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
            description="slow passthrough",
        )
    )
    registry.register(
        NodeSpec(
            type_name="test.fail",
            mode=NodeMode.ASYNC,
            inputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
            outputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
            description="always failing node",
        )
    )
    registry.register(
        NodeSpec(
            type_name="test.incomplete_output",
            mode=NodeMode.ASYNC,
            inputs=[],
            outputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
            description="returns empty output despite having connected port",
        )
    )
    registry.register(
        NodeSpec(
            type_name="test.meta_audio",
            mode=NodeMode.ASYNC,
            inputs=[],
            outputs=[PortSpec(name="audio", frame_schema="audio.full", required=True)],
            description="emit audio payload with sync meta",
        )
    )
    registry.register(
        NodeSpec(
            type_name="test.meta_motion",
            mode=NodeMode.ASYNC,
            inputs=[],
            outputs=[PortSpec(name="motion", frame_schema="motion.timeline", required=True)],
            description="emit motion payload with sync meta",
        )
    )
    registry.register(
        NodeSpec(
            type_name="test.bad_sync_output",
            mode=NodeMode.SYNC,
            inputs=[],
            outputs=[PortSpec(name="sync", frame_schema="sync.timeline", required=True)],
            sync_config=SyncConfig(required_ports=[]),
            description="emit bad sync payload for scheduler validation",
        )
    )
    registry.register(
        NodeSpec(
            type_name="test.no_play_at_sync_output",
            mode=NodeMode.SYNC,
            inputs=[],
            outputs=[PortSpec(name="sync", frame_schema="sync.timeline", required=True)],
            sync_config=SyncConfig(required_ports=[]),
            description="emit sync payload without play_at",
        )
    )
    registry.register(
        NodeSpec(
            type_name="test.none_sync_key_output",
            mode=NodeMode.SYNC,
            inputs=[],
            outputs=[PortSpec(name="sync", frame_schema="sync.timeline", required=True)],
            sync_config=SyncConfig(required_ports=[]),
            description="emit sync payload with none sync_key",
        )
    )
    registry.register(
        NodeSpec(
            type_name="test.config_sync_output",
            mode=NodeMode.SYNC,
            inputs=[],
            outputs=[PortSpec(name="sync", frame_schema="sync.timeline", required=True)],
            sync_config=SyncConfig(required_ports=[]),
            description="emit configurable sync payload for scheduler validation",
        )
    )
    registry.register(
        NodeSpec(
            type_name="test.non_dict_sync_output",
            mode=NodeMode.SYNC,
            inputs=[],
            outputs=[PortSpec(name="sync", frame_schema="sync.timeline", required=True)],
            sync_config=SyncConfig(required_ports=[]),
            description="emit non-dict sync payload",
        )
    )
    return GraphBuilder(registry)


def _build_factory_with_custom_nodes() -> NodeFactory:
    factory = create_default_node_factory()
    factory.register("test.slow", SlowPassthroughNode)
    factory.register("test.fail", FailingNode)
    factory.register("test.incomplete_output", IncompleteOutputNode)
    factory.register("test.meta_audio", FixedAudioMetaNode)
    factory.register("test.meta_motion", FixedMotionMetaNode)
    factory.register("test.bad_sync_output", BadSyncOutputNode)
    factory.register("test.no_play_at_sync_output", MissingPlayAtSyncOutputNode)
    factory.register("test.none_sync_key_output", NoneSyncKeyOutputNode)
    factory.register("test.config_sync_output", ConfigurableSyncOutputNode)
    factory.register("test.non_dict_sync_output", NonDictSyncOutputNode)
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
        compiled = GraphBuilder(create_default_registry()).build(graph)
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


def test_scheduler_stop_interrupts_running_nodes() -> None:
    """stop 应能停止运行中的慢节点。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_stop",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="mock.input"),
                NodeInstanceSpec(
                    node_id="n2",
                    type_name="test.slow",
                    config={"delay_s": 1.0},
                ),
                NodeInstanceSpec(node_id="n3", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="text"),
                EdgeSpec(source_node="n2", source_port="text", target_node="n3", target_port="in"),
            ],
        )
        builder = _build_registry_with_custom_nodes()
        compiled = builder.build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())

        task = asyncio.create_task(scheduler.run(compiled, run_id="run_scheduler_stop"))
        await asyncio.sleep(0.08)
        scheduler.stop()
        state = await task

        assert state.status == "stopped"
        assert state.node_states["n2"].status == "stopped"

    asyncio.run(_run())


def test_scheduler_marks_failed_on_node_exception() -> None:
    """节点异常应被捕获并标记运行失败。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_fail",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="mock.input"),
                NodeInstanceSpec(node_id="n2", type_name="test.fail"),
                NodeInstanceSpec(node_id="n3", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="text"),
                EdgeSpec(source_node="n2", source_port="text", target_node="n3", target_port="in"),
            ],
        )
        builder = _build_registry_with_custom_nodes()
        compiled = builder.build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())

        state = await scheduler.run(compiled, run_id="run_scheduler_fail")
        assert state.status == "failed"
        assert state.node_states["n2"].status == "failed"
        assert "boom from failing node" in (state.node_states["n2"].last_error or "")

        events, _ = scheduler.get_events(since=0, limit=100)
        assert any(event.event_type == RuntimeEventType.NODE_FAILED for event in events)

    asyncio.run(_run())


def test_scheduler_clamps_negative_event_cursor() -> None:
    """事件查询游标为负数时应自动归零。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_events",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="mock.input"),
                NodeInstanceSpec(node_id="n2", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="in"),
            ],
        )
        compiled = GraphBuilder(create_default_registry()).build(graph)
        scheduler = GraphScheduler()
        await scheduler.run(compiled, run_id="run_scheduler_events")

        events, next_cursor = scheduler.get_events(since=-99, limit=2)
        assert len(events) <= 2
        assert next_cursor == len(events)

    asyncio.run(_run())


def test_scheduler_stop_before_run_finishes_as_stopped() -> None:
    """在 run 前先调用 stop，运行终态应为 stopped。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_pre_stop",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="mock.input"),
                NodeInstanceSpec(node_id="n2", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="in"),
            ],
        )
        compiled = GraphBuilder(create_default_registry()).build(graph)
        scheduler = GraphScheduler()
        scheduler.stop()
        state = await scheduler.run(compiled, run_id="run_scheduler_pre_stop")
        assert state.status == "stopped"
        # 源节点（无必需输入）在 stop 后也不应执行
        assert state.node_states["n1"].status == "stopped"
        assert state.node_states["n2"].status == "stopped"

    asyncio.run(_run())


def test_scheduler_rejects_concurrent_run_calls() -> None:
    """同一个调度器不允许并发 run。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_concurrent",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="mock.input"),
                NodeInstanceSpec(
                    node_id="n2",
                    type_name="test.slow",
                    config={"delay_s": 0.3},
                ),
                NodeInstanceSpec(node_id="n3", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="text"),
                EdgeSpec(source_node="n2", source_port="text", target_node="n3", target_port="in"),
            ],
        )
        builder = _build_registry_with_custom_nodes()
        compiled = builder.build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())

        running_task = asyncio.create_task(scheduler.run(compiled, run_id="run_scheduler_concurrent"))
        await asyncio.sleep(0.05)
        with pytest.raises(RuntimeError):
            await scheduler.run(compiled, run_id="run_scheduler_concurrent_2")
        scheduler.stop()
        await running_task

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


def test_scheduler_emits_sync_frame_with_alignment_fields() -> None:
    """同步链路应发出带 stream_id/seq/play_at 的 sync 事件。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_sync_event",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="mock.input"),
                NodeInstanceSpec(node_id="n2", type_name="mock.tts"),
                NodeInstanceSpec(node_id="n3", type_name="mock.motion"),
                NodeInstanceSpec(node_id="n4", type_name="sync.timeline"),
                NodeInstanceSpec(node_id="n5", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="text"),
                EdgeSpec(source_node="n1", source_port="text", target_node="n3", target_port="text"),
                EdgeSpec(source_node="n2", source_port="audio", target_node="n4", target_port="audio"),
                EdgeSpec(source_node="n3", source_port="motion", target_node="n4", target_port="motion"),
                EdgeSpec(source_node="n4", source_port="sync", target_node="n5", target_port="in"),
            ],
        )
        compiled = GraphBuilder(create_default_registry()).build(graph)
        scheduler = GraphScheduler()
        state = await scheduler.run(compiled, run_id="run_scheduler_sync_event", stream_id="s_sync")
        assert state.status == "completed"
        assert state.node_states["n4"].metrics["sync_emitted"] >= 1

        events, _ = scheduler.get_events(since=0, limit=500)
        sync_events = [e for e in events if e.event_type == RuntimeEventType.SYNC_FRAME_EMITTED]
        assert len(sync_events) >= 1
        details = sync_events[0].details
        assert details["stream_id"] == "s_sync"
        assert details["seq"] == 0
        assert isinstance(details["play_at"], float)
        assert details["strategy"] == "clock_lock"

    asyncio.run(_run())


def test_scheduler_fails_on_sync_input_seq_mismatch() -> None:
    """sync.timeline 输入 seq 冲突时应失败。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_sync_mismatch",
            nodes=[
                NodeInstanceSpec(
                    node_id="n1",
                    type_name="test.meta_audio",
                    config={"stream_id": "s_sync", "seq": 1, "play_at": 0.1},
                ),
                NodeInstanceSpec(
                    node_id="n2",
                    type_name="test.meta_motion",
                    config={"stream_id": "s_sync", "seq": 2, "play_at": 0.1},
                ),
                NodeInstanceSpec(node_id="n3", type_name="sync.timeline"),
                NodeInstanceSpec(node_id="n4", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="audio", target_node="n3", target_port="audio"),
                EdgeSpec(source_node="n2", source_port="motion", target_node="n3", target_port="motion"),
                EdgeSpec(source_node="n3", source_port="sync", target_node="n4", target_port="in"),
            ],
        )
        builder = _build_registry_with_custom_nodes()
        compiled = builder.build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())
        state = await scheduler.run(compiled, run_id="run_scheduler_sync_mismatch")
        assert state.status == "failed"
        assert state.node_states["n3"].status == "failed"
        assert "seq" in (state.node_states["n3"].last_error or "")

    asyncio.run(_run())


def test_scheduler_fails_on_invalid_sync_seq_output() -> None:
    """同步输出 seq 非法时，调度器应失败并上报错误。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_invalid_sync_seq",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="test.bad_sync_output"),
                NodeInstanceSpec(node_id="n2", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="sync", target_node="n2", target_port="in"),
            ],
        )
        builder = _build_registry_with_custom_nodes()
        compiled = builder.build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())
        state = await scheduler.run(compiled, run_id="run_scheduler_invalid_sync_seq")
        assert state.status == "failed"
        assert state.node_states["n1"].status == "failed"
        assert "seq" in (state.node_states["n1"].last_error or "")

    asyncio.run(_run())


@pytest.mark.parametrize("bad_stream_id", [None, "   "], ids=["none", "whitespace"])
def test_scheduler_fails_on_invalid_sync_stream_id_output(bad_stream_id: Any) -> None:
    """同步输出 stream_id 非法时，调度器应失败并上报错误。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_invalid_sync_stream_id",
            nodes=[
                NodeInstanceSpec(
                    node_id="n1",
                    type_name="test.config_sync_output",
                    config={"stream_id": bad_stream_id, "seq": 0, "play_at": 0.1},
                ),
                NodeInstanceSpec(node_id="n2", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="sync", target_node="n2", target_port="in"),
            ],
        )
        builder = _build_registry_with_custom_nodes()
        compiled = builder.build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())
        state = await scheduler.run(compiled, run_id="run_scheduler_invalid_sync_stream_id")
        assert state.status == "failed"
        assert state.node_states["n1"].status == "failed"
        assert "stream_id" in (state.node_states["n1"].last_error or "")

    asyncio.run(_run())


@pytest.mark.parametrize("bad_seq", [1.9, True], ids=["float", "bool"])
def test_scheduler_fails_on_non_integral_sync_seq_output(bad_seq: Any) -> None:
    """同步输出 seq 不是有效整数时，调度器应失败。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_non_integral_sync_seq",
            nodes=[
                NodeInstanceSpec(
                    node_id="n1",
                    type_name="test.config_sync_output",
                    config={"stream_id": "stream_bad", "seq": bad_seq, "play_at": 0.1},
                ),
                NodeInstanceSpec(node_id="n2", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="sync", target_node="n2", target_port="in"),
            ],
        )
        builder = _build_registry_with_custom_nodes()
        compiled = builder.build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())
        state = await scheduler.run(compiled, run_id="run_scheduler_non_integral_sync_seq")
        assert state.status == "failed"
        assert state.node_states["n1"].status == "failed"
        assert "seq" in (state.node_states["n1"].last_error or "")

    asyncio.run(_run())


def test_scheduler_uses_run_stream_id_when_sync_payload_omits_stream_id() -> None:
    """同步输出缺失 stream_id 字段时，应回退到 run 级 stream_id。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_sync_stream_id_fallback",
            nodes=[
                NodeInstanceSpec(
                    node_id="n1",
                    type_name="test.config_sync_output",
                    config={"seq": 5, "play_at": 0.2},
                ),
                NodeInstanceSpec(node_id="n2", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="sync", target_node="n2", target_port="in"),
            ],
        )
        builder = _build_registry_with_custom_nodes()
        compiled = builder.build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())
        state = await scheduler.run(
            compiled,
            run_id="run_scheduler_sync_stream_id_fallback",
            stream_id="stream_run_fallback",
        )
        assert state.status == "completed"

        events, _ = scheduler.get_events(since=0, limit=100)
        sync_events = [e for e in events if e.event_type == RuntimeEventType.SYNC_FRAME_EMITTED]
        assert len(sync_events) >= 1
        assert sync_events[0].details["stream_id"] == "stream_run_fallback"
        assert sync_events[0].details["sync_key"] == "stream_run_fallback:5"

    asyncio.run(_run())


def test_scheduler_fails_on_missing_sync_play_at() -> None:
    """同步输出缺失 play_at 时应失败。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_missing_sync_play_at",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="test.no_play_at_sync_output"),
                NodeInstanceSpec(node_id="n2", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="sync", target_node="n2", target_port="in"),
            ],
        )
        builder = _build_registry_with_custom_nodes()
        compiled = builder.build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())
        state = await scheduler.run(compiled, run_id="run_scheduler_missing_sync_play_at")
        assert state.status == "failed"
        assert state.node_states["n1"].status == "failed"
        assert "play_at" in (state.node_states["n1"].last_error or "")

    asyncio.run(_run())


def test_scheduler_sync_key_none_falls_back_to_stream_seq() -> None:
    """sync_key 为空时应回退为 stream_id:seq。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_sync_key_fallback",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="test.none_sync_key_output"),
                NodeInstanceSpec(node_id="n2", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="sync", target_node="n2", target_port="in"),
            ],
        )
        builder = _build_registry_with_custom_nodes()
        compiled = builder.build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())
        state = await scheduler.run(compiled, run_id="run_scheduler_sync_key_fallback")
        assert state.status == "completed"

        events, _ = scheduler.get_events(since=0, limit=100)
        sync_events = [e for e in events if e.event_type == RuntimeEventType.SYNC_FRAME_EMITTED]
        assert len(sync_events) >= 1
        assert sync_events[0].details["sync_key"] == "stream_key:3"

    asyncio.run(_run())


def test_scheduler_fails_on_non_dict_sync_payload() -> None:
    """同步输出不是 dict 时应失败。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_non_dict_sync",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="test.non_dict_sync_output"),
                NodeInstanceSpec(node_id="n2", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="sync", target_node="n2", target_port="in"),
            ],
        )
        builder = _build_registry_with_custom_nodes()
        compiled = builder.build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())
        state = await scheduler.run(compiled, run_id="run_scheduler_non_dict_sync")
        assert state.status == "failed"
        assert state.node_states["n1"].status == "failed"
        assert "dict" in (state.node_states["n1"].last_error or "")

    asyncio.run(_run())
