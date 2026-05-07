/**
 * 模型配置管理 —— 读写 mhclaw.json 里的 `models.providers.*.models` + `agents.defaults.model`。
 *
 * 设计约束(跟 Ryan 确认过):
 *  - 同一个 model id **全局唯一**(跨 provider)。添加时做冲突检测。
 *  - 激活模型格式:`agents.defaults.model = "providerId/modelId"`(OpenClaw 约定)。
 *  - 用户没显式设 / 设的 model 被删了 → fallback 到"最后配置的"(展平列表的最后一项)。
 *  - 全删光 → 激活返回 null,UI 显示"请配置模型"引导。
 *
 * 作用域:方案 1(全局) —— 切激活 = 改 `agents.defaults.model`,所有 session 立刻生效。
 * 方案 2(会话级)等 mhclaw 自建模型路由后端再做。
 */

import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useGatewayStore } from "@/stores/gateway-store";
import { useConfig, useSaveConfigPatch, type ConfigGetResp } from "./use-config";

export interface ProviderBlock {
  baseUrl?: string;
  apiKey?: string;
  api?: string;
  models?: ModelInfo[];
  [extra: string]: unknown;
}

export interface ModelInfo {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: string[];
  cost?: Record<string, number>;
  contextWindow?: number;
  maxTokens?: number;
  api?: string;
  [extra: string]: unknown;
}

/** 展平到扁平列表后的一条 model */
export interface ConfiguredModel {
  /** "providerId/modelId",给 agents.defaults.model 用 */
  fullId: string;
  providerId: string;
  modelId: string;
  info: ModelInfo;
  /** 所属 provider 的基础信息(不含 models 数组) */
  provider: Omit<ProviderBlock, "models">;
}

async function getFreshConfig(
  getActiveClient: ReturnType<typeof useGatewayStore.getState>["getActiveClient"],
): Promise<ConfigGetResp> {
  const client = getActiveClient();
  if (!client) throw new Error("Gateway 未连接");
  const cfg = await client.request<ConfigGetResp>("config.get");
  if (!cfg.hash) throw new Error("无法获取 config hash");
  return cfg;
}

/** 展平 `config.models.providers.*.models` → 扁平列表,保留 providers key 顺序 + 数组顺序 */
function flattenModels(cfg: Record<string, unknown> | undefined): ConfiguredModel[] {
  const providers = (cfg?.models as { providers?: Record<string, ProviderBlock> } | undefined)
    ?.providers;
  if (!providers) return [];
  const out: ConfiguredModel[] = [];
  for (const [providerId, block] of Object.entries(providers)) {
    if (!block || typeof block !== "object") continue;
    const models = Array.isArray(block.models) ? block.models : [];
    const { models: _m, ...rest } = block;
    for (const m of models) {
      if (!m || typeof m !== "object" || typeof m.id !== "string") continue;
      out.push({
        fullId: `${providerId}/${m.id}`,
        providerId,
        modelId: m.id,
        info: m,
        provider: rest,
      });
    }
  }
  return out;
}

/** 所有已配置的模型(展平列表) */
export function useConfiguredModels(): ConfiguredModel[] {
  const { data: cfg } = useConfig();
  return useMemo(() => flattenModels(cfg?.config), [cfg?.config]);
}

/**
 * 当前激活的模型(含 fallback 逻辑)。
 * 返回 null 表示"从没配过 / 全被删光" → UI 要引导用户去配置。
 */
export function useActiveModel(): ConfiguredModel | null {
  const { data: cfg } = useConfig();
  const list = useConfiguredModels();

  return useMemo(() => {
    if (list.length === 0) return null;
    // 用户显式设置的激活 model
    const defaults = (cfg?.config?.agents as { defaults?: { model?: string } } | undefined)
      ?.defaults;
    const explicit = typeof defaults?.model === "string" ? defaults.model : undefined;
    if (explicit) {
      const found = list.find((m) => m.fullId === explicit);
      if (found) return found;
      // 指向的 model 被删了 → fallback 到最后一个
    }
    return list[list.length - 1];
  }, [cfg?.config, list]);
}

/**
 * 切换激活模型。只写 `agents.defaults.model`,其他不动。
 * 乐观并发靠 config.get 的 hash 保证。
 */
export function useSwitchActiveModel() {
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);
  const save = useSaveConfigPatch();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fullId: string) => {
      const fresh = await getFreshConfig(getActiveClient);
      await save.mutateAsync({
        nextConfig: { agents: { defaults: { model: fullId } } },
        baseHash: fresh.hash,
      });
      qc.invalidateQueries({ queryKey: ["config"] });
    },
  });
}

