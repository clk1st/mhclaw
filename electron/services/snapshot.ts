/**
 * Lightweight snapshot system for task directories (not git).
 *
 * Each task directory has a baseline at `.mhclaw/baseline.json`:
 *   {
 *     createdAt: number,
 *     entries: [{ rel, size, mtime, textHash? }]
 *   }
 *
 * For text files (≤256KB, with a recognized extension) we additionally
 * copy the original content to
 * `.mhclaw/baseline-text/<sha1(rel)>.txt`, enabling the ChangesTab's
 * before/after diff view.
 *
 * Comparison against the baseline only checks size and mtime. OpenClaw
 * writes files such that mtime virtually always changes; we accept the
 * edge case where the AI writes the same bytes (false negative) —
 * good enough for daily usage.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const MHWORK_SUB = ".mhclaw";
const BASELINE_JSON = "baseline.json";
const BASELINE_TEXT_DIR = "baseline-text";

const IGNORED_DIRS = new Set([
  ".mhclaw",
  ".git",
  "node_modules",
  ".DS_Store",
  ".venv",
  "__pycache__",
  "dist",
  "build",
  ".next",
  ".cache",
]);

const TEXT_EXT = new Set([
  ".txt", ".md", ".html", ".htm", ".css", ".js", ".mjs", ".ts", ".tsx", ".jsx",
  ".json", ".yaml", ".yml", ".toml", ".xml", ".csv", ".py", ".sh", ".env",
  ".log", ".sql", ".vue", ".svelte", ".go", ".rs", ".java", ".kt", ".swift",
  ".c", ".cc", ".cpp", ".h", ".hpp", ".rb", ".php",
]);

const TEXT_SIZE_LIMIT = 256 * 1024;

export interface BaselineEntry {
  rel: string;
  size: number;
  mtime: number;
  textHash?: string;
}

export interface Baseline {
  createdAt: number;
  entries: BaselineEntry[];
}

export type ChangeKind = "added" | "modified" | "deleted";

export interface ChangeEntry {
  rel: string;
  kind: ChangeKind;
  size?: number;
  mtime?: number;
  /** Whether the baseline kept a text snapshot (enables diff). */
  hasBaselineText?: boolean;
  /** Whether the current file is text (enables diff). */
  isText?: boolean;
}

function baselinePath(taskPath: string): string {
  return path.join(taskPath, MHWORK_SUB, BASELINE_JSON);
}

function baselineTextDir(taskPath: string): string {
  return path.join(taskPath, MHWORK_SUB, BASELINE_TEXT_DIR);
}

export function hasBaseline(taskPath: string): boolean {
  return fs.existsSync(baselinePath(taskPath));
}

function sha1(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex");
}

function isTextFile(p: string, size: number): boolean {
  return size <= TEXT_SIZE_LIMIT && TEXT_EXT.has(path.extname(p).toLowerCase());
}

function walk(root: string, cb: (abs: string, rel: string, stat: fs.Stats) => void) {
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const it of items) {
      if (IGNORED_DIRS.has(it.name)) continue;
      const abs = path.join(dir, it.name);
      if (it.isDirectory()) {
        stack.push(abs);
      } else if (it.isFile()) {
        let st: fs.Stats;
        try {
          st = fs.statSync(abs);
        } catch {
          continue;
        }
        cb(abs, path.relative(root, abs), st);
      }
    }
  }
}

/** Walk the task directory and produce BaselineEntry[]; doesn't persist. */
export function scanEntries(taskPath: string): BaselineEntry[] {
  const entries: BaselineEntry[] = [];
  walk(taskPath, (_abs, rel, st) => {
    entries.push({
      rel: rel.split(path.sep).join("/"),
      size: st.size,
      mtime: Math.floor(st.mtimeMs),
    });
  });
  return entries;
}

/** Capture a baseline. Idempotent — overwrites the previous one. */
export function captureBaseline(taskPath: string): Baseline {
  const mhclawDir = path.join(taskPath, MHWORK_SUB);
  if (!fs.existsSync(mhclawDir)) fs.mkdirSync(mhclawDir, { recursive: true });
  const textDir = baselineTextDir(taskPath);
  if (!fs.existsSync(textDir)) fs.mkdirSync(textDir, { recursive: true });

  const entries: BaselineEntry[] = [];
  walk(taskPath, (abs, rel, st) => {
    const entry: BaselineEntry = {
      rel: rel.split(path.sep).join("/"),
      size: st.size,
      mtime: Math.floor(st.mtimeMs),
    };
    if (isTextFile(abs, st.size)) {
      try {
        const content = fs.readFileSync(abs);
        const hash = sha1(entry.rel);
        fs.writeFileSync(path.join(textDir, hash + ".txt"), content);
        entry.textHash = hash;
      } catch {
        // ignore
      }
    }
    entries.push(entry);
  });

  const baseline: Baseline = { createdAt: Date.now(), entries };
  fs.writeFileSync(baselinePath(taskPath), JSON.stringify(baseline));
  return baseline;
}

/** Ensure a baseline exists; create one on first call. */
export function ensureBaseline(taskPath: string): Baseline {
  if (hasBaseline(taskPath)) {
    try {
      return JSON.parse(fs.readFileSync(baselinePath(taskPath), "utf-8")) as Baseline;
    } catch {
      // Corrupted — rebuild.
    }
  }
  return captureBaseline(taskPath);
}

export function readBaseline(taskPath: string): Baseline | null {
  if (!hasBaseline(taskPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(baselinePath(taskPath), "utf-8")) as Baseline;
  } catch {
    return null;
  }
}

/** Diff current state vs the baseline; returns a change list. */
export function computeDiff(taskPath: string): ChangeEntry[] {
  const baseline = readBaseline(taskPath);
  if (!baseline) return [];

  const currentByRel = new Map<string, BaselineEntry>();
  for (const e of scanEntries(taskPath)) currentByRel.set(e.rel, e);

  const baselineByRel = new Map<string, BaselineEntry>();
  for (const e of baseline.entries) baselineByRel.set(e.rel, e);

  const out: ChangeEntry[] = [];

  for (const [rel, cur] of currentByRel) {
    const base = baselineByRel.get(rel);
    const abs = path.join(taskPath, rel);
    const isText = isTextFile(abs, cur.size);
    if (!base) {
      out.push({ rel, kind: "added", size: cur.size, mtime: cur.mtime, isText });
    } else if (base.size !== cur.size || base.mtime !== cur.mtime) {
      out.push({
        rel,
        kind: "modified",
        size: cur.size,
        mtime: cur.mtime,
        hasBaselineText: !!base.textHash,
        isText,
      });
    }
  }
  for (const [rel, base] of baselineByRel) {
    if (!currentByRel.has(rel)) {
      out.push({ rel, kind: "deleted", hasBaselineText: !!base.textHash });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Read the baseline text for `rel`; null if missing or non-text. */
export function readBaselineText(taskPath: string, rel: string): string | null {
  const baseline = readBaseline(taskPath);
  if (!baseline) return null;
  const entry = baseline.entries.find((e) => e.rel === rel);
  if (!entry?.textHash) return null;
  const p = path.join(baselineTextDir(taskPath), entry.textHash + ".txt");
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

/** Read the current text content (text-typed files of reasonable size only). */
export function readCurrentText(taskPath: string, rel: string): string | null {
  const abs = path.join(taskPath, rel);
  let st: fs.Stats;
  try {
    st = fs.statSync(abs);
  } catch {
    return null;
  }
  if (!isTextFile(abs, st.size)) return null;
  try {
    return fs.readFileSync(abs, "utf-8");
  } catch {
    return null;
  }
}
