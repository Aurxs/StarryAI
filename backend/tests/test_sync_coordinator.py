"""SyncCoordinator 行为测试。"""

from __future__ import annotations

import asyncio

from app.core.sync_coordinator import SyncCoordinator


def test_sync_coordinator_prunes_decisions_by_max_rounds() -> None:
    async def _run() -> None:
        coordinator = SyncCoordinator(decided_ttl_s=3600.0, max_decided_rounds=1)

        decision_0 = await coordinator.ready(
            run_id="run1",
            sync_group="g1",
            sync_round=0,
            node_id="n1",
            participants={"n1"},
            commit_lead_ms=1,
            ready_timeout_ms=200,
        )
        assert decision_0.committed is True
        assert decision_0.reason == "all_ready"

        decision_1 = await coordinator.ready(
            run_id="run1",
            sync_group="g1",
            sync_round=1,
            node_id="n1",
            participants={"n1"},
            commit_lead_ms=1,
            ready_timeout_ms=200,
        )
        assert decision_1.committed is True
        assert decision_1.reason == "all_ready"

        assert ("run1", "g1", 0) not in coordinator._rounds
        assert ("run1", "g1", 1) in coordinator._rounds
        assert len(coordinator._rounds) == 1

    asyncio.run(_run())


def test_sync_coordinator_prunes_decisions_by_ttl() -> None:
    async def _run() -> None:
        coordinator = SyncCoordinator(decided_ttl_s=0.001, max_decided_rounds=16)

        decision_0 = await coordinator.ready(
            run_id="run2",
            sync_group="g2",
            sync_round=0,
            node_id="n1",
            participants={"n1"},
            commit_lead_ms=1,
            ready_timeout_ms=200,
        )
        assert decision_0.committed is True
        assert decision_0.reason == "all_ready"

        await asyncio.sleep(0.01)

        decision_1 = await coordinator.ready(
            run_id="run2",
            sync_group="g2",
            sync_round=1,
            node_id="n1",
            participants={"n1"},
            commit_lead_ms=1,
            ready_timeout_ms=200,
        )
        assert decision_1.committed is True
        assert decision_1.reason == "all_ready"

        assert ("run2", "g2", 0) not in coordinator._rounds
        assert ("run2", "g2", 1) in coordinator._rounds

    asyncio.run(_run())
