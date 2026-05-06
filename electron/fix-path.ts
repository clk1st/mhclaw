import { execSync } from "node:child_process";

/**
 * On packaged macOS, the main process only inherits launchd's bare-bones
 * PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) when launched from Finder /
 * Dock / Spotlight. That means no `/opt/homebrew/bin`, no
 * `/usr/local/bin`, and none of the nvm-managed node paths — so
 * `spawn("npx")` immediately fails with ENOENT.
 *
 * This is the well-known Electron-on-macOS gotcha. The Gateway
 * subprocess works around it via OpenClaw's own shell-env fallback,
 * but the main process (e.g. mcp-probe) doesn't, hence the failures.
 *
 * Workaround mirrors the npm packages `fix-path` / `shell-env`:
 * synchronously run a login shell once, read its PATH, and overwrite
 * `process.env.PATH`. Falls back to a hard-coded common-paths list on
 * failure.
 *
 * Only runs on darwin / linux; Windows doesn't have this issue.
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

  // Already good enough — leave it alone (dev mode launched from a
  // terminal already has a full PATH).
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

  // Couldn't read it from the shell — fall back to the common path
  // list (at least lets us find brew-installed node).
  const extra = DARWIN_FALLBACK_PATHS.filter((p) => !before.includes(p));
  if (extra.length > 0) {
    process.env.PATH = [before, ...extra].filter(Boolean).join(":");
  }
}

function readShellPath(): string | null {
  const shell = process.env.SHELL || "/bin/sh";
  try {
    // -l = login shell (sources ~/.zprofile etc.), -c = run a string.
    // `printf` is safer than `echo` (no trailing-newline ambiguity);
    // redirect stderr to silence interactive prompts.
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
