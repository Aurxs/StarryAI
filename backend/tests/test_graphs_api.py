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
        assert listed.json()["items"][0]["incompatibility"] is None

        loaded = client.get("/api/v1/graphs/graph_saved_01")
        assert loaded.status_code == 200
        assert loaded.json()["graph_id"] == "graph_saved_01"
        assert len(loaded.json()["nodes"]) == 2
        assert loaded.json()["metadata"]["compat"]["graph_format_version"] == "0.1.0"
        assert loaded.json()["metadata"]["compat"]["node_type_versions"]["mock.input"] == "0.1.0"

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


def test_get_graph_returns_409_for_incompatible_graph_version() -> None:
    with TestClient(app) as client:
        payload = _graph_payload("graph_incompatible_major")
        payload["version"] = "1.0.0"
        saved = client.put("/api/v1/graphs/graph_incompatible_major", json=payload)
        assert saved.status_code == 200

        loaded = client.get("/api/v1/graphs/graph_incompatible_major")
        assert loaded.status_code == 409
        detail = loaded.json()["detail"]
        assert "不兼容" in detail["message"]
        assert detail["compatibility"]["compatible"] is False
        assert any(
            issue["code"] == "compat.graph_major_unsupported"
            for issue in detail["compatibility"]["issues"]
        )


def test_list_graphs_marks_incompatible_items() -> None:
    with TestClient(app) as client:
        compat_payload = _graph_payload("graph_compat")
        incompat_payload = _graph_payload("graph_incompat")
        incompat_payload["version"] = "1.0.0"

        assert client.put("/api/v1/graphs/graph_compat", json=compat_payload).status_code == 200
        assert client.put("/api/v1/graphs/graph_incompat", json=incompat_payload).status_code == 200

        listed = client.get("/api/v1/graphs")
        assert listed.status_code == 200
        items = {item["graph_id"]: item for item in listed.json()["items"]}
        assert items["graph_compat"]["incompatibility"] is None
        assert items["graph_incompat"]["incompatibility"]["code"] == "compat.graph_major_unsupported"
