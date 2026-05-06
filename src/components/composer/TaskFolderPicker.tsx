import { useMemo, useState } from "react";
import {
  Check,
  ExternalLink,
  Folder,
  FolderOpen,
  FolderPlus,
  Pin,
  PinOff,
  Search,
  Settings as SettingsIcon,
  Trash2,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useBindTaskFolder,
  useCreateBlankTask,
  useCurrentTaskFolder,
  usePickExternalTaskFolder,
  usePickWorkRoot,
  useRecentTaskFolders,
  useRemoveTaskFolderFromIndex,
  useTogglePinTaskFolder,
  useWorkRoot,
} from "@/hooks/use-task-folder";
import { cn } from "@/lib/utils";
import { showConfirm } from "@/lib/prompt";

/**
 * Composer 底部的"任务产出目录"按钮 + Popover。
 *
 * - 触发按钮:未绑定时显示 📂 "产出目录";已绑定时显示 📂 短路径
 * - Popover 内容:
 *   · 从空文件夹开始(工作根下新建时间戳子目录)
 *   · 打开新文件夹...(原生目录选择)
 *   · 设置工作根...(首行细字,显示当前根 + 改)
 *   · 最近使用(按时间倒序,pinned 置顶)
 */
export function TaskFolderPicker() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const { data: currentPath } = useCurrentTaskFolder();
  const { data: workRoot } = useWorkRoot();
  const { data: recent = [] } = useRecentTaskFolders();

  const createBlank = useCreateBlankTask();
  const pickExternal = usePickExternalTaskFolder();
  const bind = useBindTaskFolder();
  const pickRoot = usePickWorkRoot();
  const togglePin = useTogglePinTaskFolder();
  const removeFromIndex = useRemoveTaskFolderFromIndex();

  const shortPath = useShortPath(currentPath ?? null, workRoot?.path);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recent;
    return recent.filter(
      (r) =>
        r.displayName.toLowerCase().includes(q) ||
        r.path.toLowerCase().includes(q),
    );
  }, [recent, query]);

  const handleCreateBlank = async () => {
    try {
      await createBlank.mutateAsync();
      setOpen(false);
    } catch {
      // 错误自带在 mutation 状态
    }
  };

  const handlePickExternal = async () => {
    try {
      await pickExternal.mutateAsync();
      setOpen(false);
    } catch {
      //
    }
  };

  const handleBind = async (p: string) => {
    await bind.mutateAsync(p);
    setOpen(false);
  };

  const handleSetRoot = async () => {
    await pickRoot.mutateAsync();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 gap-1.5 rounded-full bg-white/50 px-2.5 text-xs ring-1 ring-black/[0.04] hover:bg-white hover:ring-black/10 dark:bg-white/[0.04] dark:ring-white/[0.06] dark:hover:bg-white/[0.08] dark:hover:ring-white/15",
            currentPath ? "text-foreground" : "text-foreground/70",
          )}
          title={currentPath ?? "选择产出目录"}
        >
          {currentPath ? (
            <FolderOpen className="h-3.5 w-3.5" />
          ) : (
            <Folder className="h-3.5 w-3.5" />
          )}
          <span className="max-w-[180px] truncate">
            {shortPath ?? "产出目录"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] p-1.5" sideOffset={6}>
        {/* 搜索 */}
        <div className="relative mb-1.5">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索任务目录..."
            className="h-8 pl-7 text-xs"
          />
        </div>

        {/* 快捷操作 */}
        <div className="flex flex-col gap-0.5">
          <ActionRow
            icon={<FolderPlus className="h-3.5 w-3.5" />}
            label="从空文件夹开始"
            sub={workRoot ? `将在 ${shortenHome(workRoot.path)} 下新建时间戳目录` : "需先设置工作根"}
            onClick={handleCreateBlank}
            disabled={!workRoot || createBlank.isPending}
          />
          <ActionRow
            icon={<FolderOpen className="h-3.5 w-3.5" />}
            label="打开新文件夹..."
            sub="选择已有目录作为本次任务的产出目录"
            onClick={handlePickExternal}
            disabled={pickExternal.isPending}
          />
          <ActionRow
            icon={<SettingsIcon className="h-3.5 w-3.5" />}
            label="设置工作根..."
            sub={workRoot ? shortenHome(workRoot.path) : "(未设置)"}
            onClick={handleSetRoot}
            disabled={pickRoot.isPending}
            subtle
          />
        </div>

        {/* 分隔线 */}
        <div className="my-1.5 border-t border-border" />

        {/* 最近 */}
        <div className="px-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          最近使用 · {filtered.length}
        </div>
        <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              {query ? "无匹配" : "还没有用过任何任务目录"}
            </div>
          ) : (
            filtered.map((r) => (
              <RecentRow
                key={r.path}
                entry={r}
                active={r.path === currentPath}
                onSelect={() => handleBind(r.path)}
                onPin={() => togglePin.mutate(r.path)}
                onRemove={async () => {
                  const ok = await showConfirm({
                    title: "从列表移除?",
                    description: `"${r.displayName}" 仅从最近列表移除,本地目录不会被删除。`,
                    confirmText: "移除",
                  });
                  if (ok) removeFromIndex.mutate(r.path);
                }}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ActionRow({
  icon,
  label,
  sub,
  onClick,
  disabled,
  subtle,
}: {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  onClick: () => void;
  disabled?: boolean;
  subtle?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      <div
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
          subtle ? "bg-muted/60 text-muted-foreground" : "bg-primary/10 text-primary",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn("text-xs", subtle ? "font-normal" : "font-medium")}>
          {label}
        </div>
        {sub && (
          <div className="truncate text-[10px] text-muted-foreground">{sub}</div>
        )}
      </div>
    </button>
  );
}

function RecentRow({
  entry,
  active,
  onSelect,
  onPin,
  onRemove,
}: {
  entry: OutputDirEntry;
  active: boolean;
  onSelect: () => void;
  onPin: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 rounded-md px-1.5 py-1 transition hover:bg-accent",
        active && "bg-accent",
      )}
    >
      <button
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted">
          {entry.kind === "blank" ? (
            <Folder className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ExternalLink className="h-3 w-3 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium">{entry.displayName}</span>
            {entry.pinned && <Pin className="h-2.5 w-2.5 text-primary" />}
            {active && <Check className="h-3 w-3 text-primary" />}
          </div>
          <div className="truncate font-mono text-[9px] text-muted-foreground">
            {shortenHome(entry.path)}
          </div>
        </div>
      </button>
      <div className="flex shrink-0 opacity-0 transition group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            onPin();
          }}
          title={entry.pinned ? "取消置顶" : "置顶"}
        >
          {entry.pinned ? <PinOff /> : <Pin />}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="从最近列表移除"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

/**
 * 短路径展示:
 * - 在工作根下 → 显示 "mhclaw/20260415...";
 * - 外部目录 → 显示 "~/Downloads/foo";
 * - 太长 → 截最后两段
 */
function useShortPath(full: string | null, workRootPath?: string): string | null {
  return useMemo(() => {
    if (!full) return null;
    if (workRootPath && full.startsWith(workRootPath)) {
      const rel = full.slice(workRootPath.length).replace(/^\/+/, "");
      const rootName = workRootPath.split("/").filter(Boolean).pop() ?? "";
      return rootName ? `${rootName}/${rel}` : rel;
    }
    return shortenHome(full);
  }, [full, workRootPath]);
}

function shortenHome(p: string): string {
  // 不读 os.homedir(在渲染层不可用),用简单 heuristic 把 /Users/<name>/ 换成 ~/
  const m = p.match(/^\/Users\/[^/]+\//);
  if (m) return "~/" + p.slice(m[0].length);
  // 太长时截最后两段
  const parts = p.split("/").filter(Boolean);
  if (parts.length > 3) return ".../" + parts.slice(-2).join("/");
  return p;
}
