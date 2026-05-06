import { create } from "zustand";

/**
 * 会话归档 store —— 客户端本地存"已归档 sessionKey 列表"。
 * OpenClaw 没有原生 sessions.archive,我们用 localStorage 做软归档:
 *  - Sidebar filter 掉
 *  - 数据管理 Dialog 可查看 / 取消归档 / 真删(调 sessions.delete)
 *
 * state 用 string[](不用 Set)—— React / Zustand 对 Set 的响应式追踪有坑
 * (同 Set ref 内部 add/delete 不触发 re-render),数组 immutable 替换最稳。
 */

const STORAGE_KEY = "mhclaw-archived-sessions";

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function persist(list: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore quota error
  }
}

interface ArchiveState {
  archived: string[];
  archive: (key: string) => void;
  unarchive: (key: string) => void;
  isArchived: (key: string) => boolean;
}

export const useArchiveStore = create<ArchiveState>((set, get) => ({
  archived: load(),
  archive: (key) => {
    const cur = get().archived;
    if (cur.includes(key)) return;
    const next = [...cur, key];
    set({ archived: next });
    persist(next);
  },
  unarchive: (key) => {
    const cur = get().archived;
    if (!cur.includes(key)) return;
    const next = cur.filter((k) => k !== key);
    set({ archived: next });
    persist(next);
  },
  isArchived: (key) => get().archived.includes(key),
}));
