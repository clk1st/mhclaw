import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  SSEClientTransport,
  type SSEClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/sse.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig } from "./mcp-types.js";

/**
 * Shared transport factory used by both mcp-probe (one-shot fire-and-forget
 * UI probe) and mcp-supervisor (long-lived clients).
 *
 * Detection rules mirror OpenClaw's `resolveMcpTransport`:
 *   - `command` present → StdioClientTransport. `process.env` MUST be
 *     forwarded so that `npx` can find PATH; the child's stderr is piped
 *     to keep its logs from flooding stdout.
 *   - `url` + `transport === "sse"` → SSEClientTransport
 *   - `url` (any other transport)   → StreamableHTTPClientTransport
 */
export type DetectedTransport = "stdio" | "streamable-http" | "sse";

export function detectTransport(config: McpServerConfig): DetectedTransport | null {
  if (typeof config.command === "string" && config.command.length > 0) {
    return "stdio";
  }
  if (typeof config.url === "string" && config.url.length > 0) {
    return config.transport === "sse" ? "sse" : "streamable-http";
  }
  return null;
}

export function createTransport(
  config: McpServerConfig,
  authProvider?: OAuthClientProvider,
): { transport: Transport; type: DetectedTransport } | null {
  const type = detectTransport(config);
  if (!type) return null;

  if (type === "stdio") {
    const stdioCfg = config as McpServerConfig & {
      command?: string;
      args?: string[];
      env?: Record<string, string | number | boolean>;
      cwd?: string;
      workingDirectory?: string;
    };
    const mergedEnv: Record<string, string> = {
      ...(Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => typeof v === "string"),
      ) as Record<string, string>),
      ...(stdioCfg.env
        ? Object.fromEntries(
            Object.entries(stdioCfg.env).map(([k, v]) => [k, String(v)]),
          )
        : {}),
    };
    return {
      type,
      transport: new StdioClientTransport({
        command: stdioCfg.command!,
        args: Array.isArray(stdioCfg.args) ? stdioCfg.args : [],
        env: mergedEnv,
        cwd: stdioCfg.cwd ?? stdioCfg.workingDirectory,
        stderr: "pipe",
      }),
    };
  }

  // http / sse
  let parsed: URL;
  try {
    parsed = new URL(config.url as string);
  } catch {
    return null;
  }
  const headers = config.headers
    ? Object.fromEntries(
        Object.entries(config.headers).map(([k, v]) => [k, String(v)]),
      )
    : undefined;
  const requestInit = headers ? { headers } : undefined;

  if (type === "sse") {
    const opts: SSEClientTransportOptions = {};
    if (requestInit) opts.requestInit = requestInit;
    if (authProvider) opts.authProvider = authProvider;
    return {
      type,
      transport: new SSEClientTransport(parsed, opts),
    };
  }
  const opts: StreamableHTTPClientTransportOptions = {};
  if (requestInit) opts.requestInit = requestInit;
  if (authProvider) opts.authProvider = authProvider;
  return {
    type,
    transport: new StreamableHTTPClientTransport(parsed, opts),
  };
}

export const DEFAULT_PROBE_TIMEOUT_MS = 8_000;
