# StarryAI

StarryAI 是一个模块化、节点式 AI 虚拟人工作流引擎。
当前仓库处于 **Phase C（同步编排增强阶段）**，核心目标是在 Phase B 可运行闭环基础上，把同步节点能力做成可执行、可观测、可测试。

## 当前阶段范围（Phase C）

已完成：

- 后端统一消息协议：`Frame`、`SyncFrame`、`RuntimeEvent`
- 节点与图规范：`NodeSpec`、`PortSpec`、`SyncConfig`、`GraphSpec`
- 图静态校验与编译：`GraphBuilder`
- 最小可运行调度闭环：`GraphScheduler`、`RunService`、runs REST/WS
- 同步编排初版：
    - `sync.timeline` 按 `stream_id/seq` 聚合
    - 策略：`barrier/window_join/clock_lock`
    - 迟到策略：`drop/reclock`（含 `emit_partial` 兼容路径）
    - 同步事件增强（`strategy/late_policy/decision/play_at`）

暂不包含：

- 真实模型推理、真实网络调用
- 完整 React Flow 工作台

## 关键设计决策（当前版本）

1. 非同步节点采用非流式语义：输入齐备后执行，执行完成后整体输出。
2. 同步由专门同步节点处理：上游产出完整结果后，由 `sync.timeline` 统一编排。
3. 保留 `stream_id`、`seq`、`play_at` 协议字段，为后续流式升级预留兼容性。

## `stream_id` 与 `seq` 语义

- `stream_id`：同一条业务流（例如一次回复/一次播报）的标识。
- `seq`：该业务流内部的顺序编号。
- Phase C（当前非流式）默认链路通常仍使用 `seq=0`，并在同步链路透传该字段。
- 后续进入流式/时间片调度时，可扩展为 `seq=0,1,2...`。

## 环境要求

- Python: **3.12.x**
- Node.js: 建议 20+

## 依赖安装

仓库仅保留一份依赖文件：`requirements.txt`（根目录）。

```bash
python3.12 -m pip install -r requirements.txt
```

## 后端启动

```bash
cd backend
python3.12 -m uvicorn app.main:app --reload
```

可用接口：

- `GET /health`
- `GET /`
- `GET /api/v1/node-types`
- `POST /api/v1/graphs/validate`
- `POST /api/v1/runs`
- `POST /api/v1/runs/{run_id}/stop`
- `GET /api/v1/runs/{run_id}`
- `GET /api/v1/runs/{run_id}/events`
- `WS /api/v1/runs/{run_id}/events`

## 测试

```bash
cd backend
python3.12 -m pytest -q
```

说明：

- 当前测试矩阵包含后端核心/API/服务/节点测试。
- 额外包含前端构建烟雾测试（`backend/tests/test_frontend_build.py`），用于验证 `frontend` 可成功构建。

## 目录结构

```text
backend/
  app/
    core/        # 协议、规范、图编译、调度骨架
    nodes/       # 内置 mock 节点实现骨架
    api/         # FastAPI 路由
    schemas/     # API DTO 占位
    services/    # Service 层占位
  tests/         # 后端测试
frontend/
  src/
    app/         # 前端入口壳
    shared/      # 通用模块
    entities/    # 领域实体
    features/    # 功能模块
    pages/       # 页面模块
```

## 英文文档

英文版说明请查看：`README_EN.md`

## Phase B 增量更新（2026-02-26，第一里程碑）

说明：本节为追加更新，不替换上方 Phase A 历史说明。

已新增能力：

- 最小可运行调度器：`GraphScheduler.run/stop`
- 节点实例工厂：`backend/app/core/node_factory.py`
- 运行管理服务：`RunService`（创建/停止/状态/事件）
- runs 接口从占位变为可用
- WS 运行事件从占位变为最小可用推送

新增/可用接口：

- `POST /api/v1/runs`
- `POST /api/v1/runs/{run_id}/stop`
- `GET /api/v1/runs/{run_id}`
- `GET /api/v1/runs/{run_id}/events`
- `WS /api/v1/runs/{run_id}/events`

说明：

- 该节是历史里程碑记录，当前主阶段已进入 Phase C。
- 本阶段新增开发测试依赖：`httpx>=0.28.0`（用于 `fastapi.testclient` 集成测试）。

## Phase C 增量更新（2026-02-27，第四里程碑）

新增能力：

- `sync.timeline` 从最小拼包升级为真实聚合与策略执行
- 调度器同步帧透传 `stream_id/seq/play_at/sync_key`
- `sync_frame_emitted` 事件补齐策略与决策字段
- 同步节点指标进入运行态快照（如 `sync_emitted/sync_dropped_late/sync_reclocked`）
- 根接口阶段标识更新为 `phase = "C"`

同步专项测试扩展：

- 节点行为：策略分支与输入冲突
- 调度行为：同步字段透传与非法同步输出边界
- 服务/API：同步事件字段回归

本地验证（StarryAI conda 环境）：

- `python -m pytest -q backend/tests`：`59 passed`
- `python -m ruff check backend/app backend/tests`：通过
