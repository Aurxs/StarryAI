# feature: runtime-console

展示后端事件流、日志与错误信息。

## 当前实现补充

- 运行事件与运行洞察面板文案改为语言包驱动。
- 运行洞察新增同步指标汇总：
  - `commit` 总次数
  - `abort` 总次数
  - `abort_reason` 聚合展示（如 `timeout(2)`）
- 同步指标统计逻辑抽离为 `sync-metrics.ts`，供运行洞察和工作台运行区复用。
