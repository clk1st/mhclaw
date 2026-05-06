/**
 * channel id → skill name 前缀映射。
 * 用来把 /commands.list 返回的 skill 命令归类到对应 channel,
 * 未识别的 skill 归"通用"。
 */
export const CHANNEL_SKILL_PREFIXES: Record<string, { label: string; prefixes: string[] }> = {
  wecom: { label: "企业微信", prefixes: ["wecom_", "wecom-"] },
  "openclaw-weixin": { label: "微信", prefixes: ["weixin_", "weixin-", "wechat_", "wechat-"] },
  ddingtalk: { label: "钉钉", prefixes: ["ding_", "dingtalk_", "ding-", "dingtalk-"] },
  feishu: { label: "飞书", prefixes: ["feishu_", "feishu-", "lark_", "lark-"] },
  qqbot: { label: "QQ Bot", prefixes: ["qq_", "qqbot_"] },
  telegram: { label: "Telegram", prefixes: ["telegram_", "tg_"] },
  slack: { label: "Slack", prefixes: ["slack_"] },
  discord: { label: "Discord", prefixes: ["discord_"] },
  whatsapp: { label: "WhatsApp", prefixes: ["whatsapp_"] },
  line: { label: "LINE", prefixes: ["line_"] },
  imessage: { label: "iMessage", prefixes: ["imessage_"] },
  msteams: { label: "MS Teams", prefixes: ["msteams_", "teams_"] },
  googlechat: { label: "Google Chat", prefixes: ["googlechat_", "gchat_"] },
};

/** 返回 skill 命名所属的 channelId,没匹配到返回 null(即"通用 skill") */
export function resolveChannelForSkill(skillName: string): string | null {
  const n = skillName.toLowerCase();
  for (const [channelId, { prefixes }] of Object.entries(CHANNEL_SKILL_PREFIXES)) {
    if (prefixes.some((p) => n.startsWith(p))) return channelId;
  }
  return null;
}
