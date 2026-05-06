/**
 * Main-process file logger — writes to ~/.mhclaw/logs/mhclaw_main.log.
 *
 * Why this exists: in packaged builds the Electron main process's
 * console output is discarded (a Finder launch has no stdout/stderr
 * attached). When users hit errors in mcp-probe / IPC handlers /
 * fetch, there's literally no trace — they end up taking screenshots.
 * The Gateway subprocess already has gateway.log; the main process
 * needs a symmetric, inspectable log.
 *
 * Design:
 *   1. Patch the global `console.{log,info,warn,error}` so each call
 *      both writes to the file AND keeps original behavior (terminal
 *      visible in dev; only the file matters in packaged mode).
 *   2. Simple rotation: when the file passes 5MB, roll to `.1`, etc.
 *      up to `.4` — capping at ~25MB total.
 *   3. Capture `uncaughtException` / `unhandledRejection` too, so a
 *      dying process doesn't lose its last log line.
 *
 * No third-party dependency (electron-log is 25MB+ and we don't need
 * those features).
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
    return; // file doesn't exist — nothing to rotate
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
          /* skip if missing */
        }
      }
      fs.renameSync(from, to);
    } catch {
      /* skip missing source files */
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
    // Failure to open the log file must not crash the main process;
    // fall back to the original console.
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
  // Async size check — avoids a statSync on every write.
  fs.stat(LOG_FILE, (err, stat) => {
    if (err || !stat) return;
    if (stat.size >= MAX_BYTES) {
      // Trigger a synchronous rotate; next getStream() will reopen.
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

  // Last-resort capture for a dying process.
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
