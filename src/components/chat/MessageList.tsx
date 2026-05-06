import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertCircle, ExternalLink, Hammer, Loader2 } from "lucide-react";
import { IconBadge } from "@/components/brand/Logo";
import type { ChatMessage, MessageBlock } from "@/types/gateway";
import { parseEmbeds, type EmbedInfo } from "@/lib/embed";
import { stripMarkers } from "@/lib/markers";
import {
  classifySystemMessage,
  extractBannerText,
} from "@/lib/system-message";
import { markdownLinkComponents } from "@/lib/markdown-components";
import { useChatStore } from "@/stores/chat-store";
import { usePreviewStore } from "@/stores/preview-store";
import { useAddArtifacts } from "@/hooks/use-artifacts";
import { useSkills } from "@/hooks/use-skills";
import {
  usePreviewAvailability,
  describeStatus,
  type PreviewStatus,
} from "@/lib/preview-availability";
import { cn } from "@/lib/utils";
import { ToolCallGroup } from "./ToolCallGroup";

interface MessageListProps {
  messages: ChatMessage[];
  loading?: boolean;
}

/**
 * 消息列表(对标 WorkBuddy):
 *
 * 渲染粒度不是"一条 message 一个气泡",而是按**对话 turn** 聚合:
 *   - 一次用户输入(真实 user message)
 *   - 之后所有 agent 过程(中间 text "让我换个方式..." + tool_use/tool_result + 夹着的伪 user tool_result)
 *     → 收进**单个** `ToolCallGroup`,顶部"N 个工具调用 · M 条过程消息"折叠
 *   - 最后一条纯 text assistant(最终答案)独立 markdown 展示
 *
 * 这样即使 OpenClaw 把一个 run 拆成多条 message 推过来,UI 也能把它们聚回一个 turn。
 */
