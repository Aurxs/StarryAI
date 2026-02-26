"""图调度器（Phase B 最小可运行实现）。"""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass
from typing import Any

from .frame import Frame, FrameType, RuntimeEvent, RuntimeEventType
from .graph_builder import CompiledGraph
from .graph_runtime import GraphRuntimeState, RuntimeEdgeState, RuntimeNodeState
from .node_base import BaseNode, NodeContext
from .node_factory import NodeFactory, create_default_node_factory
from .spec import EdgeSpec, NodeMode

EdgeKey = tuple[str, str, str, str]


@dataclass(slots=True)
class SchedulerConfig:
    """调度器配置。"""

    max_parallel_nodes: int = 16
    # 0 表示无界队列。
    default_edge_queue_maxsize: int = 0
    # 边队列轮询间隔，用于支持 stop 时的可中断等待。
    queue_poll_timeout_s: float = 0.05


class GraphScheduler:
    """单运行实例图调度器。"""

    def __init__(
            self,
            config: SchedulerConfig | None = None,
            *,
            node_factory: NodeFactory | None = None,
    ) -> None:
        self.config = config or SchedulerConfig()
        self.node_factory = node_factory or create_default_node_factory()

        self.runtime_state: GraphRuntimeState | None = None

        self._compiled_graph: CompiledGraph | None = None
        self._run_id: str | None = None
        self._stream_id: str = "stream_default"

        self._events: list[RuntimeEvent] = []
        self._stop_event = asyncio.Event()
        self._finished_event = asyncio.Event()
        self._stop_requested = False
        self._parallel_semaphore = asyncio.Semaphore(self.config.max_parallel_nodes)

        self._node_tasks: list[asyncio.Task[None]] = []
        self._edge_tasks: list[asyncio.Task[None]] = []

        self._edge_queues: dict[EdgeKey, asyncio.Queue[Frame]] = {}
        self._edge_state_map: dict[EdgeKey, RuntimeEdgeState] = {}

        self._node_inputs: dict[str, dict[str, Any]] = {}
        self._node_input_events: dict[str, asyncio.Event] = {}

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
        self._stop_requested = True
        self._stop_event.set()
        for event in self._node_input_events.values():
            event.set()
        for task in self._node_tasks:
            if not task.done():
                task.cancel()

    def get_events(self, *, since: int = 0, limit: int = 200) -> tuple[list[RuntimeEvent], int]:
        """获取内存中的运行事件。"""
        if since < 0:
            since = 0
        end = since + max(limit, 0)
        items = self._events[since:end]
        return items, since + len(items)

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
        self._stream_id = stream_id

        self._events.clear()
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

        self.runtime_state = GraphRuntimeState(
            run_id=self._run_id,
            graph_id=compiled_graph.graph.graph_id,
            status="running",
            started_at=time.time(),
            node_states={
                node_id: RuntimeNodeState(node_id=node_id) for node_id in compiled_graph.node_specs
            },
            edge_states=[],
        )

        self._emit_event(
            RuntimeEventType.RUN_STARTED,
            message="Run started",
            details={"graph_id": compiled_graph.graph.graph_id, "stream_id": stream_id},
        )

        try:
            nodes = self._instantiate_nodes(compiled_graph)
            self._setup_input_buffers(compiled_graph)
            self._setup_edge_queues(compiled_graph)

            self._edge_tasks = [
                asyncio.create_task(self._edge_worker(edge), name=f"edge:{self._edge_key(edge)}")
                for edge in compiled_graph.graph.edges
            ]

            # 所有节点任务并发运行：无输入节点会先执行，其它节点等待输入就绪。
            self._node_tasks = [
                asyncio.create_task(self._node_worker(node_id, nodes[node_id]), name=f"node:{node_id}")
                for node_id in compiled_graph.topo_order
            ]

            node_results = await asyncio.gather(*self._node_tasks, return_exceptions=True)
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
            self._finished_event.set()

        return self.runtime_state

    def _instantiate_nodes(self, compiled_graph: CompiledGraph) -> dict[str, BaseNode]:
        """根据节点规格实例化运行时节点。"""
        node_instances = {node.node_id: node for node in compiled_graph.graph.nodes}
        nodes: dict[str, BaseNode] = {}
        for node_id, spec in compiled_graph.node_specs.items():
            node_def = node_instances[node_id]
            nodes[node_id] = self.node_factory.create(node=node_def, spec=spec)
        return nodes

    def _setup_input_buffers(self, compiled_graph: CompiledGraph) -> None:
        """初始化节点输入缓存。"""
        for node_id in compiled_graph.node_specs:
            self._node_inputs[node_id] = {}
            self._node_input_events[node_id] = asyncio.Event()

    def _setup_edge_queues(self, compiled_graph: CompiledGraph) -> None:
        """初始化边队列与边状态。"""
        assert self.runtime_state is not None
        self.runtime_state.edge_states.clear()

        for edge in compiled_graph.graph.edges:
            edge_key = self._edge_key(edge)
            queue_maxsize = (
                edge.queue_maxsize
                if edge.queue_maxsize > 0
                else self.config.default_edge_queue_maxsize
            )
            self._edge_queues[edge_key] = asyncio.Queue(maxsize=queue_maxsize)

            edge_state = RuntimeEdgeState(
                source_node=edge.source_node,
                source_port=edge.source_port,
                target_node=edge.target_node,
                target_port=edge.target_port,
            )
            self._edge_state_map[edge_key] = edge_state
            self.runtime_state.edge_states.append(edge_state)

    async def _node_worker(self, node_id: str, node: BaseNode) -> None:
        """单节点执行任务。"""
        assert self._compiled_graph is not None
        assert self.runtime_state is not None
        assert self._run_id is not None

        node_state = self.runtime_state.node_states[node_id]
        spec = self._compiled_graph.node_specs[node_id]
        required_ports = {port.name for port in spec.inputs if port.required}

        try:
            while not self._stop_event.is_set():
                current_inputs = self._node_inputs[node_id]
                if required_ports.issubset(current_inputs):
                    break

                event = self._node_input_events[node_id]
                await event.wait()
                event.clear()

            if self._stop_event.is_set():
                node_state.status = "stopped"
                return

            node_state.status = "running"
            node_state.started_at = time.time()
            self._emit_event(RuntimeEventType.NODE_STARTED, node_id=node_id, message="Node started")

            context = NodeContext(
                run_id=self._run_id,
                node_id=node_id,
                metadata={
                    "stream_id": self._stream_id,
                    "graph_id": self.runtime_state.graph_id,
                    "node_mode": spec.mode.value,
                },
            )
            inputs = dict(self._node_inputs[node_id])

            async with self._parallel_semaphore:
                outputs = await node.process(inputs=inputs, context=context)

            if not isinstance(outputs, dict):
                raise TypeError(f"节点 {node_id} 输出必须是 dict，实际: {type(outputs)}")

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

            self._emit_event(RuntimeEventType.NODE_FINISHED, node_id=node_id, message="Node finished")
        except asyncio.CancelledError:
            node_state.status = "stopped"
            node_state.finished_at = time.time()
            raise
        except Exception as exc:  # noqa: BLE001 - 调度器需要兜底捕获节点错误
            node_state.status = "failed"
            node_state.finished_at = time.time()
            node_state.last_error = str(exc)
            self._emit_event(
                RuntimeEventType.NODE_FAILED,
                node_id=node_id,
                message=f"Node failed: {exc}",
                details={"error": str(exc)},
            )
            self._fail_run(f"节点 {node_id} 执行失败: {exc}")
            self.stop()

    async def _route_outputs(self, node_id: str, outputs: dict[str, Any], mode: NodeMode) -> None:
        """将节点输出按边路由到下游队列。"""
        assert self._compiled_graph is not None
        assert self._run_id is not None

        for edge in self._compiled_graph.outgoing_edges.get(node_id, []):
            if edge.source_port not in outputs:
                continue

            edge_key = self._edge_key(edge)
            queue = self._edge_queues[edge_key]
            edge_state = self._edge_state_map[edge_key]

            payload_value = outputs[edge.source_port]
            frame_type = FrameType.SYNC if mode == NodeMode.SYNC else FrameType.DATA
            frame = Frame(
                run_id=self._run_id,
                stream_id=self._stream_id,
                seq=0,
                source_node=edge.source_node,
                source_port=edge.source_port,
                frame_type=frame_type,
                payload={"value": payload_value},
                sync_key=self._stream_id if frame_type == FrameType.SYNC else None,
                play_at=payload_value.get("play_at")
                if frame_type == FrameType.SYNC and isinstance(payload_value, dict)
                else None,
            )

            await queue.put(frame)
            edge_state.queue_size = queue.qsize()

            self._emit_event(
                RuntimeEventType.SYNC_FRAME_EMITTED
                if frame_type == FrameType.SYNC
                else RuntimeEventType.FRAME_EMITTED,
                node_id=node_id,
                message=f"Frame emitted to {edge.target_node}.{edge.target_port}",
                details={"edge": self._edge_key(edge)},
            )

    async def _edge_worker(self, edge: EdgeSpec) -> None:
        """单边转发任务：从边队列读取帧，写入目标节点输入缓冲。"""
        edge_key = self._edge_key(edge)
        queue = self._edge_queues[edge_key]
        edge_state = self._edge_state_map[edge_key]

        try:
            while True:
                if self._stop_event.is_set() and queue.empty():
                    break

                try:
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
            details: dict[str, Any] | None = None,
    ) -> None:
        """写入运行事件并输出日志。"""
        if self._run_id is None:
            return
        event = RuntimeEvent(
            run_id=self._run_id,
            event_type=event_type,
            node_id=node_id,
            message=message,
            details=details or {},
        )
        self._events.append(event)
        print(
            "[RuntimeEvent]",
            f"run={event.run_id}",
            f"type={event.event_type.value}",
            f"node={event.node_id or '-'}",
            f"msg={event.message or '-'}",
        )

    @staticmethod
    def _edge_key(edge: EdgeSpec) -> EdgeKey:
        """构造边唯一键。"""
        return edge.source_node, edge.source_port, edge.target_node, edge.target_port
