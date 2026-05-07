import fs from "node:fs";
import http from "node:http";
import { shell } from "electron";
import type {
  OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { getMcpCredentialsPath, getStateDir } from "../constants.js";

/**
 * MCP OAuth 2.1 + PKCE support.
 *
 * Flow (per MCP spec):
 *  1. transport.start() with this provider injected
 *  2. server returns 401 + WWW-Authenticate → SDK fetches well-known →
 *     calls provider.redirectToAuthorization(url) → throws UnauthorizedError
 *  3. caller awaits provider.waitForCallback() to get the auth code
 *     (code arrives via the loopback HTTP server we started)
 *  4. caller calls transport.finishAuth(code) → SDK exchanges code+verifier
 *     for tokens via PKCE → tokens persisted via saveTokens()
 *  5. caller retries client.connect(transport) → uses bearer token
 *
 * Persistence: per-server credentials in ~/.mhclaw/mcp-credentials.json.
 * Plain JSON for now (Keychain integration is a follow-up).
 *
 * We use loopback HTTP redirect (http://127.0.0.1:<port>/oauth/callback)
 * per OAuth 2.1 native-app guidance (RFC 8252) — the spec strongly
 * prefers loopback over custom URI schemes for desktop OAuth.
 */

// Real-world auth flows often run long: scan QR → switch to phone →
// unlock → consent → switch back, plus MFA / email codes. 5 minutes
// is too tight, so the listener gets killed before the user finishes
// authorizing and the redirect lands on a closed port. 30 minutes
// covers virtually every legitimate flow.
const OAUTH_FLOW_TIMEOUT_MS = 30 * 60 * 1000;

interface CredentialEntry {
  clientInformation?: OAuthClientInformationFull;
  tokens?: OAuthTokens;
  codeVerifier?: string;
}

interface CredentialsFile {
  version: 1;
  servers: Record<string, CredentialEntry>;
}

function loadCredentialsFile(): CredentialsFile {
  const p = getMcpCredentialsPath();
  if (!fs.existsSync(p)) return { version: 1, servers: {} };
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw) as CredentialsFile;
    if (parsed && typeof parsed === "object" && parsed.servers) return parsed;
  } catch (err) {
    console.warn("[McpOAuth] Failed to load credentials, treating as empty:", err);
  }
  return { version: 1, servers: {} };
}

function persistCredentialsFile(file: CredentialsFile): void {
  const target = getMcpCredentialsPath();
  try {
    const dir = getStateDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = target + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, target);
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      // best-effort
    }
  } catch (err) {
    console.warn("[McpOAuth] Failed to persist credentials:", err);
  }
}

function patchEntry(
  serverName: string,
  patch: (entry: CredentialEntry) => CredentialEntry,
): void {
  const file = loadCredentialsFile();
  const current = file.servers[serverName] ?? {};
  file.servers[serverName] = patch({ ...current });
  persistCredentialsFile(file);
}

function readEntry(serverName: string): CredentialEntry {
  const file = loadCredentialsFile();
  return file.servers[serverName] ?? {};
}

export function clearCredentials(serverName: string): void {
  const file = loadCredentialsFile();
  if (file.servers[serverName]) {
    delete file.servers[serverName];
    persistCredentialsFile(file);
  }
}

/**
 * Loopback HTTP server that catches the OAuth redirect on
 * http://127.0.0.1:<random_port>/oauth/callback.
 *
 * Started per-OAuth-flow, closed once the code is received (or timeout).
 */
export class OAuthCallbackListener {
  private server: http.Server | null = null;
  private resolver: ((code: string) => void) | null = null;
  private rejecter: ((err: Error) => void) | null = null;
  private timer: NodeJS.Timeout | null = null;

  port = 0;

  async start(): Promise<{ port: number; redirectUri: string }> {
    if (this.server) throw new Error("listener already started");
    const server = http.createServer((req, res) => this.handleRequest(req, res));
    this.server = server;
    return await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (typeof addr !== "object" || !addr) {
          reject(new Error("listener: unexpected address shape"));
          return;
        }
        this.port = addr.port;
        resolve({
          port: addr.port,
          redirectUri: `http://127.0.0.1:${addr.port}/oauth/callback`,
        });
      });
    });
  }

  /** Resolve with the authorization code once the redirect arrives. */
  async waitForCode(): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      this.resolver = resolve;
      this.rejecter = reject;
      this.timer = setTimeout(() => {
        this.rejecter?.(new Error("OAuth flow timed out"));
        this.dispose();
      }, OAUTH_FLOW_TIMEOUT_MS);
    });
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // If the wait promise hasn't settled, reject it so callers don't hang.
    if (this.rejecter) this.rejecter(new Error("OAuth listener disposed"));
    this.resolver = null;
    this.rejecter = null;
    if (this.server) {
      this.server.close(() => {});
      this.server = null;
    }
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
    if (url.pathname !== "/oauth/callback") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    if (error) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderHtml(
        "Authorization failed",
        `<p>${escapeHtml(error)}${errorDescription ? `: ${escapeHtml(errorDescription)}` : ""}</p>`,
      ));
      this.rejecter?.(new Error(`OAuth error: ${error}${errorDescription ? ` - ${errorDescription}` : ""}`));
      this.dispose();
      return;
    }

    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderHtml("Missing code", "<p>The callback URL is missing the <code>code</code> parameter.</p>"));
      this.rejecter?.(new Error("OAuth callback missing code"));
      this.dispose();
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderHtml(
      "Authorization succeeded",
      "<p>MCP server is now authorized. You can close this window and return to mhclaw.</p>",
    ));
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const r = this.resolver;
    this.resolver = null;
    this.rejecter = null;
    r?.(code);
  }
}

function renderHtml(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)} · mhclaw</title>
<style>body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;text-align:center;padding:60px 20px;color:#111}
h1{font-size:22px;margin:0 0 12px}p{color:#666;font-size:14px;margin:0}</style>
</head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * MCP OAuth client provider per server.
 * Reads/writes credentials to disk on every accessor — small files, tiny
 * volume, simpler than caching with invalidation.
 */
export class MhclawOAuthClientProvider implements OAuthClientProvider {
  constructor(
    private readonly serverName: string,
    private readonly redirectUri: string,
  ) {}

  get redirectUrl(): string {
    return this.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "mhclaw",
      client_uri: "https://github.com/clk1st/mhclaw",
      redirect_uris: [this.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      // PKCE public client: no client secret
      token_endpoint_auth_method: "none",
      // Default scope; servers may ignore or override via metadata
      scope: "mcp",
    };
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    return readEntry(this.serverName).clientInformation;
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    patchEntry(this.serverName, (e) => ({ ...e, clientInformation: info }));
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return readEntry(this.serverName).tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    patchEntry(this.serverName, (e) => ({ ...e, tokens }));
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    patchEntry(this.serverName, (e) => ({ ...e, codeVerifier }));
  }

  async codeVerifier(): Promise<string> {
    const v = readEntry(this.serverName).codeVerifier;
    if (!v) throw new Error(`No PKCE codeVerifier saved for "${this.serverName}"`);
    return v;
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    // Open the user's default browser. Caller is awaiting waitForCode()
    // on the OAuthCallbackListener that owns this provider's redirectUri.
    await shell.openExternal(authorizationUrl.toString());
  }
}
