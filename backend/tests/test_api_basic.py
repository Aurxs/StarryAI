"""基础 API 与 WebSocket 测试。"""

from __future__ import annotations

import time
from collections.abc import Generator

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app.services.run_service import reset_run_service_for_testing


@pytest.fixture(autouse=True)
def _reset_run_service() -> Generator[None, None, None]:
    reset_run_service_for_testing()
    yield
    reset_run_service_for_testing()


def _basic_graph_payload() -> dict[str, object]:
    return {
        "graph": {
            "graph_id": "g_api_basic_validate",
            "nodes": [
                {"node_id": "n1", "type_name": "mock.input"},
                {"node_id": "n2", "type_name": "mock.llm"},
                {"node_id": "n3", "type_name": "mock.output"},
            ],
            "edges": [
                {
                    "source_node": "n1",
                    "source_port": "text",
                    "target_node": "n2",
                    "target_port": "prompt",
                },
                {
                    "source_node": "n2",
                    "source_port": "answer",
                    "target_node": "n3",
                    "target_port": "in",
                },
            ],
        }
    }


def test_root_and_health_endpoints() -> None:
    with TestClient(app) as client:
        root = client.get("/")
        assert root.status_code == 200
        assert root.json()["phase"] == "C"

        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["status"] == "ok"


def test_list_node_types_contains_builtin_specs() -> None:
    with TestClient(app) as client:
        resp = client.get("/api/v1/node-types")
        assert resp.status_code == 200
        body = resp.json()
        assert body["count"] >= 6
        type_names = {item["type_name"] for item in body["items"]}
        assert "mock.input" in type_names
        assert "sync.timeline" in type_names


def test_graph_validate_success_and_error_paths() -> None:
    with TestClient(app) as client:
        ok = client.post("/api/v1/graphs/validate", json=_basic_graph_payload()["graph"])
        assert ok.status_code == 200
        assert ok.json()["valid"] is True

        bad = client.post(
            "/api/v1/graphs/validate",
            json={
                "graph_id": "g_bad",
                "nodes": [{"node_id": "n1", "type_name": "unknown.type"}],
                "edges": [],
            },
        )
        assert bad.status_code == 200
        assert bad.json()["valid"] is False
        assert any(issue["code"] == "node.unknown_type" for issue in bad.json()["issues"])


def test_run_events_websocket_returns_not_found_error() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/api/v1/runs/nonexistent/events") as ws:
            payload = ws.receive_json()
            assert payload["event_type"] == "error"
            assert payload["message"] == "run not found"
            with pytest.raises(WebSocketDisconnect):
                ws.receive_json()


def test_run_events_websocket_streams_until_completed() -> None:
    with TestClient(app) as client:
        create = client.post(
            "/api/v1/runs",
            json={
                "graph": _basic_graph_payload()["graph"],
                "stream_id": "stream_ws",
            },
        )
        assert create.status_code == 200
        run_id = create.json()["run_id"]

        # 等待运行至少开始，确保 WS 能读到事件流。
        time.sleep(0.05)
        with client.websocket_connect(f"/api/v1/runs/{run_id}/events?since=0") as ws:
            seen_event_types: set[str] = set()
            completed = False
            for _ in range(200):
                payload = ws.receive_json()
                event_type = payload.get("event_type", "")
                seen_event_types.add(event_type)
                if event_type == "system" and payload.get("message") == "stream completed":
                    completed = True
                    break
            assert completed is True
            assert "run_started" in seen_event_types
