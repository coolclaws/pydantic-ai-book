# 第 9 章 ModelSettings 与请求参数

> 本章分析 Pydantic AI 中模型请求参数的管理机制，包括 `ModelSettings` 的统一抽象、通用参数与模型特化参数的处理方式、Agent 级与运行级参数的合并策略，以及 `UsageLimits` 对 token 用量的限制能力。

## 9.1 ModelSettings 的统一抽象

### 参数容器的设计

`ModelSettings` 是一个 `TypedDict`，用于封装所有可以传递给模型的请求参数。它采用 `TypedDict` 而非 `dataclass` 是有意为之的设计选择——`TypedDict` 天然支持可选字段，未设置的参数不会出现在字典中，这使得参数合并逻辑更加简洁。

```python
# 文件: pydantic_ai/settings.py
class ModelSettings(TypedDict, total=False):
    """模型请求的统一参数设置。"""
    max_tokens: int
    temperature: float
    top_p: float
    timeout: float | Timeout
    parallel_tool_calls: bool
```

### total=False 的妙用

`total=False` 意味着所有字段都是可选的。当用户只想设置 `temperature` 而保持其他参数为默认值时，只需传入 `{'temperature': 0.7}`。这种设计避免了大量的 `None` 值检查，也使得参数合并可以直接使用字典展开操作。

## 9.2 通用参数：temperature, max_tokens, top_p

### 核心生成参数

这三个参数是几乎所有大语言模型都支持的通用生成参数。`temperature` 控制输出的随机性，`max_tokens` 限制输出长度，`top_p` 实现核采样。它们的语义在不同模型中基本一致。

| 参数 | 类型 | 取值范围 | 说明 |
|------|------|---------|------|
| `temperature` | `float` | 0.0 - 2.0 | 值越高输出越随机 |
| `max_tokens` | `int` | 1 - 模型上限 | 最大输出 token 数 |
| `top_p` | `float` | 0.0 - 1.0 | 核采样概率阈值 |
| `timeout` | `float` | >0 | 请求超时秒数 |

### 参数的业务含义

在 Agent 场景中，参数选择直接影响输出质量。对于工具调用决策，建议使用较低的 `temperature`（如 0.0）以获得稳定的决策结果。对于创意生成场景，可以适当提高 `temperature`。`max_tokens` 需要根据预期输出长度合理设置，过小会导致输出截断。

## 9.3 模型特化参数的处理机制

### 透传策略

不同模型提供商支持的参数不完全相同。例如 OpenAI 支持 `parallel_tool_calls` 参数来控制是否并行调用工具，而 Anthropic 的 API 没有这个概念。框架采用「透传」策略处理此问题：通用参数在所有适配器中统一处理，特化参数仅在支持它的适配器中生效。

```python
# 文件: pydantic_ai/models/openai.py
class OpenAIAgentModel(AgentModel):
    def _settings_to_kwargs(
        self, model_settings: ModelSettings | None
    ) -> dict[str, Any]:
        if not model_settings:
            return {}
        kwargs: dict[str, Any] = {}
        if 'max_tokens' in model_settings:
            kwargs['max_tokens'] = model_settings['max_tokens']
        if 'temperature' in model_settings:
            kwargs['temperature'] = model_settings['temperature']
        if 'top_p' in model_settings:
            kwargs['top_p'] = model_settings['top_p']
        if 'parallel_tool_calls' in model_settings:
            kwargs['parallel_tool_calls'] = model_settings['parallel_tool_calls']
        if 'timeout' in model_settings:
            kwargs['timeout'] = model_settings['timeout']
        return kwargs
```

### 忽略不支持的参数

当一个适配器不支持某个参数时，它会静默忽略该参数而非抛出异常。这使得用户可以在不同模型间切换时使用相同的 `ModelSettings`，而不必担心兼容性问题。

## 9.4 参数合并策略（Agent 级 vs 运行级）

### 两层参数覆盖

Pydantic AI 支持在两个层级设置模型参数。Agent 级参数在构造 Agent 时设定，作为默认值。运行级参数在调用 `agent.run()` 时传入，可以覆盖 Agent 级的设置。

```python
# 文件: pydantic_ai/agent.py
# Agent 构造时设置默认参数
agent = Agent(
    'openai:gpt-4o',
    model_settings=ModelSettings(temperature=0.5, max_tokens=1000),
)

# 运行时覆盖特定参数
result = await agent.run(
    'Hello',
    model_settings=ModelSettings(temperature=0.0),
)
# 最终生效: temperature=0.0, max_tokens=1000
```

### 合并逻辑实现

参数合并利用了 `TypedDict` 的字典特性，通过简单的字典展开实现「后者覆盖前者」的语义。框架内部使用一个辅助函数来完成合并操作。

