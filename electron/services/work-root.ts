/**
 * Work-root service.
 *
 * The "work root" is the parent directory where mhclaw drops task
 * outputs. On first launch we create `~/mhclaw/` automatically; the
 * user can change it in Settings (e.g. to `~/Documents/AI/` or a
 * project directory). Modeled after WorkBuddy's `~/WorkBuddy/`.
 *
 * We also maintain `~/.mhclaw/output-dirs.json` — an index of every
 * known task directory (including externally-bound ones) — used by the
 * Composer popover for "recent" and "pinned" lists.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getStateDir } from "../constants.js";

const WORK_ROOT_CONFIG = "work-root.json"; // current work-root location
const OUTPUT_DIRS_INDEX = "output-dirs.json"; // task-directory index

const DEFAULT_WORK_ROOT_NAME = "mhclaw";

export interface OutputDirEntry {
  /** Absolute path (a task directory or external directory). */
  path: string;
  /** Display name. UI falls back to basename when empty. */
  displayName: string;
  /**
   * blank    = a timestamped directory auto-created under the work root
   *            (the purest form of a task directory).
   * external = a directory the user picked via "Open existing folder"
   *            (might be a pre-existing project).
   */
  kind: "blank" | "external";
  /** Last time this app touched this entry (ms). */
  lastUsedAt: number;
  /** Creation time (ms). */
  createdAt: number;
  /** Pinned in the recents list. */
  pinned: boolean;
}

interface WorkRootConfig {
  /** Absolute path of the current work root. */
  path: string;
  /** True if mhclaw auto-created it (user can override in Settings). */
  autoCreated: boolean;
  /** Last update timestamp. */
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

/** Read the work-root config, writing the default if absent and
 *  ensuring the directory exists. */
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

  // Even when the config exists, make sure the directory itself does
  // (the user might have deleted it manually).
  if (!fs.existsSync(cfg.path)) {
    fs.mkdirSync(cfg.path, { recursive: true });
    console.log(`[WorkRoot] Created directory: ${cfg.path}`);
  }

  return cfg;
}

/** Pick a new work root (used when the user changes it in Settings). */
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
// output-dirs.json index
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

/** List every known task directory, sorted by lastUsedAt desc (pinned first). */
export function listOutputDirs(): OutputDirEntry[] {
  const entries = loadIndex();
  return entries
    .filter((e) => fs.existsSync(e.path)) // drop entries the user has already deleted
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.lastUsedAt - a.lastUsedAt;
    });
}

/** Add or update an index entry (upsert). */
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

/** Toggle the pinned flag for an entry. */
export function togglePin(dirPath: string): OutputDirEntry | null {
  const entries = loadIndex();
  const e = entries.find((x) => x.path === dirPath);
  if (!e) return null;
  e.pinned = !e.pinned;
  saveIndex(entries);
  return e;
}

/** Remove from the index (does NOT delete the actual directory). */
export function removeOutputDirFromIndex(dirPath: string): void {
  const entries = loadIndex().filter((e) => e.path !== dirPath);
  saveIndex(entries);
}
