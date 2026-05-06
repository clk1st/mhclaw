import { execSync } from "node:child_process";

/**
 * 打包后的 macOS app 从 Finder / Dock / Spotlight 启动时,主进程 PATH 只继承
 * launchd 的极简默认值(/usr/bin:/bin:/usr/sbin:/sbin),没有 /opt/homebrew/bin、
 * /usr/local/bin、nvm 管理的 node 路径。结果就是主进程 spawn("npx") 立刻 ENOENT。
 *
 * 这是 Electron macOS 桌面应用的通病。Gateway 子进程里 OpenClaw 自己做了 shell-env
 * fallback,能规避;但主进程(mcp-probe)没有,于是 probe 失败。
 *
 * 做法跟业界 npm 包 `fix-path` / `shell-env` 一致:同步执行 login shell 一次,
 * 读它的 PATH,覆盖 process.env.PATH。失败就退到"常见路径拼接"兜底。
 *
 * 只在 darwin / linux 做;Windows 没这问题。
 */

const DARWIN_FALLBACK_PATHS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
];

export function fixProcessPath(): void {
  if (process.platform === "win32") return;

  const before = process.env.PATH ?? "";

  // 已经足够好就不动(dev 模式从 Terminal 启,PATH 本身完整)
  if (
    before.includes("/opt/homebrew/bin") ||
    before.includes("/usr/local/bin")
  ) {
    return;
  }

  const shellPath = readShellPath();
  if (shellPath) {
    process.env.PATH = shellPath;
    return;
  }

  // shell 读不到,兜底拼常见路径(至少能找到 brew 装的 node)
  const extra = DARWIN_FALLBACK_PATHS.filter((p) => !before.includes(p));
  if (extra.length > 0) {
    process.env.PATH = [before, ...extra].filter(Boolean).join(":");
  }
}

function readShellPath(): string | null {
  const shell = process.env.SHELL || "/bin/sh";
  try {
    // -l = login shell(读 ~/.zprofile 等),-c = 执行字符串
    // printf 比 echo 更稳(没有尾部换行的歧义),重定向 stderr 避免交互式提示
    const out = execSync(`${shell} -ilc 'printf "%s" "$PATH"'`, {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const trimmed = out.trim();
    if (trimmed && trimmed.includes("/")) return trimmed;
    return null;
  } catch {
    return null;
  }
}
