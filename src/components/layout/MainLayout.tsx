import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useGatewayStore } from "@/stores/gateway-store";
import { useChatStore } from "@/stores/chat-store";
import { Sidebar } from "./Sidebar";

export function MainLayout() {
  const activeId = useGatewayStore((s) => s.activeId);
  const gateways = useGatewayStore((s) => s.gateways);
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);

  const active = gateways.find((g) => g.id === activeId);
  const connected = active?.status === "connected";

  // Gateway 连通后绑定 chat 事件订阅
  useEffect(() => {
    if (!connected) return;
    const client = getActiveClient();
    if (!client) return;
    const unbind = useChatStore.getState().bind(client);
    return unbind;
  }, [connected, activeId, getActiveClient]);

  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <main className="flex-1 overflow-hidden bg-background">
        <Outlet />
      </main>
    </div>
  );
}
