import type { PreviewAdapter } from "../types";

/**
 * /__openclaw__/canvas/... —— OpenClaw gateway 的内部 canvas URL。
 * 这是 gateway 管理的资源,给出 URL 的那一刻通常就已可读。
 *
 * 但仍然做 HEAD fetch 兜底 —— 网络瞬断 / gateway 重启等边界情况要正确反映。
 * resolve 成 http://127.0.0.1:<gatewayPort>/__openclaw__/... 后 fetch。
 */

import { resolveCanvasUrl } from "@/lib/embed";

const CACHE_TTL_MS = 10_000;
const cache = new Map<string, { ts: number; ok: boolean; error?: string }>();

async function headCheck(
  resolvedUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  const cached = cache.get(resolvedUrl);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached;
  try {
    const res = await fetch(resolvedUrl, { method: "HEAD" });
    const entry = { ts: Date.now(), ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` };
    cache.set(resolvedUrl, entry);
    return entry;
  } catch (err) {
    const entry = {
      ts: Date.now(),
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    cache.set(resolvedUrl, entry);
    return entry;
  }
}

export const canvasAdapter: PreviewAdapter = {
  name: "canvas",
  canHandle(url) {
    return url.startsWith("/__openclaw__/");
  },
  async probe(url, ctx) {
    const resolved = resolveCanvasUrl(url);
    const r = await headCheck(resolved);
    if (r.ok) return { kind: "ready" };
    // gateway 内部资源:run 还在跑 → pending(可能正在生成中)
    if (ctx.runActive) return { kind: "pending" };
    return { kind: "error", reason: r.error ?? "无法访问 canvas 资源" };
  },
};
