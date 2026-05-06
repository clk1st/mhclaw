# Internationalization status

mhclaw is being incrementally translated from Chinese to English. UI
strings stay in Chinese for now (matching the primary user base);
**code comments** are being moved to English so the repo is approachable
to international contributors.

## Translated (English comments)

- ✅ `electron/services/mcp-types.ts`
- ✅ `electron/services/mcp-transport.ts`
- ✅ `electron/services/mcp-registry.ts`
- ✅ `electron/services/mcp-supervisor.ts`
- ✅ `electron/services/mcp-broker.ts`
- ✅ `electron/services/mcp-probe.ts`
- ✅ `electron/constants.ts`
- ✅ `electron/gateway-manager.ts` (class doc)
- ✅ `src/lib/api.ts`
- ✅ `src/stores/auth-store.ts`
- ✅ `README.md` / `README_EN.md`
- ✅ `CONTRIBUTING.md`

## Pending

Core entry points (high priority):

- ⏳ `electron/main.ts` (inline comments throughout)
- ⏳ `electron/gateway-manager.ts` (inline comments inside methods)
- ⏳ `electron/preload.ts` (group doc comments)

Renderer (~50 files):

- ⏳ `src/components/**/*.tsx`
- ⏳ `src/hooks/*.ts`
- ⏳ `src/pages/*.tsx`
- ⏳ `src/stores/*.ts`
- ⏳ `src/lib/*.ts`

Other services:

- ⏳ `electron/services/agents-md.ts`
- ⏳ `electron/services/snapshot.ts`
- ⏳ `electron/services/file-watcher.ts`
- ⏳ `electron/services/artifacts.ts`
- ⏳ `electron/services/work-root.ts`
- ⏳ `electron/services/task-folder.ts`
- ⏳ ... and a few more

## Contributing translations

1. Pick a file from "Pending" above.
2. Translate the comments. Don't change code logic.
3. Run `pnpm typecheck && pnpm build` to verify nothing broke.
4. Open a PR with title `i18n(comments): translate <filename>`.

UI **strings** (visible Chinese text in the app) are out of scope for
this pass — those will be migrated to a proper i18n system later.
