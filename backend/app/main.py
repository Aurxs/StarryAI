"""FastAPI app entrypoint."""

from __future__ import annotations

from fastapi import FastAPI

from app.api.routes_graphs import router as graphs_router
from app.api.routes_node_types import router as node_types_router
from app.api.routes_runs import router as runs_router
from app.api.ws_runs import router as ws_runs_router

app = FastAPI(title="StarryAI Backend", version="0.1.0")

app.include_router(node_types_router)
app.include_router(graphs_router)
app.include_router(runs_router)
app.include_router(ws_runs_router)


@app.get("/")
async def root() -> dict[str, str]:
    return {"name": "StarryAI Backend", "phase": "A"}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
