import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import {
  getMcpRegistryPath,
  getStateDir,
} from "../constants.js";
import type {
  McpRegistryFile,
  McpServerConfig,
} from "./mcp-types.js";

/**
 * MCP registry — the source of truth for the user's full MCP server config.
 *
 * Before: configs lived directly in mhclaw.json under `mcp.servers`. OpenClaw
 * read them on startup, connected to all servers serially, and one bad server
 * would stall the entire `prep` stage.
 *
 * Now: configs live in ~/.mhclaw/mcp-registry.json (this file). mhclaw.json's
 * `mcp.servers` keeps only one entry — `mhclaw-mcp-broker` — pointing at the
 * local broker. OpenClaw never sees the user's individual servers.
 *
 * Atomic writes: uses `tmp + rename` to prevent partial writes.
 *
 * Migration: on first launch, if the registry doesn't exist but mhclaw.json
 * has `mcp.servers`, the existing servers are copied over once. The
 * mhclaw.json `mcp.servers` section is then overwritten by gateway-manager
 * with just the broker entry.
 */

export class McpRegistry extends EventEmitter {
  private file: McpRegistryFile = { version: 1, servers: {} };
  private loaded = false;

  /** Call once at startup: load + one-shot migration. */
  init(legacyMcpServers?: Record<string, McpServerConfig>): void {
    const p = getMcpRegistryPath();
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.servers) {
          this.file = {
            version: 1,
            servers: parsed.servers as Record<string, McpServerConfig>,
          };
        }
        // Run the ad-hoc upgrade pass on every startup (idempotent;
        // configs already on a good version are left untouched).
        this.upgradeKnownIncompatibleVersions();
        this.loaded = true;
        return;
      } catch (err) {
        console.warn("[McpRegistry] Failed to parse registry, starting empty:", err);
      }
    }

    // Not found → one-shot migration from mhclaw.json
    if (legacyMcpServers && Object.keys(legacyMcpServers).length > 0) {
      this.file = { version: 1, servers: { ...legacyMcpServers } };
      this.upgradeKnownIncompatibleVersions();
      this.persist();
      console.log(
        `[McpRegistry] Migrated ${Object.keys(legacyMcpServers).length} servers from mhclaw.json`,
      );
    } else {
      this.file = { version: 1, servers: {} };
      this.persist();
    }
    this.loaded = true;
  }

  /**
   * Rewrites `mcp-remote@<known-bad>` in any server's args to
   * `mcp-remote@^0.1.38`.
   *
   * Background: versions of `mcp-remote` before 0.1.38 use a `tools/call`
   * wire format that's incompatible with current hosted MCP SSE servers
   * (e.g. metrichub's), causing every callTool to fail with
   * `-32602: Invalid request parameters`. 0.1.38 fixes this.
   *
   * Some upstream setup docs (notably metrichub's earlier instructions)
   * pinned 0.1.16, and users copy/pasted that into their config. This
   * pass auto-corrects those during load / migration.
   *
   * Idempotent: anything already at ≥ 0.1.38 (or on a higher minor) is
   * left alone; we never downgrade a user's deliberate higher pin.
   */
  private upgradeKnownIncompatibleVersions(): void {
    // Matches 0.0.x / 0.1.0 ~ 0.1.37 (with caret/tilde/range/exact prefixes).
    // Examples: mcp-remote@^0.1.16  mcp-remote@~0.1.20  mcp-remote@0.1.30
    const RX = /^mcp-remote@(\^|~|=|>=|<=|>|<)?0\.(0\.\d+|1\.([0-9]|[12][0-9]|3[0-7]))(\.[a-z0-9.+-]+)?$/i;
    const TARGET = "mcp-remote@^0.1.38";
    let changed = false;
    for (const [name, cfg] of Object.entries(this.file.servers)) {
      if (!Array.isArray(cfg.args)) continue;
      let serverModified = false;
      const newArgs = cfg.args.map((a) => {
        if (typeof a === "string" && RX.test(a)) {
          serverModified = true;
          return TARGET;
        }
        return a;
      });
      if (serverModified) {
        this.file.servers[name] = { ...cfg, args: newArgs };
        changed = true;
        console.log(
          `[McpRegistry] Upgraded mcp-remote in "${name}" → ${TARGET} (old version incompatible with current SSE servers)`,
        );
      }
    }
    if (changed) this.persist();
  }

  list(): Record<string, McpServerConfig> {
    return { ...this.file.servers };
  }

  get(name: string): McpServerConfig | undefined {
    const c = this.file.servers[name];
    return c ? { ...c } : undefined;
  }

  upsert(name: string, config: McpServerConfig): void {
    this.file.servers[name] = config;
    this.persist();
    this.emit("changed", { kind: "upsert", name });
  }

  remove(name: string): void {
    if (!this.file.servers[name]) return;
    delete this.file.servers[name];
    this.persist();
    this.emit("changed", { kind: "remove", name });
  }

  setDisabled(name: string, disabled: boolean): void {
    const c = this.file.servers[name];
    if (!c) return;
    this.file.servers[name] = { ...c, disabled };
    this.persist();
    this.emit("changed", { kind: "toggle", name });
  }

  importBatch(servers: Record<string, McpServerConfig>): { inserted: number } {
    let inserted = 0;
    for (const [name, cfg] of Object.entries(servers)) {
      if (!cfg || typeof cfg !== "object") continue;
      this.file.servers[name] = cfg;
      inserted++;
    }
    if (inserted > 0) {
      this.persist();
      this.emit("changed", { kind: "import" });
    }
    return { inserted };
  }

  private persist(): void {
    const dir = getStateDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const target = getMcpRegistryPath();
    const tmp = target + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.file, null, 2));
    fs.renameSync(tmp, target);
  }
}

/**
 * Read a legacy `mcp.servers` block from mhclaw.json (used as the migration
 * entry point on first launch). Read-only — never mutates mhclaw.json.
 */
export function readLegacyMcpServers(
  mhclawConfigPath: string,
): Record<string, McpServerConfig> | undefined {
  if (!fs.existsSync(mhclawConfigPath)) return undefined;
  try {
    const raw = fs.readFileSync(mhclawConfigPath, "utf-8");
    const parsed = JSON.parse(raw);
    const servers = parsed?.mcp?.servers;
    if (servers && typeof servers === "object") {
      return servers as Record<string, McpServerConfig>;
    }
  } catch {
    // ignore
  }
  return undefined;
}
