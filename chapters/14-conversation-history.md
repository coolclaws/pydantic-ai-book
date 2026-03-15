## 第 14 章 对话历史管理

> 多轮对话是 AI Agent 的核心能力之一。Pydantic AI 通过 `message_history` 参数和 `RunResult` 上的消息访问方法，提供了简洁而灵活的对话历史管理机制。本章将深入分析多轮对话的上下文传递方式、消息获取接口的设计，以及对话历史的序列化与持久化最佳实践。

### 14.1 message_history 参数

Agent 的 `run()`、`run_sync()` 和 `run_stream()` 方法都接受一个可选的 `message_history` 参数。
该参数类型为 `list[ModelMessage] | None`，用于向当前运行注入之前的对话上下文。

```python
# 文件: pydantic_ai/agent.py
async def run(
    self,
    user_prompt: str,
    *,
    message_history: list[ModelMessage] | None = None,
    model: Model | KnownModelName | None = None,
    deps: AgentDepsT = None,
    ...
) -> RunResult[AgentDepsT, RunOutputDataT]:
```

当 `message_history` 为 `None` 时，Agent 会启动一个全新的对话。
当传入历史消息时，这些消息会被放置在新请求之前，模型将基于完整的上下文进行推理。
框架不会修改传入的历史消息列表，而是在内部创建新的列表来追加新消息。

### 14.2 多轮对话的上下文传递

实现多轮对话的核心模式是：将上一轮的 `all_messages()` 传递给下一轮的 `message_history`。

```python
from pydantic_ai import Agent

agent = Agent('openai:gpt-4o')

# 第一轮对话
result1 = agent.run_sync('My name is Alice')

# 第二轮对话，传入历史
result2 = agent.run_sync(
    'What is my name?',
    message_history=result1.all_messages()
)
print(result2.output)
# Your name is Alice
```

上述代码的执行流程如下。
第一轮调用生成一个包含请求和响应的消息列表。
第二轮调用时，`result1.all_messages()` 返回第一轮的完整消息，框架将其与新的用户提示合并后发送给模型。
模型因此能够"记住"用户之前提供的信息。

这种显式传递的设计避免了隐式状态带来的问题。
开发者完全掌控对话上下文的生命周期，可以自由决定保留哪些历史、截断哪些内容。

### 14.3 RunResult 中的消息获取

`RunResult` 提供了两个关键方法来获取对话消息。

```python
# 文件: pydantic_ai/result.py
@dataclass
class RunResult(Generic[AgentDepsT, OutputDataT]):
    def all_messages(self) -> list[ModelMessage]:
        """返回完整的消息列表，包含历史消息和本次新增消息。"""
        ...

    def new_messages(self) -> list[ModelMessage]:
        """仅返回本次运行新增的消息。"""
        ...
```

这两个方法的区别在于包含范围：

| 方法 | 包含历史消息 | 包含新增消息 | 典型用途 |
|------|------------|------------|---------|
| `all_messages()` | 是 | 是 | 传递给下一轮对话 |
| `new_messages()` | 否 | 是 | 持久化增量消息 |

`all_messages()` 返回的列表是传入的 `message_history` 与本次新产生的消息的拼接。
它是传递给下一轮 `message_history` 参数的标准选择。

### 14.4 all_messages vs new_messages

理解这两个方法的差异对于高效管理对话历史至关重要。

```python
agent = Agent('openai:gpt-4o')

result1 = agent.run_sync('Hello')
print(len(result1.all_messages()))   # 2 (1 request + 1 response)
print(len(result1.new_messages()))   # 2 (相同，因为没有历史)

result2 = agent.run_sync(
    'How are you?',
    message_history=result1.all_messages()
)
print(len(result2.all_messages()))   # 4 (2 历史 + 2 新增)
print(len(result2.new_messages()))   # 2 (仅本轮新增)
```

在第一轮对话中，两者返回相同的结果，因为没有传入历史消息。
从第二轮开始，`all_messages()` 包含累积的全部消息，而 `new_messages()` 只包含当次新增的部分。
当对话历史较长时，使用 `new_messages()` 进行增量存储可以显著减少写入量。

### 14.5 消息历史的序列化与持久化

Pydantic AI 的消息类型天然支持序列化，可以通过 `TypeAdapter` 实现 JSON 的读写。

```python
from pydantic import TypeAdapter
from pydantic_ai.messages import ModelMessage

adapter = TypeAdapter(list[ModelMessage])

# 序列化为 JSON 字符串
json_data = adapter.dump_json(result.all_messages())

# 存储到文件
with open('chat_history.json', 'wb') as f:
    f.write(json_data)

# 从文件恢复
with open('chat_history.json', 'rb') as f:
    messages = adapter.validate_json(f.read())

# 继续对话
result = agent.run_sync('Continue...', message_history=messages)
```

这种方式同样适用于数据库存储。
可以将 JSON 字符串存入 PostgreSQL 的 JSONB 字段或 Redis 缓存中。
反序列化后的消息对象保留了完整的类型信息，可以直接用于后续对话。

对于生产环境，建议对消息历史设置合理的长度上限。
过长的历史会增加 Token 消耗和请求延迟，通常保留最近 10-20 轮对话即可。

### 14.6 对话历史的最佳实践

以下是管理对话历史的推荐模式：

**分离存储与传递**：使用 `new_messages()` 增量存储，用 `all_messages()` 传递上下文。
这样既避免了重复存储，又保证了上下文的完整性。

**上下文窗口管理**：当历史消息过多时，可以截取最近的 N 条消息传入。
注意保留首条包含 `SystemPromptPart` 的请求，以确保系统提示不会丢失。

```python
def trim_history(
    messages: list[ModelMessage],
    max_turns: int = 10
) -> list[ModelMessage]:
    """保留系统提示和最近 N 轮对话。"""
    if len(messages) <= max_turns * 2:
        return messages
    # 保留第一条（含系统提示）和最近的消息
    return messages[:1] + messages[-(max_turns * 2 - 1):]
```

**会话隔离**：为每个用户或会话维护独立的消息列表。
不要在不同会话之间共享消息历史，避免上下文混淆。

**异常处理**：反序列化时应处理版本不兼容的情况。
当框架升级导致消息格式变化时，旧的序列化数据可能无法直接还原。

### 本章小结

Pydantic AI 通过显式的 `message_history` 参数实现多轮对话的上下文传递，避免了隐式状态管理的复杂性。
`RunResult` 提供了 `all_messages()` 和 `new_messages()` 两个方法，分别用于上下文传递和增量持久化。
消息类型基于 Pydantic 的 `TypeAdapter` 支持 JSON 序列化，可以方便地存储到文件或数据库。
生产环境中应注意上下文窗口管理、会话隔离和版本兼容性，以构建稳定可靠的多轮对话系统。
