# StarryAI 后端

该目录包含 StarryAI 的 FastAPI 后端与图引擎核心模块。

当前状态：Phase D（后端可观测性与稳定性增强，含 runs REST/WS 与 metrics/diagnostics 观测接口）。

- Python 版本：3.12.x
- 依赖文件：项目根目录 `../requirements.txt`

启动：

```bash
python3.12 -m uvicorn app.main:app --reload
```
