# 第 18 章 测试与 Mock

> 可测试性是 Pydantic AI 的核心设计目标之一。框架内置了 `TestModel` 和 `FunctionModel` 两种测试专用模型，使开发者无需调用真实 LLM API 即可对 Agent 进行确定性测试。本章将深入分析这两种测试模型的实现原理，并介绍工具调用测试、流式输出测试和集成测试的最佳实践。

## 18.1 测试的设计哲学

### 为什么需要专用测试模型

AI Agent 的测试面临独特的挑战：LLM 的输出具有不确定性。
每次调用可能返回不同的文本，这让传统的断言方式难以奏效。
更实际的问题是，频繁调用真实 API 会产生高昂的成本和延迟。
Pydantic AI 通过模型抽象层解决了这个问题。

### 模型替换策略

由于 `Agent` 的 `run` 系列方法都接受可选的 `model` 参数，测试时可以轻松替换模型。
生产代码使用真实模型，测试代码传入 `TestModel` 或 `FunctionModel`。
这种设计不需要任何 mock 框架或猴子补丁，是原生支持的测试策略。

```python
# 文件: examples/test_basic.py
from pydantic_ai import Agent
from pydantic_ai.models.test import TestModel

agent = Agent('openai:gpt-4o', system_prompt='Be helpful.')

# 测试时替换模型，无需调用真实 API
result = agent.run_sync(
    'What is Python?',
    model=TestModel(custom_output_text='A programming language.')
)
assert result.output == 'A programming language.'
```

## 18.2 TestModel：确定性测试模型

### 类定义与核心字段

`TestModel` 继承自 `Model` 基类，提供完全确定性的响应。
它不发起任何网络请求，所有响应数据在构造时就已确定。

```python
# 文件: pydantic_ai/models/test.py
@dataclass
class TestModel(Model):
    """用于测试的确定性模型，返回预定义的响应。"""

    custom_output_text: str | None = None
    custom_output_args: dict[str, Any] | None = None
    call_tools: list[str] | Literal['all'] | None = None
    seed: int = 0
    model_name: str = 'test'
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `custom_output_text` | `str \| None` | 自定义文本响应 |
| `custom_output_args` | `dict \| None` | 自定义结构化输出参数 |
| `call_tools` | `list[str] \| 'all' \| None` | 指定要调用的工具 |
| `seed` | `int` | 随机种子，影响默认输出 |

### 响应生成逻辑

当 `custom_output_text` 不为 `None` 时，`TestModel` 直接返回该文本。
当 `custom_output_args` 不为 `None` 时，返回结构化的工具调用响应。
如果两者都为 `None`，则根据 `seed` 和输出工具的 schema 生成默认值。

## 18.3 FunctionModel：自定义响应逻辑

### 更灵活的测试模型

`FunctionModel` 将响应生成的逻辑委托给用户提供的函数。
它适用于需要根据输入动态生成响应的测试场景。

```python
# 文件: pydantic_ai/models/test.py
@dataclass
class FunctionModel(Model):
    """将响应生成委托给用户函数的模型。"""

    function: FunctionModelFunc | None = None
    stream_function: StreamFunctionModelFunc | None = None
    model_name: str = 'function'
```

### 函数签名

用户提供的函数需要遵循特定的签名规范。
函数接收消息列表和模型信息，返回 `ModelResponse` 对象。

```python
# 文件: pydantic_ai/models/test.py
# FunctionModelFunc 的类型签名
FunctionModelFunc = Callable[
    [list[ModelMessage], ModelSettings | None],
    ModelResponse | Awaitable[ModelResponse],
]
```

### 使用示例

```python
# 文件: examples/test_function_model.py
from pydantic_ai import Agent
from pydantic_ai.models.test import FunctionModel
from pydantic_ai.messages import ModelResponse, TextPart

def my_model(messages, settings):
    """根据用户输入生成动态响应。"""
    last_user_msg = messages[-1]
    return ModelResponse(parts=[TextPart(content='Echo: done')])

agent = Agent('openai:gpt-4o')
result = agent.run_sync('Hello', model=FunctionModel(function=my_model))
assert 'Echo' in result.output
```

## 18.4 TestModel 的配置选项

### seed 的作用

`seed` 参数影响 `TestModel` 在未指定 `custom_output_text` 时的默认行为。
不同的 seed 值会生成不同的默认输出，使测试具有可重复性。

```python
# 文件: examples/test_seed.py
from pydantic_ai import Agent
from pydantic_ai.models.test import TestModel

