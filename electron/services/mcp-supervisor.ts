import fs from "node:fs";
import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

import { getMcpSchemasPath, getStateDir } from "../constants.js";
import {
  createTransport,
  DEFAULT_PROBE_TIMEOUT_MS,
  detectTransport,
  type DetectedTransport,
} from "./mcp-transport.js";
import {
  MhclawOAuthClientProvider,
  OAuthCallbackListener,
  clearCredentials,
} from "./mcp-oauth.js";
import type { McpRegistry } from "./mcp-registry.js";
import type {
  McpHealth,
  McpHealthStatus,
  McpSchemasFile,
  McpServerConfig,
  McpServerLastKnownGood,
  McpToolSchema,
} from "./mcp-types.js";

/**
 * MCP supervisor — single source of truth for MCP health and capabilities,
 * consumed by both the broker and the UI.
 *
 * Three responsibilities:
 *   1. Background probing (on startup, on retry, on registry change) —
 *      captures the last-known-good schema.
 *   2. Long-lived client reuse — `broker.callTool` no longer respawns
 *      `npx` for every call.
 *   3. Persists last-known-good schemas to disk — feeds the broker's
 *      stable catalog.
 *
 * Key decisions:
 *   - Successful listTools → write last-known-good (overwrites prior even
 *     if schema changed).
 *   - Probe failure → mark unavailable + schedule exponential backoff
 *     retry (30s → 600s cap).
 *   - Transport error → proactively disconnect, then wait for next retry.
 *   - On app quit → dispose all clients + clear timers (kills stdio
 *     children cleanly).
 *   - The same long-lived client is shared between probe and callTool.
 */

const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 600_000;

interface ClientSession {
  client: Client;
  transport: Transport;
  type: DetectedTransport;
}

export class McpSupervisor extends EventEmitter {
  private clients = new Map<string, ClientSession>();
  private health = new Map<string, McpHealth>();
  private lastKnownGood = new Map<string, McpServerLastKnownGood>();
  private retryTimers = new Map<string, NodeJS.Timeout>();
  private inProbe = new Set<string>();
  private disposed = false;

  constructor(private readonly registry: McpRegistry) {
    super();
    registry.on("changed", (evt: { kind: string; name?: string }) => {
      if (this.disposed) return;
      if (evt.name) this.onRegistryChange(evt.name);
      else if (evt.kind === "import") {
        for (const name of Object.keys(this.registry.list())) {
          this.onRegistryChange(name);
        }
      }
    });
  }

  /** Startup: load persisted schemas, kick off the first probe per enabled server. */
  init(): void {
    this.loadSchemasFromDisk();
    for (const [name, cfg] of Object.entries(this.registry.list())) {
      if (cfg.disabled) {
        this.setHealth(name, this.makeHealth(name, "disabled"));
        continue;
      }
      this.setHealth(name, this.makeHealth(name, "configured"));
      this.probeAsync(name);
    }
  }

  /** UI / IPC: snapshot of every server's current health. */
  snapshotHealth(): McpHealth[] {
    return Array.from(this.health.values());
  }

  getHealth(name: string): McpHealth | undefined {
    return this.health.get(name);
  }

  /** Broker uses this to drive the stable catalog. */
  getLastKnownGood(name: string): McpServerLastKnownGood | undefined {
    return this.lastKnownGood.get(name);
  }

  /**
   * Broker uses this for `listTools`: returns every server that's
   * currently enabled AND has a last-known-good schema.
   */
  listExposableServers(): { name: string; tools: McpToolSchema[] }[] {
    const out: { name: string; tools: McpToolSchema[] }[] = [];
    const reg = this.registry.list();
    for (const [name, cfg] of Object.entries(reg)) {
      if (cfg.disabled) continue;
      const lkg = this.lastKnownGood.get(name);
      if (!lkg) continue;
      out.push({ name, tools: lkg.tools });
    }
    return out;
  }

