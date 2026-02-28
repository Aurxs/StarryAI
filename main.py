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
import atexit
import functools
import importlib.util
import locale
import os
import platform
import shutil
import signal
import socket
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
IS_ZH = False

MESSAGES = {
    "spawn_failed": {
        "zh": "{name} 启动失败：stdout 管道不可用。",
        "en": "{name} failed to start: stdout pipe is unavailable.",
    },
    "python_too_low": {
        "zh": "Python 版本过低：需要 >= 3.12，当前为 {current}。",
        "en": "Python version too low: requires >= 3.12, current is {current}.",
    },
    "npm_not_found": {
        "zh": "未找到 `npm`，请先安装 Node.js（包含 npm）。",
        "en": "`npm` not found. Please install Node.js (including npm) first.",
    },
    "python_exec_unavailable": {
        "zh": "当前 Python 可执行文件不可用。",
        "en": "The current Python executable is unavailable.",
    },
    "frontend_deps_missing_installing": {
        "zh": "检测到 frontend/node_modules 不存在，正在执行 npm install ...",
        "en": "Detected missing frontend/node_modules, running npm install ...",
    },
    "frontend_install_failed": {
        "zh": "前端依赖安装失败，请手动执行 `cd frontend && npm install`。",
        "en": "Frontend dependency installation failed. Run `cd frontend && npm install` manually.",
    },
    "python_deps_missing_installing": {
        "zh": "检测到 Python 依赖缺失：{missing}，正在执行 pip install -r requirements.txt ...",
        "en": "Detected missing Python dependencies: {missing}. Running pip install -r requirements.txt ...",
    },
    "python_install_failed": {
        "zh": "Python 依赖安装失败，请手动执行 `{cmd}`。",
        "en": "Python dependency installation failed. Run `{cmd}` manually.",
    },
    "stopping_process": {
        "zh": "正在停止 {name} ...",
        "en": "Stopping {name} ...",
    },
    "process_stop_timeout": {
        "zh": "{name} 退出超时，强制结束。",
        "en": "{name} did not exit in time, forcing termination.",
    },
    "press_ctrl_c": {
        "zh": "按 Ctrl+C 可同时停止前后端。",
        "en": "Press Ctrl+C to stop backend and frontend together.",
    },
    "process_exited": {
        "zh": "{name} 已退出（code={code}），正在关闭其余进程。",
        "en": "{name} exited (code={code}), shutting down remaining process.",
    },
    "interrupt_received": {
        "zh": "收到中断信号，正在停止所有进程...",
        "en": "Interrupt received, stopping all processes...",
    },
    "signal_received": {
        "zh": "收到信号 {signal}，正在停止所有进程...",
        "en": "Received signal {signal}, stopping all processes...",
    },
    "backend_url": {
        "zh": "后端:  http://{host}:{port}",
        "en": "Backend:  http://{host}:{port}",
    },
    "frontend_url": {
        "zh": "前端: http://{host}:{port}",
        "en": "Frontend: http://{host}:{port}",
    },
    "port_busy_switching": {
        "zh": "{name} 端口 {old_port} 已被占用，自动切换到 {new_port}。",
        "en": "{name} port {old_port} is in use, switching to {new_port}.",
    },
    "port_unavailable": {
        "zh": "无法为 {name} 找到可用端口（起始端口 {start_port}，尝试 {tries} 次）。",
        "en": "Unable to find an available port for {name} (start {start_port}, tried {tries} ports).",
    },
    "arg_desc": {
        "zh": "一键启动 StarryAI 前后端开发环境。",
        "en": "One-command launcher for StarryAI backend and frontend dev environment.",
    },
    "arg_host_help": {
        "zh": "前后端监听地址，默认 127.0.0.1",
        "en": "Host address for backend and frontend. Default: 127.0.0.1",
    },
    "arg_backend_port_help": {
        "zh": "后端端口，默认 8000",
        "en": "Backend port. Default: 8000",
    },
    "arg_frontend_port_help": {
        "zh": "前端端口，默认 5173",
        "en": "Frontend port. Default: 5173",
    },
    "arg_color_help": {
        "zh": "日志颜色模式，默认 always",
        "en": "Log color mode. Default: always",
    },
}


def _msg(key: str, **kwargs: object) -> str:
    lang = "zh" if IS_ZH else "en"
    template = MESSAGES[key][lang]
    return template.format(**kwargs)


