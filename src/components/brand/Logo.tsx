import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * mhclaw 品牌 Logo 系统(2026-04 设计师定稿)。
 *
 * 三种组件、三种场景:
 *   - IconGradient:完整版(渐变底 + M + cursor + sparkle + glow)—— Hero / App icon / Dock / Onboarding
 *   - IconBadge:  扁平版(3 变体 gradient / deep / ink)—— Sidebar / Assistant 头像 / 小尺寸 UI
 *   - IconMono:   单色版(纯色填充)—— 菜单栏 / 印刷 / favicon
 *
 * 尺寸规则(设计师给定):
 *   - ≥72px: 完整(glow + sparkle + cursor)
 *   - 28–44px: 保留 sparkle + cursor
 *   - 18–27px: 只保留 cursor
 *   - ≤16px:  只留 M 主体
 *
 * viewBox 固定 256×256,所有 path 数值来自设计师原图,未自行调整。
 */

// 渐变五色 —— 也是 --mh-brand 色系的来源(export 出去让其他地方引用)
export const LOGO_PALETTE = {
  cyan: "#7ac9e8",
  blue: "#7a9ff0",
  lilac: "#b79af0",
  pink: "#e9a8c8",
  peach: "#f2b8b0",
  deep: "#5b4aa8",
  ink: "#1a1530",
  white: "#ffffff",
} as const;

// iOS squircle 的圆角比例(半径 / 边长)
const SQUIRCLE_R = 0.226;

// M 主体 —— 闭合路径,圆角 join,中间 V 槽有呼吸
const M_PATH =
  "M 68 188 L 68 82 Q 68 70 80 70 L 92 70 Q 102 70 108 79 L 124 108 " +
  "Q 128 115 132 108 L 148 79 Q 154 70 164 70 L 176 70 Q 188 70 188 82 " +
  "L 188 188 Q 188 196 180 196 L 170 196 Q 162 196 162 188 L 162 112 " +
  "Q 162 108 158.5 108 Q 156 108 154 111 L 136 142 Q 130 152 120 142 " +
  "L 102 111 Q 100 108 97.5 108 Q 94 108 94 112 L 94 188 " +
  "Q 94 196 86 196 L 76 196 Q 68 196 68 188 Z";

// 内嵌 cursor:M 中间槽上方的向上三角,暗示"导航/执行/把想法推向高处"
const CURSOR_PATH =
  "M 128 78 L 139 102 L 132 99 L 132 110 Q 132 114 128 114 " +
  "Q 124 114 124 110 L 124 99 L 117 102 Z";

// Sparkle 4 角星(位置已定在右上)
const SPARKLE_PATH =
  "M 0 -14 C 1 -5, 5 -1, 14 0 C 5 1, 1 5, 0 14 " +
  "C -1 5, -5 1, -14 0 C -5 -1, -1 -5, 0 -14 Z";

// ─── IconGradient:完整版 ───────────────────────────────────

export function IconGradient({
  size = 72,
  className,
  glow = true,
  sparkle,
  cursor,
}: {
  size?: number;
  className?: string;
  glow?: boolean;
  sparkle?: boolean;
  cursor?: boolean;
}) {
  // 尺寸规则 auto:未显式传参时按设计师规则决定是否带 sparkle / cursor
  const autoSparkle = sparkle ?? size >= 28;
  const autoCursor = cursor ?? size >= 18;
  const idSeed = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const bgId = `mh-bg-${idSeed}`;
  const sheenId = `mh-sheen-${idSeed}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="mhclaw"
      className={cn("shrink-0 block", className)}
      style={glow ? { filter: "drop-shadow(0 14px 28px rgba(90,60,180,0.22))" } : undefined}
    >
      <defs>
        <linearGradient id={bgId} x1="0.12" y1="0.05" x2="0.92" y2="0.95">
          <stop offset="0" stopColor={LOGO_PALETTE.cyan} />
          <stop offset="0.28" stopColor={LOGO_PALETTE.blue} />
          <stop offset="0.6" stopColor={LOGO_PALETTE.lilac} />
          <stop offset="0.85" stopColor={LOGO_PALETTE.pink} />
          <stop offset="1" stopColor={LOGO_PALETTE.peach} />
        </linearGradient>
        <linearGradient id={sheenId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.25" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx={256 * SQUIRCLE_R} ry={256 * SQUIRCLE_R} fill={`url(#${bgId})`} />
      <rect width="256" height="256" rx={256 * SQUIRCLE_R} ry={256 * SQUIRCLE_R} fill={`url(#${sheenId})`} />
      <path d={M_PATH} fill={LOGO_PALETTE.white} />
      {autoCursor && <path d={CURSOR_PATH} fill={LOGO_PALETTE.white} opacity="0.96" />}
      {autoSparkle && (
        <g transform="translate(196, 58)" opacity="0.95">
          <path d={SPARKLE_PATH} fill={LOGO_PALETTE.white} />
        </g>
      )}
    </svg>
  );
}

// ─── IconBadge:扁平版(3 变体) ──────────────────────────────

type BadgeVariant = "gradient" | "deep" | "ink";

export function IconBadge({
  size = 24,
  variant = "gradient",
  cursor,
  className,
}: {
  size?: number;
  variant?: BadgeVariant;
  cursor?: boolean;
  className?: string;
}) {
  const autoCursor = cursor ?? size >= 18;
  const idSeed = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const bgId = `mh-badge-${idSeed}`;

  let stop0: string;
  let stop1: string;
  let stop2: string | null = null;
  if (variant === "gradient") {
    stop0 = LOGO_PALETTE.blue;
    stop1 = LOGO_PALETTE.lilac;
    stop2 = LOGO_PALETTE.pink;
  } else if (variant === "deep") {
    stop0 = LOGO_PALETTE.deep;
    stop1 = "#7a5cc8";
  } else {
    stop0 = LOGO_PALETTE.ink;
    stop1 = LOGO_PALETTE.deep;
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="mhclaw"
      className={cn("shrink-0 block", className)}
    >
      <defs>
        <linearGradient id={bgId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={stop0} />
          {stop2 ? (
            <>
              <stop offset="0.6" stopColor={stop1} />
              <stop offset="1" stopColor={stop2} />
            </>
          ) : (
            <stop offset="1" stopColor={stop1} />
          )}
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx={256 * SQUIRCLE_R} ry={256 * SQUIRCLE_R} fill={`url(#${bgId})`} />
      <path d={M_PATH} fill={LOGO_PALETTE.white} />
      {autoCursor && <path d={CURSOR_PATH} fill={LOGO_PALETTE.white} opacity="0.95" />}
    </svg>
  );
}

// ─── IconMono:单色填充 ──────────────────────────────────────

export function IconMono({
  size = 24,
  color = LOGO_PALETTE.white,
  bg,
  className,
}: {
  size?: number;
  color?: string;
  bg?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="mhclaw"
      className={cn("shrink-0 block", className)}
    >
      {bg && <rect width="256" height="256" rx={256 * SQUIRCLE_R} ry={256 * SQUIRCLE_R} fill={bg} />}
      <path d={M_PATH} fill={color} />
      <path d={CURSOR_PATH} fill={color} opacity="0.95" />
    </svg>
  );
}

// 向后兼容:默认 Logo 导出 = IconGradient
export function Logo({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
  /** @deprecated 圆角固定 squircle,不再接受自定义 radius */
  radius?: number;
}) {
  return <IconGradient size={size} className={className} />;
}
