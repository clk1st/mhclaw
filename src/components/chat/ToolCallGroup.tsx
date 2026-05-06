import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FilePenLine,
  FileSearch,
  Hammer,
  Loader2,
  Search,
  Terminal,
} from "lucide-react";
import type { MessageBlock } from "@/types/gateway";
import { cn } from "@/lib/utils";

/**
 * 一次 assistant run 里的"过程"区块:
 * - tool_use / tool_result 对齐成工具调用卡片
 * - 工具之间穿插的 text 作为过程消息
 * 默认整个区块折叠,头部显示"N 个工具调用 · M 条过程消息"。
 */
export function ToolCallGroup({
  blocks,
  isStreaming = false,
}: {
  blocks: MessageBlock[];
  /** 当前 turn 是否仍在流式进行中。结束后 tool_use 即使没配到 tool_result,也不算"运行中" */
  isStreaming?: boolean;
}) {
  // 执行中默认展开(让用户看到"现在在做什么");执行完成切回折叠 summary。
  // 用户手动点过之后,跟随用户意图;streaming 切换时重新按默认走。
  const [open, setOpen] = useState<boolean>(isStreaming);
  useEffect(() => {
    setOpen(isStreaming);
  }, [isStreaming]);

  // tool_result 按 tool_use_id 索引,渲染 tool_use 时一起展开
  const resultMap = useMemo(() => {
    const m = new Map<string, Extract<MessageBlock, { type: "tool_result" }>>();
    for (const b of blocks) {
      if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
        m.set(b.tool_use_id, b as Extract<MessageBlock, { type: "tool_result" }>);
      }
    }
    return m;
  }, [blocks]);

  const toolUses = blocks.filter(
    (b): b is Extract<MessageBlock, { type: "tool_use" }> => b.type === "tool_use",
  );
  const toolUseCount = toolUses.length;

  // 过程消息 = tool 之间穿插的短 text 段(用户最终看的总结在 ToolCallGroup 之外)
  const processMsgCount = blocks.filter(
    (b) => b.type === "text" && typeof b.text === "string" && b.text.trim().length > 0,
  ).length;

  if (toolUseCount === 0 && processMsgCount === 0) return null;

  const summary =
    toolUseCount > 0 && processMsgCount > 0
      ? `${toolUseCount} 个工具调用 · ${processMsgCount} 条过程消息`
      : toolUseCount > 0
        ? `${toolUseCount} 个工具调用`
        : `${processMsgCount} 条过程消息`;

  // 最近一个 tool_use 的简短描述,streaming 时在 header 里活动显示
  const lastTool = toolUses[toolUses.length - 1];
  const activeSummary = lastTool
    ? `正在执行 · ${adaptToolUse(lastTool).summary.slice(0, 60)}`
    : "正在处理…";

  return (
    <div className="my-2 w-full">
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-2.5 py-[5px] text-[11.5px] transition",
            isStreaming
              ? "border-[var(--mh-brand-line)] bg-[var(--mh-brand-softer)] text-[var(--mh-brand)] hover:bg-[var(--mh-brand-soft)]"
              : "border-[var(--mh-stroke)] bg-[var(--mh-surface-sub)] text-[var(--mh-text-muted)] hover:bg-[var(--mh-surface-hi)]",
          )}
        >
          {isStreaming ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <span
              className="flex h-3.5 w-3.5 items-center justify-center rounded-full"
              style={{ background: "color-mix(in oklch, var(--mh-success) 20%, transparent)" }}
            >
              <Check className="h-2.5 w-2.5" style={{ color: "var(--mh-success)" }} strokeWidth={2.5} />
            </span>
          )}
          <span className="truncate">
            {isStreaming ? activeSummary : `已完成 · ${summary}`}
          </span>
          {open ? (
            <ChevronDown className="h-3 w-3 opacity-70" />
          ) : (
            <ChevronRight className="h-3 w-3 opacity-70" />
          )}
        </button>
      </div>

      {open && (
        <div className="mt-2 flex flex-col gap-1 border-l pl-3" style={{ borderColor: "var(--mh-stroke)" }}>

          {blocks.map((b, i) => {
            if (b.type === "tool_use") {
              const tuId = typeof b.id === "string" ? b.id : "";
              const result = tuId ? resultMap.get(tuId) : undefined;
              return (
                <ToolCallCard
                  key={`tu-${tuId || i}`}
                  toolUse={b as Extract<MessageBlock, { type: "tool_use" }>}
                  result={result}
                  turnStreaming={isStreaming}
                />
              );
            }
            if (b.type === "text") {
              const t = typeof b.text === "string" ? b.text.trim() : "";
              if (!t) return null;
              return (
                <div
                  key={`t-${i}`}
                  className="whitespace-pre-wrap py-1 text-xs leading-relaxed text-muted-foreground"
                >
                  {t}
                </div>
              );
            }
            // tool_result 已通过 tool_use_id 配对到 ToolCallCard,skip
            return null;
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 单个工具调用:单行展示 + chevron 展开看完整 input/output。
 * 不同 tool 有自己的 adapter(Bash 展示命令,Edit/Write 展示文件路径等)。
 */
function ToolCallCard({
  toolUse,
  result,
  turnStreaming,
}: {
  toolUse: Extract<MessageBlock, { type: "tool_use" }>;
  result?: Extract<MessageBlock, { type: "tool_result" }>;
  turnStreaming: boolean;
}) {
  const [open, setOpen] = useState(false);
  const view = adaptToolUse(toolUse);
  // "运行中":必须同时满足 (1) 没配到 tool_result (2) turn 还在流式。
  // turn 已结束但 result 缺失 → OpenClaw 回放把 tool_result normalize 掉了,
  // 工具实际早就跑完了,显示 loading 反而误导。
  const isRunning = !result && turnStreaming;
  const isError = result?.is_error === true;

  return (
    <div className="rounded-md">
      <button
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <view.Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            isError ? "text-destructive" : "text-muted-foreground",
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            view.mono ? "font-mono text-[11.5px]" : "",
            isError ? "text-destructive" : "text-foreground/85",
          )}
        >
          {view.summary}
        </span>
        {isRunning && (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="ml-5 mt-1 mb-1 flex flex-col gap-1.5">
          {view.inputDetail && (
            <CodeBlock label={view.inputLabel ?? "input"} body={view.inputDetail} />
          )}
          {result && (
            <CodeBlock
              label={isError ? "error" : "output"}
              body={formatToolResultContent(result.content)}
              variant={isError ? "error" : "default"}
            />
          )}
          {isRunning && (
            <div className="text-[10.5px] text-muted-foreground">等待返回…</div>
          )}
        </div>
      )}
    </div>
  );
}

function CodeBlock({
  label,
  body,
  variant = "default",
}: {
  label: string;
  body: string;
  variant?: "default" | "error";
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md ring-1",
        variant === "error"
          ? "bg-destructive/[0.05] ring-destructive/20"
          : "bg-black/[0.03] ring-black/[0.05] dark:bg-white/[0.03] dark:ring-white/[0.06]",
      )}
    >
      <div className="flex items-center justify-between border-b border-black/[0.04] px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground dark:border-white/[0.05]">
        <span>{label}</span>
      </div>
      <pre className="max-h-[320px] overflow-auto px-2 py-1.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words text-foreground/85">
        {body || "(空)"}
      </pre>
    </div>
  );
}

/**
 * 按 tool name 把 tool_use 映射成 UI 展示字段。
 * 没覆盖的 tool 回落为通用 "🔨 <name>" 展示。
 */
function adaptToolUse(tu: Extract<MessageBlock, { type: "tool_use" }>): ToolView {
  const name = (tu.name || "").trim();
  const input = tu.input as Record<string, unknown> | undefined;
  const get = (k: string): string | undefined => {
    const v = input?.[k];
    return typeof v === "string" ? v : undefined;
  };

  // Bash / shell
  if (/^bash$|shell|exec/i.test(name)) {
    const cmd = get("command") ?? get("cmd") ?? "";
    return {
      Icon: Terminal,
      summary: cmd || name,
      mono: true,
      inputLabel: "command",
      inputDetail: cmd || formatJson(input),
    };
  }

  // Edit / Write / Create(文件写入)
  if (/^(edit|write|create|multiedit)$/i.test(name)) {
    const filePath = get("file_path") ?? get("path") ?? get("filename") ?? "";
    const shortPath = filePath.split("/").slice(-2).join("/") || filePath;
    return {
      Icon: FilePenLine,
      summary: `${verbOf(name)} ${shortPath || "(未指定路径)"}`,
      mono: false,
      inputLabel: "input",
      inputDetail: formatJson(input),
    };
  }

  // Read / Grep / Glob / Search
  if (/^read$/i.test(name)) {
    const filePath = get("file_path") ?? get("path") ?? "";
    const shortPath = filePath.split("/").slice(-2).join("/") || filePath;
    return {
      Icon: FileSearch,
      summary: `读取 ${shortPath}`,
      mono: false,
      inputLabel: "input",
      inputDetail: formatJson(input),
    };
  }
  if (/^(grep|glob|search)/i.test(name)) {
    const pattern = get("pattern") ?? get("query") ?? "";
    return {
      Icon: Search,
      summary: `${name} · ${pattern}`,
      mono: false,
      inputLabel: "input",
      inputDetail: formatJson(input),
    };
  }

  // 其它(MCP / Skill / 未知)
  return {
    Icon: Hammer,
    summary: name || "unknown tool",
    mono: false,
    inputLabel: "input",
    inputDetail: formatJson(input),
  };
}

interface ToolView {
  Icon: typeof Terminal;
  summary: string;
  mono: boolean;
  inputLabel?: string;
  inputDetail?: string;
}

function verbOf(name: string): string {
  const n = name.toLowerCase();
  if (n === "edit" || n === "multiedit") return "修改";
  if (n === "write" || n === "create") return "创建";
  return name;
}

function formatJson(v: unknown): string {
  if (v === undefined || v === null) return "";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/**
 * tool_result.content 的形态:
 * - string(简单工具)
 * - Array<{ type: "text", text }>(Anthropic 标准)
 * - 其它(image 等暂不展开,fallback JSON)
 */
function formatToolResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const b of content as Array<{ type?: string; text?: string }>) {
      if (b && b.type === "text" && typeof b.text === "string") {
        parts.push(b.text);
      } else {
        parts.push(formatJson(b));
      }
    }
    return parts.join("\n");
  }
  return formatJson(content);
}
