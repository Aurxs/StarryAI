"""图调度器（Phase B 最小可运行实现）。

设计目标（当前版本）：
1. 以最小闭环跑通 DAG 节点执行。
2. 使用“节点任务 + 边任务 + 队列”完成路由。
3. 通过运行态状态与事件列表支撑 API/WS 观测。
"""

from __future__ import annotations

import asyncio
import math
import time
import uuid
from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from .errors import (
    ErrorCode,
    NodeTimeoutError,
    RuntimeNodeError,
    classify_exception,
    is_retryable_exception,
)
from .frame import (
    Frame,
    FrameType,
    RuntimeEvent,
    RuntimeEventComponent,
    RuntimeEventSeverity,
    RuntimeEventType,
)
from .graph_builder import CompiledGraph
from .graph_runtime import GraphRuntimeState, RuntimeEdgeState, RuntimeNodeState
from .node_base import BaseNode, NodeContext
from .node_factory import NodeFactory, create_default_node_factory
from .spec import EdgeSpec, NodeMode

# 边唯一键：(source_node, source_port, target_node, target_port)
# 用于在字典中索引“某条具体边”的队列与运行态。
EdgeKey = tuple[str, str, str, str]


@dataclass(slots=True)
class SchedulerConfig:
    """调度器配置。"""

    # 同一时刻允许执行 node.process 的最大节点数量。
    max_parallel_nodes: int = 16
    # 边队列默认上限；0 表示无界队列。
    default_edge_queue_maxsize: int = 0
    # 边队列轮询间隔（秒），用于 stop 后快速从等待中退出。
    queue_poll_timeout_s: float = 0.05
    # 内存中保留的最大事件条数；<=0 表示不裁剪。
    max_retained_events: int = 5000


@dataclass(slots=True)
class NodeExecutionPolicy:
    """节点执行策略（来自实例配置）。"""

    timeout_s: float | None = None
    max_retries: int = 0
    retry_backoff_ms: int = 0
    continue_on_error: bool = False
    critical: bool = False


