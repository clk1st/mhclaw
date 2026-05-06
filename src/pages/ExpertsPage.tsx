import { Loader2, Users, Wrench } from "lucide-react";
import { useAgents, type AgentInfo } from "@/hooks/use-agents";

export function ExpertsPage() {
  const { data: agents = [], isLoading, error } = useAgents();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="专家"
        subtitle="预设 Agent · 每个有独立的工作区、模型、技能与系统提示"
      />

      <div className="flex-1 overflow-y-auto px-7 pb-7">
        {isLoading && agents.length === 0 ? (
          <Loading />
        ) : error ? (
          <ErrorHint message={(error as Error).message} />
        ) : agents.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {agents.map((a) => (
              <AgentCard key={a.id} agent={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 专家卡:默认徽标(右上) + 渐变头像 + 描述 + 元信息 + 底部工具/技能/编辑入口 */
function AgentCard({ agent }: { agent: AgentInfo }) {
  const name = asString(agent.name) || agent.id;
  const emoji = typeof agent.emoji === "string" ? agent.emoji : "🧑‍💼";
  const description = asString(agent.description);
  const modelLabel = asString(agent.model);
  const workspaceLabel = asString(agent.workspace);
  const isDefault = agent.default === true;
  const gradient = gradientFor(agent.id);

  return (
    <div
      className="relative overflow-hidden rounded-[14px] p-4 backdrop-blur transition cursor-pointer hover:shadow-[0_4px_20px_rgba(40,20,100,0.08)]"
      style={{
        background: "var(--mh-surface)",
        border: "1px solid var(--mh-stroke)",
      }}
    >
      {isDefault && (
        <div
          className="absolute right-3 top-3 rounded px-1.5 py-[2px] text-[10px] font-medium"
          style={{
            color: "var(--mh-brand)",
            background: "var(--mh-brand-soft)",
            border: "1px solid var(--mh-brand-line)",
          }}
        >
          默认
        </div>
      )}

      <div className="mb-3 flex items-center gap-2.5">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] text-[20px]"
          style={{
            background: gradient,
            boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.3)",
          }}
        >
          {emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold" style={{ color: "var(--mh-text)" }}>
            {name}
          </div>
          <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug" style={{ color: "var(--mh-text-muted)" }}>
            {description || `ID: ${agent.id}`}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1 text-[11.5px]">
        {workspaceLabel && <Meta label="工作区" value={shortenPath(workspaceLabel)} mono />}
        {modelLabel && <Meta label="模型" value={shortenModel(modelLabel)} />}
      </div>

      <div
        className="mt-3 flex gap-1.5 border-t pt-3"
        style={{ borderTop: "1px dashed var(--mh-stroke)" }}
      >
        <MiniChip icon={<Wrench className="h-[10px] w-[10px]" />} label="工具" />
        <MiniChip icon={<Users className="h-[10px] w-[10px]" />} label="技能" />
      </div>
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0" style={{ width: 44, color: "var(--mh-text-faint)" }}>
        {label}
      </span>
      <span
        className="truncate"
        style={{
          color: "var(--mh-text-muted)",
          fontFamily: mono ? "var(--font-mono, ui-monospace)" : "inherit",
          fontSize: mono ? 11 : 11.5,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function MiniChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div
      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px]"
      style={{
        background: "var(--mh-surface-sub)",
        border: "1px solid var(--mh-stroke)",
        color: "var(--mh-text-muted)",
      }}
    >
      <span style={{ color: "var(--mh-text-subtle)" }}>{icon}</span>
      {label}
    </div>
  );
}

/** 用 agent.id 稳定 hash 成一个渐变配色 */
function gradientFor(id: string): string {
  const palette: [string, string][] = [
    ["#6b5cff", "#b1a3ff"],
    ["#ff9a7e", "#ffc3a8"],
    ["#4bd39a", "#7ae4b5"],
    ["#3b7fe0", "#84b4ff"],
    ["#d9892a", "#efc46b"],
    ["#d8465a", "#ff8794"],
  ];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  const [a, b] = palette[h % palette.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

export function PageHeader({
  title,
  subtitle,
  cta,
}: {
  title: string;
  subtitle?: string;
  cta?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 px-7 pb-5 pt-7">
      <div className="min-w-0 flex-1">
        <h1 className="text-[24px] font-semibold tracking-[-0.02em]" style={{ color: "var(--mh-text)" }}>
          {title}
        </h1>
        {subtitle && (
          <div className="mt-1 text-[12.5px]" style={{ color: "var(--mh-text-muted)" }}>
            {subtitle}
          </div>
        )}
      </div>
      {cta}
    </div>
  );
}

function asString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const candidates = ["id", "name", "label", "modelId", "model", "path", "ref"];
    for (const key of candidates) {
      const val = obj[key];
      if (typeof val === "string" && val) return val;
    }
    for (const key of candidates) {
      const val = obj[key];
      if (val && typeof val === "object") {
        const deep = asString(val);
        if (deep) return deep;
      }
    }
  }
  return "";
}

function shortenModel(s: string): string {
  if (!s) return "";
  const slash = s.indexOf("/");
  return slash > 0 ? s.slice(slash + 1) : s;
}

function shortenPath(p: string): string {
  if (!p) return "";
  const parts = p.split("/");
  return parts.length > 3 ? ".../" + parts.slice(-2).join("/") : p;
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-20 text-sm" style={{ color: "var(--mh-text-muted)" }}>
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      加载中…
    </div>
  );
}

function ErrorHint({ message }: { message: string }) {
  return (
    <div
      className="rounded-md px-3 py-2 text-sm"
      style={{
        color: "var(--mh-error)",
        background: "color-mix(in oklch, var(--mh-error) 6%, transparent)",
        border: "1px solid color-mix(in oklch, var(--mh-error) 30%, transparent)",
      }}
    >
      加载失败:{message}
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="rounded-[14px] px-6 py-14 text-center backdrop-blur"
      style={{
        border: "1.5px dashed var(--mh-stroke-strong)",
        background: "var(--mh-surface-sub)",
      }}
    >
      <Users className="mx-auto h-8 w-8" style={{ color: "var(--mh-text-faint)" }} />
      <p className="mt-3 text-sm" style={{ color: "var(--mh-text-muted)" }}>
        暂无 Agent
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--mh-text-subtle)" }}>
        在 <code className="rounded px-1" style={{ background: "var(--mh-brand-softer)", color: "var(--mh-brand)" }}>~/.mhclaw/mhclaw.json</code>{" "}
        的 <code className="rounded px-1" style={{ background: "var(--mh-brand-softer)", color: "var(--mh-brand)" }}>agents.list</code> 中添加
      </p>
    </div>
  );
}
