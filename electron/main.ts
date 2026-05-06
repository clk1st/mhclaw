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

// macOS 菜单栏和 Cmd+Tab 显示的应用名
app.setName(APP_NAME);

// 主进程文件日志 —— packaged 模式 console 直接丢,所有 console.{log,warn,error}
// 也写到 ~/.mhclaw/logs/mhclaw_main.log,出问题时让用户"发一下日志给我"快速排查
setupMainLogger();

// macOS 从 Finder/Dock 启动时 PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin,
// 主进程 spawn npx / node 会 ENOENT。必须在 app 早期就把 PATH 补全,
// 否则后续 mcp-probe / Gateway env 继承都会受影响。
fixProcessPath();

/**
 * 加载应用图标:
 * - 优先 `electron/assets/icon.png`(PNG 对 Electron nativeImage / macOS dock 支持最稳,
 *   打包时 electron-builder 也能识别)
 * - 次选 `electron/assets/logo.svg`(内嵌矢量,dev 场景够用;macOS dock 对 SVG 支持不完全稳)
 * 两者都读不到返回 null,dock/window 会退回系统默认图(灰色 Electron)
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
 * 为 mhwork-api 域名的响应注入 CORS 头,让 renderer(http://127.0.0.1:<port>
 * 起源)的 fetch 不被浏览器 CORS 拦截。
 *
 * 命中的域名白名单:clawapi.metrichub.app 及 MHWORK_API_URL(若用户覆盖)
 * 不影响任何其他域(只改这些的响应头)。
 *
 * 注意:这只改 response 头,不开 webSecurity: false —— 其他跨域场景仍受保护。
 */
