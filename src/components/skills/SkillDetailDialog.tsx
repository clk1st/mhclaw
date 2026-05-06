import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { ExternalLink, FileCode, FileText, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useToggleSkill, type SkillStatusEntry } from "@/hooks/use-skills";
import { cn } from "@/lib/utils";

type ViewMode = "rendered" | "raw";

interface Props {
  skill: SkillStatusEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 技能详情 Dialog（对标 WorkBuddy 的双模式）：
 * - "可视化"：用 react-markdown 渲染 SKILL.md（GFM + 代码高亮）
 * - "原文"：原始 .md 源码 <pre> 显示（含 frontmatter）
 * 顶部启用开关、emoji + name + description + source 徽章。
 */
export function SkillDetailDialog({ skill, open, onOpenChange }: Props) {
  const [view, setView] = useState<ViewMode>("rendered");
  const [content, setContent] = useState<string>("");
  const [path, setPath] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState(false);
  const [confirmingUninstall, setConfirmingUninstall] = useState(false);
  const toggle = useToggleSkill();
  const qc = useQueryClient();

  // dialog 关闭时重置确认态(避免下次打开还残留)
  useEffect(() => {
    if (!open) setConfirmingUninstall(false);
  }, [open]);

  /**
   * 真正执行卸载(已经过二次确认)。
   * 确认 UI 内嵌在 Dialog 里(旧版用 sonner toast 会被 Dialog overlay 挡住)。
   */
  const doUninstall = async () => {
    if (!skill) return;
    const label = skill.name;
    const key = skill.skillKey;
    setUninstalling(true);
    try {
      await window.cjtClaw?.skills?.deleteCustomSkill(key);
      toast.success(`"${label}" 已卸载`);
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["skill-hub-sidecars"] });
      onOpenChange(false);
    } catch (e) {
      toast.error(`"${label}" 卸载失败`, {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setUninstalling(false);
      setConfirmingUninstall(false);
    }
  };

  // 拉 SKILL.md 源码
  useEffect(() => {
    if (!open || !skill) return;
    setLoading(true);
    setError(null);
    setContent("");
    setPath("");
    const skillsApi = window.cjtClaw?.skills;
    if (!skillsApi?.getMd) {
      setError("当前环境不支持读取 SKILL.md");
      setLoading(false);
      return;
    }
    // 用 skillKey(目录名)查 SKILL.md,不是 skill.name(中文显示名)
    skillsApi
      .getMd(skill.skillKey)
      .then((res) => {
        setContent(res.content);
        setPath(res.path);
      })
      .catch((err: Error) => {
        setError(err.message || "读取失败");
      })
      .finally(() => setLoading(false));
  }, [open, skill]);

  if (!skill) return null;

  const enabled = !skill.disabled;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col gap-0 p-0">
        {/* 顶部 header */}
        <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-xl">
                {skill.emoji || "🔧"}
              </div>
              <div className="min-w-0">
                <DialogTitle className="truncate">{skill.name}</DialogTitle>
                <DialogDescription className="mt-1 line-clamp-2">
                  {skill.description || "（无描述）"}
                </DialogDescription>
                <div className="mt-1.5 flex gap-1">
                  {skill.bundled && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      内置
                    </span>
                  )}
                  {skill.always && (
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                      always
                    </span>
                  )}
                  {skill.source && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {skill.source}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3 pr-6">
              {!skill.always && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {enabled ? "已启用" : "已停用"}
                  </span>
                  <Switch
                    checked={enabled}
                    disabled={toggle.isPending}
                    onCheckedChange={(v) =>
                      toggle.mutate({ skillKey: skill.skillKey, enabled: v })
                    }
                  />
                </div>
              )}
              {/* 卸载仅对非 bundled skill 可用;bundled 跟随 OpenClaw 安装,不能删 */}
              {!skill.bundled && !confirmingUninstall && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setConfirmingUninstall(true)}
                  disabled={uninstalling}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  title="卸载(删除本地 workspace 里的副本)"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="text-xs">卸载</span>
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* 卸载确认条(内嵌在 Dialog 里,避免被 overlay 挡住) */}
        {confirmingUninstall && (
          <div className="flex items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/5 px-6 py-3">
            <div className="flex min-w-0 items-start gap-2 text-sm">
              <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="min-w-0">
                <div className="font-medium text-destructive">
                  确认卸载 "{skill.name}"?
                </div>
                <div className="text-xs text-muted-foreground">
                  将删除本地 workspace/skills/ 目录下的文件,可从技能广场重装。
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmingUninstall(false)}
                disabled={uninstalling}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={doUninstall}
                disabled={uninstalling}
              >
                {uninstalling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                确认卸载
              </Button>
            </div>
          </div>
        )}

        {/* Toolbar：模式切换 + 文件路径 */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-2">
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(v) => v && setView(v as ViewMode)}
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
          {path && (
            <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
              <ExternalLink className="h-3 w-3" />
              <span className="truncate font-mono">{path}</span>
            </div>
          )}
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载 SKILL.md…
            </div>
          ) : error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : view === "rendered" ? (
            <div className={cn("markdown-body prose-sm max-w-none")}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={MD_COMPONENTS}
              >
                {stripFrontmatter(content)}
              </ReactMarkdown>
            </div>
          ) : (
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
              {content}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 去掉 YAML frontmatter（仅可视化模式用，原文模式保留） */
export function stripFrontmatter(content: string): string {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return content;
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) return content;
  return content.slice(end + 4).replace(/^\s*\n/, "");
}

