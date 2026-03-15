# 第 2 章 Repo 结构与模块依赖

> Pydantic AI 的代码仓库结构清晰，职责划分明确。公共 API 集中在顶层模块，内部实现封装在 `_internal` 目录，模型适配器统一放在 `models` 目录。理解这一结构是深入源码分析的基础。

## 2.1 顶层目录结构

### 仓库根目录

Pydantic AI 的仓库采用标准的 Python 项目布局。
核心源码位于 `pydantic_ai/` 包目录下，测试代码位于 `tests/` 目录。

```
# 文件: 仓库根目录结构
pydantic-ai/
├── pydantic_ai/          # 核心源码包
├── pydantic_ai_slim/     # 精简版包（无可选依赖）
├── tests/                # 测试代码
├── examples/             # 示例代码
├── docs/                 # 文档源文件
├── pyproject.toml        # 项目配置与依赖定义
└── README.md             # 项目说明
```

### 双包策略

值得注意的是仓库中存在 `pydantic_ai` 和 `pydantic_ai_slim` 两个包。
`pydantic_ai` 是完整版，包含所有模型适配器的可选依赖。
`pydantic_ai_slim` 是精简版，用户按需安装特定模型的 SDK。

## 2.2 pydantic_ai 包结构详解

### 核心模块一览

```
# 文件: pydantic_ai/ 包结构
pydantic_ai/
├── __init__.py          # 公共 API 导出
├── agent.py             # Agent 核心类（最大文件）
├── result.py            # RunResult / StreamedRunResult
├── tools.py             # Tool 抽象
├── messages.py          # 消息类型体系
├── settings.py          # ModelSettings
├── exceptions.py        # 异常定义
├── _internal/           # 内部实现
│   ├── _agent_graph.py  # Agent 执行图
│   ├── _result.py       # 结果处理内部逻辑
│   └── _utils.py        # 工具函数
├── models/              # 模型适配器
│   ├── __init__.py      # Model 协议定义
│   ├── openai.py        # OpenAI 适配器
│   ├── anthropic.py     # Anthropic 适配器
│   ├── gemini.py        # Gemini 适配器
│   ├── groq.py          # Groq 适配器
│   ├── mistral.py       # Mistral 适配器
│   └── test.py          # TestModel / FunctionModel
└── mcp.py               # MCP 客户端集成
```

### 模块职责划分

| 模块 | 职责 | 关键类/函数 |
|------|------|------------|
| agent.py | Agent 生命周期管理 | `Agent` |
| result.py | 运行结果封装 | `RunResult`, `StreamedRunResult` |
| tools.py | 工具定义与 schema 提取 | `Tool`, `ToolDefinition` |
| messages.py | 消息类型定义 | `ModelMessage`, `ModelRequest` |
| settings.py | 模型参数配置 | `ModelSettings` |

## 2.3 _internal 模块：框架的内部实现

### 内部模块的设计意图

以下划线开头的 `_internal` 目录存放不对外暴露的实现细节。
这是 Python 社区的惯例——下划线前缀表示"非公共 API，随时可能变更"。
Pydantic AI 通过这种方式将稳定的公共接口与易变的内部实现分离。

### 核心内部模块

**`_agent_graph.py`** 是执行引擎的核心，实现了 Agent 的运行图。
它将 Agent 的一次运行拆分为多个节点：发送请求、处理响应、执行工具、验证结果。
这种图结构使得执行流程清晰可控，也便于支持流式输出。

**`_result.py`** 处理模型输出到类型安全结果的转换逻辑。
它负责将 LLM 返回的原始文本或 JSON 解析为 `output_type` 指定的类型。

**`_utils.py`** 包含各类工具函数，如参数提取、类型检查等辅助功能。

```python
# 文件: pydantic_ai/_internal/_agent_graph.py
# Agent 执行图的核心节点定义
# 每个节点代表执行流程中的一个步骤
# 节点之间通过图结构连接，形成完整的执行流程
```

## 2.4 models 目录：模型适配器

### 适配器模式

