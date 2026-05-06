import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  BarChart3,
  Briefcase,
  ClipboardList,
  FileText,
  FolderGit2,
  LineChart,
  Mail,
  Newspaper,
  PieChart,
  Presentation,
  Search,
  Settings2,
  Wand2,
} from "lucide-react";
import { useChatStore } from "@/stores/chat-store";
import { useGatewayStore } from "@/stores/gateway-store";
import { useSetupStore } from "@/stores/setup-store";
import { Composer } from "@/components/composer/Composer";
import { MessageList } from "@/components/chat/MessageList";
import { RunStatusBar } from "@/components/chat/RunStatusBar";
import { IconGradient } from "@/components/brand/Logo";
import { cn } from "@/lib/utils";

type Mode = "daily" | "code" | "data";

interface Suggestion {
  icon: LucideIcon;
  title: string;
  subtitle: string;
}

const SUGGESTIONS: Record<Mode, Suggestion[]> = {
  daily: [
    { icon: Mail, title: "每日邮件摘要", subtitle: "过去 24 小时邮件重点" },
    { icon: Briefcase, title: "本周工作周报", subtitle: "汇总 PR / Issue / 会议" },
    { icon: Presentation, title: "做一页幻灯片", subtitle: "用 mhclaw 品牌模板" },
    { icon: ClipboardList, title: "写一份产品需求", subtitle: "按 PRD 模板结构化" },
  ],
  code: [
    { icon: Settings2, title: "配置 MCP 工具", subtitle: "接入 brave-search" },
    { icon: FolderGit2, title: "读取并改写仓库", subtitle: "在本地 workspace 执行" },
    { icon: Search, title: "调研开源方案", subtitle: "对比 Top 3 仓库" },
    { icon: Wand2, title: "把设计转为代码", subtitle: "Figma → React" },
  ],
  data: [
    { icon: LineChart, title: "今日 A 股概况", subtitle: "用 mh_fin 数据" },
    { icon: BarChart3, title: "数据分析", subtitle: "跑一份销售波动" },
    { icon: PieChart, title: "做数据可视化", subtitle: "生成交互图表" },
    { icon: Newspaper, title: "深度研究", subtitle: "多轮搜索 + 报告" },
  ],
};

const MODE_TABS: { id: Mode; label: string }[] = [
  { id: "daily", label: "日常办公" },
  { id: "code", label: "代码开发" },
  { id: "data", label: "数据研究" },
];

