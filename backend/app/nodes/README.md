# nodes 开发指南

本目录承载内置节点实现。迁移完成后，单个节点文件应同时包含：

1. 配置模型（`Config`）
2. 节点类型定义（`NodeSpec`）
3. 节点实现类（`Node`）
4. 导出定义（`NODE_DEFINITION`）

说明：节点扫描发现能力位于 `app.core.node_discovery`，可通过环境变量
`STARRYAI_NODE_DIRS` 扩展额外自定义节点目录。

## 发现入口

1. 默认入口：
   - `create_default_registry()`
   - `create_default_node_factory()`
2. 自定义目录：
   - 环境变量：`STARRYAI_NODE_DIRS=/abs/dir_a:/abs/dir_b`
   - 显式参数：`create_default_registry(search_dirs=[...])` /
     `create_default_node_factory(search_dirs=[...])`

## 导出约定

1. 推荐导出单个 `NODE_DEFINITION`。
2. 如一个模块包含多个节点，可导出 `NODE_DEFINITIONS`（list/tuple）。
3. 禁止同时导出 `NODE_DEFINITION` 与 `NODE_DEFINITIONS`。

## 单文件标准结构

```python
class MyNodeConfig(CommonNodeConfig):
    ...

MY_NODE_SPEC = NodeSpec(...)

class MyNode(AsyncNode | SyncInitiatorNode | SyncExecutorNode):
    ...

NODE_DEFINITION = NodeDefinition(
    spec=MY_NODE_SPEC,
    impl_cls=MyNode,
    config_model=MyNodeConfig,
)
```

## 配置约定

1. 公共执行策略字段由 `CommonNodeConfig` 提供：
   - `timeout_s`
   - `max_retries`
   - `retry_backoff_ms`
   - `continue_on_error`
   - `critical`
2. 业务字段写在节点自己的 `Config` 中。
3. 业务代码优先读取 `self.cfg`，避免直接散读 `dict`。

## 同步节点约定

1. 同步 envelope 由基类统一封装与解析。
   - 构造：`SyncNode.build_sync_payload(...)`
   - 解析：`SyncNode.unpack_sync_payload(...)`
2. 禁止在业务节点中手写 `{"data": ..., "sync": ...}` 协议细节。
3. `SyncInitiatorNode` 负责构造同步包；`SyncExecutorNode` 负责解析并执行。
4. `SyncExecutorNode` 会在解析时按上下文与节点配置补齐默认同步字段
   （如 `stream_id/ready_timeout_ms/commit_lead_ms`），然后统一走协议模型校验。
5. `sync_group` 不在后端做默认兜底：
   - 发起器必须显式提供 `sync_group`；
   - 执行节点应由上游发起器托管下发 `sync_group`，缺失或不一致会在图校验阶段报错。
6. 执行节点文件无需在 `Config`/`Spec` 中显式定义
   `sync_group/ready_timeout_ms/commit_lead_ms` 默认值；
   这些同步参数由发起器托管下发，执行器侧以读取与校验为主。

## 版本与兼容

1. `NodeSpec.version` 遵循 semver。
2. 节点输入/输出/schema/配置契约发生变化时必须更新版本。

## 测试要求

每个新增节点至少补以下测试：

1. 配置校验测试（合法/非法）
2. 正常处理路径测试
3. 异常或边缘路径测试
4. 同步节点额外覆盖 ready/commit/timeout 相关路径
