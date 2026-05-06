import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGatewayStore } from "@/stores/gateway-store";

/**
 * cron.list 返回里 schedule 字段的结构化形状。
 * Gateway 新版本返 object,老版本可能返字符串,两种都兼容。
 */
export interface GatewayScheduleDto {
  kind: "at" | "every" | "cron";
  expr: string;
  tz?: string;
  staggerMs?: number;
}

export interface CronJob {
  id: string;
  name?: string;
  type?: "at" | "every" | "cron";
  /**
   * 老 Gateway 返字符串;新 Gateway 返 GatewayScheduleDto 对象。
   * 乐观更新可能暂时塞 CronSchedule(提交侧结构),服务端返回后会被正式覆盖。
   */
  schedule?: string | GatewayScheduleDto | CronSchedule;
  iana?: string;
  target?: "main" | "isolated" | "current";
  /** Gateway 新版返 sessionTarget(main / isolated / current),老版用 target */
  sessionTarget?: "main" | "isolated" | "current";
  delivery?: "announce" | "webhook" | "none" | { mode?: string };
  enabled?: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
  lastStatus?: string;
  /** 直接的顶层 message(老版兼容) */
  message?: string;
  /** 新版结构化 payload —— 回填编辑 Dialog 时从这里取 message */
  payload?: { kind?: string; message?: string };
  sessionKey?: string;
  updatedAt?: number;
}

/** 一次执行的记录(cron.runs 返回) */
export interface CronRun {
  id?: string;
  jobId?: string;
  runAt?: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  status?: "success" | "failed" | "timed_out" | "running" | string;
  message?: string;
  error?: string;
  sessionKey?: string;
}

function parseJobs(result: unknown): CronJob[] {
  if (!result) return [];
  if (Array.isArray(result)) return result as CronJob[];
  const d = result as Record<string, unknown>;
  for (const key of ["jobs", "list", "entries", "crons"]) {
    if (Array.isArray(d[key])) return d[key] as CronJob[];
  }
  return [];
}

export function useCrons() {
  const activeId = useGatewayStore((s) => s.activeId);
  const gateways = useGatewayStore((s) => s.gateways);
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);

  const active = gateways.find((g) => g.id === activeId);
  const connected = active?.status === "connected";

  return useQuery({
    queryKey: ["crons", activeId],
    queryFn: async (): Promise<CronJob[]> => {
      const client = getActiveClient();
      if (!client) return [];
      try {
        const result = await client.request<unknown>("cron.list");
        return parseJobs(result);
      } catch (err) {
        console.warn("[useCrons] list failed:", err);
        return [];
      }
    },
    enabled: connected,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}

export function useRunCron() {
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const client = getActiveClient();
      if (!client) throw new Error("Gateway 未连接");
      await client.request("cron.run", { jobId });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crons"] }),
  });
}

export function useDeleteCron() {
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const client = getActiveClient();
      if (!client) throw new Error("Gateway 未连接");
      // OpenClaw 标准 RPC 是 cron.remove(见 server.impl.js)。老版本/别名兜底。
      try {
        await client.request("cron.remove", { jobId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/unknown method|not.?found|invalid method/i.test(msg)) {
          await client.request("cron.delete", { jobId });
        } else {
          throw err;
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crons"] }),
  });
}

/**
 * 更新已有 cron 任务(cron.update RPC)。支持:
 *   - name / enabled / schedule / sessionTarget / payload.message
 * 做乐观更新:点击瞬间 UI 反映 patch,失败回滚。
 */
export interface UpdateCronPatch {
  name?: string;
  enabled?: boolean;
  schedule?: CronSchedule;
  sessionTarget?: "main" | "isolated" | "current";
  payload?: { kind: "agentTurn"; message: string };
}

export function useUpdateCron() {
  const activeId = useGatewayStore((s) => s.activeId);
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);
  const qc = useQueryClient();
  const queryKey = ["crons", activeId] as const;
  return useMutation({
    mutationFn: async (input: { id: string; patch: UpdateCronPatch }) => {
      const client = getActiveClient();
      if (!client) throw new Error("Gateway 未连接");
      return await client.request<{ id: string }>("cron.update", input);
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<CronJob[]>(queryKey);
      if (prev) {
        qc.setQueryData<CronJob[]>(
          queryKey,
          prev.map((j) =>
            j.id === input.id
              ? {
                  ...j,
                  ...input.patch,
                  // schedule patch 也是完整 CronSchedule,直接合入
                  schedule: input.patch.schedule ?? j.schedule,
                }
              : j,
          ),
        );
      }
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey }),
  });
}

/** 查询某个 cron 任务的执行历史(cron.runs RPC) */
export function useCronRuns(jobId: string | null, enabled: boolean) {
  const activeId = useGatewayStore((s) => s.activeId);
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);
  return useQuery({
    queryKey: ["cron-runs", activeId, jobId],
    queryFn: async (): Promise<CronRun[]> => {
      const client = getActiveClient();
      if (!client || !jobId) return [];
      try {
        const result = await client.request<unknown>("cron.runs", {
          jobId,
          limit: 50,
        });
        if (Array.isArray(result)) return result as CronRun[];
        const d = result as Record<string, unknown>;
        for (const key of ["runs", "list", "entries"]) {
          if (Array.isArray(d[key])) return d[key] as CronRun[];
        }
        return [];
      } catch (err) {
        console.warn("[useCronRuns] failed:", err);
        return [];
      }
    },
    enabled: enabled && !!jobId,
    staleTime: 5_000,
  });
}

// ---------- 新建 ----------

/**
 * 创建 cron 任务入参:跟 OpenClaw cron.add RPC 对齐。
 *
 * 注意 kind=at 的 `at` **必须是 ISO 字符串**(带时区偏移),不是 ms 数字。
 * OpenClaw JSON schema 会拒绝数字形式(错误:"at /schedule/at: must be string")。
 * 客户端 UI 层按 ms 数字自然,提交前调 `toIsoAt()` 转成 ISO 字符串。
 */
export type CronSchedule =
  | { kind: "at"; at: string } // ISO "2026-04-23T11:30:00+08:00",单次
  | { kind: "every"; everyMs: number } // 固定间隔
  | { kind: "cron"; expr: string; tz?: string }; // 5-段 cron,如 "0 9 * * *"

/** ms 时间戳 → 本地时区带偏移的 ISO 字符串(OpenClaw 接受的格式) */
export function toIsoAt(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  // 本地时区偏移,如 "+08:00"
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const oh = pad(Math.floor(Math.abs(offMin) / 60));
  const om = pad(Math.abs(offMin) % 60);
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${sign}${oh}:${om}`;
}

export interface CreateCronInput {
  name: string;
  /** 给 AI 的提示词(会在 isolated session 跑一次 agent turn) */
  message: string;
  schedule: CronSchedule;
  /** 默认 isolated(独立 session 跑完就走) */
  sessionTarget?: "main" | "isolated";
}

export function useCreateCron() {
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCronInput) => {
      const client = getActiveClient();
      if (!client) throw new Error("Gateway 未连接");
      const sessionTarget = input.sessionTarget ?? "isolated";
      const body = {
        name: input.name,
        enabled: true,
        sessionTarget,
        schedule: input.schedule,
        payload: { kind: "agentTurn", message: input.message },
        delivery: { mode: "none" }, // 产物留在独立 session,侧边栏能看到
      };
      return await client.request<{ id: string }>("cron.add", body);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crons"] }),
  });
}
