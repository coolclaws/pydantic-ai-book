# 第 17 章 Logfire 集成

> Pydantic AI 与 Pydantic Logfire 深度集成，提供了开箱即用的可观测性支持。通过 OpenTelemetry 标准协议，框架能够自动追踪 Agent 运行的每一次模型请求、工具调用和重试过程，并将结构化的 span 数据发送到 Logfire 仪表盘进行可视化分析。本章将从 instrumentation 机制入手，逐步解析追踪数据的生成与消费链路。

## 17.1 Pydantic Logfire 简介

### 什么是 Logfire

Pydantic Logfire 是 Pydantic 团队推出的可观测性平台。
它基于 OpenTelemetry 标准构建，专为 Python 应用的追踪和监控设计。
与通用的 APM 工具不同，Logfire 对 Pydantic 生态有原生支持。
它能够自动解析 Pydantic 模型的验证过程，展示结构化的数据流。

### 与 Pydantic AI 的关系

Pydantic AI 将 Logfire 作为首选的可观测性方案进行集成。
框架内部在关键路径上预埋了 span 追踪点。
开发者只需一行配置即可激活完整的追踪能力。
这种深度集成使得 Agent 的运行过程变得完全透明。

## 17.2 自动 instrumentation 机制

### 激活方式

Pydantic AI 通过 `Agent` 构造函数的 `instrument` 参数控制 instrumentation 行为。
当设置为 `True` 时，框架会自动为所有模型请求和工具调用创建追踪 span。
也可以传入 `InstrumentationSettings` 实例进行精细化配置。

```python
# 文件: pydantic_ai/agent.py
class Agent(Generic[AgentDepsT, OutputDataT]):
    def __init__(
        self,
        model: Model | KnownModelName | None = None,
        *,
        output_type: type[OutputDataT] | ToolOutput[OutputDataT] = str,
        instrument: InstrumentationSettings | bool | None = None,
        # ... 其他参数
    ):
        if instrument is not None:
            self._instrument = (
                InstrumentationSettings()
                if instrument is True
                else instrument
            )
```

### 内部注册流程

当 `instrument` 不为 `None` 时，Agent 在初始化阶段会创建 `InstrumentationSettings` 实例。
该实例负责配置 OpenTelemetry 的 tracer provider 和 span processor。
后续的每次 `run`、`run_sync` 或 `run_stream` 调用都会自动创建追踪上下文。

## 17.3 InstrumentationSettings 配置

### 配置项一览

`InstrumentationSettings` 提供了对追踪行为的精细控制。

```python
# 文件: pydantic_ai/_agent_graph.py
from pydantic_ai.settings import InstrumentationSettings

# InstrumentationSettings 控制以下维度：
# - 是否开启 event 级别的追踪
# - 自定义 tracer provider
# - span 属性的过滤规则
```

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `event_mode` | `str` | `'auto'` | 事件记录模式 |
| `tracer_provider` | `TracerProvider \| None` | `None` | 自定义 tracer |

### 使用示例

```python
# 文件: examples/logfire_config.py
from pydantic_ai import Agent
from pydantic_ai.agent import InstrumentationSettings

settings = InstrumentationSettings()
agent = Agent(
    'openai:gpt-4o',
    instrument=settings,
)
```

开发者可以根据环境选择不同的配置策略。
生产环境通常使用默认配置，将数据发送到 Logfire 云端。
开发环境则可以配合 debug 模式将追踪信息输出到控制台。

## 17.4 Span 追踪：请求与响应的可视化

### span 的创建位置

Pydantic AI 在 Agent 运行的核心路径上创建了多层 span。
最外层是 Agent 运行级别的 span，记录整次对话的上下文。
内层则包括每次模型请求、工具调用和输出验证的 span。

```python
# 文件: pydantic_ai/_agent_graph.py
# Agent 运行时的 span 创建逻辑
async def _run_agent_graph(
    self,
    user_prompt: str,
    message_history: list[ModelMessage] | None,
    # ...
):
    # 创建顶层 span，记录用户提示和 Agent 名称
    with logfire_api.span(
        'agent run {prompt=}',
        prompt=user_prompt,
        agent_name=self.name,
    ):
        # 内部循环中的每次模型请求都有独立 span
        ...
```

