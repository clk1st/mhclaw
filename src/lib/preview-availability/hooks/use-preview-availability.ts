import { useEffect, useState, useRef, useCallback } from "react";
import { useChatStore } from "@/stores/chat-store";
import { availabilityRegistry } from "../registry";
import type { PreviewStatus } from "../types";
import { INITIAL_STATUS } from "../types";

/**
 * 消费 availability 子系统的 React hook。
 *
 * 每个 embed 按钮挂一个实例,拿到 4 态 status:
 *  - pending / generating / ready / error
 *
 * 触发源(综合进同一个状态机):
 *  1. 挂载时立即 probe
 *  2. adapter.subscribe 回调 → re-probe(file 类走 chokidar)
 *  3. runActive 从 true 翻到 false 时 → reconcile re-probe(run 结束兜底)
 *  4. 外部 refetch() → 手动触发(点击兜底前的验证)
 *
 * 注意:不做"run 期间锁定"人为延迟。文件 ready 了就是 ready,UI 诚实反映。
 * 节拍感知由全局执行心跳 pill 单独承担,跟按钮态解耦。
 */
export function usePreviewAvailability(
  url: string | undefined,
  opts: { runActive: boolean } = { runActive: false },
): {
  status: PreviewStatus;
  refetch: () => Promise<PreviewStatus>;
} {
  const sessionKey = useChatStore((s) => s.sessionKey);
  const [status, setStatus] = useState<PreviewStatus>(INITIAL_STATUS);

  // runActive 用 ref 避免回调闭包拿到旧值 —— ctx 要反映最新态
  const runActiveRef = useRef(opts.runActive);
  runActiveRef.current = opts.runActive;

  const sessionKeyRef = useRef(sessionKey);
  sessionKeyRef.current = sessionKey;

  const probeOnce = useCallback(async (): Promise<PreviewStatus> => {
    if (!url) {
      const s: PreviewStatus = {
        kind: "error",
        reason: "embed 缺 url 字段",
      };
      setStatus(s);
      return s;
    }
    const s = await availabilityRegistry.probe(url, {
      runActive: runActiveRef.current,
      now: Date.now(),
      sessionKey: sessionKeyRef.current ?? undefined,
    });
    setStatus(s);
    return s;
  }, [url]);

  // 1 + 2:挂载即 probe,订阅 adapter change 事件
  useEffect(() => {
    if (!url) return;
    let cancelled = false;

    void probeOnce();

    const unsubscribe = availabilityRegistry.subscribe(url, () => {
      if (cancelled) return;
      void probeOnce();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [url, probeOnce]);

  // 3:runActive 从 true → false 触发一次 reconcile
  // 用 ref 记录上次的 runActive,只在翻转时 re-probe
  const prevRunActiveRef = useRef(opts.runActive);
  useEffect(() => {
    if (prevRunActiveRef.current && !opts.runActive) {
      // run 刚结束,re-probe 一次兜底
      void probeOnce();
    }
    prevRunActiveRef.current = opts.runActive;
  }, [opts.runActive, probeOnce]);

  return {
    status,
    refetch: probeOnce,
  };
}
