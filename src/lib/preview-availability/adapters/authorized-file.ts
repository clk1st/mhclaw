import { makeFileAdapter } from "./file-base";

/**
 * mhclaw-authorized://fs/<encoded-abs-path> ——
 * 指向用户白名单目录里的文件。主进程会做 isAuthorized() 校验。
 */
export const authorizedFileAdapter = makeFileAdapter(
  "authorized-file",
  (url) => url.startsWith("mhclaw-authorized://"),
);
