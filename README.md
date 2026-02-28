# StarryAI

StarryAI 是一个模块化、节点式 AI 虚拟人工作流引擎（Backend + Workbench）。

## 当前范围

- 当前后端阶段：`Phase D`（可观测性与稳定性）。
- 前端工作台范围：仅桌面端（Desktop Web）。
- 不在当前范围：移动端适配、真实模型推理与外部网络调用。

## 最近修复（2026-02-28）

- UI 布局升级：
    - 画布全屏打底；
    - 左/右/底部面板改为悬浮层；
    - 三个面板支持折叠。
- 图编辑补齐：每个节点新增删除按钮。
- 图校验请求修复：后端新增 CORS，解决前端 `NetworkError` 且后端 `405 (OPTIONS)` 的问题。

## 核心能力

- 图协议与校验：`NodeSpec/GraphSpec`、`GraphBuilder`。
- 运行闭环：`GraphScheduler` + `RunService` + runs REST/WS。
- 同步编排：`sync.timeline`（`barrier/window_join/clock_lock`，含 `drop/reclock`）。
- 结构化事件：`event_id/event_seq/severity/component/error_code`。
- 观测接口：`/runs/{id}/metrics`、`/runs/{id}/diagnostics`。
- 前端工作台：图编辑、节点配置、图校验、运行控制、事件台、指标面板。

## 项目阶段（A-F）

- Phase A（已完成）：协议与图模型，完成静态校验与编译。
- Phase B（已完成）：最小可运行调度闭环（run/stop/status/events）。
- Phase C（已完成）：同步编排初版与同步事件增强。
- Phase D（已完成）：结构化事件、错误治理、重试/超时、观测接口。
- Phase E（已完成）：前端工作台闭环与前后端联调、E2E 基线。
- Phase F（待推进）：性能、稳定性、测试矩阵与工程化增强。

## 技术栈

- Backend: Python 3.12 + FastAPI + asyncio + Pydantic
- Frontend: React + TypeScript + Vite + React Flow + Zustand

## 快速开始

1. 安装依赖（根目录）

```bash
python3.12 -m pip install -r requirements.txt
```

2. 启动后端

```bash
cd backend
python3.12 -m uvicorn app.main:app --reload
```

3. 启动前端

```bash
cd frontend
npm install
npm run dev
```

## 常用接口

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

## 测试（精简基线）

```bash
python -m pytest -q backend/tests
python -m ruff check backend/app backend/tests
python -m mypy backend/app
```

## 目录

```text
backend/
  app/
    core/      # 协议、图模型、调度
    nodes/     # 内置节点
    api/       # FastAPI 路由
    schemas/   # API DTO
    services/  # 运行服务
  tests/
frontend/
  src/
    app/
    entities/
    features/
    pages/
    shared/
```

## 文档

- 英文文档：`README_EN.md`
- 开发计划：`Plan.md`
- 结构说明：`description.md`
- 测试基线：`test.md`
