"""核心模型与运行态结构测试。"""

from __future__ import annotations

from pydantic import ValidationError
import pytest

from app.core.frame import Frame, FrameType, RuntimeEvent, RuntimeEventType, SyncFrame
from app.core.graph_runtime import GraphRuntimeState, RuntimeEdgeState, RuntimeNodeState
from app.core.queue_policy import BackpressurePolicy, QueuePolicy


def test_frame_defaults_and_sync_fields() -> None:
    """Frame 默认字段与同步字段应正确落地。"""
    frame = Frame(
        run_id="r1",
        stream_id="s1",
        source_node="n1",
        source_port="out",
        payload={"k": "v"},
    )
    assert frame.seq == 0
    assert frame.frame_type == FrameType.DATA
    assert frame.end is False
    assert frame.sync_key is None
    assert frame.play_at is None
    assert frame.payload["k"] == "v"


def test_frame_rejects_extra_field() -> None:
    """Frame 禁止未声明字段。"""
    with pytest.raises(ValidationError):
        Frame.model_validate(
            {
                "run_id": "r1",
                "stream_id": "s1",
                "source_node": "n1",
                "source_port": "out",
                "payload": {},
                "unknown_field": 1,
            }
        )


def test_sync_frame_rejects_negative_play_at() -> None:
    """SyncFrame play_at 不能为负数。"""
    with pytest.raises(ValidationError):
        SyncFrame(
            run_id="r1",
            stream_id="s1",
            seq=0,
            play_at=-1.0,
            audio_command={},
            motion_command={},
        )


def test_runtime_event_model_dump_contains_type() -> None:
    """RuntimeEvent 序列化应包含事件类型值。"""
    event = RuntimeEvent(run_id="r1", event_type=RuntimeEventType.RUN_STARTED, message="ok")
    payload = event.model_dump(mode="json")
    assert payload["event_type"] == "run_started"
    assert payload["message"] == "ok"


def test_queue_policy_defaults_and_validation() -> None:
    """QueuePolicy 默认值与边界校验。"""
    policy = QueuePolicy()
    assert policy.maxsize == 0
    assert policy.policy == BackpressurePolicy.BLOCK

    with pytest.raises(ValidationError):
        QueuePolicy(maxsize=-1)


def test_graph_runtime_to_dict_roundtrip() -> None:
    """运行态结构应可稳定序列化。"""
    node_state = RuntimeNodeState(
        node_id="n1",
        status="finished",
        started_at=1.0,
        finished_at=2.0,
        metrics={"duration_ms": 1000},
    )
    edge_state = RuntimeEdgeState(
        source_node="n1",
        source_port="out",
        target_node="n2",
        target_port="in",
        queue_size=0,
        forwarded_frames=3,
    )
    state = GraphRuntimeState(
        run_id="r1",
        graph_id="g1",
        status="completed",
        started_at=1.0,
        ended_at=2.0,
        node_states={"n1": node_state},
        edge_states=[edge_state],
    )

    payload = state.to_dict()
    assert payload["run_id"] == "r1"
    assert payload["graph_id"] == "g1"
    assert payload["status"] == "completed"
    assert payload["node_states"]["n1"]["metrics"]["duration_ms"] == 1000
    assert payload["edge_states"][0]["forwarded_frames"] == 3
