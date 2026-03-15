# 第 8 章 多模型支持

> 本章分析 Pydantic AI 如何通过适配器模式实现对 OpenAI、Anthropic、Gemini、Groq 等多种大语言模型的统一支持。每个适配器将模型特定的 API 调用和消息格式转换封装在内部，对上层 Agent 暴露一致的 `Model` / `AgentModel` 接口。

## 8.1 适配器模式概览

### 架构设计思路

Pydantic AI 的多模型支持采用经典的适配器模式（Adapter Pattern）。每个模型提供商对应一个独立的 Python 模块，模块内包含 `XxxModel`（实现 `Model`）和 `XxxAgentModel`（实现 `AgentModel`）两个类。适配器负责三件事：管理 SDK 客户端、转换消息格式、映射参数。

| 适配器模块 | Model 类 | AgentModel 类 | SDK 依赖 |
|-----------|----------|--------------|----------|
| `models/openai.py` | `OpenAIModel` | `OpenAIAgentModel` | `openai` |
| `models/anthropic.py` | `AnthropicModel` | `AnthropicAgentModel` | `anthropic` |
| `models/gemini.py` | `GeminiModel` | `GeminiAgentModel` | `google-genai` |
| `models/groq.py` | `GroqModel` | `GroqAgentModel` | `groq` |

### 懒加载策略

各适配器模块采用懒加载方式导入对应的 SDK 包。只有当用户实际使用某个模型时，才会触发对应 SDK 的 `import`。这意味着用户不需要安装所有 SDK，只需安装实际使用的模型所依赖的包即可。

## 8.2 OpenAI 适配器：OpenAIModel 实现

### 客户端初始化

`OpenAIModel` 在构造时创建 `AsyncOpenAI` 客户端实例。它支持通过参数传入 `api_key`，也支持从环境变量 `OPENAI_API_KEY` 自动读取。`base_url` 参数使得适配器可以兼容任何 OpenAI 兼容 API。

```python
# 文件: pydantic_ai/models/openai.py
class OpenAIModel(Model):
    model_name: str
    client: AsyncOpenAI

    def __init__(
        self,
        model_name: str,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        openai_client: AsyncOpenAI | None = None,
    ):
        if openai_client is not None:
            self.client = openai_client
        else:
            self.client = AsyncOpenAI(
                api_key=api_key, base_url=base_url
            )
        self.model_name = model_name
```

### 请求发送与响应处理

`OpenAIAgentModel` 的 `request` 方法将 Pydantic AI 的统一消息列表转换为 OpenAI Chat Completions API 所需的格式，然后调用 SDK 发送请求。

```python
# 文件: pydantic_ai/models/openai.py
class OpenAIAgentModel(AgentModel):
    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
    ) -> tuple[ModelResponse, Usage]:
        response = await self.client.chat.completions.create(
            model=self.model_name,
            messages=self._map_messages(messages),
            tools=self._map_tools(),
            **self._settings_to_kwargs(model_settings),
        )
        return self._process_response(response), self._get_usage(response)
```

## 8.3 Anthropic 适配器：AnthropicModel 实现

### 消息格式差异

Anthropic 的 Messages API 与 OpenAI 有显著差异。最关键的区别在于系统提示（system prompt）不在消息列表中，而是作为独立的顶层参数传递。适配器需要从统一消息列表中提取 `SystemPromptPart`，单独处理。

```python
# 文件: pydantic_ai/models/anthropic.py
class AnthropicModel(Model):
    model_name: str
    client: AsyncAnthropic

    async def agent_model(
        self,
        *,
        function_tools: list[ToolDefinition],
        allow_text_output: bool,
        output_tools: list[ToolDefinition],
        model_settings: ModelSettings | None,
    ) -> AnthropicAgentModel:
        return AnthropicAgentModel(
            client=self.client,
            model_name=self.model_name,
            function_tools=function_tools,
            allow_text_output=allow_text_output,
            output_tools=output_tools,
        )
```

### 工具调用映射

Anthropic 使用 `tool_use` 类型的 content block 来表示工具调用，而 OpenAI 使用独立的 `tool_calls` 字段。适配器在 `_process_response` 中统一将 Anthropic 的 `tool_use` block 转换为框架内部的 `ToolCallPart`。

```python
# 文件: pydantic_ai/models/anthropic.py
class AnthropicAgentModel(AgentModel):
    async def request(
        self, messages, model_settings
    ) -> tuple[ModelResponse, Usage]:
        system_prompt, anthropic_messages = self._map_messages(messages)
        response = await self.client.messages.create(
            model=self.model_name,
            system=system_prompt,
            messages=anthropic_messages,
            tools=self._map_tools(),
            max_tokens=model_settings.max_tokens if model_settings else 4096,
        )
        return self._process_response(response), self._get_usage(response)
```

## 8.4 Gemini 适配器：GeminiModel 实现

### Google GenAI SDK 集成

Gemini 适配器基于 Google 的 `google-genai` SDK 构建。与 OpenAI 和 Anthropic 不同，Gemini 的工具定义使用 `FunctionDeclaration` 格式，且消息角色只有 `user` 和 `model` 两种。

