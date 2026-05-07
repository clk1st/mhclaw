/**
 * Authorized-directories service.
 *
 * Users can add specific directories to a whitelist so the AI / preview
 * layer is allowed to read from them. Requests via the
 * `mhclaw-authorized://` protocol are only served when the path falls
 * within a whitelisted prefix.
 *
 * Storage: `~/.mhclaw/authorized-dirs.json`.
 *
 * Whitelist semantics:
 *   - Prefix containment: with `/foo/bar` authorized, `/foo/bar/x.html`
 *     is reachable but `/foo` is not.
 *   - Symlinks: matched against `realpath` to prevent bypass.
 *   - Refused-by-default: `/`, `/Users`, `/Users/<name>`, etc. — too
 *     broad, never authorized.
 *
 * Built-in whitelist: the app's own state directory (~/.mhclaw/). The
 * default OpenClaw `main` / `claw` agents write USER.md / MEMORY.md to
 * `~/.mhclaw/workspace/`; the user has already implicitly granted the
 * app access to its state dir by installing it, so we shouldn't keep
 * asking. The built-in entry isn't written to authorized-dirs.json and
 * doesn't appear in the UI list — `isAuthorized()` just allows it as a
 * fallback.
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
  if (!fs.existsSync(absPath)) throw new Error(`Directory does not exist: ${absPath}`);
  const stat = fs.statSync(absPath);
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${absPath}`);

  // Resolve realpath to defeat symlink-based bypass.
  const real = fs.realpathSync(absPath);
  if (isDangerous(real)) throw new Error(`This directory cannot be authorized: ${real}`);

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
 * Return the built-in whitelist (the app's state directory) — always
 * authorized. The realpath is resolved lazily and cached once: the
 * state dir doesn't move during the app lifetime.
 */
let builtInCache: string[] | null = null;
function getBuiltInAuthorizedDirs(): string[] {
  if (builtInCache) return builtInCache;
  const candidates = [getStateDir()];
  const resolved: string[] = [];
  for (const p of candidates) {
    try {
      // The state dir may not exist yet — try resolve, then realpath.
      const abs = path.resolve(p);
      resolved.push(fs.existsSync(abs) ? fs.realpathSync(abs) : abs);
    } catch {
      resolved.push(path.resolve(p));
    }
  }
  builtInCache = resolved;
  return builtInCache;
}

/**
 * Known task folders read from session-task.json. The LLM emits
 * [embed url=mhclaw-authorized://fs/<encoded-abs-path>] pointing to
 * files inside ~/mhclaw/<ts> (folders that mhclaw itself created via
 * createBlankTask). Those folders are NOT in the state-dir built-in
 * whitelist and the user never explicitly authorized them, so without
 * this implicit allow the "Artifacts" tab clicks fail with
 * "not authorized".
 *
 * Read session-task.json directly (avoid importing task-folder to
 * prevent a circular dependency). These paths are app-owned, default
 * allow is reasonable; UI never shows them and removeAuthorizedDir
 * cannot touch them.
 */
function getKnownTaskFolders(): string[] {
  try {
    const p = path.join(getStateDir(), "session-task.json");
    if (!fs.existsSync(p)) return [];
    const map = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, string>;
    return Array.from(new Set(Object.values(map))).filter((v) => typeof v === "string");
  } catch {
    return [];
  }
}

/** Is `target` inside any authorized directory? (strict prefix + realpath) */
export function isAuthorized(target: string): boolean {
  let real: string;
  try {
    real = fs.realpathSync(target);
  } catch {
    real = path.resolve(target);
  }
  // Built-in whitelist (state dir) first.
  for (const base of getBuiltInAuthorizedDirs()) {
    const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep;
    if (real === base || real.startsWith(baseWithSep)) return true;
  }
  // Task folders mhclaw itself created via createBlankTask
  // (where the LLM writes artifacts).
  for (const tf of getKnownTaskFolders()) {
    let realTf: string;
    try {
      realTf = fs.realpathSync(tf);
    } catch {
      realTf = path.resolve(tf);
    }
    const baseWithSep = realTf.endsWith(path.sep) ? realTf : realTf + path.sep;
    if (real === realTf || real.startsWith(baseWithSep)) return true;
  }
  // Then user-authorized directories.
  const list = load();
  for (const e of list) {
    const base = e.path.endsWith(path.sep) ? e.path : e.path + path.sep;
    if (real === e.path || real.startsWith(base)) return true;
  }
  return false;
}
