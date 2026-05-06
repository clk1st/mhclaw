import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { getFolderForSession } from "./task-folder.js";
import { isAuthorized } from "./authorized-dirs.js";

/**
 * Preview availability 子系统的主进程侧 —— 把 UI 传来的 embed URL
 * 解析成 abs path 再 stat,给 UI 返回"文件系统层真相"(存在 / 大小 / mtime / 出错)。
 *
 * UI 层再根据 runActive 把 {exists, mtime} 推导成 4 态(pending/generating/ready/error)。
 *
 * 安全边界:只允许 3 类 URL 被探测 ——
 *   1. mhclaw-workspace://fs/<session>/<rel>  ← session 绑定的 task folder 内
 *   2. mhclaw-authorized://fs/<abs>           ← 白名单目录内
 *   3. 绝对路径 /abs/path                      ← 必须命中 authorized 校验
 * 其他(http / canvas / 相对路径)不走这里,UI 侧直接 fetch HEAD。
 */

export interface FileProbeResult {
  exists: boolean;
  size?: number;
  mtime?: number;
  error?: string;
}

export function probeFileByUrl(input: string): FileProbeResult {
  if (typeof input !== "string" || input.length === 0) {
    return { exists: false, error: "空 URL" };
  }

  let absPath: string | null = null;
  let confine: string | null = null;

  try {
    if (input.startsWith("mhclaw-workspace://")) {
      const url = new URL(input);
      if (url.hostname !== "fs") {
        return { exists: false, error: "workspace URL host 必须是 fs" };
      }
      const parts = url.pathname.replace(/^\/+/, "").split("/");
      const sessionKey = decodeURIComponent(parts.shift() ?? "");
      const rel = parts.map(decodeURIComponent).join("/");
      if (!sessionKey) return { exists: false, error: "URL 缺 sessionKey" };
      const base = getFolderForSession(sessionKey);
      if (!base) return { exists: false, error: "session 未绑定 task folder" };
      absPath = path.resolve(path.join(base, rel));
      confine = path.resolve(base);
    } else if (input.startsWith("mhclaw-authorized://")) {
      const url = new URL(input);
      if (url.hostname !== "fs") {
        return { exists: false, error: "authorized URL host 必须是 fs" };
      }
      const abs = decodeURIComponent(url.pathname || "");
      if (!abs || !path.isAbsolute(abs)) {
        return { exists: false, error: "URL 缺绝对路径" };
      }
      if (!isAuthorized(abs)) return { exists: false, error: "路径未授权" };
      absPath = path.resolve(abs);
    } else if (path.isAbsolute(input)) {
      // 用户消息里的绝对路径形式 —— 必须在 authorized dirs 里
      if (!isAuthorized(input)) return { exists: false, error: "路径未授权" };
      absPath = path.resolve(input);
    } else {
      return { exists: false, error: "不支持的 URL 形式" };
    }
  } catch (err) {
    return {
      exists: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!absPath) return { exists: false, error: "无法解析 URL" };

  // 防 ../ 穿越:confine 校验
  if (confine) {
    if (absPath !== confine && !absPath.startsWith(confine + path.sep)) {
      return { exists: false, error: "路径越界" };
    }
  }

  try {
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      // embed 目标一般是文件;目录视为 ready 没意义,标 error
      return { exists: false, error: "目标是目录,不能预览" };
    }
    return { exists: true, size: stat.size, mtime: stat.mtimeMs };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { exists: false };
    return { exists: false, error: code ?? String(err) };
  }
}
