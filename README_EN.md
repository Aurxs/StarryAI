# StarryAI

StarryAI is a modular, node-based AI virtual human workflow engine.
The repository is currently in **Phase A (architecture and protocol validation)**.

## Phase A Scope

Implemented:

- Unified backend protocol models: `Frame`, `SyncFrame`, `RuntimeEvent`
- Node and graph contracts: `NodeSpec`, `PortSpec`, `SyncConfig`, `GraphSpec`
- Static graph validation and compilation: `GraphBuilder`
- Built-in mock node specs and implementation skeletons
- FastAPI skeleton endpoints for node-type listing and graph validation

Out of scope:

- Real model inference and external network calls
- Runtime execution for `runs` APIs (planned for Phase B)
- Full production frontend graph editor

## Current Design Choices

1. Non-sync nodes are non-streaming for now: run after inputs are ready, emit outputs after completion.
2. Synchronization is handled by dedicated sync nodes, not global blocking.
3. `stream_id`, `seq`, and `play_at` are kept in the protocol for future streaming upgrades.

## Meaning of `stream_id` and `seq`

- `stream_id`: identifier of one business flow (for example, one reply/playback unit).
- `seq`: ordered index inside the same `stream_id`.
- In Phase A (non-streaming), `seq=0` is usually enough.
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

- `GET /health`
- `GET /api/v1/node-types`
- `POST /api/v1/graphs/validate`

## Test

```bash
cd backend
python3.12 -m pytest -q
```
