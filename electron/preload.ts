import { contextBridge, ipcRenderer } from "electron";

/** 暴露给渲染进程的 API */
contextBridge.exposeInMainWorld("cjtClaw", {
  /** 平台标识 */
  platform: process.platform as "darwin" | "win32" | "linux",
  isElectron: true,

  /** 内置 Gateway 控制 */
  gateway: {
    start: () => ipcRenderer.invoke("gateway:start"),
    stop: () => ipcRenderer.invoke("gateway:stop"),
    restart: () => ipcRenderer.invoke("gateway:restart"),
    getStatus: () => ipcRenderer.invoke("gateway:status"),
    onStatusChange: (callback: (status: unknown) => void) => {
      const handler = (_event: unknown, status: unknown) => callback(status);
      ipcRenderer.on("gateway:status-changed", handler);
      return () => ipcRenderer.removeListener("gateway:status-changed", handler);
    },
  },

  /** 窗口控制 */
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    maximize: () => ipcRenderer.invoke("window:maximize"),
    close: () => ipcRenderer.invoke("window:close"),
  },

  /** 技能文件操作 */
  skills: {
    fetchFromGithub: (url: string) =>
      ipcRenderer.invoke("skills:fetchFromGithub", url) as Promise<{ name: string; content: string }>,
    saveSkillFile: (name: string, content: string) =>
      ipcRenderer.invoke("skills:saveSkillFile", name, content) as Promise<{ name: string }>,
    openFileDialog: () =>
      ipcRenderer.invoke("skills:openFileDialog") as Promise<{ zipPath: string } | null>,
    installZip: (zipPath: string) =>
      ipcRenderer.invoke("skills:installZip", zipPath) as Promise<{ name: string; path: string }>,
    deleteCustomSkill: (name: string) =>
      ipcRenderer.invoke("skills:deleteCustomSkill", name) as Promise<void>,
    /** 读取 skill 的 SKILL.md 源码（workspace > managed > bundled） */
    getMd: (name: string) =>
      ipcRenderer.invoke("skills:getMd", name) as Promise<{
        source: string;
        path: string;
        content: string;
      }>,
    /** 从 URL 下载 skill zip 并解压到 workspace/skills;meta 会写成 sidecar */
    installFromUrl: (args: {
      url: string;
      slug: string;
      meta?: {
        displayName?: string;
        description?: string;
        tags?: string[];
        channel?: string;
        version?: string;
        source?: string;
      };
    }) =>
      ipcRenderer.invoke("skills:installFromUrl", args) as Promise<{
        path: string;
        size: number;
      }>,
    /** 批量读所有已装 skill 的 hub sidecar */
    readHubSidecars: () =>
      ipcRenderer.invoke("skills:readHubSidecars") as Promise<
        Record<
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
          }
        >
      >,
  },

  /** 工作根(用户选定的任务产出父目录) */
  workRoot: {
    get: () => ipcRenderer.invoke("workRoot:get") as Promise<{
      path: string;
      autoCreated: boolean;
      updatedAt: number;
    }>,
    set: (newPath: string) =>
      ipcRenderer.invoke("workRoot:set", newPath) as Promise<{
        path: string;
        autoCreated: boolean;
        updatedAt: number;
      }>,
    pickAndSet: () =>
      ipcRenderer.invoke("workRoot:pickAndSet") as Promise<{
        path: string;
        autoCreated: boolean;
        updatedAt: number;
      } | null>,
  },

  /** 任务目录 */
  taskFolder: {
    listRecent: () =>
      ipcRenderer.invoke("taskFolder:listRecent") as Promise<
        Array<{
          path: string;
          displayName: string;
          kind: "blank" | "external";
          lastUsedAt: number;
          createdAt: number;
          pinned: boolean;
        }>
      >,
    createBlank: (sessionKey?: string) =>
      ipcRenderer.invoke("taskFolder:createBlank", sessionKey) as Promise<{
        path: string;
        entry: {
          path: string;
          displayName: string;
          kind: "blank" | "external";
          lastUsedAt: number;
          createdAt: number;
          pinned: boolean;
        };
        meta: unknown;
      }>,
    pickExternal: (sessionKey?: string) =>
      ipcRenderer.invoke("taskFolder:pickExternal", sessionKey) as Promise<{
        path: string;
        entry: {
          path: string;
          displayName: string;
          kind: "blank" | "external";
          lastUsedAt: number;
          createdAt: number;
          pinned: boolean;
        };
        meta: unknown;
      } | null>,
    bindSession: (args: { sessionKey: string; path: string }) =>
      ipcRenderer.invoke("taskFolder:bindSession", args) as Promise<{ ok: true }>,
    getForSession: (sessionKey: string) =>
      ipcRenderer.invoke("taskFolder:getForSession", sessionKey) as Promise<
        string | null
      >,
    togglePin: (dirPath: string) =>
      ipcRenderer.invoke("taskFolder:togglePin", dirPath) as Promise<{
        pinned: boolean;
      } | null>,
    removeFromIndex: (dirPath: string) =>
      ipcRenderer.invoke("taskFolder:removeFromIndex", dirPath) as Promise<{ ok: true }>,
    openInFinder: (dirPath: string) =>
      ipcRenderer.invoke("taskFolder:openInFinder", dirPath) as Promise<{ ok: true }>,
    ensureForSession: (sessionKey: string) =>
      ipcRenderer.invoke("taskFolder:ensureForSession", sessionKey) as Promise<{
        path: string;
        created: boolean;
      }>,
    remapSession: (oldKey: string, newKey: string) =>
      ipcRenderer.invoke("taskFolder:remapSession", { oldKey, newKey }) as Promise<{
        ok: true;
      }>,
  },

  /** 产物清单(embed 持久化 + fs 成品文件自动扫) */
  artifacts: {
    list: (sessionKey: string) =>
      ipcRenderer.invoke("artifacts:list", sessionKey) as Promise<
        Array<{
          source: "embed" | "fs";
          title?: string;
          registeredAt: number;
          ref?: string;
          url?: string;
          preferredHeight?: number;
          kind?: string;
          relPath?: string;
          size?: number;
          mtime?: number;
        }>
      >,
    add: (args: {
      sessionKey: string;
      entries: Array<{
        ref?: string;
        url?: string;
        title?: string;
        preferredHeight?: number;
        kind?: string;
      }>;
    }) => ipcRenderer.invoke("artifacts:add", args) as Promise<unknown>,
  },

  /** 文件系统(任务目录内) */
  fs: {
    listChildren: (args: { taskPath: string; rel: string }) =>
      ipcRenderer.invoke("fs:listChildren", args) as Promise<
        Array<{
          name: string;
          rel: string;
          isDir: boolean;
          size?: number;
          mtime?: number;
        }>
      >,
    readCurrentText: (args: { taskPath: string; rel: string }) =>
      ipcRenderer.invoke("fs:readCurrentText", args) as Promise<string | null>,
    writeText: (args: { taskPath: string; rel: string; content: string }) =>
      ipcRenderer.invoke("fs:writeText", args) as Promise<{ ok: true }>,
    deleteFile: (args: { taskPath: string; rel: string }) =>
      ipcRenderer.invoke("fs:deleteFile", args) as Promise<{ ok: true }>,
  },

  /** 快照(变更基线) */
  snapshot: {
    has: (taskPath: string) =>
      ipcRenderer.invoke("snapshot:has", taskPath) as Promise<boolean>,
    capture: (taskPath: string) =>
      ipcRenderer.invoke("snapshot:capture", taskPath) as Promise<{
        createdAt: number;
        entries: unknown[];
      }>,
    diff: (taskPath: string) =>
      ipcRenderer.invoke("snapshot:diff", taskPath) as Promise<
        Array<{
          rel: string;
          kind: "added" | "modified" | "deleted";
          size?: number;
          mtime?: number;
          hasBaselineText?: boolean;
          isText?: boolean;
        }>
      >,
    readBaselineText: (args: { taskPath: string; rel: string }) =>
      ipcRenderer.invoke("snapshot:readBaselineText", args) as Promise<
        string | null
      >,
  },

  /** 文件监听(当前任务目录) */
  fileWatcher: {
    start: (taskPath: string) =>
      ipcRenderer.invoke("fileWatcher:start", taskPath) as Promise<{ ok: true }>,
    stop: () => ipcRenderer.invoke("fileWatcher:stop") as Promise<{ ok: true }>,
    onEvent: (
      cb: (event: {
        taskPath: string;
        kind: "add" | "change" | "unlink";
        rel: string;
        size?: number;
        mtime?: number;
      }) => void,
    ) => {
      const handler = (_e: unknown, ev: unknown) => cb(ev as never);
      ipcRenderer.on("fileWatcher:event", handler);
      return () => ipcRenderer.removeListener("fileWatcher:event", handler);
    },
  },

  /** 系统级设置 / 授权(macOS 为主) */
  system: {
    getPermissions: () =>
      ipcRenderer.invoke("system:getPermissions") as Promise<{
        platform: NodeJS.Platform;
        supported: boolean;
        accessibility?: boolean;
      }>,
    openPrivacy: (kind: "fullDisk" | "accessibility" | "automation" | "notifications") =>
      ipcRenderer.invoke("system:openPrivacy", kind) as Promise<{
        ok: boolean;
        reason?: string;
      }>,
    setPreventSleep: (enabled: boolean) =>
      ipcRenderer.invoke("system:setPreventSleep", enabled) as Promise<{
        active: boolean;
      }>,
    getPreventSleep: () =>
      ipcRenderer.invoke("system:getPreventSleep") as Promise<{ active: boolean }>,
    openExternal: (url: string) =>
      ipcRenderer.invoke("system:openExternal", url) as Promise<{ ok: boolean }>,
  },

  /** mhclaw:// deep link 订阅(登录授权回调等) */
  auth: {
    onDeepLink: (callback: (url: string) => void) => {
      const handler = (_e: unknown, url: string) => callback(url);
      ipcRenderer.on("auth:deeplink", handler);
      return () => ipcRenderer.removeListener("auth:deeplink", handler);
    },
  },

  /** 微信渠道扫码登录(走 openclaw CLI 子进程) */
  weixinLogin: {
    start: () =>
      ipcRenderer.invoke("weixin:login:start") as Promise<{
        ok: boolean;
        reason?: string;
      }>,
    cancel: () =>
      ipcRenderer.invoke("weixin:login:cancel") as Promise<{ ok: boolean }>,
    onQr: (cb: (payload: { url: string }) => void) => {
      const h = (_e: unknown, p: { url: string }) => cb(p);
      ipcRenderer.on("weixin:login:qr", h);
      return () => ipcRenderer.removeListener("weixin:login:qr", h);
    },
    onLog: (cb: (chunk: string) => void) => {
      const h = (_e: unknown, c: string) => cb(c);
      ipcRenderer.on("weixin:login:log", h);
      return () => ipcRenderer.removeListener("weixin:login:log", h);
    },
    onDone: (cb: (payload: { code: number | null; ok: boolean }) => void) => {
      const h = (_e: unknown, p: { code: number | null; ok: boolean }) => cb(p);
      ipcRenderer.on("weixin:login:done", h);
      return () => ipcRenderer.removeListener("weixin:login:done", h);
    },
  },

  /** Preview 可用性探测(主进程查 fs 状态) */
  previewProbe: {
    checkFile: (args: { url: string }) =>
      ipcRenderer.invoke("previewProbe:checkFile", args) as Promise<{
        exists: boolean;
        size?: number;
        mtime?: number;
        error?: string;
      }>,
  },

  /** MCP 探测(主进程自建 MCP client,不走 gateway) */
  mcpProbe: {
    one: (args: {
      config: Record<string, unknown>;
      timeoutMs?: number;
    }) =>
      ipcRenderer.invoke("mcpProbe:one", args) as Promise<{
        ok: boolean;
        tools?: Array<{ name: string; description?: string }>;
        error?: string;
        durationMs: number;
      }>,
    all: (args: {
      servers: Record<string, Record<string, unknown>>;
      concurrency?: number;
      timeoutMs?: number;
    }) =>
      ipcRenderer.invoke("mcpProbe:all", args) as Promise<
        Record<
          string,
          {
            ok: boolean;
            tools?: Array<{ name: string; description?: string }>;
            error?: string;
            durationMs: number;
          }
        >
      >,
  },

  /** MCP registry —— 用户 MCP 配置真实来源 (~/.mhclaw/mcp-registry.json) */
  mcpRegistry: {
    list: () =>
      ipcRenderer.invoke("mcpRegistry:list") as Promise<
        Record<string, Record<string, unknown>>
      >,
    upsert: (args: { name: string; config: Record<string, unknown> }) =>
      ipcRenderer.invoke("mcpRegistry:upsert", args) as Promise<{ ok: true }>,
    remove: (name: string) =>
      ipcRenderer.invoke("mcpRegistry:remove", name) as Promise<{ ok: true }>,
    setDisabled: (args: { name: string; disabled: boolean }) =>
      ipcRenderer.invoke("mcpRegistry:setDisabled", args) as Promise<{ ok: true }>,
    importBatch: (servers: Record<string, Record<string, unknown>>) =>
      ipcRenderer.invoke("mcpRegistry:import", servers) as Promise<{
        inserted: number;
      }>,
  },

  /** MCP supervisor —— 健康状态 + last-known-good 数据来源 */
  mcpSupervisor: {
    status: () =>
      ipcRenderer.invoke("mcpSupervisor:status") as Promise<
        Array<{
          name: string;
          status: "configured" | "connecting" | "available" | "unavailable" | "disabled";
          lastProbeAt?: number;
          lastSuccessAt?: number;
          lastError?: string;
          durationMs?: number;
          toolCount?: number;
          backoffCount: number;
        }>
      >,
    probe: (name: string) =>
      ipcRenderer.invoke("mcpSupervisor:probe", name) as Promise<{ ok: true }>,
    onHealthChanged: (
      cb: (evt: {
        name: string;
        health?: {
          name: string;
          status:
            | "configured"
            | "connecting"
            | "available"
            | "unavailable"
            | "disabled";
          lastProbeAt?: number;
          lastSuccessAt?: number;
          lastError?: string;
          durationMs?: number;
          toolCount?: number;
          backoffCount: number;
        };
        removed?: boolean;
      }) => void,
    ) => {
      const handler = (_e: unknown, ev: unknown) => cb(ev as never);
      ipcRenderer.on("mcp:health-changed", handler);
      return () => ipcRenderer.removeListener("mcp:health-changed", handler);
    },
  },

  /** MCP broker —— per-call snapshot + endpoint 信息 */
  mcpBroker: {
    snapshotTail: (opts?: { limit?: number; brokerSessionId?: string }) =>
      ipcRenderer.invoke("mcpBroker:snapshotTail", opts ?? {}) as Promise<
        Array<{
          ts: number;
          brokerSessionId: string;
          outcome: "ok" | "error" | "rejected";
          serverName: string;
          toolName: string;
          durationMs?: number;
          error?: string;
        }>
      >,
    endpoint: () =>
      ipcRenderer.invoke("mcpBroker:endpoint") as Promise<{
        url: string;
        port: number;
      } | null>,
  },

  /** 授权目录(白名单) */
  authorizedDirs: {
    list: () =>
      ipcRenderer.invoke("authorizedDirs:list") as Promise<
        Array<{ path: string; note?: string; addedAt: number }>
      >,
    add: (args: { path: string; note?: string }) =>
      ipcRenderer.invoke("authorizedDirs:add", args) as Promise<{
        path: string;
        note?: string;
        addedAt: number;
      }>,
    remove: (absPath: string) =>
      ipcRenderer.invoke("authorizedDirs:remove", absPath) as Promise<{ ok: true }>,
    pickAndAdd: (note?: string) =>
      ipcRenderer.invoke("authorizedDirs:pickAndAdd", note) as Promise<{
        path: string;
        note?: string;
        addedAt: number;
      } | null>,
  },
});
