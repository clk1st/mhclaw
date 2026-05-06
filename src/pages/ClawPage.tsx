import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Settings, Smartphone } from "lucide-react";
import {
  SUPPORTED_CHANNELS,
  useChannels,
  type ChannelInfo,
} from "@/hooks/use-channels";
import { ChannelBrand } from "@/components/claw/ChannelBrand";
import { ChannelConfigDialog } from "@/components/claw/ChannelConfigDialog";
import { ClawIntegrationsDialog } from "@/components/claw/ClawIntegrationsDialog";
import { CHANNEL_SCHEMAS } from "@/components/claw/channel-schemas";
import { useChatStore } from "@/stores/chat-store";
import { MessageList } from "@/components/chat/MessageList";
import { Composer } from "@/components/composer/Composer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Claw 主对话固定 sessionKey —— 所有 channel 消息路由到 claw agent,对应 sessionKey */
const CLAW_SESSION_KEY = "agent:claw:main";

export function ClawPage() {
  const { data: allChannels = [], isLoading, error } = useChannels();
  const [openChannelId, setOpenChannelId] = useState<string | null>(null);

  // OpenClaw channels.status 返回所有注册 plugin,这里只保留"已完成配置"的到顶部 section
  const configured = allChannels.filter((c) => c.configured);
  const configuredById = new Map(allChannels.map((c) => [c.id, c] as const));
  // 我们的 catalog 中文名作 label 的覆盖层(OpenClaw 给的 label 可能是英文或空)
  const displayNameById = new Map(SUPPORTED_CHANNELS.map((c) => [c.id, c.name] as const));

  // 两态:有已配置 channel → 主对话面;否则保留配置列表
  if (configured.length > 0) {
    return (
      <ClawChatView
        configured={configured}
        allChannels={allChannels}
        displayNameById={displayNameById}
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="px-6 pb-4 pt-2">
        <h1 className="text-[22px] font-semibold tracking-tight">Claw</h1>
        <p className="mt-0.5 text-[12px] text-foreground/55">
          远程触发 · 把 mhclaw 接入即时通讯渠道，从手机或客户端直接调用本地 Agent
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* 已配置渠道 */}
        <section>
          <div className="flex items-center justify-between pb-3">
            <h2 className="text-sm font-semibold">已配置渠道</h2>
            <span className="text-xs text-muted-foreground">
              {configured.length} 个
            </span>
          </div>

          {isLoading && configured.length === 0 ? (
            <Loading />
          ) : error ? (
            <ErrorHint message={(error as Error).message} />
          ) : configured.length === 0 ? (
            <EmptyHint />
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {configured.map((ch) => (
                <ConfiguredChannelCard
                  key={ch.id}
                  ch={ch}
                  displayName={displayNameById.get(ch.id)}
                />
              ))}
            </div>
          )}
        </section>

        {/* 支持的渠道 */}
        <section className="mt-8">
          <div className="flex items-center justify-between pb-3">
            <h2 className="text-sm font-semibold">支持的渠道</h2>
            <span className="text-xs text-muted-foreground">
              共 {SUPPORTED_CHANNELS.length} 种
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {SUPPORTED_CHANNELS.map((c) => {
              const runtime = configuredById.get(c.id);
              return (
                <SupportedChannelCard
                  key={c.id}
                  channel={c}
                  installed={!!runtime?.configured}
                  running={!!runtime?.running}
                  configurable={c.id in CHANNEL_SCHEMAS}
                  onClick={() =>
                    c.id in CHANNEL_SCHEMAS && setOpenChannelId(c.id)
                  }
                />
              );
            })}
          </div>
        </section>
      </div>

      <ChannelConfigDialog
        channelId={openChannelId}
        onOpenChange={(o) => !o && setOpenChannelId(null)}
      />
    </div>
  );
}

function ConfiguredChannelCard({
  ch,
  displayName,
}: {
  ch: ChannelInfo;
  displayName?: string;
}) {
  const statusLabel = ch.running
    ? "运行中"
    : ch.configured
    ? "已配置"
    : "未配置";
  const statusTone = ch.running
    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    : ch.configured
    ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
    : "bg-muted text-muted-foreground";
  return (
    <div className="flex items-center justify-between rounded-2xl bg-white/60 p-3 ring-1 ring-black/[0.05] backdrop-blur transition hover:bg-white hover:ring-black/15 dark:bg-white/[0.04] dark:ring-white/[0.06] dark:hover:bg-white/[0.08] dark:hover:ring-white/15">
      <div className="flex min-w-0 items-center gap-3">
        <ChannelBrand id={ch.id} size={32} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {displayName || ch.label || ch.type || ch.id}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {ch.accounts?.length ? `${ch.accounts.length} 个账号` : ch.id}
          </div>
        </div>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[11px] flex items-center gap-1",
          statusTone,
        )}
      >
        {ch.running && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
        {statusLabel}
      </span>
    </div>
  );
}

