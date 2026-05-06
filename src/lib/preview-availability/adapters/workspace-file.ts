import { makeFileAdapter } from "./file-base";

/**
 * mhclaw-workspace://fs/<encoded-sessionKey>/<rel> ——
 * 指向当前会话绑定的 task folder 里的文件。
 * 最常见场景:AI 产出的 md / xlsx / html 报告。
 */
export const workspaceFileAdapter = makeFileAdapter(
  "workspace-file",
  (url) => url.startsWith("mhclaw-workspace://"),
);
