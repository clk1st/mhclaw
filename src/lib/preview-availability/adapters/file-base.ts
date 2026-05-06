import type {
  PreviewAdapter,
  PreviewStatus,
  ProbeCtx,
  AvailabilityChangeCb,
} from "../types";

/**
 * 文件类 adapter 的公共基类 —— workspace / authorized / absolute-path 三种都通过
 * 同一个主进程 IPC(previewProbe:checkFile)查 fs 真相,只差"canHandle 怎么判"。
 *
 * 把 IPC 调用 + 4 态推导收在基类里,各具体 adapter 只管自己认不认这 URL。
 *
 * 订阅能力:通过 window.cjtClaw.fileWatcher.onEvent 订阅 chokidar 事件 ——
 * 任何目录的 add/change/unlink 都当作"可能变了"广播给所有 file 类 adapter 的订阅者。
 * 每个 adapter 实例做自己的 URL 匹配过滤(粗粒度广播 + 细粒度过滤,简单可靠)。
 */

// 跨 adapter 共享的 chokidar 订阅者集合
const fileWatchSubscribers = new Set<AvailabilityChangeCb>();
let fileWatcherInstalled = false;

function ensureFileWatcherBridge(): void {
  if (fileWatcherInstalled) return;
  const api = window.cjtClaw?.fileWatcher;
  if (!api) return;
  api.onEvent(() => {
    // 有任何文件事件就广播一次 —— hook 收到后 re-probe,
    // 因为探测成本很低(单次 fs.stat),粗粒度即可
    for (const cb of fileWatchSubscribers) {
      try {
        cb();
      } catch {
        // 单个订阅者 throw 不影响其他
      }
    }
  });
  fileWatcherInstalled = true;
}

/** 共享的 IPC probe 函数 —— 主进程返回 {exists, size, mtime, error} */
async function probeFileSystem(url: string): Promise<{
  exists: boolean;
  size?: number;
  mtime?: number;
  error?: string;
}> {
  const api = window.cjtClaw?.previewProbe;
  if (!api) {
    return { exists: false, error: "主进程 previewProbe 接口不可用" };
  }
  return api.checkFile({ url });
}

/**
 * 把 fs 层真相推导成 4 态:
 *  - fs 出错 / 文件被判定不合法 → error
 *  - 文件不存在 + run 还在跑 → pending(AI 可能还没调 write_file)
 *  - 文件不存在 + run 结束 → error("文件未生成")
 *  - 文件存在 + run 还在跑 + mtime 近 3s 内有变动 → generating(正在写)
 *  - 文件存在 + 其他 → ready
 */
export function deriveStatus(
  fs: { exists: boolean; size?: number; mtime?: number; error?: string },
  ctx: ProbeCtx,
): PreviewStatus {
  if (fs.error) {
    return { kind: "error", reason: fs.error };
  }
  if (!fs.exists) {
    if (ctx.runActive) return { kind: "pending" };
    return { kind: "error", reason: "文件未生成" };
  }
  // 存在。判断是不是还在被写入中
  const recentlyChanged =
    typeof fs.mtime === "number" && ctx.now - fs.mtime < 3000;
  if (ctx.runActive && recentlyChanged) {
    return { kind: "generating", since: fs.mtime ?? ctx.now };
  }
  return { kind: "ready", size: fs.size, mtime: fs.mtime };
}

/** 创建一个 file 类 adapter —— 外部只需提供 name + canHandle 逻辑 */
export function makeFileAdapter(
  name: string,
  canHandle: (url: string) => boolean,
): PreviewAdapter {
  return {
    name,
    canHandle,
    async probe(url, ctx) {
      const fs = await probeFileSystem(url);
      return deriveStatus(fs, ctx);
    },
    subscribe(_url, cb) {
      ensureFileWatcherBridge();
      fileWatchSubscribers.add(cb);
      return () => {
        fileWatchSubscribers.delete(cb);
      };
    },
  };
}