function SupportedChannelCard({
  channel,
  installed,
  running,
  configurable,
  onClick,
}: {
  channel: (typeof SUPPORTED_CHANNELS)[number];
  installed: boolean;
  running: boolean;
  configurable: boolean;
  onClick: () => void;
}) {
  const Tag = configurable ? "button" : "div";
  return (
    <Tag
      type={configurable ? "button" : undefined}
      onClick={configurable ? onClick : undefined}
      className={cn(
        "flex items-start gap-3 rounded-2xl bg-white/60 p-3 text-left ring-1 ring-black/[0.05] backdrop-blur transition dark:bg-white/[0.04] dark:ring-white/[0.06]",
        configurable
          ? "cursor-pointer hover:bg-white hover:ring-black/15 hover:shadow-[0_2px_8px_rgba(15,23,42,0.06)] dark:hover:bg-white/[0.08] dark:hover:ring-white/15"
          : "opacity-60",
        running && "ring-emerald-500/30 dark:ring-emerald-400/25",
      )}
    >
      <ChannelBrand id={channel.id} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{channel.name}</span>
          {running ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              运行中
            </span>
          ) : installed ? (
            <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-600" />
          ) : null}
          {!configurable && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              即将支持
            </span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
          {channel.brief}
        </p>
      </div>
    </Tag>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      加载中…
    </div>
  );
}

function ErrorHint({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      加载失败：{message}
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="rounded-2xl border border-dashed border-black/[0.08] bg-white/40 px-6 py-10 text-center backdrop-blur dark:border-white/[0.08] dark:bg-white/[0.02]">
      <Smartphone className="mx-auto h-8 w-8 text-muted-foreground/50" />
      <p className="mt-3 text-sm text-muted-foreground">还没有配置任何渠道</p>
      <p className="mt-1 text-xs text-muted-foreground/70">
        在 <code className="rounded bg-muted px-1">~/.mhclaw/mhclaw.json</code>{" "}
        的 <code className="rounded bg-muted px-1">channels.&lt;name&gt;</code>{" "}
        中配置 bot token；可视化配置 UI 在路上
      </p>
    </div>
  );
}

/**
 * Claw 主对话面 —— 固定 sessionKey = agent:claw:main,展示所有 channel 汇入的聊天。
 * 进入时切到 CLAW session,离开时切回原 session(避免污染 HomePage 当前任务视图)。
 */
function ClawChatView({
  configured,
  allChannels,
  displayNameById,
}: {
  configured: ChannelInfo[];
  allChannels: ChannelInfo[];
  displayNameById: Map<string, string>;
}) {
  const messages = useChatStore((s) => s.messages);
  const loading = useChatStore((s) => s.loading);
  const sendMessage = useChatStore((s) => s.send);
  const switchSession = useChatStore((s) => s.switchSession);
  const [text, setText] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 进入 Claw 页固定切到 claw 主会话;离开时切回之前的 key(避免和 HomePage 任务串)
  useEffect(() => {
    const prevKey = useChatStore.getState().sessionKey;
    void switchSession(CLAW_SESSION_KEY);
    return () => {
      if (prevKey && prevKey !== CLAW_SESSION_KEY) {
        void switchSession(prevKey);
      }
    };
  }, [switchSession]);

  const handleSend = async (v: string) => {
    setText("");
    await sendMessage(v);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 顶部:Claw 标题 + 已连 channel 徽章 + 设置入口 */}
      <div className="flex items-center justify-between gap-4 border-b border-black/[0.05] px-6 py-3 dark:border-white/[0.06]">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-sm text-muted-foreground">已连接：</span>
          <div className="flex items-center gap-2">
            {configured.map((ch) => (
              <div
                key={ch.id}
                className="flex items-center gap-1.5 rounded-full bg-white/70 px-2 py-1 text-xs ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:ring-white/[0.06]"
                title={ch.running ? "运行中" : "已配置"}
              >
                <ChannelBrand id={ch.id} size={16} />
                <span className="font-medium">
                  {displayNameById.get(ch.id) || ch.label || ch.id}
                </span>
                {ch.running && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                )}
              </div>
            ))}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setSettingsOpen(true)}
          title="管理集成"
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* 聊天区 */}
      <div className="flex min-h-0 flex-1 flex-col">
        {messages.length > 0 ? (
          <MessageList messages={messages} loading={loading} />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <div className="max-w-md">
              <Smartphone className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-3 text-sm text-muted-foreground">
                Claw 主对话
              </p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                从已连接的渠道(微信 / 企微 / 钉钉)发来的消息都会汇入这里,
                <br />
                你也可以直接在下方对 Claw 说话
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="px-6 pb-6 pt-2">
        <div className="mx-auto max-w-3xl">
          <Composer
            value={text}
            onValueChange={setText}
            sending={loading}
            onSend={handleSend}
            placeholder="对 Claw 说话 · 你在这里发的消息也会让 AI 回到所有绑定渠道"
          />
        </div>
      </div>

      <ClawIntegrationsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        channels={allChannels}
      />
    </div>
  );
}
