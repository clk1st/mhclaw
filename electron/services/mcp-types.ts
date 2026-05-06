/**
 * Shared types for the MCP subsystem.
 *
 * Design rationale: stable catalog
 * ────────────────────────────────
 * OpenClaw 4.12 / 5.4 keeps the MCP catalog as a session-scoped lazy cache,
 * and the bundled MCP client is constructed without subscribing to the
 * `tools/list_changed` notification. This means once the catalog is built
 * on the first `tools/list` of a session, it never changes for that session.
 *
 * If the broker's `listTools` returned only the *currently healthy* tools,
 * a temporarily failing MCP would remain invisible for the entire session
 * — even after it recovers.
 *
 * Solution: drive the broker catalog from the last-known-good schema, NOT
 * from current health.
 *   - `listTools` returns tools where (server enabled) && (has LKG schema)
 *   - `callTool` checks health at call time; if unhealthy it returns a
 *     structured `isError` immediately and never blocks
 *   - Once the upstream recovers, the same tool name becomes callable
 *     again with no catalog rebuild
 *   - Servers that have never probed successfully are not exposed
 */

/** Shared MCP server config; aligned with OpenClaw's `McpServerConfig`. */
export type McpServerConfig = {
  command?: string;
  args?: string[];
  env?: Record<string, string | number | boolean>;
  cwd?: string;
  workingDirectory?: string;
  url?: string;
  transport?: "sse" | "streamable-http";
  headers?: Record<string, string | number | boolean>;
  connectionTimeoutMs?: number;
  disabled?: boolean;
  [k: string]: unknown;
};

export type McpRegistryFile = {
  version: 1;
  servers: Record<string, McpServerConfig>;
};

/** 5-state UI status + supervisor's internal transient state. */
export type McpHealthStatus =
  | "configured" // never probed yet
  | "connecting" // probe in progress
  | "available" // last probe succeeded
  | "unavailable" // last probe failed
  | "disabled"; // user-disabled

export type McpHealth = {
  name: string;
  status: McpHealthStatus;
  lastProbeAt?: number;
  lastSuccessAt?: number;
  lastError?: string;
  durationMs?: number;
  toolCount?: number;
  /** Consecutive failure count (0 means last attempt succeeded). */
  backoffCount: number;
};

export type McpToolSchema = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

/**
 * Persisted to ~/.mhclaw/mcp-broker-schemas.json. The broker's stable
 * catalog is built from this — see the design notes at the top of file.
 */
export type McpServerLastKnownGood = {
  /** Server name (duplicated for log readability). */
  serverName: string;
  /** Tool set captured from the last successful listTools. */
  tools: McpToolSchema[];
  /** Content fingerprint; changes when tools or inputSchemas change. */
  schemaVersion: string;
  capturedAt: number;
};

export type McpSchemasFile = {
  version: 1;
  servers: Record<string, McpServerLastKnownGood>;
};

/** One per-run snapshot entry (one JSON object per JSONL line). */
export type McpRunSnapshotEntry = {
  ts: number;
  /**
   * Broker-side session id. Each time OpenClaw connects to the broker it
   * gets a fresh id; use this to slice calls per OpenClaw session.
   */
  brokerSessionId: string;
  /**
   * "rejected" means the broker itself refused the call (server unhealthy
   * or disabled) without forwarding to the upstream.
   */
  outcome: "ok" | "error" | "rejected";
  serverName: string;
  toolName: string;
  durationMs?: number;
  error?: string;
};

/** Connection info exposed by the broker once it starts listening. */
export type McpBrokerEndpoint = {
  url: string; // http://127.0.0.1:<port>/mcp
  port: number;
};
