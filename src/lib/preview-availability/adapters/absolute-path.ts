import { makeFileAdapter } from "./file-base";

/**
 * 用户或 AI 在 embed 里直接给了本地绝对路径,例:
 *   [embed url="/Users/ycyang/mhclaw/20260421/report.md" /]       (macOS / Linux)
 *   [embed url="C:\Users\ryan\mhclaw\20260421\report.md" /]       (Windows)
 *   [embed url="C:/Users/ryan/mhclaw/20260421/report.md" /]       (Windows / 正斜杠)
 *
 * 主进程会做 isAuthorized() 校验,不在白名单直接 error。
 * 这比 workspace:// 更宽松(不依赖 session 绑定),
 * 但要求用户提前把目录加到授权列表。
 */
export const absolutePathAdapter = makeFileAdapter(
  "absolute-path",
  (url) => {
    // Windows:盘符 + 冒号 + 斜杠(C:\... 或 C:/...)
    if (/^[A-Za-z]:[\\/]/.test(url)) return true;
    // Unix:以 / 开头
    if (
      url.startsWith("/") &&
      !url.startsWith("//") &&
      !url.includes("://") &&
      // /__openclaw__/canvas/... 交给 canvas adapter 处理
      !url.startsWith("/__openclaw__/")
    ) {
      return true;
    }
    return false;
  },
);
