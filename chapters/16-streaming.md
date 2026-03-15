## 第 16 章 流式输出

> 流式输出允许 Agent 在模型生成内容的同时逐步将结果交付给用户，显著提升交互体验。Pydantic AI 通过 `StreamedRunResult` 类提供了文本流和结构化流两种模式，支持增量（delta）和完整内容两种传输方式。本章将深入剖析流式输出的架构设计、核心 API 及实际应用模式。

### 16.1 流式输出的架构设计

流式输出的核心思想是将一次完整的模型响应拆分为多个小片段逐步交付。
用户不必等待模型生成全部内容后才看到结果，而是能实时看到文字逐渐出现。
这种模式在聊天应用和实时助手场景中至关重要。

Pydantic AI 的流式架构包含三个层次：

| 层次 | 组件 | 职责 |
|------|------|------|
| 入口层 | `Agent.run_stream()` | 启动流式运行，返回上下文管理器 |
| 结果层 | `StreamedRunResult` | 封装流式结果，提供迭代接口 |
| 传输层 | Model 适配器 | 将模型的 SSE 流转换为统一的 Part 事件 |

`run_stream()` 返回一个异步上下文管理器，进入后得到 `StreamedRunResult` 实例。
模型适配器在底层持续接收来自 LLM API 的流式数据，并将其转换为标准的消息 Part。
`StreamedRunResult` 将这些 Part 暴露为异步迭代器供开发者消费。

### 16.2 StreamedRunResult 详解

`StreamedRunResult` 是流式输出的核心类，提供了多种数据消费方式。

```python
# 文件: pydantic_ai/result.py
@dataclass
class StreamedRunResult(Generic[AgentDepsT, OutputDataT]):
    async def stream(self) -> AsyncIterator[str]:
        """以文本块的形式流式输出响应。"""
        ...

    async def stream_text(self, delta: bool = False) -> AsyncIterator[str]:
        """流式输出文本部分，可选增量模式。"""
        ...

    async def stream_structured(
        self, output_type: type[T] | None = None
    ) -> AsyncIterator[T]:
        """流式输出结构化数据的部分对象。"""
        ...

    async def get_output(self) -> OutputDataT:
        """等待完整输出并返回。"""
        ...
```

`StreamedRunResult` 同样是泛型类，携带 `AgentDepsT` 和 `OutputDataT` 两个类型参数。
它与非流式的 `RunResult` 共享相同的消息访问接口，如 `all_messages()` 和 `new_messages()`。
流式结果在完全消费后，其消息列表才是完整的。

使用流式结果时，必须通过异步上下文管理器进入：

```python
from pydantic_ai import Agent

agent = Agent('openai:gpt-4o')

async with agent.run_stream('Tell me a story') as result:
    # result 是 StreamedRunResult 实例
    async for text in result.stream_text():
        print(text, end='', flush=True)
```

### 16.3 stream_text()：文本流

`stream_text()` 是最常用的流式消费方法，返回文本片段的异步迭代器。
它的核心参数是 `delta`，控制返回内容是增量还是累积。

```python
# delta=False（默认）：每次返回到目前为止的完整文本
async with agent.run_stream('Hello') as result:
    async for text in result.stream_text(delta=False):
        print(repr(text))
# 'Hello'
# 'Hello, how'
# 'Hello, how are'
# 'Hello, how are you?'
```

```python
# delta=True：每次只返回新增的文本片段
async with agent.run_stream('Hello') as result:
    async for text in result.stream_text(delta=True):
        print(text, end='', flush=True)
# Hello, how are you?（逐步打印）
```

| 模式 | delta 值 | 返回内容 | 适用场景 |
|------|---------|---------|---------|
| 累积模式 | `False` | 到目前为止的完整文本 | UI 状态替换 |
| 增量模式 | `True` | 仅新增的文本片段 | 终端逐字打印、WebSocket 推送 |

累积模式适合需要替换整个显示区域的 UI 场景，每次收到新文本直接覆盖。
增量模式适合追加输出的场景，例如在终端逐字打印或通过 WebSocket 向前端推送。

### 16.4 stream_structured()：结构化流

当 Agent 配置了结构化输出类型时，`stream_structured()` 可以流式返回部分解析的对象。

