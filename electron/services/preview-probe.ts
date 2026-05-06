import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { getFolderForSession } from "./task-folder.js";
import { isAuthorized } from "./authorized-dirs.js";

/**
 * Main-process side of the Preview availability subsystem.
 *
 * Resolves an embed URL provided by the UI to an absolute path, runs
 * `stat()`, and returns the filesystem-level truth (exists / size /
 * mtime / error). The UI then combines `{exists, mtime}` with
 * `runActive` to derive the four-state preview status (pending /
 * generating / ready / error).
 *
 * Security boundary — only three URL kinds are probeable:
 *   1. mhclaw-workspace://fs/<sessionKey>/<rel>
 *      Inside the task folder bound to `sessionKey`.
 *   2. mhclaw-authorized://fs/<absolutePath>
 *      Inside a whitelisted directory.
 *   3. /absolute/path
 *      Bare absolute path; must pass the authorized-dir check.
 * Other forms (http, canvas, relative paths) are not probed here — the
 * renderer issues a HEAD fetch for those.
 */

export interface FileProbeResult {
  exists: boolean;
  size?: number;
  mtime?: number;
  error?: string;
}

export function probeFileByUrl(input: string): FileProbeResult {
  if (typeof input !== "string" || input.length === 0) {
    return { exists: false, error: "Empty URL" };
  }

  let absPath: string | null = null;
  let confine: string | null = null;

  try {
    if (input.startsWith("mhclaw-workspace://")) {
      const url = new URL(input);
      if (url.hostname !== "fs") {
        return { exists: false, error: "workspace URL host must be 'fs'" };
      }
      const parts = url.pathname.replace(/^\/+/, "").split("/");
      const sessionKey = decodeURIComponent(parts.shift() ?? "");
      const rel = parts.map(decodeURIComponent).join("/");
      if (!sessionKey) return { exists: false, error: "URL is missing sessionKey" };
      const base = getFolderForSession(sessionKey);
      if (!base) return { exists: false, error: "session is not bound to a task folder" };
      absPath = path.resolve(path.join(base, rel));
      confine = path.resolve(base);
    } else if (input.startsWith("mhclaw-authorized://")) {
      const url = new URL(input);
      if (url.hostname !== "fs") {
        return { exists: false, error: "authorized URL host must be 'fs'" };
      }
      const abs = decodeURIComponent(url.pathname || "");
      if (!abs || !path.isAbsolute(abs)) {
        return { exists: false, error: "URL is missing an absolute path" };
      }
      if (!isAuthorized(abs)) return { exists: false, error: "path not authorized" };
      absPath = path.resolve(abs);
    } else if (path.isAbsolute(input)) {
      // Bare absolute path (user-typed message) — must live inside an authorized dir.
      if (!isAuthorized(input)) return { exists: false, error: "path not authorized" };
      absPath = path.resolve(input);
    } else {
      return { exists: false, error: "unsupported URL form" };
    }
  } catch (err) {
    return {
      exists: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!absPath) return { exists: false, error: "could not resolve URL" };

  // Defense against `../` traversal via the `confine` check.
  if (confine) {
    if (absPath !== confine && !absPath.startsWith(confine + path.sep)) {
      return { exists: false, error: "path escapes confine boundary" };
    }
  }

  try {
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      // Embed targets are normally files; treating a dir as "ready" is
      // meaningless, so flag it as an error.
      return { exists: false, error: "target is a directory; cannot preview" };
    }
    return { exists: true, size: stat.size, mtime: stat.mtimeMs };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { exists: false };
    return { exists: false, error: code ?? String(err) };
  }
}
