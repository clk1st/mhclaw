import { useState } from "react";
import {
  Check,
  Info,
  LogOut,
  Monitor,
  Moon,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSetupStore } from "@/stores/setup-store";
import { useAuthStore } from "@/stores/auth-store";
import { useTheme, type Theme } from "@/hooks/use-theme";
import { AuthorizedDirsDialog } from "@/components/settings/AuthorizedDirsDialog";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconGradient } from "@/components/brand/Logo";
import { cn } from "@/lib/utils";
import { showConfirm } from "@/lib/prompt";
import { toast } from "sonner";

const APP_VERSION = "0.1.0";

/** 左下用户菜单：头像按钮 + 下拉菜单（主题 / 模型 / 关于 / 检查更新） */
export function UserMenu() {
  const openSetup = useSetupStore((s) => s.openDialog);
  const { theme, setTheme } = useTheme();
  const [authOpen, setAuthOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const displayName = user?.name?.trim() || user?.email?.split("@")[0] || "未登录";
  const initial = (displayName[0] ?? "?").toUpperCase();

  const handleCheckUpdate = () => {
    toast.success("当前已是最新版本", { description: `mhclaw ${APP_VERSION}` });
  };

  const handleAbout = () => setAboutOpen(true);

  return (
    <>
    <AuthorizedDirsDialog open={authOpen} onOpenChange={setAuthOpen} />
    <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex w-full items-center gap-2 rounded-2xl bg-white/50 px-2 py-1.5 text-left ring-1 ring-black/[0.04] transition hover:bg-white hover:ring-black/10 dark:bg-white/[0.04] dark:ring-white/[0.06] dark:hover:bg-white/[0.08] dark:hover:ring-white/15",
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-semibold text-white shadow-[0_2px_6px_rgba(99,102,241,0.25)]">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[0.8125rem] font-medium">{displayName}</div>
            {user?.email && (
              <div className="truncate text-[0.625rem] text-foreground/50">
                {user.email}
              </div>
            )}
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          mhclaw 0.1.0
          {user?.email && (
            <div className="mt-0.5 truncate text-[0.625rem] text-muted-foreground/80">
              {user.email}
            </div>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
          <SettingsIcon />
          <span>设置</span>
        </DropdownMenuItem>

        <DropdownMenuItem onClick={openSetup}>
          <SettingsIcon />
          <span>模型配置</span>
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => setAuthOpen(true)}>
          <ShieldCheck />
          <span>授权目录</span>
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {theme === "dark" ? <Moon /> : theme === "light" ? <Sun /> : <Monitor />}
            <span>主题</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <ThemeRadio
              label="浅色"
              value="light"
              current={theme}
              onSelect={setTheme}
              icon={<Sun />}
            />
            <ThemeRadio
              label="深色"
              value="dark"
              current={theme}
              onSelect={setTheme}
              icon={<Moon />}
            />
            <ThemeRadio
              label="跟随系统"
              value="system"
              current={theme}
              onSelect={setTheme}
              icon={<Monitor />}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handleCheckUpdate}>
          <RefreshCw />
          <span>检查更新</span>
        </DropdownMenuItem>

        <DropdownMenuItem onClick={handleAbout}>
          <Info />
          <span>关于 mhclaw</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            const ok = await showConfirm({
              title: "退出登录?",
              description: "重新登录后仍可看到本地历史会话。",
              confirmText: "退出",
              danger: true,
            });
            if (ok) logout();
          }}
          className="text-destructive focus:text-destructive"
        >
          <LogOut />
          <span>退出登录</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  );
}

function ThemeRadio({
  label,
  value,
  current,
  onSelect,
  icon,
}: {
  label: string;
  value: Theme;
  current: Theme;
  onSelect: (t: Theme) => void;
  icon: React.ReactNode;
}) {
  const active = current === value;
  return (
    <DropdownMenuItem onClick={() => onSelect(value)}>
      {icon}
      <span className="flex-1">{label}</span>
      {active && <Check className="h-3.5 w-3.5" />}
    </DropdownMenuItem>
  );
}

function AboutDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[360px]">
        <DialogHeader className="sr-only">
          <DialogTitle>关于 mhclaw</DialogTitle>
          <DialogDescription>版本信息</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-4">
          <IconGradient size={64} glow />
          <div className="text-[17px] font-semibold tracking-tight">mhclaw</div>
          <div className="text-[12.5px] text-muted-foreground">让想法落地为现实 · AI 工作台</div>
          <div
            className="mt-2 rounded-full px-3 py-1 text-[11.5px] tabular-nums"
            style={{
              background: "var(--mh-surface-sub)",
              color: "var(--mh-text-muted)",
              border: "1px solid var(--mh-stroke)",
            }}
          >
            版本 {APP_VERSION}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
