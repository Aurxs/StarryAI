"""调度器超时与重试测试（T5）。"""

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
from app.core.spec import EdgeSpec, GraphSpec, NodeInstanceSpec, NodeMode, NodeSpec, PortSpec


class RetryFlakyNode(AsyncNode):
    """前 N 次失败，之后成功。"""

    def __init__(
            self,
            node_id: str,
            spec: NodeSpec,
            config: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(node_id=node_id, spec=spec, config=config)
        self._attempt = 0

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context
        self._attempt += 1
        fail_times = int(self.config.get("fail_times", 0))
        if self._attempt <= fail_times:
            raise RuntimeError(f"transient error attempt={self._attempt}")
        return {"text": str(inputs.get("text", ""))}


class SlowNode(AsyncNode):
    """用于超时测试的慢节点。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context
        await asyncio.sleep(float(self.config.get("delay_s", 0.1)))
        return {"text": str(inputs.get("text", ""))}


class NonRetryableNode(AsyncNode):
    """抛出不可重试异常的节点。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = inputs
        _ = context
        raise ValueError("non-retryable value error")


class MutatingRetryNode(AsyncNode):
    """首轮修改入参后失败，后续轮次要求仍能读取原始输入。"""

    def __init__(
            self,
            node_id: str,
            spec: NodeSpec,
            config: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(node_id=node_id, spec=spec, config=config)
        self._attempt = 0

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context
        self._attempt += 1
        if self._attempt == 1:
            inputs.pop("text", None)
            raise RuntimeError("mutate then retry")

        if "text" not in inputs:
            raise RuntimeError("missing text after retry")
        return {"text": str(inputs["text"])}


def _build_registry() -> GraphBuilder:
    registry = create_default_registry()
    for type_name in [
        "test.retry_flaky",
        "test.slow",
        "test.non_retryable",
        "test.mutating_retry",
    ]:
        registry.register(
            NodeSpec(
                type_name=type_name,
                mode=NodeMode.ASYNC,
                inputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
                outputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
                description=f"{type_name} node",
            )
        )
    return GraphBuilder(registry)


def _build_factory() -> NodeFactory:
    factory = create_default_node_factory()
    factory.register("test.retry_flaky", RetryFlakyNode)
    factory.register("test.slow", SlowNode)
    factory.register("test.non_retryable", NonRetryableNode)
    factory.register("test.mutating_retry", MutatingRetryNode)
    return factory


def _chain_graph(middle_type: str, middle_config: dict[str, Any], graph_id: str) -> GraphSpec:
    return GraphSpec(
        graph_id=graph_id,
        nodes=[
            NodeInstanceSpec(node_id="n1", type_name="mock.input"),
            NodeInstanceSpec(node_id="n2", type_name=middle_type, config=middle_config),
            NodeInstanceSpec(node_id="n3", type_name="mock.output"),
        ],
        edges=[
            EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="text"),
            EdgeSpec(source_node="n2", source_port="text", target_node="n3", target_port="in"),
        ],
    )


def test_scheduler_retries_and_eventually_succeeds() -> None:
    async def _run() -> None:
        graph = _chain_graph(
            "test.retry_flaky",
            {"fail_times": 1, "max_retries": 2, "retry_backoff_ms": 1},
            "g_retry_success",
        )
        compiled = _build_registry().build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory())
        state = await scheduler.run(compiled, run_id="run_retry_success")
        assert state.status == "completed"
        assert state.node_states["n2"].metrics["retry_count"] == 1
        assert state.node_states["n2"].metrics["attempt_count"] == 2

        events, _ = scheduler.get_events(since=0, limit=300)
        retry_events = [event for event in events if event.event_type == RuntimeEventType.NODE_RETRY]
        assert len(retry_events) == 1
        assert retry_events[0].attempt == 2

    asyncio.run(_run())


def test_scheduler_marks_failed_when_retry_exhausted() -> None:
    async def _run() -> None:
        graph = _chain_graph(
            "test.retry_flaky",
            {"fail_times": 9, "max_retries": 2, "retry_backoff_ms": 1},
            "g_retry_exhausted",
        )
        compiled = _build_registry().build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory())
        state = await scheduler.run(compiled, run_id="run_retry_exhausted")
        assert state.status == "failed"
        assert state.node_states["n2"].status == "failed"
        assert state.node_states["n2"].metrics["retry_count"] == 2
        assert state.node_states["n2"].metrics["attempt_count"] == 3
        assert state.node_states["n2"].metrics["last_error_code"] == "node.retry_exhausted"

        events, _ = scheduler.get_events(since=0, limit=300)
        retry_events = [event for event in events if event.event_type == RuntimeEventType.NODE_RETRY]
        assert len(retry_events) == 2
        failed_events = [event for event in events if event.event_type == RuntimeEventType.NODE_FAILED]
        assert len(failed_events) == 1
        assert failed_events[0].error_code == "node.retry_exhausted"

    asyncio.run(_run())


