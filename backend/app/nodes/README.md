# StarryAI 后端节点开发指南

本文档面向后端节点开发者，说明如何在 `backend/app/nodes` 体系下新增、调试、测试和接入一个节点。

当前节点体系的核心目标是：

1. 用 `NodeSpec` 描述节点的静态契约。
2. 用 `BaseNode` 子类承载运行时代码。
3. 用 `NodeDefinition` 把规范、实现、配置模型绑定在一起。
4. 让注册中心、节点工厂、图校验器、运行时都基于同一份定义工作。

## 1. 节点是如何接入系统的

新增一个节点后，系统接入链路如下：

1. 开发者在 `app.nodes` 包内新增一个 `.py` 文件，或在自定义目录下新增一个 `.py` 文件。
2. 文件导出 `NODE_DEFINITION` 或 `NODE_DEFINITIONS`。
3. `create_default_registry()` 通过 `app.core.node_discovery.discover_node_definitions()` 扫描节点定义并注册 `NodeSpec`。
4. `create_default_node_factory()` 扫描同一批定义并注册实现类。
5. `GET /api/v1/node-types` 返回节点规范给前端，前端据此渲染节点库、端口信息和配置表单。
6. `GraphBuilder` 使用 `NodeSpec` 对图进行静态校验。
7. `GraphScheduler` 使用实现类实例化节点并执行 `process()` / `execute()`。

这意味着节点文件不是“单纯的业务类”，而是运行时与前端协议的一部分。

## 2. 开发前置

推荐在仓库根目录执行：

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -e "./backend[dev]"
```

启动后端服务：

```bash
cd backend
python3.12 -m uvicorn app.main:app --reload
```

验证服务可用：

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/api/v1/node-types
```

## 3. 目录与扫描约定

### 3.1 默认扫描来源

默认节点包是 `app.nodes`，对应目录：

```text
backend/app/nodes/
```

默认入口：

1. `app.core.registry.create_default_registry()`
2. `app.core.node_factory.create_default_node_factory()`

### 3.2 自定义节点目录

除内置目录外，也可以通过环境变量或显式参数注入额外目录：

```bash
export STARRYAI_NODE_DIRS=/abs/dir_a:/abs/dir_b
```

或：

```python
create_default_registry(search_dirs=["/abs/dir_a"])
create_default_node_factory(search_dirs=["/abs/dir_a"])
```

### 3.3 扫描时的几个重要约束

1. 推荐每个节点一个文件，文件内同时包含配置、规范、实现、导出定义。
2. 文件必须导出 `NODE_DEFINITION` 或 `NODE_DEFINITIONS`，不能两个同时导出。
3. `create_default_registry()` 与 `create_default_node_factory()` 默认使用 `strict=True`。
4. 在被扫描目录里，如果某个模块会被扫描到但没有导出定义，默认会导致节点发现失败。
5. `__init__.py` 和以下划线开头的模块不会被扫描，辅助代码可以放在 `_helpers.py` 这类文件中。

这一点很重要：不要在 `backend/app/nodes` 下随手放普通工具模块，除非它们以下划线开头，或者也按节点定义协议导出。

## 4. 单文件标准结构

推荐结构如下：

```python
class MyNodeConfig(CommonNodeConfig):
    ...

MY_NODE_SPEC = NodeSpec(...)

class MyNode(AsyncNode | SyncNode | SyncExecutorNode):
    ...

NODE_DEFINITION = NodeDefinition(
    spec=MY_NODE_SPEC,
    impl_cls=MyNode,
    config_model=MyNodeConfig,
)
```

如果一个模块确实要导出多个节点，可以使用：

```python
NODE_DEFINITIONS = [
    NodeDefinition(...),
    NodeDefinition(...),
]
```

## 5. 开发一个异步节点的完整步骤

异步节点是最常见的节点类型，基类为 `AsyncNode`。它的语义很简单：输入齐备后执行一次，返回完整输出。

### 5.1 定义配置模型

所有公共执行策略字段由 `CommonNodeConfig` 提供：

1. `timeout_s`
2. `max_retries`
3. `retry_backoff_ms`
4. `continue_on_error`
5. `critical`

