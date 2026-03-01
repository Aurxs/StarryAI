"""CLI smoke tests for Phase F perf baseline script."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def test_perf_baseline_script_generates_report(tmp_path: Path) -> None:
    script = _repo_root() / "backend" / "scripts" / "run_perf_baseline.py"
    output = tmp_path / "perf_report.json"
    proc = subprocess.run(
        [
            sys.executable,
            str(script),
            "--runs-per-scenario",
            "1",
            "--concurrency",
            "1",
            "--soak-seconds",
            "0",
            "--output",
            str(output),
        ],
        cwd=_repo_root(),
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    assert output.exists()
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["suite"]["name"] == "phase_f_perf_baseline"
    assert payload["suite"]["totals"]["runs"] == 3
    assert len(payload["scenarios"]) == 3
    assert "[PhaseF Perf]" in proc.stdout


def test_perf_baseline_script_rejects_invalid_runs_arg(tmp_path: Path) -> None:
    script = _repo_root() / "backend" / "scripts" / "run_perf_baseline.py"
    output = tmp_path / "perf_invalid.json"
    proc = subprocess.run(
        [
            sys.executable,
            str(script),
            "--runs-per-scenario",
            "0",
            "--concurrency",
            "1",
            "--output",
            str(output),
        ],
        cwd=_repo_root(),
        capture_output=True,
        text=True,
    )
    assert proc.returncode != 0
    assert "runs_per_scenario must be >= 1" in (proc.stderr + proc.stdout)
    assert not output.exists()