agent = Agent('openai:gpt-4o')

# 相同 seed 产生相同的默认输出
r1 = agent.run_sync('Hi', model=TestModel(seed=42))
r2 = agent.run_sync('Hi', model=TestModel(seed=42))
assert r1.output == r2.output
```

### call_tools 参数

`call_tools` 控制 `TestModel` 在响应中是否包含工具调用。
设置为 `'all'` 时，模型会尝试调用所有已注册的工具。
设置为具体的工具名称列表时，只调用指定的工具。

## 18.5 测试工具调用

### 验证工具被正确调用

测试 Agent 的工具调用行为是常见的测试需求。
`TestModel` 的 `call_tools` 参数让这一过程变得简单。

```python
# 文件: examples/test_tools.py
from pydantic_ai import Agent, RunContext
from pydantic_ai.models.test import TestModel

agent = Agent('openai:gpt-4o')

@agent.tool
def get_weather(ctx: RunContext[None], city: str) -> str:
    return f'Sunny in {city}'

# 指定 TestModel 调用 get_weather 工具
result = agent.run_sync(
    'Weather in Paris?',
    model=TestModel(
        call_tools=['get_weather'],
        custom_output_text='The weather is sunny.'
    )
)
assert result.output == 'The weather is sunny.'
```

### 验证工具参数

通过 `FunctionModel` 可以在测试函数中捕获工具调用的参数。
检查消息历史中的 `ToolCallPart` 可以验证 Agent 传递了正确的工具参数。

## 18.6 测试流式输出

### StreamFunctionModelFunc

`FunctionModel` 支持通过 `stream_function` 参数模拟流式输出。
流式测试函数返回的是一个异步迭代器，逐步产出响应片段。

```python
# 文件: pydantic_ai/models/test.py
StreamFunctionModelFunc = Callable[
    [list[ModelMessage], ModelSettings | None],
    AsyncIterator[StreamedResponse] | Awaitable[AsyncIterator[StreamedResponse]],
]
```

### 流式测试示例

```python
# 文件: examples/test_stream.py
from pydantic_ai import Agent
from pydantic_ai.models.test import TestModel

agent = Agent('openai:gpt-4o')

async def test_streaming():
    async with agent.run_stream(
        'Tell me a story',
        model=TestModel(custom_output_text='Once upon a time...')
    ) as result:
        chunks = []
        async for chunk in result.stream_text():
            chunks.append(chunk)
        assert len(chunks) > 0
```

## 18.7 集成测试最佳实践

### 分层测试策略

| 测试层级 | 模型选择 | 目标 |
|----------|----------|------|
| 单元测试 | `TestModel` | 验证工具逻辑和输出格式 |
| 集成测试 | `FunctionModel` | 验证多轮对话和重试流程 |
| 端到端测试 | 真实模型 | 验证完整的用户场景 |

### 推荐实践

将 `TestModel` 用于快速、确定性的单元测试。
`FunctionModel` 适合需要动态响应的集成测试场景。
端到端测试应少量编写，覆盖核心用户路径即可。

使用 `pytest` 的 fixture 机制统一管理测试模型的配置。
将模型替换逻辑集中在 conftest.py 中，避免在每个测试文件中重复。

```python
# 文件: tests/conftest.py
import pytest
from pydantic_ai.models.test import TestModel

@pytest.fixture
def test_model():
    return TestModel(custom_output_text='default response')

@pytest.fixture
def agent_with_test_model(test_model):
    from pydantic_ai import Agent
    return Agent('openai:gpt-4o'), test_model
```

## 本章小结

本章介绍了 Pydantic AI 的测试体系。
`TestModel` 提供完全确定性的响应，适合单元测试中验证工具逻辑和输出格式。
`FunctionModel` 将响应生成委托给用户函数，支持更灵活的集成测试场景。
通过 `Agent.run` 方法的 `model` 参数可以无侵入地替换模型，不需要任何 mock 框架。
分层测试策略建议将单元测试、集成测试和端到端测试分开，合理控制对真实 API 的依赖。
