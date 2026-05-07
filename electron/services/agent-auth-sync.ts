import fs from "node:fs";
import path from "node:path";

import { getConfigPath, getStateDir } from "../constants.js";

/**
 * Sync `models.providers.<id>.apiKey` from `mhclaw.json` into each
 * agent's `auth-profiles.json` (OpenClaw 5.4+ store).
 *
 * OpenClaw 5.4 stopped reading `models.providers.<id>.apiKey` directly
 * when resolving an agent's LLM auth. It loads
 * `<stateDir>/agents/<agentId>/agent/auth-profiles.json` (new schema)
 * or `<agentDir>/auth.json` (legacy). New users running through Setup
 * Wizard write to `mhclaw.json` only — without this sync, OpenClaw
 * throws `No API key found for provider "<id>"` on the first chat.
 *
 * We sync to all known agents (main + claw) so channel agents driving
 * wechat / wecom / dingtalk also work. Existing profiles are
 * preserved; only the keys for providers in `mhclaw.json` are updated.
 *
 * File schema (matches OpenClaw 5.4 store-*.js):
 *   { version: 1,
 *     profiles: { "<provider>:default":
 *                 { type: "api_key", provider, key } } }
 */

interface AuthProfile {
  type: "api_key";
  provider: string;
  key: string;
  displayName?: string;
}

interface AuthProfileStore {
  version: 1;
  profiles: Record<string, AuthProfile | unknown>;
}

const DEFAULT_AGENT_IDS = ["main", "claw"];

export function syncAgentAuthProfiles(agentIds: string[] = DEFAULT_AGENT_IDS): void {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return;

  let cfg: { models?: { providers?: Record<string, { apiKey?: string }> } };
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return;
  }

  const providers = cfg.models?.providers ?? {};
  const desired: Record<string, AuthProfile> = {};
  for (const [provider, block] of Object.entries(providers)) {
    const apiKey = block?.apiKey;
    if (typeof apiKey !== "string" || apiKey.length === 0) continue;
    // OpenClaw masks secrets with "REDACTED" in some serialization
    // paths; never propagate a placeholder.
    if (apiKey === "REDACTED") continue;
    desired[`${provider}:default`] = {
      type: "api_key",
      provider,
      key: apiKey,
      displayName: "mhclaw sync",
    };
  }

  if (Object.keys(desired).length === 0) return;

  const stateDir = getStateDir();
  for (const agentId of agentIds) {
    const agentDir = path.join(stateDir, "agents", agentId, "agent");
    const authPath = path.join(agentDir, "auth-profiles.json");

    let existing: AuthProfileStore = { version: 1, profiles: {} };
    if (fs.existsSync(authPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(authPath, "utf-8")) as AuthProfileStore;
        if (parsed && typeof parsed === "object") {
          existing = {
            version: 1,
            profiles: (parsed.profiles && typeof parsed.profiles === "object") ? parsed.profiles : {},
          };
        }
      } catch {
        // Corrupt file — don't blow away user data; just skip this agent.
        console.warn(`[AgentAuthSync] Failed to parse ${authPath}, skipping agent`);
        continue;
      }
    }

    let changed = false;
    for (const [profileId, profile] of Object.entries(desired)) {
      const cur = existing.profiles[profileId] as AuthProfile | undefined;
      if (
        !cur ||
        cur.type !== "api_key" ||
        cur.provider !== profile.provider ||
        cur.key !== profile.key
      ) {
        existing.profiles[profileId] = profile;
        changed = true;
      }
    }
    if (!changed) continue;

    try {
      if (!fs.existsSync(agentDir)) fs.mkdirSync(agentDir, { recursive: true });
      const tmp = authPath + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(existing, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, authPath);
      try {
        fs.chmodSync(authPath, 0o600);
      } catch {
        // best-effort
      }
      console.log(
        `[AgentAuthSync] synced ${Object.keys(desired).length} profile(s) to ${authPath}`,
      );
    } catch (err) {
      console.warn(`[AgentAuthSync] write failed for ${authPath}:`, err);
    }
  }
}
