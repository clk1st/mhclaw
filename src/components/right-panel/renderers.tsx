import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Loader2 } from "lucide-react";
import { markdownLinkComponents } from "@/lib/markdown-components";

/**
 * PreviewTab 的多格式 renderer 集合。
 *
 * 按 URL 后缀分派:
 *  - md / markdown → ReactMarkdown(GFM + 代码高亮)
 *  - csv          → 表格(简易 CSV parser,支持引号转义)
 *  - json         → 美化 + 等宽
 *  - txt / log    → 等宽纯文本
 *  - 其他         → 调用方走 iframe(图片 / PDF / HTML / 等)
 *
 * 文本类 renderer 通过 fetch(url) 拿内容(自定义协议 supportFetchAPI:true 已支持)。
 */

export type PreviewKind =
  | "markdown"
  | "csv"
  | "json"
  | "text"
  | "excel"
  | "docx"
  | "iframe";

/**
 * 代码 / 文本类扩展名(都交给 TextRenderer 做等宽 + 可选语法高亮)
 *
 * 注意:**不包含** html / htm / svg —— 它们是"可渲染"内容,
 * 用户期望看的是渲染结果(iframe 里显示),不是源码。
 */
const CODE_LIKE_EXT = new Set([
  ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".java", ".kt", ".go", ".rs", ".c", ".h", ".cpp", ".hpp", ".cc",
  ".rb", ".php", ".swift", ".scala", ".lua", ".dart",
  ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat",
  ".yml", ".yaml", ".toml", ".ini", ".conf",
  ".xml",
  ".css", ".scss", ".sass", ".less",
  ".sql", ".graphql", ".proto",
  ".dockerfile", ".makefile", ".mk",
  ".env", ".properties",
]);

export function detectPreviewKind(url: string): PreviewKind {
  const cleaned = url.split("?")[0].split("#")[0].toLowerCase();
  const ext = cleaned.slice(cleaned.lastIndexOf("."));
  switch (ext) {
    case ".md":
    case ".markdown":
      return "markdown";
    case ".csv":
    case ".tsv":
      return "csv";
    case ".json":
      return "json";
    case ".txt":
    case ".log":
      return "text";
    case ".xlsx":
    case ".xls":
      return "excel";
    case ".docx":
      return "docx";
    default:
      if (CODE_LIKE_EXT.has(ext)) return "text";
      return "iframe";
  }
}

