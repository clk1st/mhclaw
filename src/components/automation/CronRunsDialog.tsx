import { Loader2, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCronRuns, type CronRun } from "@/hooks/use-crons";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string | null;
  jobName?: string;
}

/**
 * 定时任务执行历史。调 cron.runs RPC 拉 50 条,展示 runAt / status / 耗时 / message。
 * 打开 Dialog 时才 enable 查询,关闭就不抓,省流量。
 */
export function CronRunsDialog({ open, onOpenChange, jobId, jobName }: Props) {
  const { data: runs = [], isLoading, error, refetch, isFetching } = useCronRuns(
    jobId,
    open,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate">执行历史</DialogTitle>
              <DialogDescription className="truncate">
                {jobName ? `「${jobName}」` : ""}最近 50 次
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isFetching}
              onClick={() => refetch()}
              title="刷新"
            >
              <RefreshCw
                className={isFetching ? "animate-spin" : undefined}
              />
            </Button>
          </div>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中…
            </div>
          ) : error ? (
            <div
              className="rounded-md px-3 py-2 text-sm"
              style={{
                color: "var(--mh-error)",
                background: "color-mix(in oklch, var(--mh-error) 6%, transparent)",
                border: "1px solid color-mix(in oklch, var(--mh-error) 30%, transparent)",
              }}
            >
              加载失败:{(error as Error).message}
            </div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-sm text-muted-foreground">
              <span>暂无执行记录</span>
              <span className="mt-1 text-xs text-muted-foreground/70">
                任务触发一次后才会有记录
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {runs.map((run, i) => (
                <RunRow key={run.id ?? i} run={run} />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RunRow({ run }: { run: CronRun }) {
  const ts = run.runAt ?? run.startedAt ?? 0;
  const when = ts > 0 ? new Date(ts).toLocaleString() : "--";
  const dur =
    typeof run.durationMs === "number" && run.durationMs > 0
      ? formatDuration(run.durationMs)
      : "";
  const status = run.status ?? "unknown";
  const errMsg = run.error?.trim();
  const msg = (errMsg || run.message || "").trim();

  return (
    <div
      className="flex items-start gap-3 rounded-md px-3 py-2.5 text-[12.5px]"
      style={{
        background: "var(--mh-surface-sub)",
        border: "1px solid var(--mh-stroke)",
      }}
    >
      <StatusBadge status={status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="tabular-nums" style={{ color: "var(--mh-text)" }}>
            {when}
          </span>
          {dur && (
            <span
              className="text-[11px] tabular-nums"
              style={{ color: "var(--mh-text-faint)" }}
            >
              · {dur}
            </span>
          )}
        </div>
        {msg && (
          <div
            className="mt-1 line-clamp-2 text-[11.5px]"
            style={{ color: "var(--mh-text-muted)" }}
            title={msg}
          >
            {msg}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    success: {
      label: "成功",
      color: "var(--mh-success)",
      bg: "color-mix(in oklch, var(--mh-success) 12%, transparent)",
    },
    failed: {
      label: "失败",
      color: "var(--mh-error)",
      bg: "color-mix(in oklch, var(--mh-error) 12%, transparent)",
    },
    timed_out: {
      label: "超时",
      color: "var(--mh-warn)",
      bg: "color-mix(in oklch, var(--mh-warn) 12%, transparent)",
    },
    running: {
      label: "运行中",
      color: "var(--mh-running)",
      bg: "color-mix(in oklch, var(--mh-running) 12%, transparent)",
    },
  };
  const m = map[status] ?? {
    label: status,
    color: "var(--mh-text-muted)",
    bg: "var(--mh-surface-sub)",
  };
  return (
    <span
      className="shrink-0 rounded-full px-2 py-[2px] text-[10.5px] font-medium"
      style={{ color: m.color, background: m.bg }}
    >
      {m.label}
    </span>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s - m * 60);
  return `${m}m ${rest}s`;
}
