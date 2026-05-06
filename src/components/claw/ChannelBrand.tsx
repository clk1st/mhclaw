/**
 * 渠道品牌标:带背景色的 36x36 方块。
 *
 * 有官方 simple-icons 覆盖的(Slack/Discord/Telegram/WhatsApp/Line/iMessage/
 * Google Chat/WeChat/QQ)直接用品牌 SVG + 品牌主色。
 * 没覆盖的(飞书/企微/钉钉/Teams)用品牌色 + 中文/英文首字标,不伪造 logo。
 */
import { ComponentType } from "react";
import {
  SiDiscord,
  SiGooglechat,
  SiImessage,
  SiLine,
  SiQq,
  SiTelegram,
  SiWechat,
  SiWhatsapp,
} from "@icons-pack/react-simple-icons";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

type BrandWithIcon = {
  kind: "icon";
  icon: ComponentType<{ color?: string; size?: number }>;
  /** 品牌主色(用于图标前景) */
  color: string;
  /** 图标底板背景(白 / 浅灰都行;为了让品牌色看清) */
  bg?: string;
};
type BrandWithLetter = {
  kind: "letter";
  letter: string;
  /** 品牌色(做底板) */
  color: string;
};
type BrandDef = BrandWithIcon | BrandWithLetter;

const BRANDS: Record<string, BrandDef> = {
  // 有官方 simple-icons
  slack: { kind: "letter", letter: "S", color: "#4A154B" }, // 包里缺 SiSlack,用品牌紫首字
  discord: { kind: "icon", icon: SiDiscord, color: "#5865F2", bg: "#fff" },
  telegram: { kind: "icon", icon: SiTelegram, color: "#26A5E4", bg: "#fff" },
  whatsapp: { kind: "icon", icon: SiWhatsapp, color: "#25D366", bg: "#fff" },
  line: { kind: "icon", icon: SiLine, color: "#00C300", bg: "#fff" },
  imessage: { kind: "icon", icon: SiImessage, color: "#007AFF", bg: "#fff" },
  googlechat: { kind: "icon", icon: SiGooglechat, color: "#1DA462", bg: "#fff" },
  wechat: { kind: "icon", icon: SiWechat, color: "#07C160", bg: "#fff" },
  weixin: { kind: "icon", icon: SiWechat, color: "#07C160", bg: "#fff" },
  "openclaw-weixin": { kind: "icon", icon: SiWechat, color: "#07C160", bg: "#fff" },
  qqbot: { kind: "icon", icon: SiQq, color: "#EB1923", bg: "#fff" },
  // 没覆盖的用品牌色 + 首字
  feishu: { kind: "letter", letter: "飞", color: "#3370FF" }, // 飞书品牌蓝
  wecom: { kind: "letter", letter: "企", color: "#2EAB50" }, // 企微绿
  dingtalk: { kind: "letter", letter: "钉", color: "#1677FF" }, // 钉钉蓝(向后兼容)
  ddingtalk: { kind: "letter", letter: "钉", color: "#1677FF" }, // 钉钉实际 channel id
  msteams: { kind: "letter", letter: "T", color: "#6264A7" }, // Teams 紫
};

export function ChannelBrand({
  id,
  size = 36,
  className,
}: {
  id: string;
  size?: number;
  className?: string;
}) {
  const def = BRANDS[id];
  const iconSize = Math.round(size * 0.56);
  const radius = Math.round(size * 0.22);

  if (!def) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center bg-muted text-muted-foreground",
          className,
        )}
        style={{ width: size, height: size, borderRadius: radius }}
      >
        <MessageSquare style={{ width: iconSize, height: iconSize }} />
      </div>
    );
  }

  if (def.kind === "icon") {
    const Icon = def.icon;
    return (
      <div
        className={cn("flex shrink-0 items-center justify-center", className)}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          background: def.bg ?? "transparent",
          boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.04)",
        }}
      >
        <Icon size={iconSize} color={def.color} />
      </div>
    );
  }

  // letter
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center font-semibold text-white",
        className,
      )}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: def.color,
        fontSize: Math.round(size * 0.44),
      }}
    >
      {def.letter}
    </div>
  );
}
