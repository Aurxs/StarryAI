"""Run Phase F baseline benchmarks and write JSON report."""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.perf.baseline import run_phase_f_perf_baseline, write_perf_report  # noqa: E402


def _build_default_output_path() -> Path:
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    return Path("artifacts/perf") / f"phase_f_perf_{timestamp}.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run StarryAI Phase F performance baseline")
    parser.add_argument(
        "--runs-per-scenario",
        type=int,
        default=30,
        help="How many runs to execute for each scenario (default: 30)",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=8,
        help="Max concurrent runs within each scenario (default: 8)",
    )
    parser.add_argument(
        "--soak-seconds",
        type=int,
        default=0,
        help="Optional duration-based soak benchmark in seconds (default: 0, disabled)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=_build_default_output_path(),
        help="Output report path (default: artifacts/perf/phase_f_perf_<timestamp>.json)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    report = asyncio.run(
        run_phase_f_perf_baseline(
            runs_per_scenario=args.runs_per_scenario,
            concurrency=args.concurrency,
            soak_seconds=args.soak_seconds,
        )
    )
    target = write_perf_report(args.output, report)

    suite = report["suite"]
    totals = suite["totals"]
    print(
        "[PhaseF Perf]",
        f"runs={totals['runs']}",
        f"completed={totals['completed']}",
        f"success_rate={totals['success_rate']}",
        f"throughput={totals['throughput_runs_per_s']} runs/s",
    )
    print(f"[PhaseF Perf] report={target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
