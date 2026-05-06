import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Archive,
  Crosshair,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import { useChatStore, type SessionInfo } from "@/stores/chat-store";
import { useDeleteSession, useSessions } from "@/hooks/use-sessions";
import { useCrons } from "@/hooks/use-crons";
import { useArchiveStore } from "@/stores/archive-store";
import { stripMarkers } from "@/lib/markers";
import { UserMenu } from "./UserMenu";
import { IconBadge } from "@/components/brand/Logo";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/claw", icon: Crosshair, label: "Claw" },
  { to: "/experts", icon: Users, label: "专家" },
  { to: "/skills", icon: Wrench, label: "技能" },
  { to: "/automation", icon: Zap, label: "自动化" },
];

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === "/";

  const currentSessionKey = useChatStore((s) => s.sessionKey);
  const sessionTitles = useChatStore((s) => s.sessionTitles);
  const hasMessages = useChatStore((s) => s.messages.length > 0);
  const isLoadingCurrent = useChatStore((s) => s.loading);
  // Live first-user-message of the current session. lockSessionTitle
  // has a timing window (around the Gateway sessionKey rewrite); read
  // straight from the in-memory message stream so the sidebar updates
  // the instant the user sends.
  // NOTE: loadHistory results carry markers in `content` (Gateway
  // persists the post-injection payload), so we must stripMarkers to
  // get the clean user prompt.
  const liveCurrentTitle = useChatStore((s) => {
    const first = s.messages.find((m) => m.role === "user");
    if (!first?.content) return "";
    return stripMarkers(first.content).visibleText.trim();
  });
  const {
    data: allSessions = [],
    isLoading,
    hasMore,
    loadMore,
    isLoadingMore,
  } = useSessions();
  // Cron job-name lookup: cron-triggered session titles fall back to the job's name.
  const { data: cronJobs = [] } = useCrons();
  const cronNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of cronJobs) {
      if (j.id && j.name) m.set(j.id, j.name);
    }
    return m;
  }, [cronJobs]);
  const archivedList = useArchiveStore((s) => s.archived);
  const archive = useArchiveStore((s) => s.archive);
  const [pendingArchive, setPendingArchive] = useState<SessionInfo | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SessionInfo | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const deleteSession = useDeleteSession();
  const lockSessionTitle = useChatStore((s) => s.lockSessionTitle);

  const handleRename = (key: string, title: string) => {
    // force=true overrides any previously-frozen title.
    lockSessionTitle(key, title, true);
  };

  const handleOpenFolder = async (key: string) => {
    const api = window.cjtClaw?.taskFolder;
    if (!api) {
      toast.error("当前环境不支持打开文件夹");
      return;
    }
    try {
      const path = await api.getForSession(key);
      if (!path) {
        toast.info("该任务还没有绑定文件夹");
        return;
      }
      await api.openInFinder(path);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "打开文件夹失败");
    }
  };
  // Sessions from the `claw` agent are channel-dedicated main
  // conversations (WeChat / WeCom / DingTalk); their entry point lives
  // on the Claw page, not mixed into the desktop task list. Modeled
  // after WorkBuddy: the Claw main conversation has its own entry
  // and isn't part of "Tasks".
  // Archived sessions are likewise filtered out of the main list and
  // only visible in the "Data Management" dialog.
  const baseSessions = allSessions.filter(
    (s) => s.agentId !== "claw" && !archivedList.includes(s.key),
  );
  // Search: case-insensitive substring match across title / frozen title / key.
  const q = searchQuery.trim().toLowerCase();
  const sessions = q
    ? baseSessions.filter((s) => {
        const hay = [
          s.title ?? "",
          sessionTitles[s.key] ?? "",
          s.lastMessage ?? "",
          s.key,
        ]
          .join("\n")
          .toLowerCase();
        return hay.includes(q);
      })
    : baseSessions;

  // "New task" is a virtual "empty-session" state — only highlighted on
  // Home with no messages; mutually exclusive with selecting a session.
  const newTaskActive = isHome && !hasMessages;

  const handleNewTask = () => {
    useChatStore.getState().newSession();
    if (!isHome) navigate("/");
  };

  const handleSwitchSession = (key: string) => {
    useChatStore.getState().switchSession(key);
    if (!isHome) navigate("/");
  };

  return (
    <aside className="surface-pane relative flex h-full w-60 shrink-0 flex-col text-foreground border-r border-[var(--mh-sidebar-edge)]">
      {/* Logo 区:整条可拖,顶部留 traffic light 垂直空间 */}
      <div className="app-drag flex items-center gap-2 px-4 pt-9 pb-3">
        <IconBadge size={24} variant="gradient" />
        <span className="text-[14px] font-semibold tracking-tight">mhclaw</span>
        <span className="ml-auto rounded bg-[var(--mh-surface-sub)] px-1.5 py-[2px] text-[10.5px] text-[var(--mh-text-faint)]">⌘K</span>
      </div>

      {/* 搜索:柔底 pill(对齐 redesign:更矮、8px 圆角) */}
      <div className="px-3 pb-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--mh-text-faint)]" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索任务、技能、专家…"
            className="h-[30px] w-full rounded-lg bg-[var(--mh-surface-sub)] pl-7 pr-2 text-[12.5px] text-[var(--mh-text-subtle)] outline-none ring-1 ring-[var(--mh-stroke)] transition placeholder:text-[var(--mh-text-faint)] focus:bg-white focus:ring-[var(--mh-brand-line)] focus:text-[var(--mh-text)] dark:focus:bg-white/[0.08]"
          />
        </div>
      </div>

      {/* 主 CTA:紫色"新建任务" */}
      <div className="px-3 pb-3.5">
        <button
          onClick={handleNewTask}
          className={cn(
            "group flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium transition",
            "bg-[var(--mh-brand)] text-white shadow-brand-glow hover:bg-[var(--mh-brand-hover)]",
            newTaskActive && "ring-2 ring-[var(--mh-brand-line)] ring-offset-2 ring-offset-[var(--mh-page-b)]",
          )}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
          <span>新建任务</span>
          <span className="ml-auto text-[10.5px] opacity-70">⌘N</span>
        </button>
      </div>

      {/* 主导航 */}
      <nav className="flex flex-col gap-0.5 px-2">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to}>
            {({ isActive }) => (
              <SidebarItem
                active={isActive}
                icon={<Icon className="h-[15px] w-[15px]" strokeWidth={1.6} />}
                label={label}
              />
            )}
          </NavLink>
        ))}
      </nav>

      {/* 分组:任务(按状态/时间分桶) */}
      <div className="mt-2 flex flex-1 min-h-0 flex-col">
        {isLoading && sessions.length === 0 ? (
          <div className="px-5 py-2 text-[11.5px] text-[var(--mh-text-faint)]">加载中…</div>
        ) : sessions.length === 0 ? (
          <div className="px-5 py-2 text-[11.5px] text-[var(--mh-text-faint)]">
            {q ? `没有匹配 "${searchQuery.trim()}" 的任务` : "暂无任务"}
          </div>
        ) : (
          <TaskBuckets
            sessions={sessions}
            sessionTitles={sessionTitles}
            currentSessionKey={currentSessionKey}
            liveCurrentTitle={liveCurrentTitle}
            hasMessages={hasMessages}
            isLoadingCurrent={isLoadingCurrent}
            cronNameById={cronNameById}
            onSwitch={handleSwitchSession}
            onArchive={setPendingArchive}
            onRename={handleRename}
            onOpenFolder={handleOpenFolder}
            onDelete={setPendingDelete}
            // Hide "load earlier" while searching — search only filters
            // already-loaded sessions, so showing it would mislead the
            // user into thinking the results are partial when clicking
            // wouldn't help. Hiding is more honest.
            showLoadMore={!q && hasMore}
            loadMoreBusy={isLoadingMore}
            onLoadMore={loadMore}
          />
        )}
      </div>

      {/* 底部:用户菜单 */}
      <div className="p-2">
        <UserMenu />
      </div>

      {/* 归档确认 */}
      <AlertDialog
        open={!!pendingArchive}
        onOpenChange={(o) => !o && setPendingArchive(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>归档任务</AlertDialogTitle>
            <AlertDialogDescription>
              确认将该任务归档吗?归档后可在用户菜单 → "数据管理"中查看已归档任务,随时取消归档或删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingArchive) {
                  archive(pendingArchive.key);
                  // If archiving the active session, switch to a new
                  // "blank" state so the UI doesn't stay parked on an
                  // archived session.
                  if (pendingArchive.key === currentSessionKey) {
                    useChatStore.getState().newSession();
                  }
                }
                setPendingArchive(null);
              }}
            >
              确认归档
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除确认(硬删,走 sessions.delete RPC,不可恢复) */}
      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>永久删除任务?</AlertDialogTitle>
            <AlertDialogDescription>
              该操作不可恢复。任务的对话历史会从 Gateway 删除,任务产物文件夹保留在磁盘。
              如果只是不想看到,可以用「归档」代替。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!pendingDelete) return;
                const key = pendingDelete.key;
                setPendingDelete(null);
                try {
                  await deleteSession.mutateAsync(key);
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "删除失败",
                  );
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              永久删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}

