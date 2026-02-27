"""图配置与校验接口（阶段 A）。"""

from __future__ import annotations

from fastapi import APIRouter

from app.core.spec import GraphSpec
from app.services.run_service import get_run_service

# 图配置相关路由。
router = APIRouter(prefix="/api/v1/graphs", tags=["graphs"])


@router.post("/validate")
async def validate_graph(graph: GraphSpec) -> dict[str, object]:
    """校验图定义并返回结构化报告。

    使用场景：
    - 前端保存前预校验。
    - 后端运行前最终校验。
    """
    service = get_run_service()
    report = service.builder.validate(graph)
    return report.model_dump(mode="json")
