"""runs API 集成测试。"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Generator
from typing import Any

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")
from fastapi.testclient import TestClient

from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext
from app.core.node_factory import NodeFactory, create_default_node_factory
from app.core.registry import create_default_registry
from app.core.spec import NodeMode, NodeSpec, PortSpec
from app.main import app
from app.nodes.llm_chat import LLMChatNode, TransportResponse
from app.nodes.llm_openai_compatible import OpenAICompatibleLLMNode
from app.secrets.service import reset_secret_service_for_testing
from app.secrets.store import InMemorySecretValueProvider, JsonSecretMetadataStore
from app.services.run_service import RunService, reset_run_service_for_testing
import app.services.run_service as run_service_module


class SlowEchoNode(AsyncNode):
    """用于 API stop 路径测试的慢节点。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context
        await asyncio.sleep(float(self.config.get("delay_s", 0.6)))
        return {"text": str(inputs.get("text", ""))}


def _wait_for_terminal_status(client: TestClient, run_id: str) -> dict[str, Any]:
    snapshot: dict[str, Any] = {}
    for _ in range(40):
        status_resp = client.get(f"/api/v1/runs/{run_id}")
        assert status_resp.status_code == 200
        snapshot = status_resp.json()
        if snapshot["status"] in {"completed", "failed", "stopped"}:
            break
        time.sleep(0.05)
    return snapshot


@pytest.fixture(autouse=True)
def _reset_run_service() -> Generator[None, None, None]:
    reset_run_service_for_testing()
    yield
    reset_run_service_for_testing()


@pytest.fixture(autouse=True)
def _reset_secret_service(tmp_path) -> Generator[None, None, None]:
    secret_dir = tmp_path / "secrets"
    reset_secret_service_for_testing(
        JsonSecretMetadataStore(
            store_dir=secret_dir,
            provider=InMemorySecretValueProvider(),
        )
    )
    yield
    reset_secret_service_for_testing(
        JsonSecretMetadataStore(
            store_dir=secret_dir,
            provider=InMemorySecretValueProvider(),
        )
    )


def _basic_graph_payload() -> dict[str, Any]:
    return {
        "graph": {
            "graph_id": "g_api_basic",
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
        },
        "stream_id": "stream_api_basic",
    }


def _invalid_graph_payload() -> dict[str, Any]:
    return {
        "graph": {
            "graph_id": "g_api_invalid",
            "nodes": [{"node_id": "n1", "type_name": "mock.llm"}],
            "edges": [],
        },
        "stream_id": "stream_api_invalid",
    }


