import { ExternalLink, FileSpreadsheet, FileText, File, Image as ImageIcon } from "lucide-react";
import { useChatStore } from "@/stores/chat-store";
import { usePreviewStore } from "@/stores/preview-store";
import { useArtifactsForCurrentSession } from "@/hooks/use-artifacts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 产物 Tab:当前 session 的"有意义输出"。
 *
 * 数据源(主进程合并两路):
 *   1. source="embed" —— AI [embed] shortcode,落到 .mhclaw/artifacts.json
 *   2. source="fs"    —— task folder 里的成品文件(xlsx/docx/pdf/md/html/图片...)
 *                         白名单后缀,chokidar 驱动刷新
 *
 * 跟全部文件 Tab 的区别:那边是全景(包含脚本 / 日志 / 草稿),这边只展示成品。
 */
export function ArtifactsTab() {
  const sessionKey = useChatStore((s) => s.sessionKey);
  const { data, isLoading } = useArtifactsForCurrentSession();
  const openFromEmbed = usePreviewStore((s) => s.openPreviewFromEmbed);
  const openPreview = usePreviewStore((s) => s.openPreview);

  const entries = data ?? [];

  if (isLoading && entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        加载中…
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <FileText className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">本次任务暂无产物</p>
        <p className="text-xs text-muted-foreground/70">
          AI 在任务目录生成的成品文件,或输出带{" "}
          <code className="rounded bg-muted px-1 font-mono">[embed]</code>{" "}
          的富内容时会自动登记。
        </p>
      </div>
    );
  }

  const handleOpen = (e: ArtifactEntry) => {
    if (e.source === "fs" && e.relPath && sessionKey) {
      // host 固定 "fs",sessionKey 放 pathname 第一段 —— host 不能含 encoded colon
      const url = `mhclaw-workspace://fs/${encodeURIComponent(sessionKey)}/${encodeURI(e.relPath)}`;
      openPreview({
        id: `ws:${sessionKey}:${e.relPath}`,
        title: e.title || e.relPath,
        kind: "url",
        url,
      });
      return;
    }
    openFromEmbed({
      ref: e.ref,
      url: e.url,
      title: e.title,
      preferredHeight: e.preferredHeight,
      kind: e.kind,
    });
  };

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        本次任务 · {entries.length} 个产物
      </div>
      <div className="flex flex-col gap-1.5">
        {entries.map((e, i) => (
          <button
            key={keyOf(e, i)}
            onClick={() => handleOpen(e)}
            className={cn(
              "group flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left transition hover:border-foreground/20 hover:bg-accent",
            )}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
              <ArtifactIcon entry={e} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{displayTitle(e)}</div>
              <div className="truncate font-mono text-[10px] text-muted-foreground">
                {subtitleOf(e)}
              </div>
            </div>
            <Button
              asChild
              variant="ghost"
              size="icon-xs"
              className="opacity-0 transition group-hover:opacity-100"
            >
              <span>
                <ExternalLink />
              </span>
            </Button>
          </button>
        ))}
      </div>
    </div>
  );
}

function keyOf(e: ArtifactEntry, i: number): string {
  if (e.source === "fs") return `fs:${e.relPath}`;
  return `embed:${e.ref || e.url || i}`;
}

function displayTitle(e: ArtifactEntry): string {
  return e.title || e.ref || e.relPath || "未命名";
}

function subtitleOf(e: ArtifactEntry): string {
  if (e.source === "fs") {
    const size =
      e.size !== undefined
        ? e.size < 1024
          ? ` · ${e.size} B`
          : e.size < 1024 * 1024
            ? ` · ${(e.size / 1024).toFixed(1)} KB`
            : ` · ${(e.size / 1024 / 1024).toFixed(1)} MB`
        : "";
    return `${e.relPath ?? ""}${size}`;
  }
  return e.url || e.ref || "";
}

function ArtifactIcon({ entry }: { entry: ArtifactEntry }) {
  const name = (entry.relPath || entry.title || "").toLowerCase();
  if (/\.(xlsx|xls|csv)$/.test(name))
    return <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600/80" />;
  if (/\.(png|jpg|jpeg|gif|webp|svg)$/.test(name))
    return <ImageIcon className="h-3.5 w-3.5 text-indigo-500/80" />;
  if (/\.(md|html|htm|docx|doc|pdf)$/.test(name))
    return <FileText className="h-3.5 w-3.5 text-foreground/60" />;
  return <File className="h-3.5 w-3.5 text-muted-foreground" />;
}
