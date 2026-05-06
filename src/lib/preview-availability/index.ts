/**
 * Preview Availability 子系统入口 —— 在应用启动时调用 install() 一次注册所有 adapter。
 *
 * 消费方:
 *  - React 组件:用 usePreviewAvailability(url, { runActive }) hook
 *  - 手动 probe:availabilityRegistry.probe(url, ctx)(比如 embed 按钮点击兜底)
 */

import { availabilityRegistry } from "./registry";
import { workspaceFileAdapter } from "./adapters/workspace-file";
import { authorizedFileAdapter } from "./adapters/authorized-file";
import { canvasAdapter } from "./adapters/canvas";
import { httpAdapter } from "./adapters/http";
import { absolutePathAdapter } from "./adapters/absolute-path";

let installed = false;

/** idempotent —— 可以多次调用,重复注册 adapter 会被 registry 去重覆盖 */
export function installAvailabilityAdapters(): void {
  if (installed) return;
  // 注册顺序决定 canHandle 的匹配优先级:
  // canvas 先于 http(canvas URL 是相对路径,跟 http 不冲突,但顺序清晰点好)
  // workspace / authorized 先于 absolute-path(前者是协议 URL,不会被 absolute 误判)
  availabilityRegistry.register(workspaceFileAdapter);
  availabilityRegistry.register(authorizedFileAdapter);
  availabilityRegistry.register(canvasAdapter);
  availabilityRegistry.register(httpAdapter);
  availabilityRegistry.register(absolutePathAdapter);
  installed = true;
}

export { availabilityRegistry };
export { usePreviewAvailability } from "./hooks/use-preview-availability";
export type { PreviewStatus, PreviewAdapter, ProbeCtx } from "./types";
export { describeStatus } from "./types";
