import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { getStateDir, DEFAULT_GATEWAY_PORT } from "./constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface GatewayManagerOptions {
  port?: number;
}

/**
 * Embedded Gateway process manager.
 *
 * Spawns the OpenClaw Gateway directly from the bundled
 * `node_modules/openclaw/openclaw.mjs`. The Gateway ships inside the app —
 * users don't need to install anything else.
 *
 * On macOS the packaged app launches the subprocess via the Electron Helper
 * binary so it doesn't produce a second Dock icon.
 *
 * `OPENCLAW_STATE_DIR` isolates Gateway data under `~/.mhclaw`.
 */
export class GatewayManager {
  private process: ChildProcess | null = null;
  private restarting = false;
  private shouldRun = false;
  private restartCount = 0;
  private maxRestarts = 5;
  private restartDelay = 2000;
  /**
   * mhclaw-mcp-broker endpoint, injected by main.ts after `broker.start()`.
   * `ensureMinimalConfig` uses it to rewrite mhclaw.json's `mcp.servers`
   * down to a single broker entry. If unset (broker startup failed), the
   * existing `mcp.servers` is kept so chat doesn't fully break.
   */
  private brokerEndpoint: { url: string; port: number } | null = null;

  readonly port: number;
  readonly stateDir: string;
  /**
   * Config file path. Native OpenClaw uses `openclaw.json`; mhclaw uses
   * `mhclaw.json` and tells the Gateway via `OPENCLAW_CONFIG_PATH`.
   */
  readonly configPath: string;

  private onStatusChange?: (status: GatewayStatus) => void;

  constructor(opts: GatewayManagerOptions = {}) {
    this.port = opts.port ?? DEFAULT_GATEWAY_PORT;
    this.stateDir = getStateDir();
    // configPath has to be assembled after stateDir is set — class field
    // initializers run before the constructor body, so stateDir would be
    // undefined there.
    this.configPath = path.join(this.stateDir, "mhclaw.json");
  }

  setStatusListener(listener: (status: GatewayStatus) => void) {
    this.onStatusChange = listener;
  }

  /** broker 启动后在 gateway 起之前注入 endpoint */
  setBrokerEndpoint(endpoint: { url: string; port: number }): void {
    this.brokerEndpoint = endpoint;
  }

  private emitStatus(status: GatewayStatus) {
    this.onStatusChange?.(status);
  }

  /**
   * 解析 bundled 社区插件的绝对入口路径。
   *
   * 3 个国内渠道插件(微信 / 企微 / 钉钉)作为 npm dep 直接装在 node_modules,
   * 读每个包的 package.json.openclaw.extensions 数组拼成绝对路径,
   * 写到 config.plugins.load.paths 让 OpenClaw 发现。asar 打包时走 unpacked。
   */
  private resolveBundledPluginPaths(): string[] {
    const req = createRequire(path.join(__dirname, "package.json"));
    const packages = [
      "@tencent-weixin/openclaw-weixin",
      "@wecom/wecom-openclaw-plugin",
      "@largezhou/ddingtalk",
    ];
    const paths: string[] = [];
    for (const pkg of packages) {
      try {
        // 有些包 exports 既不暴露 ./package.json 也是 ESM-only(require.resolve 失败),
        // 所以依次尝试:(1) resolve package.json (2) resolve main (3) 直接拼
        // node_modules/<pkg> 路径。只要找到一个存在的目录就够。
        let pkgRoot: string | null = null;
        try {
          const seed = req.resolve(`${pkg}/package.json`);
          pkgRoot = path.dirname(seed);
        } catch {
          try {
            const seed = req.resolve(pkg);
            let cur = path.dirname(seed);
            while (
              cur !== path.dirname(cur) &&
              !fs.existsSync(path.join(cur, "package.json"))
            ) {
              cur = path.dirname(cur);
            }
            if (fs.existsSync(path.join(cur, "package.json"))) pkgRoot = cur;
          } catch {
            // require.resolve 全挂,走文件系统路径
          }
        }
        if (!pkgRoot) {
          // 直接拼 node_modules/<pkg> 作为最后一根稻草。__dirname 在 dev = dist-electron/,
          // 在 prod = resources/app.asar.unpacked 或 app.asar,都能往上两级到工程根。
          const candidates = [
            path.resolve(__dirname, "..", "node_modules", pkg),
            path.resolve(__dirname, "..", "..", "node_modules", pkg),
          ];
          pkgRoot = candidates.find((p) =>
            fs.existsSync(path.join(p, "package.json")),
          ) ?? null;
        }
        if (!pkgRoot) {
          console.warn(`[GatewayManager] Cannot locate bundled plugin ${pkg}`);
          continue;
        }
        const manifestPath = path.join(pkgRoot, "openclaw.plugin.json");
        if (!fs.existsSync(manifestPath)) {
          console.warn(
            `[GatewayManager] No openclaw.plugin.json at ${pkgRoot}, skipping ${pkg}`,
          );
          continue;
        }
        // 注册的是"包根目录"——OpenClaw 会扫 openclaw.plugin.json 拿到
        // extensions 数组,再按相对路径加载。不能直接注册 extension 文件:
        // 有的包入口在 dist/ 子目录,而 manifest 永远在包根,OpenClaw 按
        // 入口文件同目录找 manifest 会找不到。
        let registerPath = pkgRoot;
        if (
          registerPath.includes("app.asar" + path.sep) ||
          registerPath.includes("app.asar/")
        ) {
          registerPath = registerPath.replace(
            /app\.asar(?=[\\/])/,
            "app.asar.unpacked",
          );
        }
        paths.push(registerPath);
      } catch (err) {
        console.warn(
          `[GatewayManager] Failed to resolve bundled plugin ${pkg}:`,
          err,
        );
      }
    }
    return paths;
  }

