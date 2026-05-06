import { useEffect, useState } from "react";
import { CheckCircle2, Check, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  PROVIDER_PRESETS,
  useSetupStore,
  type ProviderPreset,
} from "@/stores/setup-store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  useActiveModel,
  useAddModel,
  useConfiguredModels,
  useRemoveModel,
  useSwitchActiveModel,
  findDuplicateModelId,
  type ConfiguredModel,
} from "@/hooks/use-models";

/**
 * 模型配置弹窗：Dialog 形态，全局单例，任何地方调 openDialog() 都能打开。
 * 保存成功后自动延迟关闭，不阻塞主界面。
 */
export function SetupWizard() {
  const dialogOpen = useSetupStore((s) => s.dialogOpen);
  const step = useSetupStore((s) => s.step);
  const closeDialog = useSetupStore((s) => s.closeDialog);
  const completeSetup = useSetupStore((s) => s.completeSetup);

  // 保存成功后延迟 1.2s 自动关闭
  useEffect(() => {
    if (step === "complete" && dialogOpen) {
      const t = setTimeout(() => completeSetup(), 1200);
      return () => clearTimeout(t);
    }
  }, [step, dialogOpen, completeSetup]);

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        {step === "complete" ? (
          <SuccessInline />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>配置模型</DialogTitle>
              <DialogDescription>
                选择 AI 模型服务，保存后 mhclaw 即可开始对话
              </DialogDescription>
            </DialogHeader>
            <ModelForm />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SuccessInline() {
  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
        <CheckCircle2 className="h-7 w-7 text-primary" />
      </div>
      <div className="text-center">
        <h3 className="text-lg font-semibold tracking-tight">配置完成</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          已保存到 Gateway，窗口即将关闭
        </p>
      </div>
    </div>
  );
}

/**
 * 重写后的 ModelForm:
 *  - 顶部"已配置"区:列出所有 providers.*.models,radio 点击切换激活,每项带删除
 *  - 下方"添加新模型"区:已配置 >= 1 时默认折叠,点 [+添加新模型] 展开;零配置时默认展开
 *  - submit 走 useAddModel(追加,不再覆盖 provider 整个 models 数组)
 *  - id 冲突:跨 provider 全局唯一,检测到同 id 弹 confirm "已存在,替换 / 取消"
 *  - 不再调 setup-store.submitModelConfig(那个逻辑会覆盖 provider 整条 models,不适合多模型管理)
 */
function ModelForm() {
  const configured = useConfiguredModels();
  const active = useActiveModel();
  const switchActive = useSwitchActiveModel();
  const removeModel = useRemoveModel();
  const addModel = useAddModel();

  // 添加表单的折叠状态:零配置时默认展开,否则默认折叠
  const [addFormOpen, setAddFormOpen] = useState(configured.length === 0);
  // 零配置 → 展开一定是强制;已有配置 → 用户手动切换
  useEffect(() => {
    if (configured.length === 0) setAddFormOpen(true);
  }, [configured.length]);

  return (
    <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto pr-1">
      {/* 已配置列表 */}
      {configured.length > 0 && (
        <div>
          <div className="flex items-center justify-between pb-2">
            <div className="text-xs font-medium text-muted-foreground">
              已配置的模型
            </div>
            <div className="text-[10px] text-muted-foreground/70">
              点击前面的 radio 即可切换当前使用
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {configured.map((m) => (
              <ConfiguredRow
                key={m.fullId}
                model={m}
                active={active?.fullId === m.fullId}
                onActivate={() => switchActive.mutate(m.fullId)}
                onDelete={async () => {
                  try {
                    await removeModel.mutateAsync({
                      providerId: m.providerId,
                      modelId: m.modelId,
                    });
                  } catch (e) {
                    toast.error(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* 添加区 —— 已配置 >=1 时可折叠 */}
      {!addFormOpen ? (
        <Button
          variant="outline"
          className="w-full border-dashed"
          onClick={() => setAddFormOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          添加新模型
        </Button>
      ) : (
        <AddModelForm
          onCancel={configured.length > 0 ? () => setAddFormOpen(false) : undefined}
          onAdded={() => {
            setAddFormOpen(false);
          }}
          addModel={addModel}
          configured={configured}
        />
      )}
    </div>
  );
}

/** 已配置列表的一行:radio + name + provider 标签 + 删除 */
function ConfiguredRow({
  model,
  active,
  onActivate,
  onDelete,
}: {
  model: ConfiguredModel;
  active: boolean;
  onActivate: () => void;
  onDelete: () => void;
}) {
  const name = model.info.name || model.modelId;
  const [confirming, setConfirming] = useState(false);

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm transition",
        confirming
          ? "border-destructive/40 bg-destructive/5"
          : active
            ? "border-primary bg-primary/5"
            : "border-border bg-card hover:bg-accent",
      )}
    >
      <button
        onClick={onActivate}
        className="flex flex-1 items-center gap-2.5 text-left"
        disabled={active}
        title={active ? "当前使用中" : "设为当前使用"}
      >
        <span
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition",
            active ? "border-primary bg-primary" : "border-muted-foreground/40",
          )}
        >
          {active && <span className="h-1.5 w-1.5 rounded-full bg-background" />}
        </span>
        <span className="font-medium">{name}</span>
        {active && (
          <span className="flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <Check className="h-2.5 w-2.5" />
            当前
          </span>
        )}
        {model.info.reasoning && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            Reasoning
          </span>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
        {confirming ? (
          <>
            <button
              onClick={() => setConfirming(false)}
              className="rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground transition"
            >
              取消
            </button>
            <button
              onClick={() => { setConfirming(false); onDelete(); }}
              className="rounded px-1.5 py-0.5 text-destructive hover:bg-destructive hover:text-destructive-foreground transition"
            >
              确认删除
            </button>
          </>
        ) : (
          <>
            <span className="font-mono">{model.providerId}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setConfirming(true)}
              className="text-muted-foreground hover:text-destructive"
              title="删除"
            >
              <Trash2 />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** 添加新模型表单 —— 复用现有 setup-store 的表单态和 provider 选择 UI */
function AddModelForm({
  onCancel,
  onAdded,
  addModel,
  configured,
}: {
  onCancel?: () => void;
  onAdded: () => void;
  addModel: ReturnType<typeof useAddModel>;
  configured: ConfiguredModel[];
}) {
  const {
    selectedProvider,
    selectProvider,
    apiKey,
    setApiKey,
    selectedModelId,
    setSelectedModel,
    customBaseUrl,
    setCustomBaseUrl,
    customModelId,
    setCustomModelId,
    error,
  } = useSetupStore();
  const [localError, setLocalError] = useState<string | null>(null);
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [customReasoning, setCustomReasoning] = useState(false);
  const [customImageInput, setCustomImageInput] = useState(false);
  const [customContextWindow, setCustomContextWindow] = useState(128000);
  const [customMaxTokens, setCustomMaxTokens] = useState(4096);

  const isCustom = selectedProvider?.id === "custom";
  const isOllama = selectedProvider?.id === "ollama";

  const handleSubmit = async () => {
    setLocalError(null);
    if (!selectedProvider) {
      setLocalError("请选择一个模型提供商");
      return;
    }
    if (!isOllama && !apiKey.trim()) {
      setLocalError("请输入 API Key");
      return;
    }
    if (isCustom && !customBaseUrl.trim()) {
      setLocalError("请输入 API 地址");
      return;
    }
    if (isCustom && !customModelId.trim()) {
      setLocalError("请输入模型 ID");
      return;
    }

    const modelId = isCustom ? customModelId.trim() : selectedModelId;
    if (!modelId) {
      setLocalError("请选择模型");
      return;
    }

    // id 冲突检测:第一次触发时展示 warning,用户再次点击才替换
    const dup = findDuplicateModelId(configured, modelId);
    if (dup && !dupWarning) {
      setDupWarning(`模型 ID「${modelId}」已存在（${dup.providerId}），再次点击「添加」将替换旧配置。`);
      return;
    }
    setDupWarning(null);

    const providerId = selectedProvider.id;
    const baseUrl = isCustom ? customBaseUrl.trim() : selectedProvider.baseUrl;
    const modelPreset = selectedProvider.models.find((m) => m.id === modelId);

    const providerBlock: Record<string, unknown> = {
      baseUrl,
      api: isCustom ? "openai-completions" : selectedProvider.apiType,
    };
    if (!isOllama) providerBlock.apiKey = apiKey.trim();

    try {
      await addModel.mutateAsync({
        providerId,
        providerBlock,
        model: {
          id: modelId,
          name: modelPreset?.name ?? modelId,
          reasoning: isCustom ? customReasoning : (modelPreset?.reasoning ?? false),
          input: isCustom
            ? (customImageInput ? ["text", "image"] : ["text"])
            : (modelPreset?.input ? [...modelPreset.input] : ["text"]),
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: isCustom ? customContextWindow : (modelPreset?.contextWindow ?? 128000),
          maxTokens: isCustom ? customMaxTokens : (modelPreset?.maxTokens ?? 4096),
        },
        // 首次添加或"替换已存在"时,激活新模型;否则保留当前激活
        activate: configured.length === 0 || !!dup,
      });
      // 首次添加成功 → 消 HomePage 顶部的"尚未配置 AI 模型"banner
      if (configured.length === 0) {
        useSetupStore.setState({ needsSetup: false });
      }
      onAdded();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "添加失败");
    }
  };

  const submitting = addModel.isPending;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-dashed border-border bg-card/30 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">添加新模型</div>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            取消
          </Button>
        )}
      </div>

      <div>
        <div className="pb-2 text-xs font-medium text-muted-foreground">
          模型提供商
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PROVIDER_PRESETS.map((preset) => (
            <ProviderButton
              key={preset.id}
              preset={preset}
              selected={selectedProvider?.id === preset.id}
              onSelect={() => selectProvider(preset)}
            />
          ))}
        </div>
      </div>

      {selectedProvider && (
        <>
          {!isOllama && (
            <Field label="API Key" hint={selectedProvider.envKey || undefined}>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`输入你的 ${selectedProvider.name} API Key`}
              />
            </Field>
          )}

          {isCustom && (
            <Field label="API 地址">
              <Input
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
                placeholder="https://your-api.example.com/v1"
              />
            </Field>
          )}

          {!isCustom && selectedProvider.models.length > 0 && (
            <Field label="选择模型">
              <div className="flex flex-col gap-2">
                {selectedProvider.models.map((model) => (
                  <ModelOption
                    key={model.id}
                    name={model.name}
                    reasoning={model.reasoning}
                    selected={selectedModelId === model.id}
                    onSelect={() => setSelectedModel(model.id)}
                  />
                ))}
              </div>
            </Field>
          )}

          {isCustom && (
            <Field label="模型 ID">
              <Input
                value={customModelId}
                onChange={(e) => setCustomModelId(e.target.value)}
                placeholder="例如: gpt-4o / claude-sonnet-4-5 / qwen-max 等"
              />
            </Field>
          )}

          {isCustom && (
            <>
              <Field label="模型能力">
                <div className="flex flex-col gap-2">
                  <ToggleOption
                    label="支持 Reasoning / 思考链（如 o1、DeepSeek R1）"
                    checked={customReasoning}
                    onChange={setCustomReasoning}
                  />
                  <ToggleOption
                    label="支持图片输入（Vision）"
                    checked={customImageInput}
                    onChange={setCustomImageInput}
                  />
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="上下文窗口（tokens）">
                  <Input
                    type="number"
                    min={1024}
                    value={customContextWindow}
                    onChange={(e) => setCustomContextWindow(Math.max(1024, Number(e.target.value)))}
                  />
                </Field>
                <Field label="最大输出（tokens）">
                  <Input
                    type="number"
                    min={256}
                    value={customMaxTokens}
                    onChange={(e) => setCustomMaxTokens(Math.max(256, Number(e.target.value)))}
                  />
                </Field>
              </div>
            </>
          )}

          {dupWarning && (
            <div className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              {dupWarning}
            </div>
          )}

          {(error || localError) && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {localError || error}
            </div>
          )}

          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "保存中…" : dupWarning ? "确认替换" : "添加"}
          </Button>
        </>
      )}
    </div>
  );
}

function ProviderButton({
  preset,
  selected,
  onSelect,
}: {
  preset: ProviderPreset;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "rounded-xl border border-border bg-card px-4 py-3 text-left text-sm transition",
        selected
          ? "border-primary bg-primary/5 ring-2 ring-primary/20"
          : "hover:border-foreground/20 hover:bg-accent",
      )}
    >
      {preset.name}
    </button>
  );
}

function ModelOption({
  name,
  reasoning,
  selected,
  onSelect,
}: {
  name: string;
  reasoning: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-left text-sm transition",
        selected
          ? "border-primary bg-primary/5"
          : "hover:border-foreground/20 hover:bg-accent",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "inline-block h-3.5 w-3.5 rounded-full border-2 transition",
            selected
              ? "border-[5px] border-primary"
              : "border-border bg-background",
          )}
        />
        <span>{name}</span>
        {reasoning && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            Reasoning
          </span>
        )}
      </div>
    </button>
  );
}

function ToggleOption({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition text-left",
        checked
          ? "border-primary bg-primary/5 text-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-accent",
      )}
    >
      <span
        className={cn(
          "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border-2 transition",
          checked ? "border-primary bg-primary" : "border-muted-foreground/40",
        )}
      >
        {checked && <Check className="h-2.5 w-2.5 text-white" />}
      </span>
      {label}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        {hint && (
          <span className="font-mono text-[11px] text-muted-foreground">
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
