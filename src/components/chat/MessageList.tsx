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
 * Message list (modeled after WorkBuddy).
 *
 * Render granularity isn't "one message per bubble" — instead we
 * aggregate by **conversation turn**:
 *   - One user input (a real user message)
 *   - Followed by every agent step in between: interstitial text
 *     (e.g. "let me try a different approach..."), tool_use /
 *     tool_result calls, and the synthetic user tool_result messages
 *     OpenClaw injects → all collapsed into a single `ToolCallGroup`
 *     with a header like "N tool calls · M intermediate messages".
 *   - The final pure-text assistant message (the final answer) is
 *     rendered as standalone markdown.
 *
 * Even when OpenClaw splits a single run across multiple messages, the
 * UI re-groups them back into one logical turn.
 */
export function MessageList({ messages, loading }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => buildRenderItems(messages), [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  // Index of the last turn — only this one gets the "streaming
  // indicator" decoration while loading=true.
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
 * Expand the message list into render items:
 *   - Real user/assistant messages go through `groupTurns` as before.
 *   - Synthetic user messages injected by OpenClaw's heartbeat-runner:
 *       - "drop"   → skip entirely (HEARTBEAT directives / doctor
 *                    commands / context injections)
 *       - "banner" → render as a SystemBanner item (e.g. config-patch
 *                    ack / "added X" notifications)
 *
 * Banner items are inserted at the original message position so the
 * chronological order is preserved.
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
    // "drop" — skip entirely.
  }
  flush();
  return items;
}

/**
 * Centered single-line gray banner — for system event feedback
 * (gateway restart / config update / MCP added / etc). Visually
 * distinct from user/assistant bubbles. Wrapped by horizontal rules
 * on both sides to emphasize "this is not someone speaking — this is
 * something the system did".
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
 * One conversation turn.
 *   - `userMsg` may be null (edge case: when loadHistory's first
 *     message is already from the assistant).
 *   - `processBlocks` — all "process area" blocks: tool_use,
 *     tool_result, thinking, interstitial text.
 *   - `finalBlocks` — the final answer's text blocks (one or more
 *     consecutive pure-text blocks at the end of the turn).
 *   - `finalRef` — the source message used for the final answer's
 *     metadata (streaming flag, id, embed-resolve content, etc.).
 *
 * IMPORTANT: classification is done per-**block**, not per-message.
 * OpenClaw sometimes packs text and toolCall into the same message's
 * `content`; classifying by message would swallow the text along
 * with the tool call.
 */
interface Turn {
  userMsg: ChatMessage | null;
  processBlocks: MessageBlock[];
  finalBlocks: Extract<MessageBlock, { type: "text" }>[];
  finalRef: ChatMessage | null;
  /** Is the turn still streaming (last assistant has streaming=true)? */
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
  // Collect every assistant block within the turn, preserving order.
  const allBlocks: MessageBlock[] = [];
  for (const m of p.assistantMsgs) {
    for (const b of m.blocks ?? []) allBlocks.push(b);
  }
  // Synthetic user tool_results also go into the process area
  // (ToolCallGroup pairs them with tool_use by tool_use_id).
  for (const m of p.toolResultMsgs) {
    for (const b of m.blocks ?? []) allBlocks.push(b);
  }

  // Order: assistant blocks first (added above), tool_results last.
  // tool_use ↔ tool_result pairing is keyed by tool_use_id, not
  // sequence, so this is fine.

  // Walk assistantBlocks back-to-front. `text` and `thinking` are
  // "transparent" (we keep walking through them); we stop at
  // `tool_use` / `tool_result`. In the resulting transparent tail,
  // text counts as final and thinking belongs to process.
  // Why: OpenClaw can emit `thinking` before OR after the text. If we
  // naively grabbed only the trailing consecutive text, a thinking
  // block sandwiched in the middle would push earlier text into the
  // process area — and the user would lose sight of the AI's reply.
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

  // Inside the transparent tail: text → final, thinking → process.
  const transparentTail = assistantBlocks.slice(transparentStart);
  const finalBlocks = transparentTail.filter(
    (b): b is Extract<MessageBlock, { type: "text" }> => b.type === "text",
  );
  const thinkingFromTail = transparentTail.filter((b) => b.type !== "text");

