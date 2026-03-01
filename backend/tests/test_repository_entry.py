"""仓库级入口测试。"""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys


def test_repo_main_help_is_non_blocking_and_prints_cli_options() -> None:
    """执行仓库根 main.py --help 应快速返回并包含关键参数。"""
    repo_root = Path(__file__).resolve().parents[2]
    proc = subprocess.run(
        [sys.executable, "main.py", "--help"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=True,
        timeout=10,
    )
    assert "--backend-port" in proc.stdout
    assert "--frontend-port" in proc.stdout
