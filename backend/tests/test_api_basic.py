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


def _sync_graph_payload() -> dict[str, object]:
    return {
        "graph": {
            "graph_id": "g_api_ws_sync_filter",
            "nodes": [
                {"node_id": "n1", "type_name": "mock.input"},
                {"node_id": "n2", "type_name": "mock.tts"},
                {"node_id": "n3", "type_name": "mock.motion"},
                {
                    "node_id": "n4",
                    "type_name": "sync.initiator.dual",
                    "config": {"sync_group": "g_sync_api", "sync_round": 0},
                },
                {
                    "node_id": "n5",
                    "type_name": "audio.play.sync",
                    "config": {"sync_group": "g_sync_api"},
                },
                {
                    "node_id": "n6",
                    "type_name": "motion.play.sync",
                    "config": {"sync_group": "g_sync_api"},
                },
            ],
            "edges": [
                {
                    "source_node": "n1",
                    "source_port": "text",
                    "target_node": "n2",
                    "target_port": "text",
                },
                {
                    "source_node": "n1",
                    "source_port": "text",
                    "target_node": "n3",
                    "target_port": "text",
                },
                {
                    "source_node": "n2",
                    "source_port": "audio",
                    "target_node": "n4",
                    "target_port": "in_a",
                },
                {
                    "source_node": "n3",
                    "source_port": "motion",
                    "target_node": "n4",
                    "target_port": "in_b",
                },
                {
                    "source_node": "n4",
                    "source_port": "out_a",
                    "target_node": "n5",
                    "target_port": "in",
                },
                {
                    "source_node": "n4",
                    "source_port": "out_b",
                    "target_node": "n6",
                    "target_port": "in",
                },
            ],
        },
        "stream_id": "stream_ws_sync_filter",
    }


def test_root_and_health_endpoints() -> None:
    with TestClient(app) as client:
        root = client.get("/")
        assert root.status_code == 200
        assert root.json()["phase"] == "D"

        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["status"] == "ok"


def test_metrics_endpoint_returns_prometheus_payload() -> None:
    with TestClient(app) as client:
        create = client.post(
            "/api/v1/runs",
            json={
                "graph": _basic_graph_payload()["graph"],
                "stream_id": "stream_metrics",
            },
        )
        assert create.status_code == 200
        run_id = create.json()["run_id"]

        for _ in range(40):
            status_resp = client.get(f"/api/v1/runs/{run_id}")
            assert status_resp.status_code == 200
            if status_resp.json()["status"] in {"completed", "failed", "stopped"}:
                break
            time.sleep(0.05)

        metrics = client.get("/metrics")
        assert metrics.status_code == 200
        assert "text/plain" in metrics.headers["content-type"]
        body = metrics.text
        assert "# HELP starryai_runs_retained" in body
        assert "starryai_runs_retained " in body
        assert "starryai_runs_completed_total " in body
        assert "starryai_events_total_total " in body
        assert "# TYPE starryai_events_total_total gauge" in body
        assert "# TYPE starryai_events_dropped_total gauge" in body
        assert 'starryai_runs_status{status="completed"} ' in body
        assert "starryai_run_capacity_utilization " in body
        assert "starryai_events_drop_ratio " in body
        assert "starryai_recommend_capacity_utilization_warning 0.8" in body
        assert "starryai_recommend_events_drop_ratio_warning 0.05" in body


def test_list_node_types_contains_builtin_specs() -> None:
    with TestClient(app) as client:
        resp = client.get("/api/v1/node-types")
        assert resp.status_code == 200
        body = resp.json()
        assert body["count"] >= 6
        type_names = {item["type_name"] for item in body["items"]}
        assert "mock.input" in type_names
        assert "sync.initiator.dual" in type_names


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


@pytest.mark.parametrize(
    "origin",
    [
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://localhost:5174",
        "http://[::1]:5173",
    ],
)
def test_graph_validate_cors_preflight(origin: str) -> None:
    with TestClient(app) as client:
        preflight = client.options(
            "/api/v1/graphs/validate",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
            },
        )
        assert preflight.status_code == 200
        assert preflight.headers.get("access-control-allow-origin") == origin


@pytest.mark.parametrize(
    "origin",
    [
        "http://127.0.0.1:5174",
        "http://localhost:4173",
        "http://[::1]:5173",
    ],
)
def test_graph_list_cors_allows_dynamic_local_port(origin: str) -> None:
    with TestClient(app) as client:
        response = client.get(
            "/api/v1/graphs",
            headers={"Origin": origin},
        )
        assert response.status_code == 200
        assert response.headers.get("access-control-allow-origin") == origin


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
            checked_structured_fields = False
            for _ in range(200):
                payload = ws.receive_json()
                event_type = payload.get("event_type", "")
                seen_event_types.add(event_type)
                if event_type and event_type != "system":
                    assert "event_id" in payload
                    assert isinstance(payload.get("event_seq"), int)
                    checked_structured_fields = True
                if event_type == "system" and payload.get("message") == "stream completed":
                    completed = True
                    break
            assert completed is True
            assert checked_structured_fields is True
            assert "run_started" in seen_event_types


def test_run_events_websocket_supports_filters() -> None:
    with TestClient(app) as client:
        create = client.post("/api/v1/runs", json=_sync_graph_payload())
        assert create.status_code == 200
        run_id = create.json()["run_id"]

        with client.websocket_connect(
                f"/api/v1/runs/{run_id}/events?since=0&event_type=sync_frame_emitted&node_id=n4"
        ) as ws:
            received_sync = 0
            for _ in range(200):
                payload = ws.receive_json()
                event_type = payload.get("event_type", "")
                if event_type == "system":
                    assert payload.get("message") == "stream completed"
                    break
                assert event_type == "sync_frame_emitted"
                assert payload.get("node_id") == "n4"
                received_sync += 1

            assert received_sync >= 1


def test_run_events_websocket_returns_error_for_invalid_filter_enum() -> None:
    with TestClient(app) as client:
        create = client.post("/api/v1/runs", json=_basic_graph_payload() | {"stream_id": "s_ws_bad"})
        assert create.status_code == 200
        run_id = create.json()["run_id"]

        with client.websocket_connect(f"/api/v1/runs/{run_id}/events?severity=fatal") as ws:
            payload = ws.receive_json()
            assert payload["event_type"] == "error"
            assert "invalid severity" in payload["message"]
            with pytest.raises(WebSocketDisconnect):
                ws.receive_json()
