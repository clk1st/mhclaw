import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useChatStore } from "@/stores/chat-store";

/** 静默多久算"等待模型响应" */
const SILENT_THRESHOLD_MS = 30_000;

/**
 * Composer 上方的轻量执行状态栏 —— 全局节拍感知的承担者。
 *
 * 设计定位(跟另一个 AI 对齐讨论后的结论):
 *  - 不是 toast,不是中央浮层。持续运行状态应该贴在操作区,
 *    跟"停止"按钮(在 Composer 内)视觉上是一组。
 *  - 过程区的"正在执行 · mh-fin__xxx"是详情,本组件是全局心跳,两者分工。
 *  - 轻量行内样式:小 spinner + 12px 文本 + muted/primary 色,不抢注意力。
 *    无黑底 / 无阴影 / 不遮内容。
 *
 * 静默检测:
 *  - chat-store 里每个 agent/chat event 进来都刷新 lastEventAt
 *  - 本组件轮询计算静默时长,超过 30s 追加"· 等待模型响应"副标签
 *  - 典型触发场景:LLM 首 token 慢 / 连续两次 tool 之间的推理暂停
 *  - 作用:让用户知道"没卡死,是模型还没吐出来",而不是自己怀疑系统问题
 */
export function RunStatusBar() {
  const startedAt = useRef(Date.now());
  const lastEventAt = useChatStore((s) => s.lastEventAt);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const seconds = Math.floor((now - startedAt.current) / 1000);
  const timeLabel =
    seconds < 60
      ? `${seconds}s`
      : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

  // 静默时长 —— lastEventAt 为 null(还没收到任何事件)时用 startedAt 兜底,
  // 这样发送后一直没回音也能正确识别为"静默中"
  const effectiveLastEvent = lastEventAt ?? startedAt.current;
  const silentFor = now - effectiveLastEvent;
  const isWaitingModel = silentFor >= SILENT_THRESHOLD_MS;

  return (
    <div className="mb-2 flex items-center gap-1.5 px-3 text-[11px] text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin text-primary" />
      <span>
        AI 执行中 · {timeLabel}
        {isWaitingModel && (
          <span className="ml-1 text-amber-600/90 dark:text-amber-400/90">
            · 等待模型响应
          </span>
        )}
      </span>
    </div>
  );
}
