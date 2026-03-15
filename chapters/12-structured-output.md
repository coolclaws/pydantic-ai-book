# 第 12 章 结构化输出与验证

> 结构化输出是 Pydantic AI 的核心卖点之一。通过 `output_type` 参数，开发者可以让 Agent 返回经过 Pydantic 验证的强类型数据。本章将深入分析 `output_type` 的实现机制、工具模式与原生模式的差异、`output_validator` 装饰器的验证链路，以及 Union 类型输出和 `ToolOutput` 包装器的高级用法。

## 12.1 output_type：定义结构化输出

### 基本用法

`output_type` 是 `Agent` 构造函数的核心参数，它告诉框架期望的输出类型。
默认值为 `str`，即纯文本输出。
传入 Pydantic `BaseModel` 子类后，Agent 会自动将模型的输出解析为对应的实例。

```python
# 文件: examples/structured_output.py
from pydantic import BaseModel
from pydantic_ai import Agent

class CityInfo(BaseModel):
    name: str
    country: str
    population: int

agent = Agent('openai:gpt-4o', output_type=CityInfo)
result = agent.run_sync('Tell me about Paris')
print(result.output)
# CityInfo(name='Paris', country='France', population=2161000)
```

### OutputSpec 类型体系

`output_type` 接受的类型范围由 `OutputSpec` 定义。
它支持单一类型、类型列表（Union 语义）和 `ToolOutput` 包装器。
框架内部通过 `OutputSchema.build` 方法将 `OutputSpec` 转换为统一的输出 Schema。

## 12.2 结构化输出的实现机制（工具 vs 原生）

### 两种结构化输出模式

Pydantic AI 支持两种结构化输出模式：工具模式（tool）和原生模式（native）。
工具模式通过定义一个特殊的"输出工具"让模型以工具调用的方式返回结构化数据。
原生模式利用部分 LLM 提供商（如 OpenAI）内置的结构化输出能力直接返回 JSON。

```python
# 文件: pydantic_ai/output.py
OutputMode = Literal['text', 'tool', 'native', 'prompted',
                     'tool_or_text']
StructuredOutputMode = Literal['tool', 'native', 'prompted']
```

### 模式对比

| 模式 | 实现方式 | 适用场景 | 优势 |
|------|---------|---------|------|
| `tool` | 注册输出工具 | 通用，所有模型 | 兼容性最好 |
| `native` | 模型原生 JSON 模式 | OpenAI 等支持的模型 | 性能更优 |
| `prompted` | 在提示中嵌入 Schema | 不支持工具的模型 | 回退方案 |

### 工具模式的内部实现

在工具模式下，框架为每个 `output_type` 创建一个特殊的 `ToolDefinition`。
其默认名称为 `final_result`，描述为结束对话的最终响应。
模型调用此工具时，框架将参数解析为 `output_type` 实例并结束对话。

```python
# 文件: pydantic_ai/_output.py
DEFAULT_OUTPUT_TOOL_NAME = 'final_result'
DEFAULT_OUTPUT_TOOL_DESCRIPTION = (
    'The final response which ends this conversation'
)
```

## 12.3 Pydantic v2 模型作为 output_type

### BaseModel 的自然集成

Pydantic AI 直接复用 Pydantic v2 的 `BaseModel` 作为输出类型定义。
框架通过 `TypeAdapter` 获取模型的 JSON Schema 并注册为输出工具的参数 Schema。
模型返回的 JSON 经过 Pydantic 的完整验证流程，确保类型安全。

### 嵌套模型支持

输出类型可以包含嵌套的 Pydantic 模型、列表、可选字段等复杂结构。
JSON Schema 会递归生成，确保模型理解完整的数据结构。

```python
# 文件: examples/nested_output.py
from pydantic import BaseModel
from pydantic_ai import Agent

class Address(BaseModel):
    city: str
    country: str

class Person(BaseModel):
    name: str
    age: int
    address: Address

agent = Agent('openai:gpt-4o', output_type=Person)
result = agent.run_sync('Info about a person in Tokyo')
print(result.output.address.city)  # Tokyo
```

## 12.4 output_validator 装饰器

### 自定义验证逻辑

`@agent.output_validator` 装饰器允许开发者在 Pydantic 验证之后添加自定义业务验证。
验证函数可以选择性地接收 `RunContext` 作为第一个参数，支持同步和异步两种写法。
验证失败时抛出 `ModelRetry` 可触发模型重试。

```python
# 文件: pydantic_ai/agent/__init__.py
@overload
def output_validator(
    self,
    func: Callable[[RunContext[AgentDepsT], OutputDataT],
                    OutputDataT], /
) -> ...: ...

def output_validator(
    self,
    func: _output.OutputValidatorFunc[AgentDepsT, OutputDataT], /
):
    self._output_validators.append(
        _output.OutputValidator[AgentDepsT, Any](func)
    )
    return func
```

