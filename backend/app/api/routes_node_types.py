"""节点类型查询接口。"""

from __future__ import annotations

from fastapi import APIRouter

from app.services.run_service import get_run_service

# 节点类型相关路由。
router = APIRouter(prefix="/api/v1/node-types", tags=["node-types"])


@router.get("")
async def list_node_types() -> dict[str, object]:
    """返回当前后端可用的节点类型规范列表。

    前端可通过该接口动态构建：
    - 节点库面板
    - 端口连线提示
    - 节点配置表单
    """
    service = get_run_service()

    # model_dump(mode="json") 可直接返回可序列化结构。
    specs = [spec.model_dump(mode="json") for spec in service.registry.list_specs()]
    return {"items": specs, "count": len(specs)}
