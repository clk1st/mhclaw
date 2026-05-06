import { create } from "zustand";
import { apiFetch, getApiToken, setApiToken, getApiBaseUrl } from "@/lib/api";
import type { TokenResp } from "@/lib/device-login";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

type AuthStatus =
  | "idle"        // not yet initialized
  | "checking"    // startup verification in progress
  | "guest"       // no token, or token invalid
  | "authed";     // signed in

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  error: string | null;

  /** Call once on startup; if a local token exists, verify it via /me. */
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  /** Apply a token obtained from the Device Flow (setToken + fetch /me). */
  applyDeviceToken: (token: TokenResp) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// Demo account (open-source build)
// ─────────────────────────────────────────────────────────────────────
// When no backend is configured (mhclaw-api-url is empty), `admin / 123456`
// goes through a pure front-end mock so anyone forking the repo can launch
// the client immediately and try the core features (chat / broker / MCP /
// SkillHub). To wire up a real backend, set `mhclaw-api-url` in Settings
// and log in with a real account — the standard flow takes over.
const DEMO_EMAIL = "admin";
const DEMO_PASSWORD = "123456";
const DEMO_TOKEN = "mhclaw-demo-admin";
const DEMO_USER: AuthUser = {
  id: 0,
  email: DEMO_EMAIL,
  name: "Demo Admin",
  is_active: true,
  created_at: "2024-01-01T00:00:00Z",
};
const isDemoToken = (t: string | null) => t === DEMO_TOKEN;

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "idle",
  user: null,
  error: null,

  init: async () => {
    set({ status: "checking", error: null });
    const tok = getApiToken();
    if (!tok) {
      set({ status: "guest", user: null });
      return;
    }
    if (isDemoToken(tok)) {
      set({ status: "authed", user: DEMO_USER });
      return;
    }
    if (!getApiBaseUrl()) {
      // Non-demo token persisted but no backend configured → drop it.
      setApiToken(null);
      set({ status: "guest", user: null });
      return;
    }
    try {
      const me = await apiFetch<AuthUser>("/api/auth/me");
      set({ status: "authed", user: me });
    } catch {
      setApiToken(null);
      set({ status: "guest", user: null });
    }
  },

  login: async (email, password) => {
    set({ error: null });
    // 1) Demo account: bypasses any backend config, uses the mock token.
    if (email === DEMO_EMAIL && password === DEMO_PASSWORD) {
      setApiToken(DEMO_TOKEN);
      set({ status: "authed", user: DEMO_USER });
      return;
    }
    // 2) Real backend: requires a configured `mhclaw-api-url`.
    if (!getApiBaseUrl()) {
      throw new Error(
        "Backend API is not configured. The open-source build ships with a demo account: admin / 123456",
      );
    }
    const tok = await apiFetch<TokenResp>("/api/auth/login", {
      method: "POST",
      noAuth: true,
      body: { email, password },
    });
    setApiToken(tok.access_token);
    const me = await apiFetch<AuthUser>("/api/auth/me");
    set({ status: "authed", user: me });
  },

  applyDeviceToken: async (tok) => {
    setApiToken(tok.access_token);
    const me = await apiFetch<AuthUser>("/api/auth/me");
    set({ status: "authed", user: me });
  },

  logout: () => {
    setApiToken(null);
    set({ status: "guest", user: null, error: null });
  },

  refreshMe: async () => {
    const tok = getApiToken();
    if (!tok) return;
    if (isDemoToken(tok)) return; // never refresh the demo session
    if (!getApiBaseUrl()) return;
    try {
      const me = await apiFetch<AuthUser>("/api/auth/me");
      set({ user: me });
    } catch {
      // apiFetch already fires the global event on 401.
    }
  },
}));

// Global 401 listener → logout
if (typeof window !== "undefined") {
  window.addEventListener("mhclaw:unauthorized", () => {
    useAuthStore.getState().logout();
  });
}
