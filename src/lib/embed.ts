/**
 * OpenClaw Rich Output Protocol 的 [embed] shortcode 解析器。
 *
 * 形如：
 *   [embed ref="cv_123" url="/__openclaw__/canvas/..." title="Status" preferredHeight="320" /]
 *
 * assistant 输出里嵌入的这种 tag 被 mhclaw 识别为"可预览的富内容"，
 * UI 剥离可见文本、在气泡底部渲染"打开预览"按钮，点击打开右侧 Preview Tab。
 *
 * 为什么不走正则匹配 file:// 路径 —— 这是 OpenClaw 官方标准（docs/reference/rich-output-protocol.md），
 * 语义明确、边界清晰、不会误触用户普通消息里出现的路径。
 */

export interface EmbedInfo {
  ref?: string;
  url?: string;
  title?: string;
  preferredHeight?: number;
  kind?: string;
}

// [embed ... /]  —— 宽松匹配属性块，self-closing
const EMBED_RE = /\[embed\s+([^\]]*?)\/?\]/g;
// key="value" 或 key=value（无引号）
const ATTR_RE = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;

function parseAttrs(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(body))) {
    const key = m[1];
    const val = m[2] ?? m[3] ?? m[4] ?? "";
    out[key] = val;
  }
  return out;
}

function parseOne(attrBody: string): EmbedInfo {
  const attrs = parseAttrs(attrBody);
  const info: EmbedInfo = {
    ref: attrs.ref,
    url: attrs.url,
    title: attrs.title,
    kind: attrs.kind,
  };
  if (attrs.preferredHeight) {
    const n = Number(attrs.preferredHeight);
    if (Number.isFinite(n)) info.preferredHeight = n;
  }
  return info;
}

export interface ParsedEmbeds {
  /** 剥离所有 [embed] tag 后可读文本 */
  visibleText: string;
  /** 提取出的 embed 元信息列表 */
  embeds: EmbedInfo[];
}

export function parseEmbeds(text: string): ParsedEmbeds {
  if (!text || !text.includes("[embed")) {
    return { visibleText: text, embeds: [] };
  }
  const embeds: EmbedInfo[] = [];
  const visibleText = text.replace(EMBED_RE, (_match, body: string) => {
    embeds.push(parseOne(body));
    return ""; // 从显示文本里去除 tag 本身
  });
  return {
    visibleText: visibleText.replace(/\n{3,}/g, "\n\n").trim(),
    embeds,
  };
}

/** 判断 URL 是否是 canvas host 的相对 URL（以 /__openclaw__/ 开头） */
export function isCanvasRelative(url?: string): boolean {
  return !!url && url.startsWith("/__openclaw__/");
}

/** 把 canvas 相对 URL 拼接成完整 URL（默认走 127.0.0.1:18793，OpenClaw canvasHost 默认端口） */
export function resolveCanvasUrl(relative: string, canvasHost = "http://127.0.0.1:18793"): string {
  if (/^https?:\/\//i.test(relative)) return relative;
  if (relative.startsWith("/")) return canvasHost + relative;
  return canvasHost + "/" + relative;
}