```python
# 文件: pydantic_ai/models/gemini.py
class GeminiModel(Model):
    model_name: str
    client: genai.Client

    def __init__(
        self,
        model_name: str,
        *,
        api_key: str | None = None,
    ):
        self.model_name = model_name
        self.client = genai.Client(api_key=api_key)
```

### 角色映射规则

Gemini API 的角色模型较为简洁，适配器需要将框架内部丰富的 Part 类型映射到 Gemini 的两种角色中。`SystemPromptPart` 通过 `system_instruction` 参数传递，`UserPromptPart` 和 `ToolReturnPart` 映射为 `user` 角色。

| 框架 Part 类型 | Gemini 角色 | 处理方式 |
|---------------|------------|---------|
| `SystemPromptPart` | 无 | 提取为 `system_instruction` |
| `UserPromptPart` | `user` | 直接映射 |
| `ToolReturnPart` | `user` | 转为 `FunctionResponse` |
| `TextPart` | `model` | 模型响应文本 |
| `ToolCallPart` | `model` | 转为 `FunctionCall` |

## 8.5 Groq 适配器：GroqModel 实现

### 兼容 OpenAI 格式

Groq 的 API 与 OpenAI Chat Completions API 高度兼容，因此 `GroqModel` 的实现与 `OpenAIModel` 非常相似。主要区别在于使用 `groq` SDK 的 `AsyncGroq` 客户端，以及模型名称的前缀处理。

```python
# 文件: pydantic_ai/models/groq.py
class GroqModel(Model):
    model_name: str
    client: AsyncGroq

    def __init__(
        self,
        model_name: str,
        *,
        api_key: str | None = None,
        groq_client: AsyncGroq | None = None,
    ):
        if groq_client is not None:
            self.client = groq_client
        else:
            self.client = AsyncGroq(api_key=api_key)
        self.model_name = model_name
```

### Groq 的性能优势

Groq 以极低的推理延迟著称，特别适合需要快速响应的场景。由于 API 格式兼容 OpenAI，适配器中的消息转换逻辑可以最大程度复用，降低了维护成本。

## 8.6 消息格式转换：统一消息到模型特定格式

### 转换流水线

每个适配器内部都有一个 `_map_messages` 方法，负责将框架统一的 `list[ModelMessage]` 转换为对应 SDK 所需的格式。转换过程通常分三步：提取系统提示、转换用户与工具消息、转换模型响应消息。

```python
# 文件: pydantic_ai/models/openai.py
# 消息转换的核心逻辑（简化示意）
def _map_messages(
    self, messages: list[ModelMessage]
) -> list[dict[str, Any]]:
    result = []
    for message in messages:
        if isinstance(message, ModelRequest):
            for part in message.parts:
                if isinstance(part, SystemPromptPart):
                    result.append({'role': 'system', 'content': part.content})
                elif isinstance(part, UserPromptPart):
                    result.append({'role': 'user', 'content': part.content})
                elif isinstance(part, ToolReturnPart):
                    result.append({
                        'role': 'tool',
                        'tool_call_id': part.tool_call_id,
                        'content': part.model_response_str(),
                    })
        elif isinstance(message, ModelResponse):
            # 转换模型响应为 assistant 角色消息
            ...
    return result
```

### 格式差异总结

不同模型 API 在消息格式上的差异是适配器层存在的核心原因。框架通过统一的内部消息模型屏蔽了这些差异，使得 Agent 层完全不需要关心底层模型的具体 API 格式。

## 8.7 模型名称解析：字符串到 Model 实例

### infer_model 函数

`infer_model` 是连接用户友好字符串与具体 `Model` 实例的桥梁。它根据前缀匹配规则，动态导入对应的适配器模块并创建 `Model` 实例。

```python
# 文件: pydantic_ai/models/__init__.py
def infer_model(model: Model | KnownModelName) -> Model:
    """将模型名称字符串解析为 Model 实例。"""
    if isinstance(model, Model):
        return model
    if model.startswith('openai:'):
        from .openai import OpenAIModel
        return OpenAIModel(model[len('openai:'):])
    elif model.startswith('anthropic:'):
        from .anthropic import AnthropicModel
        return AnthropicModel(model[len('anthropic:'):])
    elif model.startswith('gemini'):
        from .gemini import GeminiModel
        return GeminiModel(model)
    elif model.startswith('groq:'):
        from .groq import GroqModel
        return GroqModel(model[len('groq:'):])
    else:
        raise UserError(f'Unknown model: {model}')
```

这种延迟导入的设计确保了只有实际使用到的模型 SDK 才会被加载，避免了不必要的依赖。

## 本章小结

本章分析了 Pydantic AI 多模型支持的适配器实现。核心要点如下：

- **适配器模式**：每个模型提供商对应一个适配器模块，包含 `Model` 和 `AgentModel` 两个实现类，封装 SDK 交互细节。
- **消息格式转换**：各适配器通过 `_map_messages` 方法将统一消息模型转换为模型特定格式，屏蔽了 API 差异。
- **懒加载机制**：SDK 依赖通过延迟导入实现按需加载，用户只需安装实际使用的模型对应的包。
- **名称解析**：`infer_model` 函数通过前缀匹配将字符串映射为具体的 `Model` 实例，提供了简洁的使用方式。
- **兼容性复用**：Groq 等兼容 OpenAI 格式的模型可以最大程度复用转换逻辑，降低了适配成本。
