import { useMemo, useState } from "react";
import {
  ArrowLeft,
  File,
  FileText,
  GitCompare,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import {
  useBaselineText,
  useCaptureBaseline,
  useReadCurrentText,
  useRevertToBaseline,
  useSnapshotDiff,
  useWatchTaskFolder,
} from "@/hooks/use-fs-tree";
import { useCurrentTaskFolder } from "@/hooks/use-task-folder";
import { usePreviewStore } from "@/stores/preview-store";
import { useChatStore } from "@/stores/chat-store";
import { Button } from "@/components/ui/button";
import { diffLines, diffStats } from "@/lib/diff";
import { cn } from "@/lib/utils";
import { showConfirm } from "@/lib/prompt";

type DetailTab = "diff" | "baseline" | "current";

/**
 * 变更 Tab:对比当前任务目录 vs 建立基线时的状态。
 * 基线在 session 首次绑定任务目录时自动建立。
 * 文本文件可 before/after 切换对比;二进制仅标记状态,点击走预览。
 */
export function ChangesTab() {
  const { data: taskPath } = useCurrentTaskFolder();
  const { data: diff = [], isLoading, refetch } = useSnapshotDiff(taskPath);
  const capture = useCaptureBaseline();
  useWatchTaskFolder(taskPath);

  const [detail, setDetail] = useState<{ rel: string; kind: ChangeEntry["kind"] } | null>(null);

  if (!taskPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <GitCompare className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">当前对话未绑定任务目录</p>
        <p className="text-xs text-muted-foreground/70">
          绑定任务目录后,AI 的所有产出和修改会在这里呈现。
        </p>
      </div>
    );
  }

  if (detail) {
    return (
      <DetailView
        taskPath={taskPath}
        entry={detail}
        onBack={() => setDetail(null)}
      />
    );
  }

  const added = diff.filter((d) => d.kind === "added");
  const modified = diff.filter((d) => d.kind === "modified");
  const deleted = diff.filter((d) => d.kind === "deleted");

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-black/[0.05] px-3 py-2 dark:border-white/[0.06]">
        <div className="flex gap-2 text-[11px] text-foreground/55">
          <CountBadge
            icon={<Plus className="h-2.5 w-2.5" />}
            count={added.length}
            label="新增"
            tone="add"
          />
          <CountBadge
            icon={<Pencil className="h-2.5 w-2.5" />}
            count={modified.length}
            label="修改"
            tone="mod"
          />
          <CountBadge
            icon={<Minus className="h-2.5 w-2.5" />}
            count={deleted.length}
            label="删除"
            tone="del"
          />
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            title="刷新"
            onClick={() => refetch()}
          >
            <RefreshCw />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            title="把当前状态重建为新基线(已有变更清零)"
            onClick={async () => {
              const ok = await showConfirm({
                title: "重建基线?",
                description: "把当前状态作为新基线,已记录的变更清单会清零。",
                confirmText: "重建",
              });
              if (ok) capture.mutate(taskPath);
            }}
            disabled={capture.isPending}
          >
            <RotateCcw />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            加载中…
          </div>
        ) : diff.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <GitCompare className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">暂无变更</p>
            <p className="text-[11px] text-muted-foreground/70">
              AI 写/改/删任何文件后会自动出现在这里。
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 p-1.5">
            {diff.map((e) => (
              <ChangeRow
                key={e.kind + ":" + e.rel}
                entry={e}
                onClick={() => setDetail({ rel: e.rel, kind: e.kind })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CountBadge({
  icon,
  count,
  label,
  tone,
}: {
  icon: React.ReactNode;
  count: number;
  label: string;
  tone: "add" | "mod" | "del";
}) {
  const colors: Record<typeof tone, string> = {
    add: "text-emerald-600 dark:text-emerald-400",
    mod: "text-amber-600 dark:text-amber-400",
    del: "text-rose-600 dark:text-rose-400",
  };
  return (
    <span className={cn("flex items-center gap-0.5", colors[tone])}>
      {icon}
      <span className="font-mono">{count}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function ChangeRow({
  entry,
  onClick,
}: {
  entry: ChangeEntry;
  onClick: () => void;
}) {
  const kindColor: Record<ChangeEntry["kind"], string> = {
    added:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
    modified:
      "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
    deleted: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400",
  };
  const kindLabel: Record<ChangeEntry["kind"], string> = {
    added: "+",
    modified: "~",
    deleted: "-",
  };
  const Icon = entry.isText || entry.hasBaselineText ? FileText : File;

  const name = entry.rel.split("/").pop() ?? entry.rel;
  const parent = entry.rel.includes("/")
    ? entry.rel.slice(0, entry.rel.lastIndexOf("/"))
    : "";

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-muted/60"
    >
      <span
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-md font-mono text-xs",
          kindColor[entry.kind],
        )}
      >
        {kindLabel[entry.kind]}
      </span>
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs">{name}</div>
        {parent && (
          <div className="truncate font-mono text-[10px] text-muted-foreground">
            {parent}
          </div>
        )}
      </div>
      {entry.size !== undefined && (
        <span className="shrink-0 text-[10px] text-muted-foreground/70">
          {formatSize(entry.size)}
        </span>
      )}
    </button>
  );
}

function DetailView({
  taskPath,
  entry,
  onBack,
}: {
  taskPath: string;
  entry: { rel: string; kind: ChangeEntry["kind"] };
  onBack: () => void;
}) {
  const sessionKey = useChatStore((s) => s.sessionKey);
  const openPreview = usePreviewStore((s) => s.openPreview);
  const revert = useRevertToBaseline();

  const { data: baselineText } = useBaselineText(taskPath, entry.rel);
  const { data: currentText } = useReadCurrentText(taskPath, entry.rel);

  const hasBaseline = baselineText != null;
  const hasCurrent = currentText != null && entry.kind !== "deleted";
  const canDiff = hasBaseline && hasCurrent;

  const defaultTab: DetailTab = canDiff
    ? "diff"
    : entry.kind === "deleted"
      ? "baseline"
      : hasCurrent
        ? "current"
        : "baseline";
  const [tab, setTab] = useState<DetailTab>(defaultTab);

  const canPreviewAsFile = entry.kind !== "deleted";
  const canRevert = hasBaseline && entry.kind !== "added"; // 新增的没基线,还原 = 删

  const handlePreview = () => {
    if (!canPreviewAsFile) return;
    const url = `mhclaw-workspace://fs/${encodeURIComponent(sessionKey)}/${encodeURI(entry.rel)}`;
    openPreview({
      id: `ws:${sessionKey}:${entry.rel}`,
      title: entry.rel,
      kind: "url",
      url,
    });
  };

  const handleRevert = async () => {
    if (!canRevert || baselineText == null) return;
    const ok = await showConfirm({
      title: "还原到基线?",
      description: `「${entry.rel}」当前内容会被覆盖,无法撤销。`,
      confirmText: "还原",
      danger: true,
    });
    if (!ok) return;
    revert.mutate({ taskPath, rel: entry.rel, baselineText });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-black/[0.05] px-3 py-2 dark:border-white/[0.06]">
        <Button variant="ghost" size="icon-xs" onClick={onBack} title="返回">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{entry.rel}</div>
          <div className="truncate text-[10px] text-muted-foreground">
            {entry.kind === "added" && "新增"}
            {entry.kind === "modified" && "修改"}
            {entry.kind === "deleted" && "删除"}
          </div>
        </div>
        {canRevert && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 text-xs"
            onClick={handleRevert}
            disabled={revert.isPending}
            title="把当前内容还原到基线状态"
          >
            <RotateCcw className="h-3 w-3" />
            还原
          </Button>
        )}
        {canPreviewAsFile && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={handlePreview}
          >
            预览
          </Button>
        )}
      </div>

      {(hasBaseline || hasCurrent) && (
        <div className="flex items-center gap-1 border-b border-black/[0.05] px-2 py-1 dark:border-white/[0.06]">
          {canDiff && (
            <TabBtn active={tab === "diff"} onClick={() => setTab("diff")}>
              差异
            </TabBtn>
          )}
          {hasBaseline && (
            <TabBtn
              active={tab === "baseline"}
              onClick={() => setTab("baseline")}
            >
              基线
            </TabBtn>
          )}
          {hasCurrent && (
            <TabBtn
              active={tab === "current"}
              onClick={() => setTab("current")}
            >
              当前
            </TabBtn>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto bg-muted/20">
        {!hasBaseline && !hasCurrent ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="text-xs text-muted-foreground">
              非文本文件,基线未保存原文。
              {canPreviewAsFile && " 可点击右上「预览」查看当前版本。"}
            </p>
          </div>
        ) : tab === "diff" && canDiff ? (
          <DiffView baseline={baselineText!} current={currentText!} />
        ) : (
          <pre className="whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-5 text-foreground">
            {tab === "baseline" ? baselineText ?? "" : currentText ?? ""}
          </pre>
        )}
      </div>
    </div>
  );
}

function DiffView({ baseline, current }: { baseline: string; current: string }) {
  const lines = useMemo(() => diffLines(baseline, current), [baseline, current]);
  const stats = useMemo(() => diffStats(lines), [lines]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-3 py-1.5 text-[11px]">
        <span className="text-emerald-600 dark:text-emerald-400">
          +{stats.adds}
        </span>
        <span className="text-rose-600 dark:text-rose-400">-{stats.dels}</span>
        <span className="text-muted-foreground">{stats.common} 行未变</span>
      </div>
      <div className="flex-1 overflow-auto font-mono text-[11px] leading-5">
        {lines.map((l, i) => (
          <div
            key={i}
            className={cn(
              "flex gap-2 px-3",
              l.kind === "add" &&
                "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
              l.kind === "del" &&
                "bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-200",
            )}
          >
            <span className="w-10 shrink-0 select-none text-right text-muted-foreground/60">
              {l.oldLineNo ?? ""}
            </span>
            <span className="w-10 shrink-0 select-none text-right text-muted-foreground/60">
              {l.newLineNo ?? ""}
            </span>
            <span className="w-3 shrink-0 select-none text-muted-foreground/80">
              {l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
            </span>
            <span className="whitespace-pre-wrap break-words">
              {l.line || "\u00a0"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TabBtn({
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
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-1 text-xs transition",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-muted/60",
      )}
    >
      {children}
    </button>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
