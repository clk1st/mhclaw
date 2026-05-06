#!/usr/bin/env node
/**
 * electron-builder 的 app-builder-lib 在 pnpm node_modules collector 里用
 * --depth Infinity 递归整棵依赖树。我们这棵 hoisted 树非常大(OpenClaw
 * 生态 + 插件),产出的 JSON >500MB,撞 V8 字符串上限 "Invalid string length"。
 *
 * 本脚本把 "Infinity" 改成 "10" —— 够 dedupe 正确,也绕过 V8 上限。
 * macOS 的 scripts/build-release.sh 用 sed 做同样的事,这里是 CI / 跨平台版本。
 */
import fs from "node:fs";

const collectorPath =
  "node_modules/app-builder-lib/out/node-module-collector/pnpmNodeModulesCollector.js";

if (!fs.existsSync(collectorPath)) {
  console.log("[patch-app-builder] collector not found, skipping");
  process.exit(0);
}

const src = fs.readFileSync(collectorPath, "utf-8");
if (!src.includes('"Infinity"')) {
  console.log("[patch-app-builder] already patched or different version");
  process.exit(0);
}

fs.writeFileSync(collectorPath, src.replace('"Infinity"', '"10"'));
console.log("[patch-app-builder] patched depth Infinity → 10");
