import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tryUnwrapMcpRemote } from "@/lib/mcp-wrapper";

/**
 * MCP server 配置(联合类型,按字段判断 transport):
 * - 含 `command` → stdio
 * - 含 `url` 且无 `transport` 或 `transport === "sse"` → HTTP / SSE
 * - 含 `url` 且 `transport === "streamable-http"` → 双向 HTTP 流
 */
export interface McpServerStdio {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  disabled?: boolean;
  [extra: string]: unknown;
}

export interface McpServerHttp {
  url: string;
  transport?: "sse" | "streamable-http";
  headers?: Record<string, string>;
  connectionTimeoutMs?: number;
  disabled?: boolean;
  [extra: string]: unknown;
}

export type McpServerConfig = McpServerStdio | McpServerHttp;

export type McpTransportKind = "stdio" | "sse" | "streamable-http";

/**
 * 识别一条 server 的传输方式。
 * 有 command → stdio,否则看 transport 字段,默认 streamable-http。
 * 历史数据(mcp-remote wrapped)由 normalizeStoredConfig 统一 unwrap 后再进来。
 */
export function detectTransport(s: McpServerConfig): McpTransportKind {
  const stdio = s as McpServerStdio;
  if (stdio.command) return "stdio";
  const t = (s as McpServerHttp).transport;
  return t === "sse" ? "sse" : "streamable-http";
}

/**
 * 读存储时的归一化:老版本把 HTTP MCP 包成 stdio+mcp-remote 存(防 SDK
 * SSE header bug),新版本 OpenClaw 原生 Streamable HTTP 已能带 headers,
 * 不再需要 wrap。读时把老 wrap 数据还原成 { url, headers, transport } 形,
 * 用户下次编辑保存即完成迁移。
 */
function normalizeStoredConfig(config: McpServerConfig): McpServerConfig {
  const unwrapped = tryUnwrapMcpRemote(config);
  if (!unwrapped) return config;
  // disabled 字段要保留
  const disabled = (config as { disabled?: boolean }).disabled;
  const out: McpServerHttp = {
    url: unwrapped.url,
    transport: unwrapped.transport ?? "streamable-http",
    ...(unwrapped.headers ? { headers: unwrapped.headers } : {}),
    ...(disabled !== undefined ? { disabled } : {}),
  };
  return out;
}

export interface McpServerEntry {
  name: string;
  config: McpServerConfig;
  transport: McpTransportKind;
}

/**
 * 改造说明 (broker 上线后):
 *  - 数据来源不再是 OpenClaw `config.get` 的 mcp.servers
 *  - 改成走主进程 IPC `mcpRegistry.*` (~/.mhclaw/mcp-registry.json)
 *  - 这样不会撞 OpenClaw control-plane 3/60s 限流
 *  - 健康状态走 mcpSupervisor IPC, 跟 catalog 解耦
 */

/**
 * MCP server 的"探测结果"—— 连接是否成功 + 暴露的 tool 列表 + 错误原因。
 *
 * 为什么不走 gateway:OpenClaw gateway 没有任何 mcp.* RPC,tools.catalog /
 * tools.effective 都不含 MCP server 的 tool(只含 core + plugin + channel)。
 * gateway 层的 MCP 能力是黑盒 —— agent 能调用 MCP tool,但 UI 层无从观测。
 *
 * 我们对标 WorkBuddy 的做法:在 Electron 主进程里自建轻量 MCP client,
 * 直接 spawn stdio + JSON-RPC 拉 tools/list,拿完即关。跟 gateway 并行,
 * 不影响 agent 的 MCP 执行链路。具体实现见 electron/services/mcp-probe.ts。
 */
export interface McpServerToolSummary {
  name: string;
  description?: string;
}
export interface McpServerProbeInfo {
  ok: boolean;
  tools: McpServerToolSummary[];
  error?: string;
  durationMs: number;
}
/**
 * 单条 MCP server 的探测 hook —— 每条 server 一个独立 query,
 * 用户点"刷新"只重探这一条,不影响其他 server(也不影响 AI 对话)。
 *
 * queryKey 带 configKey:配置改了(比如编辑了 URL/headers)会自动重探,
 * 不改配置时保持缓存命中。
 */
