# page: workbench

工作台主页面，组合画布与侧边栏功能。

## 当前实现补充

- 顶层文案使用 `shared/i18n` 语言包读取，不在组件内硬编码。
- 左侧面板提供语言切换（`zh-CN`/`en-US`），并持久化到 `localStorage`。
