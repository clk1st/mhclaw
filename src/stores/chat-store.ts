import { v4 as uuid } from "uuid";
import { create } from "zustand";
import type { ChatMessage, MessageBlock } from "@/types/gateway";
import type { GatewayClient } from "@/services/gateway-client";
import type { GatewayEvent } from "@/types/gateway";
import { buildMarkers, stripMarkers, type ComposerMode } from "@/lib/markers";

/** 会话摘要（来自 sessions.list） */
export interface SessionInfo {
  key: string;
  title?: string;
  lastMessage?: string;
  updatedAt?: number;
  agentId?: string;
  /** 由定时任务(cron)触发的 session,UI 显示时加 [定时任务] 前缀区分 */
  isCron?: boolean;
  /** cron session 对应的 job id(从 [cron:<uuid>] 中解析),用来查 job name */
  cronJobId?: string;
}

interface ChatState {
  messages: ChatMessage[];
  loading: boolean;
  /**
   * 最近一次来自 gateway 的事件时间戳(chat / agent 任一频道,任一 state 都算)。
   * run 结束清 null。UI 用它来检测"静默期"—— 超过 N 秒没事件 = LLM 可能卡在响应上,
   * 显示"等待模型响应"副标签让用户知道不是自己卡死。
   */
  lastEventAt: number | null;
  sessionKey: string;

  /** 会话列表 */
  sessions: SessionInfo[];
  sessionsLoading: boolean;

  /**
   * 客户端冻结的会话标题：sessionKey → 稳定 title。
   * 发首条消息时记录用户输入片段；新见到的 session 也会冻结一次 derivedTitle。
   * 之后无论 gateway 怎么重写 title，客户端显示的值不变（防止任务列表标题随聊天乱跳）。
   */
  sessionTitles: Record<string, string>;

  /** 预填输入框内容（从其他页面跳转时设置） */
  pendingInput: string | null;

  /** loadHistory 最近一次的错误 / 状态诊断(UI 显示 + debug 用) */
  historyDiag: {
    sessionKey: string;
    status: "idle" | "loading" | "empty" | "ok" | "error";
    raw: number; // raw messages count from gateway
    pushed: number; // 过滤后真正渲染的数量
    error?: string;
  } | null;

  /** Composer 当前模式:craft(默认)/ plan / ask,send 时自动拼 marker */
  composerMode: ComposerMode;

  /**
   * 本次发送选中的 skill keys(per-message hint)。
   * OpenClaw 的 chat.send schema 不接 skillKeys 参数,只能走 marker 文本注入
   * (`[skills: a, b]`),AGENTS.md contribution 教 AI 优先使用这些 skill。
   * 发送后**不自动清空**,允许连续多条复用,直到用户手动清。
   */
  selectedSkillKeys: string[];

  /** 绑定到一个 Gateway client，订阅聊天事件 */
  bind: (client: GatewayClient, sessionKey?: string) => () => void;
  /** 发送消息 */
  send: (text: string) => Promise<void>;
  /** 中止当前回复 */
  abort: () => Promise<void>;
  /** 加载历史记录 */
  loadHistory: () => Promise<void>;
  /** 加载会话列表 */
  loadSessions: () => Promise<void>;
  /** 切换会话 */
  switchSession: (key: string) => Promise<void>;
  /** 新建对话 */
  newSession: () => Promise<void>;
  /** 清空消息 */
  clear: () => void;
  /** 设置预填输入 */
  setPendingInput: (text: string | null) => void;
  /**
   * 锁定 session 标题。默认幂等(有值不覆盖);传 force=true 强制覆盖,
   * 用于 loadHistory 拿到真实首条 user message 后覆盖 gateway 的 derivedTitle 摘要。
   */
  lockSessionTitle: (key: string, title: string, force?: boolean) => void;
  /** 切换 Composer 模式 */
  setComposerMode: (mode: ComposerMode) => void;
  /** 全量替换 / 清空选中 skill */
  setSelectedSkills: (keys: string[]) => void;
  /** 切换单个 skill 选中状态 */
  toggleSkillSelection: (key: string) => void;
  /**
   * 新建一个会话,可选指定 agent。
   * 给定 agentId 时 sessionKey 编码为 `agent:<agentId>:<rest>`,
   * OpenClaw 会按这个前缀路由到对应 agent。
   */
  newSessionWithAgent: (agentId?: string | null) => Promise<void>;
}

const TITLES_STORAGE_KEY = "mhclaw-session-titles";

function loadSessionTitles(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TITLES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    if (!parsed || typeof parsed !== "object") return {};
    // 一次性清理历史残留:老版本曾把 gateway "hash (date)" 垃圾 title 也锁进 localStorage,
    // 导致 Sidebar 永远显示垃圾。加载时过滤掉,下次 loadHistory 有机会用真实 user 消息回填。
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== "string" || !v) continue;
      if (/^[a-f0-9]{6,16}\s*\(\d{4}-\d{2}-\d{2}\)$/i.test(v.trim())) continue;
      cleaned[k] = v;
    }
    return cleaned;
  } catch {
    return {};
  }
}

function persistSessionTitles(titles: Record<string, string>) {
  try {
    localStorage.setItem(TITLES_STORAGE_KEY, JSON.stringify(titles));
  } catch {
    // ignore quota / disabled storage
  }
}

// 当前活跃 sessionKey:写入 localStorage 留作审计(侧边栏记忆光标之类未来用),
// 但启动时**不读**—— 重启 app 默认进新建任务虚拟态(Hero),任务导向产品里
// "重启 = 开新任务"比"硬塞回上次半吊子对话"更自然,也避开了 Gateway 启动时序
// 窗口里 chat.history 还没就绪的竞态。
const ACTIVE_SESSION_KEY = "mhclaw-active-session-key";

function persistActiveSessionKey(key: string) {
  try {
    localStorage.setItem(ACTIVE_SESSION_KEY, key);
  } catch {
    // ignore
  }
}

let activeClient: GatewayClient | null = null;
let __agentDiagCount = 0;

/**
 * chat.history 启动期退避重试。Gateway 的 hello-ok 握手只代表 WebSocket 鉴权通过,
 * 但 chat 子系统(加载 jsonl transcript 等)在后面还要几秒才就绪。那段时间 RPC
 * 会 reject 带 "unavailable during startup" 或直接超时。指数退避 5 次,
 * 总窗口 ~19s,覆盖 Windows 慢机 + 杀毒扫描的冷启动场景;仍失败按真 error 处理。
 *
 * 单次请求超时给到 60s:Windows 慢机 + OpenClaw 扫 jsonl 文件时第一次加载
 * 很可能 >30s,默认 requestTimeout 会立刻抛 timeout 错。
 */
