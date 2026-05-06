import { List } from "lucide-react";
import { useChatStore } from "@/stores/chat-store";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * 聊天窗口右上角的"问题索引"Popover。
 * 列出当前 session 所有 user messages，点击滚到对应位置 + 1.5s 高亮。
 */
export function QuestionIndex() {
  const messages = useChatStore((s) => s.messages);
  const userMessages = messages.filter((m) => m.role === "user");

  const handleJump = (id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-primary", "ring-offset-2");
    window.setTimeout(() => {
      el.classList.remove("ring-2", "ring-primary", "ring-offset-2");
    }, 1500);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          title="问题索引"
          disabled={userMessages.length === 0}
        >
          <List />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <div className="flex items-center justify-between px-2 pb-2 pt-1">
          <span className="text-xs font-medium">历史追问</span>
          <span className="text-[10px] text-muted-foreground">
            {userMessages.length}
          </span>
        </div>
        <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
          {userMessages.length === 0 ? (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              尚无提问
            </div>
          ) : (
            userMessages.map((m, i) => (
              <button
                key={m.id}
                onClick={() => handleJump(m.id)}
                className="flex gap-2 rounded-md px-2 py-1.5 text-left text-xs transition hover:bg-accent"
              >
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {i + 1}.
                </span>
                <span className="line-clamp-2 min-w-0 flex-1">{m.content}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
