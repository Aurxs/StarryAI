"""StarryAI 一键启动入口。

用法：
    python main.py

默认行为：
1) 启动后端（uvicorn, 127.0.0.1:8000）
2) 启动前端（vite dev, 127.0.0.1:5173）
3) Ctrl+C 时优雅退出两个子进程
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import platform
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import TextIO

REPO_ROOT = Path(__file__).resolve().parent
BACKEND_DIR = REPO_ROOT / "backend"
FRONTEND_DIR = REPO_ROOT / "frontend"
USE_COLOR = True


def _resolve_use_color(color_mode: str) -> bool:
    """解析颜色模式开关。"""
    mode = color_mode.strip().lower()
    if mode == "always":
        return True
    if mode == "never":
        return False

    if os.getenv("NO_COLOR"):
        return False
    if os.getenv("CLICOLOR_FORCE") == "1":
        return True
    if os.getenv("FORCE_COLOR"):
        return True
    return sys.stdout.isatty() and os.getenv("TERM", "").lower() != "dumb"


def _colorize(text: str, color_code: str) -> str:
    """按需给文本添加 ANSI 颜色。"""
    if not USE_COLOR:
        return text
    return f"\033[{color_code}m{text}\033[0m"


def _format_prefix(prefix: str) -> str:
    """按模块类型渲染带颜色的日志前缀。"""
    color_map = {
        "launcher": "1;35",  # bright magenta
        "backend": "1;32",  # bright green
        "frontend": "1;36",  # bright cyan
    }
    color_code = color_map.get(prefix, "1;37")
    return _colorize(f"[{prefix}]", color_code)


def _log(prefix: str, message: str) -> None:
    """统一日志输出格式。"""
    print(f"{_format_prefix(prefix)} {message}")


def _prefixed_stream_reader(stream: TextIO, prefix: str) -> None:
    """将子进程输出按行加前缀打印，便于区分来源。"""
    try:
        for line in iter(stream.readline, ""):
            print(f"{_format_prefix(prefix)} {line}", end="")
    finally:
        stream.close()


def _spawn_process(
        cmd: list[str],
        cwd: Path,
        env: dict[str, str],
        name: str,
) -> subprocess.Popen[str]:
    process = subprocess.Popen(
        cmd,
        cwd=str(cwd),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    if process.stdout is None:
        raise RuntimeError(f"{name} 启动失败：stdout 管道不可用。")
    thread = threading.Thread(
        target=_prefixed_stream_reader,
        args=(process.stdout, name),
        daemon=True,
    )
    thread.start()
    return process


def _check_required_commands() -> None:
    if shutil.which("npm") is None:
        raise RuntimeError("未找到 `npm`，请先安装 Node.js（包含 npm）。")
    if shutil.which(sys.executable) is None:
        raise RuntimeError("当前 Python 可执行文件不可用。")


def _ensure_frontend_deps(frontend_dir: Path) -> None:
    node_modules = frontend_dir / "node_modules"
    if node_modules.exists():
        return

    _log("launcher", "检测到 frontend/node_modules 不存在，正在执行 npm install ...")
    install_cmd = ["npm", "install"]
    result = subprocess.run(
        install_cmd,
        cwd=str(frontend_dir),
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError("前端依赖安装失败，请手动执行 `cd frontend && npm install`。")


def _ensure_python_deps(repo_root: Path) -> None:
    required_modules = ("fastapi", "uvicorn")
    missing = [name for name in required_modules if importlib.util.find_spec(name) is None]
    if not missing:
        return

    _log(
        "launcher",
        "检测到 Python 依赖缺失："
        f"{', '.join(missing)}，正在执行 pip install -r requirements.txt ...",
    )
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", "-r", str(repo_root / "requirements.txt")],
        cwd=str(repo_root),
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "Python 依赖安装失败，请手动执行 "
            f"`{sys.executable} -m pip install -r requirements.txt`。"
        )


def _terminate_process(process: subprocess.Popen[str], name: str) -> None:
    if process.poll() is not None:
        return

    _log("launcher", f"正在停止 {name} ...")
    if platform.system().lower().startswith("win"):
        process.send_signal(signal.CTRL_BREAK_EVENT)
    else:
        process.terminate()

    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        _log("launcher", f"{name} 退出超时，强制结束。")
        process.kill()
        process.wait(timeout=3)


def run_launcher(host: str, backend_port: int, frontend_port: int, color_mode: str) -> int:
    global USE_COLOR
    USE_COLOR = _resolve_use_color(color_mode)

    _check_required_commands()
    _ensure_python_deps(REPO_ROOT)
    _ensure_frontend_deps(FRONTEND_DIR)

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    if USE_COLOR:
        # 强制子进程保留颜色输出，并移除与 FORCE_COLOR 冲突的变量。
        env["FORCE_COLOR"] = "1"
        env["CLICOLOR_FORCE"] = "1"
        env.pop("NO_COLOR", None)

    backend_cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "app.main:app",
        "--reload",
        "--use-colors",
        "--host",
        host,
        "--port",
        str(backend_port),
        "--app-dir",
        str(BACKEND_DIR),
    ]
    frontend_cmd = [
        "npm",
        "run",
        "dev",
        "--",
        "--host",
        host,
        "--port",
        str(frontend_port),
    ]

    _log("launcher", f"Backend:  http://{host}:{backend_port}")
    _log("launcher", f"Frontend: http://{host}:{frontend_port}")
    _log("launcher", "按 Ctrl+C 可同时停止前后端。")

    backend_proc = _spawn_process(backend_cmd, REPO_ROOT, env, "backend")
    frontend_proc = _spawn_process(frontend_cmd, FRONTEND_DIR, env, "frontend")

    procs = [("backend", backend_proc), ("frontend", frontend_proc)]

    try:
        while True:
            for name, proc in procs:
                code = proc.poll()
                if code is not None:
                    _log("launcher", f"{name} 已退出（code={code}），正在关闭其余进程。")
                    for other_name, other_proc in procs:
                        if other_proc is not proc:
                            _terminate_process(other_proc, other_name)
                    return code if code != 0 else 0
            time.sleep(0.3)
    except KeyboardInterrupt:
        print()
        _log("launcher", "收到中断信号，正在停止所有进程...")
        for name, proc in procs:
            _terminate_process(proc, name)
        return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="一键启动 StarryAI 前后端开发环境。")
    parser.add_argument("--host", default="127.0.0.1", help="前后端监听地址，默认 127.0.0.1")
    parser.add_argument(
        "--backend-port",
        type=int,
        default=8000,
        help="后端端口，默认 8000",
    )
    parser.add_argument(
        "--frontend-port",
        type=int,
        default=5173,
        help="前端端口，默认 5173",
    )
    parser.add_argument(
        "--color",
        choices=["auto", "always", "never"],
        default="always",
        help="日志颜色模式，默认 always",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    raise SystemExit(
        run_launcher(
            host=args.host,
            backend_port=args.backend_port,
            frontend_port=args.frontend_port,
            color_mode=args.color,
        )
    )
