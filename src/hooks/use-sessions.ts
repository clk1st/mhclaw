import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGatewayStore } from "@/stores/gateway-store";
import { useChatStore, type SessionInfo } from "@/stores/chat-store";

/** 首屏默认显示的任务数 */
const INITIAL_LIMIT = 30;
/** 每次「显示更早」追加的任务数 */
const LOAD_MORE_STEP = 30;

/**
 * 从 Gateway 拉会话列表(渐进加载)。
 *
 * 设计:OpenClaw 的 sessions.list 只认 limit,不支持 offset/cursor
 * (源码实测:listSessionsFromStore 只 .slice(0, limit) 裁顶)。
 *   → 所以这里采用"limit 不断扩大"的方式:首次 30,点一次「显示更早」
 *     就把 limit 加 30 重拉,react-query 会直接覆盖旧数据,分桶不跳。
 *   → 实际返回数量 < 请求的 limit 时,说明已经是全部了,hasMore=false,
 *     按钮隐藏。
 *   → 5s 轮询用同一个 limit,所以最新状态(新开任务、更新时间)会正常
 *     刷新,不会因分页错过。
 */
export function useSessions() {
  const activeId = useGatewayStore((s) => s.activeId);
  const gateways = useGatewayStore((s) => s.gateways);
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);

  const active = gateways.find((g) => g.id === activeId);
  const connected = active?.status === "connected";

  const [limit, setLimit] = useState(INITIAL_LIMIT);

  const query = useQuery({
    queryKey: ["sessions", activeId, limit],
    queryFn: async (): Promise<SessionInfo[]> => {
      const client = getActiveClient();
      if (!client) return [];
      const result = await client.request<unknown>("sessions.list", {
        limit,
        includeDerivedTitles: true,
        includeLastMessage: true,
      });
      return parseSessions(result);
    },
    enabled: connected,
    refetchInterval: 5_000,
    staleTime: 2_000,
    // 切换 limit 时保留上次数据,避免"显示更早"瞬间闪一下空状态
    placeholderData: (prev) => prev,
  });

  // 实际返回数比当前 limit 少 → 已到底,之后不再显示「显示更早」
  const hasMore = (query.data?.length ?? 0) >= limit;

  const loadMore = () => setLimit((n) => n + LOAD_MORE_STEP);

  return {
    ...query,
    data: query.data ?? [],
    hasMore,
    loadMore,
    isLoadingMore: query.isFetching && !query.isLoading,
  };
}

/**
 * 硬删除一个 session(走 OpenClaw sessions.delete RPC)。
 * 不可恢复,调用方要先弹确认。
 *
 * 副作用:
 *  - 删除当前激活 session 时,自动切到"新建"空状态
 *  - invalidate sessions 列表 + artifacts(可能有跟这个 session 绑的产物)
 */
export function useDeleteSession() {
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessionKey: string) => {
      const client = getActiveClient();
      if (!client) throw new Error("Gateway 未连接");
      await client.request("sessions.delete", { key: sessionKey });
      // 如果删的是当前激活 session,切回空对话状态
      const current = useChatStore.getState().sessionKey;
      if (current === sessionKey) {
        useChatStore.getState().newSession();
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: ["artifacts"] });
    },
  });
}

/** 解析 sessions.list 的响应（格式容错，同 mhclaw 的 chat-store 逻辑） */
function parseSessions(result: unknown): SessionInfo[] {
  let list: unknown[] = [];

  if (Array.isArray(result)) {
    list = result;
  } else if (result && typeof result === "object") {
    const raw = result as Record<string, unknown>;
    for (const key of ["sessions", "list", "rows", "entries"]) {
      if (Array.isArray(raw[key])) {
        list = raw[key] as unknown[];
        break;
      }
    }
    if (list.length === 0) {
      for (const val of Object.values(raw)) {
        if (Array.isArray(val) && val.length > 0 && typeof val[0] === "object") {
          list = val;
          break;
        }
      }
    }
  }

  // 识别 "[cron:<uuid>]" 模式 —— Gateway 对定时任务自动生成的占位 title。
  // 任意字段(title 类 / lastMessage / key)命中都当定时任务 session。
  const CRON_TITLE_RE = /^\[cron:([a-f0-9-]+)\]$/i;
  const CRON_INLINE_RE = /\[cron:([a-f0-9-]+)\]/i;
  const looksLikeCronTitle = (s: string | undefined): boolean =>
    !!s && CRON_TITLE_RE.test(s.trim());
  const extractCronId = (s: string | undefined): string | undefined => {
    if (!s) return undefined;
    const m = s.match(CRON_INLINE_RE);
    return m ? m[1] : undefined;
  };

  return list
    .map((s: unknown) => {
      const item = s as Record<string, unknown>;
      const rawTitle = (item.derivedTitle ??
        item.displayName ??
        item.label ??
        "") as string;
      const rawLastMsg = (item.lastMessagePreview ??
        item.lastMessage ??
        "") as string;
      const key = (item.key ?? item.sessionKey ?? "") as string;

      // cron session 判定:title / lastMessage / key 任一出现 [cron:<uuid>] 就是
      const cronJobId =
        extractCronId(rawTitle) ??
        extractCronId(rawLastMsg) ??
        extractCronId(key);
      const isCron =
        looksLikeCronTitle(rawTitle) ||
        looksLikeCronTitle(rawLastMsg) ||
        /\[cron:[a-f0-9-]+\]/i.test(key);

      // Gateway 给的无意义 title 过滤:
      // - untrusted meta / system / bootstrap:系统消息产生的标题
      // - [cron:<uuid>]:定时任务触发的 session 自动命名,技术 ID 对用户无意义
      const clean =
        rawTitle &&
        !/untrusted meta|system|bootstrap/i.test(rawTitle) &&
        !looksLikeCronTitle(rawTitle)
          ? rawTitle
          : "";
      // lastMessage 也过滤:如果 Gateway 把 [cron:<uuid>] 塞进 lastMessagePreview,
      // UI fallback 链会拿它当标题显示,一样丑
      const cleanLastMsg = looksLikeCronTitle(rawLastMsg) ? "" : rawLastMsg;

      return {
        key,
        title: clean,
        lastMessage: cleanLastMsg,
        updatedAt: (item.updatedAt ?? 0) as number,
        agentId: (item.agentId ?? "") as string,
        isCron,
        cronJobId,
      };
    })
    .filter((s) => s.key);
}
