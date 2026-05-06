import { FormEvent, useState } from "react";
import { ExternalLink, Key, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSetSkillApiKey, type SkillStatusEntry } from "@/hooks/use-skills";

/**
 * 为需要 token 的 skill(SKILL.md frontmatter 里声明了 primaryEnv)配置 apiKey。
 * 走 OpenClaw 官方 `skills.update { apiKey }` RPC,下一轮 agent turn 即生效,
 * 不需要 export 或重启。
 */
export function SkillTokenDialog({
  skill,
  open,
  onOpenChange,
  tokenUrl,
}: {
  skill: SkillStatusEntry | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** 可选:skill frontmatter 里的 tokenUrl,点击跳转获取 token 页面 */
  tokenUrl?: string;
}) {
  const [apiKey, setApiKey] = useState("");
  const { mutateAsync, isPending } = useSetSkillApiKey();

  const handleOpenChange = (o: boolean) => {
    if (!o) setApiKey("");
    onOpenChange(o);
  };

  const openTokenUrl = (url: string) => {
    window.cjtClaw?.system
      ?.openExternal(url)
      .catch(() => window.open(url, "_blank"));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!skill || !apiKey.trim()) return;
    try {
      await mutateAsync({ skillKey: skill.skillKey, apiKey: apiKey.trim() });
      toast.success(`已保存 ${skill.name} 的 token`);
      handleOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    }
  };

  if (!skill) return null;

  const envName = skill.primaryEnv || "";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-2xl">{skill.emoji || "🔑"}</span>
            配置 {skill.name}
          </DialogTitle>
          <DialogDescription className="mt-1">
            该 skill 需要一个 token 才能调用。保存后下一次 AI 对话就可用,无需重启。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">
                {envName ? (
                  <>
                    <Key className="mr-1 inline h-3 w-3" />
                    {envName}
                  </>
                ) : (
                  "API Key"
                )}
              </span>
              {tokenUrl && (
                <button
                  type="button"
                  onClick={() => openTokenUrl(tokenUrl)}
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  获取 token
                  <ExternalLink className="h-2.5 w-2.5" />
                </button>
              )}
            </span>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="粘贴 token..."
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <span className="text-[10.5px] text-muted-foreground">
              保存到 ~/.openclaw/openclaw.json 的 skills.entries.{skill.skillKey}.apiKey,
              gateway 会在每轮对话前按 primaryEnv 注入 process.env。
            </span>
          </label>
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            取消
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={isPending || !apiKey.trim()}
          >
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
