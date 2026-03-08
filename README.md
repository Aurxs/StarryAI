# StarryAI

StarryAI 是一个模块化、节点式 AI 虚拟人工作流引擎（Backend + Workbench）。

## 当前范围

- 当前后端阶段：`Phase D`（可观测性与稳定性）。
- 前端工作台范围：仅桌面端（Desktop Web）。
- 不在当前范围：移动端适配、大规模生产部署。

## 最近修复（2026-02-28）

- UI 布局升级：
    - 画布全屏打底；
    - 左/右/底部面板改为悬浮层；
    - 三个面板支持折叠。
- 图编辑补齐：每个节点新增删除按钮。
- 图校验请求修复：后端新增 CORS，解决前端 `NetworkError` 且后端 `405 (OPTIONS)` 的问题。
- 前端国际化：界面文案从组件硬编码迁移为语言包读取（`zh-CN`/`en-US`），并支持语言切换持久化。

## 最新进展（2026-03-01）

- 工作台 UI 全量重构第一批：
  - 改为画布优先的悬浮 HUD 布局（项目下拉、运行入口、审查栏、历史面板）。
  - 节点选中后右侧抽屉编辑，底部 HUD 自动左移避让。
  - 图编辑自动审查（防抖触发）并启用“仅 `error` 阻止运行”门禁。
- 图编辑交互升级：
  - 左侧快捷工具（指针/手模式、自动整理、最大化画布、节点库呼出）。
  - 端口类型着色与简化类型标签；
  - 连线时即时类型校验，不合法直接拒绝。
- 图状态管理升级：
  - 新增撤回/重做与操作历史记录（图编辑场景）。
- Phase F 初版启动（后端）：
  - 新增性能基线模块 `backend/app/perf/baseline.py`；
  - 新增基线脚本 `backend/scripts/run_perf_baseline.py`；
  - 新增对应测试 `backend/tests/test_perf_baseline.py`。
- Phase F 运行时加固第一批（后端）：
  - 调度器支持事件保留窗口（`max_retained_events`），降低长时运行内存风险；
  - RunService 支持并发运行上限（`max_active_runs`）；
  - `POST /api/v1/runs` 在并发超限时返回 `429`。
- Phase F 运行时加固第二批（后端）：
  - 图级事件指标补充 `event_drop_ratio/event_retention_ratio`；
  - diagnostics 增加 `event_window/capacity` 视图，便于排查“事件裁剪命中”和“容量上限命中”。
- Phase F 观测增强第一批（后端）：
  - 新增 `GET /metrics`，支持 Prometheus 文本格式抓取服务级聚合指标。
- Phase F 观测增强第二批（后端）：
  - `/metrics` 新增标签指标 `starryai_runs_status{status=...}`；
  - 新增 `starryai_run_capacity_utilization` 与 `starryai_events_drop_ratio`；
  - 新增建议阈值指标：`starryai_recommend_capacity_utilization_warning`、`starryai_recommend_events_drop_ratio_warning`。
- 图版本兼容治理初版（后端）：
  - 新增图兼容检测模块（图结构版本 + 节点类型版本快照）；
  - `PUT /api/v1/graphs/{graph_id}` 保存时自动补齐 `metadata.compat`；
  - `GET /api/v1/graphs` 返回每个图的可选不兼容摘要；
  - `GET /api/v1/graphs/{graph_id}` 与 `POST /api/v1/runs` 对不兼容图返回 `409` 并阻止加载/运行。
- 图版本兼容治理初版（前端）：
  - 已保存图列表仅对不兼容图显示红色原因提示；
  - 不兼容图禁用“加载”按钮；
  - 兼容图不显示任何兼容状态文案。
- 图存储命名策略升级（后端）：
  - 保存图时文件名改为 `{graph_id}.json`；
  - 读取/删除兼容历史 base64 文件名；
  - 存在新旧同图文件时按最新修改时间去重。
- 测试稳定性修复：
  - `test_repository_entry.py` 不再直接执行常驻启动流程，改为校验 `main.py --help`，避免全量测试挂起。
- 接口兼容修复（后端）：
  - CORS 支持本地动态端口（`localhost/127.0.0.1:*`），修复前端端口自动切换后“图列表加载失败”问题。
- 运行链路修复（启动器 + 前端）：
  - 启动器会把真实后端地址注入前端环境变量 `VITE_API_BASE_URL`，避免后端端口自动切换后请求打到错误端口；
  - 前端 API 客户端新增请求超时（默认 10s），防止“点击运行后一直显示运行中但无后端响应”。
