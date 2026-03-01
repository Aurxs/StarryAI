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
from .node_config import CommonNodeConfig
from .node_definition import NodeDefinition
from .node_discovery import NODE_SEARCH_DIRS_ENV, NodeDiscoveryError, discover_node_definitions
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
from .sync_protocol import SyncEnvelope, SyncMeta, build_sync_envelope, build_sync_key, parse_sync_envelope

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
    "CommonNodeConfig",
    "NodeDefinition",
    "NODE_SEARCH_DIRS_ENV",
    "NodeDiscoveryError",
    "discover_node_definitions",
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
    "SyncMeta",
    "SyncEnvelope",
    "build_sync_key",
    "build_sync_envelope",
    "parse_sync_envelope",
]
