import type { PreviewAdapter } from "../types";

/**
 * http(s):// URL —— 外网资源,只能做 HEAD fetch 探测。
 *
 * 语义上不存在"生成中"态:要么 200(ready),要么 error。
 * 缓存:相同 URL 10 秒内不重复 HEAD,减少外部调用。
 */

const CACHE_TTL_MS = 10_000;

interface CacheEntry {
  ts: number;
  ok: boolean;
  status?: number;
  error?: string;
}

const cache = new Map<string, CacheEntry>();

async function headCheck(url: string): Promise<CacheEntry> {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached;
  try {
    const res = await fetch(url, { method: "HEAD" });
    const entry: CacheEntry = {
      ts: Date.now(),
      ok: res.ok,
      status: res.status,
    };
    cache.set(url, entry);
    return entry;
  } catch (err) {
    const entry: CacheEntry = {
      ts: Date.now(),
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    cache.set(url, entry);
    return entry;
  }
}

export const httpAdapter: PreviewAdapter = {
  name: "http",
  canHandle(url) {
    return /^https?:\/\//i.test(url);
  },
  async probe(url, ctx) {
    const r = await headCheck(url);
    if (r.ok) return { kind: "ready" };
    // 远端资源如果 4xx/5xx 说明本身不存在 —— 不是"生成中"。
    // 但如果 run 还在跑,让它等一会(AI 可能刚刚创建,CDN 还没 propagate)
    if (ctx.runActive && (r.error || (r.status && r.status >= 500))) {
      return { kind: "pending" };
    }
    return {
      kind: "error",
      reason: r.error ?? `HTTP ${r.status}`,
    };
  },
  // 没有 subscribe —— 只能按需 probe(挂载时 + run 结束时 + 点击时)
};
