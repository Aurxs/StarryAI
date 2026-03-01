"""同步组协调器。

负责按 run_id + sync_group + sync_round 收集参与节点 ready 状态，
并在全员就绪后下发统一 commit 时刻。
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field


@dataclass(slots=True)
class SyncCommitDecision:
    """同步轮次决策。"""

    committed: bool
    commit_at: float | None
    reason: str


@dataclass(slots=True)
class _RoundState:
    participants: set[str]
    ready_nodes: set[str] = field(default_factory=set)
    decision: SyncCommitDecision | None = None
    created_at: float = field(default_factory=time.monotonic)
    timeout_deadline: float = 0.0
    commit_lead_ms: int = 50
    condition: asyncio.Condition = field(default_factory=asyncio.Condition)


class SyncCoordinator:
    """运行内同步协调器（内存版）。"""

    def __init__(self) -> None:
        self._rounds: dict[tuple[str, str, int], _RoundState] = {}
        self._map_lock = asyncio.Lock()

    async def ready(
        self,
        *,
        run_id: str,
        sync_group: str,
        sync_round: int,
        node_id: str,
        participants: set[str],
        commit_lead_ms: int,
        ready_timeout_ms: int,
    ) -> SyncCommitDecision:
        """登记 ready 并等待 commit/abort 决策。"""
        if not participants:
            return SyncCommitDecision(committed=False, commit_at=None, reason="empty_participants")

        key = (run_id, sync_group, sync_round)
        state = await self._get_or_create_round(
            key=key,
            participants=participants,
            commit_lead_ms=max(1, int(commit_lead_ms)),
            ready_timeout_ms=max(1, int(ready_timeout_ms)),
        )

        async with state.condition:
            if node_id not in state.participants:
                if state.decision is None:
                    state.decision = SyncCommitDecision(
                        committed=False,
                        commit_at=None,
                        reason=f"unknown_participant:{node_id}",
                    )
                    state.condition.notify_all()
                return state.decision

            state.ready_nodes.add(node_id)
            if state.decision is None and state.ready_nodes.issuperset(state.participants):
                commit_at = time.monotonic() + (state.commit_lead_ms / 1000.0)
                state.decision = SyncCommitDecision(
                    committed=True,
                    commit_at=commit_at,
                    reason="all_ready",
                )
                state.condition.notify_all()

            while state.decision is None:
                remaining_s = state.timeout_deadline - time.monotonic()
                if remaining_s <= 0:
                    state.decision = SyncCommitDecision(
                        committed=False,
                        commit_at=None,
                        reason="ready_timeout",
                    )
                    state.condition.notify_all()
                    break
                try:
                    await asyncio.wait_for(state.condition.wait(), timeout=remaining_s)
                except asyncio.TimeoutError:
                    continue

            assert state.decision is not None
            return state.decision

    async def abort_by_node(self, *, node_id: str, reason: str) -> None:
        """当节点失败/停止时，主动中止其所在的未决同步轮。"""
        async with self._map_lock:
            candidate_states = [
                state for state in self._rounds.values() if node_id in state.participants
            ]

        for state in candidate_states:
            async with state.condition:
                if state.decision is not None:
                    continue
                state.decision = SyncCommitDecision(
                    committed=False,
                    commit_at=None,
                    reason=reason,
                )
                state.condition.notify_all()

    async def _get_or_create_round(
        self,
        *,
        key: tuple[str, str, int],
        participants: set[str],
        commit_lead_ms: int,
        ready_timeout_ms: int,
    ) -> _RoundState:
        async with self._map_lock:
            state = self._rounds.get(key)
            if state is not None:
                return state
            state = _RoundState(
                participants=set(participants),
                commit_lead_ms=commit_lead_ms,
                timeout_deadline=time.monotonic() + (ready_timeout_ms / 1000.0),
            )
            self._rounds[key] = state
            return state

