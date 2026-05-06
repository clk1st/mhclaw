/**
 * mhclaw custom protocols.
 *
 *   mhclaw-workspace://fs/<encoded-sessionKey>/<rel-path>
 *     - Resolution: look up the task folder via session→task mapping,
 *       then join with `rel`.
 *     - Use: RightPanel previewing this task's output files.
 *     - Why sessionKey doesn't go in the URL host: OpenClaw session
 *       keys contain `:` (e.g. `agent:main:session-X`). After
 *       encodeURIComponent, `%3A` in a URL host segment is rejected by
 *       the Chromium URL parser; it must live in the pathname.
 *
 *   mhclaw-authorized://fs/<percent-encoded-absolute-path>
 *     - Resolution: decode the absolute path → run authorized-dirs
 *       check → read the file.
 *     - Use: previewing files inside user-authorized directories.
 *
 * Both schemes are registered with the privileged set
 * (secure + standard + supportFetchAPI + stream + cors), so iframe /
 * <img> / fetch all work.
 */
import fs from "node:fs";
import path from "node:path";
import { protocol } from "electron";
import { getFolderForSession } from "./task-folder.js";
import { isAuthorized } from "./authorized-dirs.js";

export const SCHEME_WORKSPACE = "mhclaw-workspace";
export const SCHEME_AUTHORIZED = "mhclaw-authorized";

/** Must be called BEFORE app.whenReady(). */
export function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME_WORKSPACE,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
    {
      scheme: SCHEME_AUTHORIZED,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ]);
}

/** Called AFTER app.whenReady(). */
export function registerHandlers() {
  protocol.handle(SCHEME_WORKSPACE, async (req) => {
    try {
      const url = new URL(req.url);
      if (url.hostname !== "fs") {
        return new Response("invalid host", { status: 400 });
      }
      // pathname looks like "/<encoded-sessionKey>/<rel-path>...".
      // Split the first segment as the session; join the rest as rel.
      const parts = url.pathname.replace(/^\/+/, "").split("/");
      const sessionKey = decodeURIComponent(parts.shift() ?? "");
      const rel = parts.map(decodeURIComponent).join("/");
      if (!sessionKey) return new Response("missing session", { status: 400 });

      const base = getFolderForSession(sessionKey);
      if (!base) return new Response("no task bound to session", { status: 404 });

      return serveFile(path.join(base, rel), base);
    } catch (err) {
      console.error("[protocol:workspace]", err);
      return new Response("internal error", { status: 500 });
    }
  });

  protocol.handle(SCHEME_AUTHORIZED, async (req) => {
    try {
      const url = new URL(req.url);
      // host is fixed to "fs"; pathname is /<encoded-abs-path>.
      if (url.hostname !== "fs") {
        return new Response("invalid host", { status: 400 });
      }
      const abs = decodeURIComponent(url.pathname || "");
      if (!abs || !path.isAbsolute(abs)) {
        return new Response("absolute path required", { status: 400 });
      }
      if (!isAuthorized(abs)) {
        return new Response("not authorized", { status: 403 });
      }
      return serveFile(abs);
    } catch (err) {
      console.error("[protocol:authorized]", err);
      return new Response("internal error", { status: 500 });
    }
  });
}

/**
 * Read a file and return the Response.
 * @param filePath Absolute path to the file.
 * @param confine  If provided, `filePath` must be under `confine`
 *                 (defends against `../` traversal).
 */
async function serveFile(filePath: string, confine?: string): Promise<Response> {
  const resolved = path.resolve(filePath);
  if (confine) {
    const base = path.resolve(confine);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
      return new Response("path escape", { status: 403 });
    }
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return new Response("not found", { status: 404 });
  }
  if (stat.isDirectory()) {
    // Directory → try index.html.
    const idx = path.join(resolved, "index.html");
    if (fs.existsSync(idx)) return serveFile(idx, confine);
    return new Response("is directory", { status: 404 });
  }

  const content = fs.readFileSync(resolved);
  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": mimeFor(resolved),
      "Content-Length": String(content.byteLength),
      "Cache-Control": "no-cache",
    },
  });
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".csv": "text/csv; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}
