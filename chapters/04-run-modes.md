## 第 4 章 运行模式

> Pydantic AI 提供了三种运行模式：异步的 `run()`、同步的 `run_sync()` 和流式的 `run_stream()`。本章将深入分析这三种模式的源码实现，理解 `RunContext` 的设计，以及内部执行图 `_agent_graph` 如何驱动整个运行流程。

### 4.1 三种运行模式概览

Pydantic AI 的 Agent 类提供了三种运行模式，分别对应不同的使用场景。开发者可以根据应用的异步需求和响应方式选择合适的模式。

| 方法 | 返回类型 | 异步 | 流式 | 适用场景 |
|------|---------|------|------|---------|
| `run()` | `RunResult` | 是 | 否 | 异步应用 |
| `run_sync()` | `RunResult` | 否 | 否 | 脚本和同步代码 |
| `run_stream()` | `StreamedRunResult` | 是 | 是 | 实时输出场景 |

三种模式共享相同的核心执行逻辑，区别在于调用方式和结果的交付形式。`run()` 是基础实现，其余两种模式都基于它进行封装或变体处理。

### 4.2 run()：异步运行的核心实现

`run()` 方法是 Agent 最核心的运行入口。它接收用户提示词和一系列可选参数，返回一个包含完整结果的 `RunResult` 对象。

```python
# 文件: pydantic_ai/agent.py
async def run(
    self,
    user_prompt: str,
    *,
    message_history: list[ModelMessage] | None = None,
    model: Model | KnownModelName | None = None,
    deps: AgentDepsT = None,
    model_settings: ModelSettings | None = None,
    usage_limits: UsageLimits | None = None,
    output_type: type[RunOutputDataT] | ToolOutput[RunOutputDataT] | None = None,
) -> RunResult[AgentDepsT, RunOutputDataT]:
```

该方法的执行流程可以分为以下几个阶段。首先，它解析并确定要使用的模型实例，优先使用传入的 `model` 参数，其次使用 Agent 初始化时指定的模型。

接着，方法会构建 `RunContext` 上下文对象，将依赖、模型、用量统计等信息封装在一起。这个上下文会在整个执行过程中传递给系统提示词函数和工具函数。

最后，`run()` 将执行委托给内部的 `_agent_graph` 执行图，由图驱动模型调用、工具执行和结果验证的完整流程。

### 4.3 run_sync()：同步包装器的实现

`run_sync()` 是对 `run()` 的同步封装，其实现非常简洁。它使用 `asyncio.run()` 在一个新的事件循环中执行异步的 `run()` 方法。

```python
# 文件: pydantic_ai/agent.py
def run_sync(
    self,
    user_prompt: str,
    **kwargs,
) -> RunResult[AgentDepsT, RunOutputDataT]:
    """Synchronous wrapper around `run`."""
    return asyncio.run(self.run(user_prompt, **kwargs))
```

这种设计意味着 `run_sync()` 不能在已有事件循环运行的环境中调用，例如在 Jupyter Notebook 或已经处于 `async` 函数内部时会抛出 `RuntimeError`。

对于这种情况，推荐直接使用 `await agent.run()` 而不是 `run_sync()`。在 Web 框架如 FastAPI 中，由于框架本身管理事件循环，也应使用异步的 `run()` 方法。

### 4.4 run_stream()：流式运行模式

`run_stream()` 返回一个异步上下文管理器，提供 `StreamedRunResult` 对象。流式模式允许在模型生成响应时逐步接收输出，适合需要实时展示结果的场景。

```python
# 文件: pydantic_ai/agent.py
@asynccontextmanager
async def run_stream(
    self,
    user_prompt: str,
    *,
    message_history: list[ModelMessage] | None = None,
    model: Model | KnownModelName | None = None,
    deps: AgentDepsT = None,
    model_settings: ModelSettings | None = None,
    usage_limits: UsageLimits | None = None,
    output_type: type[RunOutputDataT] | ToolOutput[RunOutputDataT] | None = None,
) -> AsyncIterator[StreamedRunResult[AgentDepsT, RunOutputDataT]]:
```

流式模式的典型使用方式如下：

```python
# 使用示例
async with agent.run_stream('请介绍 Python') as result:
    async for text in result.stream_text():
        print(text, end='', flush=True)
```

与普通 `run()` 不同，流式模式需要通过 `async with` 语句管理生命周期，确保底层的网络连接和资源能被正确释放。

### 4.5 RunContext：运行上下文对象

`RunContext` 是贯穿整个 Agent 执行过程的上下文对象。它携带了运行时所需的全部信息，包括依赖注入的数据、当前使用的模型、消息历史等。

```python
# 文件: pydantic_ai/_internal/_agent_graph.py
@dataclass
class RunContext(Generic[AgentDepsT]):
    deps: AgentDepsT
    model: Model
    usage: Usage
    prompt: str
    messages: list[ModelMessage]
    run_step: int
    retry: int
```

`RunContext` 的泛型参数 `AgentDepsT` 与 Agent 定义时的依赖类型保持一致。这保证了在系统提示词函数和工具函数中访问 `ctx.deps` 时，能获得正确的类型提示。

`run_step` 字段记录当前执行到第几步，`retry` 字段记录当前重试的次数。这些信息对于调试和监控 Agent 的执行过程非常有用。

### 4.6 内部执行图：_agent_graph 的角色

Pydantic AI 的内部实现采用了图执行模型。`_agent_graph` 模块定义了 Agent 执行的状态机，将模型调用、工具执行、结果验证等步骤组织为图中的节点。

```python
# 文件: pydantic_ai/_internal/_agent_graph.py
# 执行图的核心节点包括：
# - ModelRequestNode: 发送请求到模型
# - HandleResponseNode: 处理模型返回
# - ToolNode: 执行工具调用
# - EndNode: 完成执行并返回结果
```

这种图结构的设计带来了几个优势。首先，执行流程的每个阶段都被清晰地定义为独立节点，便于测试和调试。其次，重试逻辑可以通过图的边来自然表达，无需复杂的条件分支。

图执行模型还为未来的扩展提供了灵活性，例如添加新的节点类型或修改执行流程的拓扑结构。

### 4.7 重试机制与 max_retries

Pydantic AI 内置了重试机制，当模型返回无法通过验证的结果或工具调用失败时，Agent 会自动重试。重试次数由 `max_retries` 参数控制。

```python
# 文件: pydantic_ai/agent.py
agent = Agent(
    'openai:gpt-4o',
    output_type=MyOutput,
    retries=3,  # 最大重试次数
)
```

重试时，Agent 会将验证错误信息作为新的消息发送给模型，引导模型修正其输出。这种设计利用了 LLM 的上下文理解能力，使得重试通常能在少数几次内成功。

每次重试都会消耗额外的 token，因此 `usage_limits` 参数可以作为安全阀，防止因反复重试导致的成本失控。当达到 `UsageLimits` 设定的上限时，Agent 会抛出 `UsageLimitExceeded` 异常。

### 本章小结

本章详细分析了 Pydantic AI 的三种运行模式。`run()` 是异步核心，`run_sync()` 通过 `asyncio.run()` 提供同步接口，`run_stream()` 支持流式输出。`RunContext` 作为贯穿执行过程的上下文对象，承载了依赖、模型、消息等关键信息。内部的 `_agent_graph` 图执行模型将复杂的执行流程分解为清晰的节点和边，配合重试机制实现了健壮的 Agent 运行框架。