/* react-markdown 自定义组件，让样式与 mhclaw 一致 */
export const MD_COMPONENTS = {
  h1: (props: { children?: React.ReactNode }) => (
    <h1 className="mb-3 mt-4 text-xl font-semibold tracking-tight" {...props} />
  ),
  h2: (props: { children?: React.ReactNode }) => (
    <h2 className="mb-2 mt-4 text-base font-semibold tracking-tight" {...props} />
  ),
  h3: (props: { children?: React.ReactNode }) => (
    <h3 className="mb-1.5 mt-3 text-sm font-semibold" {...props} />
  ),
  p: (props: { children?: React.ReactNode }) => (
    <p className="my-2 text-sm leading-relaxed" {...props} />
  ),
  a: ({ href, children, ...rest }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      className="text-primary underline-offset-2 hover:underline"
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => {
        // 防 Electron webContents 被整页导航走;用系统浏览器打开外链
        if (!href) return;
        e.preventDefault();
        window.cjtClaw?.system
          ?.openExternal(href)
          .catch(() => window.open(href, "_blank"));
      }}
      {...rest}
    >
      {children}
    </a>
  ),
  ul: (props: { children?: React.ReactNode }) => (
    <ul className="my-2 ml-5 list-disc space-y-1 text-sm" {...props} />
  ),
  ol: (props: { children?: React.ReactNode }) => (
    <ol className="my-2 ml-5 list-decimal space-y-1 text-sm" {...props} />
  ),
  code: ({ inline, className, children, ...rest }: { inline?: boolean; className?: string; children?: React.ReactNode }) =>
    inline ? (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...rest}>
        {children}
      </code>
    ) : (
      <code className={cn("font-mono text-xs", className)} {...rest}>
        {children}
      </code>
    ),
  pre: (props: { children?: React.ReactNode }) => (
    <pre className="my-3 overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed" {...props} />
  ),
  table: (props: { children?: React.ReactNode }) => (
    <div className="my-3 overflow-x-auto">
      <table className="min-w-full border-collapse text-xs" {...props} />
    </div>
  ),
  th: (props: { children?: React.ReactNode }) => (
    <th className="border border-border bg-muted px-2 py-1 text-left font-semibold" {...props} />
  ),
  td: (props: { children?: React.ReactNode }) => (
    <td className="border border-border px-2 py-1" {...props} />
  ),
  blockquote: (props: { children?: React.ReactNode }) => (
    <blockquote
      className="my-3 border-l-2 border-primary/40 bg-muted/40 px-3 py-1 text-sm text-muted-foreground"
      {...props}
    />
  ),
};
