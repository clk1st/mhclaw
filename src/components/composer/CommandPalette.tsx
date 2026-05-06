import { useEffect, useMemo, useRef } from "react";
import { Search } from "lucide-react";
import { useCommands, type CommandEntry } from "@/hooks/use-commands";
import { useChannels } from "@/hooks/use-channels";
import { useSkills, type SkillStatusEntry } from "@/hooks/use-skills";
import {
  CHANNEL_SKILL_PREFIXES,
  resolveChannelForSkill,
} from "@/lib/channel-skill-prefixes";
import { cn } from "@/lib/utils";

/** skill command 用指纹匹配到 skill 的 display name/emoji(和 Composer chip 同源) */
function buildSkillFingerprintMap(
  skills: SkillStatusEntry[] | undefined,
): Map<string, SkillStatusEntry> {
  const fp = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const map = new Map<string, SkillStatusEntry>();
  for (const s of skills ?? []) {
    map.set(fp(s.skillKey), s);
    map.set(fp(s.name), s);
  }
  return map;
}
function commandFingerprint(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface FilterResult {
  /** 分组显示的 skill:每组一个 channel(或"通用") */
  skillGroups: Array<{ key: string; label: string; items: CommandEntry[] }>;
  /** 系统命令(native + plugin) */
  systemCmds: CommandEntry[];
  /** 面板里平铺渲染的顺序,用索引做键盘高亮 */
  ordered: CommandEntry[];
}

/**
 * filter + 分组 skill:
 *  - 没连的 channel 相关 skill → 丢弃(按前缀识别)
 *  - eligible=false 或 disabled=true 的 skill → 丢弃(AI 实际看不到,展示了发过去 AI 会说"没这个技能")
 *  - 通用 skill → "通用"组
 *  - 已连 channel 的 skill → 按 channel label 分组
 */
export function filterAndGroupCommands(
  all: CommandEntry[],
  query: string,
  connectedChannelIds: Set<string>,
  allowedSkillFingerprints: Set<string>,
): FilterResult {
  const q = query.trim().toLowerCase();
  const matched = q
    ? all.filter((c) => {
        if (c.name.toLowerCase().includes(q)) return true;
        if (c.description?.toLowerCase().includes(q)) return true;
        if (c.textAliases?.some((a) => a.toLowerCase().includes(q))) return true;
        return false;
      })
    : all;

  const rawSkills = matched.filter(
    (c) =>
      c.source === "skill" &&
      // 必须指纹能匹配到 skills.status 里的可用条目,否则 AI 看不到,丢弃
      allowedSkillFingerprints.has(commandFingerprint(c.name)),
  );
  const systemCmds = matched.filter(
    (c) => c.source === "native" || c.source === "plugin",
  );

  // skill 分组
  const groupMap = new Map<string, CommandEntry[]>();
  const generalItems: CommandEntry[] = [];
  for (const c of rawSkills) {
    const channelId = resolveChannelForSkill(c.name);
    if (channelId) {
      // 已识别但未连接的 channel → 丢弃
      if (!connectedChannelIds.has(channelId)) continue;
      const existing = groupMap.get(channelId) ?? [];
      existing.push(c);
      groupMap.set(channelId, existing);
    } else {
      generalItems.push(c);
    }
  }

  // 分组顺序:按 CHANNEL_SKILL_PREFIXES 原顺序,然后"通用"放最后
  const skillGroups: FilterResult["skillGroups"] = [];
  for (const [id, meta] of Object.entries(CHANNEL_SKILL_PREFIXES)) {
    const items = groupMap.get(id);
    if (items && items.length > 0) {
      skillGroups.push({ key: id, label: meta.label, items });
    }
  }
  if (generalItems.length > 0) {
    skillGroups.push({ key: "__general__", label: "通用", items: generalItems });
  }

  const ordered: CommandEntry[] = [];
  for (const g of skillGroups) ordered.push(...g.items);
  ordered.push(...systemCmds);

  return { skillGroups, systemCmds, ordered };
}

/**
 * `/` 命令面板 —— 顶部搜索栏、分组展示,支持键盘上下选 + Enter 确认。
 * 输入直接用 Composer 里的文本(`slash` 后的关键字),搜索框只是视觉 + 聚焦提示。
 */
export function CommandPalette({
  query,
  selectedIndex,
  onSelect,
  onHoverIndex,
}: {
  query: string;
  selectedIndex: number;
  onSelect: (cmd: CommandEntry) => void;
  onHoverIndex: (idx: number) => void;
}) {
  const { data: allCommands = [], isLoading } = useCommands();
  const { data: allChannels = [] } = useChannels();
  const { data: skillsResp } = useSkills();

  // 已"配置"(不一定 running)的 channel 就当"已连"—— 配置过说明用户意愿要用
  const connectedChannelIds = useMemo(
    () => new Set(allChannels.filter((c) => c.configured).map((c) => c.id)),
    [allChannels],
  );

  const skillFp = useMemo(
    () => buildSkillFingerprintMap(skillsResp?.skills),
    [skillsResp],
  );

  // 允许展示的 skill 指纹:**不看 eligible,只看 disabled**。
  // eligible 依赖环境检测(bin/env/config),可能漏判(比如 token 已在环境变量里但
  // skill 没识别到),导致用户能用的 skill 被错误过滤。disabled=用户主动关,才该过滤。
  const allowedSkillFingerprints = useMemo(() => {
    const set = new Set<string>();
    const fp = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const s of skillsResp?.skills ?? []) {
      if (!s.disabled) {
        set.add(fp(s.skillKey));
        set.add(fp(s.name));
      }
    }
    return set;
  }, [skillsResp]);

  const { skillGroups, systemCmds, ordered } = useMemo(
    () => filterAndGroupCommands(allCommands, query, connectedChannelIds, allowedSkillFingerprints),
    [allCommands, query, connectedChannelIds, allowedSkillFingerprints],
  );

  const activeItemRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 max-h-[440px] overflow-hidden rounded-2xl bg-white/95 ring-1 ring-black/[0.06] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_20px_48px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:bg-[#1a1f2e]/95 dark:ring-white/[0.08]">
      {/* 搜索栏(跟 Composer 文本联动,展示当前 query) */}
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate font-mono text-xs text-foreground">
          {query ? (
            <>
              <span className="text-muted-foreground">/</span>
              {query}
            </>
          ) : (
            <span className="text-muted-foreground">搜索命令或技能…</span>
          )}
        </span>
        <kbd className="shrink-0 rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground">
          ↑↓ Enter
        </kbd>
      </div>

      <div className="max-h-[380px] overflow-y-auto p-1.5">
        {isLoading && allCommands.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            加载命令列表…
          </div>
        ) : ordered.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            没有匹配的命令
          </div>
        ) : (
          <PaletteBody
            skillGroups={skillGroups}
            systemCmds={systemCmds}
            selectedIndex={selectedIndex}
            onSelect={onSelect}
            onHoverIndex={onHoverIndex}
            activeItemRef={activeItemRef}
            skillFp={skillFp}
          />
        )}
      </div>
    </div>
  );
}