export function useMcpServerProbe(
  name: string,
  config: McpServerConfig,
  enabled: boolean,
) {
  const probeApi = window.cjtClaw?.mcpProbe;
  // 把配置序列化进 queryKey,配置变化(编辑了 URL/headers 等)自动触发重探
  const configKey = JSON.stringify(config);

  return useQuery({
    queryKey: ["mcp-server-probe", name, configKey],
    queryFn: async (): Promise<McpServerProbeInfo> => {
      if (!probeApi) {
        return {
          ok: false,
          tools: [],
          error: "主进程 probe 接口不可用",
          durationMs: 0,
        };
      }
      const res = await probeApi.one({
        config: config as unknown as Record<string, unknown>,
        timeoutMs: 15_000,
      });
      return {
        ok: res.ok,
        tools: (res.tools ?? [])
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name)),
        error: res.error,
        durationMs: res.durationMs,
      };
    },
    enabled: !!probeApi && enabled,
    // probe 走 spawn npx 较慢,结果缓存 30s 避免重复拉
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/** 拉取所有 MCP server 配置(broker: 主进程 mcp-registry.json) */
export function useMcpServers() {
  const registry = window.cjtClaw?.mcpRegistry;
  return useQuery({
    queryKey: ["mcp-servers"],
    queryFn: async (): Promise<{ entries: McpServerEntry[] }> => {
      if (!registry) return { entries: [] };
      const servers = await registry.list();
      const entries: McpServerEntry[] = Object.entries(servers)
        .filter(([, v]) => v && typeof v === "object")
        .map(([name, config]) => {
          const normalized = normalizeStoredConfig(config as McpServerConfig);
          return {
            name,
            config: normalized,
            transport: detectTransport(normalized),
          };
        });
      return { entries };
    },
    enabled: !!registry,
    staleTime: 5_000,
  });
}

/** 写入(新增 / 编辑) MCP server —— 走 registry IPC, 不再撞 OpenClaw 限流 */
export function useUpsertMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { name: string; config: McpServerConfig }) => {
      const registry = window.cjtClaw?.mcpRegistry;
      if (!registry) throw new Error("MCP registry 未就绪");
      await registry.upsert({
        name: params.name,
        config: params.config as Record<string, unknown>,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mcp-servers"] });
      qc.invalidateQueries({ queryKey: ["mcp-health"] });
    },
  });
}

/** 删除 MCP server */
export function useRemoveMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const registry = window.cjtClaw?.mcpRegistry;
      if (!registry) throw new Error("MCP registry 未就绪");
      await registry.remove(name);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mcp-servers"] });
      qc.invalidateQueries({ queryKey: ["mcp-health"] });
    },
  });
}

/** 切换启用 / 禁用 */
export function useToggleMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      name: string;
      config: McpServerConfig;
      disabled: boolean;
    }) => {
      const registry = window.cjtClaw?.mcpRegistry;
      if (!registry) throw new Error("MCP registry 未就绪");
      await registry.setDisabled({ name: params.name, disabled: params.disabled });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mcp-servers"] });
      qc.invalidateQueries({ queryKey: ["mcp-health"] });
    },
  });
}

/** 批量导入 */
export function useImportMcpServers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      servers: Record<string, McpServerConfig>,
    ): Promise<{ inserted: number }> => {
      const registry = window.cjtClaw?.mcpRegistry;
      if (!registry) throw new Error("MCP registry 未就绪");
      const result = await registry.importBatch(
        servers as unknown as Record<string, Record<string, unknown>>,
      );
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mcp-servers"] });
      qc.invalidateQueries({ queryKey: ["mcp-health"] });
    },
  });
}

/** 实时 supervisor 健康状态 (启动时拉一次, 之后 onHealthChanged 推送) */
export function useMcpHealth() {
  const supervisor = window.cjtClaw?.mcpSupervisor;
  const [snapshot, setSnapshot] = useState<McpHealthStatusEntry[] | null>(null);

  useEffect(() => {
    if (!supervisor) return;
    let cancelled = false;
    void supervisor.status().then((s) => {
      if (!cancelled) setSnapshot(s);
    });
    const off = supervisor.onHealthChanged((evt) => {
      setSnapshot((prev) => {
        const cur = prev ? [...prev] : [];
        const idx = cur.findIndex((h) => h.name === evt.name);
        if (evt.removed) {
          if (idx >= 0) cur.splice(idx, 1);
          return cur;
        }
        if (!evt.health) return cur;
        if (idx >= 0) cur[idx] = evt.health;
        else cur.push(evt.health);
        return cur;
      });
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [supervisor]);

  const byName = useMemo(() => {
    const m = new Map<string, McpHealthStatusEntry>();
    for (const h of snapshot ?? []) m.set(h.name, h);
    return m;
  }, [snapshot]);

  return { snapshot: snapshot ?? [], byName, ready: snapshot !== null };
}

/** 触发一次主动 probe (UI"刷新"按钮) */
export function useTriggerMcpProbe() {
  return useMutation({
    mutationFn: async (name: string) => {
      const supervisor = window.cjtClaw?.mcpSupervisor;
      if (!supervisor) throw new Error("MCP supervisor 未就绪");
      await supervisor.probe(name);
    },
  });
}

/** 读最近的 broker callTool snapshot —— 渲染 per-call 历史 */
export function useMcpSnapshotTail(opts?: { limit?: number; brokerSessionId?: string }) {
  return useQuery({
    queryKey: ["mcp-snapshot-tail", opts?.limit ?? 200, opts?.brokerSessionId ?? null],
    queryFn: async (): Promise<McpBrokerCallSnapshot[]> => {
      const broker = window.cjtClaw?.mcpBroker;
      if (!broker) return [];
      return await broker.snapshotTail(opts);
    },
    enabled: !!window.cjtClaw?.mcpBroker,
    staleTime: 3_000,
  });
}

// re-export 给 UI / consumers 用 (缩短 import 路径)
export type { McpHealthStatusEntry, McpHealthState, McpBrokerCallSnapshot };
