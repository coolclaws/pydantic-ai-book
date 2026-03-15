## 第 13 章 消息类型体系

> Pydantic AI 通过一套精心设计的消息类型体系，将用户输入、模型输出、工具调用和工具返回统一建模。消息类型基于 Python dataclass 构建，每个类型携带 `kind` 或 `part_kind` 字面量标签，实现了类型安全的序列化与反序列化。本章将深入剖析 `ModelMessage`、`ModelRequest`、`ModelResponse` 及各类 Part 的设计与实现。

### 13.1 消息类型的设计哲学

Pydantic AI 的消息系统采用了"容器 + 部件"的两层架构。
外层是 `ModelRequest` 和 `ModelResponse` 两种消息容器，分别代表用户侧和模型侧的消息。
内层是各种 Part 类型，如 `SystemPromptPart`、`UserPromptPart`、`ToolCallPart` 等。
这种设计使得一条消息可以同时包含多种内容片段，例如一条模型响应可以同时包含文本和工具调用。

每个消息和部件都携带一个字面量类型的标签字段（`kind` 或 `part_kind`）。
这个标签是判别联合类型（Discriminated Union）的关键，使得 Pydantic 能够在反序列化时精准匹配到正确的类型。
这种模式在 TypeScript 社区被广泛使用，Pydantic AI 将其引入了 Python 的数据建模中。

### 13.2 ModelMessage 联合类型

`ModelMessage` 是整个消息体系的顶层类型，定义为 `ModelRequest` 和 `ModelResponse` 的联合。
对话历史本质上就是一个 `list[ModelMessage]` 列表，交替存储请求与响应。

```python
# 文件: pydantic_ai/messages.py
ModelMessage = Union[ModelRequest, ModelResponse]
```

这个联合类型的设计简洁而强大。
通过 `kind` 字段的字面量值，可以在运行时准确区分消息的方向。
类型检查器也能基于 `kind` 字段进行类型缩窄（Type Narrowing），提供完整的编辑器智能提示。

### 13.3 ModelRequest：用户侧消息

`ModelRequest` 表示从用户或系统发送给模型的消息。
它包含一个 `parts` 列表，可以容纳多种请求部件。

```python
# 文件: pydantic_ai/messages.py
@dataclass
class ModelRequest:
    parts: list[ModelRequestPart]
    kind: Literal['request'] = 'request'
```

`ModelRequestPart` 的联合类型定义了四种请求部件：

```python
# 文件: pydantic_ai/messages.py
ModelRequestPart = Union[
    SystemPromptPart,
    UserPromptPart,
    ToolReturnPart,
    RetryPromptPart,
]
```

一个典型的首次请求会包含一个 `SystemPromptPart` 和一个 `UserPromptPart`。
当工具调用完成后，后续请求则会包含 `ToolReturnPart` 来传递工具的执行结果。
如果输出验证失败，框架会自动构造 `RetryPromptPart` 引导模型重试。

### 13.4 ModelResponse：模型侧消息

`ModelResponse` 表示模型返回的响应消息，除了 `parts` 列表外，还携带模型名称和时间戳。

```python
# 文件: pydantic_ai/messages.py
@dataclass
class ModelResponse:
    parts: list[ModelResponsePart]
    model_name: str | None = None
    timestamp: datetime = field(default_factory=datetime.now)
    kind: Literal['response'] = 'response'
```

`ModelResponsePart` 只有两种类型：

```python
# 文件: pydantic_ai/messages.py
ModelResponsePart = Union[
    TextPart,
    ToolCallPart,
]
```

`model_name` 字段记录了实际使用的模型标识，便于在多模型场景下追踪。
`timestamp` 默认取当前时间，在日志审计和对话回放场景中十分有用。
一条响应可能只包含纯文本，也可能同时包含文本和多个工具调用。

### 13.5 消息部件（Part）体系

消息部件是承载实际内容的最小单元。下表汇总了核心 Part 类型的关键属性：

| Part 类型 | 所属消息 | part_kind | 核心字段 |
|-----------|---------|-----------|---------|
| `SystemPromptPart` | Request | `system-prompt` | `content: str` |
| `UserPromptPart` | Request | `user-prompt` | `content: str \| Sequence[UserContent]` |
| `ToolReturnPart` | Request | `tool-return` | `tool_name`, `content`, `tool_call_id` |
| `TextPart` | Response | `text` | `content: str` |
| `ToolCallPart` | Response | `tool-call` | `tool_name`, `args`, `tool_call_id` |

**SystemPromptPart** 是最简单的部件，只包含一个字符串内容：

```python
# 文件: pydantic_ai/messages.py
@dataclass
class SystemPromptPart:
    content: str
    part_kind: Literal['system-prompt'] = 'system-prompt'
```

**UserPromptPart** 支持纯文本和多模态内容。
`content` 字段的类型为 `str | Sequence[UserContent]`，其中 `UserContent` 可以是文本、图片或音频。
`timestamp` 字段记录用户发送消息的时间。

```python
# 文件: pydantic_ai/messages.py
@dataclass
class UserPromptPart:
    content: str | Sequence[UserContent]
    timestamp: datetime = field(default_factory=datetime.now)
    part_kind: Literal['user-prompt'] = 'user-prompt'
```

**ToolCallPart** 表示模型发起的工具调用。
`args` 字段支持字典和字符串两种格式，兼容不同模型 API 返回的参数形式。
`tool_call_id` 用于将工具调用与其返回结果进行配对。

```python
# 文件: pydantic_ai/messages.py
@dataclass
class ToolCallPart:
    tool_name: str
    args: dict[str, Any] | str
    tool_call_id: str | None = None
    part_kind: Literal['tool-call'] = 'tool-call'
```

**ToolReturnPart** 承载工具执行的返回结果，通过 `tool_call_id` 与对应的 `ToolCallPart` 关联。

```python
# 文件: pydantic_ai/messages.py
@dataclass
class ToolReturnPart:
    tool_name: str
    content: str | dict[str, Any]
    tool_call_id: str | None = None
    part_kind: Literal['tool-return'] = 'tool-return'
```

### 13.6 消息的序列化与反序列化

Pydantic AI 的消息类型基于 dataclass 构建，但借助 Pydantic 的 `TypeAdapter` 可以轻松实现 JSON 序列化。
每个类型上的 `kind` 和 `part_kind` 字段充当判别器，确保反序列化时能准确还原类型。

```python
# 序列化示例
from pydantic import TypeAdapter
from pydantic_ai.messages import ModelMessage

adapter = TypeAdapter(list[ModelMessage])

# 将消息列表序列化为 JSON
messages_json = adapter.dump_json(result.all_messages())

# 从 JSON 反序列化为消息对象
messages = adapter.validate_json(messages_json)
```

这种序列化机制使得对话历史可以方便地存储到数据库、文件或 Redis 中。
反序列化后的对象与原始对象完全等价，可以直接传入 `message_history` 参数继续对话。

### 本章小结

Pydantic AI 的消息类型体系采用了"容器 + 部件"的两层架构设计。
`ModelMessage` 联合类型统一了 `ModelRequest` 和 `ModelResponse` 两种消息方向。
每种消息内部通过 Part 列表承载不同类型的内容片段，包括系统提示、用户输入、工具调用和工具返回。
所有类型均携带字面量标签字段，支持判别联合的类型安全序列化与反序列化。
这套类型体系是 Pydantic AI 实现多轮对话、工具调用和历史管理的基础数据结构。
