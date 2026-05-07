/**
 * Task folder service.
 *
 * A task folder is the per-session output directory bound to one chat
 * session. The on-disk layout (modeled after WorkBuddy's `.workbuddy/`):
 *
 *   <task-folder>/
 *   ├── .mhclaw/
 *   │   ├── task.json          task metadata
 *   │   └── memory/
 *   │       └── MEMORY.md      task-level memory skeleton
 *   │                          (written to by OpenClaw memory hook)
 *   └── ...                    AI-produced files (HTML / Excel / PDF / images / etc.)
 *
 * Three entry points:
 *   - createBlankTask()         → create <YYYYMMDDHHMMSS>/ + .mhclaw/ under the work root
 *   - bindExternalFolder(abs)   → ensure .mhclaw/ structure on a pre-existing dir
 *   - readTask / writeTask      → operate on .mhclaw/task.json
 *
 * The session ↔ task binding lives separately in `session-task.json`
 * (system-wide).
 */
import fs from "node:fs";
import path from "node:path";
import { getStateDir } from "../constants.js";
import {
  ensureWorkRoot,
  upsertOutputDir,
  type OutputDirEntry,
} from "./work-root.js";

const SESSION_TASK_MAP = "session-task.json";

export interface TaskMeta {
  /** Task ID (timestamp or UUID). */
  id: string;
  /** Bound sessionKey (OpenClaw's). */
  sessionKey: string;
  /** User-visible title (defaulted from the first message). */
  title: string;
  createdAt: number;
  lastActiveAt: number;
  /** mhclaw version (cross-version safety net). */
  mhclawVersion: string;
}

const MHWORK_SUB = ".mhclaw";
const TASK_JSON = "task.json";
const MEMORY_DIR = "memory";
const MEMORY_MD = "MEMORY.md";

const MHWORK_VERSION = "0.1.0";

function timestampName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

/** Make sure `.mhclaw/` is fully scaffolded under the task dir (idempotent). */
export function ensureTaskMetadata(taskPath: string, init?: Partial<TaskMeta>): TaskMeta {
  const mhclawDir = path.join(taskPath, MHWORK_SUB);
  if (!fs.existsSync(mhclawDir)) fs.mkdirSync(mhclawDir, { recursive: true });

  const memDir = path.join(mhclawDir, MEMORY_DIR);
  if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });

  const memFile = path.join(memDir, MEMORY_MD);
  if (!fs.existsSync(memFile)) fs.writeFileSync(memFile, "");

  const taskJsonPath = path.join(mhclawDir, TASK_JSON);
  if (fs.existsSync(taskJsonPath)) {
    // Already exists → read and merge in any newly-introduced fields.
    try {
      const existing = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8")) as TaskMeta;
      const merged: TaskMeta = {
        ...existing,
        lastActiveAt: Date.now(),
      };
      fs.writeFileSync(taskJsonPath, JSON.stringify(merged, null, 2));
      return merged;
    } catch {
      // Corrupted — rebuild below.
    }
  }

  const now = Date.now();
  const meta: TaskMeta = {
    id: init?.id ?? timestampName(),
    sessionKey: init?.sessionKey ?? "",
    title: init?.title ?? "",
    createdAt: init?.createdAt ?? now,
    lastActiveAt: now,
    mhclawVersion: MHWORK_VERSION,
  };
  fs.writeFileSync(taskJsonPath, JSON.stringify(meta, null, 2));
  return meta;
}

/** Read task metadata (.mhclaw/task.json); returns null when absent. */
export function readTaskMeta(taskPath: string): TaskMeta | null {
  const taskJsonPath = path.join(taskPath, MHWORK_SUB, TASK_JSON);
  if (!fs.existsSync(taskJsonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(taskJsonPath, "utf-8")) as TaskMeta;
  } catch {
    return null;
  }
}

export function writeTaskMeta(taskPath: string, meta: TaskMeta): void {
  const taskJsonPath = path.join(taskPath, MHWORK_SUB, TASK_JSON);
  fs.writeFileSync(taskJsonPath, JSON.stringify(meta, null, 2));
}

/** Create a fresh empty task directory under the work root and return its path. */
export function createBlankTask(
  init?: Partial<TaskMeta>,
): { path: string; entry: OutputDirEntry; meta: TaskMeta } {
  const root = ensureWorkRoot();
  const name = timestampName();
  const taskPath = path.join(root.path, name);
  fs.mkdirSync(taskPath, { recursive: true });
  const meta = ensureTaskMetadata(taskPath, { id: name, ...init });
  const entry = upsertOutputDir({
    path: taskPath,
    displayName: name,
    kind: "blank",
    createdAt: meta.createdAt,
  });
  return { path: taskPath, entry, meta };
}

