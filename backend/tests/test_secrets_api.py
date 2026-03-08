"""Secrets API integration tests."""

from __future__ import annotations

from collections.abc import Generator

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient

from app.main import app
from app.secrets.service import reset_secret_service_for_testing
from app.secrets.store import InMemorySecretValueProvider, JsonSecretMetadataStore
from app.services.graph_repository import reset_graph_repository_for_testing


@pytest.fixture(autouse=True)
def _reset_secret_state(tmp_path) -> Generator[None, None, None]:
    graph_dir = tmp_path / "graphs"
    secret_dir = tmp_path / "secrets"

    reset_graph_repository_for_testing(storage_dir=graph_dir)
    reset_secret_service_for_testing(
        JsonSecretMetadataStore(
            store_dir=secret_dir,
            provider=InMemorySecretValueProvider(),
        )
    )
    yield
    reset_graph_repository_for_testing(storage_dir=graph_dir)
    reset_secret_service_for_testing(
        JsonSecretMetadataStore(
            store_dir=secret_dir,
            provider=InMemorySecretValueProvider(),
        )
    )


def _graph_payload_with_secret(secret_value: object) -> dict[str, object]:
    return {
        "graph_id": "graph_secret_ref",
        "version": "0.1.0",
        "nodes": [
            {
                "node_id": "n1",
                "type_name": "mock.input",
                "title": "Input",
                "config": {"content": "hello"},
            },
            {
                "node_id": "n2",
                "type_name": "mock.llm",
                "title": "Mock LLM",
                "config": {
                    "model": "mock-llm-v1",
                    "api_key": secret_value,
                },
            },
            {
                "node_id": "n3",
                "type_name": "mock.output",
                "title": "Output",
                "config": {},
            },
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
        "metadata": {},
    }


def test_secret_crud_usage_and_delete_protection() -> None:
    with TestClient(app) as client:
        created = client.post(
            "/api/v1/secrets",
            json={
                "label": "OpenAI Main",
                "value": "sk-live-123",
                "kind": "api_key",
                "description": "primary key",
            },
        )
        assert created.status_code == 201
        created_body = created.json()
        assert created_body["secret_id"] == "openai-main"
        assert "value" not in created_body

        listed = client.get("/api/v1/secrets")
        assert listed.status_code == 200
        assert listed.json()["count"] == 1
        assert listed.json()["items"][0]["usage_count"] == 0
        assert listed.json()["items"][0]["in_use"] is False

        saved = client.put(
            "/api/v1/graphs/graph_secret_ref",
            json=_graph_payload_with_secret(
                {
                    "$kind": "secret_ref",
                    "secret_id": "openai-main",
                }
            ),
        )
        assert saved.status_code == 200

        usage = client.get("/api/v1/secrets/openai-main/usage")
        assert usage.status_code == 200
        usage_body = usage.json()
        assert usage_body["secret_id"] == "openai-main"
        assert usage_body["usage_count"] == 1
        assert usage_body["in_use"] is True
        assert usage_body["items"][0]["graph_id"] == "graph_secret_ref"
        assert usage_body["items"][0]["node_id"] == "n2"
        assert usage_body["items"][0]["field_path"] == "api_key"

        rotated = client.post(
            "/api/v1/secrets/openai-main/rotate",
            json={"value": "sk-live-456"},
        )
        assert rotated.status_code == 200
        assert rotated.json()["secret_id"] == "openai-main"
        assert "value" not in rotated.json()

        deleted = client.delete("/api/v1/secrets/openai-main")
        assert deleted.status_code == 409
        assert "禁止删除" in deleted.json()["detail"]["message"]


def test_graph_validate_reports_missing_secret_reference() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/graphs/validate",
            json=_graph_payload_with_secret(
                {
                    "$kind": "secret_ref",
                    "secret_id": "missing-secret",
                }
            ),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["valid"] is False
        assert any(issue["code"] == "node.secret_not_found" for issue in body["issues"])


def test_save_graph_rejects_plaintext_secret_values() -> None:
    with TestClient(app) as client:
        response = client.put(
            "/api/v1/graphs/graph_secret_ref",
            json=_graph_payload_with_secret("sk-plaintext-should-not-save"),
        )
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail["message"] == "图包含非法节点配置，禁止保存"
        assert any(
            issue["code"] == "node.config_invalid"
            for issue in detail["report"]["issues"]
        )
