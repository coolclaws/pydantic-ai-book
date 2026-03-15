# 第 1 章 项目概览与设计哲学

> Pydantic AI 是由 Pydantic 团队打造的类型安全优先的 AI Agent 框架。它继承了 Pydantic 在数据验证领域的核心理念，将类型系统的严谨性带入大模型应用开发，为开发者提供了一套简洁、可靠且模型无关的 Agent 构建方案。

## 1.1 Pydantic AI 的定位：类型安全优先的 Agent 框架

### 为什么需要类型安全

在大模型应用开发中，模型的输入与输出往往是非结构化的文本。
当应用规模增长，缺乏类型约束的代码会迅速变得难以维护。
Pydantic AI 的核心主张是：用 Python 类型系统约束 Agent 的每一个交互环节。

### 框架定位

Pydantic AI 并非一个大而全的 AI 应用平台，而是聚焦于 Agent 层的轻量级框架。
它关注的核心问题是：如何让开发者用最少的代码构建类型安全的 AI Agent。
框架不绑定特定模型提供商，支持 OpenAI、Anthropic、Gemini、Groq、Mistral 等主流模型。

## 1.2 Pydantic 血统：从数据验证到 AI Agent

### Pydantic 的演进之路

Pydantic 最初是一个 Python 数据验证库，凭借其基于类型注解的验证机制广受欢迎。
Pydantic V2 用 Rust 重写了核心引擎，性能大幅提升。
Pydantic AI 是这条技术路线的自然延伸——将验证能力应用于 LLM 的输出。

### 共享的核心理念

Pydantic AI 复用了 Pydantic 的 `BaseModel` 来定义结构化输出。
模型返回的 JSON 会自动经过 Pydantic 验证，不符合类型约束的输出会触发重试。
这意味着开发者可以像定义普通数据模型一样定义 Agent 的输出结构。

## 1.3 设计哲学：简洁、类型安全、模型无关

### 三大设计原则

**简洁性**：API 表面积小，核心类只有 `Agent`、`Tool`、`RunContext` 等少数几个。
一个最小的 Agent 只需要三行代码即可创建和运行。

**类型安全**：通过泛型参数 `Agent[AgentDepsT, OutputDataT]` 实现编译期类型检查。
依赖注入、工具参数、输出类型全部受类型系统保护。

**模型无关**：通过 `Model` 协议抽象模型接口，切换模型只需修改一个字符串参数。
测试时可以使用 `TestModel` 或 `FunctionModel` 完全脱离真实 API 调用。

## 1.4 与 LangChain、CrewAI 的设计差异

### 框架对比

| 维度 | Pydantic AI | LangChain | CrewAI |
|------|------------|-----------|--------|
| 设计理念 | 类型安全、极简 API | 链式组合、生态丰富 | 多 Agent 协作 |
| 类型支持 | 原生泛型，完整类型推导 | 类型支持有限 | 基本类型提示 |
| 模型抽象 | `Model` 协议 + 适配器 | `BaseLLM` 继承体系 | 依赖 LangChain |
| 学习曲线 | 低，API 简洁 | 高，概念繁多 | 中等 |

### 关键差异

Pydantic AI 有意避免了 LangChain 的"过度抽象"问题。
它不引入 Chain、Memory、Retriever 等大量中间概念。
开发者直接与 `Agent` 类交互，工具通过函数装饰器注册，结果通过类型参数约束。

## 1.5 核心概念一览

### 五大核心概念

**Agent**：框架的核心入口，封装了模型调用、工具执行和结果验证的完整流程。

**Tool**：Agent 可以调用的外部工具，通过函数定义并自动提取参数 schema。

**Model**：模型适配器，将不同 LLM 提供商的 API 统一为标准协议。

**Result**：`RunResult` 和 `StreamedRunResult`，携带类型安全的输出数据和元信息。

**Dependency**：通过 `RunContext[DepsT]` 注入的运行时依赖，支持数据库连接、配置等场景。

```python
# 文件: pydantic_ai/agent.py
class Agent(Generic[AgentDepsT, OutputDataT]):
    """Main class for creating AI agents with type-safe interactions."""
```

## 1.6 一个最小示例

### 三行代码创建 Agent

以下示例展示了 Pydantic AI 的极简用法。
创建 Agent 时指定模型和系统提示，然后同步运行即可获得类型安全的结果。

```python
# 文件: examples/minimal.py
from pydantic_ai import Agent

agent = Agent('openai:gpt-4o', system_prompt='Be concise.')
result = agent.run_sync('What is the capital of France?')
print(result.output)
# Paris
```

### 结构化输出示例

通过 `output_type` 参数，可以让 Agent 返回 Pydantic 模型实例。

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
print(result.output.name)       # Paris
print(result.output.population) # 2161000
```

## 1.7 版本与依赖信息

### 项目依赖

Pydantic AI 的核心依赖非常精简，体现了其轻量级设计理念。

```toml
# 文件: pyproject.toml
[project]
name = "pydantic-ai"
requires-python = ">=3.9"
dependencies = [
    "pydantic>=2.10",
    "httpx>=0.27",
    "typing-extensions>=4.12",
]
```

### 依赖说明

| 依赖 | 用途 | 最低版本 |
|------|------|---------|
| pydantic | 数据验证与 schema 生成 | 2.10 |
| httpx | 异步 HTTP 客户端 | 0.27 |
| typing-extensions | 类型系统扩展 | 4.12 |

核心依赖仅三个，各模型适配器（如 `openai`、`anthropic`）作为可选依赖按需安装。
这种设计避免了不必要的依赖膨胀，用户只需安装实际使用的模型 SDK。

## 本章小结

本章从宏观视角介绍了 Pydantic AI 的定位与设计哲学。
它是一个由 Pydantic 团队打造的类型安全优先的 AI Agent 框架。
与 LangChain 的大而全不同，Pydantic AI 追求极简 API 和原生类型支持。
核心概念仅有 Agent、Tool、Model、Result、Dependency 五个。
最小示例只需三行代码，结构化输出通过 Pydantic 模型自然实现。
后续章节将逐步深入源码，揭示这些简洁 API 背后的实现细节。
