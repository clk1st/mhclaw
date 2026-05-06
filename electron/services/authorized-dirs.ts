/**
 * 授权目录(Authorized Dirs)服务。
 *
 * 用户可以把特定目录加到白名单,让 AI / 预览层访问 ——
 * 通过 mhclaw-authorized:// 协议时,只有命中白名单前缀的路径才会被服务出去。
 *
 * 存储: ~/.mhclaw/authorized-dirs.json
 *
 * 白名单的语义:
 * - 包含关系: 目录 `/foo/bar` 授权后,`/foo/bar/x.html` 可访问;`/foo` 不可访问
 * - 符号链接: 解析到 realpath 再匹配(防绕过)
 * - 不授权危险路径: / 、/Users 、/Users/<name> 根 —— 太宽,拒写
 *
 * 内置白名单:app 自己的 state 目录(~/.mhclaw/)—— OpenClaw 的 main/claw agent
 * 默认把 USER.md / MEMORY.md 之类写在 `~/.mhclaw/workspace/`,用户装 app 时就已经
 * 同意了 app 访问 state 目录,不应该再要求"显式授权"。不写入 authorized-dirs.json,
 * UI 列表里也不出现,只在 isAuthorized 判断时兜底放行。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getStateDir } from "../constants.js";

const INDEX_NAME = "authorized-dirs.json";

export interface AuthorizedDir {
  path: string;
  note?: string;
  addedAt: number;
}

function indexPath(): string {
  return path.join(getStateDir(), INDEX_NAME);
}

function load(): AuthorizedDir[] {
  const p = indexPath();
  if (!fs.existsSync(p)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    return Array.isArray(raw) ? (raw as AuthorizedDir[]) : [];
  } catch {
    return [];
  }
}

function save(list: AuthorizedDir[]) {
  const stateDir = getStateDir();
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(indexPath(), JSON.stringify(list, null, 2));
}

function isDangerous(absPath: string): boolean {
  const n = path.resolve(absPath);
  if (n === "/" || n === path.parse(n).root) return true;
  if (n === os.homedir()) return true;
  if (n === "/Users" || /^\/Users\/[^/]+$/.test(n)) return true;
  if (n === "/tmp" || n === "/var" || n === "/etc") return true;
  return false;
}

export function listAuthorizedDirs(): AuthorizedDir[] {
  return load()
    .filter((e) => fs.existsSync(e.path))
    .sort((a, b) => b.addedAt - a.addedAt);
}

export function addAuthorizedDir(absPath: string, note?: string): AuthorizedDir {
  if (!fs.existsSync(absPath)) throw new Error(`目录不存在: ${absPath}`);
  const stat = fs.statSync(absPath);
  if (!stat.isDirectory()) throw new Error(`不是目录: ${absPath}`);

  // realpath 防符号链接绕过
  const real = fs.realpathSync(absPath);
  if (isDangerous(real)) throw new Error(`不允许授权这个目录: ${real}`);

  const list = load();
  const existing = list.find((e) => e.path === real);
  if (existing) {
    if (note !== undefined) existing.note = note;
    existing.addedAt = Date.now();
    save(list);
    return existing;
  }
  const entry: AuthorizedDir = {
    path: real,
    note: note?.trim() || undefined,
    addedAt: Date.now(),
  };
  list.push(entry);
  save(list);
  return entry;
}

export function removeAuthorizedDir(absPath: string): void {
  const list = load().filter((e) => e.path !== absPath);
  save(list);
}

/**
 * 返回内置白名单 —— app 自己的 state 目录,永远放行。
 * 懒解析 realpath,结果缓存一次就够(state 目录在整个 app 生命周期内不会变)。
 */
let builtInCache: string[] | null = null;
function getBuiltInAuthorizedDirs(): string[] {
  if (builtInCache) return builtInCache;
  const candidates = [getStateDir()];
  const resolved: string[] = [];
  for (const p of candidates) {
    try {
      // state 目录可能还没建,先 resolve 再试着 realpath
      const abs = path.resolve(p);
      resolved.push(fs.existsSync(abs) ? fs.realpathSync(abs) : abs);
    } catch {
      resolved.push(path.resolve(p));
    }
  }
  builtInCache = resolved;
  return builtInCache;
}

/** 判断 target 是否在任一授权目录内(严格前缀 + realpath) */
export function isAuthorized(target: string): boolean {
  let real: string;
  try {
    real = fs.realpathSync(target);
  } catch {
    real = path.resolve(target);
  }
  // 先看内置白名单(state 目录)
  for (const base of getBuiltInAuthorizedDirs()) {
    const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep;
    if (real === base || real.startsWith(baseWithSep)) return true;
  }
  // 再看用户授权的目录
  const list = load();
  for (const e of list) {
    const base = e.path.endsWith(path.sep) ? e.path : e.path + path.sep;
    if (real === e.path || real.startsWith(base)) return true;
  }
  return false;
}
