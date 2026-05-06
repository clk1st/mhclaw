import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  nativeImage,
  session,
  systemPreferences,
  powerSaveBlocker,
  Menu,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { GatewayManager, type GatewayStatus } from "./gateway-manager.js";
import { DEFAULT_GATEWAY_PORT, APP_NAME, getStateDir, getConfigPath, getMcpRunsDir } from "./constants.js";
import {
  ensureWorkRoot,
  getWorkRoot,
  listOutputDirs,
  removeOutputDirFromIndex,
  setWorkRoot,
  togglePin,
} from "./services/work-root.js";
import {
  bindExternalFolder,
  bindSessionToFolder,
  createBlankTask,
  getFolderForSession,
  remapSessionKey,
} from "./services/task-folder.js";
import {
  addArtifactsForSession,
  listArtifactsForSession,
  type AddInput as ArtifactAddInput,
} from "./services/artifacts.js";
import { ensureAgentsMdContribution } from "./services/agents-md.js";
import {
  registerSchemes as registerProtocolSchemes,
  registerHandlers as registerProtocolHandlers,
} from "./services/protocols.js";
import {
  addAuthorizedDir,
  listAuthorizedDirs,
  removeAuthorizedDir,
} from "./services/authorized-dirs.js";
import {
  probeMcpServer,
  probeMcpServers,
  type McpProbeResult,
  type McpServerConfigLike,
} from "./services/mcp-probe.js";
import {
  McpRegistry,
  readLegacyMcpServers,
} from "./services/mcp-registry.js";
import { McpSupervisor } from "./services/mcp-supervisor.js";
import { McpBroker } from "./services/mcp-broker.js";
import type {
  McpServerConfig,
  McpHealth,
  McpRunSnapshotEntry,
} from "./services/mcp-types.js";
import { probeFileByUrl } from "./services/preview-probe.js";
import {
  captureBaseline,
  computeDiff,
  ensureBaseline,
  hasBaseline,
  readBaselineText,
  readCurrentText,
} from "./services/snapshot.js";
import {
  startWatching,
  stopWatching,
  installAuthorizedWatchers,
  refreshAuthorizedWatchers,
  closeAllAuthorizedWatchers,
  type WatcherEvent,
} from "./services/file-watcher.js";
import { deleteFile, listChildren, writeTextFile } from "./services/fs-tree.js";
import { fixProcessPath } from "./fix-path.js";
import { setupMainLogger } from "./services/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// App name shown in the macOS menu bar and Cmd+Tab.
app.setName(APP_NAME);

// File-based logger for the main process. Packaged builds drop console
// output, so we mirror every console.{log,warn,error} into
// ~/.mhclaw/logs/mhclaw_main.log — when something breaks, "send me your
// log" gives us a fast triage path.
setupMainLogger();

// When macOS launches the app from Finder/Dock, PATH is only
// `/usr/bin:/bin:/usr/sbin:/sbin`, so any `spawn npx / node` from the main
// process would fail with ENOENT. We patch PATH early so it propagates
// through to mcp-probe, the Gateway env, and any other subprocess.
fixProcessPath();

/**
 * Load the app icon:
 *   - Prefer `electron/assets/icon.png` (PNG works most reliably with
 *     Electron's nativeImage / macOS Dock; electron-builder also picks
 *     this up at packaging time).
 *   - Fallback to `electron/assets/logo.svg` (inline vector, fine in dev;
 *     macOS Dock support for SVG is shaky).
 * Returns null if neither is available — the dock/window then falls back
 * to the default Electron icon (the gray default).
 */
function loadAppIcon(): Electron.NativeImage | null {
  const pngPath = path.join(__dirname, "assets/icon.png");
  if (fs.existsSync(pngPath)) {
    const img = nativeImage.createFromPath(pngPath);
    if (!img.isEmpty()) return img;
  }
  const svgPath = path.join(__dirname, "assets/logo.svg");
  if (fs.existsSync(svgPath)) {
    try {
      const svg = fs.readFileSync(svgPath, "utf-8");
      const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
      const img = nativeImage.createFromDataURL(dataUrl);
      if (!img.isEmpty()) return img;
    } catch (err) {
      console.warn("[main] load logo.svg failed:", err);
    }
  }
  return null;
}

const appIcon = loadAppIcon();

/**
 * Inject CORS headers on responses from the mhwork-api host so that the
 * renderer (origin http://127.0.0.1:<port>) isn't blocked by browser CORS
 * when fetching from it.
 *
 * Whitelisted hosts: `clawapi.metrichub.app` and the value of
 * `MHWORK_API_URL` (if the user overrides). No other origin is touched —
 * we only mutate response headers for these specific hosts.
 *
 * NOTE: this only rewrites response headers; it does NOT set
 * `webSecurity: false`, so cross-origin protections remain intact for
 * everything else.
 */
/**
 * Build the production menu (no View → Reload / DevTools).
 * macOS requires keeping the App menu (first position, titled via
 * `process.env.name`).
 */
function buildProdMenu(): Electron.Menu {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "close", label: "关闭" },
        ...(isMac
          ? ([
              { type: "separator" },
              { role: "front", label: "全部置于顶层" },
            ] as Electron.MenuItemConstructorOptions[])
          : []),
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

