import { create } from "zustand";

/**
 * 全局 UI 偏好:左侧边栏折叠状态等。
 * 持久化到 localStorage,刷新保留。
 */

const SIDEBAR_KEY = "mhclaw-sidebar-collapsed";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "true";
  } catch {
    return false;
  }
}

function persistCollapsed(v: boolean) {
  try {
    localStorage.setItem(SIDEBAR_KEY, String(v));
  } catch {
    // ignore
  }
}

interface UIState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarCollapsed: loadCollapsed(),
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    persistCollapsed(next);
    set({ sidebarCollapsed: next });
  },
  setSidebarCollapsed: (v) => {
    persistCollapsed(v);
    set({ sidebarCollapsed: v });
  },
}));
