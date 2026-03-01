# StarryAI

StarryAI is a modular, node-based AI virtual human workflow engine (Backend + Workbench).

## Current Scope

- Backend stage: `Phase D` (observability and stability).
- Frontend scope: desktop-only (Desktop Web).
- Out of scope: mobile adaptation, real model inference, external network calls.

## Recent Fixes (2026-02-28)

- UI layout upgrade:
  - full-screen canvas as the base layer;
  - left/right/bottom panels as floating overlays;
  - all three panels are collapsible.
- Graph editing update: each node now has a delete button.
- Graph validation request fix: backend CORS support added to resolve frontend `NetworkError` and backend
  `405 (OPTIONS)`.
- Local dev compatibility fix: backend CORS now allows dynamic localhost/127.0.0.1 ports, preventing saved-graph list load failures when Vite auto-switches ports.
- Runtime path fix: launcher now injects `VITE_API_BASE_URL` for frontend so backend auto-port switching does not break run requests.
- Frontend API client now has request timeout (default 10s) to avoid indefinite "running" UI when backend endpoint is unreachable or hangs.
- Frontend i18n: UI strings moved from hardcoded component text to language packs (`zh-CN`/`en-US`) with
  persisted language switching.

## Core Capabilities

- Graph contracts and validation: `NodeSpec/GraphSpec`, `GraphBuilder`.
- Runtime loop: `GraphScheduler` + `RunService` + runs REST/WS.
- Runtime guardrails: event retention window and concurrent-run limit controls.
- Ops metrics endpoint: `GET /metrics` in Prometheus text format.
- Metrics enrichment: labeled `starryai_runs_status{status=...}`, capacity/event ratio gauges, and suggested warning-threshold gauges.
- Sync orchestration (refactor in progress): `sync.initiator.dual` + `SyncCoordinator` + `*.sync` executors.
- Structured events: `event_id/event_seq/severity/component/error_code`.
- Observability endpoints: `/runs/{id}/metrics`, `/runs/{id}/diagnostics`.
- Frontend workbench: graph editing, node config, validation, run control, runtime console, insights panel.
- Phase F tooling (initial): baseline performance runner and JSON report pipeline.

## Project Phases (A-F)

- Phase A (done): protocol and graph model, static validation and compilation.
- Phase B (done): minimal runnable scheduler loop (run/stop/status/events).
- Phase C (done): sync orchestration v1 and sync event enrichment.
- Phase D (done): structured events, error governance, retry/timeout, observability APIs.
- Phase E (done): frontend workbench closed loop with backend integration and E2E baseline.
- Phase F (in progress): performance, stability, testing matrix, and engineering hardening.

## Stack

- Backend: Python 3.12 + FastAPI + asyncio + Pydantic
- Frontend: React + TypeScript + Vite + React Flow + Zustand

## Quick Start

1. Install dependencies (repo root)

```bash
python3.12 -m pip install -r requirements.txt
```

2. Run backend

```bash
cd backend
python3.12 -m uvicorn app.main:app --reload
```

3. Run frontend

```bash
cd frontend
npm install
npm run dev
```

4. Run Phase F perf baseline (optional)

```bash
python backend/scripts/run_perf_baseline.py --runs-per-scenario 10 --concurrency 4
```

## Main Endpoints

- `GET /`
- `GET /health`
- `GET /metrics`
- `GET /api/v1/node-types`
- `POST /api/v1/graphs/validate`
- `POST /api/v1/runs`
- `POST /api/v1/runs/{run_id}/stop`
- `GET /api/v1/runs/{run_id}`
- `GET /api/v1/runs/{run_id}/events`
- `GET /api/v1/runs/{run_id}/metrics`
- `GET /api/v1/runs/{run_id}/diagnostics`
- `WS /api/v1/runs/{run_id}/events`

## Tests (Baseline)

```bash
python -m pytest -q backend/tests
python -m ruff check backend/app backend/tests backend/scripts
python -m mypy backend/app
```

Local CI-aligned gate:

```bash
bash scripts/ci_local.sh --backend-only
# or full gate (including frontend + e2e)
bash scripts/ci_local.sh
```

Phase F perf baseline (on demand):

```bash
python backend/scripts/run_perf_baseline.py --runs-per-scenario 10 --concurrency 4
```

## Docs

- Chinese doc: `README.md`
- Development plan: `Plan.md`
- Structure notes: `description.md`
- Test baseline: `test.md`
- CI workflow: `.github/workflows/ci.yml`
