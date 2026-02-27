"""时间轴同步节点。"""

from __future__ import annotations

import time
from typing import Any

from app.core.node_base import NodeContext
from app.core.node_sync import SyncBucket, SyncNode
from app.core.spec import LatePolicy, SyncStrategy


class TimelineSyncNode(SyncNode):
    """音频与动作的同步编排节点。

    端口约定：
    - 输入：`audio`、`motion`
    - 输出：`sync`

    当前阶段行为：
    - 以完整音频和完整动作为输入，按 `stream_id + seq` 聚合。
    - 根据 sync 策略计算统一 `play_at` 并处理迟到策略。
    - 输出包含 `stream_id`、`seq`、`play_at` 的同步计划与观测字段。
    """

    DEFAULT_LEAD_TIME_MS = 120
    DEFAULT_LATE_TOLERANCE_MS = 40
    DEFAULT_RECLOCK_OFFSET_MS = 20

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        """聚合输入并产出同步计划。"""
        now = time.monotonic()
        default_stream_id = str(context.metadata.get("stream_id", "stream_default"))

        required_ports = self.sync_config.required_ports if self.sync_config else ["audio", "motion"]
        late_policy = self.sync_config.late_policy if self.sync_config else LatePolicy.DROP
        strategy = self.sync_config.strategy if self.sync_config else SyncStrategy.BARRIER

        present_payloads = {
            name: inputs.get(name) for name in required_ports if inputs.get(name) is not None
        }
        present_ports = list(present_payloads.keys())
        missing_ports = [name for name in required_ports if name not in present_payloads]

        if not present_ports:
            self.state.metrics.missing_required += 1
            raise ValueError("sync.timeline 未收到任何 required_ports 输入")

        if missing_ports and late_policy != LatePolicy.EMIT_PARTIAL:
            self.state.metrics.missing_required += 1
            raise ValueError(f"sync.timeline 缺少 required_ports: {missing_ports}")

        meta_by_port = {
            port_name: self._extract_sync_meta(port_name, payload, default_stream_id)
            for port_name, payload in present_payloads.items()
        }
        stream_id, seq = self._resolve_canonical_meta(meta_by_port=meta_by_port)

        bucket = self._upsert_bucket(stream_id=stream_id, seq=seq, now=now)
        for port_name, payload in present_payloads.items():
            bucket.ports[port_name] = payload

        base_play_at = self._resolve_play_at(
            now=now,
            strategy=strategy,
            audio_play_at=meta_by_port.get("audio", {}).get("play_at"),
            motion_play_at=meta_by_port.get("motion", {}).get("play_at"),
        )
        play_at, decision = self._apply_late_policy(
            base_play_at=base_play_at,
            now=now,
            late_policy=late_policy,
        )

        if missing_ports:
            # 仅在显式 EMIT_PARTIAL 时允许部分输出。
            decision = "emit_partial"
            self.state.metrics.emit_partial += 1

        audio_payload = inputs.get("audio")
        motion_payload = inputs.get("motion")
        if decision == "drop":
            audio_command: Any = {}
            motion_command: Any = {}
        else:
            audio_command = audio_payload if audio_payload is not None else {}
            motion_command = motion_payload if motion_payload is not None else {}

        self.state.metrics.emitted += 1
        waited_ms = 0
        if bucket.first_seen_at is not None:
            waited_ms = int(max(0.0, (now - bucket.first_seen_at) * 1000))
        sync_key = f"{stream_id}:{seq}"

        sync_packet = {
            "stream_id": stream_id,
            "seq": seq,
            "sync_key": sync_key,
            "play_at": play_at,
            "audio": audio_command,
            "motion": motion_command,
            # 显式给出 command 字段，兼容后续播放执行层直接消费。
            "audio_command": audio_command,
            "motion_command": motion_command,
            "strategy": strategy.value,
            "late_policy": late_policy.value,
            "decision": decision,
            "missing_ports": missing_ports,
            "observed_wait_ms": waited_ms,
            "metrics": {
                "emitted": self.state.metrics.emitted,
                "dropped_late": self.state.metrics.dropped_late,
                "reclocked": self.state.metrics.reclocked,
                "emit_partial": self.state.metrics.emit_partial,
                "mismatched_inputs": self.state.metrics.mismatched_inputs,
                "missing_required": self.state.metrics.missing_required,
            },
        }
        return {
            "sync": sync_packet,
            "__node_metrics": {
                "sync_emitted": self.state.metrics.emitted,
                "sync_dropped_late": self.state.metrics.dropped_late,
                "sync_reclocked": self.state.metrics.reclocked,
                "sync_emit_partial": self.state.metrics.emit_partial,
                "sync_mismatched_inputs": self.state.metrics.mismatched_inputs,
                "sync_missing_required": self.state.metrics.missing_required,
                "sync_last_wait_ms": waited_ms,
            },
        }

    def _resolve_canonical_meta(
            self,
            *,
            meta_by_port: dict[str, dict[str, Any]],
    ) -> tuple[str, int]:
        """在已到达输入中选取并校验统一 stream_id/seq。"""
        first_port = next(iter(meta_by_port))
        canonical_stream_id = str(meta_by_port[first_port]["stream_id"])
        canonical_seq = int(meta_by_port[first_port]["seq"])

        for meta in meta_by_port.values():
            if str(meta["stream_id"]) != canonical_stream_id:
                self.state.metrics.mismatched_inputs += 1
                raise ValueError("sync.timeline 输入 stream_id 不一致，无法对齐")
            if int(meta["seq"]) != canonical_seq:
                self.state.metrics.mismatched_inputs += 1
                raise ValueError("sync.timeline 输入 seq 不一致，无法对齐")
        return canonical_stream_id, canonical_seq

    def _extract_sync_meta(
            self,
            port_name: str,
            payload: Any,
            default_stream_id: str,
    ) -> dict[str, Any]:
        """从上游 payload 中提取 stream_id/seq/play_at。"""
        if not isinstance(payload, dict):
            return {"stream_id": default_stream_id, "seq": 0, "play_at": None}

        stream_id = str(payload.get("stream_id", default_stream_id))

        raw_seq = payload.get("seq", 0)
        try:
            seq = int(raw_seq)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"sync.timeline 输入 {port_name}.seq 非法: {raw_seq!r}") from exc
        if seq < 0:
            raise ValueError(f"sync.timeline 输入 {port_name}.seq 不能为负数: {seq}")

        raw_play_at = payload.get("play_at")
        if raw_play_at is None:
            play_at: float | None = None
        else:
            try:
                play_at = float(raw_play_at)
            except (TypeError, ValueError) as exc:
                raise ValueError(
                    f"sync.timeline 输入 {port_name}.play_at 非法: {raw_play_at!r}"
                ) from exc
            if play_at < 0:
                raise ValueError(
                    f"sync.timeline 输入 {port_name}.play_at 不能为负数: {play_at}"
                )

        return {"stream_id": stream_id, "seq": seq, "play_at": play_at}

    def _resolve_play_at(
            self,
            *,
            now: float,
            strategy: SyncStrategy,
            audio_play_at: float | None,
            motion_play_at: float | None,
    ) -> float:
        """根据同步策略计算对齐时刻。"""
        lead_ms = float(self.config.get("lead_time_ms", self.DEFAULT_LEAD_TIME_MS))
        minimum_play_at = now + max(lead_ms, 0.0) / 1000.0

        candidates = [value for value in (audio_play_at, motion_play_at) if value is not None]
        if not candidates:
            return minimum_play_at

        if strategy == SyncStrategy.WINDOW_JOIN:
            window_ms = (
                float(self.sync_config.window_ms)
                if self.sync_config is not None
                else self.DEFAULT_LATE_TOLERANCE_MS
            )
            return max(minimum_play_at, min(candidates) + max(window_ms, 0.0) / 1000.0)

        if strategy == SyncStrategy.CLOCK_LOCK:
            lock_margin_ms = float(self.config.get("clock_lock_margin_ms", 0.0))
            return max(max(candidates), minimum_play_at) + max(lock_margin_ms, 0.0) / 1000.0

        return max(max(candidates), minimum_play_at)

    def _apply_late_policy(
            self,
            *,
            base_play_at: float,
            now: float,
            late_policy: LatePolicy,
    ) -> tuple[float, str]:
        """应用迟到策略并返回最终 play_at 与决策。"""
        late_tolerance_ms = float(
            self.config.get(
                "late_tolerance_ms",
                self.sync_config.window_ms
                if self.sync_config is not None
                else self.DEFAULT_LATE_TOLERANCE_MS,
            )
        )
        cutoff = now + max(late_tolerance_ms, 0.0) / 1000.0
        if base_play_at >= cutoff:
            return base_play_at, "emit"

        if late_policy == LatePolicy.DROP:
            self.state.metrics.dropped_late += 1
            return base_play_at, "drop"

        if late_policy == LatePolicy.RECLOCK:
            self.state.metrics.reclocked += 1
            reclock_offset_ms = float(
                self.config.get("reclock_offset_ms", self.DEFAULT_RECLOCK_OFFSET_MS)
            )
            return cutoff + max(reclock_offset_ms, 0.0) / 1000.0, "reclock"

        # EMIT_PARTIAL 或其它保守路径：保持原计划继续输出。
        return base_play_at, "emit_late"

    def _upsert_bucket(self, *, stream_id: str, seq: int, now: float) -> SyncBucket:
        """创建或更新同步桶。"""
        bucket_key = (stream_id, seq)
        bucket = self.state.buckets.get(bucket_key)
        if bucket is None:
            bucket = SyncBucket(first_seen_at=now, last_seen_at=now)
            self.state.buckets[bucket_key] = bucket
            return bucket

        if bucket.first_seen_at is None:
            bucket.first_seen_at = now
        bucket.last_seen_at = now
        return bucket
