/**
 * OpenClaw config.get / config.patch RPC 封装。
 *
 * 用法:
 *   const { data: cfg } = useConfig();        // 拉最新配置 + hash
 *   const save = useSaveConfigPatch();
 *   await save.mutateAsync({ patch: {...} }); // 内部自动带 baseHash
 *
 * OpenClaw 限流 config.patch 3次/60s。批量改动一次打包成一个 patch。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGatewayStore } from "@/stores/gateway-store";

export interface ConfigGetResp {
  /** 完整当前配置(JSON) */
  config: Record<string, unknown>;
  /** 用于乐观并发的 hash,下一次 patch 传回 */
  hash: string;
}

export function useConfig() {
  const activeId = useGatewayStore((s) => s.activeId);
  const gateways = useGatewayStore((s) => s.gateways);
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);

  const active = gateways.find((g) => g.id === activeId);
  const connected = active?.status === "connected";

  return useQuery({
    queryKey: ["config", activeId],
    queryFn: async (): Promise<ConfigGetResp> => {
      const client = getActiveClient();
      if (!client) throw new Error("Gateway 未连接");
      return await client.request<ConfigGetResp>("config.get");
    },
    enabled: connected,
    staleTime: 10_000,
  });
}

/**
 * config.patch 实际签名是 { raw: <完整配置 JSON 字符串>, baseHash }。
 * 这里封装:调用方传一个"nextConfig 对象",内部 JSON.stringify + 带 baseHash。
 */
export function useSaveConfigPatch() {
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      nextConfig: Record<string, unknown>;
      baseHash: string;
    }) => {
      const client = getActiveClient();
      if (!client) throw new Error("Gateway 未连接");
      return await client.request<{ ok: true; hash: string }>("config.patch", {
        raw: JSON.stringify(input.nextConfig, null, 2),
        baseHash: input.baseHash,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["config"] });
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

/** 从对象深层取值:getPath(obj, "a.b.c") */
export function getPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** 按 path 往对象写值,生成新的嵌套结构: setPath({}, "a.b.c", 1) → {a:{b:{c:1}}} */
export function setPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".");
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const next = cur[p];
    if (!next || typeof next !== "object") {
      cur[p] = {};
    }
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}
