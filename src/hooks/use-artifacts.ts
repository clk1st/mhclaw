import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useChatStore } from "@/stores/chat-store";

/**
 * 产物清单的 React Query 封装。
 * 真相源 = <task-folder>/.mhclaw/artifacts.json;前端不做持久化。
 */

function qk(sessionKey: string) {
  return ["artifacts", sessionKey] as const;
}

export function useArtifactsForCurrentSession() {
  const sessionKey = useChatStore((s) => s.sessionKey);
  return useQuery({
    queryKey: qk(sessionKey),
    queryFn: async (): Promise<ArtifactEntry[]> => {
      const api = window.cjtClaw?.artifacts;
      if (!api || !sessionKey) return [];
      return api.list(sessionKey);
    },
    staleTime: 2_000,
    enabled: !!sessionKey,
  });
}

/**
 * AssistantFinal 扫到 [embed] 时调用:
 *   - 先 ensureForSession 保证有 task folder 可写
 *   - 再 artifacts:add 批量登记
 *   - 命中更新就 invalidate 当前 session 的 list
 */
export function useAddArtifacts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      sessionKey: string;
      entries: Array<{
        ref?: string;
        url?: string;
        title?: string;
        preferredHeight?: number;
        kind?: string;
      }>;
    }) => {
      const api = window.cjtClaw;
      if (!api || !args.sessionKey || args.entries.length === 0) return null;
      await api.taskFolder.ensureForSession(args.sessionKey);
      return api.artifacts.add(args);
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: qk(variables.sessionKey) });
      qc.invalidateQueries({ queryKey: ["taskFolder"] });
    },
  });
}
