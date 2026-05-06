import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import electron from "vite-plugin-electron/simple";
import path from "node:path";

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 40173,
    strictPort: true,
    fs: {
      // pnpm 在 monorepo 根(../)hoist 了一些依赖(manrope 字体等),
      // 默认 Vite 只允许项目目录内的文件,放开到上一级覆盖 workspace root
      allow: [path.resolve(__dirname, "..")],
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    mode === "electron" &&
      electron({
        main: {
          entry: "electron/main.ts",
        },
        preload: {
          input: "electron/preload.ts",
        },
      }),
  ].filter(Boolean),
}));
