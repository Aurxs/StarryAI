"""运维与观测接口。"""

from __future__ import annotations

from fastapi import APIRouter, Response

from app.services.run_service import get_run_service

router = APIRouter(tags=["observability"])


def _escape_label_value(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _render_prometheus_metrics(metrics: dict[str, object]) -> str:
    status_counts_raw = metrics.get("runs_status_counts")
    status_counts: dict[str, int] = (
        status_counts_raw if isinstance(status_counts_raw, dict) else {}
    )
    lines: list[str] = [
        "# HELP starryai_runs_retained Current retained run records.",
        "# TYPE starryai_runs_retained gauge",
        f"starryai_runs_retained {metrics['runs_retained']}",
        "# HELP starryai_runs_active Current active running tasks.",
        "# TYPE starryai_runs_active gauge",
        f"starryai_runs_active {metrics['runs_active']}",
        "# HELP starryai_runs_status Current run counts by status label.",
        "# TYPE starryai_runs_status gauge",
        "# HELP starryai_runs_completed_total Completed runs retained in memory.",
        "# TYPE starryai_runs_completed_total gauge",
        f"starryai_runs_completed_total {metrics['runs_completed']}",
        "# HELP starryai_runs_failed_total Failed runs retained in memory.",
        "# TYPE starryai_runs_failed_total gauge",
        f"starryai_runs_failed_total {metrics['runs_failed']}",
        "# HELP starryai_runs_stopped_total Stopped runs retained in memory.",
        "# TYPE starryai_runs_stopped_total gauge",
        f"starryai_runs_stopped_total {metrics['runs_stopped']}",
        "# HELP starryai_run_capacity_limit Configured max_active_runs (0 means unlimited).",
        "# TYPE starryai_run_capacity_limit gauge",
        f"starryai_run_capacity_limit {metrics['run_capacity_limit']}",
        "# HELP starryai_run_capacity_utilization Active runs / capacity limit (0 when limit is disabled).",
        "# TYPE starryai_run_capacity_utilization gauge",
        f"starryai_run_capacity_utilization {metrics['run_capacity_utilization']}",
        "# HELP starryai_events_total_total Aggregated runtime events across retained runs.",
        "# TYPE starryai_events_total_total counter",
        f"starryai_events_total_total {metrics['events_total']}",
        "# HELP starryai_events_retained_total Aggregated retained events across retained runs.",
        "# TYPE starryai_events_retained_total gauge",
        f"starryai_events_retained_total {metrics['events_retained']}",
        "# HELP starryai_events_dropped_total Aggregated dropped events across retained runs.",
        "# TYPE starryai_events_dropped_total counter",
        f"starryai_events_dropped_total {metrics['events_dropped']}",
        "# HELP starryai_events_drop_ratio Aggregated dropped-event ratio across retained runs.",
        "# TYPE starryai_events_drop_ratio gauge",
        f"starryai_events_drop_ratio {metrics['events_drop_ratio']}",
        "# HELP starryai_events_retention_ratio Aggregated retained-event ratio across retained runs.",
        "# TYPE starryai_events_retention_ratio gauge",
        f"starryai_events_retention_ratio {metrics['events_retention_ratio']}",
        "# HELP starryai_recommend_capacity_utilization_warning Suggested warning threshold for capacity utilization.",
        "# TYPE starryai_recommend_capacity_utilization_warning gauge",
        "starryai_recommend_capacity_utilization_warning 0.8",
        "# HELP starryai_recommend_events_drop_ratio_warning Suggested warning threshold for events_drop_ratio.",
        "# TYPE starryai_recommend_events_drop_ratio_warning gauge",
        "starryai_recommend_events_drop_ratio_warning 0.05",
    ]
    for status_name in sorted(status_counts.keys()):
        lines.append(
            f'starryai_runs_status{{status="{_escape_label_value(status_name)}"}} {int(status_counts[status_name])}'
        )
    return "\n".join(lines) + "\n"


@router.get("/metrics")
async def get_metrics() -> Response:
    """Prometheus 文本格式指标导出。"""
    service = get_run_service()
    metrics = service.get_service_metrics_snapshot()
    payload = _render_prometheus_metrics(metrics)
    return Response(content=payload, media_type="text/plain; version=0.0.4; charset=utf-8")