def _sync_graph_payload() -> dict[str, Any]:
    return {
        "graph": {
            "graph_id": "g_api_sync",
            "nodes": [
                {"node_id": "n1", "type_name": "mock.input"},
                {"node_id": "n2", "type_name": "mock.tts"},
                {"node_id": "n3", "type_name": "mock.motion"},
                {
                    "node_id": "n4",
                    "type_name": "sync.initiator.dual",
                    "config": {"sync_group": "g_api_sync", "sync_round": 0},
                },
                {"node_id": "n5", "type_name": "audio.play.sync", "config": {"sync_group": "g_api_sync"}},
                {"node_id": "n6", "type_name": "motion.play.sync", "config": {"sync_group": "g_api_sync"}},
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
        "stream_id": "stream_api_sync",
    }


def _real_llm_graph_payload(secret_id: str) -> dict[str, Any]:
    return {
        "graph": {
            "graph_id": "g_api_real_llm",
            "nodes": [
                {"node_id": "n1", "type_name": "mock.input"},
                {
                    "node_id": "n2",
                    "type_name": "llm.openai_compatible",
                    "config": {
                        "base_url": "https://api.openai.com",
                        "api_path": "/v1/chat/completions",
                        "model": "gpt-4o-mini",
                        "api_key": {
                            "$kind": "secret_ref",
                            "secret_id": secret_id,
                        },
                        "system_prompt": "Answer briefly.",
                        "temperature": 0.1,
                    },
                },
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
        },
        "stream_id": "stream_api_real_llm",
    }


def _llm_chat_graph_payload(secret_id: str) -> dict[str, Any]:
    return {
        "graph": {
            "graph_id": "g_api_llm_chat",
            "nodes": [
                {"node_id": "n1", "type_name": "mock.input"},
                {
                    "node_id": "n2",
                    "type_name": "llm.chat",
                    "config": {
                        "preset_id": "openai",
                        "model": "gpt-4o-mini",
                        "api_key": {
                            "$kind": "secret_ref",
                            "secret_id": secret_id,
                        },
                        "system_prompt": "Answer briefly.",
                        "temperature": 0.1,
                    },
                },
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
        },
        "stream_id": "stream_api_llm_chat",
    }


def _build_slow_run_service() -> RunService:
    registry = create_default_registry()
    registry.register(
        NodeSpec(
            type_name="test.slow_api",
            mode=NodeMode.ASYNC,
            inputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
            outputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
            description="slow node for API stop test",
        )
    )

    def node_factory_builder() -> NodeFactory:
        factory = create_default_node_factory()
        factory.register("test.slow_api", SlowEchoNode)
        return factory

    return RunService(registry=registry, node_factory_builder=node_factory_builder)


def _slow_graph_payload() -> dict[str, Any]:
    return {
        "graph": {
            "graph_id": "g_api_stop",
            "nodes": [
                {"node_id": "n1", "type_name": "mock.input"},
                {
                    "node_id": "n2",
                    "type_name": "test.slow_api",
                    "config": {"delay_s": 1.0},
                },
                {"node_id": "n3", "type_name": "mock.output"},
            ],
            "edges": [
                {
                    "source_node": "n1",
                    "source_port": "text",
                    "target_node": "n2",
                    "target_port": "text",
                },
                {
                    "source_node": "n2",
                    "source_port": "text",
                    "target_node": "n3",
                    "target_port": "in",
                },
            ],
        },
        "stream_id": "stream_api_stop",
    }


def _build_capture_run_service(captured_values: list[Any]) -> RunService:
    registry = create_default_registry()
    registry.register(
        NodeSpec(
            type_name="test.capture_api",
            mode=NodeMode.ASYNC,
            inputs=[PortSpec(name="in", frame_schema="any", required=True)],
            outputs=[],
            description="API capture sink",
        )
    )

    class CaptureAPINode(AsyncNode):
        async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
            _ = context
            captured_values.append(inputs.get("in"))
            return {}

    def node_factory_builder() -> NodeFactory:
        factory = create_default_node_factory()
        factory.register("test.capture_api", CaptureAPINode)
        return factory

    return RunService(registry=registry, node_factory_builder=node_factory_builder)


def _data_variable_graph_payload() -> dict[str, Any]:
    return {
        "graph": {
            "graph_id": "g_api_data_variable",
            "metadata": {
                "data_registry": {
                    "variables": [
                        {
                            "name": "counter",
                            "value_kind": "scalar.int",
                            "initial_value": 1,
                        }
                    ]
                }
            },
            "nodes": [
                {"node_id": "n1", "type_name": "mock.input", "config": {"content": "tick"}},
                {
                    "node_id": "n2",
                    "type_name": "data.ref",
                    "config": {"variable_name": "counter"},
                },
                {
                    "node_id": "n3",
                    "type_name": "data.writer",
                    "config": {
                        "target_variable_name": "counter",
                        "operation": "add",
                        "operand_mode": "literal",
                        "literal_value": 2,
                    },
                },
                {"node_id": "n4", "type_name": "data.requester"},
                {"node_id": "n5", "type_name": "test.capture_api"},
            ],
            "edges": [
                {
                    "source_node": "n1",
                    "source_port": "text",
                    "target_node": "n3",
                    "target_port": "in",
                },
                {
                    "source_node": "n1",
                    "source_port": "text",
                    "target_node": "n4",
                    "target_port": "trigger",
                },
                {
                    "source_node": "n2",
                    "source_port": "value",
                    "target_node": "n4",
                    "target_port": "source",
                },
                {
                    "source_node": "n4",
                    "source_port": "value",
                    "target_node": "n5",
                    "target_port": "in",
                },
            ],
        },
        "stream_id": "stream_api_data_variable",
    }


def _data_staging_graph_payload() -> dict[str, Any]:
    return {
        "graph": {
            "graph_id": "g_api_data_staging",
            "metadata": {
                "data_registry": {
                    "variables": [
                        {
                            "name": "motion_buffer",
                            "value_kind": "json.any",
                            "initial_value": None,
                        }
                    ]
                }
            },
            "nodes": [
                {"node_id": "n1", "type_name": "mock.input", "config": {"content": "wave to audience"}},
                {"node_id": "n2", "type_name": "mock.motion"},
                {
                    "node_id": "n3",
                    "type_name": "data.ref",
                    "config": {"variable_name": "motion_buffer"},
                },
                {
                    "node_id": "n4",
                    "type_name": "data.writer",
                    "config": {
                        "target_variable_name": "motion_buffer",
                        "operation": "set_from_input",
                        "operand_mode": "literal",
                        "literal_value": 0,
                    },
                },
                {"node_id": "n5", "type_name": "data.requester"},
                {"node_id": "n6", "type_name": "test.capture_api"},
            ],
            "edges": [
                {
                    "source_node": "n1",
                    "source_port": "text",
                    "target_node": "n2",
                    "target_port": "text",
                },
                {
                    "source_node": "n2",
                    "source_port": "motion",
                    "target_node": "n4",
                    "target_port": "in",
                },
                {
                    "source_node": "n2",
                    "source_port": "motion",
                    "target_node": "n5",
                    "target_port": "trigger",
                },
                {
                    "source_node": "n3",
                    "source_port": "value",
                    "target_node": "n5",
                    "target_port": "source",
                },
                {
                    "source_node": "n5",
                    "source_port": "value",
                    "target_node": "n6",
                    "target_port": "in",
                },
            ],
        },
        "stream_id": "stream_api_data_staging",
    }


def test_create_run_and_query_status_and_events() -> None:
    """应能创建运行并查询状态与事件。"""
    with TestClient(app) as client:
        resp = client.post("/api/v1/runs", json=_basic_graph_payload())
        assert resp.status_code == 200
        run_id = resp.json()["run_id"]

        assert _wait_for_terminal_status(client, run_id)["status"] == "completed"

        final_snapshot = client.get(f"/api/v1/runs/{run_id}")
        assert final_snapshot.status_code == 200
        assert final_snapshot.json()["metrics"]["event_total"] >= 1

        events_resp = client.get(f"/api/v1/runs/{run_id}/events")
        assert events_resp.status_code == 200
        events_body = events_resp.json()
        assert events_body["count"] > 0
        assert any(item["event_type"] == "run_started" for item in events_body["items"])
        first_event = events_body["items"][0]
        assert "event_id" in first_event
        assert isinstance(first_event["event_seq"], int)
        assert first_event["severity"] in {"info", "warning", "error", "debug", "critical"}
        assert first_event["component"] in {"scheduler", "node", "edge", "sync", "service", "api"}


def test_create_run_with_real_llm_and_secret_ref(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def _fake_send_request(
        self: OpenAICompatibleLLMNode,
        *,
        url: str,
        headers: dict[str, str],
        body: dict[str, Any],
        timeout_s: float | None,
    ) -> dict[str, Any]:
        captured["url"] = url
        captured["headers"] = headers
        captured["body"] = body
        captured["timeout_s"] = timeout_s
        return {
            "model": "gpt-4o-mini",
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "hello from provider",
                    }
                }
            ],
            "usage": {
                "prompt_tokens": 11,
                "completion_tokens": 5,
                "total_tokens": 16,
            },
        }

    monkeypatch.setattr(OpenAICompatibleLLMNode, "send_request", _fake_send_request)

    with TestClient(app) as client:
        created_secret = client.post(
            "/api/v1/secrets",
            json={
                "label": "OpenAI Main",
                "value": "sk-live-test",
                "kind": "api_key",
            },
        )
        assert created_secret.status_code == 201
        secret_id = created_secret.json()["secret_id"]

        response = client.post("/api/v1/runs", json=_real_llm_graph_payload(secret_id))
        assert response.status_code == 200
        run_id = response.json()["run_id"]

        assert _wait_for_terminal_status(client, run_id)["status"] == "completed"

        snapshot = client.get(f"/api/v1/runs/{run_id}")
        assert snapshot.status_code == 200
        node_metrics = snapshot.json()["node_states"]["n2"]["metrics"]
        assert node_metrics["llm_model"] == "gpt-4o-mini"
        assert node_metrics["llm_total_tokens"] == 16

    assert captured["url"] == "https://api.openai.com/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer sk-live-test"
    assert captured["body"]["model"] == "gpt-4o-mini"
    assert captured["body"]["messages"][1]["role"] == "user"


def test_create_run_with_llm_chat_and_secret_ref(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def _fake_send_request(
        self: LLMChatNode,
        *,
        url: str,
        headers: dict[str, str],
        body: dict[str, Any],
        timeout_s: float | None,
    ) -> TransportResponse:
        captured["url"] = url
        captured["headers"] = headers
        captured["body"] = body
        captured["timeout_s"] = timeout_s
        return TransportResponse(
            payload={
                "id": "chatcmpl-llm-chat-1",
                "model": "gpt-4o-mini",
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "hello from llm.chat provider",
                        },
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 6,
                    "total_tokens": 16,
                },
            },
            headers={"x-request-id": "req-llm-chat-1"},
        )

    monkeypatch.setattr(LLMChatNode, "send_request", _fake_send_request)

    with TestClient(app) as client:
        created_secret = client.post(
            "/api/v1/secrets",
            json={
                "label": "OpenAI Chat Main",
                "value": "sk-chat-test",
                "kind": "api_key",
            },
        )
        assert created_secret.status_code == 201
        secret_id = created_secret.json()["secret_id"]

        response = client.post("/api/v1/runs", json=_llm_chat_graph_payload(secret_id))
        assert response.status_code == 200
        run_id = response.json()["run_id"]

        assert _wait_for_terminal_status(client, run_id)["status"] == "completed"

        snapshot = client.get(f"/api/v1/runs/{run_id}")
        assert snapshot.status_code == 200
        node_metrics = snapshot.json()["node_states"]["n2"]["metrics"]
        assert node_metrics["llm_provider"] == "openai"
        assert node_metrics["llm_model"] == "gpt-4o-mini"
        assert node_metrics["llm_total_tokens"] == 16
        assert node_metrics["llm_finish_reason"] == "stop"

    assert captured["url"] == "https://api.openai.com/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer sk-chat-test"
    assert captured["body"]["model"] == "gpt-4o-mini"
    assert captured["body"]["messages"][1]["role"] == "user"


def test_stop_run_endpoint_stops_running_instance(monkeypatch: pytest.MonkeyPatch) -> None:
    """stop 接口应能停止运行中的实例。"""
    custom_service = _build_slow_run_service()
    monkeypatch.setattr(run_service_module, "_run_service_singleton", custom_service)

    with TestClient(app) as client:
        create_resp = client.post("/api/v1/runs", json=_slow_graph_payload())
        assert create_resp.status_code == 200
        run_id = create_resp.json()["run_id"]

        stop_resp = client.post(f"/api/v1/runs/{run_id}/stop")
        assert stop_resp.status_code == 200
        assert stop_resp.json()["status"] == "stopped"

        status_resp = client.get(f"/api/v1/runs/{run_id}")
        assert status_resp.status_code == 200
        assert status_resp.json()["status"] == "stopped"


def test_create_run_updates_variable_and_requests_new_value(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_values: list[Any] = []
    monkeypatch.setattr(run_service_module, "_run_service_singleton", _build_capture_run_service(captured_values))

    with TestClient(app) as client:
        response = client.post("/api/v1/runs", json=_data_variable_graph_payload())
        assert response.status_code == 200
        run_id = response.json()["run_id"]

        final_snapshot = _wait_for_terminal_status(client, run_id)
        assert final_snapshot["status"] == "completed"

        snapshot = client.get(f"/api/v1/runs/{run_id}")
        assert snapshot.status_code == 200
        snapshot_body = snapshot.json()
        assert snapshot_body["node_states"]["n2"]["status"] == "passive"
        assert snapshot_body["node_states"]["n3"]["metrics"]["data_writes"] == 1

    assert captured_values == [3]


def test_create_run_writes_motion_payload_into_staging_then_requests_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_values: list[Any] = []
    monkeypatch.setattr(run_service_module, "_run_service_singleton", _build_capture_run_service(captured_values))

    with TestClient(app) as client:
        response = client.post("/api/v1/runs", json=_data_staging_graph_payload())
        assert response.status_code == 200
        run_id = response.json()["run_id"]

        final_snapshot = _wait_for_terminal_status(client, run_id)
        assert final_snapshot["status"] == "completed"

    assert len(captured_values) == 1
    payload = captured_values[0]
    assert isinstance(payload, dict)
    assert payload["source_text"] == "wave to audience"
    assert payload["stream_id"] == "stream_api_data_staging"
    assert payload["seq"] == 0
    assert isinstance(payload["play_at"], float)
    assert isinstance(payload["timeline"], list)
    assert payload["timeline"][0]["action"] == "idle"


def test_create_run_returns_422_for_invalid_graph() -> None:
    """非法图创建运行时应返回 422 与校验报告。"""
    with TestClient(app) as client:
        resp = client.post("/api/v1/runs", json=_invalid_graph_payload())
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert detail["message"] == "Graph validation failed before execution"
        assert detail["report"]["valid"] is False


def test_create_run_returns_422_for_blank_stream_id() -> None:
    """stream_id 为空白字符串时应在请求层直接失败。"""
    with TestClient(app) as client:
        payload = _basic_graph_payload()
        payload["stream_id"] = "   "
        resp = client.post("/api/v1/runs", json=payload)
        assert resp.status_code == 422


def test_create_run_returns_409_for_incompatible_graph_major_version() -> None:
    """图结构 major 不兼容时 create_run 应返回 409。"""
    with TestClient(app) as client:
        payload = _basic_graph_payload()
        payload["graph"]["version"] = "1.0.0"
        resp = client.post("/api/v1/runs", json=payload)
        assert resp.status_code == 409
        detail = resp.json()["detail"]
        assert "不兼容" in detail["message"]
        assert detail["compatibility"]["compatible"] is False
        assert any(
            issue["code"] == "compat.graph_major_unsupported"
            for issue in detail["compatibility"]["issues"]
        )


def test_create_run_returns_409_for_required_node_version_mismatch() -> None:
    """图记录的节点版本高于当前运行时时 create_run 应返回 409。"""
    with TestClient(app) as client:
        payload = _basic_graph_payload()
        payload["graph"]["metadata"] = {
            "compat": {
                "node_type_versions": {
                    "mock.input": "0.2.0",
                    "mock.llm": "0.1.0",
                    "mock.output": "0.1.0",
                }
            }
        }
        resp = client.post("/api/v1/runs", json=payload)
        assert resp.status_code == 409
        detail = resp.json()["detail"]
        assert detail["compatibility"]["compatible"] is False
        assert any(
            issue["code"] == "compat.node_runtime_older_than_required"
            for issue in detail["compatibility"]["issues"]
        )


def test_create_run_returns_429_when_capacity_exceeded(monkeypatch: pytest.MonkeyPatch) -> None:
    """active run 达到上限时 create_run 应返回 429。"""
    custom_service = _build_slow_run_service()
    custom_service.max_active_runs = 1
    monkeypatch.setattr(run_service_module, "_run_service_singleton", custom_service)

    with TestClient(app) as client:
        first = client.post("/api/v1/runs", json=_slow_graph_payload())
        assert first.status_code == 200

        second = client.post("/api/v1/runs", json=_slow_graph_payload())
        assert second.status_code == 429
        detail = second.json()["detail"]
        assert "并发运行已达上限" in detail["message"]


def test_run_endpoints_return_404_when_missing() -> None:
    """不存在 run_id 时，status/events/stop 都应返回 404。"""
    with TestClient(app) as client:
        status_resp = client.get("/api/v1/runs/run_missing")
        assert status_resp.status_code == 404

        events_resp = client.get("/api/v1/runs/run_missing/events")
        assert events_resp.status_code == 404

        stop_resp = client.post("/api/v1/runs/run_missing/stop")
        assert stop_resp.status_code == 404


def test_sync_run_events_contain_alignment_details() -> None:
    """同步链路事件应包含 stream_id/group/round/commit 信息。"""
    with TestClient(app) as client:
        create = client.post("/api/v1/runs", json=_sync_graph_payload())
        assert create.status_code == 200
        run_id = create.json()["run_id"]

        for _ in range(40):
            status_resp = client.get(f"/api/v1/runs/{run_id}")
            assert status_resp.status_code == 200
            if status_resp.json()["status"] in {"completed", "failed", "stopped"}:
                break
            time.sleep(0.05)

        events_resp = client.get(f"/api/v1/runs/{run_id}/events")
        assert events_resp.status_code == 200
        sync_events = [
            item
            for item in events_resp.json()["items"]
            if item["event_type"] == "sync_frame_emitted"
        ]
        assert len(sync_events) >= 1
        details = sync_events[0]["details"]
        assert details["stream_id"] == "stream_api_sync"
        assert details["seq"] == 0
        assert details["sync_group"] == "g_api_sync"
        assert details["sync_round"] == 0
        assert sync_events[0]["edge_key"] in {"n4.out_a->n5.in", "n4.out_b->n6.in"}
        assert sync_events[0]["component"] in {"edge", "sync"}


def test_get_run_events_supports_filter_query_params() -> None:
    """events 接口应支持 event_type/node_id/severity/error_code 过滤。"""
    with TestClient(app) as client:
        create = client.post("/api/v1/runs", json=_sync_graph_payload())
        assert create.status_code == 200
        run_id = create.json()["run_id"]

        for _ in range(40):
            status_resp = client.get(f"/api/v1/runs/{run_id}")
            assert status_resp.status_code == 200
            if status_resp.json()["status"] in {"completed", "failed", "stopped"}:
                break
            time.sleep(0.05)

        all_events_resp = client.get(f"/api/v1/runs/{run_id}/events?since=0&limit=500")
        assert all_events_resp.status_code == 200
        all_events = all_events_resp.json()["items"]
        assert len(all_events) >= 1

        sync_only = client.get(
            f"/api/v1/runs/{run_id}/events?since=0&limit=200&event_type=sync_frame_emitted"
        )
        assert sync_only.status_code == 200
        sync_items = sync_only.json()["items"]
        assert len(sync_items) >= 1
        assert all(item["event_type"] == "sync_frame_emitted" for item in sync_items)

        node_only = client.get(f"/api/v1/runs/{run_id}/events?since=0&limit=200&node_id=n4")
        assert node_only.status_code == 200
        node_items = node_only.json()["items"]
        assert len(node_items) >= 1
        assert all(item["node_id"] == "n4" for item in node_items)

        severity_info = client.get(f"/api/v1/runs/{run_id}/events?since=0&limit=200&severity=info")
        assert severity_info.status_code == 200
        assert severity_info.json()["count"] >= 1

        missing_error_code = client.get(
            f"/api/v1/runs/{run_id}/events?since=0&limit=200&error_code=non.existing.code"
        )
        assert missing_error_code.status_code == 200
        assert missing_error_code.json()["count"] == 0
        assert missing_error_code.json()["next_cursor"] == len(all_events)


def test_get_run_events_returns_422_for_invalid_filter_enum() -> None:
    """events 过滤枚举非法时应返回 422。"""
    with TestClient(app) as client:
        create = client.post("/api/v1/runs", json=_basic_graph_payload())
        assert create.status_code == 200
        run_id = create.json()["run_id"]

        bad_event_type = client.get(f"/api/v1/runs/{run_id}/events?event_type=invalid_type")
        assert bad_event_type.status_code == 422

        bad_severity = client.get(f"/api/v1/runs/{run_id}/events?severity=fatal")
        assert bad_severity.status_code == 422


def test_run_metrics_and_diagnostics_endpoints() -> None:
    """应能读取 metrics 与 diagnostics 视图。"""
    with TestClient(app) as client:
        create = client.post("/api/v1/runs", json=_sync_graph_payload())
        assert create.status_code == 200
        run_id = create.json()["run_id"]

        for _ in range(40):
            status_resp = client.get(f"/api/v1/runs/{run_id}")
            assert status_resp.status_code == 200
            if status_resp.json()["status"] in {"completed", "failed", "stopped"}:
                break
            time.sleep(0.05)

        metrics_resp = client.get(f"/api/v1/runs/{run_id}/metrics")
        assert metrics_resp.status_code == 200
        metrics_body = metrics_resp.json()
        assert metrics_body["run_id"] == run_id
        assert "graph_metrics" in metrics_body
        assert "node_metrics" in metrics_body
        assert "edge_metrics" in metrics_body

        diagnostics_resp = client.get(f"/api/v1/runs/{run_id}/diagnostics")
        assert diagnostics_resp.status_code == 200
        diagnostics_body = diagnostics_resp.json()
        assert diagnostics_body["run_id"] == run_id
        assert "failed_nodes" in diagnostics_body
        assert "slow_nodes_top" in diagnostics_body
        assert "edge_hotspots_top" in diagnostics_body
        assert "event_window" in diagnostics_body
        assert "capacity" in diagnostics_body
        assert diagnostics_body["event_window"]["event_total"] >= 1
        assert diagnostics_body["capacity"]["retained_runs"] >= 1


def test_run_metrics_and_diagnostics_return_404_when_missing() -> None:
    with TestClient(app) as client:
        metrics_resp = client.get("/api/v1/runs/run_missing/metrics")
        assert metrics_resp.status_code == 404

        diagnostics_resp = client.get("/api/v1/runs/run_missing/diagnostics")
        assert diagnostics_resp.status_code == 404
