"""仓库级入口测试。"""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys


def test_repo_main_prints_backend_hint() -> None:
    """执行仓库根 main.py 应输出后端启动提示。"""
    repo_root = Path(__file__).resolve().parents[2]
    proc = subprocess.run(
        [sys.executable, "main.py"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=True,
    )
    assert "uvicorn app.main:app" in proc.stdout
