# StarryAI

StarryAI is a node-based AI workflow workbench for local development and experimentation, with visual orchestration, run control, and runtime inspection capabilities.

## Overview

StarryAI uses a separated frontend/backend architecture. The backend is responsible for graph validation, run scheduling, and event and metrics output, while the frontend provides a visual workbench for editing graphs, configuring nodes, saving workflows, and starting runs.

It is well suited for building and validating AI workflow prototypes, especially when you need to:

- Organize nodes and connections on a canvas instead of writing flow definitions by hand
- Check whether graph structure and node configuration are valid before running
- Inspect status, events, metrics, and diagnostics during execution
- Manage sensitive configuration through Secrets instead of storing plaintext in graphs
- Save and reuse local workflow graphs

## Core Capabilities

- Visual graph editing: create nodes on a canvas, connect them, adjust layouts, and maintain workflow structure
- Node configuration panel: edit node parameters through forms or structured configuration
- Graph validation: verify graph structure, port connections, and configuration before saving or running
- Run control: start, stop, and track a workflow run directly from the workbench
- Runtime inspection: review event streams, runtime metrics, and diagnostics to help troubleshoot issues
- Secret management: manage sensitive configuration centrally and reference it from node settings
- Graph persistence: save, load, and delete local workflow graphs for reuse and iteration

## Architecture

StarryAI has two main parts:

- Backend: Python 3.12 + FastAPI, responsible for graph validation, run scheduling, REST/WS APIs, and runtime data output
- Frontend: React + TypeScript + Vite, using React Flow and Zustand to provide the workbench experience

The system runs locally by starting both the backend service and the frontend workbench, with HTTP and WebSocket used for graph configuration, run control, and runtime data synchronization.

## Use Cases

- AI workflow prototype design and validation
- A local experimentation environment for node-based orchestration tools
- Early-stage internal tools that need visual editing and runtime inspection
- Local projects that need to separate sensitive configuration from workflow definitions

## Quick Start

### Requirements

- Python `3.12`
- Node.js and `npm`

### Recommended: one-command startup

Run this from the repository root:

```bash
python main.py
```

This starts both the backend and frontend development environment together. By default:

- Backend: `http://127.0.0.1:8000`
- Frontend: `http://127.0.0.1:5173`

If a default port is already in use, the launcher automatically switches to an available one and prints the actual addresses in the terminal.

The launcher will also try to install missing base dependencies when needed:

- Python runtime dependencies via `requirements.txt`
- Frontend dependencies via `frontend/package.json`

You can view the available options with:

```bash
python main.py --help
```

## Manual Startup

If you want to control the backend and frontend processes separately, use the steps below.

### 1. Install dependencies

Install Python dependencies from the repository root:

```bash
python3.12 -m pip install -r requirements.txt
```

Install frontend dependencies:

```bash
cd frontend
npm install
```

### 2. Start the backend

```bash
cd backend
python3.12 -m uvicorn app.main:app --reload
```

Default backend address:

```text
http://127.0.0.1:8000
```

### 3. Start the frontend

In a new terminal, run:

```bash
cd frontend
npm run dev
```

Default frontend address:

```text
http://127.0.0.1:5173
```

## Project Structure

```text
StarryAI/
├── backend/        # FastAPI backend and workflow runtime core
├── frontend/       # React workbench frontend
├── saved_graphs/   # Locally saved workflow graphs
├── scripts/        # Helper scripts
├── main.py         # One-command launcher
├── requirements.txt
└── README.md
```

## Notes

- `README_EN.md` is intended for external readers and focuses on project positioning and startup instructions
- Graph data is stored under the `saved_graphs/` directory by default
- The current workbench experience is mainly intended for local desktop browsers
- The Chinese document is also available at [`README.md`](./README.md)

