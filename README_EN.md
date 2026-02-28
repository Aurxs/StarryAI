# StarryAI

StarryAI is a modular, node-based AI virtual human workflow engine (Backend + Workbench).

## Current Scope

- Backend stage: `Phase D` (observability and stability).
- Frontend scope: desktop-only (Desktop Web).
- Out of scope: mobile adaptation, real model inference, external network calls.

## Core Capabilities

- Graph contracts and validation: `NodeSpec/GraphSpec`, `GraphBuilder`.
- Runtime loop: `GraphScheduler` + `RunService` + runs REST/WS.
- Sync orchestration: `sync.timeline` (`barrier/window_join/clock_lock`, with `drop/reclock`).
- Structured events: `event_id/event_seq/severity/component/error_code`.
- Observability endpoints: `/runs/{id}/metrics`, `/runs/{id}/diagnostics`.
- Frontend workbench: graph editing, node config, validation, run control, runtime console, insights panel.

## Project Phases (A-F)

- Phase A (done): protocol and graph model, static validation and compilation.
- Phase B (done): minimal runnable scheduler loop (run/stop/status/events).
- Phase C (done): sync orchestration v1 and sync event enrichment.
- Phase D (done): structured events, error governance, retry/timeout, observability APIs.
- Phase E (done): frontend workbench closed loop with backend integration and E2E baseline.
- Phase F (next): performance, stability, testing matrix, and engineering hardening.

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

## Main Endpoints

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

## Tests (Baseline)

```bash
python -m pytest -q backend/tests
python -m ruff check backend/app backend/tests
python -m mypy backend/app
```

## Docs

- Chinese doc: `README.md`
- Development plan: `Plan.md`
- Structure notes: `description.md`
- Test baseline: `test.md`
