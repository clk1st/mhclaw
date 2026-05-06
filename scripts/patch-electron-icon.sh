#!/usr/bin/env bash
#
# Dev 下给 node_modules/electron/dist/Electron.app 做两件事:
#  1. 替换 icns → 解决 Cmd+Tab / Dock 显示灰色 Electron 图标
#  2. 改 Info.plist 的 CFBundleName / CFBundleDisplayName → 解决 Cmd+Tab 标签显示 "Electron"
#
# 触发时机:package.json 的 postinstall(每次 pnpm install / 升级 electron 自动跑)。
# 非 macOS / 缺源 PNG / 缺工具 均静默 skip,不 block 安装流程。

APP_DISPLAY_NAME="mhclaw"

set -u

# 只在 macOS 跑(Windows/Linux 的 Electron 图标机制不同)
if [[ "${OSTYPE:-}" != darwin* ]]; then
  exit 0
fi

SRC="electron/assets/icon.png"
ELECTRON_ICON="node_modules/electron/dist/Electron.app/Contents/Resources/electron.icns"
ICONSET="$(mktemp -d)/mhclaw.iconset"
ICNS="electron/assets/icon.icns"
BUILD_ICNS="build/icon.icns"

# 缺源 PNG 就跳(比如全新 clone 还没放 logo)
if [[ ! -f "$SRC" ]]; then
  echo "[patch-electron-icon] skip: $SRC not found"
  exit 0
fi

# macOS 自带 sips + iconutil;若缺就跳
if ! command -v sips >/dev/null 2>&1 || ! command -v iconutil >/dev/null 2>&1; then
  echo "[patch-electron-icon] skip: sips/iconutil not found"
  exit 0
fi

# 缺 Electron.app(依赖还没装完)也跳
if [[ ! -e "$(dirname "$ELECTRON_ICON")" ]]; then
  echo "[patch-electron-icon] skip: electron bundle not ready"
  exit 0
fi

# 生成 iconset
rm -rf "$ICONSET"
mkdir -p "$ICONSET"

for spec in "16 16x16" "32 16x16@2x" "32 32x32" "64 32x32@2x" "128 128x128" "256 128x128@2x" "256 256x256" "512 256x256@2x" "512 512x512"; do
  size=$(echo "$spec" | cut -d' ' -f1)
  name=$(echo "$spec" | cut -d' ' -f2)
  sips -z "$size" "$size" "$SRC" --out "$ICONSET/icon_${name}.png" >/dev/null 2>&1 || {
    echo "[patch-electron-icon] sips failed on ${name}"
    exit 0
  }
done
cp "$SRC" "$ICONSET/icon_512x512@2x.png"

# 打包成 icns
iconutil -c icns "$ICONSET" -o "$ICNS" >/dev/null 2>&1 || {
  echo "[patch-electron-icon] iconutil failed"
  exit 0
}

# 同一份放 build/(electron-builder 打包时会直接用)
mkdir -p build
cp "$ICNS" "$BUILD_ICNS"

# 覆盖 Electron.app 内置 icns(dev 模式下 Cmd+Tab / Dock 读的就是这个)
cp "$ICNS" "$ELECTRON_ICON"

echo "[patch-electron-icon] electron.icns patched + build/icon.icns ready"

# -- 改 Info.plist 的 CFBundleName / CFBundleDisplayName --------------------
# app.setName() 只改运行时的菜单/dock tooltip,macOS 的 Cmd+Tab 标签来自 bundle Info.plist。
INFO_PLIST="node_modules/electron/dist/Electron.app/Contents/Info.plist"
PLISTBUDDY="/usr/libexec/PlistBuddy"
if [[ -f "$INFO_PLIST" && -x "$PLISTBUDDY" ]]; then
  # Set 如果 key 不存在会失败,失败时 Add
  "$PLISTBUDDY" -c "Set :CFBundleName $APP_DISPLAY_NAME" "$INFO_PLIST" 2>/dev/null \
    || "$PLISTBUDDY" -c "Add :CFBundleName string $APP_DISPLAY_NAME" "$INFO_PLIST" 2>/dev/null \
    || true
  "$PLISTBUDDY" -c "Set :CFBundleDisplayName $APP_DISPLAY_NAME" "$INFO_PLIST" 2>/dev/null \
    || "$PLISTBUDDY" -c "Add :CFBundleDisplayName string $APP_DISPLAY_NAME" "$INFO_PLIST" 2>/dev/null \
    || true
  echo "[patch-electron-icon] Info.plist CFBundleName set to '$APP_DISPLAY_NAME'"
fi

# 让 macOS 认为 bundle 变了,下次启动重读 icon + name;不 killall Dock,避免打扰用户当前会话
touch "node_modules/electron/dist/Electron.app" 2>/dev/null || true
