import { useQuery } from "@tanstack/react-query";
import { useGatewayStore } from "@/stores/gateway-store";

export interface CommandEntry {
  name: string;
  nativeName?: string;
  textAliases?: string[];
  description?: string;
  category?: string;
  source: "native" | "skill" | "plugin";
  scope: "text" | "native" | "both";
  acceptsArgs?: boolean;
  args?: Array<{ name: string; description?: string; required?: boolean }>;
}

/**
 * 拉 `/` 命令清单:commands.list({ scope: "text", includeArgs: true })
 * 返回里 source: "native" | "skill" | "plugin" 三类,面板可以按此分区。
 */
export function useCommands() {
  const activeId = useGatewayStore((s) => s.activeId);
  const gateways = useGatewayStore((s) => s.gateways);
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);

  const active = gateways.find((g) => g.id === activeId);
  const connected = active?.status === "connected";

  return useQuery({
    queryKey: ["commands", activeId],
    queryFn: async (): Promise<CommandEntry[]> => {
      const client = getActiveClient();
      if (!client) return [];
      try {
        const result = await client.request<{ commands: CommandEntry[] }>(
          "commands.list",
          { scope: "text", includeArgs: true },
        );
        return Array.isArray(result?.commands) ? result.commands : [];
      } catch (err) {
        console.warn("[useCommands] commands.list failed:", err);
        return [];
      }
    },
    enabled: connected,
    staleTime: 30_000,
  });
}
