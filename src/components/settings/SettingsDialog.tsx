import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Database,
  ExternalLink,
  Loader2,
  Settings as SettingsIcon,
  ShieldCheck,
} from "lucide-react";
import { DataManagementPane } from "@/components/archive/DataManagementDialog";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type Tab = "system" | "permissions" | "data";

const FONT_SIZES = [
  { key: "sm", label: "小", px: 14 },
  { key: "md", label: "默认", px: 16 },
  { key: "lg", label: "大", px: 18 },
] as const;

type FontSize = (typeof FONT_SIZES)[number]["key"];

const FONT_KEY = "mhclaw.fontSize";

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>("system");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          // 宽度强制覆盖默认 max-w-lg;高度用 min-h 给足呼吸,内容不够时自适应
          "!p-0 sm:!max-w-[920px]",
          "grid grid-cols-[200px_1fr] gap-0 overflow-hidden",
          "h-[640px] max-h-[85vh]",
        )}
      >
        {/* Radix 要求 DialogContent 有 Title(可访问性);用 sr-only 视觉隐藏但保留给屏幕阅读器 */}
        <DialogTitle className="sr-only">设置</DialogTitle>
        {/* 左侧导航 */}
        <nav className="flex flex-col gap-1 border-r border-border bg-muted/30 p-3">
          <h2 className="mb-2 px-2 pt-1 text-xs font-semibold tracking-wide text-muted-foreground">
            设置
          </h2>
          <NavItem
            active={tab === "system"}
            icon={<SettingsIcon className="h-4 w-4" />}
            label="系统设置"
            onClick={() => setTab("system")}
          />
          <NavItem
            active={tab === "permissions"}
            icon={<ShieldCheck className="h-4 w-4" />}
            label="系统授权"
            onClick={() => setTab("permissions")}
          />
          <NavItem
            active={tab === "data"}
            icon={<Database className="h-4 w-4" />}
            label="数据管理"
            onClick={() => setTab("data")}
          />
        </nav>

        {/* 右侧内容 */}
        <div className="flex min-w-0 flex-col overflow-y-auto">
          {tab === "system" ? (
            <SystemPane />
          ) : tab === "permissions" ? (
            <PermissionsPane />
          ) : (
            <DataManagementPane />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NavItem({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition",
        active
          ? "bg-background font-medium text-foreground shadow-sm ring-1 ring-black/[0.05] dark:ring-white/[0.06]"
          : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── 系统设置 ────────────────────────────────────────────────────────

function SystemPane() {
  const [fontSize, setFontSize] = useState<FontSize>(() => {
    try {
      const saved = localStorage.getItem(FONT_KEY) as FontSize | null;
      return saved && FONT_SIZES.some((f) => f.key === saved) ? saved : "md";
    } catch {
      return "md";
    }
  });
  const [preventSleep, setPreventSleep] = useState(false);
  const [sleepLoading, setSleepLoading] = useState(false);

  useEffect(() => {
    window.cjtClaw?.system?.getPreventSleep().then((s) => setPreventSleep(s.active));
  }, []);

  useEffect(() => {
    const size = FONT_SIZES.find((f) => f.key === fontSize) ?? FONT_SIZES[1];
    document.documentElement.style.fontSize = `${size.px}px`;
    try {
      localStorage.setItem(FONT_KEY, fontSize);
    } catch {
      /* ignore */
    }
  }, [fontSize]);

  const handleSleepChange = async (v: boolean) => {
    setSleepLoading(true);
    try {
      const res = await window.cjtClaw?.system?.setPreventSleep(v);
      setPreventSleep(res?.active ?? v);
      toast.success(v ? "已开启防休眠" : "已关闭防休眠");
    } catch (e) {
      toast.error("切换失败", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSleepLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-8 px-8 py-7">
      <PaneHeader title="系统设置" />

      {/* 显示语言 */}
      <RowStack
        title="显示语言"
        description="应用界面的显示语言"
        trailing={
          <select
            disabled
            className="h-9 min-w-[140px] rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
          >
            <option>中文(简体)</option>
          </select>
        }
      />

      {/* 字体大小 */}
      <div>
        <h3 className="text-sm font-medium">字体大小</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          调整应用整体字号,对所有界面生效
        </p>
        <div className="mt-3 inline-flex rounded-lg border border-input bg-muted/40 p-1">
          {FONT_SIZES.map((f) => (
            <button
              key={f.key}
              onClick={() => setFontSize(f.key)}
              className={cn(
                "rounded-md px-5 py-1.5 transition",
                fontSize === f.key
                  ? "bg-background font-medium shadow-sm ring-1 ring-black/[0.05] dark:ring-white/[0.06]"
                  : "text-muted-foreground hover:text-foreground",
              )}
              style={{ fontSize: `${f.px}px` }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* 防休眠 */}
      <RowStack
        title="防休眠"
        description="开启后电脑不会进入睡眠,适合 AI 长时间自动化任务持续运行"
        trailing={
          <div className="flex items-center gap-2">
            {sleepLoading && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
            <Switch
              checked={preventSleep}
              onCheckedChange={handleSleepChange}
              disabled={sleepLoading}
            />
          </div>
        }
      />
    </div>
  );
}

// ─── 系统授权 ────────────────────────────────────────────────────────

interface PermissionsState {
  platform: NodeJS.Platform;
  supported: boolean;
  accessibility?: boolean;
}

function PermissionsPane() {
  const [state, setState] = useState<PermissionsState | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const s = await window.cjtClaw?.system?.getPermissions();
      setState(s ?? null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const openPrivacy = async (
    kind: "fullDisk" | "accessibility" | "automation" | "notifications",
  ) => {
    await window.cjtClaw?.system?.openPrivacy(kind);
  };

  return (
    <div className="flex flex-col gap-5 px-8 py-7">
      <div className="flex items-start justify-between gap-4 pr-8">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">系统授权</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            mhclaw 在电脑上运行需要的系统权限
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={loading}
          className="shrink-0"
        >
          {loading && <Loader2 className="h-3 w-3 animate-spin" />}
          检查授权
        </Button>
      </div>

      {state && !state.supported && (
        <div className="rounded-lg border border-dashed border-muted-foreground/30 px-4 py-10 text-center text-sm text-muted-foreground">
          当前系统({state.platform})无需配置这些授权。
        </div>
      )}

      {state && state.supported && (
        <div className="flex flex-col gap-2">
          <PermissionRow
            title="完全磁盘访问权限"
            description="允许 AI 读写磁盘上的文件,部分文档/数据处理任务需要"
            onAction={() => openPrivacy("fullDisk")}
          />
          <PermissionRow
            title="辅助功能"
            description="允许响应键盘快捷键、跨应用操作"
            granted={state.accessibility}
            onAction={() => openPrivacy("accessibility")}
          />
          <PermissionRow
            title="自动化"
            description="允许给其他 App 发指令,如管理日历、提醒事项、备忘录"
            onAction={() => openPrivacy("automation")}
          />
          <PermissionRow
            title="通知"
            description="允许发送桌面通知,任务完成或有新消息时及时提醒"
            onAction={() => openPrivacy("notifications")}
          />
        </div>
      )}
    </div>
  );
}

function PermissionRow({
  title,
  description,
  granted,
  onAction,
}: {
  title: string;
  description: string;
  granted?: boolean;
  onAction: () => void;
}) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-muted/30 px-4 py-3.5">
      <ShieldCheck className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{title}</span>
          {granted === true && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              已授权
            </span>
          )}
          {granted === false && (
            <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
              未授权
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {description}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onAction} className="shrink-0">
        去授权
        <ExternalLink className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ─── 通用子件 ────────────────────────────────────────────────────────

function PaneHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="pr-8">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {description && (
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

function RowStack({
  title,
  description,
  trailing,
}: {
  title: string;
  description?: string;
  trailing: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium">{title}</h3>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="shrink-0">{trailing}</div>
    </div>
  );
}

/** 启动时恢复字体大小(不依赖 Dialog 打开) */
export function applyPersistedFontSize() {
  try {
    const saved = localStorage.getItem(FONT_KEY) as FontSize | null;
    const size = FONT_SIZES.find((f) => f.key === saved) ?? FONT_SIZES[1];
    document.documentElement.style.fontSize = `${size.px}px`;
  } catch {
    /* ignore */
  }
}
