# 第 10 章 Tool 抽象与注册

> 工具（Tool）是 Agent 与外部世界交互的桥梁。Pydantic AI 通过 `Tool` 数据类封装工具函数，借助 `@agent.tool` 装饰器实现声明式注册，并从函数签名和 docstring 自动生成符合 LLM 规范的 JSON Schema。本章将深入 `Tool` 类的设计、装饰器的注册机制以及 Schema 自动生成的完整流程。

## 10.1 Tool 类的设计

### 核心数据结构

`Tool` 类是工具抽象的核心，它是一个泛型数据类，携带了工具函数的所有元信息。
通过 `Generic[AgentDepsT]` 参数化，使其能感知 Agent 的依赖类型。
`init=False` 的设计意味着 `Tool` 使用自定义的 `__init__` 方法来完成复杂的初始化逻辑。

```python
# 文件: pydantic_ai/tools.py
@dataclass(init=False)
class Tool(Generic[AgentDepsT]):
    """A tool function for an agent."""

    function: ToolFuncEither[AgentDepsT]
    takes_ctx: bool
    max_retries: int | None
    name: str
    description: str | None
    prepare: ToolPrepareFunc[AgentDepsT] | None
    docstring_format: DocstringFormat
    require_parameter_descriptions: bool
    strict: bool | None
    function_schema: _function_schema.FunctionSchema
```

### 关键字段说明

| 字段 | 类型 | 作用 |
|------|------|------|
| `function` | `ToolFuncEither` | 实际的工具函数 |
| `takes_ctx` | `bool` | 是否接收 RunContext |
| `name` | `str` | 工具名称，默认取函数名 |
| `prepare` | `ToolPrepareFunc` | 动态准备函数 |
| `function_schema` | `FunctionSchema` | 生成的函数 Schema |

## 10.2 @agent.tool 装饰器：注册工具函数

### 装饰器的双重形态

`@agent.tool` 支持两种使用方式：无参直接装饰和带参装饰。
这通过 Python 的 `@overload` 机制实现类型安全的重载。
无参形式直接传入函数，带参形式返回一个装饰器闭包。

```python
# 文件: pydantic_ai/agent/__init__.py
@overload
def tool(self, func: ToolFuncContext[AgentDepsT, ToolParams], /) -> ...: ...

@overload
def tool(
    self, /, *, name: str | None = None,
    retries: int | None = None,
    prepare: ToolPrepareFunc[AgentDepsT] | None = None,
) -> Callable[[ToolFuncContext[AgentDepsT, ToolParams]], ...]: ...
```

### 注册流程

装饰器内部调用 `self._function_toolset.add_function()` 完成注册。
`takes_ctx` 参数被硬编码为 `True`，因为 `@agent.tool` 要求函数的第一个参数必须是 `RunContext`。

```python
# 文件: pydantic_ai/agent/__init__.py
def tool_decorator(
    func_: ToolFuncContext[AgentDepsT, ToolParams],
) -> ToolFuncContext[AgentDepsT, ToolParams]:
    self._function_toolset.add_function(
        func_, True, name, retries, prepare,
        docstring_format, require_parameter_descriptions,
        schema_generator, strict,
    )
    return func_

return tool_decorator if func is None else tool_decorator(func)
```

### 使用示例

```python
# 文件: examples/tool_decorator.py
from pydantic_ai import Agent, RunContext

agent = Agent('openai:gpt-4o', deps_type=str)

@agent.tool
def search_db(ctx: RunContext[str], query: str) -> str:
    """Search the database for relevant records.

    Args:
        query: The search query string.
    """
    return f"Results for {query} with {ctx.deps}"
```

## 10.3 @agent.tool_plain：无上下文的工具

### 与 @agent.tool 的区别

`@agent.tool_plain` 注册的工具函数不需要 `RunContext` 参数。
它适用于不依赖运行上下文的纯工具函数，例如数学计算或字符串处理。
内部注册时 `takes_ctx` 参数被设为 `False`。

```python
# 文件: pydantic_ai/agent/__init__.py
def tool_plain(
    self,
    func: ToolFuncPlain[ToolParams] | None = None, /, *,
    name: str | None = None,
    retries: int | None = None,
    prepare: ToolPrepareFunc[AgentDepsT] | None = None,
) -> Any:
    def tool_decorator(func_: ToolFuncPlain[ToolParams]):
        self._function_toolset.add_function(
            func_, False, name, retries, prepare, ...
        )
        return func_
    return tool_decorator if func is None else tool_decorator(func)
```

### 使用示例

```python
# 文件: examples/tool_plain.py
from pydantic_ai import Agent

agent = Agent('openai:gpt-4o')

@agent.tool_plain
def calculate(expression: str) -> str:
    """Evaluate a math expression.

    Args:
        expression: A Python math expression to evaluate.
    """
    return str(eval(expression))
```

## 10.4 ToolDefinition：工具定义与 JSON Schema

