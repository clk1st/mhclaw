import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Loader2,
  Package,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateCron,
  useUpdateCron,
  toIsoAt,
  type CronJob,
  type CronSchedule,
} from "@/hooks/use-crons";
import { useSkills, type SkillStatusEntry } from "@/hooks/use-skills";
import { buildMarkers, stripMarkers } from "@/lib/markers";
import { cn } from "@/lib/utils";
import {
  CRON_TEMPLATES,
  getLocalTz,
  scheduleToFormState,
  toCronExpr,
  type CronTemplate,
  type Weekday,
} from "./cron-templates";

type Frequency = "daily" | "interval" | "once";
type DialogMode = "create" | "edit" | "duplicate";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 模式:create 新建 · edit 编辑 · duplicate 复制为新任务 */
  mode?: DialogMode;
  /** edit / duplicate 必传,create 忽略 */
  job?: CronJob | null;
  /** create 模式从模板打开时预填;不传则空白新建 */
  template?: CronTemplate | null;
}

const WEEKDAY_LABELS: { key: Weekday; label: string }[] = [
  { key: 1, label: "一" },
  { key: 2, label: "二" },
  { key: 3, label: "三" },
  { key: 4, label: "四" },
  { key: 5, label: "五" },
  { key: 6, label: "六" },
  { key: 0, label: "日" },
];

