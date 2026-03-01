"""GraphScheduler 运行测试。"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.core.errors import ErrorCode
from app.core.frame import RuntimeEventType
from app.core.graph_builder import GraphBuilder
from app.core.graph_runtime import GraphRuntimeState, RuntimeNodeState
from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext
from app.core.node_factory import NodeFactory, create_default_node_factory
from app.core.registry import create_default_registry
from app.core.scheduler import GraphScheduler, SchedulerConfig
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


def test_scheduler_runtime_metrics_collect_node_and_edge_stats() -> None:
    """运行结束后应产出图级聚合指标。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_runtime_metrics",
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
        state = await scheduler.run(compiled, run_id="run_scheduler_runtime_metrics")
        assert state.status == "completed"

        metrics = state.metrics
        assert metrics["event_total"] >= 1
        assert metrics["event_error"] == 0
        assert metrics["node_finished"] == 3
        assert metrics["node_failed"] == 0
        assert metrics["edge_forwarded_frames"] == 2
        assert metrics["edge_queue_peak_max"] >= 1

        edge_states = state.to_dict()["edge_states"]
        assert all("queue_peak_size" in edge for edge in edge_states)

    asyncio.run(_run())


def test_scheduler_events_have_structured_fields_and_monotonic_seq() -> None:
    """调度器事件应带结构化字段，且 event_seq 单调递增。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_event_seq",
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
        await scheduler.run(compiled, run_id="run_scheduler_event_seq")

        events, _ = scheduler.get_events(since=0, limit=200)
        assert len(events) >= 2
        seqs = [event.event_seq for event in events]
        assert seqs == list(range(len(events)))
        for event in events:
            assert event.event_id == f"run_scheduler_event_seq:{event.event_seq}"
            assert event.severity.value in {"info", "warning", "error", "debug", "critical"}
            assert event.component.value in {"scheduler", "node", "edge", "sync", "service", "api"}

    asyncio.run(_run())


def test_scheduler_event_seq_resets_between_runs() -> None:
    """同一调度器执行两次运行时，event_seq 应从 0 重新开始。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_event_reset",
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

        await scheduler.run(compiled, run_id="run_scheduler_reset_1")
        events1, _ = scheduler.get_events(since=0, limit=200)
        assert len(events1) >= 1
        assert events1[0].event_seq == 0

        await scheduler.run(compiled, run_id="run_scheduler_reset_2")
        events2, _ = scheduler.get_events(since=0, limit=200)
        assert len(events2) >= 1
        assert events2[0].event_seq == 0
        assert events2[0].event_id.startswith("run_scheduler_reset_2:")

    asyncio.run(_run())


