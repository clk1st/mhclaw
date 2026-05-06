import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGatewayStore } from "@/stores/gateway-store";
import { getCuratedMeta, shouldDisplaySkill } from "@/lib/skill-registry";
import { useHubSidecars } from "@/hooks/use-skillhub";

export interface SkillStatusEntry {
  name: string;
  description: string;
  source: string;
  bundled: boolean;
  skillKey: string;
  emoji?: string;
  always: boolean;
  disabled: boolean;
  eligible: boolean;
  primaryEnv?: string;
  install: Array<{ id: string; kind: string; label: string; bins?: string[] }>;
  missing: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
    os?: string[];
  };
}

interface SkillsStatusResponse {
  skills: SkillStatusEntry[];
  workspaceDir?: string;
  managedSkillsDir?: string;
}

/**
 * Fetch `skills.status`. Enabled when the Gateway is connected;
 * polls every 10s.
 *
 * Why move normalize/filter out of queryFn into a useMemo:
 * the Gateway's `skills.status` returns fast (a few hundred ms), but
 * sidecars (main-process SKILL.md frontmatter scan) are a bit slower.
 * If we read sidecars inside queryFn, the first render runs with `{}`
 * and we end up showing the English original; the next refetch
 * corrects it. The user perceives "English flashes, then snaps to
 * Chinese a few seconds later".
 *
 * Switching to `useMemo(raw, sidecars)` recomputes the moment either
 * query updates — once sidecars arrive we switch to localized labels
 * immediately, no 10s wait.
 */
export function useSkills() {
  const activeId = useGatewayStore((s) => s.activeId);
  const gateways = useGatewayStore((s) => s.gateways);
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);

  const active = gateways.find((g) => g.id === activeId);
  const connected = active?.status === "connected";

  const q = useQuery({
    queryKey: ["skills", activeId],
    queryFn: async (): Promise<SkillsStatusResponse> => {
      const client = getActiveClient();
      if (!client) return { skills: [] };
      return await client.request<SkillsStatusResponse>("skills.status");
    },
    enabled: connected,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const { data: sidecars = {} } = useHubSidecars();

  const data = useMemo<SkillsStatusResponse | undefined>(() => {
    if (!q.data) return undefined;
    const raw = Array.isArray(q.data.skills) ? q.data.skills : [];

    // For non-standard skills (hub installs like excel-xlsx /
    // word-docx) the Gateway's `skills.status` returns the **display
    // name** as `skillKey` (e.g. "Word / DOCX"), which doesn't match
    // the sidecar's slug-keyed map. Reverse-lookup against sidecars:
    // if `key` isn't a sidecar key but matches some sidecar's
    // `mdName` / `displayName`, remap to that slug. Downstream
    // (sidecars[s.skillKey] / enabled toggle / SKILL.md read) all
    // align naturally afterward.
    const normalizeKey = (s: SkillStatusEntry): string => {
      const key = s.skillKey ?? s.name;
      if (key in sidecars) return key;
      for (const [slug, sc] of Object.entries(sidecars)) {
        const aliases = [sc.mdName, sc.displayName].filter(Boolean);
        if (aliases.includes(s.name) || aliases.includes(key)) return slug;
      }
      return key;
    };

    // Two-layer overlay (priority: sidecar > curated meta):
    //   - sidecar: for hub-installed skills, override SKILL.md's
    //     English with the back-end-curated displayName / description.
    //   - curated: localized metadata for the built-in featured set
    //     (maintained in skill-registry.ts).
    const filtered = raw
      .map((s) => ({ ...s, skillKey: normalizeKey(s) }))
      .filter((s) => shouldDisplaySkill(s.skillKey, s.bundled, s.source))
      .map((s) => {
        const sidecar = sidecars[s.skillKey];
        if (sidecar?.displayName) {
          return {
            ...s,
            name: sidecar.displayName,
            description: sidecar.description || s.description,
          };
        }
        const meta = getCuratedMeta(s.skillKey);
        if (!meta) return s;
        return {
          ...s,
          name: meta.name,
          description: meta.description,
          emoji: s.emoji ?? meta.emoji,
        };
      });

    return {
      skills: filtered,
      workspaceDir: q.data.workspaceDir,
      managedSkillsDir: q.data.managedSkillsDir,
    };
  }, [q.data, sidecars]);

  return { ...q, data } as typeof q;
}

/** Toggle a skill's enabled flag. */
export function useToggleSkill() {
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ skillKey, enabled }: { skillKey: string; enabled: boolean }) => {
      const client = getActiveClient();
      if (!client) throw new Error("Gateway not connected");
      await client.request("skills.update", { skillKey, enabled });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

/**
 * Configure a skill's apiKey/token via OpenClaw's
 * `skills.entries.<key>.apiKey` mechanism. On the next agent turn,
 * the Gateway automatically injects the apiKey into `process.env`
 * according to the skill frontmatter's `primaryEnv` — the skill is
 * usable immediately, no restart and no new conversation needed.
 */
export function useSetSkillApiKey() {
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ skillKey, apiKey }: { skillKey: string; apiKey: string }) => {
      const client = getActiveClient();
      if (!client) throw new Error("Gateway not connected");
      await client.request("skills.update", { skillKey, apiKey });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

/**
 * Localized (Chinese) descriptions for OpenClaw built-in skills.
 * Replaces the upstream English descriptions in the skill list UI.
 * NOTE: this dictionary stays in Chinese until the broader UI
 * internationalization pass.
 */
export const SKILL_DESC_ZH: Record<string, string> = {
  "skill-creator": "创建、编辑、审核技能：从零创建新技能，或改进已有 SKILL.md。",
  healthcheck: "主机安全加固与风险检查：安全审计、防火墙/SSH 加固、风险评估。",
  "node-connect": "诊断设备连接和配对问题：Android / iOS / macOS 配套应用的连接故障排查。",
  "session-logs": "搜索和分析会话日志（历史对话记录）。",
  tmux: "远程控制 tmux 会话，发送按键和抓取终端输出。",
  "video-frames": "使用 ffmpeg 从视频中提取帧或短片段。",
  weather: "获取当前天气和预报，无需 API Key。",
  camsnap: "从 RTSP / ONVIF 摄像头捕获画面或视频片段。",
  canvas: "画布工具，用于图形创作和可视化。",
  "coding-agent": "将编码任务委托给后台代理执行。",
  summarize: "总结或提取 URL、播客、本地文件的文本 / 字幕内容。",
  peekaboo: "使用 Peekaboo CLI 捕获和自动化 macOS 界面操作。",
  gifgrep: "搜索 GIF 资源、下载并提取静态图。",
  "model-usage": "汇总各模型的使用量和费用统计。",
  clawhub: "浏览和安装社区技能仓库。",
  github: "GitHub 操作：浏览仓库、创建 Issue、提交 PR。",
  slack: "Slack 消息读写和频道管理。",
  discord: "Discord 消息交互和服务器管理。",
  notion: "Notion 页面和数据库的读写操作。",
  obsidian: "Obsidian 笔记库的搜索和编辑。",
  "apple-notes": "Apple 备忘录的搜索和管理。",
  "apple-reminders": "Apple 提醒事项的创建和管理。",
};