业务字段写在自己的配置模型里。推荐使用 `pydantic.Field` 补充约束、描述和前端渲染元信息。

开发约定：

1. 节点业务逻辑优先读取 `self.cfg`，不要到处直接读原始 `dict`。
2. `self.config` / `self.raw_config` 只保留兼容用途。
3. 需要前端控制表单顺序时，可使用 `json_schema_extra={"x-starryai-order": 10}`。
4. 需要 Secret 选择器、多行文本等控件时，参考现有 `mock_llm.py`、`llm_openai_compatible.py` 的 `json_schema_extra` 写法。
5. 面向前端展示的 `Field.description`、`PortSpec.description`、`NodeSpec.description` 统一使用英文源文案；不同语言的展示文本由前端从 i18n JSON 映射，节点文件中不要直接维护多语言内容。

### 5.2 定义 NodeSpec

`NodeSpec` 描述“节点类型”，不是图里的实例。开发时至少需要明确：

1. `type_name`：全局唯一，建议使用分组命名，例如 `text.cleaner`、`llm.openai_compatible`。
2. `version`：遵循 semver；输入、输出、配置契约变化时必须更新。
3. `mode`：普通节点用 `NodeMode.ASYNC`，同步节点用 `NodeMode.SYNC`。
4. `inputs` / `outputs`：端口名、schema、是否必填。
5. `description`：给前端节点库和开发者阅读使用。
6. `config_schema`：推荐显式设置为 `Config.model_json_schema()`。

端口设计要点：

1. 输入端口不能使用 `none` schema。
2. `any` 是通配 schema。
3. 普通 schema 通过字符串匹配兼容，例如 `text.final -> text.final`。
4. 同步 schema 使用 `*.sync`，例如 `audio.full.sync`。
5. 同一目标输入口不能同时接多条边。

### 5.3 实现运行逻辑

异步节点需要实现：

```python
async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
    ...
```

几个关键约束：

1. 返回值的业务输出键必须来自 `NodeSpec.outputs` 中声明的端口名。
2. 源节点可以没有输入端口，例如 `mock.input`。
3. 汇点节点可以没有输出端口，例如 `mock.output`。
4. `context.run_id`、`context.node_id`、`context.metadata` 可用于日志、追踪和业务行为控制。
5. 可选地返回 `__node_metrics`，运行时会把它记录到节点运行指标中，这个键不需要在 `NodeSpec.outputs` 里声明。

### 5.4 导出 NodeDefinition

`NodeDefinition` 是系统扫描和加载的最终入口。它至少包含：

1. `spec`
2. `impl_cls`
3. `config_model`

虽然 `NodeDefinition.spec_with_config_schema()` 会在 `spec.config_schema` 为空时尝试自动补齐 schema，但项目内约定仍然是显式填写 `config_schema=Config.model_json_schema()`，这样可读性最好，也便于排查前端配置问题。

## 6. 完整节点示例

下面是一份可以直接照着写的异步节点示例。它会读取文本输入，按配置做前缀拼接和大小写处理，然后输出处理后的文本。

建议文件名：

```text
backend/app/nodes/text_transform.py
```

完整示例：

```python
"""文本转换节点。"""

from __future__ import annotations

from typing import Any

from pydantic import Field

from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext
from app.core.node_config import CommonNodeConfig
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec, PortSpec


class TextTransformConfig(CommonNodeConfig):
    """文本转换节点配置。"""

    prefix: str = Field(
        default="[Transformed]",
        description="输出前缀",
        json_schema_extra={"x-starryai-order": 10},
    )
    uppercase: bool = Field(
        default=False,
        description="是否转为大写",
        json_schema_extra={"x-starryai-order": 20},
    )
    trim: bool = Field(
        default=True,
        description="是否去除首尾空白",
        json_schema_extra={"x-starryai-order": 30},
    )


class TextTransformNode(AsyncNode):
    """将输入文本做简单转换。"""

    ConfigModel = TextTransformConfig

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context

        cfg = (
            self.cfg
            if isinstance(self.cfg, TextTransformConfig)
            else TextTransformConfig.model_validate(self.config)
        )

        text = str(inputs.get("text", ""))
        if cfg.trim:
            text = text.strip()
        if cfg.uppercase:
            text = text.upper()

        output = f"{cfg.prefix} {text}".strip()
        return {
            "text": output,
            "__node_metrics": {
                "input_chars": len(text),
                "output_chars": len(output),
            },
        }


TEXT_TRANSFORM_SPEC = NodeSpec(
    type_name="text.transform",
    version="0.1.0",
    mode=NodeMode.ASYNC,
    inputs=[
        PortSpec(
            name="text",
            frame_schema="text.final",
            required=True,
            description="待处理文本",
        )
    ],
    outputs=[
        PortSpec(
            name="text",
            frame_schema="text.final",
            required=True,
            description="处理后文本",
        )
    ],
    description="文本转换节点，支持裁剪空白、转大写与前缀拼接",
    config_schema=TextTransformConfig.model_json_schema(),
)


NODE_DEFINITION = NodeDefinition(
    spec=TEXT_TRANSFORM_SPEC,
    impl_cls=TextTransformNode,
    config_model=TextTransformConfig,
)
```

