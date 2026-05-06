# mhclaw

> AI 桌面工作台 · Electron + React + TypeScript · 基于 [OpenClaw](https://www.openclaw.ai) Gateway

mhclaw 是一个产品级 AI 工作台桌面客户端。内置 OpenClaw Gateway 子进程提供 chat / agent / 工具调用能力，自带 **MCP broker（产品级 MCP 隔离层）** 解决坏 MCP 拖死整个 prep 阶段的问题，UI 对标腾讯 WorkBuddy 的产品体验。

[English](./README_EN.md) · 中文

---

## 核心特性

- **MCP broker 架构** —— 用户配置的所有 MCP server 由 mhclaw 自管，OpenClaw 只看到一个稳定的 broker。坏 MCP 不会拖慢 prep；upstream 故障时调用立即返回结构化错误，不阻塞，恢复后自动复用
- **stable catalog** —— 工具列表由 last-known-good schema 驱动，不随 health 抖动；恢复中的 upstream 工具立刻可调
- **多 LLM provider** —— 支持 OpenAI、智谱 GLM、DeepSeek 等通过 OpenAI-compatible 接口接入，本地配置
- **OpenClaw 生态** —— 直接享受 [OpenClaw](https://www.openclaw.ai) gateway 的能力：内置 skills、channel plugins（微信/企微/钉钉）、richer output protocol、cron、自动化工作流
- **本地优先** —— 所有用户配置（MCP / 模型 / 任务 / 会话）存在 `~/.mhclaw/`，可自由迁移
- **三栏布局** —— 左侧导航 + 中间会话 + 右侧产物 / 文件 / 变更 / 预览面板

## 快速开始

```bash
# 装依赖（必须用 pnpm + hoisted node-linker）
pnpm install

# 开发模式
pnpm run dev:electron

# 打包（macOS dmg + Windows nsis + Linux AppImage）
pnpm run build:electron
```

首次启动会进入登录页：

- **演示账号**：`admin` / `123456`（前端 mock，无需后端）
- **真后端**：在客户端 Settings 填 `mhclaw-api-url` 后，用真账号登录

mhclaw 客户端核心功能（chat、broker、MCP、SkillHub 浏览）**不需要后端**，演示登录后即可使用。后端集成（用户系统、SkillHub 上传、协作）需要 fork 用户自行实现一套 mhwork-api 兼容接口。

### 配置 LLM

启动后右上角用户菜单 → **模型配置**。支持任意 OpenAI-compatible endpoint：

```jsonc
// 例：智谱 GLM
{
  "providers": {
    "zhipu": {
      "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
      "apiKey": "...",
      "models": [{ "id": "glm-5-turbo", "name": "GLM-5 Turbo" }]
    }
  }
}
```

### 配置 MCP server

侧栏 **Skills → MCP** 进入管理界面。支持三种 transport：

- **stdio**（命令 + 参数，例如 `npx -y @modelcontextprotocol/server-filesystem ./workspace`）
- **streamable-http**（远程 URL + headers）
- **SSE**（远程 URL，等同 transport=sse）

配置后 broker 自动 probe 并写入 last-known-good，OpenClaw 看到的只有 broker 一条 entry，**所以 prep 阶段不被任何坏 MCP 拖慢**。

## 架构概览

```
┌─ mhclaw renderer (React) ─────────────────────────────┐
│  chat UI / settings / MCP manager / skills / files    │
└────────────┬──────────────────────────────────────────┘
             │ contextBridge IPC
┌────────────▼──────────────────────────────────────────┐
│  Electron main process                                │
│   ├─ GatewayManager  → 子进程 spawn OpenClaw Gateway   │
│   ├─ McpRegistry     → ~/.mhclaw/mcp-registry.json    │
│   ├─ McpSupervisor   → probe / 退避 / long-lived client│
│   └─ McpBroker       → streamable-http :40790/mcp     │
└────────────┬──────────────────────────────────────────┘
             │ WebSocket :40789
┌────────────▼──────────────────────────────────────────┐
│  OpenClaw Gateway (subprocess)                        │
│   只看到一条 mhclaw-mcp-broker (stable URL)            │
└────────────┬──────────────────────────────────────────┘
             │ MCP Streamable HTTP
             ▼
        mhclaw-mcp-broker
             │
             ├─→ upstream MCP server 1 (long-lived)
             ├─→ upstream MCP server 2
             └─→ upstream MCP server N
```

## 文档

详见 [docs/](./docs/) （TODO: 移植主要 ADR 到此）。

## License

[Apache License 2.0](./LICENSE) © clk1st

## 致谢

- [OpenClaw](https://www.openclaw.ai) —— 提供底层 gateway / agent runtime
- [Anthropic Model Context Protocol](https://modelcontextprotocol.io) —— MCP 标准协议
- [WorkBuddy](https://workbuddy.qq.com) —— 产品体验对标
