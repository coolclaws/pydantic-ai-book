## 第 15 章 MCP 客户端集成

> Model Context Protocol（MCP）是 Anthropic 提出的开放协议，旨在标准化 AI 模型与外部工具之间的通信方式。Pydantic AI 内置了 MCP 客户端支持，可以通过 `MCPServerStdio` 和 `MCPServerHTTP` 两种方式连接 MCP Server，自动发现并映射工具。本章将深入分析 Pydantic AI 的 MCP 集成机制。

### 15.1 MCP 协议简介

MCP（Model Context Protocol）定义了一套标准化的工具发现和调用协议。
它使得 AI Agent 可以动态连接外部工具服务器，无需在代码中硬编码工具定义。
MCP Server 对外暴露工具列表和调用接口，MCP Client 负责发现工具并将其转换为模型可用的格式。

MCP 的核心价值在于解耦。
工具提供方只需实现 MCP Server 接口，即可被任何支持 MCP 的 Agent 框架调用。
Pydantic AI 作为 MCP Client，能够自动将远程工具转换为本地 `Tool` 对象。

MCP 支持两种通信方式：

| 通信方式 | 连接类 | 传输协议 | 适用场景 |
|---------|--------|---------|---------|
| 标准 I/O | `MCPServerStdio` | stdin/stdout | 本地进程 |
| HTTP/SSE | `MCPServerHTTP` | HTTP + SSE | 远程服务 |

### 15.2 MCPServerStdio：标准输入输出连接

`MCPServerStdio` 通过启动子进程并通过标准输入输出通信来连接本地 MCP Server。

```python
# 文件: pydantic_ai/mcp.py
class MCPServerStdio:
    command: str
    args: list[str]
    env: dict[str, str] | None

    async def list_tools(self) -> list[ToolDefinition]:
        """从 MCP Server 获取可用工具列表。"""
        ...
```

`command` 指定要启动的可执行程序，`args` 是传递给该程序的参数列表。
`env` 允许为子进程设置自定义环境变量，例如 API 密钥或配置路径。
这种方式适合集成基于 Node.js 或 Python 实现的本地 MCP Server。

创建 `MCPServerStdio` 实例非常简洁：

```python
from pydantic_ai.mcp import MCPServerStdio

# 连接文件系统 MCP Server
server = MCPServerStdio(
    'npx',
    ['-y', '@modelcontextprotocol/server-filesystem', '/tmp']
)
```

框架会在需要时自动启动子进程，并通过 JSON-RPC 协议与其通信。
通信过程对开发者完全透明，无需手动管理进程的生命周期。

### 15.3 MCPServerHTTP：HTTP/SSE 连接

`MCPServerHTTP` 通过 HTTP 协议连接远程 MCP Server，使用 SSE（Server-Sent Events）接收流式响应。

```python
# 文件: pydantic_ai/mcp.py
class MCPServerHTTP:
    url: str
    headers: dict[str, str] | None

    async def list_tools(self) -> list[ToolDefinition]:
        """从远程 MCP Server 获取工具列表。"""
        ...
```

`url` 指向远程 MCP Server 的端点地址。
`headers` 可以携带认证信息，例如 Bearer Token 或自定义的 API Key。
这种方式适合连接部署在云端的 MCP 服务，支持团队共享工具资源。

```python
from pydantic_ai.mcp import MCPServerHTTP

# 连接远程 MCP Server
server = MCPServerHTTP(
    url='http://localhost:8080/mcp',
    headers={'Authorization': 'Bearer token123'}
)
```

与 `MCPServerStdio` 不同，HTTP 连接不需要管理子进程。
框架通过标准的 HTTP 请求与服务器交互，网络层的重试和超时由底层 HTTP 客户端处理。

### 15.4 MCP 工具的自动发现与映射

MCP Server 通过 `list_tools()` 方法暴露其可用工具列表。
每个工具以 `ToolDefinition` 的形式描述，包含名称、描述和参数的 JSON Schema。