### 6.1 这个示例为什么符合当前架构

1. 配置模型继承了 `CommonNodeConfig`，自动获得超时、重试等公共能力。
2. `ConfigModel = TextTransformConfig` 让 `BaseNode` 在初始化时自动校验配置并生成 `self.cfg`。
3. `NodeSpec` 明确声明了输入输出契约，图校验器会用它检查端口和 schema。
4. `NODE_DEFINITION` 让注册中心和节点工厂可以同时发现这个节点。
5. `__node_metrics` 会进入运行态指标，方便前端或日志观测。

### 6.2 这个节点如何接入一个图

图定义示例：

```json
{
  "graph_id": "g_text_transform_demo",
  "nodes": [
    {
      "node_id": "n1",
      "type_name": "mock.input",
      "config": {
        "content": "  hello starry  "
      }
    },
    {
      "node_id": "n2",
      "type_name": "text.transform",
      "config": {
        "prefix": "[Demo]",
        "uppercase": true,
        "trim": true
      }
    },
    {
      "node_id": "n3",
      "type_name": "mock.output"
    }
  ],
  "edges": [
    {
      "source_node": "n1",
      "source_port": "text",
      "target_node": "n2",
      "target_port": "text"
    },
    {
      "source_node": "n2",
      "source_port": "text",
      "target_node": "n3",
      "target_port": "in"
    }
  ]
}
```

校验与运行时，链路会是：

1. `mock.input.text`
2. `text.transform.text`
3. `mock.output.in`

### 6.3 最小测试示例

建议新增：

```text
backend/tests/test_text_transform_node.py
```

测试示例：

```python
from __future__ import annotations

import asyncio

from app.core.node_base import NodeContext
from app.core.registry import create_default_registry
from app.nodes.text_transform import TextTransformNode


def test_text_transform_node_process() -> None:
    async def _run() -> None:
        registry = create_default_registry()
        node = TextTransformNode(
            "n1",
            registry.get("text.transform"),
            config={"prefix": "[Demo]", "uppercase": True, "trim": True},
        )
        output = await node.process(
            inputs={"text": "  hello  "},
            context=NodeContext(run_id="run_demo", node_id="n1"),
        )
        assert output["text"] == "[Demo] HELLO"
        assert output["__node_metrics"]["input_chars"] == 5

    asyncio.run(_run())
```

## 7. 同步节点开发要点

只有在节点确实需要“多路输入对齐”或“统一提交时刻”时，才使用同步节点。

### 7.1 什么时候使用同步节点

典型场景：

1. 音频与动作要同时提交。
2. 多路数据必须按同一轮次聚合后再执行。
3. 节点需要依赖同步协调器完成 ready/commit 流程。

### 7.2 当前同步节点角色

1. `SyncNode`：同步节点公共基类，提供同步 envelope 构造与解析。
2. `SyncExecutorNode`：已封装好 ready -> commit -> execute 流程，执行型同步节点优先继承它。
3. 发起器节点通常负责把普通 payload 封成同步 payload。
4. 执行器节点通常负责在协调器提交后执行实际动作。

### 7.3 开发约定

