import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "mhclaw-theme";

function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // ignore
  }
  return "system";
}

function resolveEffective(theme: Theme): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return theme;
}

function applyTheme(effective: "light" | "dark") {
  const root = document.documentElement;
  root.classList.toggle("dark", effective === "dark");
  root.style.colorScheme = effective;
}

/** 主题切换（light / dark / system），localStorage 持久化，自动响应系统变化 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());
  const [effective, setEffective] = useState<"light" | "dark">(() =>
    resolveEffective(getStoredTheme()),
  );

  // 应用到 html class
  useEffect(() => {
    const eff = resolveEffective(theme);
    setEffective(eff);
    applyTheme(eff);
  }, [theme]);

  // 响应系统主题变化（仅当 theme === "system"）
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const handler = () => {
      const eff = resolveEffective("system");
      setEffective(eff);
      applyTheme(eff);
    };
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, t);
    } catch {
      // ignore
    }
    setThemeState(t);
  }, []);

  return { theme, effective, setTheme };
}