  /**
   * 解析内置 openclaw CLI 入口路径。
   *
   * openclaw.mjs 在包根目录，而 exports 指向 dist/index.js。
   * 所以先 resolve 到包的 main entry，再回到包根目录找 openclaw.mjs。
   */
  private resolveClawEntry(): string {
    const require = createRequire(path.join(__dirname, "package.json"));
    const pkgMain = require.resolve("openclaw");
    // pkgMain = .../openclaw/dist/index.js → 包根 = ../
    const pkgRoot = path.resolve(path.dirname(pkgMain), "..");
    let entry = path.join(pkgRoot, "openclaw.mjs");

    // 打包后 asar 内路径需要使用 unpacked 版本（子进程无 asar 支持）
    // Electron 的 asar patch 会让 fs.existsSync 对 asar 路径返回 true，
    // 所以需要替换为 unpacked 路径，子进程才能真正读取文件
    if (entry.includes("app.asar" + path.sep) || entry.includes("app.asar/")) {
      entry = entry.replace(/app\.asar(?=[\\/])/, "app.asar.unpacked");
    }

    console.log(`[GatewayManager] Resolved entry: ${entry}`);

    if (!fs.existsSync(entry)) {
      throw new Error(`OpenClaw entry not found: ${entry}`);
    }

    return entry;
  }

