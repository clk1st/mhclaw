import { create } from "zustand";
import type { EmbedInfo } from "@/lib/embed";

export type RightPanelTab = "artifacts" | "files" | "changes" | "preview";

export interface PreviewTarget {
  /** 用于 React key/识别 */
  id: string;
  /** 标题（展示在 PreviewTab 顶部） */
  title: string;
  /** 内容类型 */
  kind: "url" | "file";
  /** URL（canvas / http / blob） */
  url?: string;
  /** 文件路径（mhclaw-workspace:// 协议或绝对路径） */
  path?: string;
  /** 推荐高度（仅展示用） */
  preferredHeight?: number;
}

interface PreviewState {
  /** 右侧面板是否可见（全局偏好） */
  panelOpen: boolean;
  /** 当前激活的 tab */
  tab: RightPanelTab;
  /** 当前预览目标（preview tab 用） */
  current: PreviewTarget | null;

  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  setTab: (tab: RightPanelTab) => void;
  openPreviewFromEmbed: (e: EmbedInfo) => void;
  openPreview: (target: PreviewTarget) => void;
  clearPreview: () => void;
}

const PANEL_STORAGE = "mhclaw-right-panel";

function loadPanelOpen(): boolean {
  try {
    const v = localStorage.getItem(PANEL_STORAGE);
    if (v === "true") return true;
    if (v === "false") return false;
  } catch {
    // ignore
  }
  return false; // 默认收起，避免干扰首次体验
}

function persistPanelOpen(v: boolean) {
  try {
    localStorage.setItem(PANEL_STORAGE, String(v));
  } catch {
    // ignore
  }
}

/**
 * AI 在 [embed url="/Users/.../xxx.html" /] 里给的常是本地绝对路径。
 * iframe / fetch 直接用会被 Vite dev server 当相对 URL 解析,返回 SPA fallback。
 * 转成 mhclaw-authorized://fs/<encoded-abs-path> 走 Electron 注册的文件协议。
 * (需要所在目录在 ~/.mhclaw/authorized-dirs.json 白名单里,mhclaw 默认已加 ~/mhclaw)
 */
function normalizeEmbedUrl(url?: string): string | undefined {
  if (!url) return url;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url; // 已有协议前缀(http / mhclaw-workspace / mhclaw-authorized 等)
  if (url.startsWith("/__openclaw__/")) return url; // canvas 相对路径,PreviewTab 会单独处理
  if (url.startsWith("/")) {
    // 绝对文件路径 → mhclaw-authorized://
    return `mhclaw-authorized://fs/${encodeURIComponent(url)}`;
  }
  return url;
}

export const usePreviewStore = create<PreviewState>((set, get) => ({
  panelOpen: loadPanelOpen(),
  tab: "preview",
  current: null,

  openPanel: () => {
    persistPanelOpen(true);
    set({ panelOpen: true });
  },
  closePanel: () => {
    persistPanelOpen(false);
    set({ panelOpen: false });
  },
  togglePanel: () => {
    const next = !get().panelOpen;
    persistPanelOpen(next);
    set({ panelOpen: next });
  },
  setTab: (tab) => set({ tab }),

  openPreviewFromEmbed: (e) => {
    const target: PreviewTarget = {
      id: e.ref || e.url || "embed-" + Date.now(),
      title: e.title || "预览",
      kind: "url",
      url: normalizeEmbedUrl(e.url),
      preferredHeight: e.preferredHeight,
    };
    persistPanelOpen(true);
    set({ panelOpen: true, tab: "preview", current: target });
  },

  openPreview: (target) => {
    persistPanelOpen(true);
    set({ panelOpen: true, tab: "preview", current: target });
  },

  clearPreview: () => set({ current: null }),
}));