/** fetch URL 拿 ArrayBuffer,给二进制 renderer 用(xlsx / docx) */
function useFetchedBuffer(url: string | undefined): {
  buffer: ArrayBuffer | null;
  loading: boolean;
  error: string | null;
} {
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setBuffer(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((b) => {
        if (!cancelled) setBuffer(b);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { buffer, loading, error };
}

/** fetch URL 文本内容,简单 cache(组件级) */
export function useFetchedText(url: string | undefined): {
  text: string | null;
  loading: boolean;
  error: string | null;
} {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setText(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { text, loading, error };
}

export function MarkdownRenderer({ url }: { url: string }) {
  const { text, loading, error } = useFetchedText(url);

  if (loading) return <RendererSpinner />;
  if (error) return <RendererError msg={error} />;
  if (text == null) return null;

  return (
    <div
      className={[
        "prose prose-sm dark:prose-invert h-full max-w-none overflow-auto px-6 py-4",
        // 贴 mhclaw 色板 / shadcn token
        "prose-headings:text-foreground prose-headings:font-semibold",
        "prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-h1:mb-4 prose-h2:mb-3 prose-h3:mb-2",
        "prose-p:text-foreground/90 prose-p:leading-7",
        "prose-a:text-primary prose-a:no-underline prose-a:hover:underline",
        "prose-strong:text-foreground prose-strong:font-semibold",
        "prose-blockquote:border-l-primary/40 prose-blockquote:bg-muted/30 prose-blockquote:py-0.5 prose-blockquote:pl-4 prose-blockquote:not-italic prose-blockquote:text-foreground/80",
        "prose-code:rounded prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:font-normal prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:rounded-lg prose-pre:bg-muted prose-pre:text-foreground prose-pre:shadow-sm prose-pre:border prose-pre:border-border",
        "prose-hr:border-border",
        "prose-table:text-sm prose-th:bg-muted/50 prose-th:font-medium prose-td:border-border prose-th:border-border",
        "prose-img:rounded-lg prose-img:shadow-sm",
        "prose-li:marker:text-muted-foreground",
      ].join(" ")}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={markdownLinkComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export function CsvRenderer({ url }: { url: string }) {
  const { text, loading, error } = useFetchedText(url);
  const isTsv = url.toLowerCase().endsWith(".tsv");

  const rows = useMemo(
    () => (text ? parseCsv(text, isTsv ? "\t" : ",") : []),
    [text, isTsv],
  );

  if (loading) return <RendererSpinner />;
  if (error) return <RendererError msg={error} />;
  if (!rows.length) {
    return (
      <div className="px-6 py-6 text-center text-xs text-muted-foreground">
        空表格
      </div>
    );
  }

  const [head, ...body] = rows;

  return (
    <div className="h-full overflow-auto px-2 py-2">
      <div className="text-[11px] text-muted-foreground pb-1.5 px-1">
        {body.length + 1} 行 · {head.length} 列
      </div>
      <table className="min-w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-muted">
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                className="border border-border px-2 py-1.5 text-left font-medium"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, i) => (
            <tr key={i} className={i % 2 ? "bg-muted/30" : ""}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  className="border border-border px-2 py-1 align-top font-mono"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function JsonRenderer({ url }: { url: string }) {
  const { text, loading, error } = useFetchedText(url);
  const formatted = useMemo(() => {
    if (!text) return "";
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text; // 非合法 JSON 也展示
    }
  }, [text]);

  if (loading) return <RendererSpinner />;
  if (error) return <RendererError msg={error} />;

  return (
    <pre className="h-full overflow-auto bg-background p-4 font-mono text-[11px] leading-5">
      {formatted}
    </pre>
  );
}

export function TextRenderer({ url }: { url: string }) {
  const { text, loading, error } = useFetchedText(url);
  if (loading) return <RendererSpinner />;
  if (error) return <RendererError msg={error} />;
  return (
    <pre className="h-full overflow-auto whitespace-pre-wrap break-words bg-background p-4 font-mono text-[11px] leading-5">
      {text ?? ""}
    </pre>
  );
}

/**
 * Excel (.xlsx / .xls) renderer。
 * 动态 import xlsx(~300KB),仅首次预览 Excel 时加载,不占首屏。
 * 多 sheet 时顶部 tab 切换。
 */
export function ExcelRenderer({ url }: { url: string }) {
  const { buffer, loading, error } = useFetchedBuffer(url);
  const [sheets, setSheets] = useState<{ name: string; rows: string[][] }[] | null>(
    null,
  );
  const [activeSheet, setActiveSheet] = useState(0);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    if (!buffer) {
      setSheets(null);
      return;
    }
    let cancelled = false;
    setParseError(null);
    (async () => {
      try {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buffer, { type: "array" });
        const parsed = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          // header: 1 → 直接拿二维数组,空单元格补 ""
          const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
            header: 1,
            defval: "",
            blankrows: false,
          }) as unknown[][];
          return {
            name,
            rows: rows.map((r) => r.map((c) => (c == null ? "" : String(c)))),
          };
        });
        if (!cancelled) {
          setSheets(parsed);
          setActiveSheet(0);
        }
      } catch (err) {
        if (!cancelled) {
          setParseError(err instanceof Error ? err.message : "解析失败");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buffer]);

  if (loading) return <RendererSpinner />;
  if (error) return <RendererError msg={error} />;
  if (parseError) return <RendererError msg={parseError} />;
  if (!sheets) return <RendererSpinner />;
  if (sheets.length === 0) {
    return (
      <div className="px-6 py-6 text-center text-xs text-muted-foreground">
        空工作簿
      </div>
    );
  }

  const sheet = sheets[activeSheet];
  const [head, ...body] = sheet.rows.length > 0 ? sheet.rows : [[]];

  return (
    <div className="flex h-full flex-col">
      {/* Sheet tabs(≥2 时才显示) */}
      {sheets.length > 1 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              onClick={() => setActiveSheet(i)}
              className={
                "shrink-0 rounded-md px-2.5 py-0.5 text-[11px] transition " +
                (i === activeSheet
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")
              }
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto px-2 py-2">
        <div className="px-1 pb-1.5 text-[11px] text-muted-foreground">
          {sheet.rows.length} 行 · {(head ?? []).length} 列
        </div>
        <table className="min-w-full border-collapse text-xs">
          {head && head.length > 0 && (
            <thead className="sticky top-0 bg-muted">
              <tr>
                {head.map((h, i) => (
                  <th
                    key={i}
                    className="border border-border px-2 py-1.5 text-left font-medium"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {body.map((row, i) => (
              <tr key={i} className={i % 2 ? "bg-muted/30" : ""}>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className="border border-border px-2 py-1 align-top font-mono"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Word (.docx) renderer。
 * 动态 import mammoth,把 docx 转成受控 HTML。
 * 样式交由外层 .prose,跟 Markdown 一致。
 */
export function DocxRenderer({ url }: { url: string }) {
  const { buffer, loading, error } = useFetchedBuffer(url);
  const [html, setHtml] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    if (!buffer) {
      setHtml(null);
      return;
    }
    let cancelled = false;
    setParseError(null);
    (async () => {
      try {
        // 用 mammoth 的 browser bundle(内置 jszip/xmldom 浏览器实现,不牵 fs 进 Vite)
        const mammoth = await import("mammoth/mammoth.browser");
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
        if (!cancelled) setHtml(result.value);
      } catch (err) {
        if (!cancelled) {
          setParseError(err instanceof Error ? err.message : "解析失败");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buffer]);

  if (loading) return <RendererSpinner />;
  if (error) return <RendererError msg={error} />;
  if (parseError) return <RendererError msg={parseError} />;
  if (html == null) return <RendererSpinner />;

  return (
    <div
      className="prose prose-sm dark:prose-invert h-full max-w-none overflow-auto px-6 py-4"
      // mammoth 输出是白名单 HTML(p/h1-6/ul/ol/li/table/strong/em/a/img),不含 script
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function RendererSpinner() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      加载中…
    </div>
  );
}

function RendererError({ msg }: { msg: string }) {
  return (
    <div className="px-6 py-6 text-center text-xs text-destructive">
      加载失败:{msg}
    </div>
  );
}

/** 简易 CSV/TSV 解析,支持双引号包裹 + "" 转义。不依赖外部库。 */
function parseCsv(text: string, sep: string = ","): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuote = true;
      } else if (c === sep) {
        cur.push(field);
        field = "";
      } else if (c === "\r") {
        // 跳过,等 \n
      } else if (c === "\n") {
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = "";
      } else {
        field += c;
      }
    }
  }
  if (field !== "" || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}
