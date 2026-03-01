"""Phase F performance baseline utility tests."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from app.perf.baseline import (
    build_latency_stats,
    build_phase_f_scenarios,
    run_phase_f_perf_baseline,
    write_perf_report,
)


def test_build_phase_f_scenarios_contains_expected_graphs() -> None:
    scenarios = build_phase_f_scenarios(runs_per_scenario=2, concurrency=1)
    assert [item.name for item in scenarios] == [
        "linear_async_chain",
        "sync_group_commit_chain",
        "wide_parallel_fanout",
    ]
    sync_graph = scenarios[1].graph
    assert any(node.type_name == "sync.initiator.dual" for node in sync_graph.nodes)
    wide_graph = scenarios[2].graph
    assert len(wide_graph.nodes) == 24
    assert len(wide_graph.edges) == 16


def test_build_latency_stats_handles_empty_and_single_values() -> None:
    empty = build_latency_stats([])
    assert empty == {
        "count": 0.0,
        "min": 0.0,
        "max": 0.0,
        "mean": 0.0,
        "median": 0.0,
        "p95": 0.0,
        "p99": 0.0,
    }

    single = build_latency_stats([12.5])
    assert single["count"] == 1.0
    assert single["min"] == 12.5
    assert single["max"] == 12.5
    assert single["p95"] == 12.5
    assert single["p99"] == 12.5


def test_write_perf_report_creates_parent_dir_and_json_payload(tmp_path: Path) -> None:
    target = tmp_path / "nested" / "perf_report.json"
    payload = {"suite": {"name": "phase_f_perf_baseline"}, "scenarios": []}
    written = write_perf_report(target, payload)
    assert written == target.resolve()
    loaded = json.loads(target.read_text(encoding="utf-8"))
    assert loaded == payload


def test_run_phase_f_perf_baseline_with_small_load() -> None:
    async def _run() -> None:
        report = await run_phase_f_perf_baseline(
            runs_per_scenario=1,
            concurrency=1,
            soak_seconds=0,
        )
        assert report["suite"]["name"] == "phase_f_perf_baseline"
        assert report["suite"]["totals"]["runs"] == 3
        assert len(report["scenarios"]) == 3
        assert all(item["runs"] == 1 for item in report["scenarios"])
        assert all(item["latency_ms"]["count"] == 1.0 for item in report["scenarios"])

    asyncio.run(_run())


@pytest.mark.parametrize(
    ("runs_per_scenario", "concurrency", "soak_seconds"),
    [
        (0, 1, 0),
        (1, 0, 0),
        (1, 1, -1),
    ],
)
def test_run_phase_f_perf_baseline_rejects_invalid_args(
    runs_per_scenario: int,
    concurrency: int,
    soak_seconds: int,
) -> None:
    async def _run() -> None:
        with pytest.raises(ValueError):
            await run_phase_f_perf_baseline(
                runs_per_scenario=runs_per_scenario,
                concurrency=concurrency,
                soak_seconds=soak_seconds,
            )

    asyncio.run(_run())