### 面向模型的工具描述

`ToolDefinition` 是发送给 LLM 的工具定义数据结构。
它将工具的名称、描述和参数 Schema 封装为模型可以理解的格式。
`kind` 字段区分了三种工具类型：普通函数工具、输出工具和延迟工具。

```python
# 文件: pydantic_ai/tools.py
@dataclass(repr=False)
class ToolDefinition:
    name: str
    parameters_json_schema: ObjectJsonSchema = field(
        default_factory=lambda: {'type': 'object', 'properties': {}}
    )
    description: str | None = None
    outer_typed_dict_key: str | None = None
    strict: bool | None = None
    kind: ToolKind = field(default='function')
```

### ToolKind 类型说明

| 类型 | 含义 | 场景 |
|------|------|------|
| `function` | 普通函数工具 | Agent 运行期间执行 |
| `output` | 输出工具 | 结束对话并返回结构化数据 |
| `deferred` | 延迟工具 | 需外部服务异步处理 |

## 10.5 Schema 自动生成：从函数签名到 JSON Schema

### FunctionSchema 的生成

`_function_schema.function_schema()` 是 Schema 生成的入口。
它解析函数的类型注解，利用 Pydantic 内部的 `_generate_schema` 模块构建 core schema。
然后通过 `GenerateToolJsonSchema` 转换为 JSON Schema。

```python
# 文件: pydantic_ai/_function_schema.py
@dataclass
class FunctionSchema:
    function: Callable[..., Any]
    description: str | None
    validator: SchemaValidator
    json_schema: ObjectJsonSchema
    takes_ctx: bool
    is_async: bool
    single_arg_name: str | None = None
    positional_fields: list[str] = field(default_factory=list)
```

### 从 Tool 到 ToolDefinition

`Tool` 类通过 `tool_def` 属性将内部的 `FunctionSchema` 转换为面向模型的 `ToolDefinition`。
这一过程将函数级的 Schema 信息映射为 LLM API 所需的标准格式。

```python
# 文件: pydantic_ai/tools.py
@property
def tool_def(self):
    return ToolDefinition(
        name=self.name,
        description=self.description,
        parameters_json_schema=self.function_schema.json_schema,
        strict=self.strict,
    )
```

## 10.6 参数描述的提取（docstring 解析）

### 多格式 docstring 支持

Pydantic AI 通过 `_griffe` 模块解析函数的 docstring 提取参数描述。
支持 Google、Numpy、Sphinx 三种主流 docstring 格式，默认为 `auto` 自动检测。
提取的描述会被注入到 JSON Schema 的 `description` 字段中，帮助模型理解每个参数的用途。

| 格式 | 样例 | 特点 |
|------|------|------|
| Google | `Args:\n    x: desc` | 最常用，简洁 |
| Numpy | `Parameters\n----------` | 科学计算社区流行 |
| Sphinx | `:param x: desc` | 传统文档工具 |
| auto | 自动推断 | 默认选项 |

### require_parameter_descriptions

当 `require_parameter_descriptions=True` 时，如果某个参数缺少 docstring 描述则会抛出错误。
这一机制确保了工具定义的完整性，避免模型因缺少参数说明而产生误解。

## 10.7 工具注册的两种方式对比（构造时 vs 装饰器）

### 构造时注册

通过 `Agent` 构造函数的 `tools` 参数直接传入 `Tool` 实例列表。
这种方式适合工具已预先定义好的场景，支持更细粒度的配置。

```python
# 文件: examples/tool_constructor.py
from pydantic_ai import Agent, Tool

def my_tool(x: int, y: int) -> int:
    """Add two numbers."""
    return x + y

agent = Agent('openai:gpt-4o', tools=[Tool(my_tool)])
```

### 装饰器注册

通过 `@agent.tool` 或 `@agent.tool_plain` 装饰器注册。
这种方式更 Pythonic，适合工具与 Agent 紧密耦合的场景。

### 两种方式对比

| 维度 | 构造时注册 | 装饰器注册 |
|------|-----------|-----------|
| 语法 | `tools=[Tool(func)]` | `@agent.tool` |
| 灵活性 | 高，可传入 prepare 等参数 | 中，通过装饰器参数配置 |
| 复用性 | Tool 实例可跨 Agent 复用 | 绑定到特定 Agent |
| 适用场景 | 动态工具、工具库 | 业务紧耦合工具 |

## 本章小结

本章深入分析了 Pydantic AI 的工具抽象与注册机制。
`Tool` 类作为核心数据结构封装了工具函数的所有元信息。
`@agent.tool` 和 `@agent.tool_plain` 两种装饰器分别处理有上下文和无上下文的工具注册。
`ToolDefinition` 将内部表示转换为 LLM 可理解的标准格式。
Schema 自动生成从函数签名和 docstring 中提取类型与描述信息，极大减少了手动配置的工作量。
