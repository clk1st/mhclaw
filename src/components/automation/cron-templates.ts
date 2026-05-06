/**
 * 自动化任务模板 —— 对标 WorkBuddy 的"模板库"。
 * 点击卡片后打开创建 Dialog 并预填字段,用户仍可改。
 */

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = 周日(跟 cron 一致)

export interface CronTemplate {
  id: string;
  emoji: string;
  title: string;
  desc: string;
  /** 默认名称(Dialog 里会预填到 name) */
  name: string;
  /** 给 AI 的提示词 */
  message: string;
  /** 每天 HH:mm */
  time: string;
  /** 选中的星期(默认全选 = 每天) */
  weekdays: Weekday[];
}

const EVERYDAY: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
const WORKDAYS: Weekday[] = [1, 2, 3, 4, 5];
const FRIDAY: Weekday[] = [5];
const SUNDAY: Weekday[] = [0];

export const CRON_TEMPLATES: CronTemplate[] = [
  {
    id: "ai-daily",
    emoji: "📰",
    title: "每日 AI 新闻",
    desc: "关注当天 AI 领域重要动态,侧重 AI coding / 产品 / 研究",
    name: "每日 AI 新闻",
    message:
      "帮我整理今天 AI 领域的重要动态(过去 24 小时),覆盖 AI coding 工具 / 大模型发布 / 产品和公司新闻 / 重要研究。每条含标题 + 一句话要点 + 链接。",
    time: "09:00",
    weekdays: EVERYDAY,
  },
  {
    id: "weekly-report",
    emoji: "📋",
    title: "每周工作周报",
    desc: "每周五汇总 PR / Issue / 关键变更,输出可直接提交的周报",
    name: "每周工作周报",
    message:
      "汇总本周(周一至周五)我的工作产出: 提交的 PR、关闭的 issue、重要变更、遇到的问题、下周计划。Markdown 格式,可直接提交。",
    time: "17:00",
    weekdays: FRIDAY,
  },
  {
    id: "email-digest",
    emoji: "📧",
    title: "每日邮件摘要",
    desc: "下班前汇总今天的邮件重点和待回复事项",
    name: "每日邮件摘要",
    message:
      "总结今天收到的重要邮件,按优先级分组: 需要立刻回复的 / 可以明天处理的 / 仅通知类。每项包含发件人 + 主题 + 一句话要点。",
    time: "18:00",
    weekdays: WORKDAYS,
  },
  {
    id: "weekly-review",
    emoji: "🪞",
    title: "每周复盘",
    desc: "周日晚复盘本周做了什么、卡点在哪、下周聚焦",
    name: "每周复盘",
    message:
      "带我复盘本周: 完成了哪些重要事? 有哪些卡点或反思? 下周最想聚焦哪 3 件事? 请像教练一样提问,我回答后你再总结。",
    time: "20:00",
    weekdays: SUNDAY,
  },
  {
    id: "daily-why",
    emoji: "💡",
    title: "每日一个为什么",
    desc: "每天抛一个有趣的问题,先提问再解答",
    name: "每日一个为什么",
    message:
      "抛出一个有趣的「为什么」问题(科学 / 历史 / 生活 / 哲学),先只问不答。我说「揭晓」再给详细解答。",
    time: "08:00",
    weekdays: EVERYDAY,
  },
  {
    id: "bedtime-story",
    emoji: "🌙",
    title: "每日睡前故事",
    desc: "给娃的 3-5 分钟温和睡前故事",
    name: "每日睡前故事",
    message:
      "生成一个 3-5 分钟可读的温和睡前故事,适合 4-8 岁儿童,情节完整并附简单插图描述。",
    time: "20:30",
    weekdays: EVERYDAY,
  },
];

/**
 * 把"时间 + 星期"转成 5 段 cron 表达式。
 * - 星期全选 → "M H * * *"
 * - 星期部分选 → "M H * * 1,3,5"
 */
export function toCronExpr(time: string, weekdays: Weekday[]): string {
  const [h, m] = time.split(":").map((s) => parseInt(s, 10));
  const minute = Number.isFinite(m) ? m : 0;
  const hour = Number.isFinite(h) ? h : 9;
  const dow =
    weekdays.length === 0 || weekdays.length === 7
      ? "*"
      : [...weekdays].sort((a, b) => a - b).join(",");
  return `${minute} ${hour} * * ${dow}`;
}

/** 浏览器本地时区(IANA),用于传给 cron.add 的 schedule.tz */
export function getLocalTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * 反向解析 5 段 cron 表达式到 time + weekdays。
 * 仅支持 `M H * * <dow>` 这类 Dialog 能表达的子集;
 * 带 step 语法(斜杠 N)、带 dom / month 的高级语法返回 null(调用方走 rawExprReadOnly 兜底)。
 */