/**
 * 构造生产包菜单(不含 View 菜单的 Reload / DevTools)。
 * macOS 要求保留 App 菜单(第一个位置,用 process.env.name 作为标题)。
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
  // 允许通过 env 覆盖(开发联调本地后端时有用)
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

      // 只在后端**没返** ACA-* 头时才注入。后端如果已经返了(比如 dev 下
      // Vite origin localhost:40173 在后端 CORS 白名单里),我们再加 "*"
      // 就会出现"multiple values"报错。
      // Electron 的 responseHeaders key 大小写不可预测,先做个不区分大小写的
      // "已存在"判断。
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

      // 关键:preflight(OPTIONS)若 server 返 4xx,浏览器先判状态码失败,CORS
      // 头根本不会被读取 → 依然 "Failed to fetch"。把 preflight 状态码改成 200,
      // 让 renderer 进到真正的请求阶段。
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

// MCP 子系统 ── registry / supervisor / broker
// 启动顺序: registry.init → supervisor.init (后台 probe 不阻塞) →
//          broker.start (拿端口) → gatewayManager.setBrokerEndpoint →
//          gatewayManager.start (写 mhclaw.json + spawn gateway)
const mcpRegistry = new McpRegistry();
const mcpSupervisor = new McpSupervisor(mcpRegistry);
const mcpBroker = new McpBroker(mcpRegistry, mcpSupervisor);

// 把 supervisor 的 health 变化广播给所有渲染窗口 (UI 5 态实时刷)
mcpSupervisor.on("health-changed", (evt: { name: string; health?: McpHealth; removed?: boolean }) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("mcp:health-changed", evt);
    }
  }
});

// 注册自定义协议 scheme(必须在 app.ready 之前)
registerProtocolSchemes();

// ===== Deep Link: mhclaw:// 协议(主路径) =====
// 注册 mhclaw:// 为默认 client。Electron 官方建议 + single-instance 组合用法。
if (process.defaultApp) {
  // dev 模式(node_modules/.bin/electron .)需要把 script 路径一起注册
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("mhclaw", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient("mhclaw");
}

// single instance lock: Windows / Linux 下 deep link 会用 argv 传 URL,
// 必须确保只有第一个实例活着,第二次 launch 的 URL 通过 second-instance 转发。
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
    // 冷启动:窗口还没建好,暂存,did-finish-load 再派发
    pendingAuthDeepLink = url;
  }
}

app.on("second-instance", (_event, argv) => {
  // Windows / Linux 的 deep link 从这里来
  const url = argv.find((a) => typeof a === "string" && a.startsWith("mhclaw://"));
  if (url) handleAuthDeepLink(url);
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on("open-url", (event, url) => {
  // macOS 的 deep link 从这里来
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
    // macOS:隐藏标题栏、红绿灯浮在内容上,TopBar 与 traffic light 共一行(对标 WorkBuddy)
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition:
      process.platform === "darwin" ? { x: 14, y: 14 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 开发模式加载 Vite dev server，生产模式通过本地 HTTP 服务加载
  // （打包后 file:// origin 不被 Gateway 接受，需要 http:// origin）
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    // 开发模式默认打开 DevTools，便于看 console 错误
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    const distDir = path.join(__dirname, "../dist");
    startStaticServer(distDir).then((url) => {
      mainWindow!.loadURL(url);
    });
  }

  // 冷启动:deep link 在窗口 ready 前到达,现在派发给渲染进程
  mainWindow.webContents.on("did-finish-load", () => {
    if (pendingAuthDeepLink && mainWindow) {
      mainWindow.webContents.send("auth:deeplink", pendingAuthDeepLink);
      pendingAuthDeepLink = null;
    }
  });

  // 生产包禁用:Cmd/Ctrl+R 刷新 + F12/Cmd+Opt+I/Cmd+Shift+I 打开 DevTools +
  // 右键菜单的 Inspect Element。工作台不是网页,刷新会打断正在跑的任务,
  // DevTools 对终端用户也没意义。开发模式(VITE_DEV_SERVER_URL)保持原样。
  if (app.isPackaged) {
    mainWindow.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const cmd = process.platform === "darwin" ? input.meta : input.control;
      const key = input.key.toLowerCase();
      // 刷新
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

// Gateway 状态变化推送到渲染进程
// 顺带带上最新的 auth token —— Gateway 启动后会晚一点才写 token 到 config,
// watchForAuthToken 会在 token 出现时再触发一次 emitStatus,这里把 token
// 附上,渲染进程拿到后能立即更新 gw.token 并重连。
gatewayManager.setStatusListener((status: GatewayStatus) => {
  const token = gatewayManager.getAuthToken();
  mainWindow?.webContents.send("gateway:status-changed", { ...status, token });
});

// IPC: 内置 Gateway 控制
ipcMain.handle("gateway:start", () => gatewayManager.start());
ipcMain.handle("gateway:stop", () => gatewayManager.stop());
ipcMain.handle("gateway:restart", () => gatewayManager.restart());
ipcMain.handle("gateway:status", () => ({
  isRunning: gatewayManager.isRunning,
  port: gatewayManager.port,
  pid: gatewayManager.pid,
  token: gatewayManager.getAuthToken(),
}));

// IPC: 窗口控制
ipcMain.handle("window:minimize", () => mainWindow?.minimize());
ipcMain.handle("window:maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.handle("window:close", () => mainWindow?.close());

// IPC: 技能文件操作
const getSkillsDir = () => path.join(getStateDir(), "workspace", "skills");

ipcMain.handle("skills:fetchFromGithub", async (_event, url: string) => {
  // 从 GitHub URL 提取 owner/repo，构造 raw URL 拉取 SKILL.md
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) throw new Error("无效的 GitHub URL");
  const [, owner, repo] = match;
  const repoName = repo.replace(/\.git$/, "");

  // 尝试 main 和 master 分支
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
  throw new Error("未找到 SKILL.md 文件，请确认仓库中包含 SKILL.md");
});

ipcMain.handle("skills:saveSkillFile", async (_event, name: string, content: string) => {
  const skillDir = path.join(getSkillsDir(), name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), content);
  return { name };
});

ipcMain.handle("skills:openFileDialog", async () => {
  if (!mainWindow) throw new Error("窗口不可用");
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择 skill zip 包",
    filters: [{ name: "Skill 包", extensions: ["zip"] }],
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return { zipPath: result.filePaths[0] };
});

/**
 * 从 zip 包安装 skill:
 *  1. 解压到 ~/.mhclaw/workspace/skills/<name>/
 *  2. name 优先从 zip 内部的顶层目录推断,其次从 SKILL.md frontmatter 的 name 字段,
 *     最后 fallback 到 zip 文件名(去掉版本号 / 扩展名)
 *  3. 如果 zip 里顶层是一个单独的目录(如 tencent-docs/SKILL.md),把这个目录整个当成 skill
 *  4. 如果 zip 顶层直接是 SKILL.md,用 zip 文件名当 skill 名
 *
 * 返回 { name } 给前端 toast 显示。
 */
