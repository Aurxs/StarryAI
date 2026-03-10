"""图配置与校验接口（阶段 A）。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.core.graph_compatibility import (
    evaluate_graph_compatibility,
    enrich_graph_compat_metadata,
    get_primary_incompatibility,
)
from app.core.graph_builder import GraphBuilder
from app.core.registry import create_default_registry
from app.core.spec import GraphSpec
from app.schemas.graphs import (
    DeleteGraphResponse,
    GraphIncompatibilityResponse,
    GraphListResponse,
    GraphSummaryResponse,
    SaveGraphResponse,
)
from app.services.graph_repository import (
    GraphNotFoundError,
    GraphRepositoryError,
    get_graph_repository,
)
from app.secrets.service import get_secret_service

# 图配置相关路由。
router = APIRouter(prefix="/api/v1/graphs", tags=["graphs"])


@router.post("/validate")
async def validate_graph(graph: GraphSpec) -> dict[str, object]:
    """校验图定义并返回结构化报告。

    使用场景：
    - 前端保存前预校验。
    - 后端运行前最终校验。
    """
    builder = GraphBuilder(create_default_registry(), secret_exists=get_secret_service().exists)
    report = builder.validate(graph)
    return report.model_dump(mode="json")


@router.get("")
async def list_graphs() -> dict[str, object]:
    """返回已保存图列表。"""
    repository = get_graph_repository()
    registry = create_default_registry()
    try:
        records = repository.list_graphs()
    except GraphRepositoryError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc

    items: list[GraphSummaryResponse] = []
    for record in records:
        incompatibility: GraphIncompatibilityResponse | None = None
        try:
            graph = repository.get_graph(record.graph_id)
            compatibility = evaluate_graph_compatibility(graph, registry)
            if not compatibility.compatible:
                primary = get_primary_incompatibility(compatibility)
                if primary is not None:
                    incompatibility = GraphIncompatibilityResponse(
                        code=primary.code,
                        message=primary.message,
                    )
        except (GraphNotFoundError, GraphRepositoryError, ValueError) as exc:
            incompatibility = GraphIncompatibilityResponse(
                code="compat.graph_unreadable",
                message=f"图文件不可读: {exc}",
            )

        items.append(
            GraphSummaryResponse(
                graph_id=record.graph_id,
                version=record.version,
                updated_at=record.updated_at,
                incompatibility=incompatibility,
            )
        )
    return GraphListResponse(count=len(items), items=items).model_dump(mode="json")


@router.get("/{graph_id}")
async def get_graph(graph_id: str) -> dict[str, object]:
    """按 graph_id 获取已保存图。"""
    repository = get_graph_repository()
    registry = create_default_registry()
    try:
        graph = repository.get_graph(graph_id)
    except GraphNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except GraphRepositoryError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"message": str(exc)},
        ) from exc

    compatibility = evaluate_graph_compatibility(graph, registry)
    if not compatibility.compatible:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "图与当前运行时不兼容，禁止加载",
                "compatibility": compatibility.to_dict(),
            },
        )

    return graph.model_dump(mode="json")


@router.put("/{graph_id}")
async def save_graph(graph_id: str, graph: GraphSpec) -> dict[str, object]:
    """保存图定义。"""
    normalized_graph_id = graph_id.strip()
    if not normalized_graph_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"message": "graph_id 不能为空"},
        )
    if graph.graph_id != normalized_graph_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"message": "路径 graph_id 与请求体 graph.graph_id 不一致"},
        )

    registry = create_default_registry()
    builder = GraphBuilder(registry, secret_exists=get_secret_service().exists)
    report = builder.validate(graph)
    config_errors = [issue for issue in report.issues if issue.code.startswith("node.config_") or issue.code.startswith("node.secret_")]
    if config_errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "message": "图包含非法节点配置，禁止保存",
                "report": {
                    "graph_id": report.graph_id,
                    "valid": False,
                    "issues": [issue.model_dump(mode="json") for issue in config_errors],
                },
            },
        )
    graph_with_compat = enrich_graph_compat_metadata(graph, registry)
    repository = get_graph_repository()
    try:
        summary = repository.save_graph(graph_with_compat)
    except GraphRepositoryError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"message": str(exc)},
        ) from exc

    return SaveGraphResponse(
        graph_id=summary.graph_id,
        version=summary.version,
        updated_at=summary.updated_at,
    ).model_dump(mode="json")


@router.delete("/{graph_id}")
async def delete_graph(graph_id: str) -> dict[str, object]:
    """删除指定已保存图。"""
    repository = get_graph_repository()
    try:
        repository.delete_graph(graph_id)
    except GraphNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except GraphRepositoryError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"message": str(exc)},
        ) from exc

    return DeleteGraphResponse(graph_id=graph_id, deleted=True).model_dump(mode="json")