/** Bind an existing external directory: ensure `.mhclaw/` + add to the index. */
export function bindExternalFolder(
  absPath: string,
  init?: Partial<TaskMeta>,
): { path: string; entry: OutputDirEntry; meta: TaskMeta } {
  if (!fs.existsSync(absPath)) {
    throw new Error(`Directory does not exist: ${absPath}`);
  }
  const stat = fs.statSync(absPath);
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${absPath}`);

  const meta = ensureTaskMetadata(absPath, init);
  const entry = upsertOutputDir({
    path: absPath,
    displayName: path.basename(absPath),
    kind: "external",
    createdAt: meta.createdAt,
  });
  return { path: absPath, entry, meta };
}

// ============================================================
// session ↔ task binding (system-wide)
// ============================================================

function sessionTaskMapPath(): string {
  return path.join(getStateDir(), SESSION_TASK_MAP);
}

function loadSessionTaskMap(): Record<string, string> {
  const p = sessionTaskMapPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function saveSessionTaskMap(m: Record<string, string>) {
  fs.writeFileSync(sessionTaskMapPath(), JSON.stringify(m, null, 2));
}

/** Bind a session to a task directory (idempotent). */
export function bindSessionToFolder(sessionKey: string, taskPath: string): void {
  if (!sessionKey || !taskPath) return;
  const map = loadSessionTaskMap();
  map[sessionKey] = taskPath;

  // OpenClaw 5.4 hardcodes the agent default mainSessionKey as
  // `agent:<agentId>:main`. The LLM agent uses this key when emitting
  // [embed url=...://fs/<sessionKey>/<file>] URLs — but mhclaw's own
  // chat sessionKey is `agent:<id>:session-<ts>`. Without binding the
  // alias, protocol.handle / preview-probe receive `agent:main:main`
  // and fail to resolve a task folder, so the chat shows "preview
  // failed" even though the file exists.
  //
  // Bind the alias to the same taskPath. In multi-chat scenarios the
  // alias is overwritten by the most recent bind — best-effort, but
  // strictly better than every preview failing.
  const aliasMatch = /^agent:([^:]+):session-/.exec(sessionKey);
  if (aliasMatch) {
    map[`agent:${aliasMatch[1]}:main`] = taskPath;
  }

  saveSessionTaskMap(map);

  // Mirror onto task.json.sessionKey.
  const meta = readTaskMeta(taskPath);
  if (meta) {
    meta.sessionKey = sessionKey;
    meta.lastActiveAt = Date.now();
    writeTaskMeta(taskPath, meta);
  }

  // Refresh lastUsedAt on the index entry.
  upsertOutputDir({ path: taskPath });
}

/**
 * Migrate a session-task mapping from `oldKey` to `newKey`.
 *
 * Triggered when the client originally sends sessionKey like
 * `session-123`, but the Gateway normalizes it to
 * `agent:main:session-123` and reflects that back via events /
 * sessions.list. The first time the canonical key is observed,
 * chat-store calls this IPC so the on-disk map catches up — otherwise
 * `getFolderForSession(newKey)` would miss.
 */
export function remapSessionKey(oldKey: string, newKey: string): void {
  if (!oldKey || !newKey || oldKey === newKey) return;
  const map = loadSessionTaskMap();
  const taskPath = map[oldKey];
  if (!taskPath) return;
  // If newKey is already mapped, leave it alone — conservative: never
  // clobber an existing session binding.
  if (map[newKey]) return;
  map[newKey] = taskPath;
  delete map[oldKey];
  saveSessionTaskMap(map);

  // Sync the mirrored sessionKey on task.json.
  const meta = readTaskMeta(taskPath);
  if (meta) {
    meta.sessionKey = newKey;
    meta.lastActiveAt = Date.now();
    writeTaskMeta(taskPath, meta);
  }
}

/** Look up the task directory bound to a session; null if unbound. */
export function getFolderForSession(sessionKey: string): string | null {
  if (!sessionKey) return null;
  const map = loadSessionTaskMap();
  const p = map[sessionKey];
  if (!p) return null;
  if (!fs.existsSync(p)) {
    // Directory was deleted — clean up the stale mapping.
    delete map[sessionKey];
    saveSessionTaskMap(map);
    return null;
  }
  return p;
}
