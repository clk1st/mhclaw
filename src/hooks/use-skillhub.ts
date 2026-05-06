import { useQuery } from "@tanstack/react-query";

/**
 * SkillHub 客户端:接 mhclaw-hub(ClawHub v1 协议兼容)。
 *
 * 默认走生产 https://skills.metrichub.app;可通过 localStorage 的
 * `mhclaw-skillhub-url` 覆盖(dev / 私有部署)。
 *
 * 旧版本(mhwork-api /api/skills)已淘汰 — hub 独立部署在 CF Workers,
 * 下载直连 R2 CDN(egress 免费),协议遵循 ClawHub v1。
 */

/**
 * 列表 summary(list/search 返回的就是这个,不含 description/tags/displayName)。
 * 详情需要走 /api/v1/skills/:name 或 /api/v1/resolve 拿 version 维度的数据。
 */
export interface SkillHubItem {
  name: string;
  family: string; // "skill" | "code-plugin" | "bundle-plugin"
  channel: string; // "official" | "community" | "private"
  /** 人类可读名(发布时填的"显示名称"),没有则回退到 name */
  displayName?: string;
  description?: string;
  tags?: string[];
  latestVersion: string;
  publishedAt: number;
  updatedAt: number;
  downloadCount: number;
  starCount: number;
}

export interface SkillHubList {
  items: SkillHubItem[];
  total: number;
  limit: number;
  offset: number;
}

/** 版本详情(resolve 解析出的下载信息) */
export interface SkillHubResolve {
  name: string;
  family: string;
  resolvedVersion: string;
  tarballUrl: string;
  sha256: string;
  size: number;
}

const DEFAULT_HUB_URL = "https://skills.metrichub.app";
const STORAGE_KEY = "mhclaw-skillhub-url";

export function getSkillHubUrl(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_HUB_URL;
  } catch {
    return DEFAULT_HUB_URL;
  }
}

export function useSkillHub(params?: { q?: string; limit?: number; offset?: number }) {
  const q = params?.q ?? "";
  const limit = params?.limit ?? 50;
  const offset = params?.offset ?? 0;
  const baseUrl = getSkillHubUrl();

  return useQuery({
    queryKey: ["skillhub", baseUrl, q, limit, offset],
    queryFn: async (): Promise<SkillHubList> => {
      // 有搜索词走 /search,无则走 /skills(形状一致)
      const path = q ? "/api/v1/search" : "/api/v1/skills";
      const url = new URL(`${baseUrl}${path}`);
      if (q) url.searchParams.set("q", q);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`SkillHub HTTP ${res.status}`);
      return res.json();
    },
    retry: 1,
    staleTime: 10_000,
  });
}

/**
 * 解析下载 URL + sha256。
 * 传 version 锁版本;不传默认最新版。
 * 返回的 tarballUrl 直连 R2 CDN(egress 免费)。
 */
export async function resolveDownload(
  name: string,
  version?: string,
): Promise<SkillHubResolve> {
  const base = getSkillHubUrl();
  const url = new URL(`${base}/api/v1/resolve`);
  url.searchParams.set("name", name);
  if (version) url.searchParams.set("version", version);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`resolve HTTP ${res.status}`);
  return res.json();
}

/**
 * 拉某个版本的 SKILL.md 源码。
 * 走 hub API 代理(Hono cors middleware 已处理 CORS,R2 公共 CDN 没 CORS header 不能直接 fetch)。
 */
export async function fetchSkillMd(name: string, version: string): Promise<string> {
  const base = getSkillHubUrl();
  const url = `${base}/api/v1/skills/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/skill-md`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SKILL.md HTTP ${res.status}`);
  return res.text();
}

/** sidecar(安装 hub skill 时写入)的信息,用于 UI 覆盖展示 */
export interface HubSidecar {
  slug: string;
  displayName?: string;
  description?: string;
  tags?: string[];
  channel?: string;
  version?: string;
  source?: string;
  installedAt?: number;
  /** 主进程读 SKILL.md frontmatter name 返回,用于跨"显示名 vs slug"反查 */
  mdName?: string;
}

/**
 * 读本地所有已装 skill 的 hub sidecar map,key = slug。
 * 用于已安装卡片用 hub 发布时的 displayName 覆盖 SKILL.md 的英文 name。
 */
export function useHubSidecars() {
  return useQuery({
    queryKey: ["skill-hub-sidecars"],
    queryFn: async (): Promise<Record<string, HubSidecar>> => {
      const api = window.cjtClaw?.skills?.readHubSidecars;
      if (!api) return {};
      return api();
    },
    staleTime: 30_000,
  });
}
