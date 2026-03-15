import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Pydantic AI 源码解析',
  description: '类型安全的 Python AI Agent 框架——从 Agent 抽象到 MCP 集成深度剖析',
  lang: 'zh-CN',

  base: '/',

  head: [
    ['meta', { name: 'theme-color', content: '#e92063' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Pydantic AI 源码解析' }],
    ['meta', { property: 'og:description', content: '类型安全的 Python AI Agent 框架——从 Agent 抽象到 MCP 集成深度剖析' }],
  ],

  themeConfig: {
    logo: { src: '/logo.png', alt: 'Pydantic AI' },
    nav: [
      { text: '开始阅读', link: '/chapters/01-overview' },
      { text: '目录', link: '/contents' },
      { text: 'GitHub', link: 'https://github.com/coolclaws/pydantic-ai-book' },
    ],

    sidebar: [
      {
        text: '前言',
        items: [
          { text: '关于本书', link: '/' },
          { text: '完整目录', link: '/contents' },
        ],
      },
      {
        text: '第一部分：宏观认知',
        collapsed: false,
        items: [
          { text: '第 1 章　项目概览与设计哲学', link: '/chapters/01-overview' },
          { text: '第 2 章　Repo 结构与模块依赖', link: '/chapters/02-repo-structure' },
        ],
      },
      {
        text: '第二部分：Agent 核心',
        collapsed: false,
        items: [
          { text: '第 3 章　Agent 类的构造与生命周期', link: '/chapters/03-agent-construction' },
          { text: '第 4 章　运行模式', link: '/chapters/04-run-modes' },
          { text: '第 5 章　结果类型系统', link: '/chapters/05-result-types' },
          { text: '第 6 章　依赖注入', link: '/chapters/06-dependency-injection' },
        ],
      },
      {
        text: '第三部分：模型抽象层',
        collapsed: false,
        items: [
          { text: '第 7 章　Model 接口设计', link: '/chapters/07-model-interface' },
          { text: '第 8 章　多模型支持', link: '/chapters/08-multi-model' },
          { text: '第 9 章　ModelSettings 与请求参数', link: '/chapters/09-model-settings' },
        ],
      },
      {
        text: '第四部分：工具系统',
        collapsed: false,
        items: [
          { text: '第 10 章　Tool 抽象与注册', link: '/chapters/10-tool-abstraction' },
          { text: '第 11 章　工具执行引擎', link: '/chapters/11-tool-execution' },
          { text: '第 12 章　结构化输出与验证', link: '/chapters/12-structured-output' },
        ],
      },
      {
        text: '第五部分：消息与历史',
        collapsed: false,
        items: [
          { text: '第 13 章　消息类型体系', link: '/chapters/13-message-types' },
          { text: '第 14 章　对话历史管理', link: '/chapters/14-conversation-history' },
        ],
      },
      {
        text: '第六部分：MCP 与生态',
        collapsed: false,
        items: [
          { text: '第 15 章　MCP 客户端集成', link: '/chapters/15-mcp-integration' },
          { text: '第 16 章　流式输出', link: '/chapters/16-streaming' },
        ],
      },
      {
        text: '第七部分：可观测性',
        collapsed: false,
        items: [
          { text: '第 17 章　Logfire 集成', link: '/chapters/17-logfire' },
          { text: '第 18 章　测试与 Mock', link: '/chapters/18-testing' },
        ],
      },
      {
        text: '附录',
        collapsed: true,
        items: [
          { text: '附录 A：推荐阅读路径', link: '/chapters/appendix-a-reading-path' },
          { text: '附录 B：核心类型速查', link: '/chapters/appendix-b-type-reference' },
          { text: '附录 C：名词解释（Glossary）', link: '/chapters/appendix-c-glossary' },
        ],
      },
    ],

    outline: {
      level: [2, 3],
      label: '本页目录',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/coolclaws/pydantic-ai-book' },
    ],

    footer: {
      message: '基于 MIT 协议发布',
      copyright: 'Copyright © 2025-present',
    },

    search: {
      provider: 'local',
    },
  },

  markdown: {
    lineNumbers: true,
  },
})