def test_scheduler_get_events_filtered_supports_multi_conditions() -> None:
    """事件查询应支持多条件过滤，并保持游标语义稳定。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_event_filter",
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
        await scheduler.run(compiled, run_id="run_scheduler_event_filter")

        all_events, _ = scheduler.get_events(since=0, limit=300)
        assert len(all_events) >= 1

        failed_events, cursor_failed = scheduler.get_events_filtered(
            since=0,
            limit=10,
            event_type=RuntimeEventType.NODE_FAILED,
        )
        assert len(failed_events) == 1
        assert failed_events[0].error_code == "node.execution_failed"
        assert cursor_failed > 0

        filtered_node_error, _ = scheduler.get_events_filtered(
            since=0,
            limit=10,
            node_id="n2",
            severity="error",
            error_code="node.execution_failed",
        )
        assert len(filtered_node_error) == 1
        assert filtered_node_error[0].event_type == RuntimeEventType.NODE_FAILED

        # 过滤不到任何事件时，游标也应推进到扫描终点，保证增量读取可持续。
        empty_items, end_cursor = scheduler.get_events_filtered(
            since=0,
            limit=10,
            node_id="missing_node",
        )
        assert empty_items == []
        assert end_cursor == len(all_events)

        # 边缘场景：limit=0 不返回事件，游标保持不变。
        zero_items, zero_cursor = scheduler.get_events_filtered(
            since=2,
            limit=0,
            event_type=RuntimeEventType.NODE_FAILED,
        )
        assert zero_items == []
        assert zero_cursor == 2

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
        failed_events = [event for event in events if event.event_type == RuntimeEventType.NODE_FAILED]
        assert len(failed_events) == 1
        assert failed_events[0].severity.value == "error"
        assert failed_events[0].component.value == "node"
        assert failed_events[0].error_code == "node.execution_failed"

    asyncio.run(_run())


def test_scheduler_continue_on_error_allows_non_critical_node_failure() -> None:
    """非关键节点配置 continue_on_error 时，运行应继续并完成。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_continue_on_error",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="mock.input"),
                NodeInstanceSpec(
                    node_id="n2",
                    type_name="test.fail",
                    config={"continue_on_error": True},
                ),
                NodeInstanceSpec(node_id="n3", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="text"),
                EdgeSpec(source_node="n1", source_port="text", target_node="n3", target_port="in"),
            ],
        )
        builder = _build_registry_with_custom_nodes()
        compiled = builder.build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())
        state = await scheduler.run(compiled, run_id="run_scheduler_continue_on_error")

        assert state.status == "completed"
        assert state.node_states["n2"].status == "failed"
        assert state.node_states["n2"].metrics["continued_on_error"] is True
        assert state.node_states["n3"].status == "finished"

    asyncio.run(_run())


def test_scheduler_string_false_flags_keep_fail_fast_behavior() -> None:
    """布尔字符串 false 不应被误判为 True。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_string_bool_false",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="mock.input"),
                NodeInstanceSpec(
                    node_id="n2",
                    type_name="test.fail",
                    config={"continue_on_error": "false"},
                ),
                NodeInstanceSpec(node_id="n3", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="text"),
                EdgeSpec(source_node="n1", source_port="text", target_node="n3", target_port="in"),
            ],
        )
        builder = _build_registry_with_custom_nodes()
        compiled = builder.build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())
        state = await scheduler.run(compiled, run_id="run_scheduler_string_bool_false")

        assert state.status == "failed"
        assert state.node_states["n2"].status == "failed"
        assert "continued_on_error" not in state.node_states["n2"].metrics

    asyncio.run(_run())


def test_scheduler_continue_on_error_failure_wakes_downstream_waiters() -> None:
    """continue_on_error 失败节点应唤醒下游，避免等待必需输入时挂起。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_continue_on_error_wakeup",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="mock.input"),
                NodeInstanceSpec(
                    node_id="n2",
                    type_name="test.fail",
                    config={"continue_on_error": True},
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

        state = await asyncio.wait_for(
            scheduler.run(compiled, run_id="run_scheduler_continue_on_error_wakeup"),
            timeout=1.0,
        )
        assert state.status == "failed"
        assert state.node_states["n2"].status == "failed"
        assert state.node_states["n2"].metrics["continued_on_error"] is True
        assert state.node_states["n3"].status == "failed"
        assert "必需输入已不可达" in (state.node_states["n3"].last_error or "")
        assert state.node_states["n3"].metrics["last_error_code"] == ErrorCode.NODE_INPUT_UNAVAILABLE.value
        assert state.node_states["n3"].metrics["last_error_retryable"] is False

        events, _ = scheduler.get_events(since=0, limit=200)
        failed_events = [
            event
            for event in events
            if event.event_type == RuntimeEventType.NODE_FAILED and event.node_id == "n3"
        ]
        assert len(failed_events) == 1
        assert failed_events[0].error_code == ErrorCode.NODE_INPUT_UNAVAILABLE.value

    asyncio.run(_run())


def test_required_inputs_unavailable_detects_any_unreachable_missing_port() -> None:
    """任一缺失必需端口不可达时，应立即判定输入不可达。"""

    graph = GraphSpec(
        graph_id="g_scheduler_required_inputs_unavailable_any",
        nodes=[
            NodeInstanceSpec(node_id="n1", type_name="test.meta_audio"),
            NodeInstanceSpec(node_id="n2", type_name="test.meta_motion"),
            NodeInstanceSpec(node_id="n3", type_name="sync.timeline"),
        ],
        edges=[
            EdgeSpec(source_node="n1", source_port="audio", target_node="n3", target_port="audio"),
            EdgeSpec(source_node="n2", source_port="motion", target_node="n3", target_port="motion"),
        ],
    )
    compiled = _build_registry_with_custom_nodes().build(graph)
    scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())
    scheduler._compiled_graph = compiled
    scheduler.runtime_state = GraphRuntimeState(
        run_id="run_required_inputs_unavailable_any",
        graph_id=graph.graph_id,
        status="running",
        node_states={
            "n1": RuntimeNodeState(node_id="n1", status="failed"),
            "n2": RuntimeNodeState(node_id="n2", status="running"),
            "n3": RuntimeNodeState(node_id="n3", status="idle"),
        },
    )
    scheduler._node_inputs = {"n3": {}}

    assert scheduler._required_inputs_unavailable("n3", {"audio", "motion"}) is True


