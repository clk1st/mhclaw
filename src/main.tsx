import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// 本地字体(变量字,所有权重一次性)—— 不走外网 CDN,国内也能用
import "@fontsource-variable/manrope";
import "highlight.js/styles/github-dark.css";
import "./index.css";
import App from "./App";
import { applyPersistedFontSize } from "./components/settings/SettingsDialog";

// 启动时应用用户偏好的字体大小(设置 -> 系统设置)
applyPersistedFontSize();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