class GraphScheduler:
    """单运行实例图调度器。"""

    def __init__(
            self,
            config: SchedulerConfig | None = None,
            *,
            node_factory: NodeFactory | None = None,
    ) -> None:
        # config: 本次调度器实例的行为配置。
        self.config = config or SchedulerConfig()
        # node_factory: 按节点 type_name 生成运行时节点对象。
        self.node_factory = node_factory or create_default_node_factory()

        # runtime_state: 当前 run 的状态快照（对外观测核心对象）。
        self.runtime_state: GraphRuntimeState | None = None

        # _compiled_graph: 当前运行所依赖的编译图（拓扑/边索引均在其中）。
        self._compiled_graph: CompiledGraph | None = None
        # _run_id: 当前运行实例 ID。
        self._run_id: str | None = None
        # _stream_id: 业务流 ID（同步帧、上下文 metadata 会用到）。
        self._stream_id: str = "stream_default"

        # _events: 运行期间积累的结构化事件列表。
        self._events: list[RuntimeEvent] = []
        # _events_cursor_base: 当前 _events[0] 对应的全局游标偏移。
        self._events_cursor_base = 0
        # _event_seq: 运行内事件单调序号（用于稳定排序与定位）。
        self._event_seq = 0
        # _stop_event: 全局停止信号；节点与边任务都依赖它判断退出。
        self._stop_event = asyncio.Event()
        # _finished_event: 运行进入终态（completed/stopped/failed）后置位。
        self._finished_event = asyncio.Event()
        # _stop_requested: 记录“run 前 stop”这一边界场景的标记位。
        self._stop_requested = False
        # _parallel_semaphore: 限制并发执行 node.process 的令牌。
        self._parallel_semaphore = asyncio.Semaphore(self.config.max_parallel_nodes)

        # _node_tasks: 每个节点对应一个异步任务。
        self._node_tasks: list[asyncio.Task[None]] = []
        # _edge_tasks: 每条边对应一个异步任务。
        self._edge_tasks: list[asyncio.Task[None]] = []

        # _edge_queues: 边 -> 队列。节点输出先入队，由边任务转发到下游输入缓存。
        self._edge_queues: dict[EdgeKey, asyncio.Queue[Frame]] = {}
        # _edge_state_map: 边 -> 运行态边状态（queue_size、forwarded_frames）。
        self._edge_state_map: dict[EdgeKey, RuntimeEdgeState] = {}

        # _node_inputs: 节点 -> 当前输入端口缓存（target_port -> value）。
        self._node_inputs: dict[str, dict[str, Any]] = {}
        # _node_input_events: 节点 -> 输入到达事件，用于唤醒等待输入的节点任务。
        self._node_input_events: dict[str, asyncio.Event] = {}
        # _node_policies: 节点 -> 执行策略（超时、重试、错误传播）。
        self._node_policies: dict[str, NodeExecutionPolicy] = {}

        # _failed: 运行是否已经进入失败路径（用于最终态决策）。
        self._failed = False

    @property
    def run_id(self) -> str | None:
        """返回当前运行 ID。"""
        return self._run_id

    @property
    def status(self) -> str:
        """返回当前运行状态。"""
        if self.runtime_state is None:
            return "idle"
        return self.runtime_state.status

    def is_finished(self) -> bool:
        """是否处于终态。"""
        return self._finished_event.is_set()

    def stop(self) -> None:
        """请求停止当前运行。"""
        # 1) 标记 stop 请求（兼容“run 之前先 stop”场景）。
        self._stop_requested = True
        # 2) 广播停止信号，所有任务可见。
        self._stop_event.set()
        # 3) 唤醒所有可能在等待输入事件的节点任务，避免卡死等待。
        for event in self._node_input_events.values():
            event.set()
        # 4) 主动取消仍在运行的节点任务，加速 stop 收敛。
        for task in self._node_tasks:
            if not task.done():
                task.cancel()

    def get_events(self, *, since: int = 0, limit: int = 200) -> tuple[list[RuntimeEvent], int]:
        """获取内存中的运行事件。"""
        return self.get_events_filtered(since=since, limit=limit)

    def get_events_filtered(
            self,
            *,
            since: int = 0,
            limit: int = 200,
            event_type: RuntimeEventType | str | None = None,
            node_id: str | None = None,
            severity: RuntimeEventSeverity | str | None = None,
            error_code: str | None = None,
    ) -> tuple[list[RuntimeEvent], int]:
        """按过滤条件获取内存事件。

        游标语义：
        - `since` 与返回的 `next_cursor` 均基于“完整事件序列”的索引。
        - 即使过滤后命中条目较少，游标也会持续向后推进，保证增量读取稳定。
        """
        cursor = max(since, 0)
        fetch_limit = max(limit, 0)

        if fetch_limit == 0:
            return [], cursor

        # 事件裁剪后，_events 仅保留窗口内内容；游标基于全局序号偏移计算。
        earliest_cursor = self._events_cursor_base
        latest_cursor = self._events_cursor_base + len(self._events)
        if cursor < earliest_cursor:
            cursor = earliest_cursor
        if cursor >= latest_cursor:
            return [], cursor

        normalized_node_id = (node_id or "").strip() or None
        normalized_error_code = (error_code or "").strip() or None
        local_index = cursor - self._events_cursor_base
        items: list[RuntimeEvent] = []
        while local_index < len(self._events) and len(items) < fetch_limit:
            event = self._events[local_index]
            local_index += 1
            cursor += 1
            if not self._event_matches_filters(
                    event,
                    event_type=event_type,
                    node_id=normalized_node_id,
                    severity=severity,
                    error_code=normalized_error_code,
            ):
                continue
            items.append(event)
        return items, cursor

    async def run(
            self,
            compiled_graph: CompiledGraph,
            *,
            run_id: str | None = None,
            stream_id: str = "stream_default",
    ) -> GraphRuntimeState:
        """运行编译后的图。"""
        if self.runtime_state and self.runtime_state.status == "running":
            raise RuntimeError("当前调度器已有运行进行中")

        self._compiled_graph = compiled_graph
        self._run_id = run_id or f"run_{uuid.uuid4().hex[:12]}"
        self._stream_id = self._normalize_stream_id(stream_id)

        self._events.clear()
        self._events_cursor_base = 0
        self._event_seq = 0
        # stop_requested_before_run: 记录 run 入口前是否已经收到 stop 请求。
        stop_requested_before_run = self._stop_requested
        self._stop_requested = False
        self._stop_event = asyncio.Event()
        if stop_requested_before_run:
            self._stop_event.set()
        self._finished_event = asyncio.Event()
        self._failed = False
        self._node_tasks.clear()
        self._edge_tasks.clear()
        self._edge_queues.clear()
        self._edge_state_map.clear()
        self._node_inputs.clear()
        self._node_input_events.clear()
        self._node_policies.clear()

        self.runtime_state = GraphRuntimeState(
            run_id=self._run_id,
            graph_id=compiled_graph.graph.graph_id,
            status="running",
            started_at=time.time(),
            metrics=self._initial_runtime_metrics(),
            node_states={
                node_id: RuntimeNodeState(node_id=node_id) for node_id in compiled_graph.node_specs
            },
            edge_states=[],
        )

        self._emit_event(
            RuntimeEventType.RUN_STARTED,
            message="Run started",
            details={"graph_id": compiled_graph.graph.graph_id, "stream_id": self._stream_id},
        )

        try:
            # nodes: node_id -> 运行时节点实例。
            nodes = self._instantiate_nodes(compiled_graph)
            self._setup_input_buffers(compiled_graph)
            self._setup_edge_queues(compiled_graph)

            # 为每条边启动一个转发任务：队列消费 -> 写入目标节点输入缓存。
            self._edge_tasks = [
                asyncio.create_task(self._edge_worker(edge), name=f"edge:{self._edge_key(edge)}")
                for edge in compiled_graph.graph.edges
            ]

            # 为每个节点启动一个执行任务：输入齐备 -> process -> 路由输出。
            # 拓扑序用于稳定行为，但任务是并发执行的。
            self._node_tasks = [
                asyncio.create_task(self._node_worker(node_id, nodes[node_id]), name=f"node:{node_id}")
                for node_id in compiled_graph.topo_order
            ]

            # node_results: gather 的逐任务返回结果；异常会以对象形式返回而不是抛出。
            node_results = await asyncio.gather(*self._node_tasks, return_exceptions=True)
            # result: 单个节点任务结果，可能是 None 或 Exception。
            for result in node_results:
                if isinstance(result, Exception) and not isinstance(result, asyncio.CancelledError):
                    self._fail_run(f"节点任务异常: {result}")

            if self.runtime_state.status == "running":
                if self._failed:
                    self.runtime_state.status = "failed"
                elif self._stop_event.is_set():
                    self.runtime_state.status = "stopped"
                else:
                    self.runtime_state.status = "completed"
        except asyncio.CancelledError:
            if self.runtime_state is not None and self.runtime_state.status == "running":
                self.runtime_state.status = "stopped"
            raise
        finally:
            # 统一收尾：置 stop、唤醒等待、回收边任务、记录终止事件。
            self._stop_event.set()
            self._stop_requested = False
            for event in self._node_input_events.values():
                event.set()

            await self._shutdown_edge_tasks()

            if self.runtime_state is not None:
                self.runtime_state.ended_at = time.time()
            self._emit_event(
                RuntimeEventType.RUN_STOPPED,
                message="Run finished",
                details={"final_status": self.status},
            )
            self._finalize_runtime_metrics()
            self._finished_event.set()

        return self.runtime_state

    def _instantiate_nodes(self, compiled_graph: CompiledGraph) -> dict[str, BaseNode]:
        """根据节点规格实例化运行时节点。"""
        # node_instances: 图定义里的节点实例索引（node_id -> NodeInstanceSpec）。
        node_instances = {node.node_id: node for node in compiled_graph.graph.nodes}
        # nodes: 本次运行真实执行对象（node_id -> BaseNode）。
        nodes: dict[str, BaseNode] = {}
        for node_id, spec in compiled_graph.node_specs.items():
            # node_def: 当前 node_id 对应的实例配置（含 config/title 等）。
            node_def = node_instances[node_id]
            nodes[node_id] = self.node_factory.create(node=node_def, spec=spec)
            self._node_policies[node_id] = self._build_node_policy(node_def.config)
        return nodes

    def _setup_input_buffers(self, compiled_graph: CompiledGraph) -> None:
        """初始化节点输入缓存。"""
        for node_id in compiled_graph.node_specs:
            # 每个节点先给一个空输入缓存。
            self._node_inputs[node_id] = {}
            # 每个节点一个输入事件；边任务写入输入后会 set 它。
            self._node_input_events[node_id] = asyncio.Event()

    def _setup_edge_queues(self, compiled_graph: CompiledGraph) -> None:
        """初始化边队列与边状态。"""
        assert self.runtime_state is not None
        self.runtime_state.edge_states.clear()

        for edge in compiled_graph.graph.edges:
            # edge_key: 当前边在内部字典中的唯一索引键。
            edge_key = self._edge_key(edge)
            # queue_maxsize: 优先使用边自身配置，否则回退到调度器默认值。
            queue_maxsize = (
                edge.queue_maxsize
                if edge.queue_maxsize > 0
                else self.config.default_edge_queue_maxsize
            )
            self._edge_queues[edge_key] = asyncio.Queue(maxsize=queue_maxsize)

            # edge_state: 对外可见的边运行态（队列长度/转发计数）。
            edge_state = RuntimeEdgeState(
                source_node=edge.source_node,
                source_port=edge.source_port,
                target_node=edge.target_node,
                target_port=edge.target_port,
            )
            self._edge_state_map[edge_key] = edge_state
            self.runtime_state.edge_states.append(edge_state)

    def _notify_downstream_waiters(self, source_node_id: str) -> None:
        """唤醒 source_node 直接下游节点，让其重新评估输入可达性。"""
        assert self._compiled_graph is not None
        for edge in self._compiled_graph.outgoing_edges.get(source_node_id, []):
            event = self._node_input_events.get(edge.target_node)
            if event is not None:
                event.set()

    async def _node_worker(self, node_id: str, node: BaseNode) -> None:
        """单节点执行任务。"""
        assert self._compiled_graph is not None
        assert self.runtime_state is not None
        assert self._run_id is not None

        # node_state: 当前节点可观测运行态对象（会持续更新）。
        node_state = self.runtime_state.node_states[node_id]
        # spec: 当前节点类型规格（输入输出端口、模式等）。
        spec = self._compiled_graph.node_specs[node_id]
        policy = self._node_policies.get(node_id, NodeExecutionPolicy())
        # required_ports: 当前节点必须满足的输入端口集合。
        required_ports = {port.name for port in spec.inputs if port.required}

        try:
            while not self._stop_event.is_set():
                # current_inputs: 当前已收到的输入缓存快照引用。
                current_inputs = self._node_inputs[node_id]
                if required_ports.issubset(current_inputs):
                    break
                if self._required_inputs_unavailable(node_id, required_ports):
                    message = f"节点 {node_id} 必需输入已不可达"
                    node_state.status = "failed"
                    node_state.finished_at = time.time()
                    node_state.last_error = message
                    node_state.metrics["failed_count"] = int(
                        node_state.metrics.get("failed_count", 0)
                    ) + 1
                    node_state.metrics["last_error_code"] = ErrorCode.NODE_INPUT_UNAVAILABLE.value
                    node_state.metrics["last_error_retryable"] = False
                    self._emit_event(
                        RuntimeEventType.NODE_FAILED,
                        node_id=node_id,
                        message=message,
                        severity=RuntimeEventSeverity.ERROR,
                        component=RuntimeEventComponent.NODE,
                        error_code=ErrorCode.NODE_INPUT_UNAVAILABLE.value,
                        details={"required_ports": sorted(required_ports)},
                    )
                    if policy.continue_on_error and not policy.critical:
                        node_state.metrics["continued_on_error"] = True
                        self._notify_downstream_waiters(node_id)
                        return
                    self._fail_run(message)
                    self.stop()
                    return

                # event: 当前节点的输入到达事件；等待下游边任务唤醒。
                event = self._node_input_events[node_id]
                await event.wait()
                event.clear()

            if self._stop_event.is_set():
                node_state.status = "stopped"
                return

            node_state.status = "running"
            node_state.started_at = time.time()
            self._emit_event(
                RuntimeEventType.NODE_STARTED,
                node_id=node_id,
                message="Node started",
                component=RuntimeEventComponent.NODE,
            )

            # context: 传给节点 process 的运行上下文。
            context = NodeContext(
                run_id=self._run_id,
                node_id=node_id,
                metadata={
                    "stream_id": self._stream_id,
                    "seq": 0,
                    "graph_id": self.runtime_state.graph_id,
                    "node_mode": spec.mode.value,
                },
            )
            # inputs: 传入节点 process 的输入副本，避免节点修改共享缓存。
            inputs = dict(self._node_inputs[node_id])
            # outputs: 节点 process 返回的输出端口数据映射。
            outputs = await self._execute_node_with_policy(
                node_id=node_id,
                node=node,
                inputs=inputs,
                context=context,
                node_state=node_state,
                policy=policy,
            )

            if not isinstance(outputs, dict):
                raise TypeError(f"节点 {node_id} 输出必须是 dict，实际: {type(outputs)}")

            # 同步节点可通过保留键上报额外指标，不参与端口路由。
            node_metrics = outputs.pop("__node_metrics", None)
            if isinstance(node_metrics, dict):
                node_state.metrics.update(node_metrics)

            if self._stop_event.is_set():
                node_state.status = "stopped"
                return

            await self._route_outputs(node_id=node_id, outputs=outputs, mode=spec.mode)

            node_state.status = "finished"
            node_state.finished_at = time.time()
            node_state.metrics["processed_count"] = node_state.metrics.get("processed_count", 0) + 1
            if node_state.started_at is not None:
                node_state.metrics["duration_ms"] = int(
                    (node_state.finished_at - node_state.started_at) * 1000
                )

            self._emit_event(
                RuntimeEventType.NODE_FINISHED,
                node_id=node_id,
                message="Node finished",
                component=RuntimeEventComponent.NODE,
            )
            if node_state.started_at is not None and node_state.finished_at is not None:
                elapsed_s = max(node_state.finished_at - node_state.started_at, 0.0)
                if elapsed_s > 0:
                    node_state.metrics["throughput_fps"] = round(
                        float(node_state.metrics.get("processed_count", 0)) / elapsed_s, 3
                    )

            if self.runtime_state is not None:
                self.runtime_state.metrics["node_finished"] = (
                        int(self.runtime_state.metrics.get("node_finished", 0)) + 1
                )
        except asyncio.CancelledError:
            node_state.status = "stopped"
            node_state.finished_at = time.time()
            raise
        except Exception as exc:  # noqa: BLE001 - 调度器需要兜底捕获节点错误
            error_code, retryable = classify_exception(exc)
            node_state.status = "failed"
            node_state.finished_at = time.time()
            node_state.last_error = str(exc)
            node_state.metrics["failed_count"] = int(node_state.metrics.get("failed_count", 0)) + 1
            node_state.metrics["last_error_code"] = error_code.value
            node_state.metrics["last_error_retryable"] = retryable
            self._emit_event(
                RuntimeEventType.NODE_FAILED,
                node_id=node_id,
                message=f"Node failed: {exc}",
                severity=RuntimeEventSeverity.ERROR,
                component=RuntimeEventComponent.NODE,
                error_code=error_code.value,
                details={"error": str(exc), "retryable": retryable},
            )
            if self.runtime_state is not None:
                self.runtime_state.metrics["node_failed"] = (
                        int(self.runtime_state.metrics.get("node_failed", 0)) + 1
                )
            if policy.continue_on_error and not policy.critical:
                node_state.metrics["continued_on_error"] = True
                self._notify_downstream_waiters(node_id)
                return
            self._fail_run(f"节点 {node_id} 执行失败: {exc}")
            self.stop()

    async def _route_outputs(self, node_id: str, outputs: dict[str, Any], mode: NodeMode) -> None:
        """将节点输出按边路由到下游队列。"""
        assert self._compiled_graph is not None
        assert self._run_id is not None

        for edge in self._compiled_graph.outgoing_edges.get(node_id, []):
            if edge.source_port not in outputs:
                raise RuntimeError(f"节点 {node_id} 未输出已连接端口 {edge.source_port} 的数据")

            # edge_key: 当前出边唯一键。
            edge_key = self._edge_key(edge)
            # queue: 当前边对应的帧队列。
            queue = self._edge_queues[edge_key]
            # edge_state: 当前边可观测运行态。
            edge_state = self._edge_state_map[edge_key]

            # payload_value: 本条边要发送给下游端口的业务值。
            payload_value = outputs[edge.source_port]
            # frame_type: 根据节点模式决定发 data 帧还是 sync 帧。
            frame_type = FrameType.SYNC if mode == NodeMode.SYNC else FrameType.DATA
            frame_stream_id = self._stream_id
            frame_seq = 0
            frame_sync_key: str | None = None
            frame_play_at: float | None = None
            event_edge_key = self._format_edge_key(edge)
            event_details: dict[str, Any] = {"edge": event_edge_key}

            if frame_type == FrameType.SYNC:
                if not isinstance(payload_value, dict):
                    raise TypeError(f"同步节点输出必须是 dict，实际: {type(payload_value)}")

                normalized_payload = dict(payload_value)
                raw_stream_id = payload_value.get("stream_id", self._stream_id)
                if "stream_id" in payload_value:
                    frame_stream_id = self._normalize_stream_id(raw_stream_id)
                else:
                    frame_stream_id = self._stream_id
                frame_seq = self._normalize_seq(payload_value.get("seq", 0))
                frame_play_at = self._normalize_required_play_at(payload_value.get("play_at"))
                frame_sync_key = self._normalize_sync_key(
                    payload_value.get("sync_key"),
                    fallback=f"{frame_stream_id}:{frame_seq}",
                )
                normalized_payload["stream_id"] = frame_stream_id
                normalized_payload["seq"] = frame_seq
                normalized_payload["play_at"] = frame_play_at
                normalized_payload["sync_key"] = frame_sync_key
                payload_value = normalized_payload
                event_details.update(
                    {
                        "stream_id": frame_stream_id,
                        "seq": frame_seq,
                        "play_at": frame_play_at,
                        "sync_key": frame_sync_key,
                        "strategy": payload_value.get("strategy"),
                        "late_policy": payload_value.get("late_policy"),
                        "decision": payload_value.get("decision"),
                    }
                )

            # frame: 统一帧对象，后续由 edge_worker 实际转发。
            frame = Frame(
                run_id=self._run_id,
                stream_id=frame_stream_id,
                seq=frame_seq,
                source_node=edge.source_node,
                source_port=edge.source_port,
                frame_type=frame_type,
                payload={"value": payload_value},
                sync_key=frame_sync_key,
                play_at=frame_play_at,
            )

            await queue.put(frame)
            edge_state.queue_size = queue.qsize()
            edge_state.queue_peak_size = max(edge_state.queue_peak_size, edge_state.queue_size)
            if self.runtime_state is not None:
                self.runtime_state.metrics["edge_queue_peak_max"] = max(
                    int(self.runtime_state.metrics.get("edge_queue_peak_max", 0)),
                    edge_state.queue_peak_size,
                )

            event_type = (
                RuntimeEventType.SYNC_FRAME_EMITTED
                if frame_type == FrameType.SYNC
                else RuntimeEventType.FRAME_EMITTED
            )
            severity = RuntimeEventSeverity.INFO
            component = RuntimeEventComponent.EDGE
            if frame_type == FrameType.SYNC and event_details.get("decision") == "drop":
                severity = RuntimeEventSeverity.WARNING
                component = RuntimeEventComponent.SYNC

            self._emit_event(
                event_type,
                node_id=node_id,
                message=f"Frame emitted to {edge.target_node}.{edge.target_port}",
                severity=severity,
                component=component,
                edge_key=event_edge_key,
                details=event_details,
            )

    async def _edge_worker(self, edge: EdgeSpec) -> None:
        """单边转发任务：从边队列读取帧，写入目标节点输入缓冲。"""
        # edge_key: 当前边唯一键，用于索引队列与边状态。
        edge_key = self._edge_key(edge)
        # queue: 当前边的帧队列。
        queue = self._edge_queues[edge_key]
        # edge_state: 当前边运行时统计对象。
        edge_state = self._edge_state_map[edge_key]

        try:
            while True:
                if self._stop_event.is_set() and queue.empty():
                    break

                try:
                    # frame: 从队列取出的单帧消息。
                    frame = await asyncio.wait_for(
                        queue.get(), timeout=self.config.queue_poll_timeout_s
                    )
                except asyncio.TimeoutError:
                    continue

                self._node_inputs[edge.target_node][edge.target_port] = frame.payload.get("value")
                self._node_input_events[edge.target_node].set()

                queue.task_done()
                edge_state.forwarded_frames += 1
                edge_state.queue_size = queue.qsize()
                if self.runtime_state is not None:
                    self.runtime_state.metrics["edge_forwarded_frames"] = (
                            int(self.runtime_state.metrics.get("edge_forwarded_frames", 0)) + 1
                    )
        except asyncio.CancelledError:
            raise

    async def _shutdown_edge_tasks(self) -> None:
        """结束所有边任务。"""
        for task in self._edge_tasks:
            if not task.done():
                task.cancel()
        if self._edge_tasks:
            await asyncio.gather(*self._edge_tasks, return_exceptions=True)

    def _fail_run(self, message: str) -> None:
        """将运行标记为失败。"""
        self._failed = True
        if self.runtime_state is None:
            return
        self.runtime_state.status = "failed"
        self.runtime_state.last_error = message

    def _emit_event(
            self,
            event_type: RuntimeEventType,
            *,
            node_id: str | None = None,
            message: str | None = None,
            severity: RuntimeEventSeverity = RuntimeEventSeverity.INFO,
            component: RuntimeEventComponent = RuntimeEventComponent.SCHEDULER,
            error_code: str | None = None,
            edge_key: str | None = None,
            attempt: int | None = None,
            details: dict[str, Any] | None = None,
    ) -> None:
        """写入运行事件并输出日志。"""
        if self._run_id is None:
            return
        event_seq = self._event_seq
        self._event_seq += 1
        event_id = f"{self._run_id}:{event_seq}"
        # event: 本次要写入事件队列的结构化事件对象。
        event = RuntimeEvent(
            run_id=self._run_id,
            event_id=event_id,
            event_seq=event_seq,
            event_type=event_type,
            severity=severity,
            component=component,
            node_id=node_id,
            edge_key=edge_key,
            error_code=error_code,
            attempt=attempt,
            message=message,
            details=details or {},
        )
        self._events.append(event)
        self._trim_events_if_needed()
        self._update_runtime_metrics_on_event(event)
        print(
            "[RuntimeEvent]",
            f"run={event.run_id}",
            f"seq={event.event_seq}",
            f"type={event.event_type.value}",
            f"severity={event.severity.value}",
            f"component={event.component.value}",
            f"node={event.node_id or '-'}",
            f"msg={event.message or '-'}",
        )

    def _trim_events_if_needed(self) -> None:
        """按配置裁剪内存事件，避免长时运行无界增长。"""
        max_retained = int(self.config.max_retained_events)
        if max_retained <= 0:
            return
        overflow = len(self._events) - max_retained
        if overflow <= 0:
            return
        del self._events[:overflow]
        self._events_cursor_base += overflow
        if self.runtime_state is not None:
            self.runtime_state.metrics["event_dropped"] = int(
                self.runtime_state.metrics.get("event_dropped", 0)
            ) + overflow
            self.runtime_state.metrics["event_retained"] = len(self._events)

    @staticmethod
    def _edge_key(edge: EdgeSpec) -> EdgeKey:
        """构造边唯一键。"""
        return edge.source_node, edge.source_port, edge.target_node, edge.target_port

    @classmethod
    def _format_edge_key(cls, edge: EdgeSpec) -> str:
        """构造对外可读边键。"""
        source_node, source_port, target_node, target_port = cls._edge_key(edge)
        return f"{source_node}.{source_port}->{target_node}.{target_port}"

    @staticmethod
    def _initial_runtime_metrics() -> dict[str, Any]:
        """构造运行时聚合指标初始值。"""
        return {
            "event_total": 0,
            "event_retained": 0,
            "event_dropped": 0,
            "event_warning": 0,
            "event_error": 0,
            "node_retry_events": 0,
            "node_timeout_events": 0,
            "node_finished": 0,
            "node_failed": 0,
            "node_retried_total": 0,
            "node_timeout_total": 0,
            "edge_forwarded_frames": 0,
            "edge_queue_peak_max": 0,
            "sync_decisions": {},
        }

    def _update_runtime_metrics_on_event(self, event: RuntimeEvent) -> None:
        """按事件增量更新图级指标。"""
        if self.runtime_state is None:
            return
        metrics = self.runtime_state.metrics
        metrics["event_total"] = int(metrics.get("event_total", 0)) + 1
        metrics["event_retained"] = len(self._events)
        if event.severity == RuntimeEventSeverity.WARNING:
            metrics["event_warning"] = int(metrics.get("event_warning", 0)) + 1
        if event.severity in {RuntimeEventSeverity.ERROR, RuntimeEventSeverity.CRITICAL}:
            metrics["event_error"] = int(metrics.get("event_error", 0)) + 1

        if event.event_type == RuntimeEventType.NODE_RETRY:
            metrics["node_retry_events"] = int(metrics.get("node_retry_events", 0)) + 1
        if event.event_type == RuntimeEventType.NODE_TIMEOUT:
            metrics["node_timeout_events"] = int(metrics.get("node_timeout_events", 0)) + 1

        if event.event_type == RuntimeEventType.SYNC_FRAME_EMITTED:
            decision = str(event.details.get("decision", "unknown"))
            sync_decisions = metrics.setdefault("sync_decisions", {})
            if isinstance(sync_decisions, dict):
                sync_decisions[decision] = int(sync_decisions.get(decision, 0)) + 1

    def _finalize_runtime_metrics(self) -> None:
        """在运行收尾时汇总一次图级指标，保证快照一致。"""
        if self.runtime_state is None:
            return

        finished_count = sum(
            1 for node in self.runtime_state.node_states.values() if node.status == "finished"
        )
        failed_count = sum(
            1 for node in self.runtime_state.node_states.values() if node.status == "failed"
        )
        edge_forwarded_total = sum(edge.forwarded_frames for edge in self.runtime_state.edge_states)
        edge_queue_peak_max = max(
            (edge.queue_peak_size for edge in self.runtime_state.edge_states),
            default=0,
        )
        node_retried_total = sum(
            int(node.metrics.get("retry_count", 0))
            for node in self.runtime_state.node_states.values()
        )
        node_timeout_total = sum(
            int(node.metrics.get("timeout_count", 0))
            for node in self.runtime_state.node_states.values()
        )
        self.runtime_state.metrics["node_finished"] = finished_count
        self.runtime_state.metrics["node_failed"] = failed_count
        self.runtime_state.metrics["node_retried_total"] = node_retried_total
        self.runtime_state.metrics["node_timeout_total"] = node_timeout_total
        self.runtime_state.metrics["edge_forwarded_frames"] = edge_forwarded_total
        self.runtime_state.metrics["edge_queue_peak_max"] = edge_queue_peak_max
        event_total = int(self.runtime_state.metrics.get("event_total", 0))
        event_dropped = int(self.runtime_state.metrics.get("event_dropped", 0))
        event_retained = int(self.runtime_state.metrics.get("event_retained", 0))
        if event_total > 0:
            self.runtime_state.metrics["event_drop_ratio"] = round(event_dropped / event_total, 6)
            self.runtime_state.metrics["event_retention_ratio"] = round(
                event_retained / event_total, 6
            )
        else:
            self.runtime_state.metrics["event_drop_ratio"] = 0.0
            self.runtime_state.metrics["event_retention_ratio"] = 0.0

    async def _execute_node_with_policy(
            self,
            *,
            node_id: str,
            node: BaseNode,
            inputs: dict[str, Any],
            context: NodeContext,
            node_state: RuntimeNodeState,
            policy: NodeExecutionPolicy,
    ) -> dict[str, Any]:
        """按超时/重试策略执行节点处理逻辑。"""
        # original_inputs: 首次进入执行策略时的输入快照。
        # 每次 attempt 都基于它重新拷贝，避免节点在失败前修改入参导致重试污染。
        original_inputs = deepcopy(inputs)
        max_retries = max(0, policy.max_retries)
        max_attempts = max_retries + 1
        attempt = 1
        while True:
            node_state.metrics["attempt_count"] = attempt
            node_state.metrics["retry_count"] = max(0, attempt - 1)
            attempt_inputs = deepcopy(original_inputs)
            try:
                async with self._parallel_semaphore:
                    if policy.timeout_s is not None:
                        outputs = await asyncio.wait_for(
                            node.process(inputs=attempt_inputs, context=context), timeout=policy.timeout_s
                        )
                    else:
                        outputs = await node.process(inputs=attempt_inputs, context=context)
                return outputs
            except asyncio.TimeoutError as exc:
                timeout_error = NodeTimeoutError(f"节点 {node_id} 执行超时")
                node_state.metrics["timeout_count"] = int(node_state.metrics.get("timeout_count", 0)) + 1
                retry_left = attempt < max_attempts
                self._emit_event(
                    RuntimeEventType.NODE_TIMEOUT,
                    node_id=node_id,
                    message=f"Node timeout on attempt {attempt}",
                    severity=RuntimeEventSeverity.WARNING if retry_left else RuntimeEventSeverity.ERROR,
                    component=RuntimeEventComponent.NODE,
                    error_code=ErrorCode.NODE_TIMEOUT.value,
                    attempt=attempt,
                    details={"retry_left": retry_left, "timeout_s": policy.timeout_s},
                )
                if not retry_left:
                    # max_retries=0 时，保持原始超时错误码，避免将“未重试”误标为重试耗尽。
                    if max_retries <= 0:
                        raise timeout_error from exc
                    raise RuntimeNodeError(
                        f"节点 {node_id} 重试耗尽（最后错误: timeout）",
                        code=ErrorCode.NODE_RETRY_EXHAUSTED,
                        retryable=False,
                        details={"cause": ErrorCode.NODE_TIMEOUT.value},
                    ) from exc
                await self._schedule_retry_event(node_id=node_id, attempt=attempt, error=timeout_error, policy=policy)
                attempt += 1
                continue
            except Exception as exc:  # noqa: BLE001 - 节点异常统一归类
                retryable = is_retryable_exception(exc)
                retry_left = retryable and attempt < max_attempts
                if not retry_left:
                    # max_retries=0 时，保持原始异常分类；仅在“已配置重试”且耗尽时上报 retry_exhausted。
                    if retryable and max_retries > 0:
                        code, _ = classify_exception(exc)
                        raise RuntimeNodeError(
                            f"节点 {node_id} 重试耗尽（最后错误: {code.value}）",
                            code=ErrorCode.NODE_RETRY_EXHAUSTED,
                            retryable=False,
                            details={"cause": code.value},
                        ) from exc
                    raise
                await self._schedule_retry_event(node_id=node_id, attempt=attempt, error=exc, policy=policy)
                attempt += 1

    async def _schedule_retry_event(
            self,
            *,
            node_id: str,
            attempt: int,
            error: Exception,
            policy: NodeExecutionPolicy,
    ) -> None:
        """发出重试事件并按策略回退等待。"""
        code, _retryable = classify_exception(error)
        next_attempt = attempt + 1
        self._emit_event(
            RuntimeEventType.NODE_RETRY,
            node_id=node_id,
            message=f"Node retry scheduled: attempt {next_attempt}",
            severity=RuntimeEventSeverity.WARNING,
            component=RuntimeEventComponent.NODE,
            error_code=code.value,
            attempt=next_attempt,
            details={"retry_backoff_ms": policy.retry_backoff_ms},
        )
        backoff_s = max(policy.retry_backoff_ms, 0) / 1000.0
        if backoff_s > 0:
            await asyncio.sleep(backoff_s)

    def _required_inputs_unavailable(self, node_id: str, required_ports: set[str]) -> bool:
        """判断必需输入是否已不可达（用于 continue_on_error 场景避免等待死锁）。"""
        assert self._compiled_graph is not None
        assert self.runtime_state is not None

        missing_ports = [
            port for port in required_ports if port not in self._node_inputs.get(node_id, {})
        ]
        if not missing_ports:
            return False

        incoming_edges = self._compiled_graph.incoming_edges.get(node_id, [])
        # 仅当某必需端口的所有上游都处于失败/停止态时，才判定不可达。
        # 注意：finished 并不代表输入已被下游消费，队列中仍可能有待转发帧。
        blocking_statuses = {"failed", "stopped"}
        for port in missing_ports:
            provider_nodes = [
                edge.source_node for edge in incoming_edges if edge.target_port == port
            ]
            if not provider_nodes:
                return True
            # 当前端口所有上游均失败/停止，端口不可达。
            if all(
                    self.runtime_state.node_states[src].status in blocking_statuses
                    for src in provider_nodes
            ):
                return True
        # 所有缺失端口都仍有可用上游，暂不判定不可达。
        return False

    @staticmethod
    def _build_node_policy(config: dict[str, Any]) -> NodeExecutionPolicy:
        """从节点实例配置解析执行策略。"""
        raw_timeout = config.get("timeout_s")
        timeout_s: float | None = None
        if raw_timeout is not None:
            try:
                candidate = float(raw_timeout)
            except (TypeError, ValueError):
                candidate = 0.0
            if candidate > 0:
                timeout_s = candidate

        raw_max_retries = config.get("max_retries", 0)
        try:
            max_retries = max(0, int(raw_max_retries))
        except (TypeError, ValueError):
            max_retries = 0

        raw_backoff_ms = config.get("retry_backoff_ms", 0)
        try:
            retry_backoff_ms = max(0, int(raw_backoff_ms))
        except (TypeError, ValueError):
            retry_backoff_ms = 0

        continue_on_error = GraphScheduler._parse_bool_flag(
            config.get("continue_on_error"), default=False
        )
        critical = GraphScheduler._parse_bool_flag(config.get("critical"), default=False)

        return NodeExecutionPolicy(
            timeout_s=timeout_s,
            max_retries=max_retries,
            retry_backoff_ms=retry_backoff_ms,
            continue_on_error=continue_on_error,
            critical=critical,
        )

    @staticmethod
    def _parse_bool_flag(raw_value: Any, *, default: bool) -> bool:
        """解析配置中的布尔开关，避免将字符串误判为 True。"""
        if raw_value is None:
            return default
        if isinstance(raw_value, bool):
            return raw_value
        if isinstance(raw_value, int) and raw_value in {0, 1}:
            return bool(raw_value)
        if isinstance(raw_value, str):
            normalized = raw_value.strip().lower()
            if normalized in {"true", "1", "yes", "y", "on"}:
                return True
            if normalized in {"false", "0", "no", "n", "off"}:
                return False
            if not normalized:
                return default
        return default

    @staticmethod
    def _event_matches_filters(
            event: RuntimeEvent,
            *,
            event_type: RuntimeEventType | str | None,
            node_id: str | None,
            severity: RuntimeEventSeverity | str | None,
            error_code: str | None,
    ) -> bool:
        """判断事件是否命中过滤条件。"""
        if event_type is not None:
            expected_event_type = (
                event_type.value if isinstance(event_type, RuntimeEventType) else str(event_type)
            )
            if event.event_type.value != expected_event_type:
                return False

        if node_id is not None and event.node_id != node_id:
            return False

        if severity is not None:
            expected_severity = (
                severity.value if isinstance(severity, RuntimeEventSeverity) else str(severity)
            )
            if event.severity.value != expected_severity:
                return False

        if error_code is not None and event.error_code != error_code:
            return False

        return True

    @staticmethod
    def _normalize_seq(raw_value: Any) -> int:
        """规范化 seq 并做边界校验。"""
        if isinstance(raw_value, bool):
            raise ValueError(f"非法 seq 值: {raw_value!r}")
        if not isinstance(raw_value, int):
            raise ValueError(f"非法 seq 值: {raw_value!r}")
        seq = raw_value
        if seq < 0:
            raise ValueError(f"seq 不能为负数: {seq}")
        return seq

    @staticmethod
    def _normalize_stream_id(raw_value: Any) -> str:
        """规范化 stream_id，并拒绝空白或非字符串值。"""
        if not isinstance(raw_value, str):
            raise ValueError(f"非法 stream_id 值: {raw_value!r}")
        stream_id = raw_value.strip()
        if not stream_id:
            raise ValueError("同步帧 stream_id 不能为空")
        return stream_id

    @staticmethod
    def _normalize_play_at(raw_value: Any) -> float | None:
        """规范化 play_at 并做边界校验。"""
        if raw_value is None:
            return None
        try:
            play_at = float(raw_value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"非法 play_at 值: {raw_value!r}") from exc
        if play_at < 0 or not math.isfinite(play_at):
            raise ValueError(f"play_at 必须是有限非负数: {play_at}")
        return play_at

    @classmethod
    def _normalize_required_play_at(cls, raw_value: Any) -> float:
        """规范化必填的 play_at 字段。"""
        play_at = cls._normalize_play_at(raw_value)
        if play_at is None:
            raise ValueError("同步帧缺少必填字段 play_at")
        return play_at

    @staticmethod
    def _normalize_sync_key(raw_value: Any, *, fallback: str) -> str:
        """规范化 sync_key，缺失时回退到默认键。"""
        if raw_value is None:
            return fallback
        text = str(raw_value).strip()
        if not text or text.lower() == "none":
            return fallback
        return text