```python
# 文件: pydantic_ai/settings.py
def merge_model_settings(
    *settings: ModelSettings | None,
) -> ModelSettings | None:
    """合并多个 ModelSettings，后者覆盖前者。"""
    result: ModelSettings = {}
    for s in settings:
        if s is not None:
            result.update(s)
    return result if result else None
```

这种设计让参数管理变得直观：Agent 级设置充当全局默认值，运行级设置提供按需覆盖能力。

## 9.5 UsageLimits：token 用量限制

### 防止失控消耗

`UsageLimits` 用于限制 Agent 运行过程中的 token 消耗总量。在多轮工具调用的场景中，Agent 可能会进行多次模型请求，如果不加限制，token 消耗可能远超预期。

```python
# 文件: pydantic_ai/settings.py
@dataclass
class UsageLimits:
    """控制 Agent 运行期间的 token 用量上限。"""
    request_limit: int | None = None
    request_token_limit: int | None = None
    response_token_limit: int | None = None
    total_token_limit: int | None = None

    def check_before_request(self, usage: Usage) -> None:
        """在发送请求前检查是否超限。"""
        if self.request_limit is not None and usage.requests >= self.request_limit:
            raise UsageLimitExceeded(
                f'Request limit of {self.request_limit} reached'
            )
        ...

    def check_tokens(self, usage: Usage) -> None:
        """在收到响应后检查 token 用量。"""
        if self.total_token_limit is not None:
            if usage.total_tokens and usage.total_tokens > self.total_token_limit:
                raise UsageLimitExceeded(
                    f'Total token limit of {self.total_token_limit} exceeded'
                )
        ...
```

### 限制维度说明

| 限制字段 | 检查时机 | 说明 |
|---------|---------|------|
| `request_limit` | 请求前 | 最大请求次数 |
| `request_token_limit` | 响应后 | 累计输入 token 上限 |
| `response_token_limit` | 响应后 | 累计输出 token 上限 |
| `total_token_limit` | 响应后 | 累计总 token 上限 |

### 使用示例

```python
# 文件: 用户代码示例
result = await agent.run(
    'Analyze this data',
    usage_limits=UsageLimits(
        request_limit=10,          # 最多 10 次请求
        total_token_limit=50000,   # 总共不超过 5 万 token
    ),
)
```

当任何限制被触发时，框架会抛出 `UsageLimitExceeded` 异常，终止当前 Agent 运行。这为生产环境中的成本控制提供了保障。

## 9.6 参数透传到各模型 SDK

### 端到端参数流转

参数从用户设置到最终传递给模型 SDK，经历了完整的流转链路：用户设定 -> Agent 合并 -> AgentModel 转换 -> SDK 调用。每一步都有明确的职责边界。

```
用户代码                    框架内部                     模型 SDK
ModelSettings ──> merge_model_settings ──> _settings_to_kwargs ──> API 调用
(Agent 级)        (合并运行级)              (适配器转换)           (HTTP 请求)
(运行级)
```

### 适配器的转换责任

每个适配器的 `_settings_to_kwargs` 方法负责将统一的 `ModelSettings` 转换为对应 SDK 接受的参数格式。例如 Anthropic SDK 要求 `max_tokens` 为必填参数，适配器会在未设置时提供默认值 4096。

```python
# 文件: pydantic_ai/models/anthropic.py
class AnthropicAgentModel(AgentModel):
    def _settings_to_kwargs(
        self, model_settings: ModelSettings | None
    ) -> dict[str, Any]:
        kwargs: dict[str, Any] = {}
        if model_settings and 'max_tokens' in model_settings:
            kwargs['max_tokens'] = model_settings['max_tokens']
        else:
            kwargs['max_tokens'] = 4096  # Anthropic 要求必填
        if model_settings and 'temperature' in model_settings:
            kwargs['temperature'] = model_settings['temperature']
        if model_settings and 'timeout' in model_settings:
            kwargs['timeout'] = model_settings['timeout']
        return kwargs
```

这种设计确保了每个模型 SDK 都能收到格式正确且完整的参数，同时对用户保持了统一简洁的接口。

## 本章小结

本章详细分析了 Pydantic AI 的模型参数管理机制。核心要点如下：

- **TypedDict 设计**：`ModelSettings` 使用 `TypedDict(total=False)` 实现全可选字段，简化了参数合并和透传逻辑。
- **两层覆盖**：Agent 级参数作为默认值，运行级参数按需覆盖，合并通过字典展开完成。
- **特化参数处理**：不支持的参数被静默忽略，保证了跨模型切换时的兼容性。
- **UsageLimits 防护**：提供请求次数和 token 用量的多维限制，在请求前后分别检查，超限时抛出异常终止运行。
- **端到端流转**：参数从用户设置经过合并、转换，最终传递到模型 SDK，每一步职责清晰。
