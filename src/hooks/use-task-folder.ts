import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useChatStore } from "@/stores/chat-store";

/**
 * 当前 session 的任务目录绑定。
 * 切 session 时自动 refetch;绑定/解绑后 invalidate 让 Composer 刷短路径。
 */
export function useCurrentTaskFolder() {
  const sessionKey = useChatStore((s) => s.sessionKey);
  return useQuery({
    queryKey: ["taskFolder", "forSession", sessionKey],
    queryFn: async (): Promise<string | null> => {
      const api = window.cjtClaw?.taskFolder;
      if (!api) return null;
      return (await api.getForSession(sessionKey)) ?? null;
    },
    staleTime: 1_000,
  });
}

export function useRecentTaskFolders() {
  return useQuery({
    queryKey: ["taskFolder", "recent"],
    queryFn: async (): Promise<OutputDirEntry[]> => {
      const api = window.cjtClaw?.taskFolder;
      if (!api) return [];
      return api.listRecent();
    },
    staleTime: 5_000,
  });
}

export function useCreateBlankTask() {
  const qc = useQueryClient();
  const sessionKey = useChatStore((s) => s.sessionKey);
  return useMutation({
    mutationFn: async () => {
      const api = window.cjtClaw?.taskFolder;
      if (!api) throw new Error("需要 Electron 环境");
      return api.createBlank(sessionKey);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["taskFolder"] });
    },
  });
}

export function usePickExternalTaskFolder() {
  const qc = useQueryClient();
  const sessionKey = useChatStore((s) => s.sessionKey);
  return useMutation({
    mutationFn: async () => {
      const api = window.cjtClaw?.taskFolder;
      if (!api) throw new Error("需要 Electron 环境");
      return api.pickExternal(sessionKey);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["taskFolder"] });
    },
  });
}

export function useBindTaskFolder() {
  const qc = useQueryClient();
  const sessionKey = useChatStore((s) => s.sessionKey);
  return useMutation({
    mutationFn: async (taskPath: string) => {
      const api = window.cjtClaw?.taskFolder;
      if (!api) throw new Error("需要 Electron 环境");
      return api.bindSession({ sessionKey, path: taskPath });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["taskFolder"] });
    },
  });
}

export function useTogglePinTaskFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (path: string) => {
      const api = window.cjtClaw?.taskFolder;
      if (!api) throw new Error("需要 Electron 环境");
      return api.togglePin(path);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["taskFolder", "recent"] });
    },
  });
}

export function useRemoveTaskFolderFromIndex() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (path: string) => {
      const api = window.cjtClaw?.taskFolder;
      if (!api) throw new Error("需要 Electron 环境");
      return api.removeFromIndex(path);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["taskFolder"] });
    },
  });
}

export function useWorkRoot() {
  return useQuery({
    queryKey: ["workRoot"],
    queryFn: async () => {
      const api = window.cjtClaw?.workRoot;
      if (!api) return null;
      return api.get();
    },
    staleTime: 10_000,
  });
}

export function usePickWorkRoot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const api = window.cjtClaw?.workRoot;
      if (!api) throw new Error("需要 Electron 环境");
      return api.pickAndSet();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workRoot"] });
    },
  });
}
