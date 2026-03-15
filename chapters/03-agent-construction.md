# 第 3 章 Agent 类的构造与生命周期

> `Agent` 是 Pydantic AI 的核心类，也是开发者与框架交互的主入口。本章深入分析 `Agent` 类的泛型设计、构造参数、系统提示的多种形式、输出类型推导机制以及完整的生命周期流程，揭示简洁 API 背后的精巧设计。

## 3.1 Agent 类的泛型设计：Agent[AgentDepsT, OutputDataT]

### 双泛型参数

`Agent` 类通过两个泛型参数实现了完整的类型安全。
`AgentDepsT` 约束依赖注入的类型，`OutputDataT` 约束输出结果的类型。
这意味着从构造到运行到获取结果，类型检查器可以全程追踪类型正确性。

```python
# 文件: pydantic_ai/agent.py
class Agent(Generic[AgentDepsT, OutputDataT]):
    """Main class for creating AI agents with type-safe interactions."""
```

### 泛型的实际效果

当开发者创建 `Agent('openai:gpt-4o', output_type=MyModel)` 时，类型检查器会推导出该 Agent 的输出类型为 `MyModel`。
后续调用 `result.output` 时，IDE 能正确提示 `MyModel` 的所有属性。
如果工具函数的 `RunContext` 类型与 Agent 的 `AgentDepsT` 不匹配，类型检查器会报错。

### 默认类型

当不指定泛型参数时，`AgentDepsT` 默认为 `NoneType`，`OutputDataT` 默认为 `str`。
这解释了为什么最简单的 Agent 可以直接返回字符串结果而无需额外配置。

## 3.2 构造函数参数详解

### 完整签名

`Agent.__init__` 的参数设计体现了"合理默认值 + 显式覆盖"的理念。

```python
# 文件: pydantic_ai/agent.py
class Agent(Generic[AgentDepsT, OutputDataT]):
    def __init__(
        self,
        model: Model | KnownModelName | None = None,
        *,
        result_type: type[OutputDataT] = str,
        system_prompt: str | Sequence[str] = (),
        deps_type: type[AgentDepsT] = NoneType,
        tools: Sequence[Tool[AgentDepsT] | ToolFuncEither[AgentDepsT, ...]] = (),
        retries: int = 1,
        output_type: type[OutputDataT] | ToolOutput[OutputDataT] | None = None,
        model_settings: ModelSettings | None = None,
        end_strategy: EndStrategy = 'early',
        instrument: InstrumentationSettings | bool | None = None,
    ):
```

### 关键参数说明

| 参数 | 类型 | 默认值 | 用途 |
|------|------|--------|------|
| model | Model / str / None | None | 指定 LLM 模型 |
| system_prompt | str / Sequence[str] | () | 系统提示词 |
| output_type | type / ToolOutput / None | None | 输出类型约束 |
| tools | Sequence[Tool / func] | () | 注册工具列表 |
| retries | int | 1 | 验证失败重试次数 |

### model 参数的灵活性

`model` 参数接受三种形式的值。
字符串形式如 `'openai:gpt-4o'` 会被自动解析为对应的模型适配器实例。
也可以直接传入 `Model` 实例以获得更精细的控制。
传入 `None` 则延迟到运行时指定，方便测试替换。

## 3.3 system_prompt 的三种形式

### 形式一：字符串

最简单的方式是在构造时传入字符串。
支持单个字符串或字符串列表，多个字符串会按顺序拼接。

```python
# 文件: examples/system_prompt_string.py
agent = Agent(
    'openai:gpt-4o',
    system_prompt='You are a helpful assistant.',
)
```

### 形式二：函数

通过函数形式可以实现动态系统提示。
函数接收 `RunContext` 参数，可以根据运行时依赖生成不同的提示内容。

```python
# 文件: examples/system_prompt_function.py
from pydantic_ai import Agent, RunContext

agent = Agent('openai:gpt-4o', deps_type=str)

@agent.system_prompt
def get_system_prompt(ctx: RunContext[str]) -> str:
    return f'You are helping user: {ctx.deps}'
```

### 形式三：装饰器（异步）

装饰器形式同样支持异步函数。
这在需要从数据库或外部服务获取提示内容时非常有用。

```python
# 文件: pydantic_ai/agent.py
@overload
def system_prompt(
    self, func: Callable[[RunContext[AgentDepsT]], str], /
) -> Callable[[RunContext[AgentDepsT]], str]: ...

@overload
def system_prompt(
    self, func: Callable[[RunContext[AgentDepsT]], Awaitable[str]], /
) -> Callable[[RunContext[AgentDepsT]], Awaitable[str]]: ...
```

### 三种形式的对比