function installApiCorsBypass() {
  const allowedHosts = new Set<string>();
  allowedHosts.add("clawapi.metrichub.app");
  // Allow override via env (useful for backend dev against a local server).
  const envUrl = process.env.MHWORK_API_URL;
  if (envUrl) {
    try {
      allowedHosts.add(new URL(envUrl).hostname);
    } catch {
      /* ignore */
    }
  }
  const hostPattern = (url: string): boolean => {
    try {
      return allowedHosts.has(new URL(url).hostname);
    } catch {
      return false;
    }
  };

  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ["https://*/*", "http://*/*"] },
    (details, callback) => {
      if (!hostPattern(details.url)) {
        callback({});
        return;
      }
      const headers = { ...(details.responseHeaders ?? {}) };

      // Only inject Access-Control-Allow-* headers if the backend hasn't
      // already returned them. If it has (e.g. in dev when the Vite origin
      // localhost:40173 is on the backend CORS whitelist), adding "*" on
      // top causes a "multiple values" browser error.
      // Electron's responseHeaders key casing is not predictable, so we do
      // a case-insensitive "already present?" check first.
      const hasHeader = (name: string): boolean => {
        const lower = name.toLowerCase();
        return Object.keys(headers).some((k) => k.toLowerCase() === lower);
      };

      if (!hasHeader("Access-Control-Allow-Origin")) {
        headers["Access-Control-Allow-Origin"] = ["*"];
      }
      if (!hasHeader("Access-Control-Allow-Methods")) {
        headers["Access-Control-Allow-Methods"] = [
          "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        ];
      }
      if (!hasHeader("Access-Control-Allow-Headers")) {
        headers["Access-Control-Allow-Headers"] = [
          "Content-Type, Authorization",
        ];
      }
      if (!hasHeader("Access-Control-Allow-Credentials")) {
        headers["Access-Control-Allow-Credentials"] = ["true"];
      }

      // Critical: if the preflight (OPTIONS) returns 4xx, the browser
      // fails on the status before even reading the CORS headers, leaving
      // the renderer with "Failed to fetch". Force the preflight status
      // to 200 so the renderer can proceed with the actual request.
      const override: Electron.HeadersReceivedResponse = {
        responseHeaders: headers,
      };
      if (details.method === "OPTIONS" && details.statusCode >= 400) {
        override.statusLine = "HTTP/1.1 200 OK";
      }
      callback(override);
    },
  );
}

let mainWindow: BrowserWindow | null = null;
const gatewayManager = new GatewayManager({ port: DEFAULT_GATEWAY_PORT });

// MCP subsystem — registry / supervisor / broker.
// Startup order: registry.init → supervisor.init (background probe, non-
//   blocking) → broker.start (acquires port) → gatewayManager
//   .setBrokerEndpoint → gatewayManager.start (writes mhclaw.json +
//   spawns the gateway).
const mcpRegistry = new McpRegistry();
const mcpSupervisor = new McpSupervisor(mcpRegistry);
const mcpBroker = new McpBroker(mcpRegistry, mcpSupervisor);

// Broadcast supervisor health changes to every renderer window so the
// 5-state MCP UI updates in real time.
mcpSupervisor.on("health-changed", (evt: { name: string; health?: McpHealth; removed?: boolean }) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("mcp:health-changed", evt);
    }
  }
});

// Register custom protocol schemes (must happen before app.ready).
registerProtocolSchemes();