### 使用示例

```python
# 文件: examples/output_validator.py
from pydantic import BaseModel
from pydantic_ai import Agent, ModelRetry, RunContext

class Review(BaseModel):
    score: int
    comment: str

agent = Agent('openai:gpt-4o', output_type=Review,
              deps_type=str)

@agent.output_validator
def validate_review(ctx: RunContext[str], data: Review) -> Review:
    if data.score < 1 or data.score > 10:
        raise ModelRetry('Score must be between 1 and 10')
    return data
```

## 12.5 输出验证失败时的重试

### OutputValidator 的验证流程

`OutputValidator` 内部通过 `validate` 方法执行验证。
它根据函数签名自动判断是否注入 `RunContext`，并处理同步/异步差异。
验证失败时捕获 `ModelRetry`，将其转换为 `ToolRetryError` 进入重试流程。

```python
# 文件: pydantic_ai/_output.py
@dataclass
class OutputValidator(Generic[AgentDepsT, OutputDataT_inv]):
    function: OutputValidatorFunc[AgentDepsT, OutputDataT_inv]

    async def validate(self, result: T,
                       run_context: RunContext[AgentDepsT]) -> T:
        if self._takes_ctx:
            args = run_context, result
        else:
            args = (result,)
        try:
            if self._is_async:
                result_data = await function(*args)
            else:
                result_data = await run_in_executor(
                    function, *args
                )
        except ModelRetry as r:
            m = _messages.RetryPromptPart(
                content=r.message,
                tool_name=run_context.tool_name,
            )
            raise ToolRetryError(m) from r
        return result_data
```

### 重试次数控制

输出验证的重试次数由 `Agent` 构造函数的 `output_retries` 参数控制。
如果未指定则使用 `retries` 的值。
`GraphAgentState` 通过 `increment_retries` 方法跟踪重试计数，超出上限时终止运行。

## 12.6 ToolOutput 包装器

### 自定义输出工具名称

`ToolOutput` 允许开发者自定义输出工具的名称和描述。
当 `output_type` 包含多个候选类型时，不同的工具名称帮助模型区分选择。

```python
# 文件: pydantic_ai/output.py
@dataclass(init=False)
class ToolOutput(Generic[OutputDataT]):
    """Marker class to use a tool for output
    and optionally customize the tool."""
```

### 使用示例

```python
# 文件: examples/tool_output.py
from pydantic import BaseModel
from pydantic_ai import Agent, ToolOutput

class Fruit(BaseModel):
    name: str
    color: str

class Vehicle(BaseModel):
    name: str
    wheels: int

agent = Agent(
    'openai:gpt-4o',
    output_type=[
        ToolOutput(Fruit, name='return_fruit'),
        ToolOutput(Vehicle, name='return_vehicle'),
    ],
)
result = agent.run_sync('What is a banana?')
print(result.output)
# Fruit(name='banana', color='yellow')
```

## 12.7 Union 类型输出的处理

### 列表语法的 Union 语义

Pydantic AI 使用列表语法表示 Union 类型输出。
传入 `output_type=[TypeA, TypeB]` 时，框架为每个类型注册一个输出工具。
模型根据上下文选择调用哪个输出工具，返回对应类型的实例。

### 内部实现

框架为每个候选类型生成独立的 `ToolDefinition`。
工具名称默认基于类型名称生成，确保模型能区分不同选项。
`outer_typed_dict_key` 字段用于处理非 object 类型的输出（如纯字符串），将其包装为 TypedDict。

### 类型安全

返回值的类型为 `TypeA | TypeB`，开发者需要通过 `isinstance` 检查具体类型。
这一设计在保持灵活性的同时，让类型检查器能够正确推导。

```python
# 文件: examples/union_output.py
from pydantic import BaseModel
from pydantic_ai import Agent

class Success(BaseModel):
    message: str

class Error(BaseModel):
    code: int
    detail: str

agent = Agent('openai:gpt-4o', output_type=[Success, Error])
result = agent.run_sync('What is 2+2?')

if isinstance(result.output, Success):
    print(f"Success: {result.output.message}")
else:
    print(f"Error {result.output.code}: {result.output.detail}")
```

## 本章小结

本章全面解析了 Pydantic AI 结构化输出与验证的实现机制。
`output_type` 参数支持 Pydantic 模型、类型列表和 `ToolOutput` 包装器三种形式。
结构化输出通过工具模式和原生模式两种策略实现，工具模式兼容性最好，原生模式性能更优。
`@agent.output_validator` 装饰器提供了 Pydantic 验证之后的自定义业务校验能力。
验证失败时通过 `ModelRetry` 异常驱动模型自我修正，重试次数由 `output_retries` 控制。
Union 类型输出通过多输出工具的方式实现，让模型根据上下文灵活选择返回类型。
