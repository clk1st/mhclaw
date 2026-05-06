import { KeyboardEvent, useMemo, useState } from "react";
import { Hammer, Send, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskFolderPicker } from "./TaskFolderPicker";
import { ModePicker } from "./ModePicker";
// AgentPicker 暂时下架 —— 当前 mhclaw 只有 main(默认)和 claw(channel 入站
// 专用)两个 agent,用户手动切都没意义且会污染 claw 隔离;路由完全自动:
// 主对话固定 main,channel 消息 bindings 路由 claw。
// 等真做"领域专家市场"(给用户提供产品经理/数据分析师等预设 agent)再放出来。
import { ModelChip } from "./ModelChip";
import { SkillsPicker } from "./SkillsPicker";
import {
  CommandPalette,
  countFiltered,
  selectFilteredByIndex,
} from "./CommandPalette";
import { useCommands, type CommandEntry } from "@/hooks/use-commands";
import { useChannels } from "@/hooks/use-channels";
import { useChatStore } from "@/stores/chat-store";
import { useSkills, SKILL_DESC_ZH, type SkillStatusEntry } from "@/hooks/use-skills";
import { cn } from "@/lib/utils";

interface ComposerProps {
  /** 受控：当前输入文本 */
  value: string;
  /** 受控：文本变化回调 */
  onValueChange: (v: string) => void;
  /** 发送回调。父组件决定是否清空 value（通过 onValueChange） */
  onSend: (text: string) => void | Promise<void>;
  disabled?: boolean;
  sending?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * 统一 Composer（受控组件）：
 * - 文本状态由父组件持有，便于跨场景保留/恢复（比如 Setup 拦截后自动补发）
 * - 回车发送、Shift+Enter 换行；输入法 composing 期间不触发发送
 * - Craft / Auto / Skills / 文件夹按钮当前为 UI 占位
 */
export function Composer({
  value,
  onValueChange,
  onSend,
  disabled = false,
  sending = false,
  placeholder = "输入消息...",
  className,
}: ComposerProps) {
  // chat-store 的 loading 表示 AI 正在流式回复(整个 run 期间),
  // 区别于 sending(单条发送请求的瞬间)。loading 时按钮变成"停止"。
  const streaming = useChatStore((s) => s.loading);
  const abort = useChatStore((s) => s.abort);

  // 命令面板:第一个字符是 "/" 时触发,按 `/keyword` 过滤并分区展示 Skills / Commands
  const { data: allCommands = [] } = useCommands();
  const { data: allChannels = [] } = useChannels();
  const connectedChannelIds = useMemo(
    () => new Set(allChannels.filter((c) => c.configured).map((c) => c.id)),
    [allChannels],
  );
  const slashState = useMemo(() => detectSlash(value), [value]);
  const paletteOpen = slashState !== null;

  // skill 指纹映射:/word_docx 选中后能找到对应 skillKey → 同步给 SkillsPicker 状态
  const { data: skillsResp } = useSkills();
  const fingerprint = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const skillFp = useMemo(() => {
    const map = new Map<string, SkillStatusEntry>();
    for (const s of skillsResp?.skills ?? []) {
      map.set(fingerprint(s.skillKey), s);
      map.set(fingerprint(s.name), s);
    }
    return map;
  }, [skillsResp]);
  // 只允许面板展示 **用户没主动 disable 的 skill**。不看 eligible ——
  // eligible 是系统检测 bin/env 依赖,可能 false negative(token 在环境变量里
  // 但检测不到),靠它 filter 会让用户看不到他明明能用的 skill。
  const allowedSkillFingerprints = useMemo(() => {
    const set = new Set<string>();
    for (const s of skillsResp?.skills ?? []) {
      if (!s.disabled) {
        set.add(fingerprint(s.skillKey));
        set.add(fingerprint(s.name));
      }
    }
    return set;
  }, [skillsResp]);

  const filteredCount = useMemo(() => {
    if (!paletteOpen) return 0;
    return countFiltered(
      allCommands,
      slashState?.query ?? "",
      connectedChannelIds,
      allowedSkillFingerprints,
    );
  }, [paletteOpen, allCommands, slashState, connectedChannelIds, allowedSkillFingerprints]);
  const [paletteIndex, setPaletteIndex] = useState(0);
  // 选中的 native / plugin 命令(skill 命令走 SkillsPicker 状态,不用这个 chip)
  const [selectedCommand, setSelectedCommand] = useState<CommandEntry | null>(null);
  // 切换查询时把高亮重置到 0
  useMemo(() => setPaletteIndex(0), [slashState?.query, paletteOpen]);

  // 有选中命令 = 至少能发"/name"。否则要求有文本
  const canSend =
    !disabled &&
    !sending &&
    !streaming &&
    (selectedCommand !== null || value.trim().length > 0);
  const canStop = streaming && !disabled;

  const handleSend = () => {
    if (!canSend) return;
    // 命令 chip 存在时,前缀拼在 text 前面(Gateway 解析 /name args 走命令管线)
    const body = value.trim();
    const final = selectedCommand
      ? body
        ? `/${selectedCommand.name} ${body}`
        : `/${selectedCommand.name}`
      : body;
    onSend(final);
    // 本次消息级的选中 state 发送后全部重置:skill chips + command chip 都清
    // (marker 里 [skills: ...] 本来就是"本条消息 hint",不该 sticky)
    setSelectedCommand(null);
    useChatStore.getState().setSelectedSkills([]);
  };

  const handleClick = () => {
    if (streaming) {
      abort();
      return;
    }
    handleSend();
  };

  const insertCommand = (cmd: CommandEntry) => {
    onValueChange("");
    // skill command(如 /word_docx)→ 直接同步到 SkillsPicker 勾选状态
    // 让两个入口(SkillsPicker 点击 vs `/` 面板选中)落到同一个"已选 skill"数据源
    if (cmd.source === "skill") {
      // skills.status 可能还没刷新到(新装的 skill),fingerprint 查不到就用 cmd.name 作 skillKey
      // 这样至少能正确填 selectedSkillKeys,发送时 marker 里的 [skills: xxx] 也对
      const s = skillFp.get(fingerprint(cmd.name));
      const skillKey = s?.skillKey ?? cmd.name;
      const cur = useChatStore.getState().selectedSkillKeys;
      if (!cur.includes(skillKey)) {
        useChatStore.getState().toggleSkillSelection(skillKey);
      }
      return;
    }
    // native / plugin command → chip 形式,发送时拼 `/name args`
    setSelectedCommand(cmd);
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 命令面板激活时,上下切换 + Enter 选中
    if (paletteOpen && filteredCount > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPaletteIndex((i) => (i + 1) % filteredCount);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPaletteIndex((i) => (i - 1 + filteredCount) % filteredCount);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        const cmd = selectFilteredByIndex(
          allCommands,
          slashState?.query ?? "",
          connectedChannelIds,
          allowedSkillFingerprints,
          paletteIndex,
        );
        if (cmd) {
          e.preventDefault();
          insertCommand(cmd);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onValueChange("");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      className={cn(
        "relative rounded-3xl bg-white/75 p-3.5 ring-1 ring-black/[0.05] backdrop-blur-md transition-all",
        "shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_36px_rgba(15,23,42,0.05)]",
        "focus-within:bg-white focus-within:ring-black/10 focus-within:shadow-[0_1px_2px_rgba(15,23,42,0.06),0_20px_48px_rgba(15,23,42,0.08)]",
        "dark:bg-white/[0.04] dark:ring-white/[0.06] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_12px_36px_rgba(0,0,0,0.35)]",
        "dark:focus-within:bg-white/[0.06] dark:focus-within:ring-white/15",
        className,
      )}
    >
      {paletteOpen && (
        <CommandPalette
          query={slashState?.query ?? ""}
          selectedIndex={paletteIndex}
          onSelect={insertCommand}
          onHoverIndex={setPaletteIndex}
        />
      )}
      <SelectedChipsRow
        command={selectedCommand}
        onRemoveCommand={() => setSelectedCommand(null)}
      />
      <textarea
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={handleKey}
        disabled={disabled || sending}
        placeholder={
          selectedCommand
            ? selectedCommand.acceptsArgs
              ? `给 /${selectedCommand.name} 补参数…`
              : "按 Enter 直接发送"
            : placeholder
        }
        rows={2}
        className="min-h-[52px] w-full resize-none bg-transparent px-1 text-[14px] leading-relaxed outline-none placeholder:text-foreground/35 disabled:cursor-not-allowed"
      />
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-1.5 text-xs">
          <ModePicker />
          <ModelChip />
          <SkillsPicker />
          <TaskFolderPicker />
        </div>
        <Button
          size="sm"
          onClick={handleClick}
          disabled={!canSend && !canStop}
          title={
            disabled
              ? "Gateway 未连接"
              : streaming
                ? "停止当前任务"
                : "发送(Enter)"
          }
          className={cn(
            "h-8 w-8 shrink-0 rounded-lg p-0 transition",
            canStop
              ? "bg-foreground/85 text-background shadow-[0_1px_2px_rgba(15,23,42,0.08)] hover:bg-foreground"
              : canSend
                ? "bg-primary text-primary-foreground shadow-brand-glow hover:bg-primary/90"
                : "bg-foreground/10 text-foreground/40 dark:bg-white/5 dark:text-white/30",
          )}
        >
          {streaming ? (
            <Square className="h-3 w-3 fill-current" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

/**
 * 只在 **第一个字符** 是 `/` 时触发命令面板(跟 OpenClaw docs 对齐:command-only 消息
 * 必须整条以 `/` 开头)。换行 / 前面有空格都不触发。
 * 返回 { query }:slash 之后还没到空格的关键字,面板用它过滤。
 */
function detectSlash(value: string): { query: string } | null {
  if (!value.startsWith("/")) return null;
  const after = value.slice(1);
  // 只要面板开着,输入空格后应该退出(进入参数输入)—— 第一行到第一个空格
  const firstNewline = after.indexOf("\n");
  const firstSpace = after.indexOf(" ");
  const boundary = [firstNewline, firstSpace].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (boundary !== undefined) return null;
  return { query: after };
}

/**
 * 统一 chip 行:已选 skill chip + 已选 command chip 共享视觉。
 * skill command 自动查 useSkills 拿 display name + emoji,
 * native/plugin command 没 display name → 用 Hammer + cmd.name。
 */
function SelectedChipsRow({
  command,
  onRemoveCommand,
}: {
  command: CommandEntry | null;
  onRemoveCommand: () => void;
}) {
  const selectedSkillKeys = useChatStore((s) => s.selectedSkillKeys);
  const toggleSkill = useChatStore((s) => s.toggleSkillSelection);
  const { data } = useSkills();
  const skillByKey = new Map((data?.skills ?? []).map((s) => [s.skillKey, s]));
  // 指纹匹配:OpenClaw 把 skill 暴露为 slash command 时 name 会 sanitize(a-z0-9_,
  // ≤32)。skill.skillKey 或 skill.name 可能带 "/"、"-"、大写。两边都做"纯小写字母数字"
  // 指纹后对比,就能在 /word_docx ↔ "Word / DOCX" 之间对上。
  const fp = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const skillByFingerprint = new Map<string, SkillStatusEntry>();
  for (const s of data?.skills ?? []) {
    skillByFingerprint.set(fp(s.skillKey), s);
    skillByFingerprint.set(fp(s.name), s);
  }

  if (selectedSkillKeys.length === 0 && !command) return null;

  // skill command(`/word_docx` 对应 skill "Word / DOCX")
  // 通过指纹查 skill metadata,查到就展示 display name + emoji;查不到就 fallback 技术名
  const commandDisplay = (() => {
    if (!command) return null;
    if (command.source === "skill") {
      const s = skillByFingerprint.get(fp(command.name));
      if (s) return { label: s.name, emoji: s.emoji, tip: s.description };
    }
    return { label: command.name, emoji: null, tip: command.description, isNative: true };
  })();

  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {selectedSkillKeys.map((key) => {
        const s = skillByKey.get(key);
        const name = s?.name ?? key;
        const emoji = s?.emoji || null;
        const tip = s ? SKILL_DESC_ZH[key] ?? s.description : key;
        return (
          <Chip
            key={`skill-${key}`}
            label={name}
            emoji={emoji}
            tip={tip}
            onRemove={() => toggleSkill(key)}
          />
        );
      })}
      {command && commandDisplay && (
        <Chip
          label={commandDisplay.label}
          emoji={commandDisplay.emoji}
          tip={commandDisplay.tip}
          mono={commandDisplay.isNative}
          onRemove={onRemoveCommand}
        />
      )}
    </div>
  );
}

/** 统一 chip 样式:skill 和 command 共用 */
function Chip({
  label,
  emoji,
  tip,
  mono,
  onRemove,
}: {
  label: string;
  emoji?: string | null;
  tip?: string;
  mono?: boolean;
  onRemove: () => void;
}) {
  return (
    <span
      title={tip}
      className="group inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs text-foreground"
    >
      {emoji ? (
        <span className="leading-none">{emoji}</span>
      ) : (
        <Hammer className="h-3 w-3 text-primary" />
      )}
      <span className={cn("max-w-[180px] truncate", mono && "font-mono")}>
        {label}
      </span>
      <button
        onClick={onRemove}
        className="rounded-sm p-0.5 text-muted-foreground transition hover:bg-background hover:text-destructive"
        title="移除"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}