- 同步架构重构第一批（进行中）：
  - 旧 `sync.timeline` 已下线，新增 `sync.initiator.dual`、`audio.play.sync`、`motion.play.sync`；
  - 调度器新增 `SyncCoordinator`，改为“全员 ready 后统一 commit”执行模型；
  - 图校验/图编译已支持 `*.sync` 动态染色与 `none` 端口规则；
  - 新增同步重构专项测试（校验、编译、调度、节点行为、API）。
  - 当前验证：`python -m pytest -q backend/tests`（`142 passed`）、`npm run test --prefix frontend`（`101 passed`）、`npm run build --prefix frontend`（通过）。
- 同步架构重构第二批（前端已完成）：
  - 前端同步发起器端口将按连线实时解析：
    - `in_a/in_b` 显示并继承上游输入类型与颜色；
    - `out_a/out_b` 自动变为 `{输入类型}.sync` 并同步颜色到下游连线。
  - 同步执行节点输入显示统一为 `xxx.sync`（如 `audio.sync` / `motion.sync`），并严格复用“同色可连、异色拒绝”规则。
  - 节点配置面板新增同步字段编辑：`sync_group`、`sync_round`、`ready_timeout_ms`、`commit_lead_ms`。
  - 运行面板新增同步指标：`commit/abort` 计数与 `abort_reason` 聚合。
  - 前端 e2e 增补两条同步链路：`all-ready -> commit`、`timeout -> abort`。
  - 当前验证：`npm run test --prefix frontend`（`109 passed`）、`npm run build --prefix frontend`（通过）、`npm run test:e2e --prefix frontend`（`6 passed`）。
- 同步架构重构第三批（已完成）：
  - 同步参数主权收敛到同步发起器：`sync_group`、`sync_round`、`ready_timeout_ms`、`commit_lead_ms`。
  - 同步执行节点改为“同步参数只读、业务运行参数可编辑”。
  - 同步托管重算改为差量触发：仅在“同步发起器 <-> 同步执行节点关系”变化时执行。
  - 同步托管重算并入图校验链路（自动审查/手动校验前执行），不新增独立按钮。
  - 增加同步来源可视化：执行节点面板可查看来源发起器 `node_id`。
  - 新增同步发起器落点默认配置：自动生成 `sync_group`，并注入默认 `sync_round/ready_timeout_ms/commit_lead_ms`。
  - 当前验证：
    - `python -m pytest -q backend/tests`（`142 passed`）
    - `python -m ruff check backend/app backend/tests backend/scripts`（通过）
    - `python -m mypy backend/app`（通过）
    - `npm run test --prefix frontend`（`116 passed`）
    - `npm run build --prefix frontend`（通过）
    - `npm run test:e2e --prefix frontend -- tests/e2e/workbench-flow.spec.ts`（`4 passed`）
- 节点单文件化迁移第一批（已完成）：
  - 新增核心抽象：`node_config`、`node_definition`、`sync_protocol`；
  - 新增自动发现核心模块：`backend/app/core/node_discovery.py`；
  - 支持通过 `STARRYAI_NODE_DIRS` 扩展自定义节点目录扫描；
  - `create_default_registry/create_default_node_factory` 已支持显式 `search_dirs` 注入；
  - 同步协议已基类化：`SyncNode` 统一提供同步包构造/解析，执行器解析阶段支持默认字段补齐；
  - 同步组规则已收紧：后端不再默认 `sync_group`，并在图校验阶段检查“发起器/执行节点组一致性”；
  - `SyncCoordinator` 新增已决 round 回收（TTL + 上限），避免长时运行 round 状态堆积；
  - registry / node_factory 已切换到 discovery 纯主路径（不再保留 legacy/shadow/fallback）；
  - 已完成 async 节点单文件迁移：
    - `mock.input`、`mock.llm`、`mock.tts`、`mock.motion`、`mock.output`、`audio.play.base`；
  - 已完成 sync 节点单文件迁移：
    - `sync.initiator.dual`、`audio.play.sync`、`motion.play.sync`；
  - 修复发现链路循环依赖：`nodes/__init__.py` 轻量化，`node_factory` 改为模块级导入；
  - `BaseNode` 新增 `ConfigModel/self.cfg/config_schema` 能力并保留 `self.config` 兼容；
  - 新增节点开发指南：`backend/app/nodes/README.md`；
  - 新增测试：`test_node_base_config.py`、`test_node_definition.py`、`test_sync_protocol.py`、`test_node_discovery.py`；
  - 当前验证：
    - `python -m pytest -q backend/tests`（`176 passed`）
    - `python -m ruff check backend/app backend/tests backend/scripts`（通过）
    - `python -m mypy backend/app`（通过）
- 节点配置与 Secret 管理第一批（2026-03-08）：
  - 后端新增 Secret Store / Secret API / 图保存与运行前 Secret 校验解析；
  - 前端新增设置页 `Secret 管理器`，支持创建、轮换、删除、引用统计；
  - 节点配置页升级为 schema-driven 表单，Secret 字段支持引用已有 Secret 或就地创建；
  - 新增首个真实模型节点：`llm.openai_compatible`，默认对接 OpenAI-compatible Chat Completions；
  - 当前验证：
    - `python -m pytest -q backend/tests`（`186 passed`）
    - `npm run test --prefix frontend`（`126 passed`）
    - `npm run build --prefix frontend`（通过）