export function HomePage() {
  const [mode, setMode] = useState<Mode>("daily");
  const [text, setText] = useState("");
  const [pendingAutoSend, setPendingAutoSend] = useState<string | null>(null);

  const messages = useChatStore((s) => s.messages);
  const loading = useChatStore((s) => s.loading);
  const sendMessage = useChatStore((s) => s.send);
  const historyDiag = useChatStore((s) => s.historyDiag);

  const activeId = useGatewayStore((s) => s.activeId);
  const gateways = useGatewayStore((s) => s.gateways);
  const active = gateways.find((g) => g.id === activeId);
  const connected = active?.status === "connected";

  const needsSetup = useSetupStore((s) => s.needsSetup);
  const openSetup = useSetupStore((s) => s.openDialog);

  const pendingInput = useChatStore((s) => s.pendingInput);
  const clearPendingInput = useChatStore((s) => s.setPendingInput);

  const hasMessages = messages.length > 0;

  // When navigated here from another page, prefill the Composer with
  // the store's `pendingInput`.
  useEffect(() => {
    if (pendingInput) {
      setText(pendingInput);
      clearPendingInput(null);
    }
  }, [pendingInput, clearPendingInput]);

  // Send-time interception: no model configured → stash the text and
  // open the Setup dialog (the input is intentionally NOT cleared).
  const handleSend = async (value: string) => {
    if (needsSetup) {
      setPendingAutoSend(value);
      openSetup();
      return;
    }
    setText("");
    await sendMessage(value);
  };

  // After Setup completes, auto-resend the previously-intercepted
  // message so the user doesn't have to press send again.
  useEffect(() => {
    if (!needsSetup && connected && pendingAutoSend) {
      const value = pendingAutoSend;
      setPendingAutoSend(null);
      setText("");
      void sendMessage(value);
    }
  }, [needsSetup, connected, pendingAutoSend, sendMessage]);

  return (
    <div className="flex h-full flex-col">
      {/* 非阻塞顶部 banner：未配模型时提示 */}
      {needsSetup && (
        <div className="flex items-center justify-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-xs">
          <AlertCircle className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" />
          <span className="text-amber-800 dark:text-amber-300">
            尚未配置 AI 模型，发送消息前需要先配置
          </span>
          <button
            onClick={openSetup}
            className="rounded bg-amber-600/15 px-2 py-0.5 font-medium text-amber-900 transition hover:bg-amber-600/25 dark:text-amber-200"
          >
            立即配置
          </button>
        </div>
      )}

      {hasMessages ? (
        <>
          <MessageList messages={messages} loading={loading} />
          {/* Chat 模式:Composer 钉底部,带 pageB 渐变淡出 */}
          <div
            className="px-6 pb-5 pt-3"
            style={{
              background: `linear-gradient(180deg, transparent, var(--mh-page-b) 30%)`,
            }}
          >
            <div className="mx-auto max-w-3xl">
              <ComposerDeck
                text={text}
                setText={setText}
                connected={connected}
                loading={loading}
                needsSetup={needsSetup}
                pendingAutoSend={pendingAutoSend}
                activeStatus={active?.status}
                onSend={handleSend}
              />
            </div>
          </div>
        </>
      ) : historyDiag &&
        (historyDiag.status === "loading" ||
          historyDiag.status === "empty" ||
          historyDiag.status === "error") ? (
        <>
          <HistoryPlaceholder diag={historyDiag} />
          <div className="px-6 pb-6 pt-2">
            <div className="mx-auto max-w-3xl">
              <ComposerDeck
                text={text}
                setText={setText}
                connected={connected}
                loading={loading}
                needsSetup={needsSetup}
                pendingAutoSend={pendingAutoSend}
                activeStatus={active?.status}
                onSend={handleSend}
              />
            </div>
          </div>
        </>
      ) : (
        // Hero mode: Composer is centered between the title and tabs.
        <Hero
          mode={mode}
          onModeChange={setMode}
          onSuggestion={(s) => setText(s.title + " — " + s.subtitle)}
        >
          <ComposerDeck
            text={text}
            setText={setText}
            connected={connected}
            loading={loading}
            needsSetup={needsSetup}
            pendingAutoSend={pendingAutoSend}
            activeStatus={active?.status}
            onSend={handleSend}
          />
        </Hero>
      )}
    </div>
  );
}

/** Composer plus surrounding banners (gateway-disconnected /
 *  pending / loading status). Single entry point — used by both
 *  home and conversation views. */
function ComposerDeck({
  text,
  setText,
  connected,
  loading,
  needsSetup,
  pendingAutoSend,
  activeStatus,
  onSend,
}: {
  text: string;
  setText: (v: string) => void;
  connected: boolean;
  loading: boolean;
  needsSetup: boolean;
  pendingAutoSend: string | null;
  activeStatus: string | undefined;
  onSend: (value: string) => Promise<void>;
}) {
  return (
    <>
      {!connected && (
        <div className="mb-2 rounded-full bg-amber-50/80 px-3 py-1.5 text-center text-[11px] text-amber-700 ring-1 ring-amber-200/50 backdrop-blur dark:bg-amber-950/30 dark:text-amber-300">
          Gateway 未连接(状态:{activeStatus ?? "无"}),请等待连接完成
        </div>
      )}
      {pendingAutoSend && needsSetup && (
        <div className="mb-2 rounded-full bg-sky-50/80 px-3 py-1.5 text-center text-[11px] text-sky-700 ring-1 ring-sky-200/50 backdrop-blur">
          已保留你的输入,配置完成后会自动发送
        </div>
      )}
      {loading && <RunStatusBar />}
      <Composer
        value={text}
        onValueChange={setText}
        disabled={!connected}
        sending={loading}
        onSend={onSend}
        placeholder="描述一个任务,例如「把昨天的会议纪要整理成周报」…"
      />
    </>
  );
}

/**
 * Shown when switching to a historical session whose messages
 * haven't arrived yet (loading / empty / error). Displays a
 * placeholder + diagnostic info so the UI doesn't feel "clicked but
 * unresponsive" (it used to fall back to the Hero view).
 */
