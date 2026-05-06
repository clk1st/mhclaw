import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  DEFAULT_MCP_BROKER_PORT,
  MCP_BROKER_PORT_RANGE,
  getMcpRunsDir,
  getStateDir,
} from "../constants.js";
import type { McpSupervisor } from "./mcp-supervisor.js";
import type { McpRegistry } from "./mcp-registry.js";
import type { McpBrokerEndpoint, McpRunSnapshotEntry } from "./mcp-types.js";

/**
 * MCP broker — the only MCP server OpenClaw ever sees.
 *
 * Design rationale: STABLE CATALOG (post code-review revision)
 *  - `listTools` is sourced from `supervisor.listExposableServers()` —
 *    every server that's enabled AND has a last-known-good schema.
 *    The catalog is decoupled from current health.
 *  - When an upstream temporarily fails, its tools stay in the catalog.
 *    OpenClaw's catalog is a session-scoped lazy cache without a
 *    `listChanged` subscription, so we cannot drop tools dynamically.
 *  - `callTool` checks health at call time. Unhealthy upstreams return a
 *    structured `isError` immediately and never block. Once they recover,
 *    the same tool name becomes callable again — no catalog rebuild.
 *
 * Tool naming: `<serverName>__<toolName>` (prefix + double underscore)
 *   - serverName is sanitized to `[a-zA-Z0-9_-]` (matching OpenClaw).
 *   - Double underscore as the delimiter — OpenClaw's `safeServerName`
 *     handles it natively.
 *
 * Port: defaults to 40790; falls back through 40791..40799 on conflict.
 *
 * Mode: stateful streamable-http
 *   - Each OpenClaw client init creates an isolated Server + transport
 *     associated with a fresh sessionId.
 *   - Subsequent listTools / callTool requests are routed by sessionId.
 *   - On close the entry is cleaned up.
 */

const TOOL_NAME_SEPARATOR = "__";

type Json = Record<string, unknown>;

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  server: Server;
  brokerSessionId: string;
}

export class McpBroker {
  private httpServer: http.Server | null = null;
  private port = 0;
  private sessions = new Map<string, SessionEntry>();
  private snapshotStream: fs.WriteStream | null = null;

  constructor(
    private readonly registry: McpRegistry,
    private readonly supervisor: McpSupervisor,
  ) {}

