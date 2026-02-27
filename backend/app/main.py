"""FastAPI 应用入口。

本文件负责创建 API 应用并挂载路由。
当前阶段：Phase C（在 Phase B 最小可运行能力基础上增强同步编排）。
"""

from __future__ import annotations

from fastapi import FastAPI

from app.api.routes_graphs import router as graphs_router
from app.api.routes_node_types import router as node_types_router
from app.api.routes_runs import router as runs_router
from app.api.ws_runs import router as ws_runs_router

# 创建后端应用实例。
app = FastAPI(title="StarryAI Backend", version="0.1.0")

# 逐个挂载模块化路由，方便后续按领域拆分维护。
app.include_router(node_types_router)
app.include_router(graphs_router)
app.include_router(runs_router)
app.include_router(ws_runs_router)


@app.get("/")
async def root() -> dict[str, str]:
    """返回服务基础信息。

    该接口用于快速确认服务已启动，并标识当前开发阶段。
    """
    return {"name": "StarryAI Backend", "phase": "C"}


@app.get("/health")
async def health() -> dict[str, str]:
    """健康检查接口。

    运维或网关可通过该接口检测服务存活状态。
    """
    return {"status": "ok"}