| 形式 | 是否动态 | 是否支持依赖 | 适用场景 |
|------|---------|-------------|---------|
| 字符串 | 否 | 否 | 固定提示 |
| 同步函数 | 是 | 是 | 根据上下文生成 |
| 异步函数 | 是 | 是 | 需要 IO 操作 |

## 3.4 output_type 与结果类型推导

### 输出类型机制

`output_type` 参数决定了 Agent 如何处理模型的返回内容。
默认为 `str`，此时模型的文本输出直接作为结果。
指定 Pydantic 模型时，框架会要求 LLM 返回 JSON 并自动验证。

```python
# 文件: examples/output_type.py
from pydantic import BaseModel
from pydantic_ai import Agent

class WeatherReport(BaseModel):
    city: str
    temperature: float
    description: str

agent = Agent('openai:gpt-4o', output_type=WeatherReport)
result = agent.run_sync('Weather in Tokyo')
# result.output 的类型是 WeatherReport
print(result.output.temperature)
```

### 验证与重试

当模型返回的 JSON 不符合 `output_type` 的 schema 时，Pydantic 验证会失败。
框架会将验证错误信息发送回模型，要求其修正输出。
`retries` 参数控制最大重试次数，默认为 1 次。

## 3.5 工具注册机制

### 构造时注册

通过 `tools` 参数可以在构造 Agent 时直接注册工具。
可以传入 `Tool` 实例或普通函数，框架会自动包装。

```python
# 文件: examples/tools_constructor.py
from pydantic_ai import Agent, Tool

def get_weather(city: str) -> str:
    """Get the current weather for a city."""
    return f'Sunny in {city}'

agent = Agent(
    'openai:gpt-4o',
    tools=[Tool(get_weather)],
)
```

### 装饰器注册

更常用的方式是通过 `@agent.tool` 装饰器注册。
装饰器方式代码更简洁，且支持 `RunContext` 注入。

```python
# 文件: examples/tools_decorator.py
from pydantic_ai import Agent, RunContext

agent = Agent('openai:gpt-4o', deps_type=str)

@agent.tool
def get_user_info(ctx: RunContext[str], field: str) -> str:
    """Get information about the current user."""
    return f'User {ctx.deps} field {field}'
```

### 两种方式的对比

| 方式 | 优点 | 缺点 |
|------|------|------|
| 构造时注册 | 工具列表集中可见 | 无法使用 RunContext |
| 装饰器注册 | 代码简洁，支持依赖注入 | 工具分散在各处 |

实际上构造时注册的函数同样可以接收 `RunContext`，框架会自动检测。
装饰器方式更符合 Python 的习惯用法，是推荐的使用方式。

## 3.6 Agent 生命周期：构造 → 运行 → 结果

### 完整生命周期

Agent 的生命周期分为三个阶段，每个阶段都有明确的职责。

**构造阶段**：创建 Agent 实例，注册工具、设定系统提示和输出类型。
此阶段不涉及任何网络调用，是纯粹的配置过程。

**运行阶段**：调用 `run()`、`run_sync()` 或 `run_stream()` 启动执行。
框架构建消息列表，发送给模型，处理工具调用，循环直到获得最终结果。

**结果阶段**：返回 `RunResult` 或 `StreamedRunResult` 对象。
结果对象包含类型安全的 `output` 属性以及 `usage()`、`all_messages()` 等元信息方法。

```python
# 文件: examples/lifecycle.py
from pydantic_ai import Agent

# 1. 构造阶段
agent = Agent('openai:gpt-4o', system_prompt='Be helpful.')

# 2. 运行阶段
result = agent.run_sync('Hello')

# 3. 结果阶段
print(result.output)           # 类型安全的输出
print(result.usage())          # token 用量统计
print(result.all_messages())   # 完整对话历史
```

### 运行方法对比

| 方法 | 返回类型 | 适用场景 |
|------|---------|---------|
| `run()` | `RunResult` | 异步环境 |
| `run_sync()` | `RunResult` | 同步脚本 |
| `run_stream()` | `StreamedRunResult` | 流式输出 |

`run_sync()` 内部会创建事件循环并调用 `run()`。
`run_stream()` 返回异步上下文管理器，支持逐 token 读取输出。

## 本章小结

本章深入分析了 `Agent` 类的构造机制与生命周期。
双泛型设计 `Agent[AgentDepsT, OutputDataT]` 是类型安全的基石。
构造函数通过合理的默认值实现了"简单场景简单写，复杂场景可扩展"。
系统提示支持字符串、同步函数、异步函数三种形式，灵活适配不同场景。
`output_type` 配合 Pydantic 验证实现了结构化输出的自动校验与重试。
工具注册同时支持构造时传入和装饰器两种方式，推荐使用装饰器。
理解了 Agent 的构造与生命周期，下一章将深入其运行阶段的执行引擎。