def test_scheduler_critical_node_ignores_continue_on_error_and_fails_fast() -> None:
    """关键节点即使配置 continue_on_error，也应保持 fail-fast。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_critical_fail_fast",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="mock.input"),
                NodeInstanceSpec(
                    node_id="n2",
                    type_name="test.fail",
                    config={"continue_on_error": True, "critical": True},
                ),
                NodeInstanceSpec(node_id="n3", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="text"),
                EdgeSpec(source_node="n1", source_port="text", target_node="n3", target_port="in"),
            ],
        )
        builder = _build_registry_with_custom_nodes()
        compiled = builder.build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())
        state = await scheduler.run(compiled, run_id="run_scheduler_critical_fail_fast")

        assert state.status == "failed"
        assert state.node_states["n2"].status == "failed"
        assert "continued_on_error" not in state.node_states["n2"].metrics

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


def test_scheduler_event_retention_window_and_cursor_clamp() -> None:
    """启用事件保留上限时，应裁剪旧事件并保持游标单调。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_event_retention",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="mock.input"),
                NodeInstanceSpec(node_id="n2", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="in"),
            ],
        )
        compiled = GraphBuilder(create_default_registry()).build(graph)
        scheduler = GraphScheduler(config=SchedulerConfig(max_retained_events=3))
        state = await scheduler.run(compiled, run_id="run_scheduler_event_retention")
        assert state.status == "completed"

        # since=0 会被钳制到当前保留窗口起点。
        retained_events, next_cursor = scheduler.get_events(since=0, limit=20)
        assert len(retained_events) == 3
        assert next_cursor > len(retained_events)
        assert retained_events[-1].event_type == RuntimeEventType.RUN_STOPPED
        assert [item.event_seq for item in retained_events] == sorted(
            item.event_seq for item in retained_events
        )

        # 旧游标被钳制后也应继续可分页读取，不倒退。
        stale_page, stale_cursor = scheduler.get_events(since=1, limit=1)
        assert len(stale_page) == 1
        assert stale_cursor >= 1

        metrics = state.metrics
        assert metrics["event_total"] > metrics["event_retained"]
        assert metrics["event_retained"] == 3
        assert metrics["event_dropped"] >= 1
        assert 0.0 <= float(metrics["event_drop_ratio"]) <= 1.0
        assert 0.0 <= float(metrics["event_retention_ratio"]) <= 1.0

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
        assert sync_events[0].edge_key == "n4.sync->n5.in"
        assert sync_events[0].component.value in {"edge", "sync"}

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
