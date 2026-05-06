import { useEffect, useMemo, useState } from "react";
import type { CronJob } from "./use-crons";

/**
 * 客户端自维护的 cron 任务"历史"——补齐 OpenClaw 的语义空白。
 *
 * 背景:OpenClaw 的 `cron.list` 只返活着的计划。单次任务(kind=at)执行完
 * 自动从 list 移除,多次任务被用户删也立刻消失。对用户来说"这个任务存在过"
 * 这个记忆就没了,打开自动化页啥都看不到。
 *
 * 做法:每次 cron.list 轮询回来,把看到的 job 写 localStorage;对比上一次
 * 快照,发现"之前有、这次没了"的 job,标记 removedAt。UI 在「已完成任务」
 * 区里展示这些被标记的 job。
 *
 * 限制:
 *  - 纯客户端本地存储,跨设备不同步(单用户场景够用)
 *  - 首次打开 app 之前就执行并删除的 cron,客户端永远没见过,无法追溯
 *  - 用户手动点「删除」删活任务时,不应该再出现在"已完成"里 —— 由调用方
 *    在删除成功后调 `clearFromHistory(id)` 显式清掉
 */

const STORAGE_KEY = "mhclaw:cron-history";

export interface StoredCronJob extends Omit<CronJob, "enabled"> {
  enabled?: boolean;
  /** 第一次看到这个 job 的时间戳 */
  firstSeenAt: number;
  /** 最近一次在 cron.list 里看到的时间戳 */
  lastSeenAt: number;
  /** 从 cron.list 消失的时间戳;未消失为 undefined */
  removedAt?: number;
}

type HistoryMap = Record<string, StoredCronJob>;

function loadHistory(): HistoryMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as HistoryMap;
  } catch {
    return {};
  }
}

function saveHistory(map: HistoryMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // quota / private mode 等,静默
  }
}

/**
 * 追踪 cron 任务历史。
 *
 * 用法:
 *   const { data: jobs } = useCrons();
 *   const { completedJobs, clearFromHistory, clearAll } = useCronHistory(jobs);
 *
 * @param liveJobs 当前活着的 cron.list 结果
 */
export function useCronHistory(liveJobs: CronJob[]): {
  completedJobs: StoredCronJob[];
  clearFromHistory: (id: string) => void;
  clearAll: () => void;
} {
  // 保留一个 bump 状态,让 useMemo 在 saveHistory 后能重新读 localStorage
  const [bump, setBump] = useState(0);

  useEffect(() => {
    const now = Date.now();
    const history = loadHistory();
    const liveIds = new Set<string>();

    // upsert 活着的 job:刷新 lastSeenAt,清 removedAt(如果之前被误标)
    for (const job of liveJobs) {
      if (!job.id) continue;
      liveIds.add(job.id);
      const prev = history[job.id];
      history[job.id] = {
        ...(prev ?? {}),
        ...job,
        firstSeenAt: prev?.firstSeenAt ?? now,
        lastSeenAt: now,
        removedAt: undefined,
      };
    }

    // 标记从 list 消失但本次也没见过的 job —— 执行完 / 被删
    let changed = false;
    for (const [id, stored] of Object.entries(history)) {
      if (!liveIds.has(id) && stored.removedAt === undefined) {
        history[id] = { ...stored, removedAt: now };
        changed = true;
      }
    }

    // 本次有 live job 也算 change(firstSeenAt/lastSeenAt 更新)
    if (liveJobs.length > 0 || changed) {
      saveHistory(history);
      setBump((n) => n + 1);
    }
  }, [liveJobs]);

  const completedJobs = useMemo<StoredCronJob[]>(() => {
    const map = loadHistory();
    return Object.values(map)
      .filter((j) => typeof j.removedAt === "number")
      .sort((a, b) => (b.removedAt ?? 0) - (a.removedAt ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bump]);

  const clearFromHistory = (id: string) => {
    const map = loadHistory();
    if (id in map) {
      delete map[id];
      saveHistory(map);
      setBump((n) => n + 1);
    }
  };

  const clearAll = () => {
    saveHistory({});
    setBump((n) => n + 1);
  };

  return { completedJobs, clearFromHistory, clearAll };
}
