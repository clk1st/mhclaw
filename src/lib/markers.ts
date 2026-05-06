/**
 * mhclaw ↔ AI 的 marker 协议层。统一管理所有自定义 marker:
 *
 *   [embed url="..." title="..." /]       → Rich Output Protocol(OpenClaw 原生)
 *   [Plan mode]                            → Composer mode 前缀
 *   [Ask mode]                             → Composer mode 前缀
 *   [output_dir: /abs/path]                → 本次任务产出目录
 *
 * 发送侧:chat-store.send 前用 `buildMarkers()` 拼在用户消息前;
 * 显示侧:MessageList 渲染用户 / 助手消息时用 `stripMarkers()` 剥离。
 *
 * 这套协议是 mhclaw 通过 AGENTS.md contribution 教给 AI 的(主进程 ensureAgentsMdContribution),
 * AI 看到后按约定响应。
 */

import { parseEmbeds, type EmbedInfo, type ParsedEmbeds } from "./embed";

export type ComposerMode = "craft" | "plan" | "ask";

export interface MarkerEnvelope {
  /** 任务产出目录 */
  outputDir?: string;
  /** 发送时的 Composer 模式 */
  mode?: ComposerMode;
  /** 本次发送显式选择的 skill keys(per-message hint;不传 = 不限制) */
  skills?: string[];
}

/**
 * 把 marker envelope 拼到用户消息前(发送侧)。
 * 顺序约定:`[output_dir:] -> [Plan/Ask mode] -> 用户原文`
 * Craft 模式不加 marker(默认、省 token)。
 */
export function buildMarkers(text: string, env: MarkerEnvelope): string {
  const lines: string[] = [];
  if (env.outputDir) {
    lines.push(`[output_dir: ${env.outputDir}]`);
  }
  if (env.skills && env.skills.length > 0) {
    lines.push(`[skills: ${env.skills.join(", ")}]`);
  }
  if (env.mode === "plan") {
    lines.push(`[Plan mode]`);
  } else if (env.mode === "ask") {
    lines.push(`[Ask mode]`);
  }
  if (lines.length === 0) return text;
  return lines.join("\n") + "\n" + text;
}

const OUTPUT_DIR_RE = /\[output_dir:\s*([^\]\n]+)\]/g;
const SKILLS_RE = /\[skills:\s*([^\]\n]+)\]/g;
const MODE_RE = /\[(Plan|Ask|Craft) mode\]/g;

/** 剥离所有 mhclaw marker,返回干净文本 + 识别到的 envelope */
export function stripMarkers(text: string): {
  visibleText: string;
  envelope: MarkerEnvelope;
  embeds: EmbedInfo[];
} {
  if (!text) {
    return { visibleText: "", envelope: {}, embeds: [] };
  }

  const envelope: MarkerEnvelope = {};

  // 先剥 output_dir
  let cleaned = text.replace(OUTPUT_DIR_RE, (_m, p: string) => {
    envelope.outputDir = p.trim();
    return "";
  });

  // 再剥 skills
  cleaned = cleaned.replace(SKILLS_RE, (_m, p: string) => {
    envelope.skills = p
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return "";
  });

  // 再剥 mode
  cleaned = cleaned.replace(MODE_RE, (_m, m: string) => {
    const lower = m.toLowerCase();
    if (lower === "plan") envelope.mode = "plan";
    else if (lower === "ask") envelope.mode = "ask";
    else envelope.mode = "craft";
    return "";
  });

  // 最后剥 embed([embed] 解析复用 lib/embed.ts)
  const parsed: ParsedEmbeds = parseEmbeds(cleaned);

  return {
    visibleText: parsed.visibleText,
    envelope,
    embeds: parsed.embeds,
  };
}
