import { useState } from "react";
import {
  Clock,
  Copy,
  History,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  useCrons,
  useDeleteCron,
  useRunCron,
  useUpdateCron,
  type CronJob,
} from "@/hooks/use-crons";
import {
  useCronHistory,
  type StoredCronJob,
} from "@/hooks/use-cron-history";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { showConfirm } from "@/lib/prompt";
import { CronCreateDialog } from "@/components/automation/CronCreateDialog";
import { CronRunsDialog } from "@/components/automation/CronRunsDialog";
import {
  CRON_TEMPLATES,
  fromCronExpr,
  type CronTemplate,
  type Weekday,
} from "@/components/automation/cron-templates";
import { PageHeader } from "./ExpertsPage";

type DialogState =
  | { open: false }
  | { open: true; mode: "create"; template?: CronTemplate | null }
  | { open: true; mode: "edit" | "duplicate"; job: CronJob };

export function AutomationPage() {
  const { data: jobs = [], isLoading, error } = useCrons();
  const run = useRunCron();
  const del = useDeleteCron();
  const update = useUpdateCron();
  // 客户端自维护的 cron 历史:cron.list 里已消失的 job(执行完 / 被 Gateway 删)
  // 仍然能在"已完成任务"区看到
  const { completedJobs, clearFromHistory } = useCronHistory(jobs);

  const [dlg, setDlg] = useState<DialogState>({ open: false });
  const [runsDlg, setRunsDlg] = useState<{
    open: boolean;
    jobId: string | null;
    jobName?: string;
  }>({ open: false, jobId: null });

  const openBlank = () => setDlg({ open: true, mode: "create", template: null });
  const openWithTemplate = (t: CronTemplate) =>
    setDlg({ open: true, mode: "create", template: t });
  const openEdit = (job: CronJob) => setDlg({ open: true, mode: "edit", job });
  const openDuplicate = (job: CronJob) =>
    setDlg({ open: true, mode: "duplicate", job });
  const openRuns = (job: CronJob) =>
    setRunsDlg({ open: true, jobId: job.id, jobName: job.name });

  const toggleEnabled = (job: CronJob) => {
    update.mutate({
      id: job.id,
      patch: { enabled: job.enabled === false },
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="自动化"
        subtitle="按计划触发 agent · 产出会进入今日摘要与侧边栏"
        cta={
          <button
            onClick={openBlank}
            className="flex items-center gap-1.5 rounded-[9px] px-3 py-[7px] text-[12.5px] font-medium text-white shadow-brand-glow transition hover:opacity-95"
            style={{ background: "var(--mh-brand)" }}
          >
            <Plus className="h-3 w-3" strokeWidth={2.2} />
            自定义
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-7 pb-7">
        {/* 我的定时任务 */}
        <SectionLabel>我的定时任务 · {jobs.length}</SectionLabel>
        <div className="mt-2.5">
          {isLoading ? (
            <Loading />
          ) : error ? (
            <ErrorHint message={(error as Error).message} />
          ) : jobs.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="flex flex-col gap-1.5">
              {jobs.map((job) => (
                <CronRow
                  key={job.id}
                  job={job}
                  busy={run.isPending || del.isPending}
                  onRun={() => run.mutate(job.id)}
                  onDelete={() =>
                    del.mutate(job.id, {
                      // 用户主动删:同步清本地历史,避免被误判为"已完成"
                      onSuccess: () => clearFromHistory(job.id),
                    })
                  }
                  onEdit={() => openEdit(job)}
                  onDuplicate={() => openDuplicate(job)}
                  onOpenRuns={() => openRuns(job)}
                  onToggleEnabled={() => toggleEnabled(job)}
                />
              ))}
            </div>
          )}
        </div>

        {/* 已完成任务 —— 客户端自维护:曾在 cron.list 里出现过、之后消失的 job */}
        {completedJobs.length > 0 && (
          <div className="mt-7">
            <SectionLabel>已完成任务 · {completedJobs.length}</SectionLabel>
            <div className="mt-2.5 flex flex-col gap-1.5">
              {completedJobs.map((job) => (
                <CompletedCronRow
                  key={job.id}
                  job={job}
                  onDuplicate={() => openDuplicate(job as CronJob)}
                  onClear={() => clearFromHistory(job.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* 模板库 */}
        <div className="mt-7">
          <SectionLabel>从模板入手</SectionLabel>
          <div
            className="mt-2.5 grid gap-2.5"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}
          >
            {CRON_TEMPLATES.map((t, i) => (
              <TemplateCard
                key={t.id}
                template={t}
                color={TEMPLATE_HUES[i % TEMPLATE_HUES.length]}
                onPick={() => openWithTemplate(t)}
              />
            ))}
          </div>
        </div>
      </div>

      <CronCreateDialog
        open={dlg.open}
        onOpenChange={(o) => !o && setDlg({ open: false })}
        mode={dlg.open ? dlg.mode : "create"}
        job={dlg.open && (dlg.mode === "edit" || dlg.mode === "duplicate") ? dlg.job : null}
        template={dlg.open && dlg.mode === "create" ? dlg.template : null}
      />

      <CronRunsDialog
        open={runsDlg.open}
        onOpenChange={(o) => setRunsDlg((s) => ({ ...s, open: o }))}
        jobId={runsDlg.jobId}
        jobName={runsDlg.jobName}
      />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[11px] font-semibold uppercase tracking-[0.1em]"
      style={{ color: "var(--mh-text-faint)" }}
    >
      {children}
    </div>
  );
}

const TEMPLATE_HUES = [
  "var(--mh-info)",
  "var(--mh-brand)",
  "var(--mh-warn)",
  "var(--mh-success)",
  "var(--mh-error)",
  "var(--mh-brand)",
];

function TemplateCard({
  template,
  color,
  onPick,
}: {
  template: CronTemplate;
  color: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="group relative overflow-hidden rounded-[12px] p-[14px_14px_16px] text-left transition hover:shadow-[0_4px_16px_rgba(40,20,100,0.06)]"
      style={{
        background: "var(--mh-surface)",
        border: "1px solid var(--mh-stroke)",
      }}
    >
      <div
        className="pointer-events-none absolute -right-3.5 -top-3.5 h-[60px] w-[60px] rounded-full blur-[8px]"
        style={{ background: `color-mix(in oklch, ${color} 18%, transparent)` }}
      />
      <div
        className="relative mb-2.5 flex h-[26px] w-[26px] items-center justify-center rounded-[7px] text-[14px]"
        style={{
          background: `color-mix(in oklch, ${color} 16%, transparent)`,
          border: `1px solid color-mix(in oklch, ${color} 30%, transparent)`,
          color,
        }}
      >
        {template.emoji}
      </div>
      <div className="relative text-[12.5px] font-medium" style={{ color: "var(--mh-text)" }}>
        {template.title}
      </div>
      <p
        className="relative mt-0.5 line-clamp-2 text-[11px] leading-[1.45]"
        style={{ color: "var(--mh-text-subtle)" }}
      >
        {template.desc}
      </p>
    </button>
  );
}

function CronRow({
  job,
  busy,
  onRun,
  onDelete,
  onEdit,
  onDuplicate,
  onOpenRuns,
  onToggleEnabled,
}: {
  job: CronJob;
  busy: boolean;
  onRun: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onOpenRuns: () => void;
  onToggleEnabled: () => void;
}) {
  const name = job.name || job.id;
  const schedule = formatSchedule(job);
  const next = formatNextRun(job);

  const enabled = job.enabled !== false;
  // 阻止右侧按钮 / 开关触发整行的 onClick(整行点击打开编辑 Dialog)
  const stop = (e: React.MouseEvent | React.KeyboardEvent) => e.stopPropagation();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit();
        }
      }}
      className={cn(
        "group flex items-center gap-3 rounded-[10px] px-3.5 py-2.5 cursor-pointer transition",
        "hover:border-[var(--mh-brand-line)] hover:shadow-[0_2px_10px_rgba(40,20,100,0.06)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mh-brand-line)]",
      )}
      style={{
        background: "var(--mh-surface)",
        border: "1px solid var(--mh-stroke)",
      }}
    >
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px]"
        style={{
          background: "var(--mh-brand-softer)",
          border: "1px solid var(--mh-brand-line)",
          color: "var(--mh-brand)",
        }}
      >
        <Clock className="h-[13px] w-[13px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium" style={{ color: "var(--mh-text)" }}>
            {name}
          </span>
          {!enabled && (
            <span
              className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px]"
              style={{
                background: "color-mix(in oklch, var(--mh-warn) 12%, transparent)",
                color: "var(--mh-warn)",
              }}
            >
              已停用
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11px]" style={{ color: "var(--mh-text-muted)" }}>
          <span className="font-mono">{schedule}</span>
          {next && (
            <>
              <span style={{ color: "var(--mh-text-faint)", margin: "0 6px" }}>·</span>
              <span>下次 {next}</span>
            </>
          )}
        </div>
      </div>
      {/* 启用/停用开关(真接 cron.update,乐观更新) */}
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={(e) => {
          stop(e);
          onToggleEnabled();
        }}
        disabled={busy}
        title={enabled ? "点击停用" : "点击启用"}
        className="relative h-[18px] w-[32px] shrink-0 cursor-pointer rounded-[10px] transition disabled:cursor-not-allowed disabled:opacity-60"
        style={{
          background: enabled ? "var(--mh-brand)" : "var(--mh-stroke-strong)",
        }}
      >
        <div
          className="absolute top-[2px] h-[14px] w-[14px] rounded-[7px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.15)] transition-all"
          style={{ [enabled ? "right" : "left"]: 2 } as React.CSSProperties}
        />
      </button>
      <div className="flex shrink-0 items-center gap-0.5" onClick={stop}>
        {/* Play / 删除按钮:hover 时才显示,减少视觉干扰 */}
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          onClick={(e) => {
            stop(e);
            onRun();
          }}
          title="立即运行"
          className={cn(
            "h-7 w-7 opacity-0 transition-opacity",
            "group-hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          <Play />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          onClick={async (e) => {
            stop(e);
            const ok = await showConfirm({
              title: "删除定时任务?",
              description: `"${name}" 将被永久删除。`,
              confirmText: "删除",
              danger: true,
            });
            if (ok) onDelete();
          }}
          title="删除"
          className={cn(
            "h-7 w-7 text-muted-foreground opacity-0 transition-opacity",
            "group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive",
          )}
        >
          <Trash2 />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={stop}
              title="更多"
              className="flex h-7 w-7 items-center justify-center rounded-md transition hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
              style={{ color: "var(--mh-text-faint)" }}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44" onClick={stop}>
            <DropdownMenuItem onClick={onOpenRuns}>
              <History />
              查看执行历史
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy />
              复制为新任务
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                const ok = await showConfirm({
                  title: "删除定时任务?",
                  description: `"${name}" 将被永久删除。`,
                  confirmText: "删除",
                  danger: true,
                });
                if (ok) onDelete();
              }}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** ms 时间戳 → "MM-DD HH:mm" */
function formatAtTime(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "--";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

/** 每 N 毫秒 → 人类可读的 "30 分钟 / 2 小时 / 1 天" */
function formatInterval(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "--";
  const s = Math.round(ms / 1000);
  if (s < 60) return `每 ${s} 秒`;
  const m = Math.round(s / 60);
  if (m < 60) return `每 ${m} 分钟`;
  const h = Math.round(m / 60);
  if (h < 24) return `每 ${h} 小时`;
  return `每 ${Math.round(h / 24)} 天`;
}

/**
 * 已完成任务行(只读 + 复制 / 从记录中移除 两个 action)。
 * 数据源:客户端 localStorage 里标记了 removedAt 的 job(见 use-cron-history)。
 */
function CompletedCronRow({
  job,
  onDuplicate,
  onClear,
}: {
  job: StoredCronJob;
  onDuplicate: () => void;
  onClear: () => void;
}) {
  const name = job.name || job.id;
  const schedule = formatSchedule(job as CronJob);
  const finishedAt =
    typeof job.removedAt === "number"
      ? new Date(job.removedAt).toLocaleString()
      : "";

  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-[10px] px-3.5 py-2.5 text-left transition",
        "hover:border-[var(--mh-stroke-strong)]",
      )}
      style={{
        background: "var(--mh-surface-sub)",
        border: "1px solid var(--mh-stroke)",
        opacity: 0.88,
      }}
    >
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px]"
        style={{
          background: "var(--mh-surface)",
          border: "1px solid var(--mh-stroke)",
          color: "var(--mh-text-faint)",
        }}
      >
        <Clock className="h-[13px] w-[13px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="truncate text-[13px] font-medium"
            style={{ color: "var(--mh-text-muted)" }}
          >
            {name}
          </span>
          <span
            className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px]"
            style={{
              background:
                "color-mix(in oklch, var(--mh-success) 10%, transparent)",
              color: "var(--mh-success)",
            }}
          >
            已完成
          </span>
        </div>
        <div
          className="mt-0.5 text-[11px]"
          style={{ color: "var(--mh-text-faint)" }}
        >
          <span className="font-mono">{schedule}</span>
          {finishedAt && (
            <>
              <span style={{ margin: "0 6px" }}>·</span>
              <span>完成于 {finishedAt}</span>
            </>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onDuplicate}
        title="复制为新任务再跑一次"
        className={cn(
          "h-7 w-7 opacity-0 transition-opacity",
          "group-hover:opacity-100 focus-visible:opacity-100",
        )}
      >
        <Copy />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClear}
        title="从记录中移除"
        className={cn(
          "h-7 w-7 text-muted-foreground opacity-0 transition-opacity",
          "group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive",
        )}
      >
        <X />
      </Button>
    </div>
  );
}