def _read_macos_lang() -> str:
    if platform.system() != "Darwin":
        return ""

    try:
        result = subprocess.run(
            ["defaults", "read", "-g", "AppleLanguages"],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0:
            # 输出通常形如：
            # (
            #     "zh-Hans-CN",
            #     "en-US"
            # )
            for raw_line in result.stdout.splitlines():
                line = raw_line.strip().strip(",")
                if not line or line in {"(", ")"}:
                    continue
                return line.strip('"').strip("'")
    except Exception:
        pass

    try:
        result = subprocess.run(
            ["defaults", "read", "-g", "AppleLocale"],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass

    return ""


def _is_zh_lang_code(lang: str) -> bool:
    return lang.strip().lower().replace("_", "-").startswith("zh")


@functools.lru_cache(maxsize=1)
def _is_chinese_system_language() -> bool:
    """根据系统语言判断是否应显示中文。"""
    macos_lang = _read_macos_lang()
    if macos_lang:
        return _is_zh_lang_code(macos_lang)

    env_langs = (
        os.getenv("LC_ALL", ""),
        os.getenv("LC_MESSAGES", ""),
        os.getenv("LANG", ""),
    )
    if any(_is_zh_lang_code(lang) for lang in env_langs if lang):
        return True

    locale_langs: list[str] = []
    try:
        locale_langs.append(locale.getlocale()[0] or "")
    except Exception:
        pass

    return any(_is_zh_lang_code(lang) for lang in locale_langs if lang)


def _is_port_available(host: str, port: int) -> bool:
    try:
        addr_infos = socket.getaddrinfo(
            host,
            port,
            family=socket.AF_UNSPEC,
            type=socket.SOCK_STREAM,
        )
    except OSError:
        return False

    for family, sock_type, proto, _, sockaddr in addr_infos:
        try:
            with socket.socket(family, sock_type, proto) as sock:
                if family == socket.AF_INET6:
                    try:
                        # 避免双栈行为导致与 IPv4 端口占用状态互相干扰。
                        sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
                    except OSError:
                        pass
                sock.bind(sockaddr)
                return True
        except (OSError, OverflowError):
            continue
    return False


def _pick_available_port(
    name: str,
    host: str,
    start_port: int,
    tries: int = 50,
    excluded_ports: set[int] | None = None,
) -> int:
    blocked_ports = excluded_ports or set()
    for offset in range(tries):
        candidate = start_port + offset
        if not 0 <= candidate <= 65535:
            continue
        if candidate in blocked_ports:
            continue
        if _is_port_available(host, candidate):
            if candidate != start_port:
                _log(
                    "launcher",
                    _msg("port_busy_switching", name=name, old_port=start_port, new_port=candidate),
                )
            return candidate

    raise RuntimeError(
        _msg("port_unavailable", name=name, start_port=start_port, tries=tries)
    )


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
    is_windows = platform.system().lower().startswith("win")
    creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) if is_windows else 0
    process = subprocess.Popen(
        cmd,
        cwd=str(cwd),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        start_new_session=not is_windows,
        creationflags=creationflags,
    )
    if process.stdout is None:
        raise RuntimeError(_msg("spawn_failed", name=name))
    thread = threading.Thread(
        target=_prefixed_stream_reader,
        args=(process.stdout, name),
        daemon=True,
    )
    thread.start()
    return process


def _check_required_commands() -> None:
    if sys.version_info < (3, 12):
        current = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        raise RuntimeError(_msg("python_too_low", current=current))
    if shutil.which("npm") is None:
        raise RuntimeError(_msg("npm_not_found"))
    if shutil.which(sys.executable) is None:
        raise RuntimeError(_msg("python_exec_unavailable"))


def _ensure_frontend_deps(frontend_dir: Path) -> None:
    node_modules = frontend_dir / "node_modules"
    if node_modules.exists():
        return

    _log("launcher", _msg("frontend_deps_missing_installing"))
    install_cmd = ["npm", "install"]
    result = subprocess.run(
        install_cmd,
        cwd=str(frontend_dir),
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(_msg("frontend_install_failed"))


def _ensure_python_deps(repo_root: Path) -> None:
    required_modules = ("fastapi", "uvicorn")
    missing = [name for name in required_modules if importlib.util.find_spec(name) is None]
    if not missing:
        return

    _log(
        "launcher",
        _msg("python_deps_missing_installing", missing=", ".join(missing)),
    )
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", "-r", str(repo_root / "requirements.txt")],
        cwd=str(repo_root),
        text=True,
    )
    if result.returncode != 0:
        cmd = f"{sys.executable} -m pip install -r requirements.txt"
        raise RuntimeError(_msg("python_install_failed", cmd=cmd))


def _terminate_process(process: subprocess.Popen[str], name: str) -> None:
    if process.poll() is not None:
        return

    is_windows = platform.system().lower().startswith("win")
    _log("launcher", _msg("stopping_process", name=name))
    if is_windows:
        try:
            process.send_signal(signal.CTRL_BREAK_EVENT)
        except Exception:
            process.terminate()
    else:
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
        except ProcessLookupError:
            return
        except Exception:
            process.terminate()

    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        _log("launcher", _msg("process_stop_timeout", name=name))
        if is_windows:
            process.kill()
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        else:
            try:
                os.killpg(os.getpgid(process.pid), signal.SIGKILL)
            except ProcessLookupError:
                return
            except Exception:
                process.kill()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            pass


def run_launcher(host: str, backend_port: int, frontend_port: int, color_mode: str) -> int:
    global USE_COLOR
    global IS_ZH
    IS_ZH = _is_chinese_system_language()
    USE_COLOR = _resolve_use_color(color_mode)

    _check_required_commands()
    _ensure_python_deps(REPO_ROOT)
    _ensure_frontend_deps(FRONTEND_DIR)
    backend_port = _pick_available_port("backend", host, backend_port)
    frontend_port = _pick_available_port(
        "frontend",
        host,
        frontend_port,
        excluded_ports={backend_port},
    )

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    if USE_COLOR:
        # 强制子进程保留颜色输出，并移除与 FORCE_COLOR 冲突的变量。
        env["FORCE_COLOR"] = "1"
        env["CLICOLOR_FORCE"] = "1"
        env.pop("NO_COLOR", None)
    else:
        # 明确关闭子进程颜色，避免继承外部环境导致配置不一致。
        env.pop("FORCE_COLOR", None)
        env.pop("CLICOLOR_FORCE", None)
        env["NO_COLOR"] = "1"

    backend_cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "app.main:app",
        "--reload",
        "--host",
        host,
        "--port",
        str(backend_port),
        "--app-dir",
        str(BACKEND_DIR),
    ]
    backend_cmd.append("--use-colors" if USE_COLOR else "--no-use-colors")
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

    _log("launcher", _msg("backend_url", host=host, port=backend_port))
    _log("launcher", _msg("frontend_url", host=host, port=frontend_port))
    _log("launcher", _msg("press_ctrl_c"))

    backend_proc = _spawn_process(backend_cmd, REPO_ROOT, env, "backend")
    frontend_proc = _spawn_process(frontend_cmd, FRONTEND_DIR, env, "frontend")

    procs = [("backend", backend_proc), ("frontend", frontend_proc)]
    stop_event = threading.Event()
    cleanup_lock = threading.Lock()
    signal_handlers: list[tuple[int, signal.Handlers]] = []

    def _shutdown_all(log_message: str | None = None) -> None:
        if stop_event.is_set():
            return
        with cleanup_lock:
            if stop_event.is_set():
                return
            stop_event.set()
            if log_message:
                _log("launcher", log_message)
            for proc_name, proc in procs:
                _terminate_process(proc, proc_name)

    def _handle_signal(signum: int, _frame: object) -> None:
        signal_name = signal.Signals(signum).name
        _shutdown_all(_msg("signal_received", signal=signal_name))

    for sig_name in ("SIGINT", "SIGTERM", "SIGHUP"):
        sig = getattr(signal, sig_name, None)
        if sig is None:
            continue
        previous = signal.getsignal(sig)
        signal.signal(sig, _handle_signal)
        signal_handlers.append((sig, previous))

    atexit.register(_shutdown_all)

    try:
        while not stop_event.is_set():
            for name, proc in procs:
                code = proc.poll()
                if code is not None:
                    _shutdown_all(_msg("process_exited", name=name, code=code))
                    return code if code != 0 else 0
            time.sleep(0.3)
        return 0
    except KeyboardInterrupt:
        print()
        _shutdown_all(_msg("interrupt_received"))
        return 0
    finally:
        for sig, previous in signal_handlers:
            signal.signal(sig, previous)
        atexit.unregister(_shutdown_all)


def parse_args() -> argparse.Namespace:
    global IS_ZH
    IS_ZH = _is_chinese_system_language()

    parser = argparse.ArgumentParser(description=_msg("arg_desc"))
    parser.add_argument("--host", default="127.0.0.1", help=_msg("arg_host_help"))
    parser.add_argument(
        "--backend-port",
        type=int,
        default=8000,
        help=_msg("arg_backend_port_help"),
    )
    parser.add_argument(
        "--frontend-port",
        type=int,
        default=5173,
        help=_msg("arg_frontend_port_help"),
    )
    parser.add_argument(
        "--color",
        choices=["auto", "always", "never"],
        default="always",
        help=_msg("arg_color_help"),
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