  /** Broker forwards `callTool` through here onto the upstream long-lived client. */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const cfg = this.registry.get(serverName);
    if (!cfg) throw new Error(`MCP server "${serverName}" not in registry`);
    if (cfg.disabled) throw new Error(`MCP server "${serverName}" is disabled`);
    const client = await this.ensureConnected(serverName, cfg);
    return await client.callTool({
      name: toolName,
      arguments: args,
    });
  }

  /** Manually trigger a probe (used by the UI "refresh" button). */
  triggerProbe(name: string): void {
    this.cancelRetry(name);
    this.probeAsync(name);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const t of this.retryTimers.values()) clearTimeout(t);
    this.retryTimers.clear();
    const tasks: Promise<void>[] = [];
    for (const name of Array.from(this.clients.keys())) {
      tasks.push(this.disconnect(name));
    }
    await Promise.allSettled(tasks);
    this.clients.clear();
  }

  // ───── internals ─────────────────────────────────────────────────────

  private onRegistryChange(name: string): void {
    const cfg = this.registry.get(name);
    if (!cfg) {
      // Removed
      void this.disconnect(name);
      this.cancelRetry(name);
      this.health.delete(name);
      this.lastKnownGood.delete(name);
      // OAuth credentials are tied to the server; remove on deletion so
      // a future re-add starts fresh and doesn't reuse stale tokens.
      clearCredentials(name);
      this.persistSchemas();
      this.emit("health-changed", { name, removed: true });
      return;
    }
    if (cfg.disabled) {
      void this.disconnect(name);
      this.cancelRetry(name);
      this.setHealth(name, this.makeHealth(name, "disabled"));
      return;
    }
    // Config changed → close the stale client, re-probe with fresh
    // transport / env / etc.
    this.cancelRetry(name);
    void this.disconnect(name).then(() => this.probeAsync(name));
  }

  private probeAsync(name: string): void {
    if (this.disposed) return;
    if (this.inProbe.has(name)) return;
    this.inProbe.add(name);
    void this.doProbe(name).finally(() => this.inProbe.delete(name));
  }

  private async doProbe(name: string): Promise<void> {
    const cfg = this.registry.get(name);
    if (!cfg || cfg.disabled) return;

    const startedAt = Date.now();
    this.setHealth(name, {
      ...this.health.get(name),
      name,
      status: "connecting",
      backoffCount: this.health.get(name)?.backoffCount ?? 0,
    });

    try {
      const client = await this.ensureConnected(name, cfg);
      const listed = await client.listTools();
      const durationMs = Date.now() - startedAt;

      const tools: McpToolSchema[] = (listed.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description ?? undefined,
        inputSchema: t.inputSchema,
      }));
      const schemaVersion = hashTools(tools);
      this.lastKnownGood.set(name, {
        serverName: name,
        tools,
        schemaVersion,
        capturedAt: Date.now(),
      });
      this.persistSchemas();

      this.setHealth(name, {
        name,
        status: "available",
        lastProbeAt: Date.now(),
        lastSuccessAt: Date.now(),
        durationMs,
        toolCount: tools.length,
        backoffCount: 0,
      });
    } catch (err) {
      // Failure: close any leftover client to avoid orphan stdio children.
      await this.disconnect(name);
      const prev = this.health.get(name);
      const backoffCount = (prev?.backoffCount ?? 0) + 1;
      this.setHealth(name, {
        name,
        status: "unavailable",
        lastProbeAt: Date.now(),
        lastSuccessAt: prev?.lastSuccessAt,
        lastError: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
        toolCount: prev?.toolCount,
        backoffCount,
      });
      const delay = Math.min(
        RETRY_BASE_MS * 2 ** Math.min(backoffCount - 1, 6),
        RETRY_MAX_MS,
      );
      this.scheduleRetry(name, delay);
    }
  }

  private async ensureConnected(
    name: string,
    cfg: McpServerConfig,
  ): Promise<Client> {
    const existing = this.clients.get(name);
    if (existing) return existing.client;

    const detected = detectTransport(cfg);
    if (!detected) {
      throw new Error(
        `MCP server "${name}" config has neither command nor a valid url`,
      );
    }

    // OAuth flow only applies to remote (sse / streamable-http) transports.
    // Stdio servers are launched as a subprocess and don't speak HTTP,
    // so PKCE is not relevant.
    const useOAuth = detected !== "stdio";
    let listener: OAuthCallbackListener | null = null;
    let authProvider: MhclawOAuthClientProvider | undefined;

    if (useOAuth) {
      listener = new OAuthCallbackListener();
      const { redirectUri } = await listener.start();
      authProvider = new MhclawOAuthClientProvider(name, redirectUri);
    }

    try {
      const session = await this.attemptConnect(
        name,
        cfg,
        authProvider,
        listener,
      );
      this.clients.set(name, session);
      return session.client;
    } finally {
      // Listener no longer needed once connection is established
      // (or definitively failed). For stdio it was never started.
      listener?.dispose();
    }
  }

  /**
   * One connect attempt. If the server demands OAuth and we have no token,
   * the SDK throws UnauthorizedError after invoking
   * `provider.redirectToAuthorization()`. We then await the loopback
   * listener for the auth code, call `transport.finishAuth(code)` to
   * exchange it for tokens via PKCE, and retry the connection once with
   * a fresh transport.
   */
  private async attemptConnect(
    name: string,
    cfg: McpServerConfig,
    authProvider: MhclawOAuthClientProvider | undefined,
    listener: OAuthCallbackListener | null,
  ): Promise<ClientSession> {
    const created = createTransport(cfg, authProvider);
    if (!created) {
      throw new Error(
        `MCP server "${name}" config has neither command nor a valid url`,
      );
    }
    const { transport, type } = created;
    const client = new Client(
      { name: "mhclaw-mcp-broker", version: "1.0.0" },
      { capabilities: {} },
    );
    this.wireTransportEvents(name, transport);

    const timeoutMs = cfg.connectionTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    try {
      await this.connectWithTimeout(client, transport, timeoutMs);
      return { client, transport, type };
    } catch (err) {
      if (!(err instanceof UnauthorizedError) || !authProvider || !listener) {
        throw err;
      }

      // SDK already invoked provider.redirectToAuthorization() (which opens
      // the user's browser). The user is now authorizing; we wait for the
      // auth code to arrive on the loopback listener.
      console.log(`[McpSupervisor] ${name}: OAuth flow started, waiting for callback`);
      const code = await listener.waitForCode();

      // Exchange code + PKCE verifier for tokens via the (still-alive)
      // first transport. After this, the provider has saved tokens to disk.
      const httpTransport = transport as
        | StreamableHTTPClientTransport
        | SSEClientTransport;
      await httpTransport.finishAuth(code);
      await this.safeCloseTransport(transport);

      // Retry with a fresh transport that will pick up the saved bearer
      // token from the provider on connect.
      const retryCreated = createTransport(cfg, authProvider);
      if (!retryCreated) {
        throw new Error(`MCP server "${name}" failed to recreate transport after OAuth`);
      }
      const retryClient = new Client(
        { name: "mhclaw-mcp-broker", version: "1.0.0" },
        { capabilities: {} },
      );
      this.wireTransportEvents(name, retryCreated.transport);
      await this.connectWithTimeout(retryClient, retryCreated.transport, timeoutMs);
      return {
        client: retryClient,
        transport: retryCreated.transport,
        type: retryCreated.type,
      };
    }
  }

  private wireTransportEvents(name: string, transport: Transport): void {
    transport.onerror = (err) => {
      console.warn(`[McpSupervisor] ${name} transport error:`, err);
      void this.handleTransportFailure(name, err);
    };
    transport.onclose = () => {
      this.clients.delete(name);
    };
  }

  private async connectWithTimeout(
    client: Client,
    transport: Transport,
    timeoutMs: number,
  ): Promise<void> {
    let timer: NodeJS.Timeout | null = null;
    try {
      await Promise.race([
        client.connect(transport),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`MCP connect timeout after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async safeCloseTransport(transport: Transport): Promise<void> {
    try {
      await transport.close();
    } catch {
      // swallow
    }
  }

  private async handleTransportFailure(
    name: string,
    err: unknown,
  ): Promise<void> {
    if (this.disposed) return;
    await this.disconnect(name);
    const prev = this.health.get(name);
    const backoffCount = (prev?.backoffCount ?? 0) + 1;
    this.setHealth(name, {
      name,
      status: "unavailable",
      lastProbeAt: Date.now(),
      lastSuccessAt: prev?.lastSuccessAt,
      lastError: err instanceof Error ? err.message : String(err),
      durationMs: prev?.durationMs,
      toolCount: prev?.toolCount,
      backoffCount,
    });
    const delay = Math.min(
      RETRY_BASE_MS * 2 ** Math.min(backoffCount - 1, 6),
      RETRY_MAX_MS,
    );
    this.scheduleRetry(name, delay);
  }

  private async disconnect(name: string): Promise<void> {
    const existing = this.clients.get(name);
    if (!existing) return;
    this.clients.delete(name);
    try {
      await existing.client.close();
    } catch {
      // swallow
    }
    try {
      await existing.transport.close();
    } catch {
      // swallow
    }
  }

  private scheduleRetry(name: string, delayMs: number): void {
    if (this.disposed) return;
    this.cancelRetry(name);
    const timer = setTimeout(() => {
      this.retryTimers.delete(name);
      this.probeAsync(name);
    }, delayMs);
    this.retryTimers.set(name, timer);
  }

  private cancelRetry(name: string): void {
    const t = this.retryTimers.get(name);
    if (t) {
      clearTimeout(t);
      this.retryTimers.delete(name);
    }
  }

  private setHealth(name: string, h: McpHealth): void {
    const prev = this.health.get(name);
    this.health.set(name, h);
    // Only emit on real status change (avoids spamming the UI).
    if (
      !prev ||
      prev.status !== h.status ||
      prev.lastError !== h.lastError ||
      prev.toolCount !== h.toolCount
    ) {
      this.emit("health-changed", { name, health: h });
    }
  }

  private makeHealth(name: string, status: McpHealthStatus): McpHealth {
    return {
      name,
      status,
      backoffCount: 0,
    };
  }

  // ───── persistence ───────────────────────────────────────────────────

  private loadSchemasFromDisk(): void {
    const p = getMcpSchemasPath();
    if (!fs.existsSync(p)) return;
    try {
      const raw = fs.readFileSync(p, "utf-8");
      const parsed = JSON.parse(raw) as McpSchemasFile;
      if (parsed && typeof parsed === "object" && parsed.servers) {
        for (const [name, lkg] of Object.entries(parsed.servers)) {
          if (lkg && Array.isArray(lkg.tools)) {
            this.lastKnownGood.set(name, lkg);
          }
        }
      }
    } catch (err) {
      console.warn("[McpSupervisor] Failed to load schemas:", err);
    }
  }

  private persistSchemas(): void {
    if (this.disposed) return;
    const target = getMcpSchemasPath();
    const file: McpSchemasFile = {
      version: 1,
      servers: Object.fromEntries(this.lastKnownGood.entries()),
    };
    try {
      const dir = getStateDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = target + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(file, null, 2));
      fs.renameSync(tmp, target);
    } catch (err) {
      console.warn("[McpSupervisor] Failed to persist schemas:", err);
    }
  }
}

/**
 * `schemaVersion` is sha256 over a canonicalized JSON projection of the
 * tool list, so tool ordering changes don't get treated as schema changes.
 */
function hashTools(tools: McpToolSchema[]): string {
  const sorted = tools
    .map((t) => ({
      name: t.name,
      description: t.description ?? null,
      inputSchema: t.inputSchema ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(sorted))
    .digest("hex")
    .slice(0, 16);
}