// ===== Deep Link: mhclaw:// protocol (primary path) =====
// Register mhclaw:// as a default client (Electron's recommended pattern,
// combined with single-instance handling).
if (process.defaultApp) {
  // In dev (`node_modules/.bin/electron .`) the script path also needs
  // to be registered alongside the executable.
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("mhclaw", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient("mhclaw");
}

// Single-instance lock: on Windows / Linux the deep link is delivered as
// a process argv. We need exactly one instance alive; subsequent launches
// forward the URL via the `second-instance` event.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let pendingAuthDeepLink: string | null = null;

function handleAuthDeepLink(url: string): void {
  try {
    const u = new URL(url);
    if (u.protocol !== "mhclaw:") return;
  } catch {
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("auth:deeplink", url);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else {
    // Cold start — window isn't ready yet. Stash the URL; we'll dispatch
    // it after did-finish-load.
    pendingAuthDeepLink = url;
  }
}

app.on("second-instance", (_event, argv) => {
  // Deep links arrive here on Windows / Linux.
  const url = argv.find((a) => typeof a === "string" && a.startsWith("mhclaw://"));
  if (url) handleAuthDeepLink(url);
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on("open-url", (event, url) => {
  // Deep links arrive here on macOS.
  event.preventDefault();
  handleAuthDeepLink(url);
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: APP_NAME,
    icon: appIcon ?? undefined,
    // macOS: hide the title bar and float the traffic-light buttons over
    // the content so the TopBar shares the same row (matching WorkBuddy).
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition:
      process.platform === "darwin" ? { x: 14, y: 14 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In dev we load from the Vite dev server; in prod we serve via a local
  // HTTP server. (Packaged builds end up at a `file://` origin which the
  // Gateway rejects; we need `http://` for the WebSocket handshake.)
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    // DevTools auto-opens in dev so console errors are visible.
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    const distDir = path.join(__dirname, "../dist");
    startStaticServer(distDir).then((url) => {
      mainWindow!.loadURL(url);
    });
  }

  // Cold start: a deep link can arrive before the window is ready.
  // Dispatch any stashed URL to the renderer once it's done loading.
  mainWindow.webContents.on("did-finish-load", () => {
    if (pendingAuthDeepLink && mainWindow) {
      mainWindow.webContents.send("auth:deeplink", pendingAuthDeepLink);
      pendingAuthDeepLink = null;
    }
  });

  // In packaged builds, disable Cmd/Ctrl+R reload, F12 / Cmd+Opt+I /
  // Cmd+Shift+I DevTools shortcuts, and the right-click "Inspect" menu.
  // This is a workbench, not a webpage — reloading interrupts in-flight
  // tasks, and DevTools is meaningless for end users. Dev mode
  // (VITE_DEV_SERVER_URL) keeps default behavior.
  if (app.isPackaged) {
    mainWindow.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const cmd = process.platform === "darwin" ? input.meta : input.control;
      const key = input.key.toLowerCase();
      // Reload
      if (cmd && key === "r") {
        event.preventDefault();
        return;
      }
      // DevTools
      if (key === "f12") {
        event.preventDefault();
        return;
      }
      if (cmd && input.shift && key === "i") {
        event.preventDefault();
        return;
      }
      if (cmd && input.alt && key === "i") {
        event.preventDefault();
        return;
      }
    });
    mainWindow.webContents.on("devtools-opened", () => {
      mainWindow?.webContents.closeDevTools();
    });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Push gateway status changes to the renderer.
// We tag the latest auth token along — the Gateway writes its token to
// the config a little after startup; `watchForAuthToken` re-emits status
// once the token shows up, and we attach it here so the renderer can
// update gw.token and reconnect immediately.
gatewayManager.setStatusListener((status: GatewayStatus) => {
  const token = gatewayManager.getAuthToken();
  mainWindow?.webContents.send("gateway:status-changed", { ...status, token });
});

// IPC: embedded Gateway control
ipcMain.handle("gateway:start", () => gatewayManager.start());
ipcMain.handle("gateway:stop", () => gatewayManager.stop());
ipcMain.handle("gateway:restart", () => gatewayManager.restart());
ipcMain.handle("gateway:status", () => ({
  isRunning: gatewayManager.isRunning,
  port: gatewayManager.port,
  pid: gatewayManager.pid,
  token: gatewayManager.getAuthToken(),
}));

// IPC: window control
ipcMain.handle("window:minimize", () => mainWindow?.minimize());
ipcMain.handle("window:maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.handle("window:close", () => mainWindow?.close());

// IPC: skill file operations
const getSkillsDir = () => path.join(getStateDir(), "workspace", "skills");

ipcMain.handle("skills:fetchFromGithub", async (_event, url: string) => {
  // Extract owner/repo from a GitHub URL and build the raw URL for SKILL.md.
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) throw new Error("Invalid GitHub URL");
  const [, owner, repo] = match;
  const repoName = repo.replace(/\.git$/, "");

  // Try `main` then `master`.
  for (const branch of ["main", "master"]) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/SKILL.md`;
    try {
      const res = await fetch(rawUrl);
      if (!res.ok) continue;
      const content = await res.text();

      const skillDir = path.join(getSkillsDir(), repoName);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), content);
      return { name: repoName, content };
    } catch {
      continue;
    }
  }
  throw new Error("SKILL.md not found in the repository");
});

ipcMain.handle("skills:saveSkillFile", async (_event, name: string, content: string) => {
  const skillDir = path.join(getSkillsDir(), name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), content);
  return { name };
});

ipcMain.handle("skills:openFileDialog", async () => {
  if (!mainWindow) throw new Error("Window not available");
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select a skill zip",
    filters: [{ name: "Skill package", extensions: ["zip"] }],
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return { zipPath: result.filePaths[0] };
});

/**
 * Install a skill from a zip:
 *   1. Extract to ~/.mhclaw/workspace/skills/<name>/
 *   2. Resolve `name` in this priority order:
 *        a. The zip's single top-level directory (if exactly one).
 *        b. The `name` field in SKILL.md frontmatter.
 *        c. Fallback to the zip filename (with version/extension stripped).
 *   3. If the zip's top level is a single directory (e.g. tencent-docs/
 *      SKILL.md), treat that whole directory as the skill.
 *   4. If SKILL.md is at the root, use the zip filename as the skill name.
 *
 * Returns `{ name }` for the renderer toast.
 */
ipcMain.handle("skills:installZip", async (_event, zipPath: string) => {
  if (!zipPath || !fs.existsSync(zipPath)) {
    throw new Error("zip file not found");
  }
  const { default: AdmZip } = await import("adm-zip");
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  if (entries.length === 0) throw new Error("zip is empty");

  // Inspect top-level layout: a single directory? Or SKILL.md at the root?
  // Each entry.entryName is a posix path (e.g. "tencent-docs/SKILL.md", "SKILL.md").
  const topSegments = new Set<string>();
  let hasRootSkillMd = false;
  for (const e of entries) {
    const parts = e.entryName.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    topSegments.add(parts[0]);
    if (parts.length === 1 && parts[0].toLowerCase() === "skill.md") {
      hasRootSkillMd = true;
    }
  }

  let skillName: string;
  let stripTopDir: string | null = null;
  if (hasRootSkillMd) {
    // SKILL.md at root → derive name from zip filename (drop version + ext).
    const base = path.basename(zipPath, path.extname(zipPath));
    skillName = base.replace(/[-_]?v?\d+(\.\d+)*$/i, "").trim() || base;
  } else if (topSegments.size === 1) {
    const top = Array.from(topSegments)[0];
    skillName = top;
    stripTopDir = top;
  } else {
    // Multiple top-level directories — fall back to the zip filename.
    skillName = path.basename(zipPath, path.extname(zipPath));
  }

  // Refuse to overwrite an existing skill — user must delete first.
  const skillsDir = getSkillsDir();
  fs.mkdirSync(skillsDir, { recursive: true });
  const targetDir = path.join(skillsDir, skillName);
  if (fs.existsSync(targetDir)) {
    throw new Error(`Skill "${skillName}" already exists; delete it first.`);
  }
  fs.mkdirSync(targetDir, { recursive: true });

  // Extract; optionally strip the top-level directory.
  for (const e of entries) {
    if (e.isDirectory) continue;
    let rel = e.entryName;
    if (stripTopDir && rel.startsWith(stripTopDir + "/")) {
      rel = rel.slice(stripTopDir.length + 1);
    }
    if (!rel) continue;
    const destPath = path.join(targetDir, rel);
    // Zip-slip protection.
    if (!destPath.startsWith(targetDir + path.sep) && destPath !== targetDir) {
      continue;
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, e.getData());
  }

  // If SKILL.md frontmatter declares a `name`, use it to refine skillName
  // for the toast (the on-disk directory name is kept as-is).
  try {
    const skillMdPath = path.join(targetDir, "SKILL.md");
    if (fs.existsSync(skillMdPath)) {
      const md = fs.readFileSync(skillMdPath, "utf-8");
      const m = md.match(/^---\s*\n([\s\S]*?)\n---/);
      if (m) {
        const nameLine = m[1].match(/^name:\s*(.+)$/m);
        if (nameLine) skillName = nameLine[1].trim() || skillName;
      }
    }
  } catch {
    // ignore — fall back to the directory name.
  }

  return { name: skillName, path: targetDir };
});

ipcMain.handle("skills:deleteCustomSkill", async (_event, name: string) => {
  const rootDir = getSkillsDir();
  if (!fs.existsSync(rootDir)) return;

  // Fast path: directory name matches when skillKey == directory slug.
  const direct = path.join(rootDir, name);
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) {
    fs.rmSync(direct, { recursive: true });
    return;
  }

  // Gateway's skills.status sometimes returns a display name as the
  // skillKey (e.g. "Excel / XLSX" → directory excel-xlsx), in which case
  // a plain path join misses. Walk the skills root and match by SKILL.md
  // frontmatter name / slug instead.
  const target = name.trim();
  const entries = fs.readdirSync(rootDir);
  for (const entry of entries) {
    const skillDir = path.join(rootDir, entry);
    const mdFile = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(mdFile)) continue;
    try {
      const content = fs.readFileSync(mdFile, "utf-8");
      const fm = content.match(/^---\s*\n([\s\S]*?)\n---/);
      if (!fm) continue;
      const block = fm[1];
      const frontmatterName = block.match(/^name:\s*(.+)$/m)?.[1].trim() ?? "";
      const frontmatterSlug = block.match(/^slug:\s*(.+)$/m)?.[1].trim() ?? "";
      if (
        frontmatterName === target ||
        frontmatterSlug === target ||
        entry === target
      ) {
        fs.rmSync(skillDir, { recursive: true });
        return;
      }
    } catch {
      continue;
    }
  }
  // Not found: silently no-op. May belong to the bundled / managed layer,
  // which is not this handler's concern.
});

/**
 * Download a skill zip and extract it to
 * `~/.mhclaw/workspace/skills/<slug>/`. Used by SkillHub one-click install.
 *
 * Supports two zip layouts:
 *   A) Flat root (hub standard): /SKILL.md /_meta.json ...
 *   B) Wrapped in a slug directory: /<slug>/SKILL.md ...
 *
 * We extract to a temp dir, detect whether the top level is a single
 * directory (B) or loose files (A), then move into `skills/<slug>/` for
 * a uniform layout.
 */
ipcMain.handle(
  "skills:installFromUrl",
  async (
    _event,
    {
      url,
      slug,
      meta,
    }: {
      url: string;
      slug: string;
      /** Hub-side metadata; we write a sidecar after install so the UI
       *  can override displayName, etc. */
      meta?: {
        displayName?: string;
        description?: string;
        tags?: string[];
        channel?: string;
        version?: string;
        source?: string;
      };
    },
  ) => {
    if (!slug || !/^[a-z0-9._-]+$/i.test(slug)) throw new Error("Invalid slug");

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());

    const tmpZip = path.join(getStateDir(), "cache", `${slug}-${Date.now()}.zip`);
    fs.mkdirSync(path.dirname(tmpZip), { recursive: true });
    fs.writeFileSync(tmpZip, buffer);

    const tmpExtract = path.join(
      getStateDir(),
      "cache",
      `${slug}-${Date.now()}-extract`,
    );
    fs.mkdirSync(tmpExtract, { recursive: true });

    try {
      const { default: AdmZip } = await import("adm-zip");
      const zip = new AdmZip(tmpZip);
      zip.extractAllTo(tmpExtract, true);

      const entries = fs.readdirSync(tmpExtract, { withFileTypes: true });
      // Detect the "single top-level directory" layout.
      const rootDir =
        entries.length === 1 && entries[0].isDirectory()
          ? path.join(tmpExtract, entries[0].name)
          : tmpExtract;

      const targetRoot = getSkillsDir();
      fs.mkdirSync(targetRoot, { recursive: true });
      const installedDir = path.join(targetRoot, slug);
      // Reinstall: nuke the target if it exists, then copy from rootDir.
      if (fs.existsSync(installedDir)) {
        fs.rmSync(installedDir, { recursive: true, force: true });
      }
      fs.cpSync(rootDir, installedDir, { recursive: true });

      // Write the hub sidecar (UI reads it to override displayName, etc.).
      if (meta) {
        try {
          fs.writeFileSync(
            path.join(installedDir, ".mhclaw-hub.json"),
            JSON.stringify(
              {
                slug,
                source: meta.source ?? "skills.metrichub.app",
                installedAt: Date.now(),
                displayName: meta.displayName,
                description: meta.description,
                tags: meta.tags,
                channel: meta.channel,
                version: meta.version,
              },
              null,
              2,
            ),
          );
        } catch {
          // Sidecar write failure shouldn't block install.
        }
      }

      return { path: installedDir, size: buffer.length };
    } finally {
      try {
        fs.unlinkSync(tmpZip);
      } catch {
        /* ignore */
      }
      try {
        fs.rmSync(tmpExtract, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  },
);

/**
 * Batch-read every `workspace/skills/<slug>/.mhclaw-hub.json` and return
 * the result as a map. The UI overlays the hub's `displayName` on top of
 * the English `SKILL.md` name. Skills not installed via the hub have no
 * sidecar and aren't keyed in the result.
 */
ipcMain.handle("skills:readHubSidecars", async () => {
  const root = getSkillsDir();
  const map: Record<
    string,
    {
      slug: string;
      displayName?: string;
      description?: string;
      tags?: string[];
      channel?: string;
      version?: string;
      source?: string;
      installedAt?: number;
      /**
       * The `name` field from SKILL.md frontmatter, returned for
       * UI lookup. Gateway's skills.status sometimes returns the
       * SKILL.md name as `skillKey` instead of the directory slug,
       * and the renderer can't read SKILL.md directly — we fetch it
       * here in the main process so the UI has both.
       */
      mdName?: string;
    }
  > = {};
  if (!fs.existsSync(root)) return map;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return map;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const sidecar = path.join(root, ent.name, ".mhclaw-hub.json");
    if (!fs.existsSync(sidecar)) continue;
    try {
      const raw = fs.readFileSync(sidecar, "utf8");
      const data = JSON.parse(raw);
      // Also read the SKILL.md frontmatter `name` as an alias so the UI
      // can match across both display name and slug.
      let mdName: string | undefined;
      const mdFile = path.join(root, ent.name, "SKILL.md");
      if (fs.existsSync(mdFile)) {
        try {
          const md = fs.readFileSync(mdFile, "utf8");
          const fm = md.match(/^---\s*\n([\s\S]*?)\n---/);
          if (fm) {
            const m = fm[1].match(/^name:\s*(.+)$/m);
            if (m) mdName = m[1].trim();
          }
        } catch {
          /* ignore */
        }
      }
      map[ent.name] = { ...data, mdName };
    } catch {
      // Ignore corrupt sidecar files.
    }
  }
  return map;
});

/**
 * Read a skill's SKILL.md source. Lookup order (high to low priority):
 *   1. workspace/skills/<name>/SKILL.md         (highest)
 *   2. ~/.mhclaw/skills/<name>/SKILL.md         (managed)
 *   3. node_modules/openclaw/skills/<name>/SKILL.md  (bundled)
 *
 * Used by the skill detail Dialog's "raw source" view.
 */
ipcMain.handle("skills:getMd", async (_event, name: string) => {
  if (!name || typeof name !== "string") throw new Error("skill name required");

  // Resolve the OpenClaw bundled skills root (same approach as gateway-manager).
  const { createRequire } = await import("node:module");
  const req = createRequire(path.join(__dirname, "package.json"));
  let bundledRoot = "";
  try {
    const pkgMain = req.resolve("openclaw");
    const pkgRoot = path.resolve(path.dirname(pkgMain), "..");
    bundledRoot = path.join(pkgRoot, "skills");
    // Handle the asar-packaged case.
    if (bundledRoot.includes("app.asar" + path.sep) || bundledRoot.includes("app.asar/")) {
      bundledRoot = bundledRoot.replace(/app\.asar(?=[\\/])/, "app.asar.unpacked");
    }
  } catch {
    // Doesn't matter — workspace / managed lookups can still find it.
  }

  const candidates: Array<{ source: string; file: string }> = [
    { source: "workspace", file: path.join(getSkillsDir(), name, "SKILL.md") },
    {
      source: "managed",
      file: path.join(getStateDir(), "skills", name, "SKILL.md"),
    },
    ...(bundledRoot
      ? [{ source: "bundled", file: path.join(bundledRoot, name, "SKILL.md") }]
      : []),
  ];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c.file)) {
        const content = fs.readFileSync(c.file, "utf-8");
        return { source: c.source, path: c.file, content };
      }
    } catch {
      continue;
    }
  }

  // Fallback: Gateway's skills.status sometimes returns the **display
  // name** as skillKey for non-standard skills (e.g. SkillHub installs
  // like "Excel / XLSX", "Word / DOCX") instead of the directory slug.
  // Path-by-name lookup misses those. Walk workspace + managed, parse
  // each SKILL.md frontmatter, and match by name / slug. Cost is ~tens of
  // existsSync + read calls — fast enough.
  const scanRoots = [
    { source: "workspace", dir: getSkillsDir() },
    { source: "managed", dir: path.join(getStateDir(), "skills") },
    ...(bundledRoot ? [{ source: "bundled", dir: bundledRoot }] : []),
  ];
  const target = name.trim();
  for (const { source, dir } of scanRoots) {
    if (!fs.existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const file = path.join(dir, entry, "SKILL.md");
      if (!fs.existsSync(file)) continue;
      try {
        const content = fs.readFileSync(file, "utf-8");
        // Simple frontmatter name / slug match (no full YAML parser
        // needed — OpenClaw's frontmatter is just a `--- key: value ---`
        // block).
        const fm = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (!fm) continue;
        const block = fm[1];
        const nameMatch = block.match(/^name:\s*(.+)$/m);
        const slugMatch = block.match(/^slug:\s*(.+)$/m);
        const frontmatterName = nameMatch ? nameMatch[1].trim() : "";
        const frontmatterSlug = slugMatch ? slugMatch[1].trim() : "";
        if (
          frontmatterName === target ||
          frontmatterSlug === target ||
          entry === target
        ) {
          return { source, path: file, content };
        }
      } catch {
        continue;
      }
    }
  }

  throw new Error(`SKILL.md not found for "${name}"`);
});

// IPC: work root
ipcMain.handle("workRoot:get", () => getWorkRoot());
ipcMain.handle("workRoot:set", async (_e, newPath: string) => setWorkRoot(newPath));
ipcMain.handle("workRoot:pickAndSet", async () => {
  if (!mainWindow) throw new Error("Window not available");
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "Choose mhclaw work-root directory",
    properties: ["openDirectory", "createDirectory"],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return setWorkRoot(res.filePaths[0]);
});

// IPC: task folders
ipcMain.handle("taskFolder:listRecent", () => listOutputDirs());
ipcMain.handle("taskFolder:createBlank", async (_e, sessionKey?: string) => {
  const result = createBlankTask(sessionKey ? { sessionKey } : undefined);
  if (sessionKey) bindSessionToFolder(sessionKey, result.path);
  ensureBaseline(result.path);
  return result;
});
ipcMain.handle("taskFolder:pickExternal", async (_e, sessionKey?: string) => {
  if (!mainWindow) throw new Error("Window not available");
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "Choose a task output directory",
    properties: ["openDirectory", "createDirectory"],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const r = bindExternalFolder(res.filePaths[0], sessionKey ? { sessionKey } : undefined);
  if (sessionKey) bindSessionToFolder(sessionKey, r.path);
  ensureBaseline(r.path);
  return r;
});
ipcMain.handle(
  "taskFolder:bindSession",
  async (_e, { sessionKey, path: taskPath }: { sessionKey: string; path: string }) => {
    bindSessionToFolder(sessionKey, taskPath);
    ensureBaseline(taskPath);
    return { ok: true };
  },
);
ipcMain.handle("taskFolder:getForSession", (_e, sessionKey: string) =>
  getFolderForSession(sessionKey),
);
/**
 * ensureForSession:
 *   If already bound → return as-is. If not → createBlank + bind.
 *   Idempotent, lazy. Primary callers:
 *     - chat-store.sendMessage (creates only when actually about to send,
 *       avoiding empty-folder noise),
 *     - AssistantFinal (safety net so artifacts can always land on disk).
 */
ipcMain.handle(
  "taskFolder:remapSession",
  async (_e, { oldKey, newKey }: { oldKey: string; newKey: string }) => {
    remapSessionKey(oldKey, newKey);
    return { ok: true };
  },
);
ipcMain.handle("taskFolder:ensureForSession", async (_e, sessionKey: string) => {
  if (!sessionKey) throw new Error("sessionKey required");
  const existing = getFolderForSession(sessionKey);
  if (existing) return { path: existing, created: false };
  const result = createBlankTask({ sessionKey });
  bindSessionToFolder(sessionKey, result.path);
  ensureBaseline(result.path);
  return { path: result.path, created: true };
});
ipcMain.handle("taskFolder:togglePin", (_e, dirPath: string) => togglePin(dirPath));
ipcMain.handle("taskFolder:removeFromIndex", (_e, dirPath: string) => {
  removeOutputDirFromIndex(dirPath);
  return { ok: true };
});
ipcMain.handle("taskFolder:openInFinder", async (_e, dirPath: string) => {
  await shell.openPath(dirPath);
  return { ok: true };
});

// IPC: artifacts (source of truth lives at <task-folder>/.mhclaw/artifacts.json)
ipcMain.handle("artifacts:list", (_e, sessionKey: string) =>
  listArtifactsForSession(sessionKey),
);
ipcMain.handle(
  "artifacts:add",
  (_e, { sessionKey, entries }: { sessionKey: string; entries: ArtifactAddInput[] }) =>
    addArtifactsForSession(sessionKey, entries),
);

// IPC: system permissions (macOS permission probe + Settings deeplink)
/**
 * Returns the status of various macOS permissions.
 * Only Accessibility can be probed directly via API; for the others
 * (Full Disk / Automation / Notifications) there's no stable API, so
 * the client just shows a "Grant access" button without any status.
 */
ipcMain.handle("system:getPermissions", () => {
  if (process.platform !== "darwin") {
    return { platform: process.platform, supported: false };
  }
  return {
    platform: "darwin",
    supported: true,
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
  };
});

/** Open macOS System Settings at the specified privacy pane. */
ipcMain.handle("system:openPrivacy", async (_e, kind: string) => {
  if (process.platform !== "darwin") return { ok: false, reason: "non-darwin" };
  const map: Record<string, string> = {
    fullDisk:
      "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
    accessibility:
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    automation:
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
    notifications: "x-apple.systempreferences:com.apple.preference.notifications",
  };
  const url = map[kind];
  if (!url) return { ok: false, reason: "unknown-kind" };
  await shell.openExternal(url);
  return { ok: true };
});

// IPC: open a URL in the user's default browser (e.g. "Register on web").
ipcMain.handle("system:openExternal", async (_e, url: string) => {
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
    return { ok: false, reason: "invalid-url" };
  }
  await shell.openExternal(url);
  return { ok: true };
});

// IPC: WeChat QR login
//   - Renderer invoke("weixin:login:start") → main process spawns the
//     openclaw CLI, watches stdout for a QR URL (e.g.
//     "https://open.work.weixin.qq.com/..."), and forwards it back via
//     the "weixin:login:qr" event (URL + message).
//   - The CLI polls login state on its own and exits on success/failure;
//     the outcome is delivered via the "weixin:login:done" event.
//   - invoke("weixin:login:cancel") kills the child process.
let weixinLoginCancel: (() => void) | null = null;
// Heuristic regex for the QR URL: any tencent / qq.com / iLink domain
// over http(s).
const WEIXIN_QR_URL_RE = /https?:\/\/[^\s]*(?:qq\.com|weixin\.qq\.com|ilink)[^\s]*/gi;

ipcMain.handle("weixin:login:start", async () => {
  if (weixinLoginCancel) {
    return { ok: false, reason: "already-running" };
  }
  const send = (channel: string, payload: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  };
  let buffered = "";
  let qrFound = false;
  weixinLoginCancel = gatewayManager.runClawCommand(
    ["channels", "login", "--channel", "openclaw-weixin", "--verbose"],
    {
      onStdout: (chunk) => {
        buffered += chunk;
        // Forward raw stdout to the renderer (UI can opt-in to display).
        send("weixin:login:log", chunk);
        if (!qrFound) {
          const match = buffered.match(WEIXIN_QR_URL_RE);
          if (match && match.length > 0) {
            qrFound = true;
            send("weixin:login:qr", { url: match[match.length - 1] });
          }
        }
      },
      onStderr: (chunk) => {
        send("weixin:login:log", chunk);
      },
      onExit: (code) => {
        weixinLoginCancel = null;
        send("weixin:login:done", { code, ok: code === 0 });
      },
    },
  );
  return { ok: true };
});

ipcMain.handle("weixin:login:cancel", async () => {
  if (weixinLoginCancel) {
    weixinLoginCancel();
    weixinLoginCancel = null;
    return { ok: true };
  }
  return { ok: false, reason: "not-running" };
});

// IPC: prevent system sleep (powerSaveBlocker)
let powerBlockerId: number | null = null;
ipcMain.handle("system:setPreventSleep", (_e, enabled: boolean) => {
  if (enabled) {
    if (powerBlockerId === null) {
      powerBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    }
  } else {
    if (powerBlockerId !== null) {
      powerSaveBlocker.stop(powerBlockerId);
      powerBlockerId = null;
    }
  }
  return {
    active:
      powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId),
  };
});
ipcMain.handle("system:getPreventSleep", () => ({
  active:
    powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId),
}));

// IPC: authorized directories. Refresh the file watcher on every add /
// remove so a newly added directory is watched immediately and a removed
// one stops being watched immediately.
async function syncAuthorizedWatchers(): Promise<void> {
  try {
    await refreshAuthorizedWatchers(listAuthorizedDirs().map((d) => d.path));
  } catch (err) {
    console.warn("[Main] refresh authorized watchers failed:", err);
  }
}
ipcMain.handle("authorizedDirs:list", () => listAuthorizedDirs());
ipcMain.handle(
  "authorizedDirs:add",
  async (_e, args: { path: string; note?: string }) => {
    const entry = addAuthorizedDir(args.path, args.note);
    await syncAuthorizedWatchers();
    return entry;
  },
);
ipcMain.handle("authorizedDirs:remove", async (_e, absPath: string) => {
  removeAuthorizedDir(absPath);
  await syncAuthorizedWatchers();
  return { ok: true };
});
ipcMain.handle("authorizedDirs:pickAndAdd", async (_e, note?: string) => {
  if (!mainWindow) throw new Error("Window not available");
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "Choose an authorized directory (AI may access it)",
    properties: ["openDirectory"],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return addAuthorizedDir(res.filePaths[0], note);
});

// IPC: MCP probe — independent of the gateway; the main process runs
// its own lightweight MCP client to fetch the tool list.
ipcMain.handle(
  "mcpProbe:one",
  async (
    _e,
    args: { config: McpServerConfigLike; timeoutMs?: number },
  ): Promise<McpProbeResult> => {
    return probeMcpServer(args.config, args.timeoutMs);
  },
);
ipcMain.handle(
  "previewProbe:checkFile",
  async (_e, args: { url: string }) => probeFileByUrl(args.url),
);

ipcMain.handle(
  "mcpProbe:all",
  async (
    _e,
    args: {
      servers: Record<string, McpServerConfigLike>;
      concurrency?: number;
      timeoutMs?: number;
    },
  ): Promise<Record<string, McpProbeResult>> => {
    return probeMcpServers(args.servers, {
      concurrency: args.concurrency,
      timeoutMs: args.timeoutMs,
    });
  },
);

// ───── IPC: MCP registry / supervisor / broker (the source of truth under the broker architecture) ─────

ipcMain.handle(
  "mcpRegistry:list",
  (): Record<string, McpServerConfig> => mcpRegistry.list(),
);
ipcMain.handle(
  "mcpRegistry:upsert",
  (_e, args: { name: string; config: McpServerConfig }) => {
    mcpRegistry.upsert(args.name, args.config);
    return { ok: true as const };
  },
);
ipcMain.handle("mcpRegistry:remove", (_e, name: string) => {
  mcpRegistry.remove(name);
  return { ok: true as const };
});
ipcMain.handle(
  "mcpRegistry:setDisabled",
  (_e, args: { name: string; disabled: boolean }) => {
    mcpRegistry.setDisabled(args.name, args.disabled);
    return { ok: true as const };
  },
);
ipcMain.handle(
  "mcpRegistry:import",
  (_e, servers: Record<string, McpServerConfig>) =>
    mcpRegistry.importBatch(servers),
);

ipcMain.handle("mcpSupervisor:status", (): McpHealth[] =>
  mcpSupervisor.snapshotHealth(),
);
ipcMain.handle("mcpSupervisor:probe", (_e, name: string) => {
  mcpSupervisor.triggerProbe(name);
  return { ok: true as const };
});

/** Read the last N snapshot entries, newest first. */
ipcMain.handle(
  "mcpBroker:snapshotTail",
  async (_e, opts: { limit?: number; brokerSessionId?: string } = {}) => {
    const limit = Math.max(1, Math.min(opts.limit ?? 200, 2000));
    const file = path.join(getMcpRunsDir(), "mcp-calls.jsonl");
    if (!fs.existsSync(file)) return [] as McpRunSnapshotEntry[];
    // Naive approach: read the whole file, filter, slice. Scale stays
    // small (~200B per JSONL entry → ~2MB at 10k calls) so we skip
    // pulling in a reverse-stream dependency.
    const raw = fs.readFileSync(file, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim());
    const out: McpRunSnapshotEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try {
        const entry = JSON.parse(lines[i]) as McpRunSnapshotEntry;
        if (
          opts.brokerSessionId &&
          entry.brokerSessionId !== opts.brokerSessionId
        ) {
          continue;
        }
        out.push(entry);
      } catch {
        // skip malformed
      }
    }
    return out;
  },
);

ipcMain.handle("mcpBroker:endpoint", () => mcpBroker.getEndpoint());

// IPC: filesystem within a task directory
ipcMain.handle(
  "fs:listChildren",
  (_e, args: { taskPath: string; rel: string }) =>
    listChildren(args.taskPath, args.rel ?? ""),
);
ipcMain.handle(
  "fs:readCurrentText",
  (_e, args: { taskPath: string; rel: string }) =>
    readCurrentText(args.taskPath, args.rel),
);
ipcMain.handle(
  "fs:writeText",
  (_e, args: { taskPath: string; rel: string; content: string }) => {
    writeTextFile(args.taskPath, args.rel, args.content);
    return { ok: true };
  },
);
ipcMain.handle(
  "fs:deleteFile",
  (_e, args: { taskPath: string; rel: string }) => {
    deleteFile(args.taskPath, args.rel);
    return { ok: true };
  },
);

// IPC: change-tracking snapshots
ipcMain.handle("snapshot:has", (_e, taskPath: string) => hasBaseline(taskPath));
ipcMain.handle("snapshot:capture", (_e, taskPath: string) =>
  captureBaseline(taskPath),
);
ipcMain.handle("snapshot:diff", (_e, taskPath: string) => computeDiff(taskPath));
ipcMain.handle(
  "snapshot:readBaselineText",
  (_e, args: { taskPath: string; rel: string }) =>
    readBaselineText(args.taskPath, args.rel),
);

// IPC: file watcher
ipcMain.handle("fileWatcher:start", async (_e, taskPath: string) => {
  await startWatching(taskPath, (event: WatcherEvent) => {
    mainWindow?.webContents.send("fileWatcher:event", event);
  });
  return { ok: true };
});
ipcMain.handle("fileWatcher:stop", async () => {
  await stopWatching();
  return { ok: true };
});

// App lifecycle
app.whenReady().then(async () => {
  // macOS: set the Dock icon (also used for Cmd+Tab). Windows / Linux
  // pick up the icon via BrowserWindow.icon instead.
  if (process.platform === "darwin" && app.dock && appIcon) {
    app.dock.setIcon(appIcon);
  }

  // Replace the default menu in packaged builds:
  //   - macOS: keep the required App / Edit / Window menus (the App menu
  //     can't be removed without breaking the traffic-light buttons —
  //     standard macOS apps have all three), but drop the View menu so
  //     Reload / DevTools shortcuts disappear.
  //   - Windows / Linux: the menu bar lives at the top of the window;
  //     this product doesn't need a menu → hide it entirely.
  if (app.isPackaged) {
    if (process.platform === "darwin") {
      Menu.setApplicationMenu(buildProdMenu());
    } else {
      Menu.setApplicationMenu(null);
    }
  }

  // Pre-ensure the work root + AGENTS.md contribution before Gateway start.
  try {
    ensureWorkRoot();
    const agentWorkspace = path.join(getStateDir(), "workspace");
    ensureAgentsMdContribution(agentWorkspace);
  } catch (err) {
    console.warn("[Main] Failed to ensure work root / agents.md:", err);
  }

  // Register protocol handlers (must happen after `ready`).
  try {
    registerProtocolHandlers();
  } catch (err) {
    console.warn("[Main] Failed to register protocol handlers:", err);
  }

  // In production the renderer loads from http://127.0.0.1:<port>;
  // requests to mhwork-api (clawapi.metrichub.app) would be blocked by
  // the browser CORS check because the backend whitelist doesn't include
  // 127.0.0.1. A desktop app is logically a first-party client, not a
  // cross-origin site, so we intercept the response headers in the main
  // process and inject Access-Control-Allow-Origin for our own API host
  // — bypassing the renderer's CORS check.
  installApiCorsBypass();

  createWindow();

  // Long-lived authorized-directory watcher subscription — runs alongside
  // the task watcher so embed buttons over `authorized://` URLs reflect
  // file changes in real time.
  try {
    installAuthorizedWatchers((event) => {
      mainWindow?.webContents.send("fileWatcher:event", event);
    });
    await refreshAuthorizedWatchers(
      listAuthorizedDirs().map((d) => d.path),
    );
  } catch (err) {
    console.warn("[Main] Failed to install authorized watchers:", err);
  }

  // ===== Bring up the MCP subsystem before the Gateway. The broker URL
  //       must be ready when mhclaw.json is written, so OpenClaw sees a
  //       single broker entry from the very first startup.
  try {
    // One-shot migration: any `mcp.servers` block in mhclaw.json is
    // copied into the registry. gateway-manager then rewrites
    // `mcp.servers` in mhclaw.json down to the broker entry.
    const legacy = readLegacyMcpServers(getConfigPath());
    mcpRegistry.init(legacy);
    mcpSupervisor.init();
    const brokerEndpoint = await mcpBroker.start();
    gatewayManager.setBrokerEndpoint(brokerEndpoint);
    console.log(`[Main] MCP broker ready at ${brokerEndpoint.url}`);
  } catch (err) {
    console.error("[Main] Failed to start MCP subsystem:", err);
    // Even if broker startup fails we still launch the Gateway:
    // mhclaw.json is not rewritten, OpenClaw temporarily won't see any
    // MCP server, but the core chat path stays unblocked.
  }

  // Spawn the embedded Gateway.
  try {
    await gatewayManager.start();
  } catch (err) {
    console.error("[Main] Failed to start gateway:", err);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  await stopWatching();
  await closeAllAuthorizedWatchers();
  // Stop the broker first — refuses new requests and closes existing sessions.
  try { await mcpBroker.stop(); } catch (err) { console.warn("[Main] mcpBroker.stop:", err); }
  // Then dispose the supervisor — kills stdio children and clears retry timers.
  try { await mcpSupervisor.dispose(); } catch (err) { console.warn("[Main] mcpSupervisor.dispose:", err); }
  await gatewayManager.stop();
  staticServer?.close();
});

// ---- Local static file server ----
// Packaged builds serve dist over http://localhost so the WebSocket
// origin is HTTP (Gateway rejects file:// origins).
let staticServer: http.Server | null = null;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

/**
 * Fixed port for the UI static server.
 *
 * Why fixed: `localStorage` is partitioned by origin, so a changing port
 * means a changing origin — task list / cron history / preferences would
 * all be lost. We previously used a random port persisted to a file, but
 * that turned out to be flaky (range checks, file getting cleared, etc.)
 * and added complexity. A fixed port is simply more stable.
 *
 * 40790 was chosen to sit right next to the Gateway (40789); the 40000+
 * range avoids common conflicts. Single-instance lock
 * (`app.requestSingleInstanceLock`) prevents two of our own processes
 * from fighting over the port. If something external grabs it, we error
 * out and let the user resolve the collision.
 */
const UI_STATIC_PORT = 40790;

function startStaticServer(distDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    staticServer = http.createServer((req, res) => {
      let pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (pathname === "/") pathname = "/index.html";

      const filePath = path.join(distDir, pathname);

      // Safety check: refuse path traversal.
      if (!filePath.startsWith(distDir)) {
        res.writeHead(403);
        res.end();
        return;
      }

      // Fall back to index.html when the file doesn't exist (SPA routing).
      const target = fs.existsSync(filePath) ? filePath : path.join(distDir, "index.html");
      const ext = path.extname(target);
      const contentType = MIME_TYPES[ext] || "application/octet-stream";

      try {
        const content = fs.readFileSync(target);
        res.writeHead(200, { "Content-Type": contentType });
        res.end(content);
      } catch {
        res.writeHead(500);
        res.end();
      }
    });

    staticServer.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        const msg =
          `mhclaw UI 端口 ${UI_STATIC_PORT} 已被其他程序占用,无法启动。\n\n` +
          `请关闭占用该端口的程序后重试。\n` +
          `查询命令(macOS / Linux):lsof -i :${UI_STATIC_PORT}`;
        console.error("[Main]", msg);
        dialog.showErrorBox("mhclaw 启动失败", msg);
        app.quit();
      }
      reject(err);
    });

    staticServer.listen(UI_STATIC_PORT, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${UI_STATIC_PORT}`;
      console.log(`[Main] Static server listening on ${url}`);
      resolve(url);
    });
  });
}
