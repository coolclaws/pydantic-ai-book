# 第 7 章 Model 接口设计

> 本章深入分析 Pydantic AI 的 Model 协议设计，涵盖 `Model` 与 `AgentModel` 两层抽象、单次请求与流式请求两种调用模式，以及 `ModelResponse`、`ModelRequestPart` 等核心数据结构的设计思路。理解这些接口是掌握多模型适配机制的基础。

## 7.1 Model 协议定义

### 顶层抽象：Model 基类

`Model` 是 Pydantic AI 对大语言模型的顶层抽象。它采用抽象基类（ABC）的方式定义协议，所有具体模型适配器都必须继承并实现该协议。其核心职责只有一个：根据工具定义和模型配置，创建一个可运行的 `AgentModel` 实例。

```python
# 文件: pydantic_ai/models/__init__.py
class Model(ABC):
    """所有模型适配器的基类，定义了模型的顶层协议。"""

    @abstractmethod
    async def agent_model(
        self,
        *,
        function_tools: list[ToolDefinition],
        allow_text_output: bool,
        output_tools: list[ToolDefinition],
        model_settings: ModelSettings | None,
    ) -> AgentModel: ...
```

### 参数设计的考量

`agent_model` 方法的参数经过精心设计，每个参数都承载明确的语义。`function_tools` 表示 Agent 注册的工具列表，`allow_text_output` 控制模型是否允许纯文本输出，`output_tools` 则是用于结构化输出的特殊工具。这种分离使得框架能够灵活控制模型的输出行为。

| 参数 | 类型 | 说明 |
|------|------|------|
| `function_tools` | `list[ToolDefinition]` | Agent 注册的常规工具 |
| `allow_text_output` | `bool` | 是否允许纯文本输出 |
| `output_tools` | `list[ToolDefinition]` | 结构化输出专用工具 |
| `model_settings` | `ModelSettings \| None` | 模型级参数设置 |

## 7.2 AgentModel：运行时模型接口

### 请求执行层

`AgentModel` 是真正负责发送请求的运行时接口。与 `Model` 不同，`AgentModel` 已经绑定了具体的工具定义和模型配置，可以直接接收消息列表并返回响应。这种两层设计将「配置阶段」与「执行阶段」清晰分离。

```python
# 文件: pydantic_ai/models/__init__.py
class AgentModel(ABC):
    """运行时模型接口，负责实际的请求发送和响应处理。"""

    @abstractmethod
    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
    ) -> tuple[ModelResponse, Usage]: ...

    @abstractmethod
    async def request_stream(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
    ) -> AsyncIterator[StreamedResponse]: ...
```

### 两层架构的优势

这种 `Model` -> `AgentModel` 的两层架构带来了显著的设计优势。`Model` 层负责客户端初始化和配置校验，是一个可复用的重量级对象。`AgentModel` 层则是轻量级的请求执行器，每次 Agent 运行时都会创建新的实例，携带本次运行所需的工具和设置。

## 7.3 request 方法：单次请求模式

### 同步等待完整响应

`request` 方法实现的是最基础的请求-响应模式。调用者发送完整的消息列表，等待模型返回完整的响应。返回值是一个元组，包含 `ModelResponse` 和 `Usage` 两部分。`Usage` 记录了本次请求的 token 消耗情况。

```python
# 文件: pydantic_ai/models/__init__.py
# request 方法返回值类型
# tuple[ModelResponse, Usage]
# ModelResponse 包含模型的完整回复
# Usage 包含 request_tokens, response_tokens, total_tokens
```

### 适用场景

单次请求模式适合对延迟不敏感的场景，例如后台批处理任务、工具调用决策等。由于框架需要等待完整响应才能解析工具调用，因此在 Agent 的工具循环中，单次请求模式是默认选择。

## 7.4 request_stream 方法：流式请求模式

### 增量接收响应

`request_stream` 方法返回一个 `AsyncIterator[StreamedResponse]`，允许调用者逐步接收模型的输出。这对于面向用户的交互式场景至关重要，用户可以实时看到模型的思考过程，而不必等待整个响应生成完毕。

