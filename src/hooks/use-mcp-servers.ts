import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tryUnwrapMcpRemote } from "@/lib/mcp-wrapper";

/**
 * MCP server config (union type — transport is inferred per field):
 *   - has `command` → stdio
 *   - has `url`, `transport === "sse"` (or unset) → HTTP / SSE
 *   - has `url`, `transport === "streamable-http"` → bidirectional HTTP stream
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
 * Detect a server's transport.
 * `command` present → stdio; otherwise look at the `transport` field
 * (defaults to streamable-http). Legacy mcp-remote-wrapped entries
 * are unwrapped by `normalizeStoredConfig` before reaching here.
 */
export function detectTransport(s: McpServerConfig): McpTransportKind {
  const stdio = s as McpServerStdio;
  if (stdio.command) return "stdio";
  const t = (s as McpServerHttp).transport;
  return t === "sse" ? "sse" : "streamable-http";
}

/**
 * Read-time normalization. Older versions stored HTTP MCP servers
 * wrapped as stdio + mcp-remote (workaround for an SDK SSE-header
 * bug). Modern OpenClaw's native Streamable HTTP handles headers
 * directly — no wrapping needed. On read we restore the wrapped data
 * to its `{ url, headers, transport }` shape; the user's next
 * edit-save round-trip then commits the migration to disk.
 */
function normalizeStoredConfig(config: McpServerConfig): McpServerConfig {
  const unwrapped = tryUnwrapMcpRemote(config);
  if (!unwrapped) return config;
  // Preserve the `disabled` field across the unwrap.
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
 * Refactor notes (post-broker):
 *   - Data source is no longer OpenClaw's `config.get` -> `mcp.servers`.
 *   - It now goes through the main-process IPC `mcpRegistry.*`
 *     (~/.mhclaw/mcp-registry.json).
 *   - This avoids OpenClaw's control-plane 3/60s rate limit.
 *   - Health state flows through `mcpSupervisor` IPC, decoupled from
 *     the catalog.
 */

/**
 * Probe result for one MCP server: connection success +
 * exposed tool list + error reason.
 *
 * Why not go through the gateway? OpenClaw's gateway has no `mcp.*`
 * RPC. `tools.catalog` / `tools.effective` don't include
 * MCP-server-provided tools (just core + plugin + channel tools), and
 * the gateway exposes no connection-status query. From the gateway's
 * perspective MCP is a black box — the agent can call MCP tools but
 * the UI can't observe them.
 *
 * Mirroring WorkBuddy's approach, mhclaw runs its own lightweight MCP
 * client inside the Electron main process: spawn stdio + send JSON-RPC
 * `tools/list`, then close. Runs in parallel with the gateway, doesn't
 * affect the agent's actual MCP execution path. Implementation lives
 * at `electron/services/mcp-probe.ts`.
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
 * Single-server probe hook — each server has its own query, so a
 * user "refresh" only re-probes that one server (and doesn't
 * interfere with the AI conversation either).
 *
 * `queryKey` carries `configKey`: a config change (URL / headers /
 * etc.) auto-triggers a re-probe; unchanged configs keep cache hits.
 */
export function useMcpServerProbe(
  name: string,
  config: McpServerConfig,
  enabled: boolean,
) {
  const probeApi = window.cjtClaw?.mcpProbe;
  // Fold config into the queryKey so any config change (URL,
  // headers, etc.) automatically triggers a re-probe.
  const configKey = JSON.stringify(config);

  return useQuery({
    queryKey: ["mcp-server-probe", name, configKey],
    queryFn: async (): Promise<McpServerProbeInfo> => {
      if (!probeApi) {
        return {
          ok: false,
          tools: [],
          error: "main-process probe API unavailable",
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
    // Probe spawns npx — somewhat slow; cache for 30s to avoid repeats.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/** Fetch every configured MCP server (broker reads from main-process mcp-registry.json). */
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

/** Upsert (add / edit) an MCP server via registry IPC — no longer hits the OpenClaw rate limit. */
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

/** Remove an MCP server. */
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

/** Toggle enable / disable. */
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

/** Batch import. */
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

/** Live supervisor health (one initial fetch + onHealthChanged pushes). */
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

/** Trigger a one-shot active probe (used by the UI "refresh" button). */
export function useTriggerMcpProbe() {
  return useMutation({
    mutationFn: async (name: string) => {
      const supervisor = window.cjtClaw?.mcpSupervisor;
      if (!supervisor) throw new Error("MCP supervisor 未就绪");
      await supervisor.probe(name);
    },
  });
}

/** Read the most recent broker callTool snapshots — for rendering the per-call history. */
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

// Re-export so UI / consumers can use a shorter import path.
export type { McpHealthStatusEntry, McpHealthState, McpBrokerCallSnapshot };