  /**
   * 获取 Node.js 运行二进制路径。
   *
   * 打包后的 macOS 环境使用 Electron Helper 二进制，
   * 配合 ELECTRON_RUN_AS_NODE=1 作为 Node.js 运行 Gateway。
   * Helper 不会在 Dock 产生额外图标（与主二进制不同）。
   */
  /**
   * 跑一条 openclaw CLI 命令(非 gateway),流式回调 stdout/stderr。
   * 跟 Gateway 共享同一套 entry / node bin / 环境清理逻辑。
   * 返回值是可用来杀进程的函数。
   */
  runClawCommand(
    args: string[],
    handlers: {
      onStdout?: (chunk: string) => void;
      onStderr?: (chunk: string) => void;
      onExit?: (code: number | null) => void;
    } = {},
  ): () => void {
    const { env: cleanEnv } = process;
    const env: NodeJS.ProcessEnv = {
      ...cleanEnv,
      OPENCLAW_STATE_DIR: this.stateDir,
      OPENCLAW_CONFIG_PATH: this.configPath,
      OPENCLAW_GATEWAY_PORT: String(this.port),
      ELECTRON_RUN_AS_NODE: "1",
    };
    delete env.DYLD_LIBRARY_PATH;
    delete env.DYLD_FALLBACK_LIBRARY_PATH;
    delete env.DYLD_INSERT_LIBRARIES;
    delete env.LD_LIBRARY_PATH;
    delete env.ELECTRON_NO_ASAR;

    const entry = this.resolveClawEntry();
    const nodeBin = this.getNodeBin();
    const child = spawn(nodeBin, [entry, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
    if (handlers.onStdout) {
      child.stdout?.on("data", (buf: Buffer) =>
        handlers.onStdout?.(buf.toString("utf8")),
      );
    }
    if (handlers.onStderr) {
      child.stderr?.on("data", (buf: Buffer) =>
        handlers.onStderr?.(buf.toString("utf8")),
      );
    }
    child.on("exit", (code) => handlers.onExit?.(code));
    return () => {
      try {
        child.kill();
      } catch {
        /* noop */
      }
    };
  }

  private getNodeBin(): string {
    if (process.platform === "darwin" && app.isPackaged) {
      const appName = app.getName();
      const helperPath = path.join(
        path.dirname(process.execPath),
        "..",
        "Frameworks",
        `${appName} Helper.app`,
        "Contents",
        "MacOS",
        `${appName} Helper`
      );
      if (fs.existsSync(helperPath)) {
        console.log(`[GatewayManager] Using Helper binary: ${helperPath}`);
        return helperPath;
      }
    }
    return process.execPath;
  }

  /**
   * 确保 host 级别的 exec approvals 文件 defaults 为宽松策略。
   *
   * OpenClaw 硬编码从 ~/.openclaw/exec-approvals.json 读宿主审批状态
   * (不跟随 OPENCLAW_STATE_DIR),全机器级别的 gate。mhclaw 作为单用户
   * 桌面应用,默认不弹审批——等同 `openclaw exec-policy preset yolo` 的
   * 本地部分。
   *
   * 合并策略:保留已有 agents/socket/version 等字段(用户批过的 allowlist
   * 不动),只确保 defaults 里有 ask:"off" + security:"full"。已有更宽松
   * 或等价配置就不写。
   */
  private ensureHostApprovalsFile() {
    try {
      const home = process.env.HOME;
      if (!home) return;
      const dir = path.join(home, ".openclaw");
      const file = path.join(dir, "exec-approvals.json");
      const yoloDefaults = {
        security: "full",
        ask: "off",
        askFallback: "full",
      };

      fs.mkdirSync(dir, { recursive: true });

      let existing: Record<string, unknown> = {};
      if (fs.existsSync(file)) {
        try {
          existing = JSON.parse(fs.readFileSync(file, "utf-8"));
        } catch {
          existing = {};
        }
      }

      const curDefaults =
        (existing.defaults as Record<string, unknown> | undefined) ?? {};
      const needsUpdate =
        curDefaults.ask !== yoloDefaults.ask ||
        curDefaults.security !== yoloDefaults.security;
      if (!needsUpdate) return;

      const next = {
        ...existing,
        version: (existing.version as number | undefined) ?? 1,
        defaults: { ...curDefaults, ...yoloDefaults },
      };
      fs.writeFileSync(file, JSON.stringify(next, null, 2));
      console.log(`[GatewayManager] Updated host approvals defaults at ${file}`);
    } catch (err) {
      console.warn("[GatewayManager] Failed to update host approvals:", err);
    }
  }

  private ensureStateDir() {
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }
    const logDir = path.join(this.stateDir, "logs");
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    // claw agent 专属 workspace(channel 消息的 session 落在这,和桌面 UI 的 workspace 隔离)
    const clawDir = path.join(this.stateDir, "claw");
    if (!fs.existsSync(clawDir)) {
      fs.mkdirSync(clawDir, { recursive: true });
    }

    // 一次性迁移:旧 openclaw.json → mhclaw.json(品牌一致性改名,内容不变)
    const legacyPath = path.join(this.stateDir, "openclaw.json");
    if (fs.existsSync(legacyPath) && !fs.existsSync(this.configPath)) {
      try {
        fs.renameSync(legacyPath, this.configPath);
        console.log(`[GatewayManager] Migrated ${legacyPath} → ${this.configPath}`);
      } catch (err) {
        console.warn(`[GatewayManager] Migration failed, will create fresh mhclaw.json:`, err);
      }
    }

    // 确保有最小配置文件,否则 Gateway 拒绝启动
    const configPath = this.configPath;
    if (!fs.existsSync(configPath)) {
      const workspacePath = path.join(this.stateDir, "workspace");
      const clawWorkspacePath = path.join(this.stateDir, "claw");
      const minimalConfig = {
        gateway: {
          mode: "local",
          port: this.port,
          controlUi: {
            dangerouslyDisableDeviceAuth: true,
          },
        },
        agents: {
          defaults: {
            workspace: workspacePath,
          },
          // 两个 agent 隔离:
          //  - main  → 桌面 UI 的任务 session,sessionKey = agent:main:session-<ts>
          //  - claw  → 所有 channel(微信/企微/钉钉)的入站消息,sessionKey = agent:claw:main
          //           workspace / memory 独立,避免 chat history 和文件串
          list: [
            { id: "main", default: true, workspace: workspacePath },
            { id: "claw", workspace: clawWorkspacePath },
          ],
        },
        // 顶层 bindings(不是 agents.bindings)按 channel 路由到 claw agent
        bindings: [
          // accountId: "*" 是关键 — 不设会被 OpenClaw normalize 成空串,落不到任何匹配 tier。
          // "*" 表示该 channel 下所有账号都路由到 claw agent(见 resolve-route 的 byChannel bucket)。
          { agentId: "claw", match: { channel: "openclaw-weixin", accountId: "*" } },
          { agentId: "claw", match: { channel: "wecom", accountId: "*" } },
          { agentId: "claw", match: { channel: "ddingtalk", accountId: "*" } },
        ],
        plugins: {
          slots: { memory: "" },
          load: { paths: this.resolveBundledPluginPaths() },
        },
        tools: {
          exec: { host: "gateway", security: "full", ask: "off" },
        },
        browser: {
          enabled: true,
          // 劫持 user key:OpenClaw 会强塞 user=existing-session(attach 用户日常 Chrome)。
          // 我们显式配 user,OpenClaw 跳过默认注入,driver 回退到 "openclaw" → 自启独立 Chrome。
          defaultProfile: "user",
          profiles: {
            user: { cdpPort: 18800, color: "#E8683A" },
          },
          ssrfPolicy: { dangerouslyAllowPrivateNetwork: true },
        },
        // MCP: 只暴露 mhclaw 自管的 broker, OpenClaw 看不到用户原 server.
        // 用户配置存在 ~/.mhclaw/mcp-registry.json, broker 内部 fan-out。
        // brokerEndpoint 还没设时跳过 mcp 段 (broker 启动失败的 fallback)。
        ...(this.brokerEndpoint
          ? {
              mcp: {
                servers: {
                  "mhclaw-mcp-broker": {
                    url: this.brokerEndpoint.url,
                    transport: "streamable-http",
                  },
                },
              },
            }
          : {}),
      };
      fs.writeFileSync(configPath, JSON.stringify(minimalConfig, null, 2));
      console.log(`[GatewayManager] Created minimal config at ${configPath}`);
    } else {
      // 确保已有配置包含必要的 mhclaw 设置
      try {
        const raw = fs.readFileSync(configPath, "utf-8");
        const config = JSON.parse(raw);
        let changed = false;

        // controlUi.dangerouslyDisableDeviceAuth
        if (!config.gateway) config.gateway = {};
        if (!config.gateway.controlUi) config.gateway.controlUi = {};
        if (config.gateway.controlUi.dangerouslyDisableDeviceAuth !== true) {
          config.gateway.controlUi.dangerouslyDisableDeviceAuth = true;
          changed = true;
        }

        // workspace 路径指向 ~/.mhclaw/workspace
        const workspacePath = path.join(this.stateDir, "workspace");
        const clawWorkspacePath = path.join(this.stateDir, "claw");
        if (!config.agents) config.agents = {};
        if (!config.agents.defaults) config.agents.defaults = {};
        if (!config.agents.defaults.workspace) {
          config.agents.defaults.workspace = workspacePath;
          changed = true;
        }

        // agents.list:保证 main + claw 两个 agent 都在,workspace 正确
        //  - main default=true → 桌面 UI 的 session-<ts> 用
        //  - claw            → channel 入站消息专属,独立 workspace / memory
        const desiredAgentList = [
          { id: "main", default: true, workspace: workspacePath },
          { id: "claw", workspace: clawWorkspacePath },
        ];
        const currentList = Array.isArray(config.agents.list)
          ? config.agents.list
          : [];
        // 用 id 合并:desired 覆盖 current 里同 id 的项,保留其他自定义 agent
        const byId = new Map<string, Record<string, unknown>>();
        for (const a of currentList) {
          if (a && typeof a === "object" && typeof a.id === "string") {
            byId.set(a.id, { ...a });
          }
        }
        for (const d of desiredAgentList) {
          byId.set(d.id, { ...(byId.get(d.id) ?? {}), ...d });
        }
        const mergedList = Array.from(byId.values());
        if (JSON.stringify(mergedList) !== JSON.stringify(currentList)) {
          config.agents.list = mergedList;
          changed = true;
        }

        // bindings:所有已 bundled 的 channel 都路由到 claw agent
        const desiredBindings = [
          // accountId: "*" 是关键 — 不设会被 OpenClaw normalize 成空串,落不到任何匹配 tier。
          // "*" 表示该 channel 下所有账号都路由到 claw agent(见 resolve-route 的 byChannel bucket)。
          { agentId: "claw", match: { channel: "openclaw-weixin", accountId: "*" } },
          { agentId: "claw", match: { channel: "wecom", accountId: "*" } },
          { agentId: "claw", match: { channel: "ddingtalk", accountId: "*" } },
        ];
        const currentBindings = Array.isArray(config.bindings)
          ? config.bindings
          : [];
        // 同 channel 去重:我们的 desired 优先,保留用户其他 bindings
        const bindingKeyOf = (b: Record<string, unknown>): string => {
          const m = (b?.match ?? {}) as Record<string, unknown>;
          return `${b?.agentId ?? ""}|${m?.channel ?? ""}|${m?.accountId ?? ""}`;
        };
        const bindingMap = new Map<string, Record<string, unknown>>();
        for (const b of currentBindings) {
          if (b && typeof b === "object") bindingMap.set(bindingKeyOf(b), b);
        }
        for (const d of desiredBindings) {
          bindingMap.set(bindingKeyOf(d), d);
        }
        const mergedBindings = Array.from(bindingMap.values());
        if (
          JSON.stringify(mergedBindings) !== JSON.stringify(currentBindings)
        ) {
          config.bindings = mergedBindings;
          changed = true;
        }

        // 禁用 memory-core 插件 slot（打包后不包含该插件）
        if (!config.plugins) config.plugins = {};
        if (!config.plugins.slots) config.plugins.slots = {};
        if (config.plugins.slots.memory !== "") {
          config.plugins.slots.memory = "";
          changed = true;
        }

        // mhclaw 默认宽松执行策略:用户就是自己,不做 YC/生产多租户隔离。
        // AI 帮你开浏览器 / 跑命令不应该每次弹审批。效果等同 `openclaw exec-policy preset yolo`。
        if (!config.tools) config.tools = {};
        if (!config.tools.exec) config.tools.exec = {};
        const execDesired = { host: "gateway", security: "full", ask: "off" };
        for (const [k, v] of Object.entries(execDesired)) {
          if (config.tools.exec[k] !== v) {
            config.tools.exec[k] = v;
            changed = true;
          }
        }

        // 浏览器策略:
        //  1. 劫持 user key。OpenClaw resolveBrowserConfig 会硬编码注入
        //     user={driver:"existing-session", attachOnly:true},走 chrome-devtools-mcp
        //     attach 用户日常 Chrome —— 这正是 "操控我的浏览器" bug 的根因。
        //     我们显式在 profiles 里配好 user,OpenClaw 看到 result.user 存在就跳过
        //     默认注入,driver 回退到 "openclaw" → 走 launchOpenClawChrome 自启独立
        //     Chrome,user-data-dir = ~/.openclaw/profile-user/。
        //  2. SSRF 放开私网(CDP 127.0.0.1 loopback 握手 + hostname 导航)。
        if (!config.browser) config.browser = {};
        if (config.browser.enabled !== true) {
          config.browser.enabled = true;
          changed = true;
        }
        if (config.browser.defaultProfile !== "user") {
          config.browser.defaultProfile = "user";
          changed = true;
        }
        const desiredProfiles = {
          user: { cdpPort: 18800, color: "#E8683A" },
        };
        if (
          JSON.stringify(config.browser.profiles) !==
          JSON.stringify(desiredProfiles)
        ) {
          config.browser.profiles = desiredProfiles;
          changed = true;
        }
        if (!config.browser.ssrfPolicy) config.browser.ssrfPolicy = {};
        if (config.browser.ssrfPolicy.dangerouslyAllowPrivateNetwork !== true) {
          config.browser.ssrfPolicy.dangerouslyAllowPrivateNetwork = true;
          changed = true;
        }

        // Bundled 社区插件(微信 / 企微 / 钉钉):把绝对路径注入 plugins.load.paths
        if (!config.plugins.load) config.plugins.load = {};
        const bundled = this.resolveBundledPluginPaths();
        const existing: string[] = Array.isArray(config.plugins.load.paths)
          ? config.plugins.load.paths
          : [];
        // 保留非 node_modules 的用户自定义路径,只同步 bundled 部分
        const nonBundled = existing.filter((p) => !/node_modules/.test(p));
        const merged = [...nonBundled, ...bundled];
        if (JSON.stringify(merged) !== JSON.stringify(existing)) {
          config.plugins.load.paths = merged;
          changed = true;
        }

        // 清理 5.x 已 retired 的 legacy key(从 4.x 升级过来时会撞 schema 拒绝):
        //   agents.defaults.llm  (changelog #76798/#76800; doctor --fix 也清这个)
        // 这条不会自动重新添加, 类似 ad-hoc migration。
        if (config.agents?.defaults?.llm !== undefined) {
          delete config.agents.defaults.llm;
          changed = true;
          console.log(`[GatewayManager] Removed retired key agents.defaults.llm`);
        }

        // MCP: 改写为只含 mhclaw-mcp-broker 一条。用户原 mcp.servers 已经在
        // main.ts 启动期被 readLegacyMcpServers + mcpRegistry.init 一次性 migrate
        // 到 ~/.mhclaw/mcp-registry.json, 这里直接覆盖。
        // brokerEndpoint 没设(broker 启动失败的 fallback) → 不动 mcp.servers。
        if (this.brokerEndpoint) {
          const desiredMcp = {
            servers: {
              "mhclaw-mcp-broker": {
                url: this.brokerEndpoint.url,
                transport: "streamable-http",
              },
            },
          };
          if (JSON.stringify(config.mcp) !== JSON.stringify(desiredMcp)) {
            config.mcp = desiredMcp;
            changed = true;
          }
        }

        if (changed) {
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
          console.log(`[GatewayManager] Updated config with mhclaw defaults`);
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  async start(): Promise<void> {
    if (this.process) {
      console.log("[GatewayManager] Gateway already running");
      return;
    }

    this.ensureStateDir();
    this.ensureHostApprovalsFile();
    this.shouldRun = true;
    this.restartCount = 0;

    this.spawnGateway();
  }

  private spawnGateway() {
    const logPath = path.join(this.stateDir, "logs", "gateway.log");
    const logStream = fs.createWriteStream(logPath, { flags: "a" });

    // 清理 Electron 污染的环境变量，避免子进程（brew/npm/go 等）
    // 加载到 Electron 内置的 ICU 等动态库导致崩溃
    const cleanEnv = { ...process.env };
    delete cleanEnv.DYLD_LIBRARY_PATH;
    delete cleanEnv.DYLD_FALLBACK_LIBRARY_PATH;
    delete cleanEnv.DYLD_INSERT_LIBRARIES;
    delete cleanEnv.LD_LIBRARY_PATH;
    delete cleanEnv.ELECTRON_NO_ASAR;

    const env: NodeJS.ProcessEnv = {
      ...cleanEnv,
      OPENCLAW_STATE_DIR: this.stateDir,
      OPENCLAW_CONFIG_PATH: this.configPath, // 告诉 OpenClaw 读 mhclaw.json 而非默认 openclaw.json
      OPENCLAW_GATEWAY_PORT: String(this.port),
      // Plugin discovery 缓存 TTL,默认只有 1000ms —— 启动过程中会被调用 N 次,
      // 每次 TTL 过期都全量 rescan node_modules(62000+ fs.statSync),Windows 慢机
      // 累积成 87 秒阻塞(对应 OpenClaw issue #67869)。拉到 1 小时后只冷扫一次,
      // 后续全命中 in-memory 缓存。mhclaw 打包后 bundled skill 不会动态变,
      // 长缓存完全安全。
      OPENCLAW_PLUGIN_DISCOVERY_CACHE_MS: "3600000",
      // 禁用 Bonjour/mDNS 局域网广播。这是 OpenClaw 用来让同 WiFi 下其他设备
      // (手机 app)扫描发现 Gateway 的,用于 device-pair 功能。mhclaw 是桌面
      // 工作台,客户端直连 127.0.0.1:40789,完全不需要 mDNS 发现。
      // Windows 上 mDNS 广播常被防火墙干扰,实测 stuck 56 秒(日志里 "bonjour
      // restarting advertiser"),禁掉直接省这个延迟,零副作用。
      OPENCLAW_DISABLE_BONJOUR: "1",
      ELECTRON_RUN_AS_NODE: "1",
    };

    const entryPath = this.resolveClawEntry();
    const nodeBin = this.getNodeBin();

    console.log(`[GatewayManager] Spawning gateway on port ${this.port}`);
    console.log(`[GatewayManager] State dir: ${this.stateDir}`);
    console.log(`[GatewayManager] Node bin: ${nodeBin}`);
    console.log(`[GatewayManager] Entry: ${entryPath}`);

    this.process = spawn(nodeBin, [entryPath, "gateway", "--port", String(this.port), "--allow-unconfigured"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    this.process.stdout?.pipe(logStream);
    this.process.stderr?.pipe(logStream);

    this.process.on("spawn", () => {
      console.log(`[GatewayManager] Gateway started (pid: ${this.process?.pid})`);
      this.emitStatus({ state: "running", port: this.port, pid: this.process?.pid });

      // Gateway 启动后它会自己在 mhclaw.json 写入 auth.token(可能延迟几十秒,
      // 尤其 Windows 慢机+杀毒扫描)。监听 config 文件,token 一出现就再推一次
      // 状态事件,渲染进程能跟进重连,不依赖纯轮询。
      this.watchForAuthToken();
    });

    this.process.on("exit", (code, signal) => {
      console.log(`[GatewayManager] Gateway exited: code=${code}, signal=${signal}`);
      this.process = null;

      if (!this.shouldRun) {
        this.emitStatus({ state: "stopped" });
        return;
      }

      this.restartCount++;
      if (this.restartCount > this.maxRestarts) {
        console.error("[GatewayManager] Max restarts reached, giving up");
        this.emitStatus({ state: "error", error: "超过最大重启次数" });
        return;
      }

      console.log(
        `[GatewayManager] Restarting in ${this.restartDelay}ms (attempt ${this.restartCount}/${this.maxRestarts})`
      );
      this.emitStatus({ state: "restarting", attempt: this.restartCount });

      setTimeout(() => {
        if (this.shouldRun) {
          this.spawnGateway();
        }
      }, this.restartDelay);
    });

    this.process.on("error", (err) => {
      console.error("[GatewayManager] Failed to spawn gateway:", err.message);
      this.process = null;
      this.emitStatus({ state: "error", error: err.message });
    });
  }

  async stop(): Promise<void> {
    this.shouldRun = false;

    if (!this.process) return;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log("[GatewayManager] Force killing gateway");
        this.process?.kill("SIGKILL");
      }, 5000);

      this.process!.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });

      this.process!.kill("SIGTERM");
    });
  }

  async restart(): Promise<void> {
    if (this.restarting) return;
    this.restarting = true;

    await this.stop();
    this.restartCount = 0;
    await this.start();

    this.restarting = false;
  }

  get isRunning(): boolean {
    return this.process !== null;
  }

  get pid(): number | undefined {
    return this.process?.pid;
  }

  /** 从配置文件读取 auth token(Gateway 启动后会自动生成) */
  getAuthToken(): string | null {
    try {
      const raw = fs.readFileSync(this.configPath, "utf-8");
      const config = JSON.parse(raw);
      return config?.gateway?.auth?.token ?? null;
    } catch {
      return null;
    }
  }

  /**
   * 监听 config 文件,等 Gateway 写入 gateway.auth.token 后再推一次状态事件。
   * 最长 5 分钟后停止(正常 2 分钟内一定能拿到,拿不到说明 Gateway 挂了)。
   */
  private watchForAuthToken() {
    let lastSeen: string | null = this.getAuthToken();
    if (lastSeen) {
      this.emitStatus({ state: "running", port: this.port, pid: this.process?.pid });
      return;
    }
    const started = Date.now();
    const poll = () => {
      if (!this.process) return; // 已停
      if (Date.now() - started > 5 * 60_000) return; // 超时放弃
      const token = this.getAuthToken();
      if (token && token !== lastSeen) {
        lastSeen = token;
        console.log(`[GatewayManager] Auth token now available, re-emit status`);
        this.emitStatus({ state: "running", port: this.port, pid: this.process?.pid });
        return;
      }
      setTimeout(poll, 1000);
    };
    setTimeout(poll, 1000);
  }
}

export type GatewayStatus =
  | { state: "stopped" }
  | { state: "running"; port: number; pid?: number }
  | { state: "restarting"; attempt: number }
  | { state: "error"; error: string };
