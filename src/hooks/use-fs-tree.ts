import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * 任务目录的文件系统操作 hooks。
 *
 * 文件树按节点懒加载(每层一次 IPC 调用)。
 * 订阅 fileWatcher 事件触发相关 query 失效,自动刷新。
 */

export function useFileChildren(taskPath: string | null | undefined, rel: string) {
  return useQuery({
    queryKey: ["fs", "children", taskPath, rel],
    queryFn: async (): Promise<FsNode[]> => {
      if (!taskPath) return [];
      const api = window.cjtClaw?.fs;
      if (!api) return [];
      return api.listChildren({ taskPath, rel });
    },
    enabled: !!taskPath,
    staleTime: 2_000,
  });
}

export function useReadCurrentText(
  taskPath: string | null | undefined,
  rel: string | null,
) {
  return useQuery({
    queryKey: ["fs", "text", taskPath, rel],
    queryFn: async (): Promise<string | null> => {
      if (!taskPath || !rel) return null;
      const api = window.cjtClaw?.fs;
      if (!api) return null;
      return api.readCurrentText({ taskPath, rel });
    },
    enabled: !!taskPath && !!rel,
    staleTime: 5_000,
  });
}

/**
 * 启动/停止任务目录的文件监听。
 * 监听事件自动失效相关 query。
 */
export function useWatchTaskFolder(taskPath: string | null | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!taskPath) return;
    const api = window.cjtClaw?.fileWatcher;
    if (!api) return;

    let disposed = false;
    let offEvent: (() => void) | null = null;

    (async () => {
      await api.start(taskPath);
      if (disposed) return;
      offEvent = api.onEvent((ev) => {
        if (ev.taskPath !== taskPath) return;
        // 失效所有 fs:children 和 snapshot:diff
        qc.invalidateQueries({ queryKey: ["fs", "children", taskPath] });
        qc.invalidateQueries({ queryKey: ["snapshot", "diff", taskPath] });
        qc.invalidateQueries({ queryKey: ["fs", "text", taskPath, ev.rel] });
        qc.invalidateQueries({
          queryKey: ["snapshot", "baselineText", taskPath, ev.rel],
        });
        // 产物 Tab 的数据源之一是 task folder 扫盘 → 文件一变就刷
        qc.invalidateQueries({ queryKey: ["artifacts"] });
      });
    })();

    return () => {
      disposed = true;
      offEvent?.();
      // 不主动 stop —— 可能下一个 effect 就会 start 另一个,由 start 内部替换
    };
  }, [taskPath, qc]);
}

export function useCaptureBaseline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (taskPath: string) => {
      const api = window.cjtClaw?.snapshot;
      if (!api) throw new Error("需要 Electron 环境");
      return api.capture(taskPath);
    },
    onSuccess: (_d, taskPath) => {
      qc.invalidateQueries({ queryKey: ["snapshot", "diff", taskPath] });
    },
  });
}

export function useSnapshotDiff(taskPath: string | null | undefined) {
  return useQuery({
    queryKey: ["snapshot", "diff", taskPath],
    queryFn: async (): Promise<ChangeEntry[]> => {
      if (!taskPath) return [];
      const api = window.cjtClaw?.snapshot;
      if (!api) return [];
      return api.diff(taskPath);
    },
    enabled: !!taskPath,
    staleTime: 2_000,
  });
}

/** 还原:把基线文本写回当前文件(覆盖)。仅对 hasBaselineText 的文件有意义。 */
export function useRevertToBaseline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      taskPath: string;
      rel: string;
      baselineText: string;
    }) => {
      const api = window.cjtClaw?.fs;
      if (!api) throw new Error("需要 Electron 环境");
      return api.writeText({
        taskPath: args.taskPath,
        rel: args.rel,
        content: args.baselineText,
      });
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["snapshot", "diff", vars.taskPath] });
      qc.invalidateQueries({ queryKey: ["fs", "text", vars.taskPath, vars.rel] });
      qc.invalidateQueries({ queryKey: ["fs", "children", vars.taskPath] });
    },
  });
}

export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { taskPath: string; rel: string }) => {
      const api = window.cjtClaw?.fs;
      if (!api) throw new Error("需要 Electron 环境");
      return api.deleteFile(args);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["snapshot", "diff", vars.taskPath] });
      qc.invalidateQueries({ queryKey: ["fs", "children", vars.taskPath] });
    },
  });
}

export function useBaselineText(
  taskPath: string | null | undefined,
  rel: string | null,
) {
  return useQuery({
    queryKey: ["snapshot", "baselineText", taskPath, rel],
    queryFn: async (): Promise<string | null> => {
      if (!taskPath || !rel) return null;
      const api = window.cjtClaw?.snapshot;
      if (!api) return null;
      return api.readBaselineText({ taskPath, rel });
    },
    enabled: !!taskPath && !!rel,
    staleTime: 10_000,
  });
}
