## 第 6 章 依赖注入

> 依赖注入是 Pydantic AI 的核心设计模式之一。通过 `AgentDepsT` 泛型参数和 `RunContext` 上下文对象，框架实现了类型安全的依赖传递机制，使得系统提示词和工具函数能够优雅地访问外部资源。

### 6.1 依赖注入的设计动机

在构建 AI Agent 应用时，工具函数和系统提示词经常需要访问外部资源，例如数据库连接、API 客户端或用户会话信息。直接使用全局变量会带来测试困难和耦合问题。

Pydantic AI 采用依赖注入模式解决这一问题。开发者在 Agent 定义时声明依赖类型，在运行时传入具体的依赖实例。框架负责将依赖安全地传递到每个需要它的函数中。

这种设计带来了三个核心优势：可测试性（可以注入模拟依赖）、类型安全（IDE 提供完整提示）、解耦性（函数不依赖全局状态）。

### 6.2 AgentDepsT 泛型参数

`AgentDepsT` 是 Agent 类的第一个泛型参数，用于声明 Agent 所需的依赖类型。它可以是任意 Python 类型，从简单的字符串到复杂的数据类。

```python
# 文件: pydantic_ai/agent.py
class Agent(Generic[AgentDepsT, OutputDataT]):
    def __init__(
        self,
        model: Model | KnownModelName | None = None,
        *,
        deps_type: type[AgentDepsT] = NoneType,
        ...
    ): ...
```

当不需要依赖时，`AgentDepsT` 默认为 `NoneType`，此时 `run()` 方法的 `deps` 参数可以省略。声明了具体依赖类型后，`deps` 参数成为必需的。

```python
# 使用示例：声明依赖类型
from dataclasses import dataclass

@dataclass
class AppDeps:
    api_key: str
    base_url: str

# 通过 deps_type 声明依赖类型
agent = Agent('openai:gpt-4o', deps_type=AppDeps)
```

类型检查器会验证传入的 `deps` 参数是否匹配声明的类型，在编译时捕获类型错误。

### 6.3 RunContext[Deps] 的结构与传递

`RunContext` 是依赖注入的载体。它封装了当前运行的全部上下文信息，其中最重要的就是 `deps` 字段。

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

`RunContext` 的传递流程如下表所示：

| 阶段 | 操作 | RunContext 状态 |
|------|------|----------------|
| 初始化 | `run(deps=my_deps)` | 创建上下文 |
| 系统提示词 | 调用 `system_prompt` 函数 | 传入上下文 |
| 模型调用 | 发送请求到 LLM | 更新 usage |
| 工具执行 | 调用 `tool` 函数 | 传入上下文 |
| 重试 | 验证失败后重试 | 更新 retry |

框架在内部自动管理 `RunContext` 的创建和更新。开发者只需在函数签名中声明 `ctx: RunContext[MyDeps]` 参数，框架会自动注入对应的上下文实例。

### 6.4 动态 system_prompt 中的依赖使用

Pydantic AI 的系统提示词不仅支持静态字符串，还支持动态生成。通过 `@agent.system_prompt` 装饰器注册的函数可以接收 `RunContext` 参数，从而根据依赖数据动态构建提示词。

```python
# 使用示例：动态系统提示词
@dataclass
class MyDeps:
    db_conn: DatabaseConnection
    user_id: str

agent = Agent('openai:gpt-4o', deps_type=MyDeps)

@agent.system_prompt
async def get_system_prompt(ctx: RunContext[MyDeps]) -> str:
    user = await ctx.deps.db_conn.get_user(ctx.deps.user_id)
    return f'You are helping {user.name}.'
```

动态系统提示词在每次 `run()` 调用时重新执行，因此可以基于最新的依赖状态生成个性化的提示内容。函数可以是同步的也可以是异步的，框架会自动处理。

一个 Agent 可以注册多个 `system_prompt` 函数，它们的返回值会按注册顺序拼接成最终的系统提示词。这种设计支持将复杂提示词分解为多个职责单一的函数。

### 6.5 工具函数中的依赖注入