async function requestHistoryWithRetry(
  sessionKey: string,
): Promise<{ messages: unknown[] }> {
  const delays = [500, 1500, 3000, 6000, 8000];
  let lastErr: unknown = null;
  for (let i = 0; i <= delays.length; i++) {
    if (!activeClient) throw new Error("未连接 Gateway");
    try {
      return await activeClient.request<{ messages: unknown[] }>(
        "chat.history",
        { sessionKey },
        { timeoutMs: 60_000 },
      );
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // timeout 也视为 transient —— Windows 慢机 + 杀毒扫描场景首次加载
      // 可能撞 60s 上限;等一下大概率下次就能回。
      const transient = /unavailable|startup|not.?ready|booting|timeout/i.test(msg);
      if (!transient || i === delays.length) throw err;
      await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
  throw lastErr ?? new Error("chat.history retry exhausted");
}

/**
 * "已 abort" runId 黑名单 —— L1 层面 cancel:
 * 用户点停止后,OpenClaw gateway 侧 chat.abort 是软停,已 in-flight 的 delta / agent event
 * 会继续广播过来(pi-agent-core 的 tool call 已排队执行,无法真的立停)。
 * 前端把这些 runId 的后续 event 全部丢弃,UI 立即"停":不再涨内容、不再拉 loading。
 *
 * 条目 3 秒后自动清理 —— 足够覆盖 abort 后还在飞的 event。
 */
const abortedRunIds = new Set<string>();
function markRunAborted(runId: string) {
  if (!runId) return;
  abortedRunIds.add(runId);
  setTimeout(() => abortedRunIds.delete(runId), 3000);
}
function isRunAborted(runId: string | undefined): boolean {
  return !!runId && abortedRunIds.has(runId);
}

/**
 * Gateway 会对 chat.send 的 sessionKey 做规范化
 * (比如 "session-123" → "agent:main:session-123")。
 * 首次在 chat / agent 事件里拿到规范 key 后,把本地状态迁过去:
 *   - chat-store.sessionKey
 *   - localStorage active session key
 *   - sessionTitles[oldKey] → [newKey]
 *   - session-task.json 磁盘映射(IPC)
 * 一次性,后续事件同 key 不再触发。
 */
function maybeRemapSessionKey(
  gatewaySessionKey: string | undefined,
  set: (
    partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>),
  ) => void,
  get: () => ChatState,
): void {
  if (!gatewaySessionKey) return;
  const oldKey = get().sessionKey;
  if (!oldKey || oldKey === gatewaySessionKey) return;
  // 只接受"客户端版包含在 Gateway 版"这种扩展(如 "session-X" → "agent:main:session-X"),
  // 防止别的 session 事件误触发
  if (!gatewaySessionKey.includes(oldKey)) return;

  console.log(
    `[ChatStore] remapping sessionKey: "${oldKey}" → "${gatewaySessionKey}"`,
  );

  set((s) => {
    const titles = { ...s.sessionTitles };
    if (titles[oldKey] !== undefined) {
      titles[gatewaySessionKey] = titles[oldKey];
      delete titles[oldKey];
      persistSessionTitles(titles);
    }
    return { sessionKey: gatewaySessionKey, sessionTitles: titles };
  });
  persistActiveSessionKey(gatewaySessionKey);

  // 磁盘映射迁移 + React Query 刷新,不阻塞
  window.cjtClaw?.taskFolder
    .remapSession(oldKey, gatewaySessionKey)
    .catch((err) => console.warn("[ChatStore] remapSession failed:", err))
    .finally(() => {
      const qc = (
        window as unknown as {
          __mhclawQC?: import("@tanstack/react-query").QueryClient;
        }
      ).__mhclawQC;
      qc?.invalidateQueries({ queryKey: ["taskFolder"] });
      qc?.invalidateQueries({ queryKey: ["artifacts"] });
    });
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  loading: false,
  lastEventAt: null,
  sessionKey: "main",
  sessions: [],
  sessionsLoading: false,
  sessionTitles: loadSessionTitles(),
  pendingInput: null,
  historyDiag: null,
  composerMode: "craft",
  selectedSkillKeys: [],
  setComposerMode: (mode) => set({ composerMode: mode }),
  setSelectedSkills: (keys) => set({ selectedSkillKeys: keys }),
  toggleSkillSelection: (key) =>
    set((s) => ({
      selectedSkillKeys: s.selectedSkillKeys.includes(key)
        ? s.selectedSkillKeys.filter((k) => k !== key)
        : [...s.selectedSkillKeys, key],
    })),
  setPendingInput: (text) => set({ pendingInput: text }),

  lockSessionTitle: (key, title, force) => {
    const trimmed = title.trim();
    if (!key || !trimmed) return;
    set((state) => {
      if (!force && state.sessionTitles[key]) return state;
      // 压成单行,最多 40 字
      const val = trimmed.replace(/\s+/g, " ").slice(0, 40);
      const next = { ...state.sessionTitles, [key]: val };
      persistSessionTitles(next);
      return { sessionTitles: next };
    });
  },

  bind: (client, sessionKey) => {
    activeClient = client;
    // 不无脑 reset 成 "main" —— 保留启动时从 localStorage 恢复的活跃 session
    if (sessionKey !== undefined) {
      set({ sessionKey, messages: [] });
      persistActiveSessionKey(sessionKey);
    } else {
      set({ messages: [] });
    }

    // 订阅 "chat" 事件（OpenClaw 统一用一个事件名，通过 state 区分）
    const unsub = client.on("chat", (event: GatewayEvent) => {
      const payload = event.payload as {
        runId: string;
        sessionKey: string;
        seq: number;
        state: "delta" | "final" | "aborted" | "error";
        message?: { role?: string; content?: unknown };
        errorMessage?: string;
      };
      // Gateway 规范化后的 sessionKey 比本地发送的长(加 agent 前缀),
      // 首次拿到就迁移本地 state 和磁盘映射,避免切回来时 getForSession 查不到
      maybeRemapSessionKey(payload.sessionKey, set, get);

      // 过滤:不是当前活跃 session 的事件丢弃,避免跨 session 污染
      // (典型:桌面开着 main 对话,微信给 claw 发消息,claw 的 delta 不该写进 main)
      if (payload.sessionKey && payload.sessionKey !== get().sessionKey) return;

      // 有事件进来就是 gateway 活着的证据 —— 更新 lastEventAt 给 UI 静默检测用
      set({ lastEventAt: Date.now() });

      // L1 cancel:这个 runId 用户已按过停止,丢弃所有后续 event(gateway 软停,
      // pi-agent 已在飞的 delta / tool event 还会继续广播过来)
      if (isRunAborted(payload.runId)) return;

      switch (payload.state) {
        case "delta": {
          // chat delta 在 OpenClaw 4.x 里只有 assistant text(tool 调用走 "agent" 事件)。
          // 按 runId 定位(不要只看 "last" + streaming — agent 事件可能已经关掉 streaming 了)。
          const blocks = extractBlocks(payload.message);
          const text = blocksToText(blocks);
          set((s) => {
            const msgs = [...s.messages];
            const idx = findLastIdxByRunId(msgs, payload.runId);
            if (idx !== -1) {
              const t = msgs[idx];
              const existing = t.blocks ?? [];
              const hasStructured = existing.some((b) => b.type !== "text");
              msgs[idx] = hasStructured
                ? { ...t, content: text }
                : { ...t, content: text, blocks };
            } else {
              msgs.push({
                id: `run-${payload.runId}-${payload.seq}`,
                _runId: payload.runId,
                role: "assistant",
                content: text,
                blocks,
                timestamp: Date.now(),
                streaming: true,
              });
            }
            return { messages: msgs, loading: true };
          });
          break;
        }
        case "final": {
          const blocks = extractBlocks(payload.message);
          const text = blocksToText(blocks);
          set((s) => {
            const msgs = [...s.messages];
            const idx = findLastIdxByRunId(msgs, payload.runId);
            if (idx !== -1) {
              const t = msgs[idx];
              const existing = t.blocks ?? [];
              const hasStructured = existing.some((b) => b.type !== "text");
              msgs[idx] = {
                ...t,
                content: text || t.content,
                blocks: hasStructured ? existing : blocks.length > 0 ? blocks : t.blocks,
                streaming: false,
              };
            } else if (text || blocks.length > 0) {
              // 真的没有这个 runId 的 assistant:极端情况(非流式一次性回复)
              msgs.push({
                id: `run-${payload.runId}-final`,
                _runId: payload.runId,
                role: "assistant",
                content: text,
                blocks,
                timestamp: Date.now(),
                streaming: false,
              });
            }
            return { messages: msgs, loading: false };
          });
          // 一轮结束后主动 reload 一次历史:
          // OpenClaw 的 chat event 只推 assistant(delta/final),inbound user msg 不 broadcast,
          // 桌面 UI 不 reload 永远看不到对方在微信发的那条。final 后 gateway 已 persist,
          // loadHistory 拉到的 user+assistant 都是完整权威版本,visual jump 一次可接受。
          void get().loadHistory();
          break;
        }
        case "aborted": {
          set((s) => {
            const msgs = [...s.messages];
            const last = msgs[msgs.length - 1];
            if (last?.streaming) {
              msgs[msgs.length - 1] = { ...last, streaming: false };
            }
            return { messages: msgs, loading: false };
          });
          break;
        }
        case "error": {
          // chat 顶层 error(失败兜底):跟 lifecycle phase=error 一样翻译机器文本
          // 给用户看人话
          const errText = humanizeAgentError(payload.errorMessage ?? "未知错误");
          set((s) => {
            const msgs = [...s.messages];
            const last = msgs[msgs.length - 1];
            const banner = `⚠️ ${errText}`;
            if (last?.streaming) {
              msgs[msgs.length - 1] = {
                ...last,
                streaming: false,
                content: last.content ? `${last.content}\n\n${banner}` : banner,
              };
            } else {
              msgs.push({
                id: `error-${payload.runId}`,
                role: "assistant",
                content: banner,
                timestamp: Date.now(),
              });
            }
            return { messages: msgs, loading: false };
          });
          break;
        }
      }
    });

    // 订阅 "agent" 事件(实时 run 的结构化事件流,按 stream 字段分 4 类):
    //   lifecycle       — data.phase: start/end/error
    //   item kind=tool  — data.phase: start/update/end,data.toolCallId / status / name / meta
    //   command_output  — data.phase: delta/end,data.output / exitCode / durationMs
    //   assistant       — data.text(累积) / data.delta(增量)
    // chat event 的 delta/final 在实时场景里只有 text,tool 调用完全走这里。
    console.log("[ChatStore] subscribing to 'agent' event");
    const unsubAgent = client.on("agent", (event: GatewayEvent) => {
      const p = event.payload as { sessionKey?: string } | undefined;
      maybeRemapSessionKey(p?.sessionKey, set, get);
      // agent 频道的任何 chunk 都算"活着"信号(比 chat 频道细得多,
      // tool_start / tool_update / delta 都触发)
      set({ lastEventAt: Date.now() });
      handleAgentEvent(event, set, get);
    });

    // 不主动 loadHistory:重启默认进"新建任务"虚拟态(sessionKey="main"),
    // 用户从侧边栏点历史任务时走 switchSession → loadHistory,那里有重试兜底。
    // 避免 Gateway 启动时序里 chat.history 还没就绪的"加载历史失败"黑屏。

    return () => {
      unsub();
      unsubAgent();
    };
  },

  send: async (text) => {
    if (!activeClient) {
      console.error("[ChatStore] send: no active client");
      return;
    }

    // 本地显示用的是原始文本(不含 marker);发给 gateway 的是 marker 注入后的文本
    const selectedSkillsSnapshot = get().selectedSkillKeys;
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: Date.now(),
      selectedSkills:
        selectedSkillsSnapshot.length > 0 ? [...selectedSkillsSnapshot] : undefined,
    };
    // 发送瞬间把 lastEventAt 设为"现在",之后每个 agent/chat chunk 都会刷新。
    // 这样 UI 就能在"发出去 → 首 token 到来"这段静默期识别是不是"等待模型响应"。
    set((state) => ({
      messages: [...state.messages, userMsg],
      loading: true,
      lastEventAt: Date.now(),
    }));

    const { sessionKey } = get();
    // 用首条用户消息片段冻结当前 session 的标题
    get().lockSessionTitle(sessionKey, text);

    // 真要发消息了,lazy ensure 任务目录:已绑定直接复用,否则建一个新的并绑。
    // 这是"任务目录 ↔ session 1:1"的唯一触发点 —— 切换历史不建(避免空目录),
    // 新建会话也不急着建,直到用户真说话。
    let outputDir: string | undefined;
    try {
      const ensured = await window.cjtClaw?.taskFolder.ensureForSession(sessionKey);
      outputDir = ensured?.path;
      if (ensured?.created) {
        // 让 FilesTab 等 useQuery 立即刷新
        const qc = (window as unknown as { __mhclawQC?: import("@tanstack/react-query").QueryClient }).__mhclawQC;
        qc?.invalidateQueries({ queryKey: ["taskFolder"] });
      }
    } catch (err) {
      console.warn("[ChatStore] ensureForSession failed:", err);
      outputDir = undefined;
    }

    const mode: ComposerMode = get().composerMode;
    // 用 push userMsg 那刻的 skills snapshot(第 397 行附近已 snapshot),
    // 不能再 get().selectedSkillKeys —— Composer 发完即清 state,await 回来读的是 []。
    const skills = selectedSkillsSnapshot;
    const payload = buildMarkers(text, {
      outputDir,
      mode,
      skills: skills.length > 0 ? skills : undefined,
    });
    console.log("[ChatStore] sending (markers):", { outputDir, mode, skills });

    // OpenClaw 4.x 的 chat.send schema 是 additionalProperties:false,
    // agentId 通过 sessionKey(`agent:<id>:<rest>`)隐含传递,skills 是全局开关 ——
    // 这里只传协议允许的字段
    try {
      await activeClient.request("chat.send", {
        sessionKey,
        message: payload,
        idempotencyKey: uuid(),
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "发送失败";
      set((state) => ({
        messages: [
          ...state.messages,
          {
            id: `error-${Date.now()}`,
            role: "assistant" as const,
            content: `**Error:** ${errMsg}`,
            timestamp: Date.now(),
          },
        ],
        loading: false,
      }));
    }
  },

  abort: async () => {
    if (!activeClient) return;
    const { sessionKey, messages } = get();
    // 防御性:把当前 session 里还在 streaming 的 assistant message 的 runId 先加黑名单,
    // chat.abort RPC 返回前就已经静默 — 不等网络往返,UI 立即"停下"
    for (const m of messages) {
      if (m.streaming && m._runId) markRunAborted(m._runId);
    }
    // 立即把 loading 置 false,按钮变回"发送",不给"停了又跑"的闪烁空间
    set({ loading: false });
    try {
      const res = await activeClient.request<{
        ok?: boolean;
        aborted?: boolean;
        runIds?: string[];
      }>("chat.abort", { sessionKey });
      // gateway 返回的 runIds 也进黑名单(权威源),兜住万一前端 streaming flag 没到位
      for (const rid of res?.runIds ?? []) markRunAborted(rid);
    } catch {
      // ignore — 网络出错也已本地静默
    }
  },

  loadHistory: async () => {
    if (!activeClient) {
      set({ historyDiag: { sessionKey: get().sessionKey, status: "error", raw: 0, pushed: 0, error: "未连接 Gateway" } });
      return;
    }
    const { sessionKey } = get();
    set({ historyDiag: { sessionKey, status: "loading", raw: 0, pushed: 0 } });
    try {
      const result = await requestHistoryWithRetry(sessionKey);

      // 诊断用:看一次 history 返回的真实结构
      console.log(
        "[ChatStore] chat.history raw:",
        sessionKey,
        JSON.stringify(result ?? {}).slice(0, 2000),
      );

      const rawCount = Array.isArray(result?.messages) ? result.messages.length : 0;

      if (result?.messages) {
        const messages: ChatMessage[] = [];
        for (let i = 0; i < result.messages.length; i++) {
          const msg = result.messages[i] as { role?: string; content?: unknown };
          const role = msg.role;
          if (role !== "user" && role !== "assistant") continue;

          // Anthropic 协议下,role=user 的 message 除了真实用户输入,
          // 还可能是 agent 回灌的 tool_result(content blocks 包含 tool_result)。
          // 只在明确含 tool_result 时过滤,避免误杀真实用户输入。
          const blocks = extractBlocks(msg);
          if (role === "user" && isSyntheticUserMessage(blocks)) continue;

          // 兜底:如果 extractBlocks 拿不到 text(结构特殊),退而求其次把 content stringify 显示出来,
          // 总比"点了没反应、空白"强。
          let content = blocksToText(blocks);
          if (!content) {
            if (typeof msg.content === "string") {
              content = msg.content;
            } else if (msg.content != null) {
              try {
                content = JSON.stringify(msg.content);
              } catch {
                content = "";
              }
            }
          }
          if (!content) continue;
          // user 消息:从 content 的 `[skills: a,b,c]` marker 解析出发送时的 selectedSkills,
          // 还原给 UserBubble 展示 chip(否则 loadHistory 重拉后 chip 消失)
          const selectedSkills =
            role === "user" ? stripMarkers(content).envelope.skills : undefined;
          messages.push({
            id: `history-${i}`,
            role,
            content,
            blocks: blocks.length > 0 ? blocks : undefined,
            timestamp: 0,
            selectedSkills:
              selectedSkills && selectedSkills.length > 0
                ? selectedSkills
                : undefined,
          });
        }
        set({
          messages,
          historyDiag: {
            sessionKey,
            status: messages.length === 0 ? "empty" : "ok",
            raw: rawCount,
            pushed: messages.length,
          },
        });

        // 自动冻结 session 标题:取第一条 user message 的前几十字。
        // force=true 强制覆盖 gateway derivedTitle(它可能是 AI 回复摘要,不是我们想要的用户问题)。
        const firstUser = messages.find((m) => m.role === "user");
        if (firstUser) {
          const snippet = stripMarkers(firstUser.content).visibleText.trim();
          if (snippet) get().lockSessionTitle(sessionKey, snippet, true);
        }
      } else {
        set({
          historyDiag: {
            sessionKey,
            status: "empty",
            raw: 0,
            pushed: 0,
            error: "gateway 未返回 messages 字段",
          },
        });
      }
    } catch (err) {
      console.error("[ChatStore] loadHistory failed:", err);
      set({
        historyDiag: {
          sessionKey,
          status: "error",
          raw: 0,
          pushed: 0,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  },

  loadSessions: async () => {
    if (!activeClient) return;
    set({ sessionsLoading: true });

    const { sessionKey } = get();
    const fallbackSessions: SessionInfo[] = [{
      key: sessionKey || "main",
      title: sessionKey === "main" || !sessionKey ? "主对话" : sessionKey,
      updatedAt: Date.now(),
    }];

    try {
      const result = await activeClient.request<unknown>("sessions.list", {
        limit: 50,
        includeDerivedTitles: true,
        includeLastMessage: true,
        includeGlobal: true,
        includeUnknown: true,
      });
      console.log("[ChatStore] sessions.list raw:", JSON.stringify(result).slice(0, 500));

      // 尝试从返回值中找到会话数组
      let list: unknown[] = [];
      if (Array.isArray(result)) {
        list = result;
      } else if (result && typeof result === "object") {
        const raw = result as Record<string, unknown>;
        // 遍历所有 key 找第一个数组
        for (const key of ["sessions", "list", "rows", "entries"]) {
          if (Array.isArray(raw[key])) {
            list = raw[key] as unknown[];
            break;
          }
        }
        // 如果还没找到，尝试所有值
        if (list.length === 0) {
          for (const val of Object.values(raw)) {
            if (Array.isArray(val) && val.length > 0 && typeof val[0] === "object") {
              list = val;
              break;
            }
          }
        }
      }

      console.log("[ChatStore] parsed session list length:", list.length);

      const sessions: SessionInfo[] = list.map((s: unknown) => {
        const item = s as Record<string, unknown>;
        return {
          key: (item.key ?? item.sessionKey ?? "") as string,
          title: (item.derivedTitle ?? item.displayName ?? item.label ?? "") as string,
          lastMessage: (item.lastMessagePreview ?? item.lastMessage ?? "") as string,
          updatedAt: (item.updatedAt ?? 0) as number,
          agentId: (item.agentId ?? "") as string,
        };
      }).filter((s) => s.key);

      // 确保当前 sessionKey 在列表中
      if (sessionKey && !sessions.find((s) => s.key === sessionKey)) {
        sessions.unshift(fallbackSessions[0]);
      }

      set({ sessions: sessions.length > 0 ? sessions : fallbackSessions, sessionsLoading: false });
    } catch (err) {
      console.error("[ChatStore] loadSessions failed:", err);
      set({ sessions: fallbackSessions, sessionsLoading: false });
    }
  },

  switchSession: async (key) => {
    set({ sessionKey: key, messages: [], loading: false });
    persistActiveSessionKey(key);
    await get().loadHistory();
  },

  newSession: async () => {
    await get().newSessionWithAgent(null);
  },

  newSessionWithAgent: async (agentId) => {
    const ts = Date.now();
    const id = (agentId ?? "").trim();
    // OpenClaw 解析 sessionKey 时,`agent:<id>:<rest>` 三段以上,小写,前缀必须 "agent"
    const newKey = id
      ? `agent:${id.toLowerCase()}:s-${ts}`
      : `session-${ts}`;

    // 新建会话自动创建并绑定任务目录(对标 WorkBuddy)。
    // 失败不阻塞 — 用户仍可手动通过"产出目录"picker 绑定。
    try {
      await window.cjtClaw?.taskFolder.createBlank(newKey);
    } catch (err) {
      console.warn("[ChatStore] auto-create task folder failed:", err);
    }

    // 新会话:清空 historyDiag(避免停留在"加载中"/"空会话"状态),走 Hero
    set({ sessionKey: newKey, messages: [], loading: false, historyDiag: null });
    persistActiveSessionKey(newKey);
  },

  clear: () => {
    set({ messages: [], loading: false });
  },
}));

/**
 * 从 OpenClaw message 格式提取 content blocks 数组,并**规范化为内部统一 schema**。
 *
 * 真实 OpenClaw 4.x 的 block type 是 camelCase(`toolCall` / `toolResult` / `thinking`),
 * 字段名也有差异(`arguments` 而不是 `input`)。我们内部一律用 Anthropic snake_case
 * (`tool_use` / `tool_result` / `input` / `tool_use_id`),好让下游 UI 代码只认一套 schema。
 *
 * 支持的输入形态:
 * - { content: Array<block> } (OpenClaw / Anthropic)
 * - { content: Array<字符串或松散 object> }(非标准,降级成 text)
 * - { content: "纯字符串" }
 * - { text: "..." }
 */
function extractBlocks(message: unknown): MessageBlock[] {
  if (!message) return [];
  const msg = message as { content?: unknown; text?: string };

  if (Array.isArray(msg.content)) {
    const blocks: MessageBlock[] = [];
    for (const raw of msg.content) {
      if (typeof raw === "string") {
        blocks.push({ type: "text", text: raw });
        continue;
      }
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const normalized = normalizeBlock(item);
      if (normalized) {
        blocks.push(normalized);
        continue;
      }
      // 未识别 + 无 type:试着从 text/content/value 降级成 text
      for (const k of ["text", "content", "value"] as const) {
        const v = item[k];
        if (typeof v === "string") {
          blocks.push({ type: "text", text: v });
          break;
        }
      }
    }
    if (blocks.length > 0) return blocks;
  }
  if (typeof msg.content === "string" && msg.content.length > 0) {
    return [{ type: "text", text: msg.content }];
  }
  if (typeof msg.text === "string" && msg.text.length > 0) {
    return [{ type: "text", text: msg.text }];
  }
  return [];
}

/**
 * 把任意 OpenClaw/Anthropic block 规范化成内部 schema(snake_case)。
 * 返回 null 表示类型字段没识别,调用方可降级处理。
 */
function normalizeBlock(item: Record<string, unknown>): MessageBlock | null {
  const typeRaw = typeof item.type === "string" ? item.type : "";
  if (!typeRaw) return null;

  // text block
  if (typeRaw === "text") {
    return { type: "text", text: typeof item.text === "string" ? item.text : "" };
  }

  // thinking block(Claude 3.7+,OpenClaw 也透传此 type)
  if (typeRaw === "thinking") {
    return {
      type: "thinking",
      thinking: typeof item.thinking === "string" ? item.thinking : "",
    };
  }

  // tool_use / toolCall(OpenClaw 4.x 实际用 "toolCall" + arguments)
  if (typeRaw === "tool_use" || typeRaw === "toolCall" || typeRaw === "tool_call") {
    return {
      type: "tool_use",
      id: typeof item.id === "string" ? item.id : `tu-${Date.now()}`,
      name: typeof item.name === "string" ? item.name : "tool",
      input: item.input ?? item.arguments ?? item.args ?? item.parameters,
    };
  }

  // tool_result / toolResult(OpenClaw 也可能叫 "toolResult" / "functionResult")
  if (
    typeRaw === "tool_result" ||
    typeRaw === "toolResult" ||
    typeRaw === "tool_call_result" ||
    typeRaw === "functionResult"
  ) {
    return {
      type: "tool_result",
      tool_use_id:
        (typeof item.tool_use_id === "string" && item.tool_use_id) ||
        (typeof item.toolUseId === "string" && item.toolUseId) ||
        (typeof item.id === "string" && item.id) ||
        (typeof item.callId === "string" && item.callId) ||
        "",
      content: item.content ?? item.result ?? item.output ?? item.error,
      is_error:
        item.is_error === true ||
        item.isError === true ||
        item.status === "error" ||
        item.status === "failed",
    };
  }

  // 未识别的 type:保留原样让 UI 层看到它(ToolCallGroup 会忽略,AssistantBlocks 当 text 渲染)
  return item as MessageBlock;
}

/** blocks 中所有 text block 的拼接,给现有 content 消费者用(embed/stripMarkers/搜索) */
function blocksToText(blocks: MessageBlock[]): string {
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

/** 从 OpenClaw message 提取纯文本(history 回放等场景,不需要 blocks 结构) */
function extractText(message: unknown): string {
  return blocksToText(extractBlocks(message));
}

/**
 * 判断一条 role=user 的 history 消息是不是"agent 回灌的执行日志"(非真实用户输入)。
 * 两种形态:
 * 1. Anthropic 标准 tool_result block
 * 2. OpenClaw 把 agent 执行日志以纯 text + user role 存进 history
 *    (出现 "System (untrusted):" / "Exec failed|completed (xxx)" 这类签名)
 * 这些都不该渲染成用户气泡。
 * 正则用的是非常特殊的签名,真实用户输入几乎不会命中。
 */
function isSyntheticUserMessage(blocks: MessageBlock[]): boolean {
  if (blocks.length === 0) return false;
  if (blocks.some((b) => b.type === "tool_result")) return true;
  const text = blocksToText(blocks);
  if (!text) return false;
  return (
    /\bSystem\s*\(untrusted\)\s*:/.test(text) ||
    /\bExec\s+(failed|completed)\s*\(/.test(text)
  );
}

/**
 * 把 OpenClaw / 模型层抛出的机器错误文本翻译成办公用户能读的话。
 * 不在错误文本里给可执行建议(那要靠 UI 上的"配置模型"按钮),只解释发生了什么。
 *
 * 已知模式(根据 gateway.log 实测样本):
 *   "LLM request failed: network connection error. rawError=Connection error."
 *   "LLM request failed: ... 401 ... Unauthorized"
 *   "Connection error" / "fetch failed" / "ECONNRESET" / "ETIMEDOUT"
 */
function humanizeAgentError(raw: string): string {
  const s = raw.trim();
  const lower = s.toLowerCase();
  if (
    lower.includes("connection error") ||
    lower.includes("network connection") ||
    lower.includes("fetch failed") ||
    lower.includes("econnrefused") ||
    lower.includes("econnreset") ||
    lower.includes("etimedout") ||
    lower.includes("disconnected before secure tls") ||
    lower.includes("enotfound")
  ) {
    return "无法连接到模型服务,请检查网络(VPN / 代理 / 模型 API 是否可达)后重试";
  }
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid api key")) {
    return "模型认证失败,请检查 API Key 是否正确";
  }
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("quota")) {
    return "模型限流或配额已用完,请稍后重试";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "模型响应超时,请稍后重试";
  }
  if (lower.includes("context") && (lower.includes("limit") || lower.includes("overflow"))) {
    return "对话上下文过长,建议新建任务从头开始";
  }
  // DeepSeek V4(Pro 和 Flash 都中招)的 thinking mode 要求 reasoning_content
  // 来回传,OpenClaw 4.12 不支持这套协议;实测加 thinking:disabled 也救不回
  // (#74374),只能等上游修。详见 OpenClaw issue #72915 / #74374。
  if (
    lower.includes("reasoning_content") &&
    lower.includes("thinking mode")
  ) {
    return "DeepSeek V4 系列(Pro / Flash)使用 thinking 协议,OpenClaw 暂不支持。请改用 GLM / qwen / DeepSeek V3 等模型";
  }
  if (
    lower.includes("provider rejected the request schema") ||
    lower.includes("400") && (lower.includes("schema") || lower.includes("tool payload"))
  ) {
    return "模型拒绝了请求格式,可能是该模型对工具调用 / 思考模式有特殊要求,请换一个模型试试";
  }
  // 兜底:截断过长的机器文本,保留首句
  const oneLine = s.replace(/\s+/g, " ");
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine;
}

/**
 * OpenClaw 4.x 实时对话事件处理。事件名 "agent",按 `stream` 字段分派:
 *  - lifecycle.start/end/error  → 消息 streaming 标记
 *  - item.kind=tool.start       → 追加 tool_use block
 *  - item.kind=tool.end         → 合成/替换对应 tool_result block
 *  - command_output.delta/end   → 把 stdout 灌到 tool_result.content(实时看到命令输出)
 *  - assistant.(text=累积)      → 更新最后一个 text block(或追加一个)
 *
 * 用 runId + sessionKey 定位当前这条 streaming assistant message;不存在就新建。
 * item.kind=command 是 item.kind=tool 的执行层子视图,忽略避免重复。
 */
function handleAgentEvent(
  event: GatewayEvent,
  set: (
    partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>),
  ) => void,
  get: () => ChatState,
): void {
  const p = event.payload as
    | {
        runId?: string;
        stream?: string;
        data?: Record<string, unknown>;
        sessionKey?: string;
      }
    | undefined;

  // 无条件打印 payload:先看清所有字段,再谈过滤(前 80 条,之后静默)
  if (__agentDiagCount < 80) {
    __agentDiagCount++;
    const psk = p?.sessionKey ?? "(none)";
    const gsk = get().sessionKey;
    console.log(
      `[AgentEv] #${__agentDiagCount} stream=${p?.stream} payloadSession="${psk}" storeSession="${gsk}"`,
      p?.data,
    );
  }

  if (!p || typeof p !== "object") return;

  // 先尝试 remap(gateway 规范后的 key 回写到 store),再过滤
  if (p.sessionKey) maybeRemapSessionKey(p.sessionKey, set, get);
  // 过滤:不是当前活跃 session 的 agent event 丢弃(跨 session 串扰)
  // 场景:桌面开 main,微信在 claw 上跑 tool call,claw 的 agent event 不该写进 main
  if (p.sessionKey && p.sessionKey !== get().sessionKey) return;

  // L1 cancel:用户已按停止的 runId,丢弃后续所有 agent event
  if (isRunAborted(typeof p.runId === "string" ? p.runId : undefined)) return;

  const runId = typeof p.runId === "string" ? p.runId : "";
  const d = (p.data ?? {}) as Record<string, unknown>;
  const stream = p.stream ?? "";

  const findMsgIdx = (msgs: ChatMessage[]): number => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant" && msgs[i]._runId === runId) return i;
    }
    return -1;
  };

  const withAssistant = (
    mut: (msg: ChatMessage, msgs: ChatMessage[], idx: number) => ChatMessage,
    extra?: Partial<ChatState>,
  ) => {
    set((s) => {
      const msgs = [...s.messages];
      let idx = findMsgIdx(msgs);
      if (idx === -1) {
        msgs.push({
          id: `run-${runId || Date.now()}`,
          _runId: runId,
          role: "assistant",
          content: "",
          blocks: [],
          timestamp: Date.now(),
          streaming: true,
        });
        idx = msgs.length - 1;
      }
      msgs[idx] = mut(msgs[idx], msgs, idx);
      return { messages: msgs, ...(extra ?? {}) };
    });
  };

  switch (stream) {
    case "lifecycle": {
      const phase = typeof d.phase === "string" ? d.phase : "";
      if (phase === "start") {
        withAssistant((m) => m, { loading: true });
      } else if (phase === "end") {
        set((s) => {
          const msgs = [...s.messages];
          const idx = findMsgIdx(msgs);
          if (idx !== -1) msgs[idx] = { ...msgs[idx], streaming: false };
          return { messages: msgs, loading: false };
        });
      } else if (phase === "error") {
        // 之前 phase=error 跟 phase=end 走同一分支,丢了 error 文本和 isError 信号 ——
        // 用户网络抽风时只看到"正在思考"反复消失出现,完全不知道发生了什么。
        // 把错误信息以 ⚠️ 形式注入到当前 assistant message,UI 直接可见。
        // 注意:OpenClaw 内部可能 retry 多次,每次 retry 失败都会发 lifecycle error;
        // 我们覆盖式写到同一条 assistant message 的 content,retry 成功后 final/delta
        // 会用新内容替换,不会污染最终结果。
        const errText = humanizeAgentError(
          (typeof d.error === "string" && d.error) ||
            (typeof d.errorMessage === "string" && d.errorMessage) ||
            "未知错误",
        );
        set((s) => {
          const msgs = [...s.messages];
          const idx = findMsgIdx(msgs);
          const banner = `⚠️ ${errText}`;
          if (idx !== -1) {
            // 已有这个 run 的 assistant 消息(可能含部分 streaming 文本):
            // 在结尾追加 banner,而不是覆盖,保留已 stream 出来的进度
            const cur = msgs[idx];
            const nextContent = cur.content ? `${cur.content}\n\n${banner}` : banner;
            msgs[idx] = { ...cur, streaming: false, content: nextContent };
          } else {
            msgs.push({
              id: `lifecycle-error-${runId || Date.now()}`,
              _runId: runId,
              role: "assistant",
              content: banner,
              timestamp: Date.now(),
            });
          }
          return { messages: msgs, loading: false };
        });
      }
      break;
    }

    case "item": {
      const kind = typeof d.kind === "string" ? d.kind : "";
      if (kind !== "tool") break; // kind=command 是 tool 的执行层子视图,跳过
      const phase = typeof d.phase === "string" ? d.phase : "";
      const toolCallId = typeof d.toolCallId === "string" ? d.toolCallId : "";
      const name = typeof d.name === "string" ? d.name : "tool";
      const meta =
        typeof d.meta === "string"
          ? d.meta
          : typeof d.title === "string"
            ? d.title
            : "";

      if (phase === "start") {
        withAssistant((m) => {
          const blocks = [...(m.blocks ?? [])];
          const already = blocks.some(
            (b) => b.type === "tool_use" && (b as { id?: string }).id === toolCallId,
          );
          if (!already) {
            blocks.push({
              type: "tool_use",
              id: toolCallId || `tool-${Date.now()}`,
              name,
              input: { command: extractCommandFromMeta(meta) || meta },
            });
          }
          return { ...m, blocks };
        });
      } else if (phase === "end") {
        const isError = d.status === "failed" || d.status === "error";
        const summary = typeof d.summary === "string" ? d.summary : "";
        withAssistant((m) => {
          const blocks = [...(m.blocks ?? [])];
          const existingIdx = blocks.findIndex(
            (b) =>
              b.type === "tool_result" &&
              (b as { tool_use_id?: string }).tool_use_id === toolCallId,
          );
          // 如果 command_output 已经填过 content,优先保留长文本;summary 往往是短摘要
          const existingContent =
            existingIdx !== -1
              ? ((blocks[existingIdx] as { content?: unknown }).content as
                  | string
                  | undefined)
              : undefined;
          const content =
            typeof existingContent === "string" && existingContent.length > summary.length
              ? existingContent
              : summary;
          const next: MessageBlock = {
            type: "tool_result",
            tool_use_id: toolCallId,
            content,
            is_error: isError,
          };
          if (existingIdx !== -1) blocks[existingIdx] = next;
          else blocks.push(next);
          return { ...m, blocks };
        });
      }
      break;
    }

    case "command_output": {
      const toolCallId = typeof d.toolCallId === "string" ? d.toolCallId : "";
      const output = typeof d.output === "string" ? d.output : "";
      const phase = typeof d.phase === "string" ? d.phase : "";
      if (!toolCallId) break;
      withAssistant((m) => {
        const blocks = [...(m.blocks ?? [])];
        const existingIdx = blocks.findIndex(
          (b) =>
            b.type === "tool_result" &&
            (b as { tool_use_id?: string }).tool_use_id === toolCallId,
        );
        const existing =
          existingIdx !== -1
            ? (blocks[existingIdx] as Extract<MessageBlock, { type: "tool_result" }>)
            : null;
        const prev = typeof existing?.content === "string" ? existing!.content : "";
        // phase=end 的 output 是完整 stdout;delta 是增量
        const nextContent = phase === "end" ? output || prev : prev + output;
        const next: MessageBlock = {
          type: "tool_result",
          tool_use_id: toolCallId,
          content: nextContent,
          is_error: existing?.is_error,
        };
        if (existingIdx !== -1) blocks[existingIdx] = next;
        else blocks.push(next);
        return { ...m, blocks };
      });
      break;
    }

    case "assistant": {
      const text = typeof d.text === "string" ? d.text : "";
      withAssistant(
        (m) => {
          const blocks = [...(m.blocks ?? [])];
          // 定位最后一个 text block:如果最后一块就是 text,替换;否则追加
          const lastIdx = blocks.length - 1;
          if (lastIdx >= 0 && blocks[lastIdx].type === "text") {
            blocks[lastIdx] = { type: "text", text };
          } else {
            blocks.push({ type: "text", text });
          }
          return { ...m, blocks, content: text };
        },
        { loading: true },
      );
      break;
    }
  }
}

/** "run xxx script, `cd ... && python3 -c ...`" → 取第一段反引号内的命令 */
function extractCommandFromMeta(meta: string): string {
  const m = meta.match(/`([^`]+)`/);
  return m ? m[1] : "";
}

/** 在 messages 末尾向前查找匹配 runId 的 assistant message 的 idx。找不到返回 -1。 */
function findLastIdxByRunId(msgs: ChatMessage[], runId: string): number {
  if (!runId) return -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "assistant" && msgs[i]._runId === runId) return i;
  }
  return -1;
}

/**
 * (已废弃 — 曾经推测走 session.tool channel,实际走 agent/stream=item。函数骨架留作记录。)
 */
function _unusedHandleSessionToolEvent(
  event: GatewayEvent,
  set: (
    partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>),
  ) => void,
  get: () => ChatState,
): void {
  const rawPayload = event.payload as Record<string, unknown> | undefined;
  if (!rawPayload || typeof rawPayload !== "object") return;

  // debug 用:只打印前 3 条,避免控制台刷屏
  logSessionToolSample(rawPayload);

  const p = rawPayload as Record<string, unknown>;

  const sessionKey = pickString(p, [
    "sessionKey",
    "session_key",
    "session",
  ]);
  if (sessionKey && sessionKey !== get().sessionKey) return;

  // 工具调用 id(用于 tool_use ↔ tool_result 配对)
  const toolUseId =
    pickString(p, ["toolUseId", "tool_use_id", "id", "callId", "call_id"]) ??
    // meta.toolUseId 也试一下
    pickString(p.meta as Record<string, unknown> | undefined, [
      "toolUseId",
      "tool_use_id",
      "id",
    ]) ??
    "";

  const toolName =
    pickString(p, ["toolName", "tool", "name"]) ??
    pickString(p.meta as Record<string, unknown> | undefined, [
      "toolName",
      "tool",
      "name",
    ]) ??
    "tool";

  const phaseRaw = pickString(p, ["phase", "status", "state", "type"]) ?? "";
  const phase = normalizeToolPhase(phaseRaw);

  // 合成要往 blocks 数组 push 的 block
  let newBlock: MessageBlock | null = null;
  if (phase === "start") {
    const input =
      (p.input as unknown) ??
      (p.args as unknown) ??
      (p.parameters as unknown) ??
      (typeof p.meta === "object" && p.meta
        ? (p.meta as Record<string, unknown>).input ??
          (p.meta as Record<string, unknown>).args
        : undefined);
    newBlock = {
      type: "tool_use",
      id: toolUseId || `tool-${Date.now()}`,
      name: toolName,
      input,
    };
  } else if (phase === "result" || phase === "error") {
    const content =
      (p.output as unknown) ??
      (p.result as unknown) ??
      (p.content as unknown) ??
      (p.error as unknown) ??
      (typeof p.meta === "object" && p.meta
        ? (p.meta as Record<string, unknown>).output ??
          (p.meta as Record<string, unknown>).result
        : undefined);
    newBlock = {
      type: "tool_result",
      tool_use_id: toolUseId || `tool-${Date.now()}`,
      content,
      is_error: phase === "error",
    };
  }

  if (!newBlock) return;

  // 把 block 挂到最新一条 assistant 消息;如果当前还没有(tool 比 text 先到),
  // 新建一条空 streaming 消息承载(后续 chat delta 到来会合并文本)
  set((s) => {
    const msgs = [...s.messages];
    let targetIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant") {
        targetIdx = i;
        break;
      }
    }
    if (targetIdx === -1) {
      msgs.push({
        id: `tool-${Date.now()}`,
        role: "assistant",
        content: "",
        blocks: [newBlock!],
        timestamp: Date.now(),
        streaming: true,
      });
    } else {
      const t = msgs[targetIdx];
      const blocks = Array.isArray(t.blocks) ? [...t.blocks] : [];
      // 如果是 tool_result,尽量替换掉对应 tool_use_id 已有的占位(避免重复)
      if (newBlock!.type === "tool_result") {
        const tuid = (newBlock as Extract<MessageBlock, { type: "tool_result" }>)
          .tool_use_id;
        const existingIdx = blocks.findIndex(
          (b) => b.type === "tool_result" && (b as Extract<MessageBlock, { type: "tool_result" }>).tool_use_id === tuid,
        );
        if (existingIdx !== -1) blocks[existingIdx] = newBlock!;
        else blocks.push(newBlock!);
      } else {
        blocks.push(newBlock!);
      }
      msgs[targetIdx] = { ...t, blocks };
    }
    return { messages: msgs };
  });
}

/** 尝试按多个 key 从 object 读 string 值,全 miss 返回 undefined */
function pickString(
  obj: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/** 归一化 tool 生命周期阶段:OpenClaw 可能用 started/running/completed/done/failed/error 等多种写法 */
function normalizeToolPhase(s: string): "start" | "result" | "error" | "" {
  const v = s.toLowerCase();
  if (v === "start" || v === "started" || v === "running" || v === "in_progress")
    return "start";
  if (v === "result" || v === "completed" || v === "done" || v === "finished" || v === "success")
    return "result";
  if (v === "error" || v === "failed" || v === "fail" || v === "aborted")
    return "error";
  return "";
}

/** 仅打印前 3 条 session.tool 事件原样结构,用于校准字段名;之后可以把这个函数删掉 */
let __toolSampleCount = 0;
function logSessionToolSample(payload: Record<string, unknown>): void {
  if (__toolSampleCount >= 3) return;
  __toolSampleCount += 1;
  console.log(
    `[ChatStore] session.tool sample #${__toolSampleCount}:`,
    JSON.stringify(payload, null, 2).slice(0, 1200),
  );
}


// HMR 保护:本模块持有 module-level `activeClient` + 在 bind() 里挂事件订阅(chat / agent)。
// 光让 Vite 替换模块会导致:新的 bind() / handleAgentEvent 不会被调用(上游 ResizableShell
// 的 useEffect 不重跑)、activeClient 重置为 null、事件订阅丢失。
// invalidate() 有时也不会真正 full reload(依赖图上游接住了)。最稳的方式是直接 location.reload,
// 让整个 app 重新初始化、gateway 重新连接、bind 重新调用。
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    if (typeof window !== "undefined") window.location.reload();
  });
}