function formatSchedule(job: CronJob): string {
  const raw = job.schedule;
  if (!raw) return job.type ?? "--";

  // 老 Gateway 直接返字符串(cron 表达式)
  if (typeof raw === "string") return raw;

  const obj = raw as {
    kind?: string;
    expr?: string;
    at?: number;
    everyMs?: number;
    staggerMs?: number;
  };
  const kind = obj.kind ?? job.type;
  const expr = obj.expr ?? "";

  if (kind === "at") {
    const ts = parseAtField(obj.at, expr);
    if (Number.isFinite(ts) && ts > 0) return `一次 · ${formatAtTime(ts)}`;
    return `一次`;
  }

  if (kind === "every") {
    const ms =
      typeof obj.everyMs === "number"
        ? obj.everyMs
        : expr
          ? Number.parseInt(expr, 10)
          : NaN;
    return formatInterval(ms);
  }

  if (kind === "cron") {
    // 试着把 "32 13 * * *" 反解成人话 "每天 13:32";反解失败继续露原 expr
    const parsed = fromCronExpr(expr);
    if (parsed) return `${formatWeekdays(parsed.weekdays)} ${parsed.time}`;
    return expr || "--";
  }
  return expr || "--";
}

/** 星期集合 → 中文可读短语("每天" / "工作日" / "周末" / "每周一" / "周一、三、五") */
function formatWeekdays(wds: Weekday[]): string {
  if (wds.length === 0) return "每天";
  const sorted = [...wds].sort((a, b) => a - b);
  if (sorted.length === 7) return "每天";
  if (sorted.length === 5 && sorted.join(",") === "1,2,3,4,5") return "工作日";
  if (sorted.length === 2 && sorted.join(",") === "0,6") return "周末";
  const names = ["日", "一", "二", "三", "四", "五", "六"];
  if (sorted.length === 1) return `每周${names[sorted[0]]}`;
  return `周${sorted.map((d) => names[d]).join("、")}`;
}

