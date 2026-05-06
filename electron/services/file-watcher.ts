/**
 * Task-folder file watcher.
 *
 * Call `startWatching(taskPath, notify)` and chokidar will watch
 * `taskPath`. File add/change/unlink events fire `notify`, which is
 * usually `mainWindow.webContents.send`.
 *
 * The process keeps a single watcher (the app only ever has one active
 * task). When switching tasks, stop the old watcher first, then start
 * a new one.
 */
import path from "node:path";
import chokidar, { FSWatcher } from "chokidar";

export type WatcherEventKind = "add" | "change" | "unlink";

export interface WatcherEvent {
  taskPath: string;
  kind: WatcherEventKind;
  rel: string;
  mtime?: number;
  size?: number;
}

const IGNORED_GLOBS = [
  /(^|[\\/])\.mhclaw([\\/]|$)/,
  /(^|[\\/])\.git([\\/]|$)/,
  /(^|[\\/])node_modules([\\/]|$)/,
  /(^|[\\/])\.DS_Store$/,
  /(^|[\\/])__pycache__([\\/]|$)/,
  /(^|[\\/])\.venv([\\/]|$)/,
];

let current: { taskPath: string; watcher: FSWatcher } | null = null;

/**
 * Authorized-directory watchers. Run alongside the task watcher:
 *   - the task watcher follows the active task (rebuilt on switch)
 *   - authorized watchers follow the whitelist (rebuilt on add/remove)
 *
 * Both feed into the same `notify` callback — the renderer doesn't
 * care which watcher fired and just triggers an availability re-probe
 * / artifacts refresh either way.
 *
 * NOTE: this is for preview purposes only — we never read file
 * contents. chokidar only tells us whether `add` / `change` / `unlink`
 * happened. The `rel` field is awkward for authorized dirs (the
 * authorized root can be deeply nested), so we ship the absolute path
 * as `rel` for those and let the consumer key off the absolute path.
 */
let authorizedWatchers = new Map<string, FSWatcher>();
let authorizedNotify: ((event: WatcherEvent) => void) | null = null;

export function getWatchedTaskPath(): string | null {
  return current?.taskPath ?? null;
}

export async function stopWatching() {
  if (!current) return;
  const { watcher } = current;
  current = null;
  try {
    await watcher.close();
  } catch {
    // ignore
  }
}

export async function startWatching(
  taskPath: string,
  notify: (event: WatcherEvent) => void,
): Promise<void> {
  if (current?.taskPath === taskPath) return;
  await stopWatching();

  const watcher = chokidar.watch(taskPath, {
    ignored: (p: string) => IGNORED_GLOBS.some((r) => r.test(p)),
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 150,
      pollInterval: 50,
    },
    depth: 20,
  });

  const emit = (kind: WatcherEventKind) => (abs: string, stats?: { size?: number; mtimeMs?: number }) => {
    const rel = path.relative(taskPath, abs).split(path.sep).join("/");
    if (!rel || rel.startsWith("..")) return;
    notify({
      taskPath,
      kind,
      rel,
      size: stats?.size,
      mtime: stats?.mtimeMs ? Math.floor(stats.mtimeMs) : undefined,
    });
  };

  watcher.on("add", emit("add"));
  watcher.on("change", emit("change"));
  watcher.on("unlink", emit("unlink"));
  watcher.on("error", (err) => console.warn("[file-watcher]", err));

  current = { taskPath, watcher };
}

/**
 * Install the authorized-dirs watcher. Call once at startup; later
 * changes to authorized-dirs trigger `refreshAuthorizedWatchers()` to
 * rebuild. The `notify` callback is shared with the task watcher so
 * the renderer receives a single unified `fileWatcher:event` stream.
 */
export function installAuthorizedWatchers(
  notify: (event: WatcherEvent) => void,
) {
  authorizedNotify = notify;
}

/** Rebuild authorized-dir watchers from the current dir list. */
export async function refreshAuthorizedWatchers(dirs: string[]): Promise<void> {
  if (!authorizedNotify) return;
  const next = new Set(dirs);

  // Close watchers no longer in the list.
  for (const [dir, watcher] of authorizedWatchers) {
    if (!next.has(dir)) {
      try {
        await watcher.close();
      } catch {
        // ignore
      }
      authorizedWatchers.delete(dir);
    }
  }

  // Start watchers for newly-added dirs.
  for (const dir of next) {
    if (authorizedWatchers.has(dir)) continue;
    try {
      const watcher = chokidar.watch(dir, {
        ignored: (p: string) => IGNORED_GLOBS.some((r) => r.test(p)),
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 150,
          pollInterval: 50,
        },
        depth: 10, // authorized dirs can be deep — keep this bounded
      });
      const emit = (kind: WatcherEventKind) =>
        (abs: string, stats?: { size?: number; mtimeMs?: number }) => {
          // For authorized dirs, the renderer keys on absolute path —
          // ship `abs` as `rel` directly.
          authorizedNotify?.({
            taskPath: dir,
            kind,
            rel: abs,
            size: stats?.size,
            mtime: stats?.mtimeMs ? Math.floor(stats.mtimeMs) : undefined,
          });
        };
      watcher.on("add", emit("add"));
      watcher.on("change", emit("change"));
      watcher.on("unlink", emit("unlink"));
      watcher.on("error", (err) =>
        console.warn(`[file-watcher:authorized ${dir}]`, err),
      );
      authorizedWatchers.set(dir, watcher);
    } catch (err) {
      console.warn(`[file-watcher] failed to watch authorized dir ${dir}:`, err);
    }
  }
}

/** Cleanup hook (called on `app.will-quit`). */
export async function closeAllAuthorizedWatchers(): Promise<void> {
  for (const [, watcher] of authorizedWatchers) {
    try {
      await watcher.close();
    } catch {
      // ignore
    }
  }
  authorizedWatchers.clear();
}
