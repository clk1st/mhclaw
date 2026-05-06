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

  /** Inject the broker endpoint after broker.start() and before gateway start. */
  setBrokerEndpoint(endpoint: { url: string; port: number }): void {
    this.brokerEndpoint = endpoint;
  }

  private emitStatus(status: GatewayStatus) {
    this.onStatusChange?.(status);
  }

  /**
   * Resolve absolute entry paths for the bundled community plugins.
   *
   * Three Chinese-channel plugins (WeChat / WeCom / DingTalk) are
   * installed as ordinary npm deps under node_modules. We read each
   * package's `package.json.openclaw.extensions` array and assemble
   * absolute paths, then write them to `config.plugins.load.paths` so
   * OpenClaw can discover them. In asar builds we resolve to the
   * unpacked tree.
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
        // Some packages neither expose `./package.json` nor are
        // CommonJS-resolvable (require.resolve fails on ESM-only ones),
        // so we try in order:
        //   (1) resolve `<pkg>/package.json`
        //   (2) resolve the main entry and walk up to the package root
        //   (3) fall back to assembling node_modules/<pkg> directly.
        // Any of those that yields an existing directory wins.
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
            // require.resolve failed entirely — fall through to the filesystem path.
          }
        }
        if (!pkgRoot) {
          // Last resort: hard-code node_modules/<pkg>. In dev __dirname
          // is `dist-electron/`; in prod it's
          // `resources/app.asar.unpacked` or `app.asar`. In all cases
          // going up two levels lands at the project root.
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
        // We register the *package root*, not the extension entry file.
        // OpenClaw scans `openclaw.plugin.json` from the root and walks
        // `extensions` from there. Some packages have their entry under
        // `dist/`, while the manifest is always at the root — registering
        // the entry directly would make OpenClaw look for the manifest
        // in the wrong directory.
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
   * Resolve the entry path for the bundled OpenClaw CLI.
   *
   * `openclaw.mjs` lives at the package root, but the package's main
   * `exports` points to `dist/index.js`. So we resolve the main entry
   * first, then walk back up to the package root to find `openclaw.mjs`.
   */
  private resolveClawEntry(): string {
    const require = createRequire(path.join(__dirname, "package.json"));
    const pkgMain = require.resolve("openclaw");
    // pkgMain = .../openclaw/dist/index.js → package root = ../
    const pkgRoot = path.resolve(path.dirname(pkgMain), "..");
    let entry = path.join(pkgRoot, "openclaw.mjs");

    // After packaging, paths inside the asar need to use the unpacked
    // copy because subprocesses don't have Electron's asar runtime.
    // Electron's asar patch makes `fs.existsSync` return true for asar
    // paths, so we must rewrite to the unpacked path explicitly — only
    // then can a child process actually read the file.
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
   * Resolve the Node.js binary used to spawn child processes.
   *
   * On packaged macOS we use the Electron Helper binary together with
   * `ELECTRON_RUN_AS_NODE=1` to run the Gateway in Node mode. Unlike the
   * main Electron binary, the Helper doesn't produce a second Dock icon.
   */
  /**
   * Run a single openclaw CLI command (not the gateway) and stream
   * stdout / stderr through the supplied callbacks. Shares the same
   * entry / node bin / env-sanitization logic as the Gateway.
   * Returns a cancellation function the caller can use to kill the child.
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
   * Make sure the host-level exec-approvals file has lenient defaults.
   *
   * OpenClaw hard-codes the path `~/.openclaw/exec-approvals.json` for
   * the host-level approval state — it does NOT follow
   * OPENCLAW_STATE_DIR, so it's a machine-wide gate. mhclaw is a
   * single-user desktop app: by default we don't want a permission
   * prompt for every command. This is the local equivalent of
   * `openclaw exec-policy preset yolo`.
   *
   * Merge strategy: preserve any existing `agents` / `socket` / `version`
   * fields (the user's curated allowlist stays put). Only ensure that
   * `defaults` contains `ask: "off"` + `security: "full"`. If the
   * existing config is already as lenient or more so, we leave it alone.
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
    // Dedicated workspace for the `claw` agent (channel-message sessions
    // land here, kept isolated from the desktop UI's workspace).
    const clawDir = path.join(this.stateDir, "claw");
    if (!fs.existsSync(clawDir)) {
      fs.mkdirSync(clawDir, { recursive: true });
    }

    // One-shot migration: rename a legacy `openclaw.json` to `mhclaw.json`
    // (branding consistency only; the file contents are preserved).
    const legacyPath = path.join(this.stateDir, "openclaw.json");
    if (fs.existsSync(legacyPath) && !fs.existsSync(this.configPath)) {
      try {
        fs.renameSync(legacyPath, this.configPath);
        console.log(`[GatewayManager] Migrated ${legacyPath} → ${this.configPath}`);
      } catch (err) {
        console.warn(`[GatewayManager] Migration failed, will create fresh mhclaw.json:`, err);
      }
    }

    // Make sure a minimal config file exists, otherwise Gateway refuses to start.
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
          // Two-agent split:
          //   - main → desktop-UI task sessions; sessionKey =
          //            `agent:main:session-<ts>`.
          //   - claw → inbound messages from any channel
          //            (WeChat / WeCom / DingTalk); sessionKey =
          //            `agent:claw:main`.
          // Each gets its own workspace + memory so chat history and
          // task files never cross-contaminate.
          list: [
            { id: "main", default: true, workspace: workspacePath },
            { id: "claw", workspace: clawWorkspacePath },
          ],
        },
        // Top-level `bindings` (NOT `agents.bindings`) route each channel
        // onto the claw agent.
        bindings: [
          // `accountId: "*"` is critical: leaving it unset gets
          // normalized to an empty string by OpenClaw, which then falls
          // off every match tier. `"*"` routes ALL accounts under that
          // channel to the claw agent (see resolve-route's byChannel
          // bucket).
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
          // Hijack the `user` key: OpenClaw otherwise hard-codes
          // `user = existing-session` and would attach to the user's
          // everyday Chrome. By setting `user` explicitly, OpenClaw
          // skips the default injection, the driver falls back to
          // "openclaw", and we launch an independent Chrome instance.
          defaultProfile: "user",
          profiles: {
            user: { cdpPort: 18800, color: "#E8683A" },
          },
          ssrfPolicy: { dangerouslyAllowPrivateNetwork: true },
        },
        // MCP: only expose the mhclaw-managed broker — OpenClaw never
        // sees the user's individual MCP servers. The actual user
        // config lives at ~/.mhclaw/mcp-registry.json and the broker
        // fans out internally. If `brokerEndpoint` isn't set yet
        // (broker startup failed), we skip the mcp block as a fallback.
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
      // Ensure the existing config contains the mhclaw-required settings.
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

        // Point workspace at ~/.mhclaw/workspace.
        const workspacePath = path.join(this.stateDir, "workspace");
        const clawWorkspacePath = path.join(this.stateDir, "claw");
        if (!config.agents) config.agents = {};
        if (!config.agents.defaults) config.agents.defaults = {};
        if (!config.agents.defaults.workspace) {
          config.agents.defaults.workspace = workspacePath;
          changed = true;
        }

        // agents.list: guarantee both `main` and `claw` agents exist
        // with the correct workspaces.
        //   - main (default=true) → desktop-UI session-<ts> tasks.
        //   - claw                 → channel inbound messages, isolated
        //                            workspace / memory.
        const desiredAgentList = [
          { id: "main", default: true, workspace: workspacePath },
          { id: "claw", workspace: clawWorkspacePath },
        ];
        const currentList = Array.isArray(config.agents.list)
          ? config.agents.list
          : [];
        // Merge by id: our desired entries override any same-id entries
        // in `current`; any other custom agents are preserved as-is.
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

        // bindings: route every bundled channel onto the claw agent.
        const desiredBindings = [
          // `accountId: "*"` is critical: leaving it unset gets
          // normalized to an empty string by OpenClaw, which then falls
          // off every match tier. `"*"` routes ALL accounts under that
          // channel to the claw agent (see resolve-route's byChannel
          // bucket).
          { agentId: "claw", match: { channel: "openclaw-weixin", accountId: "*" } },
          { agentId: "claw", match: { channel: "wecom", accountId: "*" } },
          { agentId: "claw", match: { channel: "ddingtalk", accountId: "*" } },
        ];
        const currentBindings = Array.isArray(config.bindings)
          ? config.bindings
          : [];
        // Same-channel dedup: our `desired` wins; any user-defined
        // bindings on other channels are preserved.
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

        // Disable the memory-core plugin slot (packaged builds don't include it).
        if (!config.plugins) config.plugins = {};
        if (!config.plugins.slots) config.plugins.slots = {};
        if (config.plugins.slots.memory !== "") {
          config.plugins.slots.memory = "";
          changed = true;
        }

        // Default to a permissive exec policy in mhclaw: the user IS the
        // tenant, no YC/production multi-tenant isolation needed. The
        // AI shouldn't pop an approval prompt every time it opens a
        // browser or runs a shell command. Equivalent to
        // `openclaw exec-policy preset yolo` for the local part.
        if (!config.tools) config.tools = {};
        if (!config.tools.exec) config.tools.exec = {};
        const execDesired = { host: "gateway", security: "full", ask: "off" };
        for (const [k, v] of Object.entries(execDesired)) {
          if (config.tools.exec[k] !== v) {
            config.tools.exec[k] = v;
            changed = true;
          }
        }

        // Browser policy:
        //   1. Hijack the `user` key. OpenClaw's resolveBrowserConfig
        //      otherwise hard-injects
        //      `user = {driver: "existing-session", attachOnly: true}`,
        //      routing through chrome-devtools-mcp to attach to the
        //      user's everyday Chrome — this is exactly the root cause
        //      of the "AI takes over my browser" bug. By providing a
        //      `user` profile explicitly, OpenClaw sees `result.user`
        //      already exists, skips the default injection, the driver
        //      falls back to "openclaw", and `launchOpenClawChrome`
        //      starts an isolated Chrome instance.
        //     Chrome,user-data-dir = ~/.openclaw/profile-user/。
        //   2. Relax the SSRF policy to allow private networks (CDP
        //      127.0.0.1 loopback handshakes + hostname navigation).
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

        // Bundled community plugins (WeChat / WeCom / DingTalk):
        // inject their absolute paths into plugins.load.paths.
        if (!config.plugins.load) config.plugins.load = {};
        const bundled = this.resolveBundledPluginPaths();
        const existing: string[] = Array.isArray(config.plugins.load.paths)
          ? config.plugins.load.paths
          : [];
        // Preserve any user-defined paths that aren't under node_modules;
        // only sync the bundled-plugin portion.
        const nonBundled = existing.filter((p) => !/node_modules/.test(p));
        const merged = [...nonBundled, ...bundled];
        if (JSON.stringify(merged) !== JSON.stringify(existing)) {
          config.plugins.load.paths = merged;
          changed = true;
        }

        // Clean up legacy keys retired in 5.x (carrying these over from
        // a 4.x upgrade would trigger a schema rejection):
        //   agents.defaults.llm — see changelog #76798/#76800;
        //   `doctor --fix` removes the same key.
        // This is an ad-hoc one-off migration; the key won't be re-added.
        if (config.agents?.defaults?.llm !== undefined) {
          delete config.agents.defaults.llm;
          changed = true;
          console.log(`[GatewayManager] Removed retired key agents.defaults.llm`);
        }

        // MCP: rewrite the section so it only contains the single
        // `mhclaw-mcp-broker` entry. Any user-supplied `mcp.servers` was
        // already migrated to ~/.mhclaw/mcp-registry.json during
        // `main.ts` startup (readLegacyMcpServers + mcpRegistry.init),
        // so we can safely overwrite it here.
        // brokerEndpoint not set (broker startup failed) → don't touch mcp.servers.
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

    // Strip env vars Electron pollutes — otherwise subprocesses
    // (brew/npm/go and friends) load Electron's bundled ICU and crash.
    const cleanEnv = { ...process.env };
    delete cleanEnv.DYLD_LIBRARY_PATH;
    delete cleanEnv.DYLD_FALLBACK_LIBRARY_PATH;
    delete cleanEnv.DYLD_INSERT_LIBRARIES;
    delete cleanEnv.LD_LIBRARY_PATH;
    delete cleanEnv.ELECTRON_NO_ASAR;

    const env: NodeJS.ProcessEnv = {
      ...cleanEnv,
      OPENCLAW_STATE_DIR: this.stateDir,
      OPENCLAW_CONFIG_PATH: this.configPath, // tell OpenClaw to read mhclaw.json instead of the default openclaw.json
      OPENCLAW_GATEWAY_PORT: String(this.port),
      // Plugin discovery cache TTL defaults to just 1000ms. Startup
      // calls into discovery dozens of times; every TTL expiry triggers
      // a full rescan of node_modules (62000+ fs.statSync calls), which
      // on slow Windows machines cumulatively blocks for ~87s (see
      // OpenClaw issue #67869). Bumping to 1 hour means a single cold
      // scan up front, then in-memory cache hits forever after. Bundled
      // skills don't change at runtime in a packaged mhclaw build, so
      // a long TTL is perfectly safe.
      OPENCLAW_PLUGIN_DISCOVERY_CACHE_MS: "3600000",
      // Disable Bonjour/mDNS LAN broadcasting. OpenClaw uses it to let
      // other devices on the same WiFi (mobile apps) discover the
      // Gateway for device-pairing. mhclaw is a desktop workbench whose
      // client connects directly to 127.0.0.1:40789 — mDNS discovery
      // serves no purpose. On Windows, mDNS broadcasting often gets
      // throttled by the firewall (we've measured 56s stalls with log
      // lines like "bonjour restarting advertiser"); disabling it
      // saves that latency with zero downside.
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

      // After startup the Gateway writes auth.token into mhclaw.json on
      // its own (possibly tens of seconds later, especially on slow
      // Windows machines under AV scanning). We watch the config file
      // and re-emit a status event the moment the token appears, so the
      // renderer can reconnect immediately without resorting to polling.
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
        this.emitStatus({ state: "error", error: "Max restart attempts exceeded" });
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

  /** Read the auth token from the config file (Gateway generates it on startup). */
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
   * Watch the config file. Once the Gateway writes
   * `gateway.auth.token`, re-emit a status event so consumers can
   * proceed. Times out after 5 minutes — token normally appears in
   * under 2 minutes; missing it that long means the Gateway is wedged.
   */
  private watchForAuthToken() {
    let lastSeen: string | null = this.getAuthToken();
    if (lastSeen) {
      this.emitStatus({ state: "running", port: this.port, pid: this.process?.pid });
      return;
    }
    const started = Date.now();
    const poll = () => {
      if (!this.process) return; // already stopped
      if (Date.now() - started > 5 * 60_000) return; // timed out — give up
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