  async start(
    preferredPort = DEFAULT_MCP_BROKER_PORT,
  ): Promise<McpBrokerEndpoint> {
    this.ensureSnapshotStream();

    for (let i = 0; i < MCP_BROKER_PORT_RANGE; i++) {
      const port = preferredPort + i;
      try {
        await this.tryListen(port);
        this.port = port;
        const url = `http://127.0.0.1:${port}/mcp`;
        console.log(`[McpBroker] Listening on ${url}`);
        return { url, port };
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code !== "EADDRINUSE") throw err;
        console.warn(`[McpBroker] Port ${port} busy, trying next`);
      }
    }
    throw new Error(
      `MCP broker: no free port in [${preferredPort}..${
        preferredPort + MCP_BROKER_PORT_RANGE - 1
      }]`,
    );
  }

  async stop(): Promise<void> {
    // Close every active session
    for (const name of Array.from(this.sessions.keys())) {
      const s = this.sessions.get(name);
      if (s) {
        try {
          await s.transport.close();
        } catch {
          // swallow
        }
        try {
          await s.server.close();
        } catch {
          // swallow
        }
      }
    }
    this.sessions.clear();

    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }
    if (this.snapshotStream) {
      this.snapshotStream.end();
      this.snapshotStream = null;
    }
  }

  // ───── HTTP listen ─────────────────────────────────────────────

  private tryListen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        // Path filter: only respond to /mcp.
        const urlPath = (req.url ?? "/").split("?")[0] ?? "/";
        if (urlPath !== "/mcp") {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        this.handleHttp(req, res).catch((err) => {
          console.warn("[McpBroker] handleHttp error:", err);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      });
      srv.once("error", (err) => reject(err));
      srv.once("listening", () => {
        srv.removeAllListeners("error");
        srv.on("error", (err) => {
          console.warn("[McpBroker] server error:", err);
        });
        this.httpServer = srv;
        resolve();
      });
      srv.listen(port, "127.0.0.1");
    });
  }

  private async handleHttp(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const sessionId = this.getSessionIdHeader(req);
    let entry = sessionId ? this.sessions.get(sessionId) : undefined;

    if (!entry) {
      // No sessionId / unknown sessionId → treat as a fresh init.
      // The SDK will reject non-init requests without a sessionId on its
      // own (HTTP 400). We only allocate the instance here.
      entry = await this.createSession();
    }

    // Parse body. POST/PUT/DELETE may all carry one.
    let parsedBody: unknown = undefined;
    if (req.method === "POST" || req.method === "PUT" || req.method === "DELETE") {
      try {
        parsedBody = await readJsonBody(req);
      } catch {
        // Let the SDK respond to invalid bodies on its own.
      }
    }

    await entry.transport.handleRequest(req, res, parsedBody);
  }

  private getSessionIdHeader(
    req: http.IncomingMessage,
  ): string | undefined {
    const v = req.headers["mcp-session-id"];
    if (typeof v === "string") return v;
    if (Array.isArray(v) && v[0]) return v[0];
    return undefined;
  }

  // ───── per-session Server factory ─────────────────────────────

  private async createSession(): Promise<SessionEntry> {
    // Hold `entry` in a closure (not a module-scoped var) so concurrent
    // `init` requests don't cross-contaminate.
    const entry: SessionEntry = {
      transport: null as unknown as StreamableHTTPServerTransport,
      server: null as unknown as Server,
      brokerSessionId: "",
    };

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => {
        entry.brokerSessionId = id;
        this.sessions.set(id, entry);
      },
    });
    entry.transport = transport;

    const server = new Server(
      { name: "mhclaw-mcp-broker", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    entry.server = server;

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const exposable = this.supervisor.listExposableServers();
      const tools: Array<{
        name: string;
        description?: string;
        inputSchema: unknown;
      }> = [];
      for (const { name: serverName, tools: serverTools } of exposable) {
        for (const t of serverTools) {
          tools.push({
            name: prefixToolName(serverName, t.name),
            description:
              t.description ??
              `Provided by mhclaw-managed MCP server "${serverName}".`,
            inputSchema: t.inputSchema ?? { type: "object" },
          });
        }
      }
      return { tools };
    });

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const fullName = req.params.name;
      const argsObj = (req.params.arguments ?? {}) as Json;
      const parsed = parseToolName(fullName);
      const brokerSessionId = entry.brokerSessionId || "pre-init";

      if (!parsed) {
        this.recordSnapshot({
          ts: Date.now(),
          brokerSessionId,
          outcome: "rejected",
          serverName: "<unknown>",
          toolName: fullName,
          error: `Invalid prefixed tool name "${fullName}"`,
        });
        return errorResult(
          `Invalid tool name "${fullName}" (expected "<serverName>${TOOL_NAME_SEPARATOR}<toolName>")`,
        );
      }
      const { serverName, toolName } = parsed;

      const cfg = this.registry.get(serverName);
      if (!cfg) {
        this.recordSnapshot({
          ts: Date.now(),
          brokerSessionId,
          outcome: "rejected",
          serverName,
          toolName,
          error: "server not in registry",
        });
        return errorResult(
          `MCP server "${serverName}" is not in the registry (it may have just been removed).`,
        );
      }
      if (cfg.disabled) {
        this.recordSnapshot({
          ts: Date.now(),
          brokerSessionId,
          outcome: "rejected",
          serverName,
          toolName,
          error: "server disabled",
        });
        return errorResult(
          `MCP server "${serverName}" is currently disabled; tool "${toolName}" cannot be executed.`,
        );
      }

      const health = this.supervisor.getHealth(serverName);
      if (!health || health.status !== "available") {
        // Don't block: trigger a background probe (we don't await it).
        this.supervisor.triggerProbe(serverName);
        this.recordSnapshot({
          ts: Date.now(),
          brokerSessionId,
          outcome: "rejected",
          serverName,
          toolName,
          error: `unhealthy: ${health?.status ?? "unknown"}`,
        });
        const detail = health?.lastError
          ? ` (last error: ${health.lastError})`
          : "";
        return errorResult(
          `MCP server "${serverName}" is currently unavailable (status: ${
            health?.status ?? "unknown"
          })${detail}. Tool "${toolName}" cannot run; a background reconnect was triggered.`,
        );
      }

      // Forward to the upstream
      const startedAt = Date.now();
      try {
        const result = await this.supervisor.callTool(
          serverName,
          toolName,
          argsObj,
        );
        const durationMs = Date.now() - startedAt;
        this.recordSnapshot({
          ts: Date.now(),
          brokerSessionId,
          outcome: "ok",
          serverName,
          toolName,
          durationMs,
        });
        return result as never;
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        const errStr = err instanceof Error ? err.message : String(err);
        this.recordSnapshot({
          ts: Date.now(),
          brokerSessionId,
          outcome: "error",
          serverName,
          toolName,
          durationMs,
          error: errStr,
        });
        return errorResult(
          `Call to ${serverName}.${toolName} failed: ${errStr}`,
        );
      }
    });

    transport.onclose = () => {
      const id = transport.sessionId;
      if (id) this.sessions.delete(id);
    };
    transport.onerror = (err) => {
      console.warn("[McpBroker] transport error:", err);
    };

    await server.connect(transport);
    return entry;
  }

  // ───── snapshot persistence ────────────────────────────────────

  private ensureSnapshotStream(): void {
    if (this.snapshotStream) return;
    const dir = getMcpRunsDir();
    if (!fs.existsSync(getStateDir())) {
      fs.mkdirSync(getStateDir(), { recursive: true });
    }
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "mcp-calls.jsonl");
    this.snapshotStream = fs.createWriteStream(file, { flags: "a" });
  }

  private recordSnapshot(entry: McpRunSnapshotEntry): void {
    if (!this.snapshotStream) return;
    try {
      this.snapshotStream.write(JSON.stringify(entry) + "\n");
    } catch (err) {
      console.warn("[McpBroker] Failed to write snapshot:", err);
    }
  }

  /** Broker URL — gateway-manager writes this into mhclaw.json. */
  getEndpoint(): McpBrokerEndpoint | null {
    if (!this.httpServer || !this.port) return null;
    return { url: `http://127.0.0.1:${this.port}/mcp`, port: this.port };
  }
}