export function CronCreateDialog({
  open,
  onOpenChange,
  mode = "create",
  job,
  template,
}: Props) {
  const create = useCreateCron();
  const update = useUpdateCron();
  const { data: skillsData } = useSkills();
  const availableSkills = useMemo<SkillStatusEntry[]>(
    () =>
      (skillsData?.skills ?? []).filter(
        (s) => !s.disabled && (s.skillKey || s.name),
      ),
    [skillsData],
  );

  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [freq, setFreq] = useState<Frequency>("daily");

  // daily
  const [time, setTime] = useState("09:00");
  const [weekdays, setWeekdays] = useState<Weekday[]>([0, 1, 2, 3, 4, 5, 6]);

  // interval
  const [intervalMin, setIntervalMin] = useState(30);

  // once
  const [onceDate, setOnceDate] = useState(() =>
    new Date(Date.now() + 30 * 60_000).toISOString().slice(0, 10),
  );
  const [onceTime, setOnceTime] = useState(() => {
    const d = new Date(Date.now() + 30 * 60_000);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });

  /** edit 模式下原 schedule 无法反解成 form(用户写了复杂 cron 表达式),
   *  保留原 expr 只读展示 + 提供"清除重设"按钮 */
  const [rawExprReadOnly, setRawExprReadOnly] = useState<string>("");
  /** 源时区,跟本地不一致时顶部提示 */
  const [sourceTz, setSourceTz] = useState<string | undefined>(undefined);

  // 打开时根据模式预填(模板/编辑/复制/空白)。只在 open 从 false → true 的那次
  // 重置,避免编辑过程中 cron.list 轮询回来的新 job 覆盖用户正在改的 state。
  useEffect(() => {
    if (!open) return;
    setRawExprReadOnly("");
    setSourceTz(undefined);

    // edit / duplicate:从 job 回填
    if ((mode === "edit" || mode === "duplicate") && job) {
      const rawMsg =
        job.payload?.message ?? job.message ?? "";
      const { visibleText, envelope } = stripMarkers(rawMsg);
      setName(
        mode === "duplicate"
          ? `${job.name ?? ""} 副本`.trim() || "副本"
          : job.name ?? "",
      );
      setMessage(visibleText);
      setSelectedSkills(envelope.skills ?? []);
      const form = scheduleToFormState(job.schedule);
      setFreq(form.freq);
      setTime(form.time);
      setWeekdays(form.weekdays);
      setIntervalMin(form.intervalMin);
      if (form.onceDate) setOnceDate(form.onceDate);
      if (form.onceTime) setOnceTime(form.onceTime);
      if (form.rawExprReadOnly) setRawExprReadOnly(form.rawExprReadOnly);
      if (form.sourceTz) setSourceTz(form.sourceTz);
      return;
    }

    // create + template
    if (template) {
      setName(template.name);
      setMessage(template.message);
      setFreq("daily");
      setTime(template.time);
      setWeekdays(template.weekdays);
      setSelectedSkills([]);
      return;
    }

    // create 空白
    setName("");
    setMessage("");
    setFreq("daily");
    setTime("09:00");
    setWeekdays([0, 1, 2, 3, 4, 5, 6]);
    setSelectedSkills([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleSkill = (skillKey: string) => {
    setSelectedSkills((prev) =>
      prev.includes(skillKey)
        ? prev.filter((x) => x !== skillKey)
        : [...prev, skillKey],
    );
  };

  const toggleWeekday = (w: Weekday) => {
    setWeekdays((prev) =>
      prev.includes(w) ? prev.filter((x) => x !== w) : [...prev, w],
    );
  };

  const buildSchedule = (): CronSchedule | null => {
    if (freq === "daily") {
      if (weekdays.length === 0) return null;
      return { kind: "cron", expr: toCronExpr(time, weekdays), tz: getLocalTz() };
    }
    if (freq === "interval") {
      const min = Math.max(1, Math.floor(intervalMin));
      return { kind: "every", everyMs: min * 60_000 };
    }
    // once:OpenClaw 要求 at 是带时区偏移的 ISO 字符串(不是 ms)
    const ms = new Date(`${onceDate}T${onceTime}:00`).getTime();
    if (!Number.isFinite(ms) || ms <= Date.now()) return null;
    return { kind: "at", at: toIsoAt(ms) };
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    const m = message.trim();
    if (!n) return toast.error("请输入任务名称");
    if (!m) return toast.error("请输入提示词");
    if (freq === "daily" && weekdays.length === 0 && !rawExprReadOnly) {
      return toast.error("请至少勾选一天");
    }
    // 编辑模式下若 rawExprReadOnly 有值(用户保留的高级 cron 表达式),
    // 就直接用原 expr 保存,不覆盖
    let schedule: CronSchedule | null;
    if (mode === "edit" && rawExprReadOnly) {
      schedule = { kind: "cron", expr: rawExprReadOnly, tz: sourceTz };
    } else {
      schedule = buildSchedule();
    }
    if (!schedule) return toast.error("执行时间设置无效");

    // 跟 chat composer 同款 —— 用 buildMarkers 拼 [skills: key1, key2]
    const finalMessage = buildMarkers(m, {
      skills: selectedSkills.length > 0 ? selectedSkills : undefined,
    });

    try {
      if (mode === "edit" && job) {
        await update.mutateAsync({
          id: job.id,
          patch: {
            name: n,
            schedule,
            payload: { kind: "agentTurn", message: finalMessage },
          },
        });
        toast.success(`已保存「${n}」`);
      } else {
        // create / duplicate 都走 cron.add
        const srcTarget = job?.sessionTarget ?? job?.target;
        const sessionTarget =
          srcTarget === "main" || srcTarget === "isolated" ? srcTarget : undefined;
        await create.mutateAsync({
          name: n,
          message: finalMessage,
          schedule,
          sessionTarget,
        });
        toast.success(
          mode === "duplicate" ? `已复制为「${n}」` : `已创建任务「${n}」`,
        );
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit"
              ? "编辑定时任务"
              : mode === "duplicate"
                ? "复制为新任务"
                : template
                  ? `使用模板「${template.title}」`
                  : "添加定时任务"}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "修改后保存,下一次触发按新计划执行。"
              : "按计划在独立 session 里跑一次 agent turn,产出可在侧边栏看到。"}
          </DialogDescription>
          {sourceTz && sourceTz !== getLocalTz() && (
            <div
              className="mt-2 rounded-md px-3 py-1.5 text-[11.5px]"
              style={{
                background: "color-mix(in oklch, var(--mh-warn) 8%, transparent)",
                color: "var(--mh-warn)",
                border: "1px solid color-mix(in oklch, var(--mh-warn) 30%, transparent)",
              }}
            >
              原任务时区 <code>{sourceTz}</code>,保存后将使用本地时区 <code>{getLocalTz()}</code>
            </div>
          )}
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          {/* 名称 */}
          <Field label="名称">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如:每日 AI 新闻"
              maxLength={60}
              autoFocus
            />
          </Field>

          {/* 提示词 */}
          <Field label="提示词">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="告诉 AI 你想让它做什么。可以很具体:格式、字数、输出结构、语气"
              rows={8}
              className="min-h-[160px] resize-y"
            />
          </Field>

          {/* 技能选择(可选) */}
          <SkillsPicker
            all={availableSkills}
            selected={selectedSkills}
            onToggle={toggleSkill}
            onClear={() => setSelectedSkills([])}
          />

          {/* 执行频率 */}
          <Field label="执行频率">
            <div className="flex flex-col gap-3">
              {rawExprReadOnly ? (
                // 无法反解的高级 cron 表达式 —— 只读展示,给用户清除入口
                <div
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-[12px]"
                  style={{
                    background: "var(--mh-surface-sub)",
                    border: "1px dashed var(--mh-stroke)",
                    color: "var(--mh-text-muted)",
                  }}
                >
                  <span>使用 cron 表达式:</span>
                  <code className="font-mono" style={{ color: "var(--mh-text)" }}>
                    {rawExprReadOnly}
                  </code>
                  <button
                    type="button"
                    onClick={() => setRawExprReadOnly("")}
                    className="ml-auto rounded border border-[var(--mh-stroke)] px-2 py-0.5 text-[11px] hover:bg-white/60 dark:hover:bg-white/5"
                  >
                    清除并重设
                  </button>
                </div>
              ) : (
              <div className="inline-flex gap-1 rounded-full bg-black/[0.04] p-1 text-xs dark:bg-white/[0.06]">
                <FreqBtn active={freq === "daily"} onClick={() => setFreq("daily")}>
                  每天
                </FreqBtn>
                <FreqBtn
                  active={freq === "interval"}
                  onClick={() => setFreq("interval")}
                >
                  按间隔
                </FreqBtn>
                <FreqBtn active={freq === "once"} onClick={() => setFreq("once")}>
                  单次
                </FreqBtn>
              </div>
              )}

              {!rawExprReadOnly && freq === "daily" && (
                <div className="flex flex-col gap-2">
                  <Input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-[120px]"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAY_LABELS.map(({ key, label }) => {
                      const on = weekdays.includes(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => toggleWeekday(key)}
                          className={cn(
                            "h-7 w-9 rounded-full text-xs transition",
                            on
                              ? "bg-foreground text-background"
                              : "bg-muted text-muted-foreground hover:bg-muted/70",
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {!rawExprReadOnly && freq === "interval" && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">每</span>
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    value={intervalMin}
                    onChange={(e) =>
                      setIntervalMin(parseInt(e.target.value, 10) || 1)
                    }
                    className="w-20"
                  />
                  <span className="text-muted-foreground">分钟跑一次</span>
                </div>
              )}

              {!rawExprReadOnly && freq === "once" && (
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={onceDate}
                    onChange={(e) => setOnceDate(e.target.value)}
                    className="w-[160px]"
                  />
                  <Input
                    type="time"
                    value={onceTime}
                    onChange={(e) => setOnceTime(e.target.value)}
                    className="w-[120px]"
                  />
                </div>
              )}
            </div>
          </Field>
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending || update.isPending}
          >
            取消
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={create.isPending || update.isPending}
          >
            {(create.isPending || update.isPending) && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            {mode === "edit" ? "保存" : mode === "duplicate" ? "创建副本" : "添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function SkillsPicker({
  all,
  selected,
  onToggle,
  onClear,
}: {
  all: SkillStatusEntry[];
  selected: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return all;
    return all.filter(
      (x) =>
        x.name?.toLowerCase().includes(s) ||
        x.skillKey?.toLowerCase().includes(s) ||
        x.description?.toLowerCase().includes(s),
    );
  }, [all, q]);

  const selectedEntries = selected
    .map((key) => all.find((s) => s.skillKey === key))
    .filter((x): x is SkillStatusEntry => !!x);

  return (
    <div className="flex flex-col gap-2">
      {/* 标签行:左文字 + 右触发按钮(位置固定,不会跟选择跳动) */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          可用技能（可选）
        </span>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full bg-white/50 px-2.5 text-xs text-foreground/70 ring-1 ring-black/[0.04] transition hover:bg-white hover:text-foreground hover:ring-black/10 dark:bg-white/[0.04] dark:text-foreground/70 dark:ring-white/[0.06] dark:hover:bg-white/[0.08] dark:hover:text-foreground dark:hover:ring-white/15",
                selected.length > 0 && "text-foreground",
              )}
            >
              <Package className="h-3 w-3" />
              <span>
                {selected.length > 0 ? `Skills · ${selected.length}` : "Skills"}
              </span>
              <ChevronDown className="h-2.5 w-2.5 opacity-60" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[360px] p-0" align="end" sideOffset={6}>
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索技能"
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                autoFocus
              />
            </div>
            {selected.length > 0 && (
              <div className="flex items-center justify-between border-b border-border px-3 py-1 text-[11px] text-muted-foreground">
                <span>已选 {selected.length} 个</span>
                <button
                  type="button"
                  onClick={onClear}
                  className="hover:text-foreground"
                >
                  清空
                </button>
              </div>
            )}
            <div className="max-h-[320px] overflow-y-auto p-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {all.length === 0 ? "暂无可用技能" : "没有匹配项"}
                </div>
              ) : (
                filtered.map((s) => {
                  const on = selected.includes(s.skillKey);
                  return (
                    <button
                      key={s.skillKey}
                      type="button"
                      onClick={() => onToggle(s.skillKey)}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-xs transition hover:bg-accent",
                        on && "bg-accent/50",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background",
                        )}
                      >
                        {on && <Check className="h-2.5 w-2.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 font-medium">
                          {s.emoji && <span>{s.emoji}</span>}
                          <span className="truncate">{s.name}</span>
                        </div>
                        {s.description && (
                          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                            {s.description}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* 选中 chips(独占下方,不影响按钮位置) */}
      {selectedEntries.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedEntries.map((s) => (
            <span
              key={s.skillKey}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary"
            >
              {s.emoji && <span>{s.emoji}</span>}
              {s.name}
              <button
                type="button"
                onClick={() => onToggle(s.skillKey)}
                className="ml-0.5 opacity-60 hover:opacity-100"
                aria-label={`移除 ${s.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          留空则使用默认 agent 的全部技能
        </p>
      )}
    </div>
  );
}

function FreqBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 font-medium transition",
        active
          ? "bg-white/95 text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-black/[0.05] dark:bg-white/[0.1] dark:ring-white/[0.08] dark:shadow-none"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
