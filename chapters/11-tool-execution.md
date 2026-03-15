# 第 11 章 工具执行引擎

> 工具注册只是第一步，真正的挑战在于执行。Pydantic AI 的工具执行引擎负责参数验证、函数调用、结果处理和错误恢复的完整链路。本章将追踪一次工具调用从模型发起到结果返回的全过程，重点解析 `prepare_func` 动态准备、参数反序列化、`ModelRetry` 异常驱动的自我修正机制。

## 11.1 工具调用的完整流程

### 从模型请求到结果返回

一次工具调用经历五个阶段：工具定义准备、模型选择工具、参数验证、函数执行、结果返回。
这一流程在 `_agent_graph.py` 的 `CallToolsNode` 中被编排。
每个阶段都有明确的错误处理路径，确保异常不会导致 Agent 崩溃。

### 流程概览

| 阶段 | 核心操作 | 关键类/函数 |
|------|---------|------------|
| 准备 | 调用 prepare_func 构建定义 | `Tool.prepare_tool_def` |
| 选择 | 模型决定调用哪个工具 | `ToolCallPart` |
| 验证 | 参数反序列化与校验 | `FunctionSchema.validator` |
| 执行 | 调用工具函数 | `FunctionSchema.call` |
| 返回 | 结果封装为消息 | `ToolReturnPart` |

## 11.2 prepare_func：动态工具准备

### ToolPrepareFunc 类型定义

`ToolPrepareFunc` 允许开发者在每次模型调用前动态修改或过滤工具定义。
它接收 `RunContext` 和 `ToolDefinition`，返回修改后的定义或 `None`（表示跳过该工具）。
这一机制让工具集可以根据运行时状态动态变化。

```python
# 文件: pydantic_ai/tools.py
ToolPrepareFunc: TypeAlias = Callable[
    [RunContext[AgentDepsT], ToolDefinition],
    Awaitable[ToolDefinition | None],
]
```

### prepare_tool_def 方法

`Tool` 类的 `prepare_tool_def` 方法是准备阶段的入口。
如果设置了 `prepare` 函数则调用它，否则直接返回基础定义。
返回 `None` 意味着该工具在本轮对话中不可用。

```python
# 文件: pydantic_ai/tools.py
async def prepare_tool_def(
    self, ctx: RunContext[AgentDepsT]
) -> ToolDefinition | None:
    base_tool_def = self.tool_def
    if self.prepare is not None:
        return await self.prepare(ctx, base_tool_def)
    else:
        return base_tool_def
```

### 动态工具示例

```python
# 文件: examples/prepare_func.py
from pydantic_ai import Agent, RunContext, Tool
from pydantic_ai.tools import ToolDefinition

async def only_for_admin(
    ctx: RunContext[dict], tool_def: ToolDefinition
) -> ToolDefinition | None:
    if ctx.deps.get('role') == 'admin':
        return tool_def
    return None  # 非管理员时隐藏此工具

def delete_record(ctx: RunContext[dict], record_id: int) -> str:
    """Delete a record by ID."""
    return f"Deleted record {record_id}"

agent = Agent('openai:gpt-4o', deps_type=dict,
              tools=[Tool(delete_record, prepare=only_for_admin)])
```

## 11.3 工具参数的验证与反序列化

### FunctionSchema 的验证机制

当模型返回工具调用请求时，参数以 JSON 字典形式传入。
`FunctionSchema` 内部使用 Pydantic 的 `SchemaValidator` 对参数进行校验。
验证通过后，参数被转换为 Python 原生类型并传给工具函数。

```python
# 文件: pydantic_ai/_function_schema.py
@dataclass
class FunctionSchema:
    validator: SchemaValidator
    json_schema: ObjectJsonSchema

    async def call(self, args_dict: dict[str, Any],
                   ctx: RunContext[Any]) -> Any:
        args, kwargs = self._call_args(args_dict, ctx)
        if self.is_async:
            return await self.function(*args, **kwargs)
        else:
            return await run_in_executor(
                self.function, *args, **kwargs
            )
```

### 参数分发逻辑

`_call_args` 方法负责将验证后的参数字典拆分为位置参数和关键字参数。
如果 `takes_ctx` 为 `True`，则将 `RunContext` 作为第一个位置参数注入。
`single_arg_name` 处理单参数工具的特殊情况，将整个字典包装为单个参数。

```python
# 文件: pydantic_ai/_function_schema.py
def _call_args(self, args_dict: dict[str, Any],
               ctx: RunContext[Any]):
    if self.single_arg_name:
        args_dict = {self.single_arg_name: args_dict}
    args = [ctx] if self.takes_ctx else []
    for positional_field in self.positional_fields:
        args.append(args_dict.pop(positional_field))
    return args, args_dict
```

