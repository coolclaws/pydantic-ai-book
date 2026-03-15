# 附录 C：名词解释（Glossary）

## A

**Agent**
Pydantic AI 的核心类，封装了模型调用、工具执行、结果验证的完整 Agent 流程。通过泛型参数 `Agent[AgentDepsT, OutputDataT]` 实现类型安全。详见第 3 章。

**AgentDepsT**
Agent 的依赖类型参数，表示通过 `RunContext` 注入的依赖对象的类型。可以是任意 Python 类型，如 `str`、`dataclass` 或自定义类。详见第 6 章。

**AgentModel**
运行时模型接口，由 `Model.agent_model()` 方法创建。它已绑定工具定义和模型配置，负责实际的请求发送和响应处理。定义于 `pydantic_ai/models/__init__.py`。详见第 7 章。

## E

**EndStrategy**
Agent 运行的结束策略，控制当模型同时返回文本和工具调用时的行为。取值为 `'early'`（立即结束）或 `'exhaustive'`（执行完所有工具调用后结束）。详见第 4 章。

## F

**FunctionModel**
测试专用模型，将响应生成逻辑委托给用户提供的函数。适用于需要根据输入动态生成响应的测试场景。定义于 `pydantic_ai/models/test.py`。详见第 18 章。

## I

**InstrumentationSettings**
控制 Logfire 追踪行为的配置类。通过 `Agent` 构造函数的 `instrument` 参数传入，激活 OpenTelemetry span 追踪。详见第 17 章。

## K

**KnownModelName**
预定义的模型名称字面量类型，如 `'openai:gpt-4o'`、`'anthropic:claude-3-5-sonnet'`、`'gemini-1.5-pro'` 等。框架根据该名称自动选择对应的模型适配器。详见第 7 章。

## M

**MCP**
Model Context Protocol 的缩写，由 Anthropic 提出的开放标准协议，用于标准化 AI 应用与外部工具服务之间的通信。Pydantic AI 原生支持 MCP 客户端集成。详见第 13 章。

**MCPServerHTTP**
基于 HTTP SSE 传输的 MCP 服务器连接配置。适用于远程部署的 MCP 服务，通过 HTTP 协议通信。定义于 `pydantic_ai/mcp.py`。详见第 13 章。

**MCPServerStdio**
基于标准输入输出传输的 MCP 服务器连接配置。通过子进程方式启动本地 MCP 服务器，使用 stdin/stdout 通信。定义于 `pydantic_ai/mcp.py`。详见第 13 章。

**Model**
所有模型适配器的抽象基类，定义了 `agent_model()` 方法作为核心协议。具体模型（如 OpenAI、Anthropic）通过继承该类实现适配。定义于 `pydantic_ai/models/__init__.py`。详见第 7 章。

**ModelMessage**
消息体系的顶层联合类型，定义为 `ModelRequest | ModelResponse`。Agent 的对话历史由 `ModelMessage` 列表组成。定义于 `pydantic_ai/messages.py`。详见第 9 章。

**ModelRequest**
发送给模型的请求消息，包含 `SystemPromptPart`、`UserPromptPart`、`ToolReturnPart` 和 `RetryPromptPart` 四种 Part 类型。定义于 `pydantic_ai/messages.py`。详见第 9 章。

**ModelResponse**
模型返回的响应消息，包含 `TextPart` 和 `ToolCallPart` 两种 Part 类型。定义于 `pydantic_ai/messages.py`。详见第 9 章。

**ModelRetry**
工具函数抛出的异常类型，用于请求模型重新生成工具调用参数。Agent 会将错误信息作为 `RetryPromptPart` 发送给模型。定义于 `pydantic_ai/exceptions.py`。详见第 14 章。

**ModelSettings**
传递给模型的参数集合，使用 `TypedDict` 定义。包含 `max_tokens`、`temperature`、`top_p` 等通用参数。定义于 `pydantic_ai/settings.py`。详见第 7 章和附录 B。

## O

**OutputDataT**
Agent 的输出类型参数，表示 `RunResult.output` 的类型。默认为 `str`，可以设置为 Pydantic `BaseModel` 子类以实现结构化输出。详见第 3 章和第 12 章。

## R

**RunContext**
工具函数和动态提示函数接收的运行时上下文对象。通过泛型参数 `RunContext[AgentDepsT]` 携带类型安全的依赖引用，同时提供 `usage`、`messages` 等运行时信息。定义于 `pydantic_ai/tools.py`。详见第 6 章。

**RunResult**
Agent 单次运行的结果封装，携带类型安全的输出数据 `output`，以及消息历史、token 消耗等元信息。定义于 `pydantic_ai/result.py`。详见第 12 章。

## S

**StreamedRunResult**
Agent 流式运行的结果封装，作为异步上下文管理器使用。提供 `stream_text()` 和 `stream_structured()` 方法逐块获取输出。定义于 `pydantic_ai/result.py`。详见第 10 章和第 12 章。

**SystemPromptPart**
系统提示消息部分，包含 Agent 的系统级指令文本。可以是静态字符串，也可以通过 `@agent.system_prompt` 装饰器动态生成。定义于 `pydantic_ai/messages.py`。详见第 9 章。

## T

**TestModel**
测试专用模型，返回预定义的确定性响应。支持通过 `custom_output_text` 和 `custom_output_args` 控制输出内容，通过 `call_tools` 模拟工具调用。定义于 `pydantic_ai/models/test.py`。详见第 18 章。

**TextPart**
模型响应中的文本内容部分，包含模型生成的纯文本回复。定义于 `pydantic_ai/messages.py`。详见第 9 章。

**Tool**
工具的封装类，包含执行函数、名称、描述、参数 schema 等信息。通过 `@agent.tool` 装饰器或直接构造创建。定义于 `pydantic_ai/tools.py`。详见第 5 章。

**ToolCallPart**
模型响应中的工具调用部分，包含工具名称、调用参数和调用 ID。Agent 收到此 Part 后会执行对应工具并将结果作为 `ToolReturnPart` 发回。定义于 `pydantic_ai/messages.py`。详见第 9 章和第 11 章。

**ToolDefinition**
工具的 schema 定义，包含名称、描述和 JSON Schema 格式的参数定义。传递给模型适配器，由模型决定是否调用。定义于 `pydantic_ai/tools.py`。详见第 5 章。

**ToolOutput**
用于指定输出类型的包装类，可以附加自定义的工具名称和描述。当 `output_type` 需要额外配置时使用。详见第 12 章。

**ToolReturnPart**
工具执行结果的消息部分，包含工具名称、返回值和对应的调用 ID。作为 `ModelRequest` 的一部分发送给模型。定义于 `pydantic_ai/messages.py`。详见第 9 章和第 11 章。

## U

**Usage**
记录 token 消耗数据的数据类，包含 `request_tokens`、`response_tokens`、`total_tokens` 和 `requests` 四个字段。每次模型请求后累加。定义于 `pydantic_ai/settings.py`。详见第 7 章和附录 B。

**UsageLimits**
资源消耗限制配置，可设置 token 数量和请求次数的上限。当实际消耗超出限制时，Agent 会抛出 `UsageLimitExceeded` 异常。定义于 `pydantic_ai/settings.py`。详见第 4 章和附录 B。

**UserPromptPart**
用户输入的消息部分，包含用户提供的文本提示。是 `ModelRequest` 中最常见的 Part 类型。定义于 `pydantic_ai/messages.py`。详见第 9 章。