export function MessageList({ messages, loading }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => buildRenderItems(messages), [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  // 找最后一个 turn 的序号,loading 态只给它加"streaming indicator"
  const lastTurnIndex = (() => {
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].kind === "turn") return i;
    }
    return -1;
  })();

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-6">
        {items.map((item, i) => {
          if (item.kind === "banner") {
            return <SystemBanner key={`banner-${i}`} text={item.text} />;
          }
          return (
            <TurnView
              key={`turn-${i}`}
              turn={item.turn}
              isLastAndLoading={!!loading && i === lastTurnIndex}
            />
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

/**
 * 把 messages 展开成渲染项数组:
 * - 真实 user/assistant 消息按原 groupTurns 逻辑聚成 Turn
 * - OpenClaw heartbeat-runner 注入的伪 user 消息:
 *   - "drop" 类 → 跳过(HEARTBEAT 指令 / doctor 命令 / 注入 context)
 *   - "banner" 类 → 转成 SystemBanner 项(config-patch ok / 已添加 xxx)
 *
 * banner 插在原消息的位置,不破坏时序。
 */
type RenderItem =
  | { kind: "turn"; turn: Turn }
  | { kind: "banner"; text: string };

function buildRenderItems(messages: ChatMessage[]): RenderItem[] {
  const items: RenderItem[] = [];
  let buffer: ChatMessage[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    const turns = groupTurns(buffer);
    for (const t of turns) items.push({ kind: "turn", turn: t });
    buffer = [];
  };

  for (const msg of messages) {
    if (msg.role !== "user") {
      buffer.push(msg);
      continue;
    }
    const kind = classifySystemMessage(msg.content ?? "");
    if (kind === "user") {
      buffer.push(msg);
    } else if (kind === "banner") {
      const text = extractBannerText(msg.content ?? "");
      flush();
      if (text) items.push({ kind: "banner", text });
    }
    // "drop" 跳过,什么都不做
  }
  flush();
  return items;
}

/**
 * 居中单行灰色横幅 —— 系统事件反馈(gateway 重启 / 配置更新 / MCP 添加等),
 * 跟 user/assistant 气泡视觉完全区分。两侧横线包裹,强调"这不是谁说的话,
 * 是系统发生的事"。
 */
function SystemBanner({ text }: { text: string }) {
  return (
    <div className="my-1 flex items-center gap-3 px-4 text-[11px] text-muted-foreground/80">
      <div className="h-px flex-1 bg-border/50" />
      <span className="shrink-0 max-w-[70%] truncate" title={text}>
        {text}
      </span>
      <div className="h-px flex-1 bg-border/50" />
    </div>
  );
}


/**
 * 一个对话 turn:
 * - userMsg 可能为 null(load history 时首条就是 assistant 的边界情况)
 * - processBlocks:过程区所有 block(tool_use / tool_result / thinking / 中间 text)
 * - finalBlocks:最终答案的 text block(一段或多段,turn 末尾连续的纯 text)
 * - finalRef:取最终答案的元信息(streaming / id / 用于 embed 解析的 content)的来源 message
 * 注意:按 **block** 分类而不是按 message 分类 —— OpenClaw 有时把 text + toolCall
 *      塞在同一条 message 的 content 里,按 message 归类会连 text 一起吃掉。
 */
interface Turn {
  userMsg: ChatMessage | null;
  processBlocks: MessageBlock[];
  finalBlocks: Extract<MessageBlock, { type: "text" }>[];
  finalRef: ChatMessage | null;
  /** turn 是否仍在流式进行中(最后一条 assistant 还 streaming=true) */
  isStreaming: boolean;
}

function groupTurns(messages: ChatMessage[]): Turn[] {
  interface Pending {
    userMsg: ChatMessage | null;
    assistantMsgs: ChatMessage[];
    toolResultMsgs: ChatMessage[];
  }
  const pendings: Pending[] = [];
  let current: Pending | null = null;

  for (const msg of messages) {
    if (msg.role === "user") {
      const blocks = msg.blocks ?? [];
      const onlyToolResult =
        blocks.length > 0 && blocks.every((b) => b.type === "tool_result");
      if (onlyToolResult) {
        if (!current)
          current = { userMsg: null, assistantMsgs: [], toolResultMsgs: [] };
        current.toolResultMsgs.push(msg);
        continue;
      }
      if (current) pendings.push(current);
      current = { userMsg: msg, assistantMsgs: [], toolResultMsgs: [] };
    } else if (msg.role === "assistant") {
      if (!current)
        current = { userMsg: null, assistantMsgs: [], toolResultMsgs: [] };
      current.assistantMsgs.push(msg);
    }
  }
  if (current) pendings.push(current);

  return pendings.map(buildTurn);
}

function buildTurn(p: {
  userMsg: ChatMessage | null;
  assistantMsgs: ChatMessage[];
  toolResultMsgs: ChatMessage[];
}): Turn {
  // 收集 turn 内所有 assistant blocks,保持顺序
  const allBlocks: MessageBlock[] = [];
  for (const m of p.assistantMsgs) {
    for (const b of m.blocks ?? []) allBlocks.push(b);
  }
  // 把伪 user 的 tool_result 也放进过程(ToolCallGroup 按 tool_use_id 配对)
  for (const m of p.toolResultMsgs) {
    for (const b of m.blocks ?? []) allBlocks.push(b);
  }

  // 从 assistantMsgs 按顺序放 allBlocks(上面已放),伪 user tool_result 放在最后
  // tool_use ↔ tool_result 配对不依赖顺序,依赖 tool_use_id,所以 OK

  // 从末尾向前扫 assistantBlocks,text 和 thinking 都"透明"(可穿过),
  // 碰到 tool_use / tool_result 才停。透明区里的 text 是 final,其余(thinking)归 process。
  // 理由:OpenClaw 里 thinking 可能出现在 text 之前或之后,如果只挑"最后连续 text",
  //      thinking 夹在中间会把 text 挡进 process,用户看不到 AI 的文字回复。
  const assistantBlocks: MessageBlock[] = [];
  for (const m of p.assistantMsgs) {
    for (const b of m.blocks ?? []) assistantBlocks.push(b);
  }
  let transparentStart = assistantBlocks.length;
  while (transparentStart > 0) {
    const b = assistantBlocks[transparentStart - 1];
    if (b.type === "text" || b.type === "thinking") {
      transparentStart--;
      continue;
    }
    break;
  }

  // 透明区里,text = final,thinking = process
  const transparentTail = assistantBlocks.slice(transparentStart);
  const finalBlocks = transparentTail.filter(
    (b): b is Extract<MessageBlock, { type: "text" }> => b.type === "text",
  );
  const thinkingFromTail = transparentTail.filter((b) => b.type !== "text");

  // process = 透明区之前的所有 block + 透明区里的 thinking + 所有伪 user tool_result
  const processBlocks: MessageBlock[] = [
    ...assistantBlocks.slice(0, transparentStart),
    ...thinkingFromTail,
    ...p.toolResultMsgs.flatMap((m) => m.blocks ?? []),
  ];

  // 如果最后一条 assistant 还 streaming,且我们挑出的 finalBlocks 为空,
  // 说明模型还没开始吐最终文字(可能还在跑工具)。保持 finalBlocks 为空,
  // 此时 ToolCallGroup 会渲染进度;等 final text delta 到来会自然切换。
  const lastAssistant = p.assistantMsgs[p.assistantMsgs.length - 1] ?? null;

  return {
    userMsg: p.userMsg,
    processBlocks,
    finalBlocks,
    finalRef: lastAssistant,
    isStreaming: !!lastAssistant?.streaming,
  };
}

function TurnView({
  turn,
  isLastAndLoading,
}: {
  turn: Turn;
  isLastAndLoading: boolean;
}) {
  const hasFinal = turn.finalBlocks.length > 0;
  const hasProcess = turn.processBlocks.length > 0;
  // agent 还没吐出任何 process/final 前的黑盒等待态,用"正在思考…"占位。
  // 跟 ToolCallGroup 的 header 共用同一行 DOM,切换时只换文字,不 layout jump。
  const showThinking = isLastAndLoading && !!turn.userMsg && !hasProcess && !hasFinal;
  return (
    <>
      {turn.userMsg && <UserBubble msg={turn.userMsg} />}
      {showThinking && <ThinkingIndicator />}
      {hasProcess && (
        <ProcessBlocks
          blocks={turn.processBlocks}
          isStreaming={turn.isStreaming}
        />
      )}
      {hasFinal && turn.finalRef && (
        <AssistantFinal blocks={turn.finalBlocks} ref_={turn.finalRef} />
      )}
    </>
  );
}

/**
 * "正在思考…" 占位 —— DOM 结构与 ToolCallGroup 的 streaming header 完全一致,
 * 保证切换到"正在执行 · xxx"时只改文字,没有高度/边距跳动。
 */
function ThinkingIndicator() {
  return (
    <div className="my-2 w-full">
      <div className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs text-primary">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>正在思考…</span>
      </div>
    </div>
  );
}

function UserBubble({ msg }: { msg: ChatMessage }) {
  const stripped = stripMarkers(msg.content);
  // stripMarkers 剥掉 [output_dir:] / [Plan mode] 等 marker 后,可能在前后留下空行,
  // 气泡里会出现肉眼可见的多余空行。trim 掉。
  const text = (stripped.visibleText || msg.content).trim();
  return (
    <div
      id={`msg-${msg.id}`}
      className="flex flex-col items-end gap-1.5 scroll-mt-24 rounded-xl"
    >
      {msg.selectedSkills && msg.selectedSkills.length > 0 && (
        <UserSelectedSkillChips skillKeys={msg.selectedSkills} />
      )}
      <div
        className="max-w-[480px] whitespace-pre-wrap break-words rounded-[14px] px-3.5 py-2.5 text-[14px] leading-[1.55]"
        style={{
          background: "var(--mh-brand-soft)",
          border: "1px solid var(--mh-brand-line)",
          color: "var(--mh-text)",
        }}
      >
        {text}
      </div>
    </div>
  );
}

/** 展示"发送该条消息时勾选的 skill"—— 跟 Composer chip 同视觉 */
function UserSelectedSkillChips({ skillKeys }: { skillKeys: string[] }) {
  const { data } = useSkills();
  const byKey = new Map((data?.skills ?? []).map((s) => [s.skillKey, s]));
  return (
    <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
      {skillKeys.map((k) => {
        const s = byKey.get(k);
        const name = s?.name ?? k;
        const emoji = s?.emoji;
        return (
          <span
            key={k}
            title={s?.description || name}
            className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs text-foreground"
          >
            {emoji ? (
              <span className="leading-none">{emoji}</span>
            ) : (
              <Hammer className="h-3 w-3 text-primary" />
            )}
            <span className="max-w-[160px] truncate">{name}</span>
          </span>
        );
      })}
    </div>
  );
}

/** 过程区:turn 内所有 tool_use / tool_result / thinking / 中间 text 的集合 */
function ProcessBlocks({
  blocks,
  isStreaming,
}: {
  blocks: MessageBlock[];
  isStreaming: boolean;
}) {
  return (
    <div className="w-full max-w-[85%]">
      <ToolCallGroup blocks={blocks} isStreaming={isStreaming} />
    </div>
  );
}

/**
 * 最终答案:turn 末尾连续的 text block 拼接后 markdown 渲染。
 * embed 解析用 final text(拼接后)。
 */
function AssistantFinal({
  blocks,
  ref_,
}: {
  blocks: Extract<MessageBlock, { type: "text" }>[];
  ref_: ChatMessage;
}) {
  const sessionKey = useChatStore((s) => s.sessionKey);
  const openPreview = usePreviewStore((s) => s.openPreviewFromEmbed);
  const addArtifacts = useAddArtifacts();

  const rawText = blocks.map((b) => (typeof b.text === "string" ? b.text : "")).join("\n\n");
  const stripped = stripMarkers(rawText);
  const embeds = stripped.embeds;

  // 消息定稿后(非 streaming),把 [embed] 落到 <task-folder>/.mhclaw/artifacts.json。
  // 这是产物的唯一持久化触发点 —— 主进程做去重 + ensure task folder。
  useEffect(() => {
    if (ref_.streaming) return;
    if (!sessionKey) return;
    const { embeds: parsed } = parseEmbeds(rawText);
    if (parsed.length === 0) return;
    addArtifacts.mutate({ sessionKey, entries: parsed });
    // addArtifacts 的 mutate 引用稳定,不放进依赖(否则每轮创建新 mutation 触发无限循环)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref_.streaming, rawText, sessionKey]);

  return (
    <div
      id={`msg-${ref_.id}`}
      className="flex items-start gap-2.5 scroll-mt-24"
    >
      <AssistantAvatar />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="w-full text-[14px] leading-[1.7]" style={{ color: "var(--mh-text)" }}>
          <MarkdownBody source={stripped.visibleText} />
          {ref_.streaming && (
            <span
              className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse align-middle"
              style={{ background: "var(--mh-brand)" }}
            />
          )}
        </div>
        {embeds.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {embeds.map((e, i) => (
              <EmbedButton
                key={e.ref || e.url || i}
                embed={e}
                runActive={!!ref_.streaming}
                onOpen={() => openPreview(e)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** M logo 头像 —— 用在 assistant 消息左侧。24px 保留 cursor,无 sparkle,跟消息密度匹配 */
function AssistantAvatar() {
  return <IconBadge size={24} variant="gradient" className="mt-0.5" />;
}

/**
 * 助手消息的 Markdown 渲染:
 * - GFM(表格 / 删除线 / 任务列表 / 自动链接)
 * - 用 Tailwind 后代选择器给 markdown 输出的原生元素套样式,
 *   不通过 components 覆写(react-markdown v10 的 components 类型跟 v9 有 diff,
 *   直接 class 后代选择器最稳,出不了运行时错)
 */
function MarkdownBody({ source }: { source: string }) {
  return (
    <div className="chat-md py-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownLinkComponents}>{source}</ReactMarkdown>
    </div>
  );
}

/**
 * 4 态 embed 按钮:
 *  - pending    灰,禁用,"等待生成"
 *  - generating 脉动灰,禁用,"生成中"
 *  - ready      正常白,可点"打开预览"
 *  - error      红底浅,可点(点了也走兜底再 probe 一次),显示原因
 *
 * 点击时做兜底校验:即使 UI 显示 ready,也会同步 re-probe 一次 ——
 * 文件可能刚被删、权限失效、CDN 掉线等。UI 态永远有滞后窗口,不能只信它。
 */
function EmbedButton({
  embed,
  runActive,
  onOpen,
}: {
  embed: EmbedInfo;
  runActive: boolean;
  onOpen: () => void;
}) {
  const label = embed.title || embed.ref || "打开预览";
  const url = embed.url ?? "";
  const { status, refetch } = usePreviewAvailability(url, { runActive });

  const handleClick = async () => {
    // 点击兜底:同步 probe 一次,以最新为准
    const fresh = await refetch();
    if (fresh.kind === "ready") {
      onOpen();
      return;
    }
    // 没就绪:用户点击也给清晰反馈,不默默吞掉
    if (fresh.kind === "pending" || fresh.kind === "generating") {
      toast.info("文件还在生成中,稍等再试");
    } else {
      // 识别"文件未生成"这类常见场景,给人话而不是 HTTP 404
      const reason = String(fresh.reason ?? "");
      if (/文件未生成|未生成|ENOENT|404|not.?found|no such file/i.test(reason)) {
        toast.error("文件未生成", {
          description: "AI 可能还没调用写入工具,可以让它把内容保存成文件后再试",
        });
      } else {
        toast.error(`无法打开预览:${reason}`);
      }
    }
  };

  const visual = statusVisual(status);
  const disabled = visual.disabled;

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      title={describeStatus(status)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ring-1 backdrop-blur transition",
        visual.className,
      )}
    >
      {visual.icon}
      <span>
        {visual.label} · {label}
      </span>
    </button>
  );
}

function statusVisual(status: PreviewStatus): {
  label: string;
  icon: React.ReactNode;
  className: string;
  disabled: boolean;
} {
  switch (status.kind) {
    case "pending":
      return {
        label: "等待生成",
        icon: <Loader2 className="h-3 w-3 text-foreground/35" />,
        className:
          "bg-muted/50 ring-black/[0.04] text-foreground/50 cursor-not-allowed dark:bg-white/[0.03] dark:ring-white/[0.04]",
        disabled: true,
      };
    case "generating":
      return {
        label: "生成中",
        icon: <Loader2 className="h-3 w-3 animate-spin text-foreground/55" />,
        className:
          "bg-amber-50/60 ring-amber-500/15 text-foreground/70 cursor-progress dark:bg-amber-500/[0.08] dark:ring-amber-400/20",
        disabled: true,
      };
    case "ready":
      return {
        label: "打开预览",
        icon: <ExternalLink className="h-3 w-3 text-foreground/55" />,
        className:
          "bg-white/70 ring-black/[0.05] hover:bg-white hover:ring-black/15 hover:shadow-[0_2px_8px_rgba(15,23,42,0.06)] dark:bg-white/[0.06] dark:ring-white/[0.06] dark:hover:bg-white/[0.1] dark:hover:ring-white/15",
        disabled: false,
      };
    case "error": {
      // 区分"文件未生成"(AI 没写成)vs 真 error —— 前者是常见场景,
      // AI 可能只是问了要不要保存没真写,用户看 "HTTP 404" 是懵的。
      const reason = String(status.reason ?? "");
      const notGenerated =
        /文件未生成|未生成|ENOENT|404|not.?found|no such file/i.test(reason);
      return {
        label: notGenerated ? "文件未生成" : "预览失败",
        icon: <AlertCircle className="h-3 w-3 text-destructive/70" />,
        className:
          "bg-destructive/5 ring-destructive/20 text-destructive/85 hover:bg-destructive/10",
        disabled: false,
      };
    }
  }
}