/** 计算下次触发时间文案。nextRunAt 优先;没有的话对 at 单次任务从 schedule 取 */
function formatNextRun(job: CronJob): string {
  if (typeof job.nextRunAt === "number" && job.nextRunAt > 0) {
    return new Date(job.nextRunAt).toLocaleString();
  }
  // 单次任务 Gateway 可能在执行后清空 nextRunAt
  const raw = job.schedule;
  if (raw && typeof raw === "object") {
    const obj = raw as { kind?: string; at?: number | string; expr?: string };
    if (obj.kind === "at") {
      const ts = parseAtField(obj.at, obj.expr);
      if (Number.isFinite(ts) && ts > Date.now()) {
        return new Date(ts).toLocaleString();
      }
    }
  }
  return "";
}

/**
 * at 字段在 cron.list 响应里有 3 种可能:
 *  - 数字时间戳(ms)
 *  - 数字字符串("1714193400000")
 *  - ISO 字符串("2026-04-23T11:30:00+08:00")—— AI 用 cron.add 传这种时最常见
 * 统一转成 ms,解析失败返 NaN。
 */
function parseAtField(at: unknown, fallbackExpr?: string): number {
  const tryParse = (v: unknown): number => {
    if (typeof v === "number") return v;
    if (typeof v !== "string" || !v) return NaN;
    // ISO 字符串
    const iso = Date.parse(v);
    if (!Number.isNaN(iso)) return iso;
    // 纯数字字符串
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n)) return n;
    return NaN;
  };
  const r = tryParse(at);
  if (Number.isFinite(r)) return r;
  return tryParse(fallbackExpr);
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

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-10 text-center">
      <Clock className="mx-auto h-7 w-7 text-muted-foreground/50" />
      <p className="mt-3 text-sm text-muted-foreground">暂无定时任务</p>
      <p className="mt-1 text-xs text-muted-foreground/70">
        从上方模板入手,或点右上角「添加」自定义
      </p>
    </div>
  );
}
