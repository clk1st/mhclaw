import { ChevronDown, Hammer, MessageCircleQuestion, ListChecks } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useChatStore } from "@/stores/chat-store";
import type { ComposerMode } from "@/lib/markers";
import { cn } from "@/lib/utils";

/**
 * Composer 左下"模式"chip:Craft / Plan / Ask 三档。
 * 当前模式显示在 chip 上;切换后保存到 chat-store.composerMode,
 * 下次 send 时由 buildMarkers() 自动注入 [Plan mode] / [Ask mode] 前缀。
 * Craft 是默认模式,不注入 marker(省 token)。
 */

interface ModeDef {
  key: ComposerMode;
  label: string;
  desc: string;
  icon: typeof Hammer;
}

const MODES: ModeDef[] = [
  {
    key: "craft",
    label: "Craft",
    desc: "直接执行 · AI 可以动手做事",
    icon: Hammer,
  },
  {
    key: "plan",
    label: "Plan",
    desc: "先列计划 · 等你确认每一步",
    icon: ListChecks,
  },
  {
    key: "ask",
    label: "Ask",
    desc: "只回答 · 不调用任何工具",
    icon: MessageCircleQuestion,
  },
];

export function ModePicker() {
  const mode = useChatStore((s) => s.composerMode);
  const setMode = useChatStore((s) => s.setComposerMode);
  const current = MODES.find((m) => m.key === mode) ?? MODES[0];
  const Icon = current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-full bg-white/50 px-2.5 text-xs text-foreground/70 ring-1 ring-black/[0.04] transition hover:bg-white hover:text-foreground hover:ring-black/10 dark:bg-white/[0.04] dark:text-foreground/70 dark:ring-white/[0.06] dark:hover:bg-white/[0.08] dark:hover:text-foreground dark:hover:ring-white/15",
          )}
          title={`当前模式:${current.label} · ${current.desc}`}
        >
          <Icon className="h-3 w-3" />
          <span>{current.label}</span>
          <ChevronDown className="h-2.5 w-2.5 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          对话模式
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {MODES.map((m) => {
          const I = m.icon;
          const active = m.key === mode;
          return (
            <DropdownMenuItem
              key={m.key}
              onClick={() => setMode(m.key)}
              className={cn(
                "flex flex-col items-start gap-0.5 py-2",
                active && "bg-accent",
              )}
            >
              <div className="flex items-center gap-1.5">
                <I className="h-3.5 w-3.5" />
                <span className="text-sm font-medium">{m.label}</span>
                {active && (
                  <span className="ml-auto text-[10px] text-primary">当前</span>
                )}
              </div>
              <span className="pl-5 text-[11px] text-muted-foreground">
                {m.desc}
              </span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-[10px] text-muted-foreground">
          通过 AGENTS.md contribution 教 AI 识别 marker
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