/** Primary navigation item — active style: brand-soft pill + a 2px
 *  accent bar on the left edge (per redesign spec). */
function SidebarItem({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick?: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex w-full items-center gap-2.5 rounded-lg px-3 py-[7px] text-left text-[13px] transition",
        active
          ? "bg-[var(--mh-brand-soft)] font-medium text-[var(--mh-brand)]"
          : "text-[var(--mh-text-muted)] hover:bg-white/50 hover:text-[var(--mh-text)] dark:hover:bg-white/[0.04]",
      )}
    >
      {active && (
        <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded bg-[var(--mh-brand)]" />
      )}
      <span className={active ? "text-[var(--mh-brand)]" : "text-[var(--mh-text-subtle)]"}>
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      {badge != null && (
        <span className="text-[10.5px] tabular-nums text-[var(--mh-text-faint)]">{badge}</span>
      )}
    </button>
  );
}

/** Time buckets: Running · N / Today / Yesterday / Earlier. */
type BucketKey = "running" | "today" | "yesterday" | "earlier";

function bucketOf(
  session: SessionInfo,
  isCurrent: boolean,
  isLoadingCurrent: boolean,
): BucketKey {
  if (isCurrent && isLoadingCurrent) return "running";
  const ts = session.updatedAt ?? 0;
  if (!ts) return "earlier";
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yest0 = today0 - 24 * 3600 * 1000;
  if (ts >= today0) return "today";
  if (ts >= yest0) return "yesterday";
  return "earlier";
}

