import type { BuiltinGatewayStatus } from "./gateway";

declare global {
  interface Window {
    cjtClaw?: {
      platform: "darwin" | "win32" | "linux";
      isElectron: true;
      gateway: {
        start: () => Promise<void>;
        stop: () => Promise<void>;
        restart: () => Promise<void>;
        getStatus: () => Promise<{
          isRunning: boolean;
          port: number;
          pid?: number;
          token?: string;
        }>;
        onStatusChange: (
          callback: (status: BuiltinGatewayStatus) => void
        ) => () => void;
      };
      window: {
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
      };
      skills: {
        fetchFromGithub: (url: string) => Promise<{ name: string; content: string }>;
        saveSkillFile: (name: string, content: string) => Promise<{ name: string }>;
        openFileDialog: () => Promise<{ zipPath: string } | null>;
        installZip: (zipPath: string) => Promise<{ name: string; path: string }>;
        deleteCustomSkill: (name: string) => Promise<void>;
        getMd: (name: string) => Promise<{
          source: string;
          path: string;
          content: string;
        }>;
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
        }) => Promise<{
          path: string;
          size: number;
        }>;
        readHubSidecars: () => Promise<
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
        >;
      };
      workRoot: {
        get: () => Promise<{ path: string; autoCreated: boolean; updatedAt: number }>;
        set: (newPath: string) => Promise<{
          path: string;
          autoCreated: boolean;
          updatedAt: number;
        }>;
        pickAndSet: () => Promise<{
          path: string;
          autoCreated: boolean;
          updatedAt: number;
        } | null>;
      };
      fs: {
        listChildren: (args: { taskPath: string; rel: string }) => Promise<FsNode[]>;
        readCurrentText: (args: { taskPath: string; rel: string }) => Promise<string | null>;
        writeText: (args: { taskPath: string; rel: string; content: string }) => Promise<{ ok: true }>;
        deleteFile: (args: { taskPath: string; rel: string }) => Promise<{ ok: true }>;
      };
      snapshot: {
        has: (taskPath: string) => Promise<boolean>;
        capture: (taskPath: string) => Promise<{ createdAt: number; entries: unknown[] }>;
        diff: (taskPath: string) => Promise<ChangeEntry[]>;
        readBaselineText: (args: { taskPath: string; rel: string }) => Promise<string | null>;
      };
      fileWatcher: {
        start: (taskPath: string) => Promise<{ ok: true }>;
        stop: () => Promise<{ ok: true }>;
        onEvent: (cb: (event: WatcherEvent) => void) => () => void;
      };
      previewProbe: {
        checkFile: (args: { url: string }) => Promise<{
          exists: boolean;
          size?: number;
          mtime?: number;
          error?: string;
        }>;
      };
      mcpProbe: {
        one: (args: {
          name?: string;
          config: Record<string, unknown>;
          timeoutMs?: number;
        }) => Promise<{
          ok: boolean;
          tools?: Array<{ name: string; description?: string }>;
          error?: string;
          durationMs: number;
        }>;
        all: (args: {
          servers: Record<string, Record<string, unknown>>;
          concurrency?: number;
          timeoutMs?: number;
        }) => Promise<
          Record<
            string,
            {
              ok: boolean;
              tools?: Array<{ name: string; description?: string }>;
              error?: string;
              durationMs: number;
            }
          >
        >;
      };
      mcpRegistry: {
        list: () => Promise<Record<string, Record<string, unknown>>>;
        upsert: (args: {
          name: string;
          config: Record<string, unknown>;
        }) => Promise<{ ok: true }>;
        remove: (name: string) => Promise<{ ok: true }>;
        setDisabled: (args: {
          name: string;
          disabled: boolean;
        }) => Promise<{ ok: true }>;
        importBatch: (
          servers: Record<string, Record<string, unknown>>,
        ) => Promise<{ inserted: number }>;
      };
      mcpSupervisor: {
        status: () => Promise<McpHealthStatusEntry[]>;
        probe: (name: string) => Promise<{ ok: true }>;
        onHealthChanged: (
          cb: (evt: {
            name: string;
            health?: McpHealthStatusEntry;
            removed?: boolean;
          }) => void,
        ) => () => void;
      };
      mcpBroker: {
        snapshotTail: (opts?: {
          limit?: number;
          brokerSessionId?: string;
        }) => Promise<McpBrokerCallSnapshot[]>;
        endpoint: () => Promise<{ url: string; port: number } | null>;
      };
      authorizedDirs: {
        list: () => Promise<AuthorizedDir[]>;
        add: (args: { path: string; note?: string }) => Promise<AuthorizedDir>;
        remove: (absPath: string) => Promise<{ ok: true }>;
        pickAndAdd: (note?: string) => Promise<AuthorizedDir | null>;
      };
      system: {
        getPermissions: () => Promise<{
          platform: NodeJS.Platform;
          supported: boolean;
          accessibility?: boolean;
        }>;
        openPrivacy: (
          kind: "fullDisk" | "accessibility" | "automation" | "notifications",
        ) => Promise<{ ok: boolean; reason?: string }>;
        setPreventSleep: (enabled: boolean) => Promise<{ active: boolean }>;
        getPreventSleep: () => Promise<{ active: boolean }>;
        openExternal: (url: string) => Promise<{ ok: boolean; reason?: string }>;
      };
      auth: {
        /** 订阅 mhclaw:// deep link(返回取消订阅函数) */
        onDeepLink: (callback: (url: string) => void) => () => void;
      };
      weixinLogin: {
        start: () => Promise<{ ok: boolean; reason?: string }>;
        cancel: () => Promise<{ ok: boolean }>;
        /** 订阅二维码 URL(返回取消函数);回调带 {url: string} */
        onQr: (cb: (payload: { url: string }) => void) => () => void;
        /** 订阅 CLI 日志(可选调试用) */
        onLog: (cb: (chunk: string) => void) => () => void;
        /** CLI 进程退出事件;ok=true 代表登录成功 */
        onDone: (
          cb: (payload: { code: number | null; ok: boolean }) => void,
        ) => () => void;
      };
      taskFolder: {
        listRecent: () => Promise<OutputDirEntry[]>;
        createBlank: (sessionKey?: string) => Promise<{
          path: string;
          entry: OutputDirEntry;
          meta: unknown;
        }>;
        pickExternal: (sessionKey?: string) => Promise<{
          path: string;
          entry: OutputDirEntry;
          meta: unknown;
        } | null>;
        bindSession: (args: { sessionKey: string; path: string }) => Promise<{ ok: true }>;
        getForSession: (sessionKey: string) => Promise<string | null>;
        togglePin: (dirPath: string) => Promise<{ pinned: boolean } | null>;
        removeFromIndex: (dirPath: string) => Promise<{ ok: true }>;
        openInFinder: (dirPath: string) => Promise<{ ok: true }>;
        ensureForSession: (sessionKey: string) => Promise<{
          path: string;
          created: boolean;
        }>;
        remapSession: (oldKey: string, newKey: string) => Promise<{ ok: true }>;
      };
      artifacts: {
        list: (sessionKey: string) => Promise<ArtifactEntry[]>;
        add: (args: {
          sessionKey: string;
          entries: Array<{
            ref?: string;
            url?: string;
            title?: string;
            preferredHeight?: number;
            kind?: string;
          }>;
        }) => Promise<ArtifactEntry[] | null>;
      };
    };
  }

  interface ArtifactEntry {
    source: "embed" | "fs";
    title?: string;
    registeredAt: number;
    /** embed 专属 */
    ref?: string;
    url?: string;
    preferredHeight?: number;
    kind?: string;
    /** fs 专属:相对 task folder 的路径 */
    relPath?: string;
    size?: number;
    mtime?: number;
  }

  interface AuthorizedDir {
    path: string;
    note?: string;
    addedAt: number;
  }

  interface FsNode {
    name: string;
    rel: string;
    isDir: boolean;
    size?: number;
    mtime?: number;
  }

  interface ChangeEntry {
    rel: string;
    kind: "added" | "modified" | "deleted";
    size?: number;
    mtime?: number;
    hasBaselineText?: boolean;
    isText?: boolean;
  }

  interface WatcherEvent {
    taskPath: string;
    kind: "add" | "change" | "unlink";
    rel: string;
    size?: number;
    mtime?: number;
  }

  interface OutputDirEntry {
    path: string;
    displayName: string;
    kind: "blank" | "external";
    lastUsedAt: number;
    createdAt: number;
    pinned: boolean;
  }

  type McpHealthState =
    | "configured"
    | "connecting"
    | "available"
    | "unavailable"
    | "disabled";

  interface McpHealthStatusEntry {
    name: string;
    status: McpHealthState;
    lastProbeAt?: number;
    lastSuccessAt?: number;
    lastError?: string;
    durationMs?: number;
    toolCount?: number;
    backoffCount: number;
  }

  interface McpBrokerCallSnapshot {
    ts: number;
    brokerSessionId: string;
    outcome: "ok" | "error" | "rejected";
    serverName: string;
    toolName: string;
    durationMs?: number;
    error?: string;
  }
}

export {};