```python
# 文件: pydantic_ai/models/__init__.py
class StreamedResponse(ABC):
    """流式响应的抽象基类，支持增量获取文本和工具调用。"""

    @abstractmethod
    async def __anext__(self) -> None:
        """推进流式响应，获取下一个增量片段。"""
        ...

    def get(self, *, final: bool = False) -> ModelResponse:
        """获取当前累积的响应内容。"""
        ...

    def usage(self) -> Usage:
        """获取当前的 token 使用量。"""
        ...
```

### 流式与非流式的统一

`StreamedResponse` 的 `get` 方法可以在任意时刻获取当前累积的 `ModelResponse`，这意味着流式响应最终可以被转换为与非流式响应完全相同的数据结构。这种设计保证了上层逻辑不需要区分两种模式。

## 7.5 ModelResponse 与 ModelRequestPart 的设计

### 消息数据模型

Pydantic AI 定义了一套完整的消息数据模型来表示模型交互过程中的各种数据。`ModelResponse` 表示模型的输出，`ModelRequest` 表示发送给模型的请求。

```python
# 文件: pydantic_ai/messages.py
@dataclass
class ModelResponse:
    parts: list[ModelResponsePart]
    model_name: str | None = None
    timestamp: datetime = field(default_factory=_now_utc)

ModelResponsePart = Union[TextPart, ToolCallPart]

@dataclass
class ModelRequest:
    parts: list[ModelRequestPart]

ModelRequestPart = Union[
    SystemPromptPart,
    UserPromptPart,
    ToolReturnPart,
    RetryPromptPart,
]
```

### Part 类型对照

| Part 类型 | 方向 | 说明 |
|-----------|------|------|
| `TextPart` | 响应 | 模型输出的纯文本 |
| `ToolCallPart` | 响应 | 模型发起的工具调用 |
| `UserPromptPart` | 请求 | 用户输入的提示 |
| `SystemPromptPart` | 请求 | 系统级提示 |
| `ToolReturnPart` | 请求 | 工具调用的返回值 |

## 7.6 KnownModelName：模型名称字符串到实例的映射

### 字符串快捷方式

为了简化使用体验，Pydantic AI 定义了 `KnownModelName` 类型，它是一个 `Literal` 联合类型，列举了所有受支持的模型名称字符串。用户可以直接传入字符串而无需手动创建 `Model` 实例。

```python
# 文件: pydantic_ai/models/__init__.py
KnownModelName = Literal[
    'openai:gpt-4o',
    'openai:gpt-4o-mini',
    'anthropic:claude-3-5-sonnet-latest',
    'gemini-1.5-pro',
    'groq:llama-3.1-70b-versatile',
    ...
]
```

### 名称解析机制

框架内部通过 `infer_model` 函数将字符串解析为对应的 `Model` 实例。解析规则基于前缀匹配：`openai:` 前缀映射到 `OpenAIModel`，`anthropic:` 前缀映射到 `AnthropicModel`，以此类推。这种设计使得 Agent 的构造函数可以同时接受字符串和 `Model` 实例。

```python
# 文件: pydantic_ai/models/__init__.py
def infer_model(model: Model | KnownModelName) -> Model:
    if isinstance(model, Model):
        return model
    elif model.startswith('openai:'):
        from .openai import OpenAIModel
        return OpenAIModel(model[len('openai:'):])
    elif model.startswith('anthropic:'):
        from .anthropic import AnthropicModel
        return AnthropicModel(model[len('anthropic:'):])
    ...
```

## 本章小结

本章详细分析了 Pydantic AI 的 Model 接口设计。核心要点如下：

- **两层抽象架构**：`Model` 负责配置和初始化，`AgentModel` 负责请求执行，职责分离清晰。
- **双模式请求**：`request` 提供同步完整响应，`request_stream` 提供流式增量响应，两者最终输出统一的 `ModelResponse` 结构。
- **消息数据模型**：通过 `ModelRequest` / `ModelResponse` 及其 Part 类型，建立了一套与具体模型无关的统一消息协议。
- **字符串快捷方式**：`KnownModelName` 和 `infer_model` 机制让用户可以用简短字符串指定模型，降低了使用门槛。

这套接口设计是下一章多模型适配器实现的基础。
