"""运行控制接口（阶段 A 占位）。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

router = APIRouter(prefix="/api/v1/runs", tags=["runs"])


@router.post("")
async def create_run() -> dict[str, object]:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Run execution will be implemented in Phase B",
    )


@router.post("/{run_id}/stop")
async def stop_run(run_id: str) -> dict[str, object]:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail=f"Run stop not implemented yet: {run_id}",
    )
