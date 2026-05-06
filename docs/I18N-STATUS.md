# Internationalization status

mhclaw is being incrementally translated from Chinese to English.
**UI strings stay in Chinese for now** (matching the primary user
base); the focus of this i18n pass is **code comments**, so the repo
is approachable to international contributors.

## Translated (English comments)

### Electron main process

- ✅ `electron/main.ts`
- ✅ `electron/gateway-manager.ts`
- ✅ `electron/preload.ts`
- ✅ `electron/constants.ts`
- ✅ `electron/fix-path.ts`
- ✅ `electron/services/mcp-types.ts`
- ✅ `electron/services/mcp-transport.ts`
- ✅ `electron/services/mcp-registry.ts`
- ✅ `electron/services/mcp-supervisor.ts`
- ✅ `electron/services/mcp-broker.ts`
- ✅ `electron/services/mcp-probe.ts`
- ✅ `electron/services/agents-md.ts` (header doc; the runtime
  AGENTS.md contribution string remains in Chinese intentionally —
  it's read by the AI agent, not the developer)
- ✅ `electron/services/artifacts.ts`
- ✅ `electron/services/authorized-dirs.ts`
- ✅ `electron/services/file-watcher.ts`
- ✅ `electron/services/fs-tree.ts`
- ✅ `electron/services/logger.ts`
- ✅ `electron/services/preview-probe.ts`
- ✅ `electron/services/protocols.ts`
- ✅ `electron/services/snapshot.ts`
- ✅ `electron/services/task-folder.ts`
- ✅ `electron/services/work-root.ts`

### Renderer

- ✅ `src/lib/api.ts`
- ✅ `src/stores/auth-store.ts`
- ✅ `src/hooks/use-skills.ts`
- ✅ `src/hooks/use-mcp-servers.ts`
- ✅ `src/components/chat/MessageList.tsx`
- ✅ `src/components/layout/Sidebar.tsx`
- ✅ `src/pages/HomePage.tsx`

### Top-level docs

- ✅ `README.md` / `README_EN.md`
- ✅ `CONTRIBUTING.md`
- ✅ `LICENSE`

## Pending (comments only — UI strings remain Chinese)

Stores:

- ⏳ `src/stores/chat-store.ts` — large (1400+ LoC); deferred to a
  dedicated commit so reviews stay focused
- ⏳ `src/stores/setup-store.ts`
- ⏳ `src/stores/preview-store.ts`
- ⏳ `src/stores/gateway-store.ts`
- ⏳ `src/stores/archive-store.ts`
- ⏳ `src/stores/ui-store.ts`

Hooks:

- ⏳ `src/hooks/use-channels.ts`
- ⏳ `src/hooks/use-crons.ts`
- ⏳ `src/hooks/use-models.ts`
- ⏳ `src/hooks/use-sessions.ts`
- ⏳ `src/hooks/use-skillhub.ts`
- ⏳ `src/hooks/use-cron-history.ts`

Components / pages — most are minor inline notes; UI strings stay in
Chinese until a proper i18n system lands. See `git log` for the
incremental translation commits.

## Contributing translations

1. Pick a file from "Pending" above.
2. Translate the comments. Don't change code logic.
3. Run `pnpm typecheck && pnpm build` to verify nothing broke.
4. Open a PR titled `i18n(comments): translate <filename>`.

UI **strings** (visible Chinese text in the app) are out of scope for
this pass — those will be migrated to a proper i18n system later. The
demo login labels, toast messages, dialog titles, etc. all remain in
Chinese for now.
