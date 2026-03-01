"""Phase F performance baseline runner.

This module provides:
1. Canonical benchmark graph scenarios.
2. Concurrent scenario execution over RunService.
3. JSON report generation helpers.
"""

from __future__ import annotations

import asyncio
import json
import os
import platform
import statistics
import sys
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.core.spec import EdgeSpec, GraphSpec, NodeInstanceSpec
from app.services.run_service import RunService


@dataclass(slots=True, frozen=True)
class PerfScenario:
    """Single benchmark scenario definition."""

    name: str
    graph: GraphSpec
    runs: int
    concurrency: int
    description: str


@dataclass(slots=True)
class PerfScenarioResult:
    """Scenario execution result."""

    name: str
    description: str
    runs: int
    concurrency: int
    started_at: float
    ended_at: float
    status_counts: dict[str, int] = field(default_factory=dict)
    latency_ms: list[float] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    graph_metrics_samples: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Serialize report payload."""
        return {
            "name": self.name,
            "description": self.description,
            "runs": self.runs,
            "concurrency": self.concurrency,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "duration_s": round(max(0.0, self.ended_at - self.started_at), 4),
            "status_counts": dict(self.status_counts),
            "errors": list(self.errors),
            "latency_ms": build_latency_stats(self.latency_ms),
            "graph_metrics_samples": list(self.graph_metrics_samples[:5]),
        }


def _normalize_positive_int(name: str, value: int, *, minimum: int = 1) -> int:
    if not isinstance(value, int):
        raise ValueError(f"{name} must be int, got {type(value).__name__}")
    if value < minimum:
        raise ValueError(f"{name} must be >= {minimum}, got {value}")
    return value


def _build_linear_chain_graph(graph_id: str) -> GraphSpec:
    return GraphSpec(
        graph_id=graph_id,
        nodes=[
            NodeInstanceSpec(node_id="n1", type_name="mock.input"),
            NodeInstanceSpec(node_id="n2", type_name="mock.llm"),
            NodeInstanceSpec(node_id="n3", type_name="mock.output"),
        ],
        edges=[
            EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="prompt"),
            EdgeSpec(source_node="n2", source_port="answer", target_node="n3", target_port="in"),
        ],
    )


def _build_sync_graph(graph_id: str) -> GraphSpec:
    return GraphSpec(
        graph_id=graph_id,
        nodes=[
            NodeInstanceSpec(node_id="n1", type_name="mock.input"),
            NodeInstanceSpec(node_id="n2", type_name="mock.tts"),
            NodeInstanceSpec(node_id="n3", type_name="mock.motion"),
            NodeInstanceSpec(node_id="n4", type_name="sync.timeline"),
            NodeInstanceSpec(node_id="n5", type_name="mock.output"),
        ],
        edges=[
            EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="text"),
            EdgeSpec(source_node="n1", source_port="text", target_node="n3", target_port="text"),
            EdgeSpec(source_node="n2", source_port="audio", target_node="n4", target_port="audio"),
            EdgeSpec(source_node="n3", source_port="motion", target_node="n4", target_port="motion"),
            EdgeSpec(source_node="n4", source_port="sync", target_node="n5", target_port="in"),
        ],
    )


def _build_wide_parallel_graph(graph_id: str, branches: int = 8) -> GraphSpec:
    branches = _normalize_positive_int("branches", branches)
    nodes: list[NodeInstanceSpec] = []
    edges: list[EdgeSpec] = []
    for index in range(branches):
        idx = index + 1
        input_id = f"i{idx}"
        llm_id = f"l{idx}"
        output_id = f"o{idx}"
        nodes.extend(
            [
                NodeInstanceSpec(node_id=input_id, type_name="mock.input"),
                NodeInstanceSpec(node_id=llm_id, type_name="mock.llm"),
                NodeInstanceSpec(node_id=output_id, type_name="mock.output"),
            ]
        )
        edges.extend(
            [
                EdgeSpec(
                    source_node=input_id,
                    source_port="text",
                    target_node=llm_id,
                    target_port="prompt",
                ),
                EdgeSpec(
                    source_node=llm_id,
                    source_port="answer",
                    target_node=output_id,
                    target_port="in",
                ),
            ]
        )

    return GraphSpec(graph_id=graph_id, nodes=nodes, edges=edges)


def build_phase_f_scenarios(
    *,
    runs_per_scenario: int = 30,
    concurrency: int = 8,
) -> list[PerfScenario]:
    """Build default Phase F benchmark scenario set."""
    normalized_runs = _normalize_positive_int("runs_per_scenario", runs_per_scenario)
    normalized_concurrency = _normalize_positive_int("concurrency", concurrency)
    return [
        PerfScenario(
            name="linear_async_chain",
            graph=_build_linear_chain_graph("perf_linear_async_chain"),
            runs=normalized_runs,
            concurrency=normalized_concurrency,
            description="mock.input -> mock.llm -> mock.output",
        ),
        PerfScenario(
            name="sync_timeline_chain",
            graph=_build_sync_graph("perf_sync_timeline_chain"),
            runs=normalized_runs,
            concurrency=normalized_concurrency,
            description="mock.input fanout + sync.timeline merge path",
        ),
        PerfScenario(
            name="wide_parallel_fanout",
            graph=_build_wide_parallel_graph("perf_wide_parallel_fanout", branches=8),
            runs=normalized_runs,
            concurrency=normalized_concurrency,
            description="8 independent chains in one DAG run",
        ),
    ]


def _percentile(sorted_values: list[float], percentile: float) -> float:
    if not sorted_values:
        return 0.0
    if percentile <= 0:
        return sorted_values[0]
    if percentile >= 100:
        return sorted_values[-1]
    position = (len(sorted_values) - 1) * percentile / 100.0
    lower = int(position)
    upper = min(lower + 1, len(sorted_values) - 1)
    if lower == upper:
        return sorted_values[lower]
    weight = position - lower
    return sorted_values[lower] * (1 - weight) + sorted_values[upper] * weight


def build_latency_stats(values: list[float]) -> dict[str, float]:
    """Build latency summary stats from raw ms values."""
    if not values:
        return {
            "count": 0.0,
            "min": 0.0,
            "max": 0.0,
            "mean": 0.0,
            "median": 0.0,
            "p95": 0.0,
            "p99": 0.0,
        }
    sorted_values = sorted(values)
    return {
        "count": float(len(sorted_values)),
        "min": round(sorted_values[0], 4),
        "max": round(sorted_values[-1], 4),
        "mean": round(statistics.fmean(sorted_values), 4),
        "median": round(statistics.median(sorted_values), 4),
        "p95": round(_percentile(sorted_values, 95), 4),
        "p99": round(_percentile(sorted_values, 99), 4),
    }


async def execute_scenario(
    service: RunService,
    scenario: PerfScenario,
    *,
    stream_prefix: str = "stream_perf",
    run_timeout_s: float = 20.0,
) -> PerfScenarioResult:
    """Execute one scenario with bounded concurrency."""
    _normalize_positive_int("scenario.runs", scenario.runs)
    _normalize_positive_int("scenario.concurrency", scenario.concurrency)
    if run_timeout_s <= 0:
        raise ValueError("run_timeout_s must be > 0")

    started_at = time.time()
    semaphore = asyncio.Semaphore(scenario.concurrency)
    statuses: Counter[str] = Counter()
    latencies_ms: list[float] = []
    errors: list[str] = []
    graph_metrics_samples: list[dict[str, Any]] = []

    async def _run_once(index: int) -> None:
        async with semaphore:
            run_started = time.perf_counter()
            stream_id = f"{stream_prefix}_{scenario.name}_{index}"
            try:
                record = await service.create_run(scenario.graph, stream_id=stream_id)
                try:
                    await asyncio.wait_for(asyncio.shield(record.task), timeout=run_timeout_s)
                except asyncio.TimeoutError:
                    errors.append(f"run timeout: scenario={scenario.name} index={index}")
                    await service.stop_run(record.run_id, timeout_s=0.2)

                snapshot = service.get_run_snapshot(record.run_id)
                statuses[str(snapshot["status"])] += 1
                metrics = snapshot.get("metrics")
                if isinstance(metrics, dict):
                    graph_metrics_samples.append(metrics)
            except Exception as exc:  # noqa: BLE001 - benchmark should collect failures
                statuses["create_failed"] += 1
                errors.append(f"run create failed: scenario={scenario.name} index={index}: {exc}")
            finally:
                run_ended = time.perf_counter()
                latencies_ms.append((run_ended - run_started) * 1000.0)

    await asyncio.gather(*[_run_once(i) for i in range(scenario.runs)])
    ended_at = time.time()
    return PerfScenarioResult(
        name=scenario.name,
        description=scenario.description,
        runs=scenario.runs,
        concurrency=scenario.concurrency,
        started_at=started_at,
        ended_at=ended_at,
        status_counts=dict(statuses),
        latency_ms=latencies_ms,
        errors=errors,
        graph_metrics_samples=graph_metrics_samples,
    )


async def run_phase_f_perf_baseline(
    *,
    runs_per_scenario: int = 30,
    concurrency: int = 8,
    soak_seconds: int = 0,
) -> dict[str, Any]:
    """Run the initial Phase F benchmark suite and return JSON-ready report."""
    normalized_runs = _normalize_positive_int("runs_per_scenario", runs_per_scenario)
    normalized_concurrency = _normalize_positive_int("concurrency", concurrency)
    if soak_seconds < 0:
        raise ValueError(f"soak_seconds must be >= 0, got {soak_seconds}")

    service = RunService(max_retained_runs=10_000, retention_ttl_s=86_400.0)
    suite_started_at = time.time()
    scenario_results: list[PerfScenarioResult] = []

    scenarios = build_phase_f_scenarios(
        runs_per_scenario=normalized_runs,
        concurrency=normalized_concurrency,
    )
    for scenario in scenarios:
        scenario_results.append(await execute_scenario(service, scenario))

    if soak_seconds > 0:
        soak_scenario = PerfScenario(
            name="soak_sync_timeline",
            graph=_build_sync_graph("perf_soak_sync_timeline"),
            runs=1,
            concurrency=max(1, min(normalized_concurrency, 4)),
            description="duration-based repeated sync.timeline runs",
        )
        soak_started = time.time()
        soak_deadline = time.monotonic() + soak_seconds
        soak_runs = 0
        soak_statuses: Counter[str] = Counter()
        soak_latencies: list[float] = []
        soak_errors: list[str] = []
        while time.monotonic() < soak_deadline:
            once = await execute_scenario(
                service,
                PerfScenario(
                    name=soak_scenario.name,
                    graph=soak_scenario.graph,
                    runs=1,
                    concurrency=soak_scenario.concurrency,
                    description=soak_scenario.description,
                ),
                stream_prefix="stream_perf_soak",
            )
            soak_runs += 1
            soak_statuses.update(once.status_counts)
            soak_latencies.extend(once.latency_ms)
            soak_errors.extend(once.errors)

        scenario_results.append(
            PerfScenarioResult(
                name=soak_scenario.name,
                description=soak_scenario.description,
                runs=soak_runs,
                concurrency=soak_scenario.concurrency,
                started_at=soak_started,
                ended_at=time.time(),
                status_counts=dict(soak_statuses),
                latency_ms=soak_latencies,
                errors=soak_errors,
                graph_metrics_samples=[],
            )
        )

    suite_ended_at = time.time()
    total_runs = sum(item.runs for item in scenario_results)
    total_completed = sum(item.status_counts.get("completed", 0) for item in scenario_results)
    suite_duration_s = max(0.0001, suite_ended_at - suite_started_at)
    return {
        "suite": {
            "name": "phase_f_perf_baseline",
            "generated_at": datetime.now(UTC).isoformat(),
            "started_at": suite_started_at,
            "ended_at": suite_ended_at,
            "duration_s": round(suite_duration_s, 4),
            "config": {
                "runs_per_scenario": normalized_runs,
                "concurrency": normalized_concurrency,
                "soak_seconds": soak_seconds,
            },
            "environment": {
                "python_version": sys.version.split()[0],
                "platform": platform.platform(),
                "cpu_count": os.cpu_count(),
            },
            "totals": {
                "runs": total_runs,
                "completed": total_completed,
                "success_rate": round((total_completed / total_runs) if total_runs else 0.0, 6),
                "throughput_runs_per_s": round(total_runs / suite_duration_s, 4),
            },
        },
        "scenarios": [result.to_dict() for result in scenario_results],
    }


def write_perf_report(path: str | Path, report: dict[str, Any]) -> Path:
    """Write benchmark report JSON to disk."""
    target = Path(path).expanduser().resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True)
    target.write_text(payload + "\n", encoding="utf-8")
    return target

