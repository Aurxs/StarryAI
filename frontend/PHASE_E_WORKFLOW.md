# Phase E Workflow Gate (简版)

## 1. 范围

- 仅桌面端（Desktop Web）。
- 移动端适配与移动端 E2E 不在本阶段。

## 2. 开发前

- 先看：`Plan.md`、`description.md`、`README.md`、`test.md`。
- 明确本次改动边界：文件、接口、行为。

## 3. 开发中

- 每次只做一个可独立验收的功能增量。
- 新增代码路径必须同步补测试点。

## 4. 测试门禁（最小命令集）

```bash
# frontend
cd frontend
npm run test
npm run build
# 按需
npm run test:e2e

# backend
cd ../backend
python -m pytest -q
python -m ruff check app tests
python -m mypy app
```

## 5. 开发后

- 同步更新文档：`description.md`、`Plan.md`、`README.md`/`README_EN.md`（按需）。
- 文档内容必须与代码行为和测试结果一致。
