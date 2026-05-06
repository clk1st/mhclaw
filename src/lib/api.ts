/**
 * Backend API client utilities.
 *
 * Open-source build defaults `baseURL` to an empty string. With no backend
 * configured, mhwork-api-bound features (login / register / SkillHub
 * upload, etc.) are in a gracefully-disabled state. To enable:
 *   localStorage.setItem("mhclaw-api-url", "https://your-backend.example.com")
 *
 * Demo login: `admin / 123456` is handled by the front-end mock (in
 * `auth-store`) and never hits this client.
 *
 * `apiFetch` automatically injects the Authorization Bearer header
 * (from localStorage `mhclaw-token`).
 *
 * Error handling:
 *   - HTTP 4xx/5xx → throws `ApiError` (carries `status` and `detail`)
 *   - HTTP 401 → triggers a global logout (clears token + reload)
 */

const DEFAULT_API_URL = "";
export const API_TOKEN_KEY = "mhclaw-token";
export const API_URL_KEY = "mhclaw-api-url";

export function getApiBaseUrl(): string {
  try {
    return localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL;
  } catch {
    return DEFAULT_API_URL;
  }
}

export function getApiToken(): string | null {
  try {
    return localStorage.getItem(API_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setApiToken(token: string | null) {
  try {
    if (token) localStorage.setItem(API_TOKEN_KEY, token);
    else localStorage.removeItem(API_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export class ApiError extends Error {
  status: number;
  detail?: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Skip the Authorization header (e.g. for register / login). */
  noAuth?: boolean;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const { body, noAuth, headers, ...rest } = options;
  const baseUrl = getApiBaseUrl();
  const url = path.startsWith("http") ? path : `${baseUrl}${path}`;

  const finalHeaders: Record<string, string> = {
    Accept: "application/json",
    ...((headers as Record<string, string> | undefined) ?? {}),
  };
  if (body !== undefined && !(body instanceof FormData)) {
    finalHeaders["Content-Type"] = "application/json";
  }
  if (!noAuth) {
    const token = getApiToken();
    if (token) finalHeaders["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: finalHeaders,
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
  } catch (err) {
    throw new ApiError(0, err instanceof Error ? err.message : "Network error");
  }

  let data: unknown = null;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    try {
      data = await res.text();
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const detail =
      data && typeof data === "object" && "detail" in data
        ? (data as { detail: unknown }).detail
        : data;
    const message = typeof detail === "string" ? detail : `HTTP ${res.status}`;
    if (res.status === 401) {
      setApiToken(null);
      // Fire a global event so auth-store can subscribe and soft-reset.
      window.dispatchEvent(new CustomEvent("mhclaw:unauthorized"));
    }
    throw new ApiError(res.status, message, detail);
  }
  return data as T;
}
