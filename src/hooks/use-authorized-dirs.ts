import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useAuthorizedDirs() {
  return useQuery({
    queryKey: ["authorizedDirs"],
    queryFn: async (): Promise<AuthorizedDir[]> => {
      const api = window.cjtClaw?.authorizedDirs;
      if (!api) return [];
      return api.list();
    },
    staleTime: 10_000,
  });
}

export function usePickAndAddAuthorizedDir() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (note?: string) => {
      const api = window.cjtClaw?.authorizedDirs;
      if (!api) throw new Error("需要 Electron 环境");
      return api.pickAndAdd(note);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["authorizedDirs"] });
    },
  });
}

export function useRemoveAuthorizedDir() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (absPath: string) => {
      const api = window.cjtClaw?.authorizedDirs;
      if (!api) throw new Error("需要 Electron 环境");
      return api.remove(absPath);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["authorizedDirs"] });
    },
  });
}