ipcMain.handle("skills:installZip", async (_event, zipPath: string) => {
  if (!zipPath || !fs.existsSync(zipPath)) {
    throw new Error("zip 文件不存在");
  }
  const { default: AdmZip } = await import("adm-zip");
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  if (entries.length === 0) throw new Error("zip 包是空的");

  // 判断:顶层是单个目录?还是 SKILL.md 直接在根?
  // 每个 entry.entryName 是 posix 路径(比如 "tencent-docs/SKILL.md"、"SKILL.md")
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
    // 根是 SKILL.md,用 zip 文件名作 skill 名(去掉版本号和扩展名)
    const base = path.basename(zipPath, path.extname(zipPath));
    skillName = base.replace(/[-_]?v?\d+(\.\d+)*$/i, "").trim() || base;
  } else if (topSegments.size === 1) {
    const top = Array.from(topSegments)[0];
    skillName = top;
    stripTopDir = top;
  } else {
    // 多个顶层目录,用 zip 文件名
    skillName = path.basename(zipPath, path.extname(zipPath));
  }

  // 目标目录,存在就拒绝(避免覆盖用户已装 skill)
  const skillsDir = getSkillsDir();
  fs.mkdirSync(skillsDir, { recursive: true });
  const targetDir = path.join(skillsDir, skillName);
  if (fs.existsSync(targetDir)) {
    throw new Error(`skill "${skillName}" 已存在,请先删除再安装`);
  }
  fs.mkdirSync(targetDir, { recursive: true });

  // 解压,可选剥离顶层目录
  for (const e of entries) {
    if (e.isDirectory) continue;
    let rel = e.entryName;
    if (stripTopDir && rel.startsWith(stripTopDir + "/")) {
      rel = rel.slice(stripTopDir.length + 1);
    }
    if (!rel) continue;
    const destPath = path.join(targetDir, rel);
    // 防 zip-slip
    if (!destPath.startsWith(targetDir + path.sep) && destPath !== targetDir) {
      continue;
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, e.getData());
  }

  // 如果 SKILL.md 的 frontmatter 里有 name,用它修正 skillName(但已建目录不改,只给 toast 用)
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
    // 忽略,用目录名
  }

  return { name: skillName, path: targetDir };
});

ipcMain.handle("skills:deleteCustomSkill", async (_event, name: string) => {
  const rootDir = getSkillsDir();
  if (!fs.existsSync(rootDir)) return;

  // 直接按目录名匹配(目录名就是 slug 时的快路径)
  const direct = path.join(rootDir, name);
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) {
    fs.rmSync(direct, { recursive: true });
    return;
  }

  // Gateway 的 skills.status 对非标准 skill 可能返显示名当 skillKey(如
  // "Excel / XLSX"→目录 excel-xlsx),直接拼路径会 miss。扫 skills 根目录,
  // 读每个 SKILL.md frontmatter 的 name/slug 做匹配。
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
  // 找不到也不报错:可能是 bundled / managed 层的,不归这个 handler 管
});

