# StarryAI 后端

该目录包含 StarryAI 的 FastAPI 后端与图引擎核心模块。

当前状态：Phase D 已完成，Phase F 进行中（性能基线与运行时边界保护）。

- Python 版本：3.12.x
- 依赖文件：项目根目录 `../requirements.txt`

启动：

```bash
python3.12 -m uvicorn app.main:app --reload
```

Phase F 性能基线（初版）：

```bash
python backend/scripts/run_perf_baseline.py --runs-per-scenario 10 --concurrency 4
```

Phase F 运维观测（初版）：

- 指标导出：`GET /metrics`（Prometheus text format）
- 指标细化：状态标签指标、容量利用率、事件丢弃占比与建议告警阈值。

CI 门禁：

- 仓库工作流：`.github/workflows/ci.yml`
- 本地对齐：`bash scripts/ci_local.sh --backend-only`
