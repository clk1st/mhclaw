/**
 * 命令式确认弹窗 + 消息提示。
 *
 * 用 `await showConfirm({...})` 替代 `window.confirm()`,用 `toast()` (sonner)
 * 替代 `window.alert()`。所有弹窗走同一套设计,不再出现原生 OS 对话框。
 *
 * 使用:
 *   import { showConfirm } from "@/lib/prompt";
 *   if (await showConfirm({ title: "删除?", danger: true })) { ... }
 *
 * 必须在 App 根挂一次 <ConfirmHost /> 才生效(已在 App.tsx 挂)。
 */
import {
  ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

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
import { cn } from "@/lib/utils";

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作:按钮着红,给人停一停的感觉 */
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  resolve: (ok: boolean) => void;
}

const listeners = new Set<() => void>();
let current: ConfirmState | null = null;

function notify() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot() {
  return current;
}

export function showConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    // 如果上一个还在,吞掉它(resolve false),让最新的请求展示
    if (current?.open) {
      current.resolve(false);
    }
    current = { ...opts, open: true, resolve };
    notify();
  });
}

function close(result: boolean) {
  if (!current) return;
  current.resolve(result);
  current = { ...current, open: false, resolve: current.resolve };
  notify();
  // 留点时间给退出动画,然后清空
  setTimeout(() => {
    if (current && !current.open) {
      current = null;
      notify();
    }
  }, 220);
}

/** 挂在 App 根,渲染当前的 AlertDialog。 */
export function ConfirmHost() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // 持有最后一帧的 opts 用于关闭动画期间继续展示
  const [cached, setCached] = useState<ConfirmOptions | null>(null);
  useEffect(() => {
    if (state?.open) setCached(state);
  }, [state]);

  const opts = state?.open ? state : cached;
  const isOpen = !!state?.open;

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(o) => {
        if (!o) close(false);
      }}
    >
      {opts && (
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{opts.title}</AlertDialogTitle>
            {opts.description && (
              <AlertDialogDescription asChild>
                <div>{opts.description}</div>
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => close(false)}>
              {opts.cancelText ?? "取消"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => close(true)}
              className={cn(
                opts.danger &&
                  "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/30",
              )}
            >
              {opts.confirmText ?? "确认"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