/**
 * 从 URL 下载 skill zip 并解压到 ~/.mhclaw/workspace/skills/<slug>/
 * 用于 SkillHub 一键安装。
 *
 * zip 结构兼容两种:
 *   A) 扁平根(hub 的标准):/SKILL.md /_meta.json ...
 *   B) 含 slug 目录包裹:   /<slug>/SKILL.md ...
 * 处理:先解压到临时目录,再判断顶层是单一目录(B)还是散文件(A),
 * 统一搬到 skills/<slug>/ 下,保证布局一致。
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
      /** hub 侧 metadata,安装后写 sidecar 给 UI 用(displayName 覆盖等) */
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
    if (!slug || !/^[a-z0-9._-]+$/i.test(slug)) throw new Error("非法 slug");

    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
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
      // 判断是否"单一顶层目录"结构
      const rootDir =
        entries.length === 1 && entries[0].isDirectory()
          ? path.join(tmpExtract, entries[0].name)
          : tmpExtract;

      const targetRoot = getSkillsDir();
      fs.mkdirSync(targetRoot, { recursive: true });
      const installedDir = path.join(targetRoot, slug);
      // 覆盖安装:先清空目标(如果存在),再从 rootDir 递归拷贝
      if (fs.existsSync(installedDir)) {
        fs.rmSync(installedDir, { recursive: true, force: true });
      }
      fs.cpSync(rootDir, installedDir, { recursive: true });

      // 写 hub sidecar(UI 读它来覆盖 displayName 等展示字段)
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
          /* sidecar 写失败不阻断安装 */
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
 * 批量读 workspace/skills/<slug>/.mhclaw-hub.json 返回 map。
 * 用于 UI 展示已装 skill 时用 hub 的 displayName 覆盖英文 SKILL.md name。
 * 不是 hub 装的就没 sidecar,返回 map 里没这个 key。
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
      /** SKILL.md frontmatter 的 name 字段,用于 UI 反查(Gateway skillKey 有时
       *  返的是 SKILL.md name 而不是目录 slug,renderer 拿不到 SKILL.md 没法
       *  反查,由主进程一并返回) */
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
      // 额外读 SKILL.md frontmatter 的 name 当 alias,用于跨"显示名 vs slug"匹配
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
      /* ignore 坏 sidecar */
    }
  }
  return map;
});

/**
 * 读取某个 skill 的 SKILL.md 源码。按优先级从高到低查找：
 *   1. workspace/skills/<name>/SKILL.md     （最高）
 *   2. ~/.mhclaw/skills/<name>/SKILL.md     （managed）
 *   3. node_modules/openclaw/skills/<name>/SKILL.md （bundled）
 * 用于技能详情 Dialog 的"原文"模式。
 */
