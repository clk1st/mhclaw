/**
 * 任务目录文件监听。
 *
 * 调用 startWatching(taskPath, notify) 后,chokidar 监听 taskPath,
 * 文件 add/change/unlink 事件回调 notify。notify 一般是 mainWindow.webContents.send。
 *
 * 同一进程只维护一个 watcher(整个 app 只有一个当前任务),
 * 切换任务目录时,主动 stop 旧的再 start 新的。
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
 * 授权目录的 watcher 集合。跟 task watcher 并列:
 *  - task watcher 跟着当前任务走(切任务时重建)
 *  - authorized watchers 跟着白名单走(增删授权目录时 rebuild)
 *
 * 合流到同一个 notify 回调 —— 渲染进程收到事件后不关心来源,
 * 统一触发 availability re-probe / artifacts 刷新。
 *
 * 注意:我们是预览用途,不需要读文件内容。chokidar 只关心有没有 add/change/unlink,
 * 事件体里 rel 字段在"授权目录"场景下意义不大(授权根可以是深层目录),
 * 我们直接给绝对路径当 rel,消费侧按绝对路径识别。
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
 * 安装 authorized dirs 的 watcher。启动时调用一次,之后 authorized-dirs 变化时
 * 调 refreshAuthorizedWatchers() 重建。notify 回调跟 task watcher 用同一个,
 * 渲染进程拿到统一的 fileWatcher:event 广播,不关心来源。
 */
export function installAuthorizedWatchers(
  notify: (event: WatcherEvent) => void,
) {
  authorizedNotify = notify;
}

/** 根据当前授权目录列表,rebuild authorized watchers */
export async function refreshAuthorizedWatchers(dirs: string[]): Promise<void> {
  if (!authorizedNotify) return;
  const next = new Set(dirs);

  // 关掉已经不在列表里的 watcher
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

  // 新增的启动
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
        depth: 10, // authorized dir 可以很深,适度限制
      });
      const emit = (kind: WatcherEventKind) =>
        (abs: string, stats?: { size?: number; mtimeMs?: number }) => {
          // rel 直接用绝对路径 —— 对 authorized dir,UI 侧关心的是绝对路径
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
      console.warn(`[file-watcher] 无法监听授权目录 ${dir}:`, err);
    }
  }
}

/** 程序退出时清理(app will-quit 钩子调用) */
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