工具函数同样通过 `RunContext` 访问依赖。框架通过检查函数签名中是否存在 `RunContext` 类型的参数来决定是否注入上下文。

```python
# 使用示例：工具函数依赖注入
@agent.tool
async def get_orders(ctx: RunContext[MyDeps]) -> list[Order]:
    return await ctx.deps.db_conn.get_orders(ctx.deps.user_id)

@agent.tool
async def get_balance(ctx: RunContext[MyDeps]) -> float:
    account = await ctx.deps.db_conn.get_account(ctx.deps.user_id)
    return account.balance
```

工具函数的参数分为两类：`RunContext` 参数由框架注入，其余参数由模型根据工具描述自动填充。框架会在注册时分析函数签名，区分这两类参数。

```python
# 混合参数示例
@agent.tool
async def search_products(
    ctx: RunContext[MyDeps],
    query: str,
    max_results: int = 10,
) -> list[Product]:
    # ctx 由框架注入，query 和 max_results 由模型提供
    return await ctx.deps.db_conn.search(query, limit=max_results)
```

模型能看到 `query` 和 `max_results` 的参数描述，但不会感知 `RunContext` 参数的存在。这种透明的注入机制让工具函数的接口保持清晰。

### 6.6 依赖的类型安全保证

Pydantic AI 的依赖注入在类型层面提供了完整的安全保证。从 Agent 定义到工具函数签名，类型信息通过泛型参数一路传递。

```python
# 类型安全示例
agent = Agent('openai:gpt-4o', deps_type=MyDeps)

@agent.tool
async def bad_tool(ctx: RunContext[WrongDeps]) -> str:
    # 类型检查器会报错：WrongDeps 与 MyDeps 不匹配
    return ctx.deps.some_field
```

类型检查器（如 mypy 或 pyright）能够检测到 `RunContext` 的泛型参数与 Agent 的依赖类型不一致的情况，并在开发阶段给出警告。

这种设计避免了运行时才发现类型错误的问题，特别是在大型项目中，多个开发者协作维护同一个 Agent 时，类型安全能显著减少集成错误。

### 6.7 实际应用示例：数据库连接注入

下面是一个完整的数据库连接注入示例，展示了依赖注入在实际项目中的典型用法。

```python
# 完整应用示例
from dataclasses import dataclass
from pydantic_ai import Agent, RunContext

@dataclass
class MyDeps:
    db_conn: DatabaseConnection
    user_id: str

agent = Agent(
    'openai:gpt-4o',
    deps_type=MyDeps,
    output_type=str,
)

@agent.system_prompt
async def get_system_prompt(ctx: RunContext[MyDeps]) -> str:
    user = await ctx.deps.db_conn.get_user(ctx.deps.user_id)
    return f'You are helping {user.name}.'

@agent.tool
async def get_orders(ctx: RunContext[MyDeps]) -> list[Order]:
    return await ctx.deps.db_conn.get_orders(ctx.deps.user_id)

# 运行 Agent
async def main():
    deps = MyDeps(
        db_conn=await create_db_connection(),
        user_id='user_123',
    )
    result = await agent.run(
        'What are my recent orders?',
        deps=deps,
    )
    print(result.output)
```

在测试时，可以注入模拟的数据库连接，无需连接真实数据库即可验证 Agent 的行为逻辑。

```python
# 测试示例
async def test_agent():
    mock_deps = MyDeps(
        db_conn=MockDatabaseConnection(),
        user_id='test_user',
    )
    result = await agent.run('Show my orders', deps=mock_deps)
    assert 'order' in result.output.lower()
```

这种可测试性正是依赖注入模式的核心价值所在。

### 本章小结

本章深入分析了 Pydantic AI 的依赖注入机制。`AgentDepsT` 泛型参数在 Agent 定义时声明依赖类型，`RunContext` 作为依赖的载体在运行时传递给系统提示词函数和工具函数。框架通过函数签名分析实现透明注入，开发者无需手动管理依赖的传递。类型安全贯穿整个依赖链条，从定义到使用均有类型检查器的保护。这种设计使得 Agent 应用在保持灵活性的同时，也具备了良好的可测试性和可维护性。