ipcMain.handle("skills:getMd", async (_event, name: string) => {
  if (!name || typeof name !== "string") throw new Error("skill name required");

  // 解析 openclaw bundled skills 根目录（复用 gateway-manager 的思路）
  const { createRequire } = await import("node:module");
  const req = createRequire(path.join(__dirname, "package.json"));
  let bundledRoot = "";
  try {
    const pkgMain = req.resolve("openclaw");
    const pkgRoot = path.resolve(path.dirname(pkgMain), "..");
    bundledRoot = path.join(pkgRoot, "skills");
    // 打包 asar 场景
    if (bundledRoot.includes("app.asar" + path.sep) || bundledRoot.includes("app.asar/")) {
      bundledRoot = bundledRoot.replace(/app\.asar(?=[\\/])/, "app.asar.unpacked");
    }
  } catch {
    // 不影响，下面 workspace/managed 仍可找到
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

  // 兜底:Gateway 的 skills.status 对非标准 skill(如 mhclaw 从 SkillHub 装的
  // Excel / XLSX、Word / DOCX)返回的 skillKey 有时是**显示名**而不是目录名,
  // 按 name 直接拼路径找不到。扫一遍 workspace + managed,读每个 SKILL.md 的
  // frontmatter,按 name / slug 匹配。代价几十个 existsSync + read,够快。
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
        // 简单匹配 frontmatter 的 name / slug(不依赖完整 YAML 解析,OpenClaw
        // 的 frontmatter 第一段是 --- 包起来的 key: value 列表)
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

// IPC: 工作根
ipcMain.handle("workRoot:get", () => getWorkRoot());
ipcMain.handle("workRoot:set", async (_e, newPath: string) => setWorkRoot(newPath));
ipcMain.handle("workRoot:pickAndSet", async () => {
  if (!mainWindow) throw new Error("窗口不可用");
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "选择 mhclaw 工作根目录",
    properties: ["openDirectory", "createDirectory"],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return setWorkRoot(res.filePaths[0]);
});

// IPC: 任务目录
ipcMain.handle("taskFolder:listRecent", () => listOutputDirs());
ipcMain.handle("taskFolder:createBlank", async (_e, sessionKey?: string) => {
  const result = createBlankTask(sessionKey ? { sessionKey } : undefined);
  if (sessionKey) bindSessionToFolder(sessionKey, result.path);
  ensureBaseline(result.path);
  return result;
});
ipcMain.handle("taskFolder:pickExternal", async (_e, sessionKey?: string) => {
  if (!mainWindow) throw new Error("窗口不可用");
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "选择任务产出目录",
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
 *   已绑定 → 直接返回;未绑定 → createBlank 并绑。幂等,lazy 触发点。
 *   正式调用方:chat-store.sendMessage 前置(真要用了才建,避免空目录污染)
 *             + AssistantFinal(兜底,确保 artifacts 能落盘)
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

// IPC: 产物(artifacts,真相源在 <task-folder>/.mhclaw/artifacts.json)
ipcMain.handle("artifacts:list", (_e, sessionKey: string) =>
  listArtifactsForSession(sessionKey),
);
ipcMain.handle(
  "artifacts:add",
  (_e, { sessionKey, entries }: { sessionKey: string; entries: ArtifactAddInput[] }) =>
    addArtifactsForSession(sessionKey, entries),
);

// IPC: 系统授权(macOS 权限检测 + 跳转)
/**
 * 返回 macOS 各项权限的状态。
 * 只有"辅助功能"能直接 API 检测;其他(完全磁盘/自动化/通知)没稳定 API,
 * 客户端只显示"去授权"按钮,不标注状态。
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

/** 打开 macOS 系统设置到对应的隐私面板 */
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

// IPC: 在用户默认浏览器打开 URL(用于"去网页端注册"等场景)
ipcMain.handle("system:openExternal", async (_e, url: string) => {
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
    return { ok: false, reason: "invalid-url" };
  }
  await shell.openExternal(url);
  return { ok: true };
});

// IPC: 微信扫码登录
//  - 渲染进程 invoke("weixin:login:start") → 主进程 spawn openclaw CLI,
//    从 stdout 拦截 "https://open.work.weixin.qq.com/..." 这类二维码 URL,
//    通过 "weixin:login:qr" 推给渲染进程(URL + message)
//  - CLI 自己轮询登录状态,成功/失败后退出,通过 "weixin:login:done" 推结果
//  - invoke("weixin:login:cancel") 杀子进程
let weixinLoginCancel: (() => void) | null = null;
// 二维码 URL 的启发式正则:tencent / qq.com / iLink 域名,http(s) 开头
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
        // 给渲染进程透传 raw log(前端可选择显示)
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

// IPC: 防休眠(powerSaveBlocker)
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

// IPC: 授权目录 —— 每次增删后同步刷新 authorized file watcher,
// 确保新加的目录立刻被监听 / 移除的目录立即停止监听
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
  if (!mainWindow) throw new Error("窗口不可用");
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "选择授权目录(AI 可访问)",
    properties: ["openDirectory"],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return addAuthorizedDir(res.filePaths[0], note);
});

// IPC: MCP probe —— 不依赖 gateway,主进程自己起轻量 MCP client 拉 tool 列表
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

// ───── IPC: MCP registry / supervisor / broker (broker 架构下的真实来源) ─────

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

/** 读最近 N 条 snapshot, 倒序 (最新在前) */
ipcMain.handle(
  "mcpBroker:snapshotTail",
  async (_e, opts: { limit?: number; brokerSessionId?: string } = {}) => {
    const limit = Math.max(1, Math.min(opts.limit ?? 200, 2000));
    const file = path.join(getMcpRunsDir(), "mcp-calls.jsonl");
    if (!fs.existsSync(file)) return [] as McpRunSnapshotEntry[];
    // 简单做法: 全读再过滤 + 截尾。日均规模可控 (jsonl 一条 ~200B,
    // 万次调用 ~2MB), 不引入 reverse-stream 依赖
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

// IPC: 文件系统(任务目录里)
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

// IPC: 快照
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

// IPC: 文件监听
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

// App 生命周期
app.whenReady().then(async () => {
  // macOS:设置 dock 图标(Cmd+Tab、Dock 都会显示);Windows/Linux 走 BrowserWindow.icon
  if (process.platform === "darwin" && app.dock && appIcon) {
    app.dock.setIcon(appIcon);
  }

  // 生产包替换默认菜单:
  // - macOS:保留必要的 App / Edit / Window 菜单(App 菜单不能删,否则红绿灯消失
  //   行为异常;标准 macOS 应用都有这几项),去掉含 Reload / DevTools 的 View 菜单
  // - Windows / Linux:菜单栏显示在窗口顶部,我们产品不需要菜单 → 直接隐藏整条
  if (app.isPackaged) {
    if (process.platform === "darwin") {
      Menu.setApplicationMenu(buildProdMenu());
    } else {
      Menu.setApplicationMenu(null);
    }
  }

  // 提前 ensure 工作根 + AGENTS.md contribution(在 Gateway 启动前就准备好)
  try {
    ensureWorkRoot();
    const agentWorkspace = path.join(getStateDir(), "workspace");
    ensureAgentsMdContribution(agentWorkspace);
  } catch (err) {
    console.warn("[Main] Failed to ensure work root / agents.md:", err);
  }

  // 注册协议 handler(必须在 ready 之后)
  try {
    registerProtocolHandlers();
  } catch (err) {
    console.warn("[Main] Failed to register protocol handlers:", err);
  }

  // Prod 里 renderer 从 http://127.0.0.1:<随机端口> 加载,向 mhwork-api
  // (clawapi.metrichub.app)发请求会被浏览器 CORS 拦住 ——
  // 后端 CORS 白名单里没有 127.0.0.1。桌面 app 本来就是"第一方客户端",
  // 不是真跨站,拦截主进程层的响应头,为我们自己的 API 域名人为注入
  // Access-Control-Allow-Origin,绕开 renderer 的 CORS 检查。
  installApiCorsBypass();

  createWindow();

  // 授权目录 watcher 常驻订阅 —— 跟 task watcher 并列,让 authorized 类 URL
  // 的 embed 按钮也能实时反映文件变化
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

  // ===== MCP 子系统启动 (在 gateway 之前 —— 保证 mhclaw.json 写入时
  //       broker URL 已 ready, OpenClaw 启动就只看到 broker 一条) =====
  try {
    // 一次性 migration: 旧 mhclaw.json 里 mcp.servers → registry
    // 之后 gatewayManager 会把 mhclaw.json mcp.servers 改写为 broker entry
    const legacy = readLegacyMcpServers(getConfigPath());
    mcpRegistry.init(legacy);
    mcpSupervisor.init();
    const brokerEndpoint = await mcpBroker.start();
    gatewayManager.setBrokerEndpoint(brokerEndpoint);
    console.log(`[Main] MCP broker ready at ${brokerEndpoint.url}`);
  } catch (err) {
    console.error("[Main] Failed to start MCP subsystem:", err);
    // broker 启动失败时仍允许 gateway 起 (mhclaw.json 不会写入 broker entry,
    // OpenClaw 会暂时看不到 MCP server, 但聊天主流程不阻塞)
  }

  // 自动启动内置 Gateway
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
  // 先停 broker (会拒绝新请求, 关已建 session)
  try { await mcpBroker.stop(); } catch (err) { console.warn("[Main] mcpBroker.stop:", err); }
  // 再停 supervisor (kill stdio 子进程, 清退避 timer)
  try { await mcpSupervisor.dispose(); } catch (err) { console.warn("[Main] mcpSupervisor.dispose:", err); }
  await gatewayManager.stop();
  staticServer?.close();
});

// ---- 本地静态文件服务 ----
// 打包后用 http://localhost 提供 dist 文件，让 WebSocket origin 为 HTTP
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
 * UI 静态服务固定端口。
 *
 * 为什么固定:`localStorage` 按 origin 隔离,端口变了 origin 就变,
 * 归档列表 / cron 历史 / 偏好全丢。之前用随机端口 + 持久化端口文件,
 * 但端口持久化不可靠(范围检查 / 文件被清等),还引入复杂度。固定就稳定。
 *
 * 选 40790:跟 Gateway(40789)挨着,40000+ 高位段不会撞主流软件。
 * 单实例锁(app.requestSingleInstanceLock)保证不会自己跟自己抢端口。
 * 真被外部程序占了 → 报错退出,让用户自己处理。
 */
const UI_STATIC_PORT = 40790;

function startStaticServer(distDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    staticServer = http.createServer((req, res) => {
      let pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (pathname === "/") pathname = "/index.html";

      const filePath = path.join(distDir, pathname);

      // 安全检查：不允许路径穿越
      if (!filePath.startsWith(distDir)) {
        res.writeHead(403);
        res.end();
        return;
      }

      // 文件不存在则返回 index.html（SPA 路由支持）
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
