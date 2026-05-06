import { useEffect } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { useGatewayStore } from "@/stores/gateway-store";
import { useSetupStore } from "@/stores/setup-store";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthGate } from "@/components/auth/AuthGate";
import { ResizableShell } from "@/components/layout/ResizableShell";
import { SetupWizard } from "@/components/setup/SetupWizard";
import { ConfirmHost } from "@/lib/prompt";
import { installAvailabilityAdapters } from "@/lib/preview-availability";
import { HomePage } from "@/pages/HomePage";
import { ClawPage } from "@/pages/ClawPage";
import { ExpertsPage } from "@/pages/ExpertsPage";
import { SkillsPage } from "@/pages/SkillsPage";
import { AutomationPage } from "@/pages/AutomationPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

// 暴露给非 React 层(Zustand store)做 invalidate —— e.g. chat-store 发消息时
// lazy 建了任务目录要立刻刷 FilesTab 的 useQuery。
if (typeof window !== "undefined") {
  (window as unknown as { __mhclawQC: QueryClient }).__mhclawQC = queryClient;
}

// 注册 preview availability adapter —— 模块级,只需一次
installAvailabilityAdapters();

export default function App() {
  const init = useGatewayStore((s) => s.init);
  const activeId = useGatewayStore((s) => s.activeId);
  const gateways = useGatewayStore((s) => s.gateways);
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);

  const checkSetup = useSetupStore((s) => s.checkSetup);

  const active = gateways.find((g) => g.id === activeId);
  const connected = active?.status === "connected";

  // 初始化 Gateway
  useEffect(() => {
    init();
  }, [init]);

  // Gateway 连通后静默检查模型配置（只更新 needsSetup，不强制阻塞）
  useEffect(() => {
    if (!connected) return;
    const client = getActiveClient();
    if (!client) return;
    checkSetup(client);
  }, [connected, activeId, getActiveClient, checkSetup]);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthGate>
          <HashRouter>
            <Routes>
              <Route path="/" element={<ResizableShell />}>
                <Route index element={<HomePage />} />
                <Route path="claw" element={<ClawPage />} />
                <Route path="experts" element={<ExpertsPage />} />
                <Route path="skills" element={<SkillsPage />} />
                <Route path="automation" element={<AutomationPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </HashRouter>
          {/* 全局 Setup Dialog，随时可开可关 */}
          <SetupWizard />
          {/* 全局命令式确认弹窗(showConfirm) */}
          <ConfirmHost />
          {/* 全局 Toast(安装成功 / 操作结果) */}
          <Toaster
            position="bottom-right"
            richColors
            closeButton
            duration={3000}
          />
        </AuthGate>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