def test_scheduler_timeout_boundary_reports_timeout_event() -> None:
    async def _run() -> None:
        graph = _chain_graph(
            "test.slow",
            {"delay_s": 0.05, "timeout_s": 0.01, "max_retries": 0},
            "g_timeout_boundary",
        )
        compiled = _build_registry().build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory())
        state = await scheduler.run(compiled, run_id="run_timeout_boundary")
        assert state.status == "failed"
        assert state.node_states["n2"].metrics["timeout_count"] == 1
        assert state.node_states["n2"].metrics["last_error_code"] == "node.timeout"
        assert state.node_states["n2"].metrics["last_error_retryable"] is True

        events, _ = scheduler.get_events(since=0, limit=300)
        timeout_events = [event for event in events if event.event_type == RuntimeEventType.NODE_TIMEOUT]
        assert len(timeout_events) == 1
        assert timeout_events[0].error_code == "node.timeout"

    asyncio.run(_run())


def test_scheduler_timeout_retry_exhausted_after_retries() -> None:
    async def _run() -> None:
        graph = _chain_graph(
            "test.slow",
            {"delay_s": 0.05, "timeout_s": 0.01, "max_retries": 2, "retry_backoff_ms": 1},
            "g_timeout_retry_exhausted",
        )
        compiled = _build_registry().build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory())
        state = await scheduler.run(compiled, run_id="run_timeout_retry_exhausted")
        assert state.status == "failed"
        assert state.node_states["n2"].metrics["timeout_count"] == 3
        assert state.node_states["n2"].metrics["attempt_count"] == 3
        assert state.node_states["n2"].metrics["retry_count"] == 2
        assert state.node_states["n2"].metrics["last_error_code"] == "node.retry_exhausted"
        assert state.node_states["n2"].metrics["last_error_retryable"] is False

        events, _ = scheduler.get_events(since=0, limit=300)
        timeout_events = [event for event in events if event.event_type == RuntimeEventType.NODE_TIMEOUT]
        retry_events = [event for event in events if event.event_type == RuntimeEventType.NODE_RETRY]
        assert len(timeout_events) == 3
        assert len(retry_events) == 2
        failed_events = [event for event in events if event.event_type == RuntimeEventType.NODE_FAILED]
        assert len(failed_events) == 1
        assert failed_events[0].error_code == "node.retry_exhausted"

    asyncio.run(_run())


def test_scheduler_does_not_retry_non_retryable_exception() -> None:
    async def _run() -> None:
        graph = _chain_graph(
            "test.non_retryable",
            {"max_retries": 5, "retry_backoff_ms": 1},
            "g_non_retryable",
        )
        compiled = _build_registry().build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory())
        state = await scheduler.run(compiled, run_id="run_non_retryable")
        assert state.status == "failed"
        assert state.node_states["n2"].metrics["retry_count"] == 0
        assert state.node_states["n2"].metrics["attempt_count"] == 1
        assert state.node_states["n2"].metrics["last_error_code"] == "node.execution_failed"
        assert state.node_states["n2"].metrics["last_error_retryable"] is False

        events, _ = scheduler.get_events(since=0, limit=300)
        retry_events = [event for event in events if event.event_type == RuntimeEventType.NODE_RETRY]
        assert retry_events == []

    asyncio.run(_run())


def test_scheduler_retries_with_fresh_inputs_snapshot() -> None:
    """重试时应使用原始输入快照，避免首轮入参污染影响后续轮次。"""

    async def _run() -> None:
        graph = _chain_graph(
            "test.mutating_retry",
            {"max_retries": 1, "retry_backoff_ms": 0},
            "g_retry_fresh_inputs",
        )
        compiled = _build_registry().build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory())
        state = await scheduler.run(compiled, run_id="run_retry_fresh_inputs")
        assert state.status == "completed"
        assert state.node_states["n2"].metrics["attempt_count"] == 2
        assert state.node_states["n2"].metrics["retry_count"] == 1

    asyncio.run(_run())
