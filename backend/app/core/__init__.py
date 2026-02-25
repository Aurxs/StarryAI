"""图引擎核心模块导出。

该文件统一导出阶段 A 的核心协议和图模型，便于上层模块按需导入。
"""

from .frame import Frame, FrameType, RuntimeEvent, RuntimeEventType, SyncFrame
from .graph_builder import CompiledGraph, GraphBuildError, GraphBuilder
from .registry import NodeTypeRegistry, create_default_registry
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
    "RuntimeEventType",
    "SyncFrame",
    "CompiledGraph",
    "GraphBuildError",
    "GraphBuilder",
    "NodeTypeRegistry",
    "create_default_registry",
    "EdgeSpec",
    "GraphSpec",
    "GraphValidationReport",
    "NodeInstanceSpec",
    "NodeMode",
    "NodeSpec",
    "PortSpec",
    "SyncConfig",
]