// ───── helpers ─────────────────────────────────────────────────

export function prefixToolName(
  serverName: string,
  toolName: string,
): string {
  return `${sanitizeServerName(serverName)}${TOOL_NAME_SEPARATOR}${toolName}`;
}

export function parseToolName(
  prefixed: string,
): { serverName: string; toolName: string } | null {
  const idx = prefixed.indexOf(TOOL_NAME_SEPARATOR);
  if (idx < 0) return null;
  const serverName = prefixed.slice(0, idx);
  const toolName = prefixed.slice(idx + TOOL_NAME_SEPARATOR.length);
  if (!serverName || !toolName) return null;
  return { serverName, toolName };
}

/**
 * Same semantics as OpenClaw's `sanitizeServerName`: keep a-z, A-Z, 0-9,
 * `_` and `-`; everything else becomes `_`.
 */
function sanitizeServerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function errorResult(message: string): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const MAX = 8 * 1024 * 1024; // 8MB safety cap
    req.on("data", (c) => {
      chunks.push(c as Buffer);
      total += (c as Buffer).length;
      if (total > MAX) {
        req.destroy(new Error("MCP broker: body too large"));
      }
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve(undefined);
      const buf = Buffer.concat(chunks);
      try {
        resolve(JSON.parse(buf.toString("utf-8")));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
