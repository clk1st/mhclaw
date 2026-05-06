/**
 * 产物清单(Artifacts)持久化服务。
 *
 * 真相源 = 任务目录内 `<task-folder>/.mhclaw/artifacts.json`:
 * - 跟任务目录自包含,拷走目录就完整
 * - 跨设备迁移 / 以后 mhwork-api 同步只需加同步层,数据模型不改
 * - 前端 preview-store 仅作运行时缓存,不承担持久化责任
 *
 * 一条 artifact 目前对应一个 OpenClaw `[embed]` shortcode:
 *   [embed ref="..." url="..." title="..." preferredHeight="..." kind="..." /]
 * 未来文件系统变更追踪引入后,artifact 可扩展 source: "embed" | "fs"。
 *
 * 去重策略:ref 优先,次 url;相同签名不重复写。
 */
import fs from "node:fs";
import path from "node:path";
import { getFolderForSession } from "./task-folder.js";

const MHWORK_SUB = ".mhclaw";
const ARTIFACTS_JSON = "artifacts.json";

/**
 * 产物条目。两种 source:
 * - "embed":AI 消息里显式声明的 [embed](canvas URL / 非文件富内容)
 *           → 持久化到 .mhclaw/artifacts.json
 * - "fs"   :task folder 里命中白名单后缀的成品文件(xlsx/docx/pdf/md/html/...)
 *           → 扫盘动态生成,不落库(磁盘本身是真相源)
 */
export interface ArtifactEntry {
  source: "embed" | "fs";
  title?: string;
  /** embed 时等于 registeredAt;fs 时等于文件 mtime */
  registeredAt: number;

  /** embed 专属 */
  ref?: string;
  url?: string;
  preferredHeight?: number;
  kind?: string;

  /** fs 专属:相对 task folder 的路径,用于拼 mhclaw-workspace:// URL */
  relPath?: string;
  size?: number;
  mtime?: number;
}

/** 仅落到 artifacts.json 的字段(source="embed") */
interface EmbedFileEntry {
  source: "embed";
  registeredAt: number;
  ref?: string;
  url?: string;
  title?: string;
  preferredHeight?: number;
  kind?: string;
}

interface ArtifactsFile {
  version: 1;
  entries: EmbedFileEntry[];
}

/** 产物白名单:AI 输出里"有意义的成品"的后缀 */
const PRODUCT_EXT = new Set([
  ".xlsx", ".xls",
  ".docx", ".doc",
  ".pdf",
  ".pptx", ".ppt",
  ".md",
  ".html", ".htm",
  ".csv",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
]);

function artifactsFilePath(taskPath: string): string {
  return path.join(taskPath, MHWORK_SUB, ARTIFACTS_JSON);
}

function ensureMhworkDir(taskPath: string) {
  const dir = path.join(taskPath, MHWORK_SUB);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadFile(taskPath: string): ArtifactsFile {
  const p = artifactsFilePath(taskPath);
  if (!fs.existsSync(p)) return { version: 1, entries: [] };
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf-8")) as ArtifactsFile;
    if (!data || !Array.isArray(data.entries)) return { version: 1, entries: [] };
    return { version: 1, entries: data.entries };
  } catch {
    // 文件损坏就当空,不丢历史的做法等 v2 再说(复杂度不值)
    return { version: 1, entries: [] };
  }
}

function saveFile(taskPath: string, data: ArtifactsFile) {
  ensureMhworkDir(taskPath);
  fs.writeFileSync(artifactsFilePath(taskPath), JSON.stringify(data, null, 2));
}

function signature(a: { ref?: string; url?: string }): string {
  return (a.ref ?? "") || (a.url ?? "");
}

/**
 * 扫 task folder 下所有成品文件(递归,跳过 .mhclaw 和隐藏,后缀白名单)。
 * 深度限制 6 层,防止异常目录结构拖累。
 */
function listFsArtifacts(taskPath: string): ArtifactEntry[] {
  const results: ArtifactEntry[] = [];
  if (!fs.existsSync(taskPath)) return results;

  const walk = (dir: string, depth: number) => {
    if (depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(abs, depth + 1);
        continue;
      }
      const ext = path.extname(e.name).toLowerCase();
      if (!PRODUCT_EXT.has(ext)) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }
      const rel = path.relative(taskPath, abs);
      results.push({
        source: "fs",
        title: e.name,
        relPath: rel,
        size: stat.size,
        mtime: stat.mtimeMs,
        registeredAt: stat.mtimeMs,
      });
    }
  };
  walk(taskPath, 0);
  return results;
}

/**
 * 读 session 对应 task folder 的 artifacts。
 * 合并两路:
 * - embed 持久化条目(artifacts.json)
 * - fs 成品文件(白名单后缀)
 * 去重策略:fs 的 relPath 若被任何 embed.url 包含(AI 既发了文件又 [embed] 的情况),
 *          保留 embed 版本,丢 fs 版本。按 registeredAt 倒序。
 */
export function listArtifactsForSession(sessionKey: string): ArtifactEntry[] {
  const taskPath = getFolderForSession(sessionKey);
  if (!taskPath) return [];

  const embedEntries: ArtifactEntry[] = loadFile(taskPath).entries.map((e) => ({
    ...e,
  }));
  const fsEntries = listFsArtifacts(taskPath);

  const embedUrlHay = embedEntries
    .map((e) => e.url ?? "")
    .filter(Boolean)
    .join("\u0001");
  const merged: ArtifactEntry[] = [...embedEntries];
  for (const f of fsEntries) {
    if (f.relPath && embedUrlHay.includes(f.relPath)) continue;
    merged.push(f);
  }
  merged.sort((a, b) => (b.registeredAt ?? 0) - (a.registeredAt ?? 0));
  return merged;
}

export interface AddInput {
  ref?: string;
  url?: string;
  title?: string;
  preferredHeight?: number;
  kind?: string;
}

/**
 * 把一批 embed 批量登记到 session 对应 task folder 的 artifacts.json。
 * - 无签名(既没 ref 又没 url)的跳过
 * - 已存在(相同签名)的跳过,不重复
 * - session 没绑 task folder 的返回 null(调用方应该先 ensureForSession)
 * 返回:合并后的完整 entries 列表(方便前端直接用作 query 缓存更新)
 */
export function addArtifactsForSession(
  sessionKey: string,
  inputs: AddInput[],
): ArtifactEntry[] | null {
  const taskPath = getFolderForSession(sessionKey);
  if (!taskPath) return null;

  const file = loadFile(taskPath);
  const existingSigs = new Set(file.entries.map(signature).filter(Boolean));
  const now = Date.now();
  let changed = false;

  for (const inp of inputs) {
    const sig = signature(inp);
    if (!sig) continue;
    if (existingSigs.has(sig)) continue;
    existingSigs.add(sig);
    file.entries.push({
      ref: inp.ref,
      url: inp.url,
      title: inp.title,
      preferredHeight: inp.preferredHeight,
      kind: inp.kind,
      source: "embed",
      registeredAt: now,
    });
    changed = true;
  }

  if (changed) saveFile(taskPath, file);
  return file.entries;
}
