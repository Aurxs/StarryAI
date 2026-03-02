"""同步节点 envelope 协议模型。"""

from __future__ import annotations

import time
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SyncMeta(BaseModel):
    """同步元信息。"""

    model_config = ConfigDict(extra="forbid")

    stream_id: str = Field(..., min_length=1)
    seq: int = Field(default=0, ge=0)
    sync_group: str = Field(..., min_length=1)
    sync_round: int = Field(default=0, ge=0)
    ready_timeout_ms: int = Field(default=800, ge=1)
    commit_lead_ms: int = Field(default=50, ge=1)
    sync_key: str = Field(default="")
    issued_at: float = Field(default_factory=time.monotonic)

    @model_validator(mode="after")
    def normalize_and_validate(self) -> "SyncMeta":
        self.stream_id = self.stream_id.strip()
        self.sync_group = self.sync_group.strip()
        if not self.stream_id:
            raise ValueError("stream_id 不能为空")
        if not self.sync_group:
            raise ValueError("sync_group 不能为空")
        if not self.sync_key:
            self.sync_key = build_sync_key(
                stream_id=self.stream_id,
                sync_group=self.sync_group,
                sync_round=self.sync_round,
            )
        return self


class SyncEnvelope(BaseModel):
    """同步包装结构。"""

    model_config = ConfigDict(extra="forbid")

    data: Any
    sync: SyncMeta


def build_sync_key(*, stream_id: str, sync_group: str, sync_round: int) -> str:
    """构造稳定同步键。"""
    return f"{stream_id}:{sync_group}:{sync_round}"


def build_sync_envelope(*, data: Any, sync: SyncMeta | dict[str, Any]) -> dict[str, Any]:
    """构造同步 envelope 的可序列化字典。"""
    sync_meta = sync if isinstance(sync, SyncMeta) else SyncMeta.model_validate(sync)
    envelope = SyncEnvelope(data=data, sync=sync_meta)
    return envelope.model_dump()


def parse_sync_envelope(payload: Any) -> tuple[Any, SyncMeta]:
    """解析同步 envelope，返回业务数据与同步元信息。"""
    envelope = SyncEnvelope.model_validate(payload)
    return envelope.data, envelope.sync
