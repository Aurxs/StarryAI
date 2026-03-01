"""同步执行节点基类。"""

from __future__ import annotations

import abc
import asyncio
import time
from typing import Any

from .node_base import NodeContext
from .node_sync import SyncNode
from .sync_coordinator import SyncCommitDecision, SyncCoordinator


class SyncExecutorNode(SyncNode):
    """统一实现 ready -> commit -> execute 流程。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        if not inputs:
            raise ValueError(f"{self.spec.type_name} 未收到任何同步输入")
        if len(inputs) > 1:
            raise ValueError(f"{self.spec.type_name} 当前仅支持单输入同步执行")

        _port_name, payload = next(iter(inputs.items()))
        data, sync_meta = self._extract_envelope(payload)
        sync_group = self._normalize_group(sync_meta.get("sync_group"))
        sync_round = self._normalize_round(sync_meta.get("sync_round", 0))

        coordinator = self._resolve_coordinator(context)
        participants_map = context.metadata.get("sync_group_participants")
        participants = self._resolve_participants(participants_map, sync_group)

        commit_lead_ms = self._resolve_timing_ms(
            raw_value=sync_meta.get("commit_lead_ms"),
            fallback_value=self.config.get(
                "commit_lead_ms",
                self.sync_config.commit_lead_ms if self.sync_config is not None else 50,
            ),
            field_name="commit_lead_ms",
        )
        ready_timeout_ms = self._resolve_timing_ms(
            raw_value=sync_meta.get("ready_timeout_ms"),
            fallback_value=self.config.get(
                "ready_timeout_ms",
                self.sync_config.ready_timeout_ms if self.sync_config is not None else 800,
            ),
            field_name="ready_timeout_ms",
        )

        decision = await coordinator.ready(
            run_id=context.run_id,
            sync_group=sync_group,
            sync_round=sync_round,
            node_id=context.node_id,
            participants=participants,
            commit_lead_ms=commit_lead_ms,
            ready_timeout_ms=ready_timeout_ms,
        )

        if not decision.committed:
            return {
                "__node_metrics": {
                    "sync_ready": 1,
                    "sync_committed": 0,
                    "sync_aborted": 1,
                    "sync_abort_reason": decision.reason,
                }
            }

        await self._wait_until_commit(decision)
        await self.execute(data=data, sync_meta=sync_meta, context=context)
        return {
            "__node_metrics": {
                "sync_ready": 1,
                "sync_committed": 1,
                "sync_aborted": 0,
                "sync_abort_reason": "",
            }
        }

    @abc.abstractmethod
    async def execute(self, *, data: Any, sync_meta: dict[str, Any], context: NodeContext) -> None:
        """在协调器提交后执行具体动作。"""
        raise NotImplementedError

    @staticmethod
    def _extract_envelope(payload: Any) -> tuple[Any, dict[str, Any]]:
        if not isinstance(payload, dict):
            raise ValueError("同步输入 payload 必须是 dict")
        if "data" not in payload or "sync" not in payload:
            raise ValueError("同步输入 payload 必须包含 data/sync 字段")
        sync_meta = payload.get("sync")
        if not isinstance(sync_meta, dict):
            raise ValueError("同步输入 payload.sync 必须是 dict")
        return payload.get("data"), sync_meta

    @staticmethod
    def _normalize_group(raw_group: Any) -> str:
        if not isinstance(raw_group, str):
            raise ValueError(f"sync_group 非法: {raw_group!r}")
        group = raw_group.strip()
        if not group:
            raise ValueError("sync_group 不能为空")
        return group

    @staticmethod
    def _normalize_round(raw_round: Any) -> int:
        if isinstance(raw_round, bool) or not isinstance(raw_round, int):
            raise ValueError(f"sync_round 非法: {raw_round!r}")
        if raw_round < 0:
            raise ValueError(f"sync_round 不能为负数: {raw_round}")
        return raw_round

    @staticmethod
    def _resolve_timing_ms(*, raw_value: Any, fallback_value: Any, field_name: str) -> int:
        if raw_value is not None:
            if isinstance(raw_value, bool) or not isinstance(raw_value, int) or raw_value < 1:
                raise ValueError(f"{field_name} 非法: {raw_value!r}")
            return int(raw_value)
        if isinstance(fallback_value, bool) or not isinstance(fallback_value, int) or fallback_value < 1:
            raise ValueError(f"{field_name} 非法: {fallback_value!r}")
        return int(fallback_value)

    @staticmethod
    def _resolve_coordinator(context: NodeContext) -> SyncCoordinator:
        coordinator = context.metadata.get("sync_coordinator")
        if not isinstance(coordinator, SyncCoordinator):
            raise RuntimeError("同步协调器不存在，无法执行同步节点")
        return coordinator

    @staticmethod
    def _resolve_participants(raw_map: Any, sync_group: str) -> set[str]:
        if not isinstance(raw_map, dict):
            return set()
        raw_nodes = raw_map.get(sync_group)
        if isinstance(raw_nodes, list):
            return {str(node_id) for node_id in raw_nodes if str(node_id).strip()}
        return set()

    @staticmethod
    async def _wait_until_commit(decision: SyncCommitDecision) -> None:
        if decision.commit_at is None:
            return
        wait_s = decision.commit_at - time.monotonic()
        if wait_s > 0:
            await asyncio.sleep(wait_s)
