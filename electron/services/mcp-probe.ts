import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

/**
 * Why this file exists
 * --------------------
 * The OpenClaw gateway exposes zero observability for MCP servers — there
 * is no `mcp.*` RPC, `tools.catalog` / `tools.effective` don't include
 * any MCP-server tools, and there is no connection-status query. If the
 * UI wants to show "is this MCP connected? what tools does it expose?",
 * the only option is to probe ourselves.
 *
 * Design: mhclaw runs a lightweight MCP client inside the Electron main
 * process. For each server it does one `initialize` + `tools/list`,
 * then closes — no long-lived connection. Runs in parallel with the
 * gateway and never affects the agent's actual MCP tool-call path.
 *
 * Transport selection — the right SDK transport based on config shape:
 *   - stdio  (config has `command`)            → StdioClientTransport
 *   - http   (config has `url`, transport=streamable-http) → StreamableHTTPClientTransport
 *   - sse    (config has `url`, transport=sse) → SSEClientTransport
 * Config shape matches OpenClaw / Claude Desktop / Cursor — no wrapping.
 */

/** Defined locally to avoid cross-tsconfig boundary issues (electron / renderer). */
export type McpServerConfigLike = Record<string, unknown>;

export interface McpProbeTool {
  name: string;
  description?: string;
}

export interface McpProbeResult {
  ok: boolean;
  tools?: McpProbeTool[];
  error?: string;
  /** Probe duration in ms (used for UI debugging). */
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export async function probeMcpServer(
  config: McpServerConfigLike,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<McpProbeResult> {
  const started = Date.now();

  const transport = createTransport(config);
  if (!transport) {
    return {
      ok: false,
      error: "Unrecognized MCP server config (no `command` and no `url`)",
      durationMs: Date.now() - started,
    };
  }

  const client = new Client(
    { name: "mhclaw-mcp-probe", version: "0.1.0" },
    { capabilities: {} },
  );

  let timeoutHandle: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<McpProbeResult>((resolve) => {
    timeoutHandle = setTimeout(() => {
      resolve({
        ok: false,
        error: `Probe timed out (${timeoutMs}ms)`,
        durationMs: Date.now() - started,
      });
    }, timeoutMs);
  });

  const work = (async (): Promise<McpProbeResult> => {
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      const tools: McpProbeTool[] = (listed.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
      }));
      return { ok: true, tools, durationMs: Date.now() - started };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      };
    }
  })();

  try {
    const result = await Promise.race([work, timeoutPromise]);
    return result;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    try {
      await client.close();
    } catch {
      // swallow
    }
    try {
      await transport.close();
    } catch {
      // swallow
    }
  }
}

/** Probe many servers concurrently (default 3 in flight; avoids spawning too many `npx` at once). */
export async function probeMcpServers(
  servers: Record<string, McpServerConfigLike>,
  opts: { concurrency?: number; timeoutMs?: number } = {},
): Promise<Record<string, McpProbeResult>> {
  const { concurrency = 3, timeoutMs } = opts;
  const entries = Object.entries(servers).filter(
    ([, cfg]) => !(cfg as { disabled?: boolean }).disabled,
  );
  const out: Record<string, McpProbeResult> = {};

  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, entries.length || 1) },
    async () => {
      while (cursor < entries.length) {
        const idx = cursor++;
        const [name, cfg] = entries[idx];
        out[name] = await probeMcpServer(cfg, timeoutMs);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

/**
 * Build the right SDK transport from the config shape. Returns null on
 * unrecognized shape.
 *  - command present → StdioClientTransport (env MUST inherit process.env or PATH is missing)
 *  - url + transport=="sse" → SSEClientTransport
 *  - url (any other transport) → StreamableHTTPClientTransport
 */
function createTransport(config: McpServerConfigLike): Transport | null {
  const stdio = config as {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
  };
  if (typeof stdio.command === "string" && stdio.command.length > 0) {
    const mergedEnv: Record<string, string> = {
      ...(Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => typeof v === "string"),
      ) as Record<string, string>),
      ...(stdio.env ?? {}),
    };
    return new StdioClientTransport({
      command: stdio.command,
      args: Array.isArray(stdio.args) ? stdio.args : [],
      env: mergedEnv,
      cwd: stdio.cwd,
      stderr: "pipe",
    });
  }

  const http = config as {
    url?: string;
    transport?: "sse" | "streamable-http";
    headers?: Record<string, string>;
  };
  if (typeof http.url !== "string" || http.url.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(http.url);
  } catch {
    return null;
  }
  const headers = http.headers ?? undefined;
  const requestInit = headers ? { headers } : undefined;
  if (http.transport === "sse") {
    return new SSEClientTransport(parsed, { requestInit });
  }
  return new StreamableHTTPClientTransport(parsed, { requestInit });
}
