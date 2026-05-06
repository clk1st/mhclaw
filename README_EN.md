# mhclaw

> AI Desktop Workbench · Electron + React + TypeScript · Built on [OpenClaw](https://www.openclaw.ai) Gateway

mhclaw is a production-grade AI workbench desktop client. It embeds an OpenClaw Gateway subprocess for chat / agent / tool-call capabilities and ships a **first-class MCP broker** that solves the well-known problem of one bad MCP dragging down the entire prep stage. The product UX is benchmarked against Tencent WorkBuddy.

[中文](./README.md) · English

---

## Highlights

- **MCP broker architecture** — All user-configured MCP servers are managed by mhclaw itself; OpenClaw only sees a single stable broker. A bad MCP can no longer slow down `prep`. When an upstream is unavailable, calls return a structured error immediately (no blocking); when it recovers, calls reuse the existing connection
- **Stable catalog** — The exposed tool list is driven by the last-known-good schema, not by current health. A recovering upstream's tools become callable immediately without restarting
- **Multi-LLM provider** — Plug in OpenAI, Zhipu GLM, DeepSeek, etc. via OpenAI-compatible APIs, configured locally
- **OpenClaw ecosystem** — Inherit gateway capabilities directly: built-in skills, channel plugins (WeChat / WeCom / DingTalk), Rich Output Protocol, cron, automation flows
- **Local-first** — All user state (MCP / models / tasks / sessions) lives in `~/.mhclaw/` and is freely portable
- **Three-pane layout** — Sidebar nav · main chat · right panel for artifacts / files / changes / preview

## Quick start

```bash
# Install (must use pnpm with hoisted node-linker;
# OpenClaw 4.x bundled artifacts depend on flat node_modules)
pnpm install

# Dev (auto-opens DevTools, HMR for renderer + main)
pnpm run dev:electron

# Production build (macOS dmg + Windows nsis + Linux AppImage)
pnpm run build:electron
```

On first launch you land on the login page:

- **Demo account**: `admin` / `123456` (front-end mock — no backend required)
- **Real backend**: configure `mhclaw-api-url` in client Settings and log in with real credentials

The core features (chat, broker, MCP, SkillHub browsing) **do not require a backend**. The demo login lets you use the entire client immediately. Backend-bound features (user system, SkillHub upload, collaboration) require you to run a backend that implements the mhwork-api contract.

### Configure an LLM

After login, top-right user menu → **Model Settings**. Any OpenAI-compatible endpoint works:

```jsonc
// Example: Zhipu GLM
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

### Configure MCP servers

Sidebar → **Skills → MCP**. Three transports supported:

- **stdio** (command + args, e.g. `npx -y @modelcontextprotocol/server-filesystem ./workspace`)
- **streamable-http** (remote URL + headers)
- **SSE** (remote URL with `transport=sse`)

Once configured, the broker auto-probes them and writes a last-known-good cache. OpenClaw only ever sees one entry — the broker — so **prep never gets dragged down by a misbehaving MCP**.

## Architecture

```
┌─ mhclaw renderer (React) ─────────────────────────────┐
│  chat UI / settings / MCP manager / skills / files    │
└────────────┬──────────────────────────────────────────┘
             │ contextBridge IPC
┌────────────▼──────────────────────────────────────────┐
│  Electron main process                                │
│   ├─ GatewayManager  → spawns OpenClaw Gateway        │
│   ├─ McpRegistry     → ~/.mhclaw/mcp-registry.json    │
│   ├─ McpSupervisor   → probe / backoff / long-lived   │
│   └─ McpBroker       → streamable-http :40790/mcp     │
└────────────┬──────────────────────────────────────────┘
             │ WebSocket :40789
┌────────────▼──────────────────────────────────────────┐
│  OpenClaw Gateway (subprocess)                        │
│   sees ONLY one entry: mhclaw-mcp-broker              │
└────────────┬──────────────────────────────────────────┘
             │ MCP Streamable HTTP
             ▼
        mhclaw-mcp-broker
             │
             ├─→ upstream MCP server 1 (long-lived)
             ├─→ upstream MCP server 2
             └─→ upstream MCP server N
```

## Docs

See [docs/](./docs/) (TODO: porting key ADRs here).

## License

[Apache License 2.0](./LICENSE) © clk1st

## Acknowledgements

- [OpenClaw](https://www.openclaw.ai) — provides the underlying gateway and agent runtime
- [Anthropic Model Context Protocol](https://modelcontextprotocol.io) — MCP standard
