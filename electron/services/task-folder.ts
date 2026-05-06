/**
 * 任务目录(Task Folder)服务。
 *
 * 任务目录 = 每个任务(session)绑定的产出文件夹。
 * 结构(对标 WorkBuddy 的 .workbuddy/):
 *
 *   <task-folder>/
 *   ├── .mhclaw/
 *   │   ├── task.json          任务元数据
 *   │   └── memory/
 *   │       └── MEMORY.md      任务级记忆骨架(OpenClaw memory hook 写入)
 *   └── ...                    AI 产出的文件(HTML / Excel / PDF / 图...)
 *
 * 三个入口:
 * - createBlankTask(): 在工作根下建 <YYYYMMDDHHMMSS>/ + .mhclaw/
 * - bindExternalFolder(absPath): 外部已有目录 → ensure .mhclaw/ 结构
 * - readTask(path) / writeTask(path, data): 操作 .mhclaw/task.json
 *
 * session ↔ task 的绑定关系单独存在 session-task.json(系统级)。
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
  /** 任务 ID(用时间戳或 UUID) */
  id: string;
  /** 绑定的 sessionKey(OpenClaw 的) */
  sessionKey: string;
  /** 用户可见标题(默认从首条消息来) */
  title: string;
  createdAt: number;
  lastActiveAt: number;
  /** mhclaw 版本(跨版本兼容兜底) */
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

/** 确保任务目录下的 .mhclaw/ 结构完整(幂等,已有则不动) */
export function ensureTaskMetadata(taskPath: string, init?: Partial<TaskMeta>): TaskMeta {
  const mhclawDir = path.join(taskPath, MHWORK_SUB);
  if (!fs.existsSync(mhclawDir)) fs.mkdirSync(mhclawDir, { recursive: true });

  const memDir = path.join(mhclawDir, MEMORY_DIR);
  if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });

  const memFile = path.join(memDir, MEMORY_MD);
  if (!fs.existsSync(memFile)) fs.writeFileSync(memFile, "");

  const taskJsonPath = path.join(mhclawDir, TASK_JSON);
  if (fs.existsSync(taskJsonPath)) {
    // 已存在 → 读出来,合并可能的新字段
    try {
      const existing = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8")) as TaskMeta;
      const merged: TaskMeta = {
        ...existing,
        lastActiveAt: Date.now(),
      };
      fs.writeFileSync(taskJsonPath, JSON.stringify(merged, null, 2));
      return merged;
    } catch {
      // corrupted,下面重建
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

/** 读任务元数据(.mhclaw/task.json);不存在返回 null */
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

/** 在工作根下新建一个空任务目录,返回路径 */
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

/** 绑定一个外部已有目录:ensure .mhclaw 结构 + 加入索引 */
export function bindExternalFolder(
  absPath: string,
  init?: Partial<TaskMeta>,
): { path: string; entry: OutputDirEntry; meta: TaskMeta } {
  if (!fs.existsSync(absPath)) {
    throw new Error(`目录不存在: ${absPath}`);
  }
  const stat = fs.statSync(absPath);
  if (!stat.isDirectory()) throw new Error(`不是目录: ${absPath}`);

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
// session ↔ task 绑定(系统级)
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

/** 将 session 绑到任务目录(幂等) */
export function bindSessionToFolder(sessionKey: string, taskPath: string): void {
  if (!sessionKey || !taskPath) return;
  const map = loadSessionTaskMap();
  map[sessionKey] = taskPath;
  saveSessionTaskMap(map);

  // 同步写到 task.json.sessionKey
  const meta = readTaskMeta(taskPath);
  if (meta) {
    meta.sessionKey = sessionKey;
    meta.lastActiveAt = Date.now();
    writeTaskMeta(taskPath, meta);
  }

  // upsert 索引的 lastUsedAt
  upsertOutputDir({ path: taskPath });
}

/**
 * 把 session-task 映射表里的 oldKey 迁移到 newKey。
 * 触发场景:客户端发送 sessionKey "session-123",Gateway 规范化成
 * "agent:main:session-123" 并在事件/sessions.list 里回传。首次拿到规范版 key 时
 * chat-store 调此 IPC,让磁盘映射跟上 —— 否则 getFolderForSession(newKey) 查不到。
 */
export function remapSessionKey(oldKey: string, newKey: string): void {
  if (!oldKey || !newKey || oldKey === newKey) return;
  const map = loadSessionTaskMap();
  const taskPath = map[oldKey];
  if (!taskPath) return;
  // newKey 已存在就不覆盖(保守策略:避免把别的 session 的绑定覆盖掉)
  if (map[newKey]) return;
  map[newKey] = taskPath;
  delete map[oldKey];
  saveSessionTaskMap(map);

  // 同步 task.json.sessionKey
  const meta = readTaskMeta(taskPath);
  if (meta) {
    meta.sessionKey = newKey;
    meta.lastActiveAt = Date.now();
    writeTaskMeta(taskPath, meta);
  }
}

/** 获取 session 绑定的任务目录,未绑则 null */
export function getFolderForSession(sessionKey: string): string | null {
  if (!sessionKey) return null;
  const map = loadSessionTaskMap();
  const p = map[sessionKey];
  if (!p) return null;
  if (!fs.existsSync(p)) {
    // 目录被删了,清理映射
    delete map[sessionKey];
    saveSessionTaskMap(map);
    return null;
  }
  return p;
}
