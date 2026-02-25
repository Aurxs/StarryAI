# StarryAI

StarryAI is a modular, node-based AI virtual human workflow engine.
The product vision is a ComfyUI/Dify-style node graph experience with low-latency audio/video orchestration.

This repository is currently in **Phase A (MVP architecture validation)**.

## Current Phase Scope

Phase A focuses on:

- Unified backend data protocol (`Frame`, `SyncFrame`, runtime event models)
- Node type contracts (`NodeSpec`, `PortSpec`, `SyncConfig`)
- Graph static validation and compilation (`GraphBuilder`)
- Full project skeleton (backend + frontend folders) for future phases

Out of scope in Phase A:

- Real model/network calls
- Real scheduler execution
- Production frontend graph editor implementation

## Key Design Decisions (Current)

- Non-sync nodes use **non-streaming semantics** for now:
  - node runs only when inputs are ready
  - output is emitted only after process finishes
- Sync behavior is isolated in dedicated sync nodes:
  - use `stream_id` to identify one synchronized business flow
  - use `seq` to identify ordered sync slices inside one stream
  - use `play_at` for aligned scheduling timestamps

## Repository Structure

```text
backend/
  app/
    core/        # protocol, spec, graph builder, scheduler skeleton
    nodes/       # built-in mock node skeletons
    api/         # FastAPI routes (validate/list now, run later)
    schemas/     # API DTO layer placeholder
    services/    # service layer placeholder
  tests/         # backend tests
frontend/
  src/
    app/         # frontend entry shell
    shared/      # shared UI/client placeholders
    entities/    # domain entity placeholders
    features/    # feature module placeholders
    pages/       # page module placeholders
```

## Backend Quick Start

1. Install dependencies (example):

```bash
cd backend
pip install -e .
```

2. Run API server:

```bash
uvicorn app.main:app --reload
```

3. Useful endpoints:

- `GET /health`
- `GET /api/v1/node-types`
- `POST /api/v1/graphs/validate`

## Test

```bash
cd backend
pytest
```

## Next Phase (Planned)

Phase B will implement real graph runtime scheduling:

- queue creation and lifecycle
- node task orchestration
- run/stop APIs
- runtime WebSocket event stream
