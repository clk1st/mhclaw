import path from "node:path";
import os from "node:os";
import { app } from "electron";

/** Product identifier. */
export const APP_NAME = "mhclaw";

/** State directory name (we don't reuse OpenClaw's `.openclaw` — keep our own). */
export const STATE_DIR_NAME = ".mhclaw";

/** Default port for the embedded OpenClaw Gateway. */
export const DEFAULT_GATEWAY_PORT = 40789;

/** Default port for the embedded MCP broker (falls back to 40791..40799 on conflict). */
export const DEFAULT_MCP_BROKER_PORT = 40790;
export const MCP_BROKER_PORT_RANGE = 10;

/** MCP registry / schemas / runs filenames. */
export const MCP_REGISTRY_FILENAME = "mcp-registry.json";
export const MCP_SCHEMAS_FILENAME = "mcp-broker-schemas.json";
export const MCP_RUNS_DIRNAME = "mcp-runs";

export function getMcpRegistryPath(): string {
  return path.join(getStateDir(), MCP_REGISTRY_FILENAME);
}
export function getMcpSchemasPath(): string {
  return path.join(getStateDir(), MCP_SCHEMAS_FILENAME);
}
export function getMcpRunsDir(): string {
  return path.join(getStateDir(), MCP_RUNS_DIRNAME);
}

/** State directory absolute path. */
export function getStateDir(): string {
  // Use Electron's app.getPath where available; fall back to $HOME otherwise.
  try {
    return path.join(app.getPath("home"), STATE_DIR_NAME);
  } catch {
    return path.join(os.homedir(), STATE_DIR_NAME);
  }
}

/** Main config file path (renamed from `openclaw.json` historically). */
export function getConfigPath(): string {
  return path.join(getStateDir(), "mhclaw.json");
}
