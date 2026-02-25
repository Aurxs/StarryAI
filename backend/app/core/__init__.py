"""StarryAI core package."""

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
