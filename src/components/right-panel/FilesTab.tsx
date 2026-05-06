import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  RefreshCw,
} from "lucide-react";
import { useCurrentTaskFolder, useCreateBlankTask } from "@/hooks/use-task-folder";
import { useFileChildren } from "@/hooks/use-fs-tree";
import { usePreviewStore } from "@/stores/preview-store";
import { useChatStore } from "@/stores/chat-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 全部文件 Tab:展示当前 session 绑定的任务目录树。
 * 点击文件 → 右面板预览(走 mhclaw-workspace:// 协议)。
 * chokidar 订阅文件变更,自动刷新。
 */
export function FilesTab() {
  const { data: taskPath } = useCurrentTaskFolder();
  const createBlank = useCreateBlankTask();
  // watcher 由 RightPanel 常驻启动,不在 tab 维度重复订阅

  if (!taskPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <Folder className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">当前对话未绑定任务目录</p>
        <p className="text-xs text-muted-foreground/70">
          新建或选择一个目录,AI 的产出会写到那里,变更会在这里实时展示
        </p>
        <Button
          size="sm"
          onClick={() => createBlank.mutate()}
          disabled={createBlank.isPending}
        >
          <FolderPlus />
          新建任务目录
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Header taskPath={taskPath} />
      <div className="flex-1 overflow-y-auto py-1 pl-1 pr-2">
        <DirNode taskPath={taskPath} rel="" defaultOpen depth={0} />
      </div>
    </div>
  );
}

function Header({ taskPath }: { taskPath: string }) {
  const short = shortenHome(taskPath);
  return (
    <div className="flex items-center justify-between gap-2 border-b border-black/[0.05] px-3 py-2 dark:border-white/[0.06]">
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[11px] text-foreground/55">
          {short}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        title="在 Finder 中打开"
        onClick={() => window.cjtClaw?.taskFolder.openInFinder(taskPath)}
      >
        <FolderOpen />
      </Button>
    </div>
  );
}

function DirNode({
  taskPath,
  rel,
  defaultOpen,
  depth,
}: {
  taskPath: string;
  rel: string;
  defaultOpen?: boolean;
  depth: number;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const { data, isLoading, refetch } = useFileChildren(taskPath, rel);

  const children = data ?? [];

  return (
    <div>
      {rel !== "" && (
        <Row
          depth={depth}
          active={false}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          {open ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{rel.split("/").pop()}</span>
        </Row>
      )}

      {rel === "" && (
        <div className="flex items-center justify-between px-2 pb-1 pt-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>根目录 · {children.length} 项</span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => refetch()}
            title="刷新"
          >
            <RefreshCw className="h-2.5 w-2.5" />
          </Button>
        </div>
      )}

      {(rel === "" || open) && (
        <div>
          {isLoading ? (
            <Row depth={depth + 1} active={false}>
              <span className="text-xs text-muted-foreground">加载中…</span>
            </Row>
          ) : children.length === 0 ? (
            rel === "" ? (
              <Row depth={depth + 1} active={false}>
                <span className="text-xs text-muted-foreground">
                  目录为空 —— AI 还没产出文件
                </span>
              </Row>
            ) : null
          ) : (
            children.map((c) =>
              c.isDir ? (
                <DirNode
                  key={c.rel}
                  taskPath={taskPath}
                  rel={c.rel}
                  depth={rel === "" ? depth : depth + 1}
                />
              ) : (
                <FileRow
                  key={c.rel}
                  taskPath={taskPath}
                  node={c}
                  depth={rel === "" ? depth : depth + 1}
                />
              ),
            )
          )}
        </div>
      )}
    </div>
  );
}

function FileRow({
  taskPath: _taskPath,
  node,
  depth,
}: {
  taskPath: string;
  node: FsNode;
  depth: number;
}) {
  const current = usePreviewStore((s) => s.current);
  const openPreview = usePreviewStore((s) => s.openPreview);
  const sessionKey = useChatStore((s) => s.sessionKey);

  const previewId = `ws:${sessionKey}:${node.rel}`;
  const isActive = current?.id === previewId;

  const Icon = isTextLike(node.name) ? FileText : File;

  const handleOpen = () => {
    const url = `mhclaw-workspace://fs/${encodeURIComponent(sessionKey)}/${encodeURI(node.rel)}`;
    openPreview({
      id: previewId,
      title: node.name,
      kind: "url",
      url,
    });
  };

  return (
    <Row depth={depth + 1} active={isActive} onClick={handleOpen}>
      <span className="w-3 shrink-0" />
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{node.name}</span>
      {node.size !== undefined && (
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">
          {formatSize(node.size)}
        </span>
      )}
    </Row>
  );
}

function Row({
  children,
  depth,
  active,
  onClick,
}: {
  children: React.ReactNode;
  depth: number;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition",
        active
          ? "bg-accent text-foreground"
          : "text-foreground hover:bg-muted/60",
      )}
      style={{ paddingLeft: 4 + depth * 10 }}
    >
      {children}
    </button>
  );
}

const TEXT_EXT = new Set([
  ".txt", ".md", ".html", ".htm", ".css", ".js", ".mjs", ".ts", ".tsx", ".jsx",
  ".json", ".yaml", ".yml", ".toml", ".xml", ".csv", ".py", ".sh", ".log",
]);

function isTextLike(name: string): boolean {
  const i = name.lastIndexOf(".");
  if (i < 0) return false;
  return TEXT_EXT.has(name.slice(i).toLowerCase());
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function shortenHome(p: string): string {
  const m = p.match(/^\/Users\/[^/]+\//);
  if (m) return "~/" + p.slice(m[0].length);
  return p;
}