```python
# 文件: pydantic_ai/tools.py
@dataclass
class ToolDefinition:
    name: str
    description: str
    parameters_json_schema: dict[str, Any]
```

当 Agent 启动 MCP 连接后，会自动调用 `list_tools()` 获取工具列表。
每个 `ToolDefinition` 会被转换为 Pydantic AI 内部的 `Tool` 对象。
模型在推理时可以像使用本地工具一样调用这些远程工具。

自动发现机制意味着 MCP Server 新增工具后，Agent 无需修改代码即可使用。
这种动态绑定的模式极大提升了系统的灵活性和可扩展性。

### 15.5 MCP 工具到 Pydantic AI Tool 的转换

框架在内部将 MCP 工具的 JSON Schema 参数定义映射为 Pydantic AI 的工具调用接口。
当模型发出工具调用请求时，框架会将参数序列化后通过 MCP 协议转发给 Server。
Server 执行完毕后返回结果，框架再将其封装为 `ToolReturnPart` 传回对话流。

整个转换过程可以概括为以下步骤：

1. Agent 调用 `list_tools()` 获取 `ToolDefinition` 列表
2. 每个 `ToolDefinition` 注册为模型可用的工具选项
3. 模型输出 `ToolCallPart` 时，框架通过 MCP 协议发送调用请求
4. MCP Server 执行工具逻辑并返回结果
5. 框架将结果封装为 `ToolReturnPart` 继续对话

### 15.6 Agent 与 MCP Server 的集成方式

Agent 通过构造函数的 `mcp_servers` 参数接收 MCP Server 列表。
使用 `run_mcp_servers()` 上下文管理器来管理连接的生命周期。

```python
from pydantic_ai import Agent
from pydantic_ai.mcp import MCPServerStdio

server = MCPServerStdio(
    'npx',
    ['-y', '@modelcontextprotocol/server-filesystem', '/tmp']
)

agent = Agent('openai:gpt-4o', mcp_servers=[server])

async with agent.run_mcp_servers():
    result = await agent.run('List files in /tmp')
    print(result.output)
```

`mcp_servers` 参数接受一个列表，支持同时连接多个 MCP Server。
多个 Server 提供的工具会合并到同一个工具池中，模型可以在一次对话中调用不同 Server 的工具。

`run_mcp_servers()` 是一个异步上下文管理器。
进入时建立所有 MCP 连接，退出时自动清理资源。
这确保了即使发生异常，子进程和网络连接也能被正确关闭。

### 15.7 MCP Server 的生命周期管理

MCP Server 连接的生命周期由 `run_mcp_servers()` 上下文管理器严格控制。

对于 `MCPServerStdio`，框架在进入上下文时启动子进程，退出时发送终止信号。
对于 `MCPServerHTTP`，框架在进入上下文时建立 HTTP 会话，退出时关闭连接。

```python
async with agent.run_mcp_servers():
    # 此范围内 MCP 连接处于活跃状态
    result1 = await agent.run('Read file.txt')
    result2 = await agent.run('Write to output.txt')
# 退出后，所有 MCP 连接已关闭
```

在上下文范围内可以执行多次 `run()` 调用，共享同一组 MCP 连接。
这避免了每次运行都重新建立连接的开销，特别是对于需要启动子进程的 Stdio 方式。

如果不使用上下文管理器就直接调用 `run()`，框架会在每次运行时自动建立和关闭连接。
这种方式更简单但效率较低，适合单次调用的场景。

### 本章小结

Pydantic AI 通过 `MCPServerStdio` 和 `MCPServerHTTP` 两种连接方式实现了对 MCP 协议的完整支持。
框架自动完成工具发现、参数映射和结果封装，开发者无需关心底层通信细节。
Agent 通过 `mcp_servers` 参数和 `run_mcp_servers()` 上下文管理器管理 MCP 连接的生命周期。
MCP 集成使得 Pydantic AI Agent 能够动态扩展工具能力，连接丰富的外部服务生态。
