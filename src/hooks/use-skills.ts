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
 * 拉 skills.status,Gateway 连通时启用,10s 轮询。
 *
 * 为啥要把 normalize/filter 从 queryFn 搬到 useMemo:
 * Gateway 的 skills.status 返回很快(几百 ms),但 sidecars(主进程扫
 * SKILL.md frontmatter)慢一点。如果在 queryFn 里读 sidecars 缓存,
 * 第一次渲染时 sidecars 还没到,会用 `{}` 走完一遍,拿到英文原文;
 * 等下一次 refetch 才能纠正。用户体感就是"刚点进来英文,过几秒刷新
 * 成中文"。
 *
 * 改成 useMemo(raw, sidecars) 之后,任一 query 数据变化都会立刻重算,
 * sidecars 到了就立即切到中文,不用等 10s 轮询。
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

    // Gateway 的 skills.status 对非标准 skill(hub 装的 excel-xlsx /
    // word-docx)返回 skillKey 是**显示名**("Word / DOCX"),跟
    // sidecar 的 key(slug) 对不上。这里反查 sidecars:若 key 不在
    // sidecars 里但等于某条 sidecar 的 mdName / displayName,就映射回
    // slug,所有下游(sidecars[s.skillKey] / enabled toggle / SKILL.md
    // 读取)自然对齐。
    const normalizeKey = (s: SkillStatusEntry): string => {
      const key = s.skillKey ?? s.name;
      if (key in sidecars) return key;
      for (const [slug, sc] of Object.entries(sidecars)) {
        const aliases = [sc.mdName, sc.displayName].filter(Boolean);
        if (aliases.includes(s.name) || aliases.includes(key)) return slug;
      }
      return key;
    };

    // 两档覆盖(优先级:sidecar > curated meta):
    // - sidecar:hub 装的 skill,用后台录入的 displayName / description
    //   覆盖 SKILL.md 的原文(英文)。
    // - curated:内置精选 skill 的中文 meta(skill-registry 维护)。
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

/** 切换启用 */
export function useToggleSkill() {
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ skillKey, enabled }: { skillKey: string; enabled: boolean }) => {
      const client = getActiveClient();
      if (!client) throw new Error("Gateway 未连接");
      await client.request("skills.update", { skillKey, enabled });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

/**
 * 配置 skill 的 apiKey/token(走 OpenClaw 官方 skills.entries.<key>.apiKey 机制)。
 * Gateway 下一个 agent turn 会自动按 skill frontmatter 的 primaryEnv 把 apiKey 注入
 * process.env,skill 立即可用,无需重启、无需重开对话。
 */
export function useSetSkillApiKey() {
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ skillKey, apiKey }: { skillKey: string; apiKey: string }) => {
      const client = getActiveClient();
      if (!client) throw new Error("Gateway 未连接");
      await client.request("skills.update", { skillKey, apiKey });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

/** 常见技能中文描述（OpenClaw 内置技能的英文描述替换） */
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
