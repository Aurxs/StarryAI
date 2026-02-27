# StarryAI

StarryAI is a modular, node-based AI virtual human workflow engine.
The repository is currently in **Phase D (backend observability and stability)**.

## Phase D Scope

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
- Structured runtime events and filtering (`event_id/event_seq/severity/component/error_code`)
- Node timeout/retry and error propagation controls (`continue_on_error`, `critical`)
- Observability endpoints: `/metrics` and `/diagnostics`

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
- In Phase D (current non-streaming baseline), `seq=0` is still the common default.
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
- `GET /api/v1/runs/{run_id}/metrics`
- `GET /api/v1/runs/{run_id}/diagnostics`
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

- This section is a historical milestone record; the current phase is Phase D.
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

## Phase D Incremental Update (2026-02-27, Milestone 5 in progress)

New capabilities (T0/T1):

- Added a Phase D documentation gate workflow:
    - check docs before each feature implementation
    - update docs immediately after each feature lands
- Upgraded `RuntimeEvent` to structured event V2 with:
    - `event_id`
    - `event_seq`
    - `severity`
    - `component`
    - `error_code`
    - `edge_key`
    - `attempt`
- Wired structured fields into `GraphScheduler` event emission and added a normalized failure code on node failure.

Validation in current environment:

-
`python -m pytest -q backend/tests/test_core_models.py backend/tests/test_scheduler.py backend/tests/test_runs_api.py backend/tests/test_api_basic.py`:
`28 passed, 2 skipped`
- `python -m pytest -q backend/tests`: `58 passed, 2 skipped`
- `python -m ruff check backend/app backend/tests`: passed
- `python -m mypy backend/app/core backend/tests/test_core_models.py backend/tests/test_scheduler.py`: passed

## Phase D Incremental Update (2026-02-27, Milestone 6 in progress)

New capabilities (T2):

- Event query filtering:
    - REST: `GET /api/v1/runs/{run_id}/events` now supports `event_type/node_id/severity/error_code`
    - WS: `WS /api/v1/runs/{run_id}/events` supports the same filters
- Added scheduler-level `get_events_filtered(...)` with stable cursor semantics over the full event stream.
- `RunService.get_run_events(...)` now forwards filtering options end-to-end.

Validation in `StarryAI` conda environment:

-
`python -m pytest -q backend/tests/test_scheduler.py backend/tests/test_run_service.py backend/tests/test_runs_api.py backend/tests/test_api_basic.py`:
`42 passed`
- `python -m pytest -q backend/tests`: `74 passed`
- `python -m ruff check backend/app backend/tests`: passed
- `python -m mypy backend/app backend/tests`: passed

## Phase D Incremental Update (2026-02-27, Milestone 7 in progress)

New capabilities (T3 batch 1):

- Added graph-level runtime metrics aggregation:
    - `event_total/event_warning/event_error`
    - `node_finished/node_failed`
    - `edge_forwarded_frames/edge_queue_peak_max`
    - `sync_decisions`
- Added node-level `throughput_fps`.
- Added edge-level `queue_peak_size` high-water mark.
- `GET /api/v1/runs/{run_id}` now includes aggregated `metrics` in status payload.

Validation in `StarryAI` conda environment:

-
`python -m pytest -q backend/tests/test_core_models.py backend/tests/test_scheduler.py backend/tests/test_run_service.py backend/tests/test_runs_api.py backend/tests/test_api_basic.py`:
`51 passed`
- `python -m pytest -q backend/tests`: `75 passed`
- `python -m ruff check backend/app backend/tests`: passed
- `python -m mypy backend/app backend/tests`: passed

## Phase D Incremental Update (2026-02-27, Milestone 8 in progress)

New capabilities (T4):

- Added unified error taxonomy module: `backend/app/core/errors.py`
    - `ErrorCode`
    - `RuntimeNodeError`
    - `NodeTimeoutError`
    - `classify_exception()`
- Scheduler failure path now emits structured `error_code` via classifier.
- Node runtime metrics now include `last_error_code/last_error_retryable`.

Validation in `StarryAI` conda environment:

- `python -m pytest -q backend/tests/test_error_taxonomy.py backend/tests/test_scheduler.py`: `27 passed`
- `python -m ruff check backend/app backend/tests`: passed
- `python -m mypy backend/app backend/tests`: passed

## Phase D Incremental Update (2026-02-27, Milestones 5-9 closed)

New capabilities (T5-T9):

- T5 Node timeout + retry:
    - Per-node policy supports `timeout_s/max_retries/retry_backoff_ms`
    - Added runtime events: `node_timeout`, `node_retry`
    - `node.retry_exhausted` is emitted only when retries are configured and exhausted
- T6 Error propagation and recovery:
    - Default behavior remains fail-fast
    - `continue_on_error` is supported for non-critical nodes only
    - `critical=true` enforces fail-fast
- T7 Runtime observability APIs:
    - `GET /api/v1/runs/{run_id}/metrics`
    - `GET /api/v1/runs/{run_id}/diagnostics`
- T8 Detailed and edge-case testing:
    - Added `backend/tests/test_scheduler_retry_timeout.py`
    - Added `backend/tests/test_observability_edges.py`
    - Covers negative cursor, empty events, invalid filters, high-frequency pagination, ultra-short timeout, `retry=0`,
      huge retries, non-retryable exceptions, queue high-water mark
- T9 Documentation and phase closure:
    - Synced `Plan.md/description.md/README.md/README_EN.md`
    - Root API phase marker updated to `phase = "D"`

Final validation (`StarryAI` conda environment):

- `python -m pytest -q backend/tests`: `98 passed`
- `python -m ruff check backend/app backend/tests`: passed
- `python -m mypy backend/app backend/tests`: passed
