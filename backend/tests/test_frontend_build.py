"""前端构建烟雾测试。"""

from __future__ import annotations

from pathlib import Path
import shutil
import subprocess

import pytest


def test_frontend_build_succeeds() -> None:
    """frontend 应可在当前依赖下完成构建。"""
    npm = shutil.which("npm")
    if npm is None:
        pytest.skip("npm not found in PATH")

    repo_root = Path(__file__).resolve().parents[2]
    frontend_dir = repo_root / "frontend"
    if not (frontend_dir / "package.json").exists():
        pytest.skip("frontend package.json not found")

    proc = subprocess.run(
        [npm, "run", "build"],
        cwd=frontend_dir,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, f"frontend build failed\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
