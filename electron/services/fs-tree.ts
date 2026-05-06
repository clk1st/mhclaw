/**
 * 简单的目录列举,供 FilesTab 展示。
 * 不递归加载(按需展开),减少大目录时的开销。
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
 * 把 rel 解析为 abs,严格要求落在 taskPath 内,防 ../ 穿越和符号链接逃逸。
 * 失败抛错,调用方直接 throw。
 */
export function resolveSafePath(taskPath: string, rel: string): string {
  const baseAbs = path.resolve(taskPath);
  const targetAbs = path.resolve(baseAbs, rel);
  if (targetAbs !== baseAbs && !targetAbs.startsWith(baseAbs + path.sep)) {
    throw new Error(`path escape: ${rel}`);
  }
  return targetAbs;
}

/** 写入文本(覆盖)。仅允许在任务目录内,自动建父目录。 */
export function writeTextFile(taskPath: string, rel: string, content: string): void {
  const abs = resolveSafePath(taskPath, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
}

/** 删除文件(不递归目录)。 */
export function deleteFile(taskPath: string, rel: string): void {
  const abs = resolveSafePath(taskPath, rel);
  if (!fs.existsSync(abs)) return;
  const st = fs.statSync(abs);
  if (st.isDirectory()) throw new Error("不能用 deleteFile 删目录");
  fs.unlinkSync(abs);
}

/**
 * 列出 <taskPath>/<rel> 这一层的直接子节点。
 * rel="" 表示根。
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