## 11.4 工具执行与结果处理

### 同步与异步的统一

`FunctionSchema.call` 方法统一处理同步和异步工具函数。
异步函数直接 `await`，同步函数通过 `run_in_executor` 在线程池中执行。
这一设计让开发者无需关心 Agent 的运行模式，自由选择同步或异步编写工具。

### 结果封装

工具执行完成后，结果被封装为 `ToolReturnPart` 消息返回给模型。
该消息包含工具名称、调用 ID 和返回内容，确保模型能正确关联请求与响应。

## 11.5 工具重试机制

### 重试计数与上限

每个工具都有 `max_retries` 属性控制最大重试次数。
如果未设置，则使用 Agent 级别的默认值。
`GraphAgentState` 维护全局重试计数器，超出上限后抛出异常终止运行。

### 重试触发条件

重试由两类情况触发：参数验证失败和工具函数主动抛出 `ModelRetry`。
两者都会生成 `RetryPromptPart` 消息发送给模型，告知错误原因。
模型收到重试消息后，会尝试修正参数或调用策略重新发起请求。

## 11.6 ModelRetry 异常：让模型自我修正

### 异常定义

`ModelRetry` 是 Pydantic AI 独创的异常类型，它将错误信息反馈给模型而非终止程序。
工具函数可以在检测到无效输入时抛出此异常，触发模型自我修正。

```python
# 文件: pydantic_ai/exceptions.py
class ModelRetry(Exception):
    """Exception raised when a tool function should be retried."""
    message: str

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)
```

### 使用示例

```python
# 文件: examples/model_retry.py
from pydantic_ai import Agent, RunContext, ModelRetry

agent = Agent('openai:gpt-4o', deps_type=dict)

@agent.tool
def get_user(ctx: RunContext[dict], user_id: int) -> str:
    """Get user information by ID.

    Args:
        user_id: The user ID to look up.
    """
    if user_id < 0:
        raise ModelRetry('user_id must be positive')
    return f"User {user_id}: Alice"
```

### 异常处理链

当 `ModelRetry` 被抛出时，框架内部将其转换为 `ToolRetryError`。
`ToolRetryError` 包含一个 `RetryPromptPart`，携带错误消息和工具调用 ID。
这个消息被追加到对话历史中，模型在下一轮请求时会看到错误提示。

```python
# 文件: pydantic_ai/_output.py
except ModelRetry as r:
    m = _messages.RetryPromptPart(
        content=r.message,
        tool_name=run_context.tool_name,
    )
    if run_context.tool_call_id:
        m.tool_call_id = run_context.tool_call_id
    raise ToolRetryError(m) from r
```

## 11.7 工具调用的错误处理链

### 三层错误处理

Pydantic AI 的工具执行采用三层错误处理策略。
第一层是参数验证错误，由 `SchemaValidator` 在调用前捕获。
第二层是 `ModelRetry` 异常，触发模型重试。
第三层是未预期异常，由 `CallToolsNode` 统一处理并记录。

### 错误处理对比

| 错误类型 | 处理方式 | 是否重试 |
|---------|---------|---------|
| 参数验证失败 | 返回 `RetryPromptPart` | 是 |
| `ModelRetry` | 返回错误消息给模型 | 是 |
| 超出重试上限 | 抛出异常终止运行 | 否 |
| 未预期异常 | 记录并终止 | 否 |

### _handle_tool_calls 核心逻辑

`CallToolsNode._handle_tool_calls` 方法遍历所有工具调用请求。
每个调用通过 `ToolManager.handle_call` 执行，捕获 `ToolRetryError` 后将重试消息加入响应。
成功执行的结果则封装为 `ToolReturnPart`。

```python
# 文件: pydantic_ai/_agent_graph.py
try:
    tool_result = await tool_manager.handle_call(tool_call)
except ToolRetryError as e:
    return (e.tool_retry, [])
```

## 本章小结

本章完整追踪了 Pydantic AI 工具执行引擎的运作机制。
工具调用经历准备、验证、执行、结果处理四个阶段，每个阶段都有清晰的错误处理路径。
`prepare_func` 提供了动态工具定义的能力，让工具集可以根据运行时状态变化。
`FunctionSchema` 统一了同步和异步函数的调用方式，并提供基于 Pydantic 的参数验证。
`ModelRetry` 异常是框架的独特设计，它将错误信息反馈给模型实现自我修正，而非简单地终止程序。
