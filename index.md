---
layout: home

hero:
  name: "Pydantic AI 源码解析"
  text: "类型安全的 Python AI Agent 框架"
  tagline: 从 Agent 抽象到 MCP 集成，全面解读 Pydantic AI 的架构设计与实现细节
  actions:
    - theme: brand
      text: 开始阅读
      link: /chapters/01-overview
    - theme: alt
      text: 查看目录
      link: /contents
    - theme: alt
      text: GitHub
      link: https://github.com/coolclaws/pydantic-ai-book

features:
  - icon:
      src: /icons/agent.svg
    title: Agent 核心架构
    details: 深入 Agent 类的构造与生命周期，解析 run/run_sync/run_stream 三种运行模式、依赖注入系统与结果类型推导的完整实现。

  - icon:
      src: /icons/model.svg
    title: 模型抽象层
    details: 剖析 Model 协议与多模型适配器设计，覆盖 OpenAI、Anthropic、Gemini、Groq 等模型的统一接口与参数处理。

  - icon:
      src: /icons/tool.svg
    title: 工具与结构化输出
    details: 解读 @agent.tool 装饰器、schema 自动生成、工具执行引擎，以及基于 Pydantic v2 的结构化输出验证机制。

  - icon:
      src: /icons/mcp.svg
    title: MCP 集成与可观测性
    details: 覆盖 MCP 客户端集成、流式输出处理、Logfire 追踪与 TestModel/FunctionModel 测试体系。
---