`models/` 目录下的每个文件对应一个 LLM 提供商的适配器。
所有适配器都实现了 `models/__init__.py` 中定义的 `Model` 协议。
这种设计使得新增模型支持只需添加一个新文件，无需修改核心逻辑。

```python
# 文件: pydantic_ai/models/__init__.py
class Model(ABC):
    """Abstract base class for LLM model adapters."""

    @abstractmethod
    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
    ) -> ModelResponse:
        ...
```

### 模型适配器列表

| 适配器文件 | 支持模型 | 依赖 SDK |
|-----------|---------|----------|
| openai.py | GPT-4o, GPT-4, GPT-3.5 等 | openai |
| anthropic.py | Claude 3.5, Claude 3 等 | anthropic |
| gemini.py | Gemini Pro, Gemini Flash 等 | google-genai |
| groq.py | Llama, Mixtral 等 | groq |
| test.py | TestModel, FunctionModel | 无（内置） |

### TestModel 的价值

`test.py` 中的 `TestModel` 和 `FunctionModel` 是框架的独特优势。
它们允许开发者在不调用真实 API 的情况下编写完整的单元测试。
`FunctionModel` 还支持自定义响应逻辑，适合构造各种边界测试场景。

## 2.5 tools 目录：工具系统

### 工具定义的核心抽象

Pydantic AI 的工具系统围绕 `tools.py` 构建。
`Tool` 类封装了工具函数、参数 schema 和执行逻辑。
框架会自动从函数签名中提取参数信息，生成符合 LLM 要求的 tool schema。

```python
# 文件: pydantic_ai/tools.py
@dataclass
class Tool(Generic[AgentDepsT]):
    """A tool that can be called by an agent."""
    function: ToolFuncEither[AgentDepsT, ...]
    name: str
    description: str
    takes_ctx: bool
    max_retries: int | None
```

### schema 自动提取

工具函数的参数类型注解会被自动转换为 JSON Schema。
这得益于 Pydantic 强大的 schema 生成能力。
开发者只需写好类型注解，框架负责其余的适配工作。

## 2.6 模块依赖关系图

### 依赖层次

Pydantic AI 的模块依赖呈现清晰的分层结构。

```
# 文件: 模块依赖关系（逻辑视图）
┌─────────────────────────────────────┐
│           agent.py (顶层入口)         │
├──────────┬──────────┬───────────────┤
│ tools.py │ result.py│ messages.py   │
├──────────┴──────────┴───────────────┤
│         models/__init__.py          │
├─────────────────────────────────────┤
│     _internal/ (执行引擎)            │
├─────────────────────────────────────┤
│   settings.py / exceptions.py       │
└─────────────────────────────────────┘
```

`agent.py` 位于最顶层，依赖几乎所有其他模块。
`models/__init__.py` 定义协议接口，被具体适配器和 Agent 同时依赖。
`_internal/` 层是执行引擎，被 `agent.py` 和 `result.py` 调用。

## 2.7 公共 API 导出（__init__.py 分析）

### 精心控制的导出

`__init__.py` 是用户接触框架的第一个入口。
Pydantic AI 在此文件中只导出经过精心挑选的公共类和函数。

```python
# 文件: pydantic_ai/__init__.py
from .agent import Agent
from .tools import Tool, RunContext
from .result import RunResult, StreamedRunResult
from .exceptions import (
    ModelRetry,
    UnexpectedModelBehavior,
    UserError,
)
```

### 导出策略

框架遵循"最小导出"原则，只有稳定的、面向用户的 API 才会出现在顶层导出中。
内部实现类（如 `_agent_graph` 中的节点类）不会被导出。
这保证了用户代码不会意外依赖内部实现，为框架的后续迭代提供了灵活性。

## 本章小结

本章详细剖析了 Pydantic AI 的仓库结构与模块依赖关系。
核心源码集中在 `pydantic_ai/` 包中，职责划分清晰。
`_internal` 目录封装了执行引擎等内部实现，对外不可见。
`models/` 目录通过适配器模式支持多种 LLM 提供商。
`__init__.py` 遵循最小导出原则，确保公共 API 的稳定性。
理解了这一结构，后续章节将聚焦于各模块的内部实现细节。
