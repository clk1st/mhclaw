/**
 * Artifacts persistence service.
 *
 * Source of truth: `<task-folder>/.mhclaw/artifacts.json` inside each
 * task directory.
 *   - Self-contained per task — copying the directory carries everything.
 *   - Cross-device migration / future sync (mhwork-api) only needs a
 *     sync layer; the data model doesn't change.
 *   - The renderer's preview-store is a runtime cache only — it does NOT
 *     own persistence.
 *
 * One artifact currently corresponds to one OpenClaw `[embed]`
 * shortcode:
 *   [embed ref="..." url="..." title="..." preferredHeight="..." kind="..." /]
 * Once filesystem change-tracking is added, artifacts will gain
 * `source: "embed" | "fs"` distinction.
 *
 * Dedup strategy: prefer `ref`, fall back to `url`. Don't write the
 * same signature twice.
 */
import fs from "node:fs";
import path from "node:path";
import { getFolderForSession } from "./task-folder.js";

const MHWORK_SUB = ".mhclaw";
const ARTIFACTS_JSON = "artifacts.json";

/**
 * Artifact entry. Two kinds of `source`:
 *   - "embed": explicitly declared by the AI inside `[embed]` shortcodes
 *              (canvas URLs / non-file rich content). Persisted to
 *              `.mhclaw/artifacts.json`.
 *   - "fs"   : output files in the task folder whose extension is in
 *              the whitelist (xlsx/docx/pdf/md/html/...). Discovered by
 *              filesystem scan; NOT persisted, since the disk itself is
 *              the source of truth.
 */
export interface ArtifactEntry {
  source: "embed" | "fs";
  title?: string;
  /** For embed: equals `registeredAt`. For fs: equals the file mtime. */
  registeredAt: number;

  /** Embed-only fields. */
  ref?: string;
  url?: string;
  preferredHeight?: number;
  kind?: string;

  /**
   * fs-only: path relative to the task folder, used to assemble a
   * `mhclaw-workspace://` URL.
   */
  relPath?: string;
  size?: number;
  mtime?: number;
}

/** Fields actually written to artifacts.json (only `source: "embed"`). */
interface EmbedFileEntry {
  source: "embed";
  registeredAt: number;
  ref?: string;
  url?: string;
  title?: string;
  preferredHeight?: number;
  kind?: string;
}

interface ArtifactsFile {
  version: 1;
  entries: EmbedFileEntry[];
}

/** Whitelist of "meaningful output" file extensions in AI output. */
const PRODUCT_EXT = new Set([
  ".xlsx", ".xls",
  ".docx", ".doc",
  ".pdf",
  ".pptx", ".ppt",
  ".md",
  ".html", ".htm",
  ".csv",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
]);

function artifactsFilePath(taskPath: string): string {
  return path.join(taskPath, MHWORK_SUB, ARTIFACTS_JSON);
}

function ensureMhworkDir(taskPath: string) {
  const dir = path.join(taskPath, MHWORK_SUB);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadFile(taskPath: string): ArtifactsFile {
  const p = artifactsFilePath(taskPath);
  if (!fs.existsSync(p)) return { version: 1, entries: [] };
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf-8")) as ArtifactsFile;
    if (!data || !Array.isArray(data.entries)) return { version: 1, entries: [] };
    return { version: 1, entries: data.entries };
  } catch {
    // Treat corruption as empty for now. A "preserve history" recovery
    // path can wait for v2 — the complexity isn't worth it today.
    return { version: 1, entries: [] };
  }
}

function saveFile(taskPath: string, data: ArtifactsFile) {
  ensureMhworkDir(taskPath);
  fs.writeFileSync(artifactsFilePath(taskPath), JSON.stringify(data, null, 2));
}

function signature(a: { ref?: string; url?: string }): string {
  return (a.ref ?? "") || (a.url ?? "");
}

/**
 * Walk the task folder for output files (recursively; skips `.mhclaw`
 * and other hidden dirs; only whitelisted extensions). Depth is capped
 * at 6 to avoid pathological directory trees stalling the walk.
 */
function listFsArtifacts(taskPath: string): ArtifactEntry[] {
  const results: ArtifactEntry[] = [];
  if (!fs.existsSync(taskPath)) return results;

  const walk = (dir: string, depth: number) => {
    if (depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(abs, depth + 1);
        continue;
      }
      const ext = path.extname(e.name).toLowerCase();
      if (!PRODUCT_EXT.has(ext)) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }
      const rel = path.relative(taskPath, abs);
      results.push({
        source: "fs",
        title: e.name,
        relPath: rel,
        size: stat.size,
        mtime: stat.mtimeMs,
        registeredAt: stat.mtimeMs,
      });
    }
  };
  walk(taskPath, 0);
  return results;
}

/**
 * Read a session's artifacts (resolves the bound task folder, then
 * merges):
 *   - persisted embed entries (artifacts.json)
 *   - whitelisted output files on the filesystem
 *
 * Dedup: if any fs entry's `relPath` is contained in an embed entry's
 * `url` (i.e. the AI both wrote the file AND emitted an [embed] for
 * it), keep the embed and drop the fs duplicate. Sorted by
 * `registeredAt` descending.
 */
export function listArtifactsForSession(sessionKey: string): ArtifactEntry[] {
  const taskPath = getFolderForSession(sessionKey);
  if (!taskPath) return [];

  const embedEntries: ArtifactEntry[] = loadFile(taskPath).entries.map((e) => ({
    ...e,
  }));
  const fsEntries = listFsArtifacts(taskPath);

  const embedUrlHay = embedEntries
    .map((e) => e.url ?? "")
    .filter(Boolean)
    .join("");
  const merged: ArtifactEntry[] = [...embedEntries];
  for (const f of fsEntries) {
    if (f.relPath && embedUrlHay.includes(f.relPath)) continue;
    merged.push(f);
  }
  merged.sort((a, b) => (b.registeredAt ?? 0) - (a.registeredAt ?? 0));
  return merged;
}

export interface AddInput {
  ref?: string;
  url?: string;
  title?: string;
  preferredHeight?: number;
  kind?: string;
}

/**
 * Batch-register a list of embed entries to a session's bound task
 * folder.
 *   - Inputs without a signature (no ref AND no url) are skipped.
 *   - Inputs whose signature already exists are skipped (no duplicates).
 *   - Returns null if the session isn't bound to a task folder yet —
 *     the caller should ensureForSession first.
 *
 * Returns the merged full entries list — handy for the renderer to
 * update its query cache directly.
 */
export function addArtifactsForSession(
  sessionKey: string,
  inputs: AddInput[],
): ArtifactEntry[] | null {
  const taskPath = getFolderForSession(sessionKey);
  if (!taskPath) return null;

  const file = loadFile(taskPath);
  const existingSigs = new Set(file.entries.map(signature).filter(Boolean));
  const now = Date.now();
  let changed = false;

  for (const inp of inputs) {
    const sig = signature(inp);
    if (!sig) continue;
    if (existingSigs.has(sig)) continue;
    existingSigs.add(sig);
    file.entries.push({
      ref: inp.ref,
      url: inp.url,
      title: inp.title,
      preferredHeight: inp.preferredHeight,
      kind: inp.kind,
      source: "embed",
      registeredAt: now,
    });
    changed = true;
  }

  if (changed) saveFile(taskPath, file);
  return file.entries;
}
