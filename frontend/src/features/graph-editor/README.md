# feature: graph-editor

React Flow 画布、节点拖拽、连线创建与删除。

## 当前实现补充

- 左侧快捷栏提供：新增节点、指针模式、手模式、自动整理节点、最大化画布、设置（含语言切换）。
- 新增节点抽屉（Node Library Drawer）支持拖拽和点击添加节点。
- 画布背景改为匀色灰底，定位点改为更深灰且更粗，并进一步加大尺寸（提升可视性）。
- 端口可视化增强：
  - 端口按类型着色；
  - 端口旁显示简化类型名（如 `text/audio/motion/sync/any`）。
- 连线时执行即时合法性校验：
  - 同一输入端口禁止重复绑定；
  - 类型不兼容时直接拒绝连线（不再等审查器兜底）。
- 新增解析后 schema（resolved schema）渲染：
  - `sync.initiator.dual` 的 `in_a/in_b` 会按上游连线动态收窄；
  - `out_a/out_b` 会按绑定输入推导为 `{input}.sync`；
  - 端口标签与颜色使用解析后 schema；
  - 连线颜色随源输出解析结果实时更新。
- 同步发起器创建默认配置：
  - 新增 `sync.initiator.*` 节点时自动生成简洁组名（`sg-xxxx`）；
  - 同时注入默认 `sync_round/ready_timeout_ms/commit_lead_ms` 配置。
- 同步输入标签增强：
  - `audio.full.sync`/`motion.timeline.sync` 前端展示为 `audio.sync`/`motion.sync`。
- `none` 端口约束：
  - `none` 仅作为“无输出”语义，连线校验阶段直接拒绝连接。
- 支持自动整理（轻量 DAG 分层布局）和缩放预设。
- 右下角缩放区改为一体化控件（`-10% / 比例 / +10%` 同框），缩略图与该控件同宽并使用同一右侧锚点对齐。
- UI 文案（工具提示、错误提示、状态提示）由语言包驱动。
