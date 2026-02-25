"""图配置与校验接口（阶段 A）。"""

from __future__ import annotations

from fastapi import APIRouter

from app.core.graph_builder import GraphBuilder
from app.core.registry import create_default_registry
from app.core.spec import GraphSpec

router = APIRouter(prefix="/api/v1/graphs", tags=["graphs"])


@router.post("/validate")
async def validate_graph(graph: GraphSpec) -> dict[str, object]:
    builder = GraphBuilder(create_default_registry())
    report = builder.validate(graph)
    return report.model_dump(mode="json")
