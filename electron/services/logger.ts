/**
 * 主进程文件日志 —— 写到 ~/.mhclaw/logs/mhclaw_main.log
 *
 * 为什么需要:packaged 模式下 Electron 主进程的 console 输出直接丢(Finder
 * 启动没附 stdout/stderr),用户碰到 mcp-probe / IPC handler / fetch 等错误
 * 时根本看不到任何痕迹,只能"截图发我"。Gateway 子进程已有 gateway.log,
 * 主进程也该有对称的可查日志。
 *
 * 设计:
 *  1. patch 全局 console.{log,info,warn,error},既写文件又保留原行为
 *     (dev 模式 terminal 能看到,packaged 模式只有文件可查)
 *  2. 简单 rotate:单文件超 5MB 滚到 .1,逐级到 .4,共 ~25MB 上限
 *  3. uncaughtException / unhandledRejection 兜底也写日志,免得主进程崩了
 *     连最后一句死亡日志都丢
 *
 * 不引入第三方依赖(electron-log 25MB+,我们用不到那些 feature)。
 */
import fs from "node:fs";
import path from "node:path";
import { getStateDir } from "../constants.js";

const LOG_FILE = path.join(getStateDir(), "logs", "mhclaw_main.log");
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_BACKUPS = 4; // mhclaw_main.log + .1 .. .4

let stream: fs.WriteStream | null = null;
let installed = false;

const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function ensureDir() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}

function rotate(): void {
  let size = 0;
  try {
    size = fs.statSync(LOG_FILE).size;
  } catch {
    return; // 文件不存在,不用 rotate
  }
  if (size < MAX_BYTES) return;
  if (stream) {
    try {
      stream.end();
    } catch {
      /* noop */
    }
    stream = null;
  }
  // .3 → .4, .2 → .3, .1 → .2, log → .1
  for (let i = MAX_BACKUPS; i >= 1; i--) {
    const from = i === 1 ? LOG_FILE : `${LOG_FILE}.${i - 1}`;
    const to = `${LOG_FILE}.${i}`;
    try {
      if (i === MAX_BACKUPS) {
        try {
          fs.unlinkSync(to);
        } catch {
          /* 不存在就跳过 */
        }
      }
      fs.renameSync(from, to);
    } catch {
      /* 跳过不存在的 */
    }
  }
}

function getStream(): fs.WriteStream | null {
  if (stream) return stream;
  try {
    ensureDir();
    rotate();
    stream = fs.createWriteStream(LOG_FILE, { flags: "a" });
    return stream;
  } catch (err) {
    // 写日志失败不能影响主进程,降级到 console
    originalConsole.error("[logger] failed to open log stream:", err);
    return null;
  }
}

function formatLine(level: string, args: unknown[]): string {
  const ts = new Date().toISOString();
  const parts: string[] = [];
  for (const a of args) {
    if (a instanceof Error) {
      parts.push(a.stack ?? `${a.name}: ${a.message}`);
    } else if (typeof a === "object" && a !== null) {
      try {
        parts.push(JSON.stringify(a));
      } catch {
        parts.push(String(a));
      }
    } else {
      parts.push(String(a));
    }
  }
  return `${ts} [${level}] ${parts.join(" ")}\n`;
}

function writeToFile(level: string, args: unknown[]): void {
  const s = getStream();
  if (!s) return;
  try {
    s.write(formatLine(level, args));
  } catch (err) {
    originalConsole.error("[logger] write failed:", err);
  }
}

let writesSinceCheck = 0;
function checkRotate() {
  writesSinceCheck++;
  if (writesSinceCheck < 50) return;
  writesSinceCheck = 0;
  // 异步检查文件大小,避免每次 write 都 statSync
  fs.stat(LOG_FILE, (err, stat) => {
    if (err || !stat) return;
    if (stat.size >= MAX_BYTES) {
      // 触发同步 rotate,下次 getStream() 会自动 reopen
      if (stream) {
        try {
          stream.end();
        } catch {
          /* noop */
        }
        stream = null;
      }
      rotate();
    }
  });
}

export function setupMainLogger(): void {
  if (installed) return;
  installed = true;

  console.log = (...args: unknown[]) => {
    originalConsole.log(...args);
    writeToFile("log", args);
    checkRotate();
  };
  console.info = (...args: unknown[]) => {
    originalConsole.info(...args);
    writeToFile("info", args);
    checkRotate();
  };
  console.warn = (...args: unknown[]) => {
    originalConsole.warn(...args);
    writeToFile("warn", args);
    checkRotate();
  };
  console.error = (...args: unknown[]) => {
    originalConsole.error(...args);
    writeToFile("error", args);
    checkRotate();
  };

  // 主进程崩溃兜底
  process.on("uncaughtException", (err) => {
    writeToFile("uncaughtException", [err]);
    originalConsole.error("[uncaughtException]", err);
  });
  process.on("unhandledRejection", (reason) => {
    writeToFile("unhandledRejection", [reason]);
    originalConsole.error("[unhandledRejection]", reason);
  });

  writeToFile("info", [
    "===== mhclaw main process started =====",
    `pid=${process.pid}`,
    `version=${process.versions.electron ?? "unknown"}`,
    `platform=${process.platform}`,
  ]);
}