## 核心能力

- 图协议与校验：`NodeSpec/GraphSpec`、`GraphBuilder`。
- 图兼容门禁：`graph_compatibility`（加载与运行前版本检测）。
- 运行闭环：`GraphScheduler` + `RunService` + runs REST/WS。
- 运行时边界保护：事件窗口裁剪、并发运行上限控制。
- 运行态诊断细化：事件窗口比例与容量状态直出。
- 运维采集入口：`/metrics`（Prometheus 文本格式）。
- 同步编排（重构中）：`sync.initiator.dual` + `SyncCoordinator` + `*.sync` 执行节点。
- 结构化事件：`event_id/event_seq/severity/component/error_code`。
- 观测接口：`/runs/{id}/metrics`、`/runs/{id}/diagnostics`。
- 前端工作台：图编辑、节点配置、图校验、运行控制、事件台、指标面板。

## 项目阶段（A-F）

- Phase A（已完成）：协议与图模型，完成静态校验与编译。
- Phase B（已完成）：最小可运行调度闭环（run/stop/status/events）。
- Phase C（已完成）：同步编排初版与同步事件增强。
- Phase C.5（进行中）：同步架构重构（去 `sync.timeline`，引入同步发起器与同步协调器）。
- Phase D（已完成）：结构化事件、错误治理、重试/超时、观测接口。
- Phase E（已完成）：前端工作台闭环与前后端联调、E2E 基线。
- Phase F（进行中）：性能、稳定性、测试矩阵与工程化增强。

## 版本维护规则

- `app_version`（发布版本）：
  - 位置：`backend/pyproject.toml`、`frontend/package.json`、`backend/app/main.py`（FastAPI version）。
  - 规则：按发布节奏更新（功能/修复均可），不用于图兼容拦截。
- `graph_format_version`（图结构版本）：
  - 位置：`GraphSpec.version` 默认值（`backend/app/core/spec.py`）及前端默认图版本（`frontend/src/shared/state/graph-store.ts`）。
  - 规则：仅图 JSON 结构或字段语义不兼容变化时升 `major`。
- `node_type_version`（节点类型版本）：
  - 位置：`backend/app/core/registry.py` 中各 `NodeSpec.version`。
  - 规则：节点输入/输出/schema/配置契约变化时更新（兼容新增升 `minor`，不兼容变更升 `major`）。
- `graph metadata compat snapshot`（图内兼容快照）：
  - 位置：`graph.metadata.compat.node_type_versions`（保存时后端自动补齐）。
  - 规则：无需手工改写；当节点版本变化后，重存图即可刷新快照。

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

4. 执行 Phase F 性能基线（可选）

```bash
python backend/scripts/run_perf_baseline.py --runs-per-scenario 10 --concurrency 4
```

## 常用接口

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

## 测试（精简基线）

```bash
python -m pytest -q backend/tests
python -m ruff check backend/app backend/tests backend/scripts
python -m mypy backend/app
```

CI 对齐本地门禁（推荐）：

```bash
bash scripts/ci_local.sh --backend-only
# 或全量（含前端与 e2e）
bash scripts/ci_local.sh
```

Phase F 性能基线（按需）：

```bash
python backend/scripts/run_perf_baseline.py --runs-per-scenario 10 --concurrency 4
python backend/scripts/run_perf_baseline.py --runs-per-scenario 6 --concurrency 2 --soak-seconds 60
```

## 目录

```text
backend/
  app/
    core/      # 协议、图模型、调度
    perf/      # Phase F 性能基线工具
    nodes/     # 内置节点
    api/       # FastAPI 路由
    schemas/   # API DTO
    services/  # 运行服务
  scripts/     # 开发与压测脚本
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
- CI 工作流：`.github/workflows/ci.yml`

## 节点单文件化迁移（进行中）

1. 目标：新增节点只需新增 `backend/app/nodes/*.py` 单文件（定义+配置+实现+导出）。
2. 主路径：节点发现已统一到 `backend/app/core/node_discovery.py`（不再保留 `nodes` 侧兼容 discovery）。
3. 扩展入口：
   - 环境变量 `STARRYAI_NODE_DIRS`；
   - `create_default_registry/create_default_node_factory(search_dirs=[...])`。
4. 行为要求：迁移期间保持现有 API、图校验与运行语义不变。
5. 同步节点要求：同步 envelope 由基类统一封装/解析，业务节点不再手写协议细节。
6. 数据边界：`saved_graphs/` 属于示例数据，不纳入兼容门禁。
