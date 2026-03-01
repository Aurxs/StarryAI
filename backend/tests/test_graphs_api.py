"""graphs API 集成测试。"""

from __future__ import annotations

from collections.abc import Generator

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient

from app.main import app
from app.services.graph_repository import reset_graph_repository_for_testing


@pytest.fixture(autouse=True)
def _reset_graph_repository(tmp_path) -> Generator[None, None, None]:
    reset_graph_repository_for_testing(storage_dir=tmp_path)
    yield
    reset_graph_repository_for_testing(storage_dir=tmp_path)


def _graph_payload(graph_id: str = "graph_saved_01") -> dict[str, object]:
    return {
        "graph_id": graph_id,
        "version": "0.1.0",
        "nodes": [
            {"node_id": "n1", "type_name": "mock.input", "title": "Input", "config": {}},
            {"node_id": "n2", "type_name": "mock.output", "title": "Output", "config": {}},
        ],
        "edges": [
            {
                "source_node": "n1",
                "source_port": "text",
                "target_node": "n2",
                "target_port": "in",
                "queue_maxsize": 0,
            }
        ],
        "metadata": {"owner": "test"},
    }


def test_graph_crud_lifecycle() -> None:
    with TestClient(app) as client:
        empty_list = client.get("/api/v1/graphs")
        assert empty_list.status_code == 200
        assert empty_list.json() == {"count": 0, "items": []}

        save = client.put("/api/v1/graphs/graph_saved_01", json=_graph_payload("graph_saved_01"))
        assert save.status_code == 200
        saved_body = save.json()
        assert saved_body["graph_id"] == "graph_saved_01"
        assert saved_body["version"] == "0.1.0"
        assert isinstance(saved_body["updated_at"], float)

        listed = client.get("/api/v1/graphs")
        assert listed.status_code == 200
        assert listed.json()["count"] == 1
        assert listed.json()["items"][0]["graph_id"] == "graph_saved_01"

        loaded = client.get("/api/v1/graphs/graph_saved_01")
        assert loaded.status_code == 200
        assert loaded.json()["graph_id"] == "graph_saved_01"
        assert len(loaded.json()["nodes"]) == 2

        deleted = client.delete("/api/v1/graphs/graph_saved_01")
        assert deleted.status_code == 200
        assert deleted.json() == {"graph_id": "graph_saved_01", "deleted": True}

        missing = client.get("/api/v1/graphs/graph_saved_01")
        assert missing.status_code == 404


def test_save_graph_returns_422_for_mismatched_path_and_payload_graph_id() -> None:
    with TestClient(app) as client:
        resp = client.put("/api/v1/graphs/graph_path", json=_graph_payload("graph_body"))
        assert resp.status_code == 422
        assert "不一致" in resp.json()["detail"]["message"]
