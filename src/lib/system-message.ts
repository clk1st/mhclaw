/**
 * OpenClaw 的 heartbeat-runner / gateway tool 会把"系统事件"作为
 * **伪造的 role=user 消息**注入到会话里,给 agent 读:
 *   - Gateway 重启后的 heartbeat 指令("Read HEARTBEAT.md...")
 *   - config.patch 完成后的 note("已添加 Brave Search MCP")
 *   - gateway restart 回执("[timestamp] Gateway restart config-patch ok")
 *   - openclaw doctor 指令("Run: openclaw doctor --non-interactive")
 *   - 注入的上下文("Current time: ... UTC")
 *
 * 我们前端默认把这些当普通 user 消息渲染,用户看到"自己说了"一堆
 * 开发者语言,体验很糟。这里做分类:
 *
 *  - "drop":纯内部指令(HEARTBEAT / doctor / 注入的 context),不渲染
 *  - "banner":有用户价值的事件反馈(config.patch ok / 已添加 xxx),
 *              提取有价值的行转成 SystemBanner 居中显示
 *  - "user":真实用户消息,原样走 user 气泡
 */

export type SystemMsgKind = "drop" | "banner" | "user";

/** HEARTBEAT / doctor / context 注入的特征行(出现即 = 非真实用户) */
const INTERNAL_HINT_RE =
  /(Read HEARTBEAT\.md|HEARTBEAT_OK|When reading HEARTBEAT|Current time:.*(UTC|Asia\/|GMT)|openclaw doctor)/i;

/** "System:" 前缀 = heartbeat-runner 注入的事件消息 */
const SYSTEM_LINE_RE = /^System:\s*/;

/** 用户价值信号(出现即 = 这条是"事件反馈",值得 banner 展示) */
const USER_VALUE_RE =
  /(Gateway restart|config-patch ok|config\.patch|已添加|已更新|已删除|已激活|已重启|配置成功)/i;

export function classifySystemMessage(content: string): SystemMsgKind {
  const text = content.trim();
  if (!text) return "user";

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const hasSystemPrefix = lines.some((l) => SYSTEM_LINE_RE.test(l));
  const hasInternalHint = INTERNAL_HINT_RE.test(text);
  const looksInjected = hasSystemPrefix || hasInternalHint;

  if (!looksInjected) return "user";

  // 是注入消息。看有没有用户价值
  if (USER_VALUE_RE.test(text)) return "banner";
  return "drop";
}

/**
 * 把一条"banner"类注入消息里**真正有用的文字**抽出来 ——
 * 只保留"System:"开头且带用户价值信号的行,其他噪音(HEARTBEAT 指令 /
 * 注入 context)统统丢。多行拼接用 · 分隔。
 */
export function extractBannerText(content: string): string {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  const kept: string[] = [];
  for (const line of lines) {
    if (INTERNAL_HINT_RE.test(line)) continue;
    if (SYSTEM_LINE_RE.test(line)) {
      const stripped = line.replace(SYSTEM_LINE_RE, "").trim();
      // 进一步过滤:只保留有用户价值的那几行
      if (USER_VALUE_RE.test(stripped)) {
        kept.push(stripped);
      }
    } else if (USER_VALUE_RE.test(line)) {
      // 非 System: 开头但仍有价值(少见,兜底)
      kept.push(line);
    }
  }
  return kept.join(" · ");
}