  // Process = (everything before the transparent tail) +
  // (thinking blocks within the tail) + (all synthetic
  // user tool_results).
  const processBlocks: MessageBlock[] = [
    ...assistantBlocks.slice(0, transparentStart),
    ...thinkingFromTail,
    ...p.toolResultMsgs.flatMap((m) => m.blocks ?? []),
  ];

  // If the last assistant is still streaming and finalBlocks turned up
  // empty, the model hasn't started emitting its final text yet (may
  // still be running tools). Leave finalBlocks empty — ToolCallGroup
  // renders progress instead, and the UI will switch over naturally
  // when the first text delta arrives.
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
  // Black-box wait state — agent hasn't emitted any process / final
  // content yet. Show a "thinking…" placeholder. The DOM structure
  // matches ToolCallGroup's streaming header, so switching to
  // "executing · xxx" only changes text, never causes layout shift.
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
 * "Thinking..." placeholder. DOM matches ToolCallGroup's streaming
 * header exactly so switching to "Executing · xxx" only changes
 * text — no height/margin jump.
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
  // After stripMarkers removes [output_dir:] / [Plan mode] etc., the
  // surrounding blank lines can leak into the bubble as visible
  // whitespace. Trim them.
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

/** Render the skills that were selected when this message was sent —
 *  visually identical to the Composer's skill chip. */
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

/** Process area: every tool_use / tool_result / thinking / interstitial text in the turn. */
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
 * Final answer: concatenate the trailing text blocks and render as
 * markdown. Embed parsing operates on the joined final text.
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

  // Once the message is finalized (no longer streaming), persist any
  // [embed]s to <task-folder>/.mhclaw/artifacts.json. This is the
  // ONE place artifacts get persisted — the main process handles
  // dedup + ensures the task folder exists.
  useEffect(() => {
    if (ref_.streaming) return;
    if (!sessionKey) return;
    const { embeds: parsed } = parseEmbeds(rawText);
    if (parsed.length === 0) return;
    addArtifacts.mutate({ sessionKey, entries: parsed });
    // `addArtifacts.mutate` has a stable reference; leaving it out of
    // the dep array on purpose (including it would create a new
    // mutation each tick → infinite loop).
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

/** M-logo avatar — shown to the left of assistant messages. 24px,
 *  cursor preserved, no sparkle: matches the chat message density. */
function AssistantAvatar() {
  return <IconBadge size={24} variant="gradient" className="mt-0.5" />;
}

/**
 * Markdown rendering for assistant messages:
 *   - GFM (tables, strikethrough, task lists, autolinks)
 *   - Style markdown output via Tailwind descendant selectors on the
 *     emitted native elements, not via the `components` override —
 *     react-markdown v10's `components` type diverges from v9, and
 *     class-based descendant selectors are the most robust path with
 *     no runtime risk.
 */
function MarkdownBody({ source }: { source: string }) {
  return (
    <div className="chat-md py-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownLinkComponents}>{source}</ReactMarkdown>
    </div>
  );
}

/**
 * Four-state embed button:
 *   - pending    gray, disabled, "Pending" label
 *   - generating pulsing gray, disabled, "Generating" label
 *   - ready      normal white, clickable, "Open preview" label
 *   - error      light red, still clickable (click triggers a
 *                fallback re-probe), shows the reason
 *
 * Even when the UI says "ready", we re-probe synchronously on click
 * as a sanity check — the file may have just been deleted, permission
 * may have changed, the CDN may have dropped, etc. UI state always
 * lags real state, so we never fully trust it.
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
    // Fallback on click: re-probe synchronously and take the freshest result.
    const fresh = await refetch();
    if (fresh.kind === "ready") {
      onOpen();
      return;
    }
    // Not ready: surface a clear message instead of silently dropping.
    if (fresh.kind === "pending" || fresh.kind === "generating") {
      toast.info("文件还在生成中,稍等再试");
    } else {
      // Detect "file not generated" as a friendlier message than HTTP 404.
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
      // Distinguish "file not generated" (AI never wrote it) from a
      // real error — the former is the common case (the AI may have
      // just asked whether to save without actually writing), and
      // showing "HTTP 404" to the user there is unhelpful.
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
