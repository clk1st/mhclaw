# Contributing

欢迎贡献 mhclaw。这是一个产品级 AI 桌面工作台开源项目。

## 开发环境

- Node.js >= 22
- pnpm >= 10（必须用 pnpm，因为 lockfile 与 `node-linker=hoisted` 配置 OpenClaw 4.x 打包产物所必需）
- macOS / Windows / Linux

```bash
git clone https://github.com/clk1st/mhclaw.git
cd mhclaw
pnpm install
pnpm run dev:electron
```

## 提 PR 之前

1. **typecheck 必须过**：`pnpm run typecheck`
2. **build 不能崩**：`pnpm run build`
3. 如果改了 Electron 主进程 / preload，跑一次 `pnpm run dev:electron` 手动验证
4. 如果改了 broker / supervisor / registry，跑一遍端到端：配几个 MCP，故意配一个坏的，确认 chat 不被拖慢

## 代码风格

- TypeScript strict 模式
- 中文 UI 文案 + 中文注释（项目主要用户在中文圈）
- React 组件用 Tailwind CSS v4 + shadcn/ui（组件代码本地拥有于 `src/components/ui/`）
- RPC 全部经 TanStack Query，不要手撸 useEffect + fetch
- Zustand store 按功能域拆分

## 提交信息规范

[Conventional Commits](https://www.conventionalcommits.org)：

- `feat(scope): 描述` —— 新功能
- `fix(scope): 描述` —— bug 修复
- `chore(scope): 描述` —— 构建 / 配置 / 工具变更
- `docs(scope): 描述` —— 文档
- `refactor(scope): 描述` —— 重构（无功能变更）

中文描述 OK，类型前缀必须英文。

## 报告问题

- bug：贴最小复现步骤 + `~/.mhclaw/logs/gateway.log` 相关段落 + 系统 / mhclaw / openclaw 版本号
- 功能请求：先开 issue 描述场景与期望，对齐方向后再提 PR

## License

提交即视为同意你的贡献按 [Apache License 2.0](./LICENSE) 发布。
