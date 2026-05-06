import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  PanelLeft,
  PanelLeftClose,
  PanelRightClose,
  PanelRightOpen,
  Plus,
} from "lucide-react";
import { QuestionIndex } from "@/components/chat/QuestionIndex";
import { useGatewayStore } from "@/stores/gateway-store";
import { useChatStore } from "@/stores/chat-store";
import { usePreviewStore } from "@/stores/preview-store";
import { useUIStore } from "@/stores/ui-store";
import { Sidebar } from "./Sidebar";
import { RightPanel } from "@/components/right-panel/RightPanel";
import { cn } from "@/lib/utils";

/**
 * 三栏外壳：Sidebar 固定 + Main flex-1 + RightPanel 像素受控 + 自绘拖拽条。
 *
 * 弃用 react-resizable-panels（v4 API 跟布局系统耦合过深，HMR 下 defaultSize 不可靠），
 * 直接 CSS flex + mousedown 拖拽，宽度持久化 localStorage。
 */

const STORAGE_KEY = "mhclaw-right-width";
const MIN_WIDTH = 360;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 520;

function loadWidth(): number {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(v) && v >= MIN_WIDTH && v <= MAX_WIDTH) return v;
  } catch {
    // ignore
  }
  return DEFAULT_WIDTH;
}

function persistWidth(v: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(v));
  } catch {
    // ignore
  }
}

export function ResizableShell() {
  const activeId = useGatewayStore((s) => s.activeId);
  const gateways = useGatewayStore((s) => s.gateways);
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);

  const active = gateways.find((g) => g.id === activeId);
  const connected = active?.status === "connected";

  const panelOpen = usePreviewStore((s) => s.panelOpen);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);

  const [width, setWidth] = useState<number>(() => loadWidth());
  const draggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Gateway 连通后绑定 chat 事件订阅
  useEffect(() => {
    if (!connected) return;
    const client = getActiveClient();
    if (!client) return;
    const unbind = useChatStore.getState().bind(client);
    return unbind;
  }, [connected, activeId, getActiveClient]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        if (!draggingRef.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        // 右边沿距离 = 容器右边界 - 鼠标 X
        const next = Math.min(
          MAX_WIDTH,
          Math.max(MIN_WIDTH, rect.right - ev.clientX),
        );
        setWidth(next);
      };
      const onUp = () => {
        draggingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setWidth((cur) => {
          persistWidth(cur);
          return cur;
        });
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [],
  );

  return (
    <div className="flex h-full w-full">
      {!sidebarCollapsed && <Sidebar />}
      <div ref={containerRef} className="relative flex flex-1 min-w-0 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TopBar />
          <main className="flex-1 min-w-0 overflow-hidden">
            <Outlet />
          </main>
        </div>

        {panelOpen && (
          <>
            {/* 拖拽条:14px 命中区 + 中间 2px 可见线(柔色) */}
            <div
              onMouseDown={handleMouseDown}
              className={cn(
                "group relative flex w-[14px] shrink-0 cursor-col-resize items-stretch justify-center",
              )}
            >
              <span className="w-[2px] rounded-full bg-black/10 transition group-hover:bg-black/25 dark:bg-white/10 dark:group-hover:bg-white/25" />
            </div>

            <aside
              style={{ width }}
              className="shrink-0 overflow-hidden"
            >
              <RightPanel />
            </aside>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Main 区顶部工具条(WorkBuddy 式):
 *  - 左:[折叠/展开 Sidebar] [新建任务] [当前任务标题]
 *  - 右:[问题索引] [右面板 toggle](只在聊天有消息时)
 *  - sidebar 收起时,左边留 macOS traffic light 位(~76px)
 * 合并了老的 ChatHeader,不再有独立任务标题栏。
 */
function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === "/";

  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  const sessionKey = useChatStore((s) => s.sessionKey);
  const sessionTitles = useChatStore((s) => s.sessionTitles);
  const hasMessages = useChatStore((s) => s.messages.length > 0);

  const panelOpen = usePreviewStore((s) => s.panelOpen);
  const togglePanel = usePreviewStore((s) => s.togglePanel);

  const handleNewTask = () => {
    useChatStore.getState().newSession();
    if (!isHome) navigate("/");
  };

  const showTaskTitle = isHome && hasMessages;
  const taskTitle = sessionTitles[sessionKey] || sessionKey;

  return (
    <div
      className={cn(
        "app-drag flex h-11 shrink-0 items-center gap-1 px-2",
        // sidebar 收起:左边留出 macOS traffic light 区域(~76px)
        // sidebar 展开:sidebar 已占左侧,TopBar 紧贴其右侧,无需偏移
        sidebarCollapsed && "pl-[76px]",
      )}
    >
      {/* 左:折叠 + 新建(按钮 no-drag,否则点不动) */}
      <div className="app-no-drag flex items-center gap-1">
        <TopBarBtn
          onClick={toggleSidebar}
          title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
        >
          {sidebarCollapsed ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </TopBarBtn>
        <TopBarBtn onClick={handleNewTask} title="新建任务">
          <Plus className="h-4 w-4" />
        </TopBarBtn>
      </div>

      {/* 中:任务标题(仅有消息的聊天页) */}
      {showTaskTitle && (
        <>
          <div className="mx-2 h-4 w-px bg-black/[0.08] dark:bg-white/[0.08]" />
          <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/85">
            {taskTitle}
          </div>
        </>
      )}

      {/* 右:问题索引 + 右面板 toggle(仅聊天页) */}
      {showTaskTitle && (
        <div className="app-no-drag ml-auto flex items-center gap-0.5">
          <QuestionIndex />
          <TopBarBtn
            onClick={togglePanel}
            title={panelOpen ? "收起右侧面板" : "展开右侧面板"}
          >
            {panelOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </TopBarBtn>
        </div>
      )}
    </div>
  );
}

function TopBarBtn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-md text-foreground/55 transition hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]"
    >
      {children}
    </button>
  );
}
