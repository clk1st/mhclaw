import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { usePreviewStore } from "@/stores/preview-store";
import { useChatStore } from "@/stores/chat-store";
import { Button } from "@/components/ui/button";
import { QuestionIndex } from "./QuestionIndex";

/**
 * 聊天窗口顶部 header：展示当前 session 标题 + 右上角操作（问题索引 / 右侧面板开关）。
 * 只在有消息时渲染；Hero 状态下不占位。
 */
export function ChatHeader() {
  const sessionKey = useChatStore((s) => s.sessionKey);
  const sessionTitles = useChatStore((s) => s.sessionTitles);
  const panelOpen = usePreviewStore((s) => s.panelOpen);
  const togglePanel = usePreviewStore((s) => s.togglePanel);

  const title = sessionTitles[sessionKey] || sessionKey;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
      <div className="min-w-0 flex-1 truncate text-sm font-medium">{title}</div>
      <div className="flex items-center gap-0.5">
        <QuestionIndex />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={togglePanel}
          title={panelOpen ? "收起右侧面板" : "展开右侧面板"}
        >
          {panelOpen ? <PanelRightClose /> : <PanelRightOpen />}
        </Button>
      </div>
    </div>
  );
}
