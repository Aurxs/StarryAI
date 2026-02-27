"""图引擎核心模块导出。

该文件统一导出阶段 A 的核心协议和图模型，便于上层模块按需导入。
"""

from .frame import (
    Frame,
    FrameType,
    RuntimeEvent,
    RuntimeEventComponent,
    RuntimeEventSeverity,
    RuntimeEventType,
    SyncFrame,
)
from .errors import (
    ErrorCode,
    NodeTimeoutError,
    RuntimeNodeError,
    classify_exception,
    is_retryable_exception,
)
from .graph_builder import CompiledGraph, GraphBuildError, GraphBuilder
from .graph_runtime import GraphRuntimeState, RuntimeEdgeState, RuntimeNodeState
from .node_factory import NodeFactory, NodeFactoryError, create_default_node_factory
from .registry import NodeTypeRegistry, create_default_registry
from .scheduler import GraphScheduler, SchedulerConfig
from .spec import (
    EdgeSpec,
    GraphSpec,
    GraphValidationReport,
    NodeInstanceSpec,
    NodeMode,
    NodeSpec,
    PortSpec,
    SyncConfig,
)

__all__ = [
    "Frame",
    "FrameType",
    "RuntimeEvent",
    "RuntimeEventComponent",
    "RuntimeEventSeverity",
    "RuntimeEventType",
    "SyncFrame",
    "ErrorCode",
    "RuntimeNodeError",
    "NodeTimeoutError",
    "classify_exception",
    "is_retryable_exception",
    "CompiledGraph",
    "GraphBuildError",
    "GraphBuilder",
    "GraphRuntimeState",
    "RuntimeNodeState",
    "RuntimeEdgeState",
    "NodeFactory",
    "NodeFactoryError",
    "create_default_node_factory",
    "NodeTypeRegistry",
    "create_default_registry",
    "GraphScheduler",
    "SchedulerConfig",
    "EdgeSpec",
    "GraphSpec",
    "GraphValidationReport",
    "NodeInstanceSpec",
    "NodeMode",
    "NodeSpec",
    "PortSpec",
    "SyncConfig",
]