function PaletteBody({
  skillGroups,
  systemCmds,
  selectedIndex,
  onSelect,
  onHoverIndex,
  activeItemRef,
  skillFp,
}: {
  skillGroups: FilterResult["skillGroups"];
  systemCmds: CommandEntry[];
  selectedIndex: number;
  onSelect: (cmd: CommandEntry) => void;
  onHoverIndex: (idx: number) => void;
  activeItemRef: React.MutableRefObject<HTMLButtonElement | null>;
  skillFp: Map<string, SkillStatusEntry>;
}) {
  let idxCursor = 0;
  const renderItem = (c: CommandEntry) => {
    const idx = idxCursor++;
    const active = idx === selectedIndex;
    // skill command:用 skill frontmatter 的 display name + emoji 代替下划线技术名
    const skillMeta =
      c.source === "skill" ? skillFp.get(commandFingerprint(c.name)) : undefined;
    const displayName = skillMeta?.name || c.name;
    const description = skillMeta?.description || c.description;
    const showMono = !skillMeta; // native / plugin 命令 + 查不到的 skill 用 mono 字体显示技术名
    return (
      <button
        key={c.name}
        type="button"
        ref={active ? activeItemRef : undefined}
        onMouseEnter={() => onHoverIndex(idx)}
        onClick={() => onSelect(c)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition",
          active ? "bg-muted/80 text-foreground" : "text-foreground/85 hover:bg-muted/60",
        )}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border/60 bg-background/50 text-[12px] text-muted-foreground">
          {skillMeta?.emoji || "/"}
        </span>
        <span
          className={cn(
            "shrink-0 text-[12.5px] font-medium",
            showMono && "font-mono",
          )}
        >
          {displayName}
        </span>
        {description && (
          <span className="truncate text-[11.5px] text-muted-foreground">
            {description}
          </span>
        )}
      </button>
    );
  };

  return (
    <>
      {skillGroups.map((g) => (
        <div key={g.key} className="mb-1">
          <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Skills · {g.label}
          </div>
          {g.items.map(renderItem)}
        </div>
      ))}
      {systemCmds.length > 0 && (
        <div>
          <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Commands
          </div>
          {systemCmds.map(renderItem)}
        </div>
      )}
    </>
  );
}

/** 导出给 Composer 用:拿到 ordered 后的第 i 项,配合键盘选中 */
export function selectFilteredByIndex(
  all: CommandEntry[],
  query: string,
  connectedChannelIds: Set<string>,
  allowedSkillFingerprints: Set<string>,
  index: number,
): CommandEntry | null {
  return (
    filterAndGroupCommands(all, query, connectedChannelIds, allowedSkillFingerprints)
      .ordered[index] ?? null
  );
}

/** 导出给 Composer 用:面板可见的总项数 */
export function countFiltered(
  all: CommandEntry[],
  query: string,
  connectedChannelIds: Set<string>,
  allowedSkillFingerprints: Set<string>,
): number {
  return filterAndGroupCommands(
    all,
    query,
    connectedChannelIds,
    allowedSkillFingerprints,
  ).ordered.length;
}
