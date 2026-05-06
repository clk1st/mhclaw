/**
 * Preview Availability 子系统 —— 统一表达"一条 embed URL 现在能不能打开预览"。
 *
 * 为什么独立成子系统:
 *  - mhclaw 的 embed URL 有 5 种协议(workspace / authorized / canvas / http / 绝对路径),
 *    每种可用性判断逻辑完全不同。没有抽象会在按钮组件里堆 if-else 污染。
 *  - 每种 URL 的变化来源也不同(file 类走 chokidar,http 只能按需 probe),
 *    adapter 各自决定 subscribe 策略。
 *  - 4 态状态机(pending / generating / ready / error)让 UI 第一眼传递正确语义,
 *    不靠 hover tooltip 猜。
 *
 * 设计原则:adapter 返回最终 4 态(不是"存在/不存在"这种 fs 原语),
 * 因为"生成中"需要综合 fs 状态 + agent run 是否还在活。adapter 拿到 context 自己决定。
 */

/** 预览按钮当前态 —— UI 按这 4 种直接渲染,无需额外推导 */
export type PreviewStatus =
  /** 还没出现过文件(比如 AI 刚声明 embed,还没调 write_file) */
  | { kind: "pending" }
  /** 文件已存在但仍在变动 / agent 还在跑,可能不完整 */
  | { kind: "generating"; since: number }
  /** 可以安全打开 */
  | { kind: "ready"; size?: number; mtime?: number }
  /** 永久失败:404 / 权限拒 / 协议无法解析 / run 结束了文件仍不存在 */
  | { kind: "error"; reason: string };

/**
 * Adapter 运行时上下文 —— 判断"生成中"需要的外部信号。
 * 按钮组件在 streaming 期间 runActive=true,结束后 false。
 */
export interface ProbeCtx {
  /** 这条 embed 所属的 agent run 是否还在活 */
  runActive: boolean;
  /** 发起 probe 的时间戳(用于 since 字段) */
  now: number;
  /** 当前活跃 session 的 sessionKey(workspace:// 需要) */
  sessionKey?: string;
}

/**
 * 变更订阅回调签名。adapter 调 cb 通知 hook 状态可能变了,
 * 由 hook 决定是否 re-probe。
 */
export type AvailabilityChangeCb = () => void;

/**
 * 单个 URL 协议的 adapter。每个 adapter 负责:
 *  1. 声明能处理什么样的 URL(canHandle)
 *  2. 给出当前状态(probe)—— 可以同步读 cache,但必须返回 Promise
 *  3. 可选:订阅外部变化(subscribe)—— file 类走 chokidar,http 不实现返回 noop
 */
export interface PreviewAdapter {
  /** Adapter 名字,调试 + 日志用 */
  readonly name: string;

  /** 是否处理这个 URL */
  canHandle(url: string): boolean;

  /** 探测一次当前状态 */
  probe(url: string, ctx: ProbeCtx): Promise<PreviewStatus>;

  /**
   * 订阅 URL 对应资源的变化。回调被调用后,hook 会重新 probe 拿最新状态。
   * 没有订阅能力(如 http)的 adapter 可以不实现或返回 noop。
   */
  subscribe?(url: string, cb: AvailabilityChangeCb): () => void;
}

/** 初始态:hook 刚挂载还没 probe 出结果时用 */
export const INITIAL_STATUS: PreviewStatus = { kind: "pending" };

/** 人类可读的简短描述 —— UI tooltip / accessible label 用 */
export function describeStatus(s: PreviewStatus): string {
  switch (s.kind) {
    case "pending":
      return "等待生成";
    case "generating":
      return "生成中…";
    case "ready":
      return "可打开预览";
    case "error":
      return `预览不可用:${s.reason}`;
  }
}
