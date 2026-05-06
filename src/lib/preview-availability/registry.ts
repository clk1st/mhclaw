import type {
  PreviewAdapter,
  PreviewStatus,
  ProbeCtx,
  AvailabilityChangeCb,
} from "./types";

/**
 * Adapter 注册表 —— 按注册顺序找第一个 canHandle(url) 的。
 *
 * 单例模块级状态:多个 hook 实例共享一份 registry,adapter 内部可以维护缓存
 * (比如 http adapter 缓存 HEAD 响应减少 fetch 次数)。
 *
 * 注册由 bootstrap 模块(见 ./index.ts)在启动时调用一次,UI 侧只消费不直接注册。
 */
class AvailabilityRegistry {
  private adapters: PreviewAdapter[] = [];

  register(adapter: PreviewAdapter): void {
    // 同名 adapter 覆盖 —— 方便 HMR 下重新加载不叠
    const existing = this.adapters.findIndex((a) => a.name === adapter.name);
    if (existing >= 0) this.adapters[existing] = adapter;
    else this.adapters.push(adapter);
  }

  resolve(url: string): PreviewAdapter | null {
    for (const a of this.adapters) {
      if (a.canHandle(url)) return a;
    }
    return null;
  }

  async probe(url: string, ctx: ProbeCtx): Promise<PreviewStatus> {
    const adapter = this.resolve(url);
    if (!adapter) {
      return { kind: "error", reason: `没有 adapter 处理此 URL: ${url}` };
    }
    try {
      return await adapter.probe(url, ctx);
    } catch (err) {
      return {
        kind: "error",
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  subscribe(url: string, cb: AvailabilityChangeCb): () => void {
    const adapter = this.resolve(url);
    if (!adapter?.subscribe) return () => {};
    return adapter.subscribe(url, cb);
  }

  /** 测试 / 调试用:列出已注册的 adapter */
  list(): readonly PreviewAdapter[] {
    return this.adapters;
  }
}

export const availabilityRegistry = new AvailabilityRegistry();
