import { useQuery } from "@tanstack/react-query";
import { useGatewayStore } from "@/stores/gateway-store";

export interface ChannelInfo {
  id: string;
  type: string;
  label?: string;
  /** 已完成 token / provider 必填项配置 */
  configured?: boolean;
  /** 至少一个 account 启用 + 运行中(connected / ok) */
  running?: boolean;
  status?: string;
  accounts?: Array<{
    id: string;
    label?: string;
    status?: string;
    enabled?: boolean;
    configured?: boolean;
  }>;
}

/**
 * OpenClaw 2026.4.x 的 channels.status 返回 shape:
 *   { channels: { [id]: { configured, ... } },
 *     channelAccounts: { [id]: AccountSnapshot[] },
 *     channelLabels: { [id]: string },
 *     channelDefaultAccountId: { [id]: string } }
 * AccountSnapshot: { accountId, enabled, configured, connected?, state?, ... }
 */
function extractChannels(data: unknown): ChannelInfo[] {
  if (!data) return [];
  if (Array.isArray(data)) return data as ChannelInfo[]; // 兼容旧 shape
  const d = data as Record<string, unknown>;

  const channelsMap = d.channels as Record<string, unknown> | undefined;
  if (channelsMap && typeof channelsMap === "object" && !Array.isArray(channelsMap)) {
    const accountsMap = (d.channelAccounts ?? {}) as Record<string, unknown[]>;
    const labelsMap = (d.channelLabels ?? {}) as Record<string, string>;
    return Object.entries(channelsMap).map(([id, summaryRaw]) => {
      const summary = (summaryRaw ?? {}) as Record<string, unknown>;
      const rawAccounts = (accountsMap[id] ?? []) as Array<Record<string, unknown>>;
      const accounts = rawAccounts.map((a) => ({
        id: String(a.accountId ?? ""),
        label: a.label as string | undefined,
        status: a.state as string | undefined,
        enabled: a.enabled as boolean | undefined,
        configured: a.configured as boolean | undefined,
      }));
      const configured = Boolean(summary.configured);
      const running = accounts.some(
        (a) =>
          a.enabled !== false &&
          (a.status === "connected" || a.status === "ok" || a.status === "running"),
      );
      return {
        id,
        type: id,
        label: labelsMap[id],
        configured,
        running,
        status: running ? "connected" : configured ? "configured" : undefined,
        accounts,
      };
    });
  }

  // 旧兼容:可能的 { channels: [...] } 或 { status: {...} } 形式
  if (Array.isArray(d.channels)) return d.channels as ChannelInfo[];
  if (d.status && typeof d.status === "object") {
    return Object.entries(d.status as Record<string, unknown>).map(
      ([id, val]) => {
        const v = (val ?? {}) as Record<string, unknown>;
        return {
          id,
          type: (v.type as string) || id,
          label: v.label as string | undefined,
          status: v.status as string | undefined,
          accounts: v.accounts as ChannelInfo["accounts"],
        };
      },
    );
  }
  return [];
}

export function useChannels() {
  const activeId = useGatewayStore((s) => s.activeId);
  const gateways = useGatewayStore((s) => s.gateways);
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);

  const active = gateways.find((g) => g.id === activeId);
  const connected = active?.status === "connected";

  return useQuery({
    queryKey: ["channels", activeId],
    queryFn: async (): Promise<ChannelInfo[]> => {
      const client = getActiveClient();
      if (!client) return [];
      try {
        const result = await client.request<unknown>("channels.status");
        return extractChannels(result);
      } catch (err) {
        console.warn("[useChannels] status failed:", err);
        return [];
      }
    },
    enabled: connected,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
}

/** OpenClaw 4.x 支持的渠道清单（hardcode，对应官方 channels-system.md） */
export const SUPPORTED_CHANNELS: Array<{
  id: string;
  name: string;
  brief: string;
}> = [
  // 国内主流
  { id: "feishu", name: "飞书 / Lark", brief: "Feishu Open API" },
  { id: "wecom", name: "企业微信", brief: "WeCom 官方插件 · WebSocket" },
  { id: "ddingtalk", name: "钉钉", brief: "企业机器人 Stream 模式" },
  { id: "openclaw-weixin", name: "微信", brief: "腾讯 iLink Bot · 扫码登录(仅私聊)" },
  { id: "qqbot", name: "QQ Bot", brief: "腾讯 QQ 官方 Bot" },
  // 海外主流
  { id: "telegram", name: "Telegram", brief: "grammY · long-poll / webhook" },
  { id: "slack", name: "Slack", brief: "Bolt · 原生 streaming" },
  { id: "discord", name: "Discord", brief: "discord.js · 语音支持" },
  { id: "whatsapp", name: "WhatsApp", brief: "Baileys Web" },
  { id: "line", name: "LINE", brief: "LINE Messaging API" },
  // 苹果
  { id: "imessage", name: "iMessage", brief: "macOS Messages.app" },
  // 企业 / 海外 Workspace
  { id: "msteams", name: "MS Teams", brief: "Bot Framework" },
  { id: "googlechat", name: "Google Chat", brief: "Workspace Chat API" },
];