export function fromCronExpr(
  expr: string,
): { time: string; weekdays: Weekday[] } | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minuteS, hourS, domS, monthS, dowS] = parts;
  if (domS !== "*" || monthS !== "*") return null;
  if (/[\/,-]/.test(minuteS) || /[\/,-]/.test(hourS)) return null;
  const minute = parseInt(minuteS, 10);
  const hour = parseInt(hourS, 10);
  if (
    !Number.isFinite(minute) ||
    !Number.isFinite(hour) ||
    minute < 0 || minute > 59 ||
    hour < 0 || hour > 23
  ) {
    return null;
  }
  let weekdays: Weekday[];
  if (dowS === "*") {
    weekdays = [0, 1, 2, 3, 4, 5, 6];
  } else if (/^[0-6](,[0-6])*$/.test(dowS)) {
    weekdays = dowS.split(",").map((s) => parseInt(s, 10) as Weekday);
  } else {
    return null;
  }
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return { time, weekdays };
}

/**
 * 把 Gateway 返的 schedule(可能是 string 也可能是对象)反解成 Dialog 的
 * form state。对无法反解的 cron 表达式走 rawExprReadOnly 兜底,UI 会显示
 * 只读 badge 并给"清除重设"入口,避免丢失用户的高级 cron 语义。
 */
export interface ScheduleFormState {
  freq: "daily" | "interval" | "once";
  time: string;
  weekdays: Weekday[];
  /** interval 模式:分钟 */
  intervalMin: number;
  /** once 模式:YYYY-MM-DD */
  onceDate: string;
  /** once 模式:HH:mm */
  onceTime: string;
  /** 源 tz(若跟本地不一致,Dialog 顶部提示) */
  sourceTz?: string;
  /** 无法反解时原样保留,Dialog 走只读兜底 */
  rawExprReadOnly?: string;
}

export function scheduleToFormState(
  schedule: unknown,
): ScheduleFormState {
  const base: ScheduleFormState = {
    freq: "daily",
    time: "09:00",
    weekdays: EVERYDAY,
    intervalMin: 60,
    onceDate: "",
    onceTime: "",
  };

  if (!schedule) return base;

  // 老 Gateway 直接返字符串(cron 表达式)
  if (typeof schedule === "string") {
    const parsed = fromCronExpr(schedule);
    if (parsed) {
      return { ...base, freq: "daily", ...parsed };
    }
    return { ...base, freq: "daily", rawExprReadOnly: schedule };
  }

  if (typeof schedule !== "object") return base;
  const s = schedule as {
    kind?: string;
    expr?: string;
    tz?: string;
    everyMs?: number;
    at?: number;
  };

  if (s.kind === "cron" && typeof s.expr === "string") {
    const parsed = fromCronExpr(s.expr);
    if (parsed) {
      return {
        ...base,
        freq: "daily",
        ...parsed,
        sourceTz: s.tz,
      };
    }
    return {
      ...base,
      freq: "daily",
      sourceTz: s.tz,
      rawExprReadOnly: s.expr,
    };
  }

  if (s.kind === "every") {
    // everyMs 可能在 expr 字段里(新 Gateway)或 everyMs 字段里(老)
    const ms = typeof s.everyMs === "number"
      ? s.everyMs
      : typeof s.expr === "string"
        ? parseInt(s.expr, 10)
        : NaN;
    if (Number.isFinite(ms) && ms > 0) {
      return {
        ...base,
        freq: "interval",
        intervalMin: Math.max(1, Math.round(ms / 60000)),
        sourceTz: s.tz,
      };
    }
    return { ...base, freq: "interval", sourceTz: s.tz };
  }

  if (s.kind === "at") {
    // at 可能是 ms 数字、ms 数字字符串,或 ISO 字符串("2026-04-23T11:30:00+08:00")
    const parseTs = (v: unknown): number => {
      if (typeof v === "number") return v;
      if (typeof v !== "string" || !v) return NaN;
      const iso = Date.parse(v);
      if (!Number.isNaN(iso)) return iso;
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : NaN;
    };
    let at = parseTs(s.at);
    if (!Number.isFinite(at)) at = parseTs(s.expr);
    if (Number.isFinite(at) && at > 0) {
      const d = new Date(at);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mi = String(d.getMinutes()).padStart(2, "0");
      return {
        ...base,
        freq: "once",
        onceDate: `${yyyy}-${mm}-${dd}`,
        onceTime: `${hh}:${mi}`,
        sourceTz: s.tz,
      };
    }
    return { ...base, freq: "once", sourceTz: s.tz };
  }

  return base;
}
