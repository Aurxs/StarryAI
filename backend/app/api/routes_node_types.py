"""节点类型查询接口。"""

from __future__ import annotations

from fastapi import APIRouter

from app.core.registry import create_default_registry

router = APIRouter(prefix="/api/v1/node-types", tags=["node-types"])


@router.get("")
async def list_node_types() -> dict[str, object]:
    registry = create_default_registry()
    specs = [spec.model_dump(mode="json") for spec in registry.list_specs()]
    return {"items": specs, "count": len(specs)}
