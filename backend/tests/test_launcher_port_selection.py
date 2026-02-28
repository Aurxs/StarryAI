"""启动器端口探测与选择测试。"""

from __future__ import annotations

import importlib.util
from pathlib import Path
import socket
import types

import pytest


def _load_launcher_module() -> types.ModuleType:
    module_path = Path(__file__).resolve().parents[2] / "main.py"
    spec = importlib.util.spec_from_file_location("starryai_launcher_main", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_is_port_available_supports_ipv6_hosts(monkeypatch: pytest.MonkeyPatch) -> None:
    launcher = _load_launcher_module()
    bind_calls: list[tuple[int, object]] = []

    def fake_getaddrinfo(
        host: str,
        port: int,
        family: int = 0,
        type: int = 0,
        *_: object,
        **__: object,
    ) -> list[tuple[int, int, int, str, tuple[str, int, int, int]]]:
        assert host == "::1"
        assert family == socket.AF_UNSPEC
        assert type == socket.SOCK_STREAM
        return [(socket.AF_INET6, socket.SOCK_STREAM, 0, "", ("::1", port, 0, 0))]

    class FakeSocket:
        def __init__(self, family: int, sock_type: int, proto: int) -> None:
            self.family = family

        def __enter__(self) -> FakeSocket:
            return self

        def __exit__(self, *_: object) -> bool:
            return False

        def setsockopt(self, *_: object) -> None:
            return None

        def bind(self, sockaddr: object) -> None:
            bind_calls.append((self.family, sockaddr))

    monkeypatch.setattr(launcher.socket, "getaddrinfo", fake_getaddrinfo)
    monkeypatch.setattr(launcher.socket, "socket", FakeSocket)

    assert launcher._is_port_available("::1", 9010) is True
    assert bind_calls == [(socket.AF_INET6, ("::1", 9010, 0, 0))]


def test_pick_available_port_skips_candidates_outside_tcp_range(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    launcher = _load_launcher_module()
    checked_ports: list[int] = []

    def fake_is_available(_host: str, port: int) -> bool:
        checked_ports.append(port)
        return False

    monkeypatch.setattr(launcher, "_is_port_available", fake_is_available)

    with pytest.raises(RuntimeError, match="Unable to find an available port"):
        launcher._pick_available_port("backend", "127.0.0.1", 65535, tries=3)

    assert checked_ports == [65535]


def test_pick_available_port_respects_excluded_ports(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    launcher = _load_launcher_module()
    checked_ports: list[int] = []
    availability = {
        8000: False,
        8001: True,
        8002: True,
    }

    def fake_is_available(_host: str, port: int) -> bool:
        checked_ports.append(port)
        return availability.get(port, False)

    monkeypatch.setattr(launcher, "_is_port_available", fake_is_available)
    monkeypatch.setattr(launcher, "_log", lambda *_args, **_kwargs: None)

    backend_port = launcher._pick_available_port("backend", "127.0.0.1", 8000, tries=5)
    frontend_port = launcher._pick_available_port(
        "frontend",
        "127.0.0.1",
        8001,
        tries=5,
        excluded_ports={backend_port},
    )

    assert backend_port == 8001
    assert frontend_port == 8002
    assert checked_ports == [8000, 8001, 8002]
