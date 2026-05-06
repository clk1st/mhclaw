import { useMemo, useState } from "react";
import { Check, ChevronDown, Package, Search } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSkills, SKILL_DESC_ZH } from "@/hooks/use-skills";
import { useChatStore } from "@/stores/chat-store";
import { cn } from "@/lib/utils";

/**
 * Composer 里的 Skills 选择器(per-message 提示)。
 *
 * 选中的 skill keys 进 chat-store.selectedSkillKeys,
 * 发送时由 buildMarkers() 拼成 [skills: a, b, c] 注入消息开头,
 * AGENTS.md contribution 教 AI 看到这个 marker 时优先用列出来的 skill。
 *
 * 注意:这是"hint"而非协议级强约束 —— OpenClaw chat.send schema 不接 skillKeys。
 * 真正控制 skill 是否可用,在 SkillsPage 改 skills.update 全局开关。
 */
export function SkillsPicker() {
  const selected = useChatStore((s) => s.selectedSkillKeys);
  const toggle = useChatStore((s) => s.toggleSkillSelection);
  const setSelected = useChatStore((s) => s.setSelectedSkills);
  const { data, isLoading } = useSkills();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const skills = data?.skills ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.skillKey.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [skills, query]);

  const label = selected.length > 0 ? `Skills · ${selected.length}` : "Skills";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-full bg-white/50 px-2.5 text-xs text-foreground/70 ring-1 ring-black/[0.04] transition hover:bg-white hover:text-foreground hover:ring-black/10 dark:bg-white/[0.04] dark:text-foreground/70 dark:ring-white/[0.06] dark:hover:bg-white/[0.08] dark:hover:text-foreground dark:hover:ring-white/15",
            selected.length > 0 && "text-foreground",
          )}
          title={
            selected.length > 0
              ? `本次发送指定 ${selected.length} 个 skill`
              : "选择本次发送要用的 skill(可选)"
          }
        >
          <Package className="h-3 w-3" />
          <span>{label}</span>
          <ChevronDown className="h-2.5 w-2.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[380px] p-1.5" sideOffset={6}>
        {/* 搜索 */}
        <div className="relative mb-1.5">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="找技能..."
            className="h-8 pl-7 text-xs"
          />
        </div>

        {/* 操作行:已选数 + 清空 */}
        {selected.length > 0 && (
          <div className="flex items-center justify-between px-2 pb-1 text-[11px] text-muted-foreground">
            <span>已选 {selected.length} 个</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[11px]"
              onClick={() => setSelected([])}
            >
              清空
            </Button>
          </div>
        )}

        {/* 列表 */}
        <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
          {isLoading ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              加载中…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              {query ? "无匹配" : "尚未安装任何技能"}
            </div>
          ) : (
            filtered.map((s) => {
              const checked = selected.includes(s.skillKey);
              const desc = SKILL_DESC_ZH[s.skillKey] ?? s.description;
              return (
                <button
                  key={s.skillKey}
                  onClick={() => toggle(s.skillKey)}
                  className={cn(
                    "flex items-start gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-muted/60",
                    checked && "bg-accent",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      checked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background",
                    )}
                  >
                    {checked && <Check className="h-2.5 w-2.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium">
                        {s.emoji ? `${s.emoji} ` : ""}
                        {s.name}
                      </span>
                      {s.bundled && (
                        <span className="shrink-0 rounded-full bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
                          内置
                        </span>
                      )}
                      {s.disabled && (
                        <span
                          className="shrink-0 rounded-full bg-amber-500/10 px-1 py-0.5 text-[9px] text-amber-700 dark:text-amber-300"
                          title="全局已禁用,需先到 Skills 页启用"
                        >
                          已禁用
                        </span>
                      )}
                    </div>
                    <div className="line-clamp-2 text-[10px] text-muted-foreground">
                      {desc}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="mt-1 border-t border-border px-2 pt-1.5 text-[10px] text-muted-foreground">
          选中的 skill 会作为本次发送的 hint(<code className="font-mono">[skills: ...]</code> marker)。全局启用/禁用请到 Skills 页。
        </div>
      </PopoverContent>
    </Popover>
  );
}
