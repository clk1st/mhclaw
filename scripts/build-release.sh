#!/usr/bin/env bash
#
# 一键打正式发版包(macOS)。输出:
#   release/mhclaw-<version>-arm64.dmg     拖拽安装
#   release/mhclaw-<version>-arm64-mac.zip  自动更新 / 打包存档
#
# 包含的 workaround:
#  1. npmRebuild: false —— 避免 @discordjs/opus 这类用不到的原生模块在打包机上过不去 C++ 工具链
#  2. patch app-builder-lib 的 pnpm collector —— hoisted 的巨型 dep tree 用 --depth Infinity
#     会撞 V8 字符串上限(>500MB JSON)导致 "Invalid string length",改成 --depth 10
#  3. DMG 不走 electron-builder(它要下 dmgbuild-bundle 的 tarball,国内镜像常 404 / 超时),
#     改用 macOS 原生 hdiutil create 构造 —— 输出体感一致
#
# 用法:
#   pnpm install
#   bash scripts/build-release.sh

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)

# --- 1. patch app-builder-lib 的 pnpm collector ------------------------------

COLLECTOR="$ROOT/node_modules/app-builder-lib/out/node-module-collector/pnpmNodeModulesCollector.js"
if [[ -f "$COLLECTOR" ]] && grep -q '"Infinity"' "$COLLECTOR"; then
  echo "[build-release] patching $COLLECTOR (depth Infinity → 10)"
  # macOS sed 需要 '' 占位
  sed -i '' 's/"--depth", "Infinity"/"--depth", "10"/' "$COLLECTOR"
fi

# --- 2. 清产物 ---------------------------------------------------------------

echo "[build-release] cleaning release/ dist/ dist-electron/"
rm -rf release dist dist-electron

# --- 3. 跑 electron-builder(出 .app bundle 和 zip,DMG 我们自己打) -----------

# 临时把 target 里的 dmg 剔掉,跑完恢复(electron-builder 的 DMG 要下
# dmgbuild-bundle tarball,国内网络常 404,改用 hdiutil)
CONFIG="$ROOT/electron-builder.yml"
BACKUP="$CONFIG.bak"
cp "$CONFIG" "$BACKUP"

# 用 Node 的 yaml 解析 + 序列化,绕开脆弱的正则替换
node --input-type=module -e "
import yaml from 'js-yaml';
import fs from 'node:fs';
const p = process.argv[1];
const src = fs.readFileSync(p, 'utf-8');
const doc = yaml.load(src);
if (doc?.mac?.target) {
  doc.mac.target = doc.mac.target.filter(t => {
    if (typeof t === 'string') return t !== 'dmg';
    return t.target !== 'dmg';
  });
}
fs.writeFileSync(p, yaml.dump(doc, { lineWidth: 120 }));
console.log('[build-release] mac.target: dmg removed for electron-builder step');
" "$CONFIG"

trap 'mv "$BACKUP" "$CONFIG"' EXIT

echo "[build-release] running electron-builder"
pnpm run build:electron

# --- 4. 用 hdiutil 为每个 arch 造 DMG ------------------------------------------

VERSION=$(node -p "require('./package.json').version")

make_dmg() {
  local arch="$1" app_dir="$2"
  local app="$ROOT/release/$app_dir/mhclaw.app"
  if [[ ! -d "$app" ]]; then
    echo "[build-release] skip $arch: $app not found"
    return
  fi
  local dmg="$ROOT/release/mhclaw-${VERSION}-${arch}.dmg"
  local stage="$ROOT/release/dmg-stage-${arch}"
  echo "[build-release] creating DMG for $arch"
  rm -rf "$stage"
  mkdir -p "$stage"
  cp -R "$app" "$stage/mhclaw.app"
  ln -s /Applications "$stage/Applications"
  hdiutil create -volname "mhclaw" -srcfolder "$stage" -ov -format UDZO "$dmg" >/dev/null
  rm -rf "$stage"
  echo "  → $dmg"
}

make_dmg "arm64" "mac-arm64"
make_dmg "x64"   "mac"   # electron-builder x64 输出目录名是 "mac"(无后缀)

echo
echo "[build-release] ✅ done"
ls -la "$ROOT"/release/mhclaw-${VERSION}-*.{dmg,zip} 2>/dev/null || true
