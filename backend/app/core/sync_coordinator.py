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
    finalized_at: float | None = None
    created_at: float = field(default_factory=time.monotonic)
    timeout_deadline: float = 0.0
    commit_lead_ms: int = 50
    condition: asyncio.Condition = field(default_factory=asyncio.Condition)


class SyncCoordinator:
    """运行内同步协调器（内存版）。"""

    def __init__(self, *, decided_ttl_s: float = 30.0, max_decided_rounds: int = 2048) -> None:
        self._rounds: dict[tuple[str, str, int], _RoundState] = {}
        self._map_lock = asyncio.Lock()
        self._decided_ttl_s = max(0.0, float(decided_ttl_s))
        self._max_decided_rounds = max(1, int(max_decided_rounds))

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
                    self._set_decision_locked(
                        state,
                        SyncCommitDecision(
                        committed=False,
                        commit_at=None,
                        reason=f"unknown_participant:{node_id}",
                        ),
                    )
                assert state.decision is not None
                return state.decision

            state.ready_nodes.add(node_id)
            if state.decision is None and state.ready_nodes.issuperset(state.participants):
                commit_at = time.monotonic() + (state.commit_lead_ms / 1000.0)
                self._set_decision_locked(
                    state,
                    SyncCommitDecision(
                    committed=True,
                    commit_at=commit_at,
                    reason="all_ready",
                    ),
                )

            while state.decision is None:
                remaining_s = state.timeout_deadline - time.monotonic()
                if remaining_s <= 0:
                    self._set_decision_locked(
                        state,
                        SyncCommitDecision(
                        committed=False,
                        commit_at=None,
                        reason="ready_timeout",
                        ),
                    )
                    break
                try:
                    await asyncio.wait_for(state.condition.wait(), timeout=remaining_s)
                except asyncio.TimeoutError:
                    continue

            assert state.decision is not None
            decision = state.decision

        await self._prune_decided_rounds()
        return decision

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
                self._set_decision_locked(
                    state,
                    SyncCommitDecision(
                        committed=False,
                        commit_at=None,
                        reason=reason,
                    ),
                )
        await self._prune_decided_rounds()

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

    @staticmethod
    def _set_decision_locked(state: _RoundState, decision: SyncCommitDecision) -> None:
        if state.decision is not None:
            return
        state.decision = decision
        state.finalized_at = time.monotonic()
        state.condition.notify_all()

    async def _prune_decided_rounds(self) -> None:
        now = time.monotonic()
        async with self._map_lock:
            decided_items = [
                (key, state)
                for key, state in self._rounds.items()
                if state.decision is not None
            ]

            # 先按 TTL 删除过期决策轮次。
            if self._decided_ttl_s > 0:
                expired_keys = [
                    key
                    for key, state in decided_items
                    if state.finalized_at is not None
                    and (now - state.finalized_at) >= self._decided_ttl_s
                ]
                for key in expired_keys:
                    self._rounds.pop(key, None)
                expired_key_set = set(expired_keys)
                decided_items = [
                    item for item in decided_items
                    if item[0] not in expired_key_set
                ]

            # 再按上限删除最旧的已决轮次。
            overflow = len(decided_items) - self._max_decided_rounds
            if overflow <= 0:
                return
            decided_items.sort(
                key=lambda item: (
                    item[1].finalized_at if item[1].finalized_at is not None else float("-inf")
                )
            )
            for key, _state in decided_items[:overflow]:
                self._rounds.pop(key, None)
