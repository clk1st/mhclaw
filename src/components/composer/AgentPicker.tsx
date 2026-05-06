import { useMemo } from "react";
import { Bot, Check, ChevronDown, Sparkles } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAgents, type AgentInfo } from "@/hooks/use-agents";
import { useChatStore } from "@/stores/chat-store";
import { cn } from "@/lib/utils";
import { showConfirm } from "@/lib/prompt";

/**
 * Composer 里的 Agent 选择器。
 *
 * 关键约定(基于 OpenClaw 4.x 协议):
 * - chat.send schema 是 additionalProperties:false,**不能**传 agentId 过去
 * - agent 通过 sessionKey 编码:`agent:<agentId>:<rest>` → OpenClaw 解析自动路由
 * - 所以"切换 agent" = "新建一个走 agent 前缀的 sessionKey"
 *
 * 当前 session 的 agent 从 sessionKey 里反解(可能为空 → Auto)。
 * 选某个 agent 后,创建新会话(老对话保留在 sessions 列表里);
 * 当前对话已有消息时会确认。
 */
export function AgentPicker() {
  const sessionKey = useChatStore((s) => s.sessionKey);
  const messages = useChatStore((s) => s.messages);
  const newSessionWithAgent = useChatStore((s) => s.newSessionWithAgent);
  const { data: agents = [], isLoading } = useAgents();

  const currentAgentId = useMemo(() => parseAgentFromKey(sessionKey), [sessionKey]);
  const current = agents.find((a) => a.id === currentAgentId) ?? null;
  const label = current ? asString(current.name) || current.id : "Auto";
  const emoji = current ? asString(current.emoji) : "";

  const handlePick = async (agentId: string | null) => {
    if (currentAgentId === (agentId ?? null)) return; // 已是当前
    if (messages.length > 0) {
      const target = agentId ?? "默认 agent";
      const ok = await showConfirm({
        title: `切换到「${target}」?`,
        description: "会新建一个会话继续对话。当前对话不会被删除,可在侧边栏切回。",
        confirmText: "新建并切换",
      });
      if (!ok) return;
    }
    await newSessionWithAgent(agentId);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-full bg-white/50 px-2.5 text-xs text-foreground/70 ring-1 ring-black/[0.04] transition hover:bg-white hover:text-foreground hover:ring-black/10 dark:bg-white/[0.04] dark:text-foreground/70 dark:ring-white/[0.06] dark:hover:bg-white/[0.08] dark:hover:text-foreground dark:hover:ring-white/15",
            current && "text-foreground",
          )}
          title={current ? `当前 agent:${label}` : "Auto · 走 OpenClaw default agent"}
        >
          {emoji ? (
            <span className="text-[11px] leading-none">{emoji}</span>
          ) : current ? (
            <Bot className="h-3 w-3" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          <span className="max-w-[80px] truncate">{label}</span>
          <ChevronDown className="h-2.5 w-2.5 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Agent 路由
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <AutoItem
          active={currentAgentId === null}
          onClick={() => handlePick(null)}
        />

        <DropdownMenuSeparator />

        {isLoading ? (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">
            加载中…
          </div>
        ) : agents.length === 0 ? (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">
            Gateway 未连接或未配置 agent
          </div>
        ) : (
          agents.map((a) => (
            <AgentItem
              key={a.id}
              agent={a}
              active={a.id === currentAgentId}
              onClick={() => handlePick(a.id)}
            />
          ))
        )}

        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-[10px] text-muted-foreground">
          切换 agent 会新建一个会话(对应 OpenClaw <code className="font-mono">agent:&lt;id&gt;:</code> 前缀)
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 从 OpenClaw sessionKey 反解 agentId(对应 parseAgentSessionKey 行为) */
function parseAgentFromKey(sessionKey: string): string | null {
  const lower = sessionKey?.trim().toLowerCase();
  if (!lower) return null;
  const parts = lower.split(":").filter(Boolean);
  if (parts.length < 3) return null;
  if (parts[0] !== "agent") return null;
  return parts[1] || null;
}

function AutoItem({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <DropdownMenuItem
      onClick={onClick}
      className={cn("flex items-start gap-2 py-2", active && "bg-accent")}
    >
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">Auto</span>
          {active && <Check className="h-3 w-3 text-primary" />}
        </div>
        <div className="text-[11px] text-muted-foreground">
          走 OpenClaw default agent(配置里 default:true 的)
        </div>
      </div>
    </DropdownMenuItem>
  );
}

function AgentItem({
  agent,
  active,
  onClick,
}: {
  agent: AgentInfo;
  active: boolean;
  onClick: () => void;
}) {
  const name = asString(agent.name) || agent.id;
  const emoji = asString(agent.emoji);
  const modelStr = modelLabel(agent.model);
  const desc = asString(agent.description);

  return (
    <DropdownMenuItem
      onClick={onClick}
      className={cn("flex items-start gap-2 py-2", active && "bg-accent")}
    >
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-xs">
        {emoji || <Bot className="h-3.5 w-3.5 text-muted-foreground" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{name}</span>
          {agent.default ? (
            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">
              默认
            </span>
          ) : null}
          {active && <Check className="h-3 w-3 text-primary" />}
        </div>
        {modelStr && (
          <div className="truncate font-mono text-[10px] text-muted-foreground">
            {modelStr}
          </div>
        )}
        {desc && (
          <div className="truncate text-[10px] text-muted-foreground/80">
            {desc}
          </div>
        )}
      </div>
    </DropdownMenuItem>
  );
}

function asString(x: unknown): string {
  if (typeof x === "string") return x;
  if (x == null) return "";
  if (typeof x === "object") {
    const o = x as Record<string, unknown>;
    if (typeof o.id === "string") return o.id;
    if (typeof o.name === "string") return o.name;
  }
  return "";
}

function modelLabel(m: unknown): string {
  if (typeof m === "string") return m;
  if (m && typeof m === "object") {
    const o = m as Record<string, unknown>;
    const provider = typeof o.provider === "string" ? o.provider : "";
    const id = typeof o.id === "string" ? o.id : typeof o.model === "string" ? o.model : "";
    return [provider, id].filter(Boolean).join("/");
  }
  return "";
}
