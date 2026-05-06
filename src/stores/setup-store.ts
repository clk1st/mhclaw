import { create } from "zustand";
import type { GatewayClient } from "@/services/gateway-client";

/** Setup Dialog 内部状态：填表 vs 成功态 */
export type SetupStep = "model" | "complete";

/** Provider 预设 */
export interface ProviderPreset {
  id: string;
  name: string;
  apiType: string;
  baseUrl: string;
  envKey: string;
  models: Array<{
    id: string;
    name: string;
    reasoning: boolean;
    /** modality — 决定 OpenClaw modelHasVision。省略 = 纯文本。只有确实支持图片输入的模型才标 ["text","image"] */
    input?: ReadonlyArray<"text" | "image">;
    contextWindow: number;
    maxTokens: number;
  }>;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    apiType: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
    envKey: "ANTHROPIC_API_KEY",
    models: [
      { id: "claude-opus-4-6", name: "Claude Opus 4.6", reasoning: true, input: ["text", "image"], contextWindow: 1_000_000, maxTokens: 32768 },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", reasoning: true, input: ["text", "image"], contextWindow: 1_000_000, maxTokens: 32768 },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", reasoning: false, input: ["text", "image"], contextWindow: 200000, maxTokens: 16384 },
    ],
  },
  {
    id: "openai",
    name: "OpenAI (GPT)",
    apiType: "openai-completions",
    baseUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
    models: [
      { id: "gpt-5.4", name: "GPT-5.4", reasoning: true, input: ["text", "image"], contextWindow: 400000, maxTokens: 32768 },
      { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", reasoning: true, input: ["text", "image"], contextWindow: 400000, maxTokens: 32768 },
      { id: "gpt-5.4-nano", name: "GPT-5.4 Nano", reasoning: false, input: ["text", "image"], contextWindow: 200000, maxTokens: 16384 },
      { id: "gpt-5.2", name: "GPT-5.2", reasoning: true, input: ["text", "image"], contextWindow: 400000, maxTokens: 16384 },
      { id: "gpt-5.2-pro", name: "GPT-5.2 Pro", reasoning: true, input: ["text", "image"], contextWindow: 400000, maxTokens: 32768 },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    apiType: "openai-completions",
    baseUrl: "https://api.deepseek.com/v1",
    envKey: "DEEPSEEK_API_KEY",
    models: [
      { id: "deepseek-chat", name: "DeepSeek Chat", reasoning: false, contextWindow: 128000, maxTokens: 8192 },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner", reasoning: true, contextWindow: 128000, maxTokens: 8192 },
    ],
  },
  {
    id: "qwen",
    name: "通义千问 (Qwen)",
    apiType: "openai-completions",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    envKey: "DASHSCOPE_API_KEY",
    models: [
      { id: "qwen3-max-2026-01-23", name: "Qwen3 Max", reasoning: true, contextWindow: 131072, maxTokens: 8192 },
      { id: "qwen-plus", name: "Qwen Plus", reasoning: false, contextWindow: 131072, maxTokens: 8192 },
    ],
  },
  {
    id: "zhipu",
    name: "智谱 (GLM)",
    apiType: "openai-completions",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    envKey: "ZHIPUAI_API_KEY",
    models: [
      { id: "glm-5.1", name: "GLM-5.1", reasoning: true, contextWindow: 200000, maxTokens: 32768 },
      { id: "glm-5", name: "GLM-5", reasoning: true, contextWindow: 200000, maxTokens: 32768 },
      { id: "glm-5-turbo", name: "GLM-5 Turbo", reasoning: false, contextWindow: 200000, maxTokens: 16384 },
      { id: "glm-4.7", name: "GLM-4.7", reasoning: true, contextWindow: 200000, maxTokens: 16384 },
      { id: "glm-4.7-flash", name: "GLM-4.7 Flash", reasoning: false, contextWindow: 200000, maxTokens: 128000 },
    ],
  },
  {
    id: "volcengine",
    name: "火山引擎 (豆包)",
    apiType: "openai-completions",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    envKey: "ARK_API_KEY",
    models: [
      { id: "doubao-pro-256k", name: "豆包 Pro 256K", reasoning: false, contextWindow: 256000, maxTokens: 4096 },
    ],
  },
  {
    id: "ollama",
    name: "Ollama (本地模型)",
    apiType: "ollama",
    baseUrl: "http://localhost:11434",
    envKey: "",
    models: [
      { id: "llama3.1", name: "Llama 3.1", reasoning: false, contextWindow: 131072, maxTokens: 4096 },
      { id: "qwen2.5", name: "Qwen 2.5", reasoning: false, contextWindow: 131072, maxTokens: 4096 },
    ],
  },
  {
    id: "custom",
    name: "自定义 (OpenAI 兼容)",
    apiType: "openai-completions",
    baseUrl: "",
    envKey: "",
    models: [],
  },
];

interface SetupState {
  /** 是否尚未配置模型（用于非阻塞 banner / Composer 拦截） */
  needsSetup: boolean;
  /** Setup Dialog 是否打开 */
  dialogOpen: boolean;
  /** Dialog 内部步骤（填表 / 成功） */
  step: SetupStep;
  /** 选择的 provider */
  selectedProvider: ProviderPreset | null;
  /** API Key */
  apiKey: string;
  /** 选择的模型 ID */
  selectedModelId: string;
  /** 自定义 provider 的 baseUrl */
  customBaseUrl: string;
  /** 自定义模型 ID */
  customModelId: string;
  /** config.get 返回的 hash（config.patch 需要） */
  configHash: string | null;
  /** 错误信息 */
  error: string | null;
  /** 提交中 */
  submitting: boolean;

  /** 连接 Gateway 后检查是否已配模型（只更新 needsSetup，不再强制阻塞） */
  checkSetup: (client: GatewayClient) => Promise<void>;
  /** 打开 Setup Dialog */
  openDialog: () => void;
  /** 关闭 Setup Dialog */
  closeDialog: () => void;
  /** 选择 provider */
  selectProvider: (provider: ProviderPreset) => void;
  /** 设置 API Key */
  setApiKey: (key: string) => void;
  /** 设置模型 */
  setSelectedModel: (modelId: string) => void;
  /** 设置自定义 URL */
  setCustomBaseUrl: (url: string) => void;
  /** 设置自定义模型 ID */
  setCustomModelId: (id: string) => void;
  /** 提交模型配置到 Gateway */
  submitModelConfig: (client: GatewayClient) => Promise<void>;
  /** 配置完成：关闭 Dialog + 标记已配 */
  completeSetup: () => void;
}

export const useSetupStore = create<SetupState>((set) => ({
  needsSetup: false,
  dialogOpen: false,
  step: "model",
  selectedProvider: null,
  apiKey: "",
  selectedModelId: "",
  customBaseUrl: "",
  customModelId: "",
  configHash: null,
  error: null,
  submitting: false,

  checkSetup: async (client) => {
    try {
      const result = await client.request<{
        config: {
          models?: { providers?: Record<string, unknown> };
          agents?: { defaults?: { model?: string }; list?: unknown[] };
        };
        raw?: string;
        hash?: string;
      }>("config.get");

      const config = result?.config;
      const configHash = result?.hash ?? null;

      // 检查用户是否显式配置了 model provider（包含 apiKey）。
      // OpenClaw 有内置 providers，但没 key 用不了，所以看用户配置 raw 里有没有。
      const rawConfig = result?.raw;
      let userHasModels = false;

      if (rawConfig) {
        try {
          const parsed = JSON.parse(rawConfig);
          userHasModels =
            parsed?.models?.providers &&
            Object.keys(parsed.models.providers).length > 0;
        } catch {
          // JSON5 parse 可能失败 → fallback 到 resolved config
        }
      }

      if (!userHasModels && config?.models?.providers) {
        userHasModels = Object.keys(config.models.providers).length > 0;
      }

      set({ needsSetup: !userHasModels, configHash });
    } catch (err) {
      console.error("[SetupStore] Failed to check config:", err);
      set({ needsSetup: true });
    }
  },

  openDialog: () => set({ dialogOpen: true, step: "model", error: null }),
  closeDialog: () => set({ dialogOpen: false }),

  selectProvider: (provider) => {
    set({
      selectedProvider: provider,
      apiKey: "",
      selectedModelId: provider.models[0]?.id ?? "",
      customBaseUrl: provider.baseUrl,
      customModelId: "",
      error: null,
    });
  },

  setApiKey: (key) => set({ apiKey: key }),
  setSelectedModel: (modelId) => set({ selectedModelId: modelId }),
  setCustomBaseUrl: (url) => set({ customBaseUrl: url }),
  setCustomModelId: (id) => set({ customModelId: id }),

  submitModelConfig: async (client) => {
    // NOTE: create 第二参数已去掉（只用 set），这里通过 (get as any) 拿 state
    const state = useSetupStore.getState();
    const {
      selectedProvider,
      apiKey,
      selectedModelId,
      customBaseUrl,
      customModelId,
    } = state;

    if (!selectedProvider) {
      set({ error: "请选择一个模型提供商" });
      return;
    }

    const isCustom = selectedProvider.id === "custom";
    const isOllama = selectedProvider.id === "ollama";

    // 验证
    if (!isOllama && !apiKey.trim()) {
      set({ error: "请输入 API Key" });
      return;
    }

    if (isCustom && !customBaseUrl.trim()) {
      set({ error: "请输入 API 地址" });
      return;
    }

    if (isCustom && !customModelId.trim()) {
      set({ error: "请输入模型 ID" });
      return;
    }

    set({ submitting: true, error: null });

    try {
      // 先获取最新的 config hash（config.patch 需要 baseHash 防止并发冲突）
      const freshConfig = await client.request<{ hash?: string }>("config.get");
      const baseHash = freshConfig?.hash ?? state.configHash;
      if (!baseHash) {
        set({ error: "无法获取配置 hash，请重试", submitting: false });
        return;
      }
      const providerId = selectedProvider.id;
      const baseUrl = isCustom ? customBaseUrl : selectedProvider.baseUrl;
      const modelId = isCustom ? customModelId : selectedModelId;
      const selectedModel = selectedProvider.models.find(
        (m) => m.id === modelId
      );

      // 构建 provider 配置
      const providerConfig: Record<string, unknown> = {
        baseUrl,
        api: isCustom ? "openai-completions" : selectedProvider.apiType,
        models: [
          {
            id: modelId,
            name: selectedModel?.name ?? modelId,
            reasoning: selectedModel?.reasoning ?? false,
            input: selectedModel?.input ? [...selectedModel.input] : ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: selectedModel?.contextWindow ?? 128000,
            maxTokens: selectedModel?.maxTokens ?? 4096,
          },
        ],
      };

      // Ollama 不需要 API Key
      if (!isOllama) {
        providerConfig.apiKey = apiKey.trim();
      }

      // 构建完整 patch
      const configPatch = {
        models: {
          providers: {
            [providerId]: providerConfig,
          },
        },
        agents: {
          defaults: {
            model: `${providerId}/${modelId}`,
          },
        },
      };

      await client.request("config.patch", {
        raw: JSON.stringify(configPatch),
        baseHash,
      });

      set({ step: "complete", submitting: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "配置保存失败";
      set({ error: message, submitting: false });
    }
  },

  completeSetup: () => {
    set({ needsSetup: false, dialogOpen: false, step: "model" });
  },
}));
