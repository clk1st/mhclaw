import { ReactNode, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { LoginPage } from "./LoginPage";

/**
 * 启动闸门:
 * - status === idle/checking → loading
 * - status === guest         → 显示 LoginPage
 * - status === authed        → 显示 children(整个 app)
 *
 * 仅 mount 时跑一次 init,后续靠 store 自己维护状态。
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const init = useAuthStore((s) => s.init);

  useEffect(() => {
    if (status === "idle") init();
  }, [status, init]);

  if (status === "idle" || status === "checking") {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载…
        </div>
      </div>
    );
  }

  if (status === "guest") {
    return <LoginPage />;
  }

  return <>{children}</>;
}