```python
from pydantic import BaseModel
from pydantic_ai import Agent

class StoryOutline(BaseModel):
    title: str
    chapters: list[str]
    summary: str

agent = Agent('openai:gpt-4o', output_type=StoryOutline)

async with agent.run_stream('Create a story outline') as result:
    async for partial in result.stream_structured():
        # partial 是 StoryOutline 的部分实例
        print(f'Title: {partial.title}')
```

结构化流的实现依赖模型返回 JSON 数据的流式解析。
框架在每次收到新的 JSON 片段时，尝试将当前已有内容解析为目标类型的部分实例。
尚未接收到的字段会使用默认值或 `None` 填充。

这种能力在构建实时仪表盘或进度展示界面时非常有用。
用户可以在模型尚未完成全部输出时就看到部分结构化数据。

### 16.5 delta 模式：增量 vs 完整内容

delta 模式的选择直接影响客户端的处理逻辑和网络传输效率。

在增量模式下，每个迭代项只包含自上次以来新增的内容。
客户端需要自行维护状态，将增量片段拼接成完整内容。
这种模式传输的数据量最小，适合网络带宽有限的场景。

在累积模式下，每个迭代项包含从开始到当前的完整内容。
客户端无需维护状态，直接使用最新的完整内容即可。
但随着内容增长，后续迭代项的数据量会越来越大。

框架在内部始终维护完整的内容缓冲区。
增量模式通过计算当前缓冲区与上次返回之间的差异来生成 delta。
这意味着两种模式在框架内部的开销是相同的，差异只在于交付给开发者的数据量。

### 16.6 流式输出中的工具调用处理

流式输出与工具调用可以共存。
当模型在流式过程中发出工具调用时，框架会暂停文本流的交付，执行工具，然后继续流式。

```python
from pydantic_ai import Agent

agent = Agent('openai:gpt-4o')

@agent.tool_plain
def get_weather(city: str) -> str:
    return f'{city}: 25°C, sunny'

async with agent.run_stream('What is the weather in Beijing?') as result:
    async for text in result.stream_text(delta=True):
        print(text, end='', flush=True)
```

在上述场景中，模型可能先输出"让我查一下"等文本，然后发出工具调用。
框架执行 `get_weather` 工具后，将结果注入对话上下文。
模型基于工具结果继续生成文本，最终的回答会包含实际的天气信息。

需要注意的是，工具调用期间流式迭代器会处于等待状态。
只有当工具执行完成并且模型开始生成新的文本时，迭代器才会继续产出内容。

### 16.7 流式输出的实际应用模式

**Web 应用集成**：通过 SSE 将流式文本推送到浏览器前端。

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic_ai import Agent

app = FastAPI()
agent = Agent('openai:gpt-4o')

@app.get('/chat')
async def chat(prompt: str):
    async def generate():
        async with agent.run_stream(prompt) as result:
            async for text in result.stream_text(delta=True):
                yield f'data: {text}\n\n'
    return StreamingResponse(generate(), media_type='text/event-stream')
```

**终端交互**：使用增量模式在终端实时打印。

```python
async with agent.run_stream('Explain quantum computing') as result:
    async for chunk in result.stream_text(delta=True):
        print(chunk, end='', flush=True)
    print()  # 最后换行
```

**超时控制**：流式结果支持与 `asyncio.timeout` 结合使用。
如果在指定时间内模型未能完成生成，可以提前终止并使用已有内容。

```python
import asyncio

async with agent.run_stream('Write a long essay') as result:
    collected = []
    try:
        async with asyncio.timeout(10):
            async for text in result.stream_text(delta=True):
                collected.append(text)
    except TimeoutError:
        print('Timeout, using partial result')
    print(''.join(collected))
```

### 本章小结

Pydantic AI 的流式输出通过 `StreamedRunResult` 提供了统一的异步迭代接口。
`stream_text()` 支持增量和累积两种模式，适配不同的客户端消费场景。
`stream_structured()` 实现了结构化数据的渐进式解析，提升了实时展示体验。
流式输出与工具调用机制无缝协作，框架自动处理工具执行期间的流暂停与恢复。
在实际应用中，流式输出可以与 FastAPI SSE、终端打印、超时控制等模式灵活结合。
