import { ExternalLink, FileQuestion, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { usePreviewStore } from "@/stores/preview-store";
import { isCanvasRelative, resolveCanvasUrl } from "@/lib/embed";
import { Button } from "@/components/ui/button";
import {
  CsvRenderer,
  DocxRenderer,
  ExcelRenderer,
  JsonRenderer,
  MarkdownRenderer,
  TextRenderer,
  detectPreviewKind,
} from "./renderers";

/**
 * 预览面板：
 * - kind=url   → iframe 加载（canvas URL 或 http(s)）
 * - kind=file  → 后续通过 mhclaw-workspace:// 协议加载；当前主进程协议未注册时走占位
 * - 图片、markdown、csv、excel 等 renderer 后续按 suffix 分派（本版先只实装 HTML/URL 最通用路径）
 */
export function PreviewTab() {
  const current = usePreviewStore((s) => s.current);
  const [nonce, setNonce] = useState(0); // 用于强制刷新 iframe

  const resolvedUrl = useMemo(() => {
    if (!current?.url) return "";
    if (isCanvasRelative(current.url)) return resolveCanvasUrl(current.url);
    return current.url;
  }, [current?.url]);

  if (!current) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center px-6">
        <FileQuestion className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">暂无预览内容</p>
        <p className="text-xs text-muted-foreground/70">
          当 AI 输出带 <code className="rounded bg-muted px-1 font-mono">[embed]</code>{" "}
          的富内容时，点击消息里的"打开预览"按钮会显示在这里
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶部：标题 + 操作 */}
      <div className="flex items-center justify-between gap-2 border-b border-black/[0.05] px-3 py-2 dark:border-white/[0.06]">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{current.title}</div>
          {resolvedUrl && (
            <div className="truncate font-mono text-[10px] text-foreground/55">
              {resolvedUrl}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setNonce((n) => n + 1)}
            title="刷新"
          >
            <RefreshCw />
          </Button>
          {resolvedUrl && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => window.open(resolvedUrl, "_blank")}
              title="浏览器打开"
            >
              <ExternalLink />
            </Button>
          )}
        </div>
      </div>

      {/* 内容 */}
      <div className="min-h-0 flex-1 overflow-hidden bg-muted/30">
        {resolvedUrl ? (
          <PreviewContent
            key={`${resolvedUrl}-${nonce}`}
            url={resolvedUrl}
            title={current.title}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="text-xs text-muted-foreground">
              文件协议加载尚未启用（mhclaw-workspace://）。
              <br />
              先在聊天里让 AI 用 <code className="font-mono">[embed]</code>{" "}
              输出 URL 内容试试。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewContent({ url, title }: { url: string; title: string }) {
  const kind = useMemo(() => detectPreviewKind(url), [url]);
  switch (kind) {
    case "markdown":
      return <MarkdownRenderer url={url} />;
    case "csv":
      return <CsvRenderer url={url} />;
    case "json":
      return <JsonRenderer url={url} />;
    case "text":
      return <TextRenderer url={url} />;
    case "excel":
      return <ExcelRenderer url={url} />;
    case "docx":
      return <DocxRenderer url={url} />;
    default:
      return (
        <iframe
          src={url}
          title={title}
          className="h-full w-full border-0 bg-background"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      );
  }
}
