import { useState } from "react";
import { Inbox, Loader2, Trash2, Undo2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useArchiveStore } from "@/stores/archive-store";
import { useSessions } from "@/hooks/use-sessions";
import { useChatStore, type SessionInfo } from "@/stores/chat-store";
import { useGatewayStore } from "@/stores/gateway-store";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * 数据管理 pane —— 展示已归档任务,支持"取消归档 / 删除任务"。
 * 设计成独立 pane 组件,SettingsDialog 把它作为一个 tab 嵌入。
 */
export function DataManagementPane() {
  const { data: allSessions = [] } = useSessions();
  const archivedList = useArchiveStore((s) => s.archived);
  const unarchive = useArchiveStore((s) => s.unarchive);
  const qc = useQueryClient();
  const getClient = useGatewayStore((s) => s.getActiveClient);
  const [pendingDelete, setPendingDelete] = useState<SessionInfo | null>(null);
  const [deleting, setDeleting] = useState(false);

  const archived = allSessions.filter((s) => archivedList.includes(s.key));

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const client = getClient();
    if (!client) {
      toast.error("Gateway 未连接");
      return;
    }
    setDeleting(true);
    try {
      // sessions.delete 的参数名是 key(不是 sessionKey),另外 deleteTranscript 才会清 jsonl
      await client.request("sessions.delete", {
        key: pendingDelete.key,
        deleteTranscript: true,
      });
      unarchive(pendingDelete.key);
      qc.invalidateQueries({ queryKey: ["sessions"] });
      toast.success("任务已删除");
      if (pendingDelete.key === useChatStore.getState().sessionKey) {
        useChatStore.getState().newSession();
      }
      setPendingDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 px-8 py-7">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">数据管理</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          已归档的任务不在主任务列表显示。可以取消归档重新显示,或者永久删除(不可撤销)。
        </p>
      </div>

      <div className="flex-1">
        {archived.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-muted-foreground/30 py-16 text-sm text-muted-foreground">
            <Inbox className="h-8 w-8 text-muted-foreground/40" />
            <span>暂无已归档任务</span>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {archived.map((s) => (
              <ArchivedRow
                key={s.key}
                session={s}
                onUnarchive={() => {
                  unarchive(s.key);
                  toast.success("已取消归档");
                }}
                onDelete={() => setPendingDelete(s)}
              />
            ))}
          </div>
        )}
      </div>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && !deleting && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除任务</AlertDialogTitle>
            <AlertDialogDescription>
              确认永久删除该任务吗?此操作不可撤销,会话历史和产出会一起被清除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ArchivedRow({
  session,
  onUnarchive,
  onDelete,
}: {
  session: SessionInfo;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const title = session.title?.trim() || session.lastMessage?.trim() || session.key;
  const ts = (session.updatedAt ?? 0) > 0 ? new Date(session.updatedAt ?? 0) : null;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-white/50 px-3 py-2 dark:bg-white/[0.03]">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{title}</div>
        {ts && (
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            {ts.toLocaleString()}
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button variant="outline" size="sm" onClick={onUnarchive}>
          <Undo2 className="mr-1 h-3 w-3" />
          取消归档
        </Button>
        <Button variant="outline" size="sm" onClick={onDelete}>
          <Trash2 className="mr-1 h-3 w-3" />
          删除任务
        </Button>
      </div>
    </div>
  );
}