/**
 * 添加新模型。追加到 `models.providers[providerId].models` 末尾;
 * 如果 provider 不存在就创建。可选同时激活。
 *
 * id 冲突检测由调用方在 UI 层做(允许用户选"替换"还是"取消")。
 * 这里不做,保持 hook 单一职责。
 */
export function useAddModel() {
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);
  const save = useSaveConfigPatch();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      providerId: string;
      providerBlock: Omit<ProviderBlock, "models">;
      model: ModelInfo;
      activate?: boolean;
    }) => {
      const fresh = await getFreshConfig(getActiveClient);

      // 从当前 config 取该 provider 已有的 models(可能有 REDACTED apiKey,不碰它)
      const providers = (fresh.config.models as { providers?: Record<string, ProviderBlock> })?.providers ?? {};
      const existing = providers[params.providerId];
      const existingModels = Array.isArray(existing?.models) ? existing.models : [];

      const dedup = existingModels.filter((m) => m.id !== params.model.id);
      dedup.push(params.model);

      // Partial patch: only send fields we mean to change.
      const providerPatches: Record<string, Partial<ProviderBlock>> = {};
      for (const [providerId, provider] of Object.entries(providers)) {
        if (providerId === params.providerId || !Array.isArray(provider.models)) continue;
        const models = provider.models.filter((m) => m.id !== params.model.id);
        if (models.length !== provider.models.length) {
          providerPatches[providerId] = { models };
        }
      }
      // Existing provider: only append the model — DO NOT overwrite
      // baseUrl / apiKey / api with the new providerBlock. The Setup
      // Wizard's "Custom (OpenAI compatible)" preset uses a fixed
      // providerId ("custom") for every add, so blindly spreading
      // params.providerBlock would silently replace the previously
      // configured baseUrl/apiKey when the user adds a second custom
      // model with a different upstream.
      // New provider: write the full block.
      providerPatches[params.providerId] = existing
        ? { models: dedup }
        : { ...params.providerBlock, models: dedup };

      const patch: Record<string, unknown> = {
        models: {
          providers: providerPatches,
        },
      };

      if (params.activate) {
        patch.agents = { defaults: { model: `${params.providerId}/${params.model.id}` } };
      }

      await save.mutateAsync({ nextConfig: patch, baseHash: fresh.hash });
      qc.invalidateQueries({ queryKey: ["config"] });
    },
  });
}

/**
 * 删除一个模型。如果它是当前激活的,自动 fallback 到剩下列表的最后一个;
 * 全删光就清空 `agents.defaults.model`。
 */

export function useRemoveModel() {
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { providerId: string; modelId: string }) => {
      const fresh = await getFreshConfig(getActiveClient);

      const providers = (fresh.config.models as { providers?: Record<string, ProviderBlock> })?.providers;
      const block = providers?.[params.providerId];
      if (!block || !Array.isArray(block.models)) return;

      // config.patch 的 mergeObjectArraysById 无法删除 id-keyed 数组项,schema 也不允许 models: null。
      // config.apply 做全量替换:config.get 返回完整配置(REDACTED 掩码),
      // gateway 的 restoreRedactedValues 自动还原敏感字段,baseHash 保证无并发冲突。
      const nextConfig = structuredClone(fresh.config);
      (nextConfig.models as { providers: Record<string, ProviderBlock> }).providers[
        params.providerId
      ].models = block.models.filter((m) => m.id !== params.modelId);

      // 删的是当前激活模型 → 同步 fallback
      const removedFullId = `${params.providerId}/${params.modelId}`;
      const currentActive =
        (fresh.config.agents as { defaults?: { model?: string } } | undefined)?.defaults?.model ?? "";
      if (currentActive === removedFullId) {
        const remaining = flattenModels(fresh.config).filter((m) => m.fullId !== removedFullId);
        const fallback = remaining.length > 0 ? remaining[remaining.length - 1].fullId : null;
        const agents = nextConfig.agents as { defaults?: { model?: string | null } } | undefined;
        if (agents?.defaults) agents.defaults.model = fallback;
      }

      const client = getActiveClient();
      if (!client) throw new Error("Gateway 未连接");
      await client.request("config.apply", {
        raw: JSON.stringify(nextConfig, null, 2),
        baseHash: fresh.hash,
      });
      qc.invalidateQueries({ queryKey: ["config"] });
    },
  });
}

/**
 * id 冲突检测:给定一个新 modelId,看是否跨任意 provider 已经存在。
 * 返回命中的 ConfiguredModel(用于提示"已存在,替换/取消"),否则 null。
 */
export function findDuplicateModelId(
  list: ConfiguredModel[],
  modelId: string,
): ConfiguredModel | null {
  return list.find((m) => m.modelId === modelId) ?? null;
}