### span 层级结构

追踪数据形成清晰的树状结构，便于在 Logfire 仪表盘中逐层展开分析。

| 层级 | span 名称 | 记录内容 |
|------|-----------|----------|
| L1 | `agent run` | 用户提示、Agent 配置 |
| L2 | `model request` | 消息列表、模型参数 |
| L3 | `tool call` | 工具名、参数、返回值 |
| L3 | `output validation` | 验证结果、重试信息 |

## 17.5 Agent 运行的追踪数据结构

### 追踪数据的组成

每个 span 携带的属性遵循 OpenTelemetry 的语义约定。
Pydantic AI 在此基础上添加了 AI Agent 专属的属性字段。
这些字段包括模型名称、token 消耗、工具调用次数等关键指标。

```python
# 文件: pydantic_ai/_agent_graph.py
# span 属性示例（伪代码）
span.set_attribute('agent.name', self.name)
span.set_attribute('agent.model', model_name)
span.set_attribute('usage.request_tokens', usage.request_tokens)
span.set_attribute('usage.response_tokens', usage.response_tokens)
span.set_attribute('usage.total_tokens', usage.total_tokens)
```

### 与 RunResult 的关联

`RunResult` 中的 `_run_ctx` 同样持有追踪上下文的引用。
开发者可以通过 `result.usage()` 获取本次运行的 token 消耗。
这些数据与 span 中记录的指标保持一致。

## 17.6 debug 模式与日志输出

### 开启 debug 模式

Pydantic AI 提供了轻量级的 debug 模式，适合开发阶段快速排查问题。
通过设置环境变量或调用 `logfire.configure()` 可以将追踪信息输出到控制台。

```python
# 文件: examples/debug_mode.py
import logfire
from pydantic_ai import Agent

# 配置 Logfire 将输出发送到控制台
logfire.configure(send_to_logfire=False)

agent = Agent('openai:gpt-4o', instrument=True)
result = agent.run_sync('Hello')
# 控制台将打印完整的 span 追踪信息
```

### 日志级别控制

debug 模式会输出详细的请求和响应内容，包括完整的消息列表。
在生产环境中应当关闭 debug 输出，避免敏感信息泄露。
可以通过 Python 标准 `logging` 模块配合 Logfire 的过滤规则进行控制。

## 17.7 与 OpenTelemetry 的关系

### 标准兼容性

Pydantic AI 的追踪实现完全基于 OpenTelemetry Python SDK。
`logfire` 库本身是 OpenTelemetry 的封装层，提供了更友好的 Python API。
这意味着追踪数据可以导出到任何兼容 OTLP 协议的后端。

```python
# 文件: examples/otel_export.py
import logfire
from opentelemetry.sdk.trace.export import ConsoleSpanExporter

# Logfire 底层使用 OpenTelemetry SDK
# 可以配置自定义 exporter 将数据发送到 Jaeger、Zipkin 等
logfire.configure()
```

### 与其他追踪系统的集成

| 后端 | 协议 | 适用场景 |
|------|------|----------|
| Logfire Cloud | OTLP | 生产环境首选 |
| Jaeger | OTLP | 自托管场景 |
| Console | stdout | 开发调试 |

由于采用了 OpenTelemetry 标准，团队可以将 Pydantic AI 的追踪数据与现有的可观测性基础设施无缝对接。
不需要为 AI Agent 单独搭建监控体系。

## 本章小结

本章介绍了 Pydantic AI 与 Logfire 的集成机制。
`instrument` 参数是激活追踪的入口，支持布尔值和 `InstrumentationSettings` 两种配置方式。
框架在 Agent 运行、模型请求、工具调用三个层级自动创建 span，形成树状追踪结构。
追踪数据基于 OpenTelemetry 标准，可导出到 Logfire Cloud、Jaeger 等任意兼容后端。
debug 模式提供了开发阶段的控制台输出能力，生产环境应注意关闭以防敏感信息泄露。
