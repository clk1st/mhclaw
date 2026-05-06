/**
 * mhclaw 自定义协议:
 *
 *   mhclaw-workspace://fs/<encoded-sessionKey>/<rel-path>
 *     - 解析:通过 session→task folder 映射找到 base,再拼 rel
 *     - 用途:RightPanel 预览本任务的产出文件
 *     - 不用 host 放 sessionKey:OpenClaw sessionKey 含 ":"(如 agent:main:session-X),
 *       encodeURIComponent 后 "%3A" 在 URL host 段被 Chromium URL parser 拒绝,
 *       必须放到 pathname 里才合法。
 *
 *   mhclaw-authorized://fs/<percent-encoded-abs-path>
 *     - 解析:解码绝对路径 → 走白名单校验 → 读文件
 *     - 用途:预览授权目录里的文件(用户明确加过白名单的)
 *
 * 两个协议都用 privileged 注册:secure + standard + supportFetchAPI + stream,
 * iframe / <img> / fetch 都能用。
 */
import fs from "node:fs";
import path from "node:path";
import { protocol } from "electron";
import { getFolderForSession } from "./task-folder.js";
import { isAuthorized } from "./authorized-dirs.js";

export const SCHEME_WORKSPACE = "mhclaw-workspace";
export const SCHEME_AUTHORIZED = "mhclaw-authorized";

/** 必须在 app.whenReady() 之前调用 */
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

/** app.whenReady() 之后调用 */
export function registerHandlers() {
  protocol.handle(SCHEME_WORKSPACE, async (req) => {
    try {
      const url = new URL(req.url);
      if (url.hostname !== "fs") {
        return new Response("invalid host", { status: 400 });
      }
      // pathname 形如 "/<encoded-sessionKey>/<rel-path>...";
      // 先切出第一段作为 session,剩下拼成 rel
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
      // host 固定用 "fs",pathname 即 /<encoded-abs-path>
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
 * 读文件并返回 Response。
 * @param filePath 目标文件绝对路径
 * @param confine  若提供,则要求 filePath 必须在 confine 下(防 ../ 穿越)
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
    // 目录 → 尝试 index.html
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