function HistoryPlaceholder({
  diag,
}: {
  diag: NonNullable<ReturnType<typeof useChatStore.getState>["historyDiag"]>;
}) {
  const loadHistory = useChatStore((s) => s.loadHistory);
  const isLoading = diag.status === "loading";
  const isEmpty = diag.status === "empty";
  const isError = diag.status === "error";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-6 py-24 text-center">
        <div
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-full",
            isError
              ? "bg-destructive/10 text-destructive"
              : "bg-muted text-muted-foreground",
          )}
        >
          {isLoading ? (
            <AlertCircle className="h-5 w-5 animate-pulse" />
          ) : isError ? (
            <AlertCircle className="h-5 w-5" />
          ) : (
            <FileText className="h-5 w-5" />
          )}
        </div>
        <div className="text-sm font-medium text-foreground">
          {isLoading
            ? "正在加载历史…"
            : isError
              ? "加载历史失败"
              : "此会话暂无历史"}
        </div>
        {isError && (
          <div className="max-w-md rounded-md bg-destructive/[0.06] px-3 py-2 text-xs text-destructive">
            {diag.error ?? "未知错误"}
          </div>
        )}
        <div className="font-mono text-[10px] text-muted-foreground/60">
          session: {diag.sessionKey} · raw {diag.raw} → pushed {diag.pushed}
        </div>
        {!isLoading && (
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={() => loadHistory()}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              重新加载
            </button>
            <div className="text-xs text-muted-foreground">
              或直接在下方输入开始新对话
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Hero({
  mode,
  onModeChange,
  onSuggestion,
  children,
}: {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  onSuggestion: (s: Suggestion) => void;
  /** Composer deck(banners + Composer) —— 居中嵌入在 hero 标题和 tabs 之间 */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="relative mx-auto flex w-full max-w-[720px] flex-col items-center gap-7 px-10 pb-14 pt-16">
        {/* Hero 标题:品牌 logo(自带 sparkle + cursor + glow) */}
        <div className="relative text-center">
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-28 w-28 -translate-x-1/2 -translate-y-[60%] rounded-full blur-2xl"
            style={{
              background:
                "radial-gradient(circle, color-mix(in oklch, var(--mh-brand) 22%, transparent), transparent 70%)",
            }}
          />
          <IconGradient size={56} className="mx-auto mb-[18px]" />
          <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.03em] text-[var(--mh-text)]">
            今天想把什么变成现实?
          </h1>
          <div className="mt-2 text-[13.5px] tracking-wide text-[var(--mh-text-muted)]">
            输入一个任务 · 选一个模板 · 或让 Claw 接管
          </div>
        </div>

        {/* 主 Composer(居中嵌入) */}
        {children && <div className="w-full">{children}</div>}

        {/* Tabs:日常办公 / 代码开发 / 数据研究 */}
        <div className="flex items-center gap-1 rounded-full p-1">
          {MODE_TABS.map((x) => (
            <button
              key={x.id}
              onClick={() => onModeChange(x.id)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-[12px] font-medium transition",
                mode === x.id
                  ? "bg-[var(--mh-surface-hi)] text-[var(--mh-text)] shadow-[0_1px_2px_rgba(20,14,50,0.06),inset_0_0_0_1px_var(--mh-stroke)]"
                  : "text-[var(--mh-text-subtle)] hover:text-[var(--mh-text)]",
              )}
            >
              {x.label}
            </button>
          ))}
        </div>

        {/* 4 列建议卡片 */}
        <div className="grid w-full grid-cols-4 gap-2.5">
          {SUGGESTIONS[mode].map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.title}
                onClick={() => onSuggestion(s)}
                className="group flex flex-col items-start gap-2.5 rounded-xl bg-[var(--mh-surface)] p-[14px_14px_16px] text-left transition hover:bg-[var(--mh-surface-hi)] hover:shadow-[0_4px_16px_rgba(40,20,100,0.06)]"
                style={{ border: "1px solid var(--mh-stroke)" }}
              >
                <div
                  className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px]"
                  style={{
                    background: "var(--mh-brand-softer)",
                    border: "1px solid var(--mh-brand-line)",
                  }}
                >
                  <Icon
                    className="h-[14px] w-[14px]"
                    strokeWidth={1.6}
                    style={{ color: "var(--mh-brand)" }}
                  />
                </div>
                <div className="w-full">
                  <div className="truncate text-[12.5px] font-medium text-[var(--mh-text)]">
                    {s.title}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-[1.45] text-[var(--mh-text-subtle)]">
                    {s.subtitle}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
