"""graphs API DTO 定义。"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class GraphSummaryResponse(BaseModel):
    """图摘要响应。"""

    model_config = ConfigDict(extra="forbid")

    graph_id: str
    version: str
    updated_at: float


class GraphListResponse(BaseModel):
    """图列表响应。"""

    model_config = ConfigDict(extra="forbid")

    count: int = Field(ge=0)
    items: list[GraphSummaryResponse] = Field(default_factory=list)


class SaveGraphResponse(BaseModel):
    """保存图响应。"""

    model_config = ConfigDict(extra="forbid")

    graph_id: str
    version: str
    updated_at: float


class DeleteGraphResponse(BaseModel):
    """删除图响应。"""

    model_config = ConfigDict(extra="forbid")

    graph_id: str
    deleted: bool