1. 同步 envelope 统一使用 `SyncNode.build_sync_payload(...)` 和 `SyncNode.unpack_sync_payload(...)`。
2. 不要在业务代码里手写 `{"data": ..., "sync": ...}` 协议细节。
3. `sync_group` 不在后端做默认兜底，发起器必须显式提供。
4. 执行器节点通常不需要在 `Config` 或 `Spec` 里重新声明一堆同步默认值，只需按当前架构读取并校验。
5. 对于执行型同步节点，业务动作优先实现为 `execute(...)`，不要重复造 ready/commit 逻辑。

现成参考：

1. `backend/app/nodes/sync_initiator_dual.py`
2. `backend/app/nodes/audio_play_sync.py`
3. `backend/app/nodes/motion_play_sync.py`

## 8. 本地验证流程

开发完节点后，建议至少做下面几步。

### 8.1 检查节点是否被发现

启动后端后访问：

```bash
curl http://127.0.0.1:8000/api/v1/node-types
```

确认返回中出现你的 `type_name`。

如果没有出现，优先检查：

1. 模块是否被扫描到。
2. 是否正确导出了 `NODE_DEFINITION`。
3. 是否与已有 `type_name` 重复。
4. 模块导入时是否抛异常。

### 8.2 运行针对性测试

```bash
cd backend
python -m pytest tests/test_node_discovery.py tests/test_nodes_behavior.py -q
python -m pytest tests/test_text_transform_node.py -q
```

### 8.3 跑后端门禁

从仓库根目录执行：

```bash
bash scripts/ci_local.sh --backend-only
```

## 9. 推荐的测试覆盖范围

每个新增节点至少应覆盖：

1. 配置校验测试：合法配置与非法配置。
2. 正常路径测试：给定输入是否得到预期输出。
3. 异常或边界测试：缺失输入、非法值、异常传播。
4. 节点发现测试：必要时验证自定义目录或导出协议。
5. 同步节点额外测试：ready、commit、timeout、payload 非法、`sync_group` 缺失。

## 10. 常见问题与排障

### 10.1 节点文件写了，但后端启动失败

高概率原因：

1. 文件位于扫描目录中，但没有导出 `NODE_DEFINITION(S)`。
2. 同时导出了 `NODE_DEFINITION` 和 `NODE_DEFINITIONS`。
3. `type_name` 与现有节点重复。
4. 模块 import 时就抛异常。

### 10.2 节点在 `/api/v1/node-types` 能看到，但图校验失败

优先检查：

1. 端口名是否和 `NodeSpec` 一致。
2. 上下游 `frame_schema` 是否兼容。
3. 必填输入端口是否都已连接。
4. 配置字段是否满足 `pydantic` 约束。

### 10.3 节点能创建，但运行时报配置错误

说明 `ConfigModel` 生效了，但传入配置不合法。重点检查：

1. `Field` 约束是否过严。
2. 前端传来的数据类型是否与模型一致。
3. 是否在代码里绕过 `self.cfg`，又直接读取了错误的原始值。

### 10.4 什么时候应该拆出辅助模块

如果只是给某个节点提供私有工具函数，优先：

1. 放在同文件内。
2. 或拆到 `_xxx.py` 这类以下划线开头的辅助模块。

不要把普通工具文件直接放进扫描目录并使用非下划线文件名，否则严格扫描会把它当成节点模块处理。

## 11. 开发建议

最后给出几条实践建议：

1. `type_name` 一开始就想清楚命名空间，避免后续兼容负担。
2. `NodeSpec.description` 和字段 `description` 不要省，前端节点库和配置面板会直接消费。
3. 优先做“小而清晰”的节点，不要把多个职责硬塞进一个节点。
4. 公共逻辑优先沉淀到 `app.core`，不要在多个节点文件里复制运行时协议代码。
5. 改动了输入输出契约或配置模型后，记得更新 `version`，并补图校验与行为测试。

如需参考现有实现，建议先读这些文件：

1. `backend/app/nodes/mock_input.py`
2. `backend/app/nodes/mock_llm.py`
3. `backend/app/nodes/llm_openai_compatible.py`
4. `backend/app/nodes/sync_initiator_dual.py`
5. `backend/app/core/node_discovery.py`
6. `backend/app/core/registry.py`
7. `backend/app/core/node_factory.py`
