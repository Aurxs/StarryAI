# StarryAI

StarryAI is a modular, node-based AI virtual human workflow engine.
The repository is currently in **Phase C (synchronization orchestration enhancement)**.

## Phase C Scope

Implemented:

- Unified backend protocol models: `Frame`, `SyncFrame`, `RuntimeEvent`
- Node and graph contracts: `NodeSpec`, `PortSpec`, `SyncConfig`, `GraphSpec`
- Static graph validation and compilation: `GraphBuilder`
- Runnable backend runtime loop: scheduler + runs REST/WS
- Sync orchestration v1:
  - `sync.timeline` aggregation by `stream_id/seq`
  - strategy paths: `barrier/window_join/clock_lock`
  - late policies: `drop/reclock` (+ `emit_partial` compatibility path)
  - enriched sync events (`play_at/strategy/late_policy/decision`)

Out of scope:

- Real model inference and external network calls
- Full production frontend graph editor

## Current Design Choices

1. Non-sync nodes are non-streaming for now: run after inputs are ready, emit outputs after completion.
2. Synchronization is handled by dedicated sync nodes, not global blocking.
3. `stream_id`, `seq`, and `play_at` are kept in the protocol for future streaming upgrades.

## Meaning of `stream_id` and `seq`

- `stream_id`: identifier of one business flow (for example, one reply/playback unit).
- `seq`: ordered index inside the same `stream_id`.
- In Phase C (current non-streaming baseline), `seq=0` is still the common default.
- In future streaming phases, `seq` can represent timeline slices (`0,1,2...`).

## Requirements

- Python: **3.12.x**
- Node.js: recommended 20+

The repository keeps only one dependency file at root: `requirements.txt`.

```bash
python3.12 -m pip install -r requirements.txt
```

## Run Backend

```bash
cd backend
python3.12 -m uvicorn app.main:app --reload
```

Available endpoints:

- `GET /`
- `GET /health`
- `GET /api/v1/node-types`
- `POST /api/v1/graphs/validate`
- `POST /api/v1/runs`
- `POST /api/v1/runs/{run_id}/stop`
- `GET /api/v1/runs/{run_id}`
- `GET /api/v1/runs/{run_id}/events`
- `WS /api/v1/runs/{run_id}/events`

## Test

```bash
cd backend
python3.12 -m pytest -q
```

Notes:

- The current test matrix covers backend core/API/service/node behavior.
- It also includes a frontend build smoke test (`backend/tests/test_frontend_build.py`) to verify the `frontend` app can
  build successfully.

## Phase B Incremental Update (2026-02-26, Milestone 1)

Note: this section is appended and does not replace the Phase A history above.

New capabilities:

- Minimal runnable scheduler: `GraphScheduler.run/stop`
- Node instantiation factory: `backend/app/core/node_factory.py`
- Run management service: `RunService` (create/stop/status/events)
- `runs` REST APIs are now implemented
- Runtime event WebSocket is upgraded from placeholder to minimal usable streaming

Available runtime endpoints:

- `POST /api/v1/runs`
- `POST /api/v1/runs/{run_id}/stop`
- `GET /api/v1/runs/{run_id}`
- `GET /api/v1/runs/{run_id}/events`
- `WS /api/v1/runs/{run_id}/events`

Notes:

- This section is a historical milestone record; the current phase is Phase C.
- Added dev/test dependency: `httpx>=0.28.0` (required by `fastapi.testclient` integration tests).

## Phase C Incremental Update (2026-02-27, Milestone 4)

New capabilities:

- `sync.timeline` upgraded from simple packet stitching to executable sync policy logic
- Scheduler now forwards sync metadata (`stream_id/seq/play_at/sync_key`)
- `sync_frame_emitted` includes strategy and decision details
- Sync node metrics are exposed in runtime snapshots
- `GET /` phase marker updated to `C`

Validation in `StarryAI` conda environment:

- `python -m pytest -q backend/tests`: `59 passed`
- `python -m ruff check backend/app backend/tests`: passed
