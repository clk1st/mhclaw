/**
 * 工作根(Work Root)服务。
 *
 * "工作根"是用户放任务产出的父目录,首次启动自动创建 ~/mhclaw/,
 * 用户可以在设置里改成别的(比如 ~/Documents/AI/ 或公司项目目录)。
 * 对标 WorkBuddy 的 ~/WorkBuddy/。
 *
 * 同时维护 ~/.mhclaw/output-dirs.json,记录所有已知任务目录(包括外部绑定的)
 * 供 Composer Popover 列"最近使用"和"收藏"。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getStateDir } from "../constants.js";

const WORK_ROOT_CONFIG = "work-root.json"; // 记录用户当前工作根位置
const OUTPUT_DIRS_INDEX = "output-dirs.json"; // 任务目录索引

const DEFAULT_WORK_ROOT_NAME = "mhclaw";

export interface OutputDirEntry {
  /** 绝对路径(任务目录或外部目录) */
  path: string;
  /** 显示名。空则 UI 用 basename */
  displayName: string;
  /**
   * blank   = 工作根下自动建的时间戳目录(最纯粹的任务目录)
   * external = 用户"打开新文件夹"选的外部目录(可能是已有工程)
   */
  kind: "blank" | "external";
  /** 上次被本应用用过的时间(ms) */
  lastUsedAt: number;
  /** 创建时间(ms) */
  createdAt: number;
  /** 收藏置顶 */
  pinned: boolean;
}

interface WorkRootConfig {
  /** 当前工作根绝对路径 */
  path: string;
  /** 是否由 mhclaw 自动创建的(用户可在设置里改) */
  autoCreated: boolean;
  /** 最近更新时间 */
  updatedAt: number;
}

function workRootConfigPath(): string {
  return path.join(getStateDir(), WORK_ROOT_CONFIG);
}

function outputDirsIndexPath(): string {
  return path.join(getStateDir(), OUTPUT_DIRS_INDEX);
}

function defaultWorkRoot(): string {
  return path.join(os.homedir(), DEFAULT_WORK_ROOT_NAME);
}

/** 读工作根配置,如无则写入默认值并 ensure 目录 */
export function ensureWorkRoot(): WorkRootConfig {
  const cfgPath = workRootConfigPath();
  const stateDir = getStateDir();
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  let cfg: WorkRootConfig | null = null;
  if (fs.existsSync(cfgPath)) {
    try {
      cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as WorkRootConfig;
    } catch {
      cfg = null;
    }
  }

  if (!cfg?.path) {
    const root = defaultWorkRoot();
    cfg = {
      path: root,
      autoCreated: true,
      updatedAt: Date.now(),
    };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    console.log(`[WorkRoot] Initialized: ${root}`);
  }

  // 即使配置已存在,也 ensure 目录物理存在(用户可能手动删了)
  if (!fs.existsSync(cfg.path)) {
    fs.mkdirSync(cfg.path, { recursive: true });
    console.log(`[WorkRoot] Created directory: ${cfg.path}`);
  }

  return cfg;
}

/** 设置新的工作根(用户在设置里改) */
export function setWorkRoot(newPath: string): WorkRootConfig {
  const resolved = path.resolve(newPath);
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }
  const cfg: WorkRootConfig = {
    path: resolved,
    autoCreated: false,
    updatedAt: Date.now(),
  };
  fs.writeFileSync(workRootConfigPath(), JSON.stringify(cfg, null, 2));
  return cfg;
}

export function getWorkRoot(): WorkRootConfig {
  return ensureWorkRoot();
}

// ============================================================
// output-dirs.json 索引
// ============================================================

function loadIndex(): OutputDirEntry[] {
  const p = outputDirsIndexPath();
  if (!fs.existsSync(p)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf-8"));
    return Array.isArray(data) ? (data as OutputDirEntry[]) : [];
  } catch {
    return [];
  }
}

function saveIndex(entries: OutputDirEntry[]) {
  fs.writeFileSync(outputDirsIndexPath(), JSON.stringify(entries, null, 2));
}

/** 列出所有已知任务目录,按 lastUsedAt 倒序(pinned 优先) */
export function listOutputDirs(): OutputDirEntry[] {
  const entries = loadIndex();
  return entries
    .filter((e) => fs.existsSync(e.path)) // 过滤掉用户已经手动删除的
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.lastUsedAt - a.lastUsedAt;
    });
}

/** 添加或更新一条记录(upsert) */
export function upsertOutputDir(
  params: Partial<OutputDirEntry> & { path: string },
): OutputDirEntry {
  const entries = loadIndex();
  const existing = entries.find((e) => e.path === params.path);
  if (existing) {
    Object.assign(existing, params, { lastUsedAt: Date.now() });
    saveIndex(entries);
    return existing;
  }
  const entry: OutputDirEntry = {
    path: params.path,
    displayName: params.displayName ?? path.basename(params.path),
    kind: params.kind ?? "external",
    lastUsedAt: Date.now(),
    createdAt: params.createdAt ?? Date.now(),
    pinned: params.pinned ?? false,
  };
  entries.push(entry);
  saveIndex(entries);
  return entry;
}

/** 收藏切换 */
export function togglePin(dirPath: string): OutputDirEntry | null {
  const entries = loadIndex();
  const e = entries.find((x) => x.path === dirPath);
  if (!e) return null;
  e.pinned = !e.pinned;
  saveIndex(entries);
  return e;
}

/** 删除索引(不删实际目录) */
export function removeOutputDirFromIndex(dirPath: string): void {
  const entries = loadIndex().filter((e) => e.path !== dirPath);
  saveIndex(entries);
}
