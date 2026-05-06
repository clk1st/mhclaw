import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import {
  Download,
  FileCode,
  FileText,
  FileUp,
  Key,
  Loader2,
  Network,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Star,
} from "lucide-react";
import { SkillTokenDialog } from "@/components/skills/SkillTokenDialog";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SKILL_DESC_ZH,
  useSkills,
  useToggleSkill,
  type SkillStatusEntry,
} from "@/hooks/use-skills";
import { toast } from "sonner";
import {
  fetchSkillMd,
  getSkillHubUrl,
  resolveDownload,
  useHubSidecars,
  useSkillHub,
  type HubSidecar,
  type SkillHubItem,
} from "@/hooks/use-skillhub";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  MD_COMPONENTS,
  SkillDetailDialog,
  stripFrontmatter,
} from "@/components/skills/SkillDetailDialog";
import { McpManagerDialog } from "@/components/skills/McpManagerDialog";
import { useChatStore } from "@/stores/chat-store";
import { cn } from "@/lib/utils";

type Section = "recommended" | "skillhub" | "plugins";

export function SkillsPage() {
  const { data, isLoading, error } = useSkills();
  const { data: sidecars = {} } = useHubSidecars();
  const toggle = useToggleSkill();

  const [query, setQuery] = useState("");
  const [section, setSection] = useState<Section>("recommended");
  const [detail, setDetail] = useState<SkillStatusEntry | null>(null);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [tokenSkill, setTokenSkill] = useState<SkillStatusEntry | null>(null);

  const skills = data?.skills ?? [];

  // 已安装 = eligible（依赖齐全）的；未安装/缺依赖单独列出
  const installed = useMemo(
    // 非 bundled 的都算"用户装的"(不管依赖齐不齐 —— AI 运行时会处理)
    () => skills.filter((s) => !s.bundled),
    [skills],
  );
  const bundled = useMemo(
    () => skills.filter((s) => s.bundled),
    [skills],
  );

  const filteredBundled = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bundled;
    return bundled.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q),
    );
  }, [bundled, query]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-end justify-between gap-4 px-7 pb-5 pt-7">
        <div className="min-w-0 flex-1">
          <h1
            className="text-[24px] font-semibold tracking-[-0.02em]"
            style={{ color: "var(--mh-text)" }}
          >
            技能
          </h1>
          <div className="mt-1 text-[12.5px]" style={{ color: "var(--mh-text-muted)" }}>
            联手 mhclaw 更强大的能力 · 已安装 {installed.length} / 内置 {bundled.length}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMcpOpen(true)}
            className="h-8 rounded-[9px]"
            style={{
              background: "var(--mh-surface)",
              borderColor: "var(--mh-stroke)",
            }}
          >
            <Network />
            MCP 服务器
          </Button>
          <AddSkillDropdown />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-7 pb-7">
        {/* 已安装区域 */}
        <section>
          <div className="flex items-center justify-between pb-3">
            <h2 className="text-sm font-semibold">已安装</h2>
            <span className="text-xs text-muted-foreground">
              {installed.length} 个
            </span>
          </div>

          {isLoading && skills.length === 0 ? (
            <Loading />
          ) : error ? (
            <ErrorHint message={(error as Error).message} />
          ) : installed.length === 0 ? (
            <EmptyInstalled />
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {installed.map((s) => (
                <InstalledSkillCard
                  key={s.skillKey}
                  skill={s}
                  sidecar={sidecars[s.skillKey]}
                  toggling={toggle.isPending}
                  onToggle={(enabled) =>
                    toggle.mutate({ skillKey: s.skillKey, enabled })
                  }
                  onOpen={() => setDetail(s)}
                  onConfigureToken={() => setTokenSkill(s)}
                />
              ))}
            </div>
          )}
        </section>

        {/* 三档 Tab */}
        <section className="mt-8">
          <Tabs value={section} onValueChange={(v) => setSection(v as Section)}>
            <div className="flex items-center justify-between pb-3">
              <TabsList>
                <TabsTrigger value="recommended">推荐</TabsTrigger>
                <TabsTrigger value="skillhub">技能广场</TabsTrigger>
                <TabsTrigger value="plugins">插件</TabsTrigger>
              </TabsList>

              {section === "recommended" && (
                <div className="relative w-64">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="搜索内置技能"
                    className="pl-8"
                  />
                </div>
              )}
            </div>

            <TabsContent value="recommended" className="mt-0">
              {filteredBundled.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                  <Sparkles className="h-8 w-8 opacity-40" />
                  <span className="text-sm">没有匹配的技能</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredBundled.map((s) => (
                    <InstalledSkillCard
                      key={s.skillKey}
                      skill={s}
                      sidecar={sidecars[s.skillKey]}
                      toggling={toggle.isPending}
                      onToggle={(enabled) =>
                        toggle.mutate({ skillKey: s.skillKey, enabled })
                      }
                      onOpen={() => setDetail(s)}
                      onConfigureToken={() => setTokenSkill(s)}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="skillhub" className="mt-0">
              <SkillHubList />
            </TabsContent>

            <TabsContent value="plugins" className="mt-0">
              <PluginsPlaceholder />
            </TabsContent>
          </Tabs>
        </section>

      </div>

      {/* Dialogs */}
      <SkillDetailDialog
        skill={detail}
        open={!!detail}
        onOpenChange={(o) => !o && setDetail(null)}
      />
      <McpManagerDialog open={mcpOpen} onOpenChange={setMcpOpen} />
      <SkillTokenDialog
        skill={tokenSkill}
        open={!!tokenSkill}
        onOpenChange={(o) => !o && setTokenSkill(null)}
        tokenUrl={parseTokenUrl(tokenSkill)}
      />
    </div>
  );
}

/** 从 SKILL.md frontmatter 的 metadata.openclaw.tokenUrl 取获取 token 的跳转链接 */
function parseTokenUrl(skill: SkillStatusEntry | null): string | undefined {
  if (!skill) return undefined;
  // SkillStatusEntry 没暴露 metadata,mhclaw 这版没拉 frontmatter。留空让 Dialog 不显示"获取 token"按钮
  return undefined;
}

function InstalledSkillCard({
  skill,
  sidecar,
  toggling,
  onToggle,
  onOpen,
  onConfigureToken,
}: {
  skill: SkillStatusEntry;
  /** 若是从 hub 装的,拿 hub 的 displayName / description 覆盖 SKILL.md 英文 name */
  sidecar?: HubSidecar;
  toggling: boolean;
  onToggle: (enabled: boolean) => void;
  onOpen: () => void;
  onConfigureToken?: () => void;
}) {
  // enabled 只看用户意图(disabled);eligible 是运行时依赖检测,
  // AI 调用 skill 时会自己处理(装 CLI 等),不影响用户能否启用
  const enabled = !skill.disabled;
  // 需要配 token 的条件:skill 声明了 primaryEnv,且当前缺失这个 env
  // (skills.status 的 missing.env 里会包含 primaryEnv;或者 eligible=false 且 primaryEnv 存在也视为需要补)
  const needsToken = Boolean(
    skill.primaryEnv &&
      (skill.missing?.env?.includes(skill.primaryEnv) || !skill.eligible),
  );
  // 优先级:sidecar(hub 填的中文显示名) > SKILL_DESC_ZH 精选中文 > SKILL.md 原描述
  const title = sidecar?.displayName || skill.name;
  const desc =
    sidecar?.description ||
    SKILL_DESC_ZH[skill.skillKey] ||
    skill.description ||
    "";

  return (
    <div
      className={cn(
        "group relative flex flex-col gap-2 rounded-2xl bg-white/60 p-3 ring-1 ring-black/[0.05] backdrop-blur transition hover:bg-white hover:ring-black/15 hover:shadow-[0_2px_8px_rgba(15,23,42,0.06)] dark:bg-white/[0.04] dark:ring-white/[0.06] dark:hover:bg-white/[0.08] dark:hover:ring-white/15",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-base">
            {skill.emoji || "🔧"}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{title}</span>
              {skill.bundled && (
                <span className="shrink-0 rounded-full bg-muted px-1 py-0 text-[9px] text-muted-foreground">
                  内置
                </span>
              )}
            </div>
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
              {desc}
            </p>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          {needsToken && onConfigureToken && (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                onConfigureToken();
              }}
              className="h-6 gap-1 rounded-full px-2 text-[11px]"
            >
              <Key className="h-2.5 w-2.5" />
              配 token
            </Button>
          )}
          {!skill.always && (
            <Switch
              checked={enabled}
              disabled={toggling}
              onCheckedChange={onToggle}
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SkillHubList() {
  const [q, setQ] = useState("");
  const { data, isLoading, error, refetch } = useSkillHub({ q });
  const { data: sidecars = {} } = useHubSidecars();
  const { data: skillsStatus } = useSkills();
  const qc = useQueryClient();
  const [installing, setInstalling] = useState<Record<string, boolean>>({});
  const [previewItem, setPreviewItem] = useState<SkillHubItem | null>(null);

  const items = data?.items ?? [];

  // 判断已装:sidecar 存在(通过 hub 装的)OR 目录名对得上某个已装 skill 的 skillKey
  const installedKeys = useMemo(() => {
    const s = new Set<string>();
    for (const k of Object.keys(sidecars)) s.add(k);
    for (const sk of skillsStatus?.skills ?? []) s.add(sk.skillKey);
    return s;
  }, [sidecars, skillsStatus]);

  const install = async (item: SkillHubItem) => {
    const api = window.cjtClaw?.skills?.installFromUrl;
    const label = item.displayName || item.name;
    if (!api) {
      toast.error("当前环境不支持安装(需要 Electron 主进程)");
      return;
    }
    setInstalling((prev) => ({ ...prev, [item.name]: true }));
    try {
      const resolved = await resolveDownload(item.name);
      await api({
        url: resolved.tarballUrl,
        slug: item.name,
        meta: {
          displayName: item.displayName,
          description: item.description,
          tags: item.tags,
          channel: item.channel,
          version: resolved.resolvedVersion,
          source: getSkillHubUrl(),
        },
      });
      toast.success(`"${label}" 安装完成`, {
        description: `已落到 workspace/skills/${item.name}`,
      });
    } catch (e) {
      toast.error(`"${label}" 安装失败`, {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setInstalling((prev) => ({ ...prev, [item.name]: false }));
      refetch();
      // sidecar / skills.status 变了,让相关查询重新拉
      qc.invalidateQueries({ queryKey: ["skill-hub-sidecars"] });
      qc.invalidateQueries({ queryKey: ["skills"] });
    }
  };

  return (
    <div>
      {/* 搜索栏 */}
      <div className="relative mb-3 w-full sm:max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索技能广场(按包名)"
          className="pl-8"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          加载中…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          无法连接技能广场:{(error as Error).message}
          <div className="mt-1 text-xs text-muted-foreground">
            默认 endpoint 是 <code>https://skills.metrichub.app</code>,可通过
            localStorage 的 <code>mhclaw-skillhub-url</code> 覆盖。
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/[0.08] bg-white/40 px-6 py-12 text-center backdrop-blur dark:border-white/[0.08] dark:bg-white/[0.02]">
          <Sparkles className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">
            {q ? "没有匹配的技能" : "技能广场暂无上架技能"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <SkillHubCard
              key={item.name}
              item={item}
              installed={installedKeys.has(item.name)}
              installing={!!installing[item.name]}
              onOpen={() => setPreviewItem(item)}
              onInstall={() => install(item)}
            />
          ))}
        </div>
      )}

      <SkillHubDetailDialog
        item={previewItem}
        open={!!previewItem}
        onOpenChange={(o) => !o && setPreviewItem(null)}
        installed={previewItem ? installedKeys.has(previewItem.name) : false}
        installing={previewItem ? !!installing[previewItem.name] : false}
        onInstall={() => {
          if (previewItem) install(previewItem);
        }}
      />
    </div>
  );
}

/**
 * 广场列表里单个卡片。整卡点击打开详情,右下角按钮直接安装(stopPropagation)。
 */
function SkillHubCard({
  item,
  installed,
  installing,
  onOpen,
  onInstall,
}: {
  item: SkillHubItem;
  installed: boolean;
  installing: boolean;
  onOpen: () => void;
  onInstall: () => void;
}) {
  const title = item.displayName || item.name;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="flex cursor-pointer flex-col gap-2 rounded-2xl bg-white/60 p-3 text-left ring-1 ring-black/[0.05] backdrop-blur transition hover:bg-white hover:ring-black/15 dark:bg-white/[0.04] dark:ring-white/[0.06] dark:hover:bg-white/[0.08] dark:hover:ring-white/15"
    >
      <div className="flex items-start gap-2.5">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white"
          style={{ background: hashColor(item.name) }}
        >
          {title.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{title}</span>
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0 text-[9px] text-muted-foreground">
              v{item.latestVersion}
            </span>
            {installed && (
              <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0 text-[9px] font-medium text-emerald-700 dark:text-emerald-400">
                已安装
              </span>
            )}
          </div>
          {item.displayName && item.displayName !== item.name && (
            <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/80">
              {item.name}
            </div>
          )}
          {/* 简短描述:2 行截断,没有则显示灰态占位 */}
          <p
            className={cn(
              "mt-1 line-clamp-2 text-[11px] leading-relaxed",
              item.description ? "text-muted-foreground" : "text-muted-foreground/50",
            )}
          >
            {item.description || "(该版本未提供描述)"}
          </p>
          {/* tags */}
          {item.tags && item.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {item.tags.slice(0, 3).map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-muted px-1.5 py-0 text-[9px] text-muted-foreground"
                >
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* 底部 meta + 安装按钮 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-0.5">
            <Download className="h-3 w-3" />
            {formatCount(item.downloadCount)}
          </span>
          <span className="inline-flex items-center gap-0.5">
            <Star className="h-3 w-3" />
            {formatCount(item.starCount)}
          </span>
          <span className="text-muted-foreground/50">·</span>
          <span>{CHANNEL_LABEL[item.channel] ?? item.channel}</span>
          {item.family !== "skill" && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span>{item.family}</span>
            </>
          )}
        </div>
        {installed ? (
          <Button
            size="xs"
            variant="ghost"
            disabled
            className="text-emerald-600 dark:text-emerald-400"
          >
            ✓ 已安装
          </Button>
        ) : (
          <Button
            size="xs"
            onClick={(e) => {
              e.stopPropagation();
              onInstall();
            }}
            disabled={installing}
          >
            {installing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download />
            )}
            {installing ? "安装中" : "安装"}
          </Button>
        )}
      </div>
    </div>
  );
}

const CHANNEL_LABEL: Record<string, string> = {
  official: "官方",
  community: "社区",
  private: "私有",
};

/** 技能广场 item 的详情 Dialog:展示 displayName/description/tags,底部安装按钮 */
function SkillHubDetailDialog({
  item,
  open,
  onOpenChange,
  installed,
  installing,
  onInstall,
}: {
  item: SkillHubItem | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  installed: boolean;
  installing: boolean;
  onInstall: () => void;
}) {
  const [view, setView] = useState<"rendered" | "raw">("rendered");
  const [mdContent, setMdContent] = useState<string>("");
  const [mdLoading, setMdLoading] = useState(false);
  const [mdError, setMdError] = useState<string | null>(null);

  // 走 hub API 代理(R2 public CDN 没 CORS header,API 层 Hono cors 已处理)
  useEffect(() => {
    if (!open || !item) return;
    setMdLoading(true);
    setMdError(null);
    setMdContent("");
    fetchSkillMd(item.name, item.latestVersion)
      .then((text) => setMdContent(text))
      .catch((e: Error) => setMdError(e.message || "SKILL.md 加载失败"))
      .finally(() => setMdLoading(false));
  }, [open, item]);

  if (!item) return null;
  const title = item.displayName || item.name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col gap-0 p-0">
        {/* 顶部 header(对齐 SkillDetailDialog 的风格) */}
        <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-base font-semibold text-white"
                style={{ background: hashColor(item.name) }}
              >
                {title.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <DialogTitle className="flex items-center gap-2">
                  <span className="truncate">{title}</span>
                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    v{item.latestVersion}
                  </span>
                </DialogTitle>
                <DialogDescription className="mt-1 line-clamp-2">
                  {item.description || "(该版本未提供描述)"}
                </DialogDescription>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {CHANNEL_LABEL[item.channel] ?? item.channel}
                  </span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    ⬇ {formatCount(item.downloadCount)}
                  </span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    ⭐ {formatCount(item.starCount)}
                  </span>
                  {item.family !== "skill" && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {item.family}
                    </span>
                  )}
                  {item.tags?.slice(0, 4).map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 pr-6">
              {installed ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled
                  className="text-emerald-600 dark:text-emerald-400"
                >
                  ✓ 已安装
                </Button>
              ) : (
                <Button size="sm" onClick={onInstall} disabled={installing}>
                  {installing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download />
                  )}
                  {installing ? "安装中" : "安装"}
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Toolbar:模式切换 */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-2">
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(v) => v && setView(v as "rendered" | "raw")}
            size="sm"
          >
            <ToggleGroupItem value="rendered" aria-label="可视化">
              <FileText className="h-3.5 w-3.5" />
              <span className="text-xs">可视化</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="raw" aria-label="原文">
              <FileCode className="h-3.5 w-3.5" />
              <span className="text-xs">原文</span>
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="truncate font-mono text-[10px] text-muted-foreground">
            {item.name}
          </div>
        </div>

        {/* 内容区:SKILL.md */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {mdLoading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载 SKILL.md…
            </div>
          ) : mdError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {mdError}
            </div>
          ) : !mdContent ? (
            <div className="rounded-md border border-dashed border-muted-foreground/30 px-3 py-8 text-center text-sm text-muted-foreground">
              (该版本未提供 SKILL.md)
            </div>
          ) : view === "rendered" ? (
            <div className="markdown-body prose-sm max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={MD_COMPONENTS}
              >
                {stripFrontmatter(mdContent)}
              </ReactMarkdown>
            </div>
          ) : (
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
              {mdContent}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 数字人类友好格式化:1234 -> 1.2k,1234567 -> 1.2M */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** 按 name 哈希生成稳定的渐变色(跟 hub 后台同款视觉) */
function hashColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `linear-gradient(135deg, hsl(${hue}, 65%, 55%), hsl(${(hue + 40) % 360}, 65%, 45%))`;
}

function PluginsPlaceholder() {
  return (
    <div className="rounded-2xl border border-dashed border-black/[0.08] bg-white/40 px-6 py-12 text-center backdrop-blur dark:border-white/[0.08] dark:bg-white/[0.02]">
      <Sparkles className="mx-auto h-8 w-8 text-muted-foreground/50" />
      <p className="mt-3 text-sm text-muted-foreground">插件管理（OpenClaw plugins）</p>
      <p className="mt-1 text-xs text-muted-foreground/70">
        正在实装；支持 plugins.list / plugins.install / plugins.update
      </p>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      加载中…
    </div>
  );
}

function ErrorHint({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      加载失败：{message}
    </div>
  );
}

function EmptyInstalled() {
  return (
    <div className="rounded-2xl border border-dashed border-black/[0.08] bg-white/40 px-6 py-8 text-center backdrop-blur dark:border-white/[0.08] dark:bg-white/[0.02]">
      <p className="text-sm text-foreground/60">没有用户安装的技能</p>
      <p className="mt-1 text-xs text-foreground/45">
        从下方"推荐 / 技能广场"安装，或点右上角"添加技能"
      </p>
    </div>
  );
}

function AddSkillDropdown() {
  const setPendingInput = useChatStore((s) => s.setPendingInput);

  const handleFind = () => {
    setPendingInput("请帮我查找并自动安装能「___」的skill");
    window.location.hash = "/";
  };

  const handleUpload = async () => {
    const api = window.cjtClaw?.skills;
    if (!api) {
      toast.error("当前环境不支持上传(需要 Electron 主进程)");
      return;
    }
    try {
      const picked = await api.openFileDialog();
      if (!picked) return;
      const installed = await api.installZip(picked.zipPath);
      toast.success(`"${installed.name}" 安装完成`, {
        description: `已解压到 ${installed.path}`,
      });
    } catch (err) {
      toast.error("上传失败", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleCreate = () => {
    setPendingInput(
      "请帮我创建一个可以实现「___」的skill",
    );
    window.location.hash = "/";
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <Plus />
          添加技能
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={handleFind}>
          <Search />
          <span>查找技能</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleUpload}>
          <FileUp />
          <span>上传技能</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCreate}>
          <Pencil />
          <span>创建技能</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
