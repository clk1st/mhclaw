import { useQuery } from "@tanstack/react-query";
import { useGatewayStore } from "@/stores/gateway-store";

/**
 * OpenClaw 4.x 的 agents.list 返回结构不完全稳定：
 * - model 有可能是 "provider/modelId" 字符串，也可能是对象 { provider, id, ... }
 * - workspace 可能是 string 或 { path, ... }
 * 所以所有字段放宽成 unknown，render 时再 type guard。
 */
export interface AgentInfo {
  id: string;
  name?: unknown;
  workspace?: unknown;
  model?: unknown;
  default?: unknown;
  emoji?: unknown;
  description?: unknown;
  [extra: string]: unknown;
}

function parseAgents(result: unknown): AgentInfo[] {
  if (!result) return [];
  if (Array.isArray(result)) return result as AgentInfo[];
  const d = result as Record<string, unknown>;
  for (const key of ["agents", "list", "entries"]) {
    if (Array.isArray(d[key])) return d[key] as AgentInfo[];
  }
  return [];
}

export function useAgents() {
  const activeId = useGatewayStore((s) => s.activeId);
  const gateways = useGatewayStore((s) => s.gateways);
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);

  const active = gateways.find((g) => g.id === activeId);
  const connected = active?.status === "connected";

  return useQuery({
    queryKey: ["agents", activeId],
    queryFn: async (): Promise<AgentInfo[]> => {
      const client = getActiveClient();
      if (!client) return [];
      try {
        const result = await client.request<unknown>("agents.list");
        return parseAgents(result);
      } catch (err) {
        console.warn("[useAgents] list failed:", err);
        return [];
      }
    },
    enabled: connected,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
}
