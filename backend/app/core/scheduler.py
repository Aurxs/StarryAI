"""图调度器（Phase B 最小可运行实现）。

设计目标（当前版本）：
1. 以最小闭环跑通 DAG 节点执行。
2. 使用“节点任务 + 边任务 + 队列”完成路由。
3. 通过运行态状态与事件列表支撑 API/WS 观测。
"""

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
        if since < 0:
            since = 0
        # end: 本次切片终点（包含 since 与 limit 约束）。
        end = since + max(limit, 0)
        # items: 返回给调用方的事件子集。
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

    async def _node_worker(self, node_id: str, node: BaseNode) -> None:
        """单节点执行任务。"""
        assert self._compiled_graph is not None
        assert self.runtime_state is not None
        assert self._run_id is not None

        # node_state: 当前节点可观测运行态对象（会持续更新）。
        node_state = self.runtime_state.node_states[node_id]
        # spec: 当前节点类型规格（输入输出端口、模式等）。
        spec = self._compiled_graph.node_specs[node_id]
        # required_ports: 当前节点必须满足的输入端口集合。
        required_ports = {port.name for port in spec.inputs if port.required}

        try:
            while not self._stop_event.is_set():
                # current_inputs: 当前已收到的输入缓存快照引用。
                current_inputs = self._node_inputs[node_id]
                if required_ports.issubset(current_inputs):
                    break

                # event: 当前节点的输入到达事件；等待下游边任务唤醒。
                event = self._node_input_events[node_id]
                await event.wait()
                event.clear()

            if self._stop_event.is_set():
                node_state.status = "stopped"
                return

            node_state.status = "running"
            node_state.started_at = time.time()
            self._emit_event(RuntimeEventType.NODE_STARTED, node_id=node_id, message="Node started")

            # context: 传给节点 process 的运行上下文。
            context = NodeContext(
                run_id=self._run_id,
                node_id=node_id,
                metadata={
                    "stream_id": self._stream_id,
                    "graph_id": self.runtime_state.graph_id,
                    "node_mode": spec.mode.value,
                },
            )
            # inputs: 传入节点 process 的输入副本，避免节点修改共享缓存。
            inputs = dict(self._node_inputs[node_id])

            async with self._parallel_semaphore:
                # outputs: 节点 process 返回的输出端口数据映射。
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
            # frame: 统一帧对象，后续由 edge_worker 实际转发。
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
        # event: 本次要写入事件队列的结构化事件对象。
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
