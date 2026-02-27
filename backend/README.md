# StarryAI 后端

该目录包含 StarryAI 的 FastAPI 后端与图引擎核心模块。

当前状态：Phase C（同步编排增强，含 runs REST/WS 可运行闭环）。

- Python 版本：3.12.x
- 依赖文件：项目根目录 `../requirements.txt`

启动：

```bash
python3.12 -m uvicorn app.main:app --reload
```
