"""同步 envelope 协议测试。"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.sync_protocol import (
    SyncMeta,
    build_sync_envelope,
    build_sync_key,
    parse_sync_envelope,
)


def test_build_sync_key_is_stable() -> None:
    key = build_sync_key(stream_id="s1", sync_group="g1", sync_round=2)
    assert key == "s1:g1:2"


def test_sync_meta_generates_sync_key_when_missing() -> None:
    meta = SyncMeta(
        stream_id="stream_a",
        sync_group="group_a",
        sync_round=4,
    )
    assert meta.sync_key == "stream_a:group_a:4"


def test_sync_meta_rejects_blank_sync_group() -> None:
    with pytest.raises(ValidationError):
        SyncMeta(
            stream_id="stream_a",
            sync_group="   ",
            sync_round=0,
        )


def test_build_and_parse_sync_envelope_roundtrip() -> None:
    payload = build_sync_envelope(
        data={"audio": 1},
        sync={
            "stream_id": "s1",
            "sync_group": "g1",
            "sync_round": 8,
            "ready_timeout_ms": 900,
            "commit_lead_ms": 40,
        },
    )
    data, meta = parse_sync_envelope(payload)
    assert data == {"audio": 1}
    assert meta.sync_group == "g1"
    assert meta.sync_round == 8
    assert meta.ready_timeout_ms == 900
    assert meta.commit_lead_ms == 40


def test_parse_sync_envelope_rejects_invalid_payload() -> None:
    with pytest.raises(ValidationError):
        parse_sync_envelope({"data": {"x": 1}})


def test_build_sync_envelope_preserves_binary_payload() -> None:
    """非 UTF-8 bytes 数据应原样保留，不被 JSON 序列化破坏。"""
    raw_audio = b"\x80\xff\x00\xfe"
    payload = build_sync_envelope(
        data=raw_audio,
        sync={
            "stream_id": "audio_stream",
            "sync_group": "mix",
            "sync_round": 0,
        },
    )
    assert payload["data"] is raw_audio

    data, meta = parse_sync_envelope(payload)
    assert data == raw_audio
    assert isinstance(data, bytes)
    assert meta.stream_id == "audio_stream"

