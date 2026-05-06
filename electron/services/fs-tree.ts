/**
 * Lightweight directory listing for the FilesTab.
 * Loads only the immediate children (no recursion), so large
 * directories stay snappy.
 */
import fs from "node:fs";
import path from "node:path";

const IGNORED = new Set([
  ".mhclaw",
  ".git",
  "node_modules",
  ".DS_Store",
  "__pycache__",
  ".venv",
  ".next",
  ".cache",
]);

export interface FsNode {
  name: string;
  rel: string;
  isDir: boolean;
  size?: number;
  mtime?: number;
}

/**
 * Resolve `rel` to an absolute path, enforcing that it stays within
 * `taskPath` (defends against `../` traversal and symlink escapes).
 * Throws on violation; callers should let it propagate.
 */
export function resolveSafePath(taskPath: string, rel: string): string {
  const baseAbs = path.resolve(taskPath);
  const targetAbs = path.resolve(baseAbs, rel);
  if (targetAbs !== baseAbs && !targetAbs.startsWith(baseAbs + path.sep)) {
    throw new Error(`path escape: ${rel}`);
  }
  return targetAbs;
}

/** Write a text file (overwrite). Path must stay within the task dir;
 *  parent directories are created automatically. */
export function writeTextFile(taskPath: string, rel: string, content: string): void {
  const abs = resolveSafePath(taskPath, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
}

/** Delete a file (does NOT recurse into directories). */
export function deleteFile(taskPath: string, rel: string): void {
  const abs = resolveSafePath(taskPath, rel);
  if (!fs.existsSync(abs)) return;
  const st = fs.statSync(abs);
  if (st.isDirectory()) throw new Error("deleteFile does not delete directories");
  fs.unlinkSync(abs);
}

/**
 * List immediate children of `<taskPath>/<rel>`.
 * `rel === ""` means the root.
 */
export function listChildren(taskPath: string, rel: string): FsNode[] {
  const abs = path.join(taskPath, rel);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) return [];

  const items = fs.readdirSync(abs, { withFileTypes: true });
  const out: FsNode[] = [];
  for (const it of items) {
    if (IGNORED.has(it.name)) continue;
    const childAbs = path.join(abs, it.name);
    let st: fs.Stats;
    try {
      st = fs.statSync(childAbs);
    } catch {
      continue;
    }
    out.push({
      name: it.name,
      rel: (rel ? rel + "/" : "") + it.name,
      isDir: st.isDirectory(),
      size: st.isFile() ? st.size : undefined,
      mtime: Math.floor(st.mtimeMs),
    });
  }
  out.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}
