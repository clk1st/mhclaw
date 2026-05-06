import { FolderPlus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  useAuthorizedDirs,
  usePickAndAddAuthorizedDir,
  useRemoveAuthorizedDir,
} from "@/hooks/use-authorized-dirs";
import { showConfirm } from "@/lib/prompt";

/**
 * 授权目录白名单管理。
 *
 * 这里列出的目录可以被 mhclaw-authorized:// 协议访问(预览层 / AI 产出层会用)。
 * 首次添加时需要用户用系统原生 Dialog 选择 —— 不允许由 AI 或脚本任意添加。
 */
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AuthorizedDirsDialog({ open, onOpenChange }: Props) {
  const { data: dirs = [], isLoading } = useAuthorizedDirs();
  const pickAdd = usePickAndAddAuthorizedDir();
  const remove = useRemoveAuthorizedDir();

  const handleAdd = async () => {
    try {
      await pickAdd.mutateAsync(undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "添加失败");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            授权目录
          </DialogTitle>
          <DialogDescription>
            明确授权给 AI 访问的本地目录。只有在这里列出的目录,AI
            才能通过 mhclaw-authorized:// 协议读取。授权可以随时撤销。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between pt-1">
          <div className="text-xs text-muted-foreground">
            {dirs.length} 个已授权
          </div>
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={pickAdd.isPending}
          >
            <FolderPlus />
            添加授权目录
          </Button>
        </div>

        <div className="flex max-h-[420px] flex-col gap-1 overflow-y-auto pr-1">
          {isLoading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              加载中…
            </div>
          ) : dirs.length === 0 ? (
            <Empty />
          ) : (
            dirs.map((d) => (
              <DirRow
                key={d.path}
                dir={d}
                onRemove={async () => {
                  const ok = await showConfirm({
                    title: "撤销授权?",
                    description: `"${shortenHome(d.path)}" 将不再对 AI 可见。`,
                    confirmText: "撤销",
                    danger: true,
                  });
                  if (ok) remove.mutate(d.path);
                }}
              />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Empty() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-10 text-center">
      <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground/40" />
      <p className="mt-3 text-sm text-muted-foreground">暂无授权目录</p>
      <p className="mt-1 text-xs text-muted-foreground/70">
        点击上方"添加授权目录"给 AI 开放指定的本地文件夹。
        <br />
        安全提示:不要授权根目录、Home 根或含敏感数据的目录。
      </p>
    </div>
  );
}

function DirRow({
  dir,
  onRemove,
}: {
  dir: AuthorizedDir;
  onRemove: () => void;
}) {
  return (
    <div className="group flex items-start gap-2 rounded-xl border border-border bg-card px-3 py-2 transition hover:border-foreground/20">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <ShieldCheck className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs">{shortenHome(dir.path)}</div>
        {dir.note && (
          <div className="truncate text-[11px] text-muted-foreground">
            {dir.note}
          </div>
        )}
        <div className="mt-0.5 text-[10px] text-muted-foreground/70">
          授权于 {new Date(dir.addedAt).toLocaleString()}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onRemove}
        title="撤销授权"
        className="opacity-0 transition group-hover:opacity-100 hover:text-destructive"
      >
        <Trash2 />
      </Button>
    </div>
  );
}

function shortenHome(p: string): string {
  const m = p.match(/^\/Users\/[^/]+\//);
  if (m) return "~/" + p.slice(m[0].length);
  return p;
}