function TaskBuckets(props: {
  sessions: SessionInfo[];
  sessionTitles: Record<string, string>;
  currentSessionKey: string | null;
  liveCurrentTitle: string;
  hasMessages: boolean;
  isLoadingCurrent: boolean;
  cronNameById: Map<string, string>;
  onSwitch: (key: string) => void;
  onArchive: (s: SessionInfo) => void;
  onRename: (key: string, title: string) => void;
  onOpenFolder: (key: string) => void;
  onDelete: (s: SessionInfo) => void;
  showLoadMore: boolean;
  loadMoreBusy: boolean;
  onLoadMore: () => void;
}) {
  const buckets: Record<BucketKey, SessionInfo[]> = {
    running: [],
    today: [],
    yesterday: [],
    earlier: [],
  };
  for (const s of props.sessions) {
    const isCurrent = s.key === props.currentSessionKey;
    buckets[bucketOf(s, isCurrent, props.isLoadingCurrent)].push(s);
  }
  const order: { key: BucketKey; label: string; showCount?: boolean }[] = [
    { key: "running", label: "进行中", showCount: true },
    { key: "today", label: "今天" },
    { key: "yesterday", label: "昨天" },
    { key: "earlier", label: "更早" },
  ];

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-y-auto pb-1">
      {order.map(({ key, label, showCount }) => {
        const list = buckets[key];
        if (list.length === 0) return null;
        return (
          <div key={key} className="flex flex-col">
            <div className="flex items-center justify-between px-5 pt-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--mh-text-faint)]">
              <span>
                {label}
                {showCount ? ` · ${list.length}` : ""}
              </span>
              {!showCount && (
                <span className="font-normal tracking-normal">{list.length}</span>
              )}
            </div>
            <div className="flex flex-col gap-px px-2">
              {list.map((s) => {
                const isCurrent = s.key === props.currentSessionKey;
                const status: SessionStatus =
                  isCurrent && props.isLoadingCurrent
                    ? "running"
                    : "done";
                return (
                  <SessionItem
                    key={s.key}
                    session={s}
                    frozenTitle={props.sessionTitles[s.key]}
                    liveTitle={isCurrent ? props.liveCurrentTitle : ""}
                    cronName={s.cronJobId ? props.cronNameById.get(s.cronJobId) : undefined}
                    active={props.hasMessages && isCurrent}
                    status={status}
                    onClick={() => props.onSwitch(s.key)}
                    onArchive={() => props.onArchive(s)}
                    onRename={(title) => props.onRename(s.key, title)}
                    onOpenFolder={() => props.onOpenFolder(s.key)}
                    onDelete={() => props.onDelete(s)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {props.showLoadMore && (
        <button
          onClick={props.onLoadMore}
          disabled={props.loadMoreBusy}
          className="mx-5 mt-1 self-start text-[11.5px] text-[var(--mh-text-faint)] transition hover:text-[var(--mh-brand)] disabled:cursor-wait disabled:opacity-60"
        >
          {props.loadMoreBusy ? "加载中…" : "显示更早的任务"}
        </button>
      )}
    </div>
  );
}

type SessionStatus = "running" | "done" | "error" | "idle";

function SessionItem({
  session,
  frozenTitle,
  liveTitle,
  cronName,
  active,
  status,
  onClick,
  onArchive,
  onRename,
  onOpenFolder,
  onDelete,
}: {
  session: SessionInfo;
  frozenTitle?: string;
  liveTitle?: string;
  /** Cron job name for cron-triggered sessions (looked up via
   *  cron.list; undefined when the job has been deleted). */
  cronName?: string;
  active: boolean;
  status: SessionStatus;
  onClick: () => void;
  onArchive?: () => void;
  onRename?: (title: string) => void;
  onOpenFolder?: () => void;
  onDelete?: () => void;
}) {
  // When the Gateway can't supply a real title it falls back to
  // various meaningless forms — detect and discard:
  //   - "8c90bd41 (2026-04-18)" — hash + date
  //   - "[cron:21f31abb-90bb-...]" — auto-named cron sessions (UUID)
  const gatewayTitle = session.title?.trim() ?? "";
  const usableGatewayTitle =
    gatewayTitle &&
    !/^[a-f0-9]{6,16}\s*\(\d{4}-\d{2}-\d{2}\)$/i.test(gatewayTitle) &&
    !/^\[cron:[a-f0-9-]+\]$/i.test(gatewayTitle)
      ? gatewayTitle
      : "";
  // `lastMessage` can be the OpenClaw silent marker "NO_REPLY" /
  // "no_reply" — no user meaning, skip it.
  const lastMsg = session.lastMessage?.trim() ?? "";
  const usableLastMsg = /^no_reply$/i.test(lastMsg) ? "" : lastMsg;
  // liveTitle (the in-memory first-user-message of the current
  // session) has the highest priority — it shows up immediately on
  // send. Never expose `session.key` directly as a title — that's an
  // internal id like `agent:main:session-<ts>`. With nothing better,
  // fall back to "未命名任务" (an end-user phrasing in Chinese for
  // current users; will be i18n'd later).
  // For cron sessions, prefer the cron job's `name` (more meaningful);
  // fall through the chain if not found.
  const baseTitle =
    (session.isCron && cronName?.trim()) ||
    liveTitle?.trim() ||
    frozenTitle?.trim() ||
    usableGatewayTitle ||
    usableLastMsg ||
    "未命名任务";
  // Prefix cron-triggered session titles with "[定时任务]" so the user
  // can tell automated vs manual at a glance.
  const rawTitle = session.isCron ? `[定时任务] ${baseTitle}` : baseTitle;
  // Squash newlines / repeated whitespace to a single space so CSS truncate works on one line.
  const title = rawTitle.replace(/\s+/g, " ").trim();

  // Inline rename state.
  const [renaming, setRenaming] = useState(false);
  const [editText, setEditText] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus + select-all when entering rename mode.
  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  const commitRename = () => {
    const next = editText.trim();
    if (next && next !== title) onRename?.(next);
    setRenaming(false);
  };
  const cancelRename = () => {
    setEditText(title);
    setRenaming(false);
  };

  const dotColor =
    status === "running" ? "var(--mh-running)"
    : status === "error" ? "var(--mh-error)"
    : status === "done"  ? "var(--mh-success)"
    : "var(--mh-text-faint)";

  return (
    <div
      className={cn(
        "group/item flex w-full items-center gap-2 rounded-[7px] px-2.5 py-[6px] text-left text-[12.3px] transition",
        active
          ? "bg-[var(--mh-brand-soft)] font-medium text-[var(--mh-text)]"
          : "text-[var(--mh-text-muted)] hover:bg-white/50 hover:text-[var(--mh-text)] dark:hover:bg-white/[0.04]",
      )}
      title={session.key}
    >
      {renaming ? (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Pencil className="h-3 w-3 shrink-0 text-[var(--mh-text-subtle)]" />
          <input
            ref={inputRef}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelRename();
              }
            }}
            className="flex-1 bg-transparent text-[12.3px] outline-none"
            maxLength={60}
          />
        </div>
      ) : (
        <button
          onClick={onClick}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span
            className="h-[7px] w-[7px] shrink-0 rounded-full"
            style={{
              background: dotColor,
              boxShadow:
                status === "running"
                  ? `0 0 0 3px color-mix(in oklch, ${dotColor} 18%, transparent)`
                  : "none",
            }}
          />
          <span className="flex-1 truncate">{title}</span>
        </button>
      )}

      {/* 右侧:默认展示相对时间,hover 或 active 时显示 [...] + 归档两个按钮 */}
      {!renaming && (
        <div className="relative flex shrink-0 items-center">
          {(session.updatedAt ?? 0) > 0 && (
            <span
              className={cn(
                "text-[0.65625rem] tabular-nums transition-opacity group-hover/item:opacity-0",
                active ? "text-foreground/45" : "text-foreground/35",
              )}
            >
              {formatRelativeTime(session.updatedAt ?? 0)}
            </span>
          )}
          <div
            className={cn(
              "absolute right-0 flex items-center gap-0.5 transition-opacity",
              "opacity-0 group-hover/item:opacity-100",
            )}
          >
            {(onRename || onOpenFolder || onDelete) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    title="更多"
                    className="flex h-5 w-5 items-center justify-center rounded-full text-foreground/50 hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/10"
                  >
                    <MoreHorizontal className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  {onRename && (
                    <DropdownMenuItem
                      onClick={() => {
                        setEditText(title);
                        setRenaming(true);
                      }}
                    >
                      <Pencil />
                      重命名
                    </DropdownMenuItem>
                  )}
                  {onOpenFolder && (
                    <DropdownMenuItem onClick={onOpenFolder}>
                      <FolderOpen />
                      打开文件夹
                    </DropdownMenuItem>
                  )}
                  {onDelete && (
                    <DropdownMenuItem
                      onClick={onDelete}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 />
                      删除会话
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {onArchive && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onArchive();
                }}
                title="归档任务"
                className="flex h-5 w-5 items-center justify-center rounded-full text-foreground/50 hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/10"
              >
                <Archive className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Relative time: just-now / N min ago / N hr ago / N day ago / YYYY-MM-DD. */
function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
