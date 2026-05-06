/**
 * Skill 分层注册表。
 *
 * 目的:mhclaw 不能直接把 OpenClaw 自带的 ~53 个 skill 一股脑暴露给用户 ——
 * 里面很多是个人生活向(1password / apple-notes / imsg / bluebubbles)或
 * 开发者玩具(peekaboo / gifgrep / gog),跟办公工作台定位不符。
 *
 * 四层模型:
 *   System   - mhclaw 运行必需,用户永远看不到也禁不掉(canvas / skill-creator 等底座)
 *   Curated  - mhclaw 打包 + hub 精选,办公场景刚需,默认显示
 *   Hub      - 从 mhclaw-hub 安装的社区/官方 skill(动态,不在本表)
 *   Custom   - 用户自建(skill-creator 造或 ZIP 导入)
 *
 * 本表只定义 System + Curated 两层,Hub / Custom 由 hub API 或本地目录扫出。
 * 桌面端渲染时:
 *   - System skill 永远隐藏
 *   - 非 System 也不在 Curated 白名单里的 bundled skill → 隐藏(把 OpenClaw 杂项屏蔽掉)
 *   - 其余(非 bundled)= 用户装的 Hub / Custom,正常展示
 */

/**
 * 系统级底座 —— 不展示在任何 UI,但 Gateway 仍然扫描它们,
 * 其他 skill 可能有依赖关系(例如富内容输出都走 canvas)。
 */
export const SYSTEM_SKILLS = new Set<string>([
  "canvas",
  "skill-creator",
  "session-logs",
  "model-usage",
  "healthcheck",
]);

/**
 * 渠道(channel)类插件在"技能"页无意义——他们属于 Claw 页的 channels 配置。
 * 这里显式屏蔽它们暴露出来的 skill 条目,避免重复呈现给用户。
 *
 * 命名既可能是 channel id(openclaw-weixin / wecom / ddingtalk),也可能带
 * 包名前缀,所以用 prefix 匹配兜底。
 */
const CHANNEL_SKILL_KEYS = new Set<string>([
  "openclaw-weixin",
  "wecom",
  "ddingtalk",
  // 其他 OpenClaw 自带渠道也屏蔽掉(避免 bundled 进来)
  "telegram",
  "slack",
  "discord",
  "feishu",
  "whatsapp",
  "line",
  "imessage",
  "msteams",
  "googlechat",
  "qqbot",
]);

function isChannelSkill(key: string): boolean {
  if (CHANNEL_SKILL_KEYS.has(key)) return true;
  // 有些插件注册的 skill key 会带包名前缀,比如 "@wecom/..." 或 "wecom-openclaw-plugin"
  const lower = key.toLowerCase();
  for (const k of CHANNEL_SKILL_KEYS) {
    if (lower.includes(k)) return true;
  }
  return false;
}

/** Curated skill 的中文元数据 */
export interface CuratedSkillMeta {
  /** OpenClaw bundled 名(SKILL.md 的 name) */
  key: string;
  /** 显示名(中文) */
  name: string;
  /** 一句话描述(中文) */
  description: string;
  /** 分类,便于未来在技能页做 grouping */
  category: "办公协作" | "文档处理" | "信息获取" | "开发工具" | "多媒体" | "系统";
  /** emoji 图标(未提供时回落到 lucide icon) */
  emoji?: string;
}

/**
 * 精选的 OpenClaw bundled skill —— 这里列出的才会出现在"内置技能"分区。
 * 其它 bundled 条目(~35 个)默认隐藏,等到用户从技能广场主动安装才出现。
 */
export const CURATED_SKILLS: Record<string, CuratedSkillMeta> = {
  weather: {
    key: "weather",
    name: "天气",
    description: "获取当前天气和未来预报,无需 API Key",
    category: "信息获取",
    emoji: "🌦️",
  },
  github: {
    key: "github",
    name: "GitHub",
    description: "浏览仓库、创建 Issue、提交 PR、代码搜索",
    category: "开发工具",
    emoji: "🐙",
  },
  tmux: {
    key: "tmux",
    name: "tmux",
    description: "远程控制 tmux 会话,发送按键,抓取终端输出",
    category: "开发工具",
    emoji: "💻",
  },
  "video-frames": {
    key: "video-frames",
    name: "视频抽帧",
    description: "用 ffmpeg 从视频中提取帧或短片段",
    category: "多媒体",
    emoji: "🎞️",
  },
  "gh-issues": {
    key: "gh-issues",
    name: "GitHub Issues",
    description: "专注 GitHub Issue 的查询和批量操作",
    category: "开发工具",
    emoji: "📋",
  },
};

/** 判断是否是 System 级(UI 必须隐藏) */
export function isSystemSkill(key: string): boolean {
  return SYSTEM_SKILLS.has(key);
}

/** 判断是否是 Curated(白名单展示) */
export function isCuratedSkill(key: string): boolean {
  return key in CURATED_SKILLS;
}

/**
 * 桌面端的过滤规则:
 *   - 隐藏 System
 *   - 隐藏 Channel 类插件 skill(它们在 Claw 页有专属 UI)
 *   - bundled 但不在 Curated 白名单 → 隐藏(屏蔽 OpenClaw 杂项)
 *   - **隐藏 agents-skills-personal / agents-skills-project** ——
 *     这是 OpenClaw 从用户机器上 ~/.claude/skills/、当前 cwd
 *     .claude/skills/ 等全局/项目目录扫出来的 skill。对 mhclaw 这种
 *     产品,用户装 Claude Code / 本地做别的 agent 项目留下的 skill
 *     不应该"串"进 mhclaw 的已安装列表。
 *   - 其他一律显示
 */
export function shouldDisplaySkill(
  key: string,
  bundled: boolean,
  source?: string,
): boolean {
  if (isSystemSkill(key)) return false;
  if (isChannelSkill(key)) return false;
  if (bundled && !isCuratedSkill(key)) return false;
  if (source && source.startsWith("agents-skills-")) return false;
  return true;
}

/** 取 curated 元数据(不在则 null);用于给 UI 替换英文描述 */
export function getCuratedMeta(key: string): CuratedSkillMeta | null {
  return CURATED_SKILLS[key] ?? null;
}
