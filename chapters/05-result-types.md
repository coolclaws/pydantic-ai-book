## 第 5 章 结果类型系统

> Pydantic AI 通过 `RunResult` 和 `StreamedRunResult` 两种结果类型封装 Agent 的运行输出。本章将深入分析结果类型的源码结构、`output` 属性的类型安全机制、`Usage` 统计系统，以及消息历史的管理方式。

### 5.1 RunResult：同步运行结果

`RunResult` 是 `run()` 和 `run_sync()` 的返回类型，包含了 Agent 一次完整运行的全部信息。它是一个泛型数据类，通过两个类型参数分别约束依赖类型和输出数据类型。

```python
# 文件: pydantic_ai/result.py
@dataclass
class RunResult(Generic[AgentDepsT, OutputDataT]):
    output: OutputDataT
    _all_messages: list[ModelMessage]
    _new_messages: list[ModelMessage]
    _usage: Usage

    def all_messages(self) -> list[ModelMessage]: ...
    def new_messages(self) -> list[ModelMessage]: ...
    def usage(self) -> Usage: ...
```

`RunResult` 的设计遵循了信息封装的原则。消息列表和用量统计以私有属性存储，通过公开方法访问。这为未来可能的延迟计算或缓存优化保留了空间。

`output` 属性直接暴露为公开字段，因为它是使用者最频繁访问的数据，简洁的访问路径提升了开发体验。

### 5.2 StreamedRunResult：流式运行结果

`StreamedRunResult` 是 `run_stream()` 返回的结果类型。与 `RunResult` 不同，它提供了多种异步迭代器方法，允许逐步获取模型输出。

```python
# 文件: pydantic_ai/result.py
@dataclass
class StreamedRunResult(Generic[AgentDepsT, OutputDataT]):
    async def stream(self) -> AsyncIterator[str]: ...
    async def stream_text(self, delta: bool = False) -> AsyncIterator[str]: ...
    async def stream_structured(self, ...) -> AsyncIterator[OutputDataT]: ...
    async def get_output(self) -> OutputDataT: ...
```

其中 `stream_text()` 方法的 `delta` 参数控制输出方式。当 `delta=False` 时，每次迭代返回到目前为止的完整文本；当 `delta=True` 时，仅返回新增的文本片段。

| 方法 | 返回类型 | 用途 |
|------|---------|------|
| `stream()` | `AsyncIterator[str]` | 通用文本流 |
| `stream_text()` | `AsyncIterator[str]` | 纯文本流输出 |
| `stream_structured()` | `AsyncIterator[OutputDataT]` | 结构化数据流 |
| `get_output()` | `OutputDataT` | 等待完整结果 |

`get_output()` 方法会等待流式传输完成后返回最终的完整输出。它适用于需要流式展示中间过程但最终仍需完整结果的场景。

### 5.3 output 属性与类型安全

Pydantic AI 的一大设计亮点是结果类型的完整类型安全性。`output` 属性的类型与 Agent 定义时指定的 `output_type` 严格对应。

```python
# 使用示例
from pydantic import BaseModel
from pydantic_ai import Agent

class CityInfo(BaseModel):
    name: str
    population: int
    country: str

agent = Agent('openai:gpt-4o', output_type=CityInfo)
result = agent.run_sync('Tell me about Paris')
# result.output 的类型是 CityInfo，IDE 可以提供完整的自动补全
print(result.output.name)       # 类型检查通过
print(result.output.population) # 类型检查通过
```

当未指定 `output_type` 时，默认输出类型为 `str`。Pydantic AI 通过 Python 泛型机制在类型检查层面保证了 `result.output` 的类型正确性，无需运行时的类型断言。

模型返回的原始数据会经过 Pydantic 验证。如果验证失败，Agent 的重试机制会将错误信息反馈给模型，请求修正输出格式。

### 5.4 result_type 的类型推导机制

Pydantic AI 的类型推导依赖 Python 的 `Generic` 机制和 `overload` 装饰器。Agent 类在定义时通过泛型参数捕获输出类型信息，并将其传递到返回的 `RunResult` 中。

```python
# 文件: pydantic_ai/agent.py
class Agent(Generic[AgentDepsT, OutputDataT]):
    # 通过 output_type 参数在构造时确定 OutputDataT
    def __init__(
        self,
        model: Model | KnownModelName | None = None,
        *,
        output_type: type[OutputDataT] = str,
        deps_type: type[AgentDepsT] = NoneType,
        ...
    ): ...
```

这种设计使得类型检查器（如 mypy 和 pyright）能够在编译时推断出 `result.output` 的具体类型。对于联合类型的输出，Pydantic AI 同样支持：

```python
# 使用示例：联合输出类型
agent = Agent('openai:gpt-4o', output_type=CityInfo | CountryInfo)
result = agent.run_sync('Tell me about France')
# result.output 类型为 CityInfo | CountryInfo
```

类型推导在整个调用链中保持一致，从 Agent 构造到 `run()` 调用再到结果访问，类型信息不会丢失。

### 5.5 Usage 统计：token 消耗追踪

每次 Agent 运行都会产生 token 消耗，`Usage` 类负责记录这些统计信息。通过 `result.usage()` 方法可以获取完整的用量数据。

```python
# 文件: pydantic_ai/usage.py
@dataclass
class Usage:
    request_tokens: int | None = None
    response_tokens: int | None = None
    total_tokens: int | None = None
    requests: int = 0
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `request_tokens` | `int \| None` | 请求消耗的 token 数 |
| `response_tokens` | `int \| None` | 响应消耗的 token 数 |
| `total_tokens` | `int \| None` | 总 token 数 |
| `requests` | `int` | 模型调用次数 |

`requests` 字段特别有用，因为一次 `run()` 调用可能触发多次模型请求（例如工具调用循环或重试）。通过监控这个值，开发者可以了解 Agent 的实际交互复杂度。

`Usage` 对象支持累加操作，方便在多次运行间汇总统计数据。配合 `UsageLimits` 可以设置消耗上限，防止意外的高成本调用。

### 5.6 消息历史的获取

`RunResult` 提供了两种获取消息历史的方法：`all_messages()` 和 `new_messages()`。两者的区别在于是否包含传入的历史消息。

```python
# 使用示例：消息历史管理
result1 = agent.run_sync('你好')
history = result1.all_messages()

# 将历史传入下一次运行，实现多轮对话
result2 = agent.run_sync(
    '继续上面的话题',
    message_history=history,
)

# all_messages() 包含完整历史
# new_messages() 仅包含本次运行新增的消息
print(len(result2.all_messages()))  # 包含两轮对话
print(len(result2.new_messages()))  # 仅本轮消息
```

`all_messages()` 返回从第一轮对话开始的完整消息列表，包括传入的 `message_history` 和本次运行新产生的消息。`new_messages()` 仅返回本次运行中新增的消息。

这种设计使得多轮对话的实现变得简单自然。开发者只需将前一次运行的 `all_messages()` 结果传递给下一次运行的 `message_history` 参数即可。

### 本章小结

本章分析了 Pydantic AI 的结果类型系统。`RunResult` 封装了完整运行结果，`StreamedRunResult` 提供流式输出能力。`output` 属性通过泛型机制实现了端到端的类型安全。`Usage` 类提供了细粒度的 token 消耗追踪，而 `all_messages()` 和 `new_messages()` 方法为多轮对话提供了便捷的消息历史管理。整个结果类型系统体现了 Pydantic AI 在类型安全和开发体验之间的精心平衡。
