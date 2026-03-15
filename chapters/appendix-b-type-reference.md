# 附录 B：核心类型速查

## B.1 Agent 类参数全览

`Agent` 是 Pydantic AI 的核心入口类，定义于 `pydantic_ai/agent.py`。

```python
# 文件: pydantic_ai/agent.py
class Agent(Generic[AgentDepsT, OutputDataT]):
    ...
```

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `model` | `Model \| KnownModelName \| None` | `None` | 默认使用的模型 |
| `output_type` | `type[OutputDataT] \| ToolOutput` | `str` | 输出类型定义 |
| `system_prompt` | `str \| Sequence[str]` | `()` | 静态系统提示 |
| `deps_type` | `type[AgentDepsT] \| None` | `None` | 依赖类型声明 |
| `name` | `str \| None` | `None` | Agent 名称 |
| `model_settings` | `ModelSettings \| None` | `None` | 模型级参数 |
| `retries` | `int` | `1` | 默认重试次数 |
| `output_retries` | `int \| None` | `None` | 输出验证重试次数 |
| `tools` | `Sequence[Tool \| Callable]` | `()` | 工具列表 |
| `mcp_servers` | `Sequence[MCPServer]` | `()` | MCP 服务器列表 |
| `instrument` | `InstrumentationSettings \| bool \| None` | `None` | 追踪配置 |
| `end_strategy` | `EndStrategy` | `'early'` | 结束策略 |

## B.2 RunContext 字段全览

`RunContext` 是工具函数和动态提示函数接收的运行时上下文，定义于 `pydantic_ai/tools.py`。

```python
# 文件: pydantic_ai/tools.py
@dataclass
class RunContext(Generic[AgentDepsT]):
    ...
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `deps` | `AgentDepsT` | 用户注入的依赖对象 |
| `model` | `Model` | 当前使用的模型实例 |
| `usage` | `Usage` | 累计 token 消耗 |
| `prompt` | `str` | 当前用户提示 |
| `messages` | `list[ModelMessage]` | 当前消息历史 |
| `run_step` | `int` | 当前运行步骤编号 |
| `retry` | `int` | 当前重试次数 |

## B.3 Tool 类参数全览

`Tool` 封装了单个工具的定义信息，定义于 `pydantic_ai/tools.py`。

```python
# 文件: pydantic_ai/tools.py
@dataclass
class Tool(Generic[AgentDepsT]):
    ...
```

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `function` | `Callable` | 必填 | 工具执行函数 |
| `takes_ctx` | `bool` | `True` | 是否接收 RunContext |
| `name` | `str \| None` | `None` | 工具名称（默认用函数名） |
| `description` | `str \| None` | `None` | 工具描述（默认用 docstring） |
| `retries` | `int \| None` | `None` | 工具级重试次数 |
| `prepare` | `ToolPrepareFunc \| None` | `None` | 动态准备函数 |

## B.4 ModelSettings 字段全览

`ModelSettings` 是传递给模型的参数集合，定义于 `pydantic_ai/settings.py`。

```python
# 文件: pydantic_ai/settings.py
class ModelSettings(TypedDict, total=False):
    ...
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `max_tokens` | `int` | 最大生成 token 数 |
| `temperature` | `float` | 温度参数，控制随机性 |
| `top_p` | `float` | nucleus sampling 参数 |
| `timeout` | `float` | 请求超时时间（秒） |
| `parallel_tool_calls` | `bool` | 是否允许并行工具调用 |

## B.5 RunResult / StreamedRunResult 属性

### RunResult

`RunResult` 封装了 Agent 单次运行的完整结果，定义于 `pydantic_ai/result.py`。

```python
# 文件: pydantic_ai/result.py
class RunResult(Generic[OutputDataT]):
    ...
```

| 属性 / 方法 | 类型 | 说明 |
|-------------|------|------|
| `output` | `OutputDataT` | 类型安全的输出数据 |
| `usage()` | `Usage` | 获取 token 消耗统计 |
| `all_messages()` | `list[ModelMessage]` | 获取完整消息历史 |
| `new_messages()` | `list[ModelMessage]` | 获取本次运行新增的消息 |
| `all_messages_json()` | `bytes` | 消息历史的 JSON 序列化 |

### StreamedRunResult

`StreamedRunResult` 用于流式输出场景，作为异步上下文管理器使用。

```python
# 文件: pydantic_ai/result.py
class StreamedRunResult(Generic[OutputDataT]):
    ...
```

| 属性 / 方法 | 类型 | 说明 |
|-------------|------|------|
| `stream_text()` | `AsyncIterator[str]` | 逐块获取文本输出 |
| `stream_structured()` | `AsyncIterator[OutputDataT]` | 逐步获取结构化输出 |
| `get_output()` | `OutputDataT` | 获取最终完整输出 |
| `usage()` | `Usage` | 获取 token 消耗统计 |
| `all_messages()` | `list[ModelMessage]` | 获取完整消息历史 |

## B.6 ModelMessage 类型层级

消息体系定义于 `pydantic_ai/messages.py`，采用 Union 类型实现多态。

```python
# 文件: pydantic_ai/messages.py
ModelMessage = ModelRequest | ModelResponse
```

### 消息类型树

| 类型 | 父类型 | 包含的 Part 类型 |
|------|--------|-----------------|
| `ModelRequest` | `ModelMessage` | `SystemPromptPart`, `UserPromptPart`, `ToolReturnPart`, `RetryPromptPart` |
| `ModelResponse` | `ModelMessage` | `TextPart`, `ToolCallPart` |

### Part 类型说明

| Part 类型 | 所属消息 | 说明 |
|-----------|----------|------|
| `SystemPromptPart` | `ModelRequest` | 系统提示内容 |
| `UserPromptPart` | `ModelRequest` | 用户输入内容 |
| `ToolReturnPart` | `ModelRequest` | 工具执行返回值 |
| `RetryPromptPart` | `ModelRequest` | 重试提示信息 |
| `TextPart` | `ModelResponse` | 模型文本回复 |
| `ToolCallPart` | `ModelResponse` | 模型发起的工具调用 |

## B.7 UsageLimits 字段

`UsageLimits` 用于限制 Agent 运行过程中的资源消耗，定义于 `pydantic_ai/settings.py`。

```python
# 文件: pydantic_ai/settings.py
@dataclass
class UsageLimits:
    ...
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `request_tokens_limit` | `int \| None` | `None` | 请求 token 上限 |
| `response_tokens_limit` | `int \| None` | `None` | 响应 token 上限 |
| `total_tokens_limit` | `int \| None` | `None` | 总 token 上限 |
| `request_limit` | `int \| None` | `None` | 最大请求次数 |

### Usage 数据类

`Usage` 记录实际的 token 消耗数据，与 `UsageLimits` 配合使用。

```python
# 文件: pydantic_ai/settings.py
@dataclass
class Usage:
    request_tokens: int = 0
    response_tokens: int = 0
    total_tokens: int = 0
    requests: int = 0
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `request_tokens` | `int` | 累计请求 token 数 |
| `response_tokens` | `int` | 累计响应 token 数 |
| `total_tokens` | `int` | 累计总 token 数 |
| `requests` | `int` | 累计请求次数 |
