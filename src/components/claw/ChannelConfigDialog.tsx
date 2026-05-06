import { FormEvent, useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  getPath,
  setPath,
  useConfig,
  useSaveConfigPatch,
  type ConfigGetResp,
} from "@/hooks/use-config";
import { useGatewayStore } from "@/stores/gateway-store";
import { ChannelBrand } from "./ChannelBrand";
import { CHANNEL_SCHEMAS } from "./channel-schemas";
import { WeixinLoginPanel } from "./WeixinLoginPanel";

interface Props {
  channelId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function ChannelConfigDialog({ channelId, onOpenChange }: Props) {
  const open = !!channelId;
  const schema = channelId ? CHANNEL_SCHEMAS[channelId] : null;

  const { data: cfg } = useConfig();
  const save = useSaveConfigPatch();
  const getActiveClient = useGatewayStore((s) => s.getActiveClient);

  const [values, setValues] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(false);

  // 打开 Dialog 或切换 channel 时,从现有 config 预填
  useEffect(() => {
    if (!schema || !cfg?.config) {
      setValues({});
      setEnabled(false);
      return;
    }
    const channelCfg = getPath(cfg.config, `channels.${schema.id}`);
    setEnabled(
      channelCfg && typeof channelCfg === "object"
        ? Boolean((channelCfg as Record<string, unknown>).enabled)
        : false,
    );
    const next: Record<string, string> = {};
    for (const f of schema.fields) {
      const v = getPath(cfg.config, `channels.${schema.id}.${f.key}`);
      next[f.key] = typeof v === "string" ? v : "";
    }
    setValues(next);
  }, [schema, cfg, open]);

  const hasMissingRequired = useMemo(() => {
    if (!schema) return false;
    if (!enabled) return false; // 未启用就不校验
    return schema.fields.some(
      (f) => f.required && !values[f.key]?.trim(),
    );
  }, [schema, values, enabled]);

  const openExternal = (url: string) => {
    window.cjtClaw?.system
      ?.openExternal(url)
      .catch(() => window.open(url, "_blank"));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!schema || !cfg) return;
    if (hasMissingRequired) {
      toast.error("请填写所有必填项");
      return;
    }

    // 保存时拿最新 config(不能用 useConfig 缓存的 cfg.hash —— 期间 Gateway
    // 内部可能已经改过 config,比如微信登录成功后 openclaw-weixin 插件
    // 会自己 patch 一次 channel state,此时缓存 hash 已失效)。

    const applyAndPatch = async () => {
      // 每次都重新拿 client,WS 重连后旧引用可能是上一条连接
      const c = getActiveClient();
      if (!c) throw new Error("Gateway 未连接");
      const fresh = await c.request<ConfigGetResp>("config.get");
      const nextConfig = JSON.parse(JSON.stringify(fresh.config)) as Record<
        string,
        unknown
      >;
      setPath(nextConfig, `channels.${schema.id}.enabled`, enabled);
      for (const f of schema.fields) {
        const v = values[f.key]?.trim();
        if (v) {
          setPath(nextConfig, `channels.${schema.id}.${f.key}`, v);
        }
      }
      return save.mutateAsync({ nextConfig, baseHash: fresh.hash });
    };

    const isRetriable = (err: unknown) => {
      const msg = err instanceof Error ? err.message : "";
      // - config changed: baseHash 冲突,拿最新的再试
      // - Connection closed: 提交瞬间 WS 断了(同事机器上遇到过,可能是
      //   openclaw-weixin 插件首次加载时 Gateway 内部重启了 WS handler)
      return (
        msg.includes("config changed") ||
        msg.includes("Connection closed") ||
        msg.includes("Gateway 未连接")
      );
    };

    const waitForReady = async (timeoutMs = 5000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (getActiveClient()) return;
        await new Promise((r) => setTimeout(r, 200));
      }
    };

    try {
      try {
        await applyAndPatch();
      } catch (err) {
        if (!isRetriable(err)) throw err;
        await waitForReady();
        await applyAndPatch();
      }
      toast.success(`已保存 ${schema.displayName} 配置`);
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "保存失败";
      toast.error(msg, {
        description:
          msg.includes("rate")
            ? "配置保存限流 3 次/60 秒,稍等再试"
            : msg.includes("Connection closed")
              ? "Gateway 连接被重置,稍等几秒再点一次保存"
              : undefined,
      });
    }
  };

  if (!schema) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <ChannelBrand id={schema.id} size={36} />
            <div className="min-w-0 flex-1">
              <DialogTitle>{schema.displayName}</DialogTitle>
              <DialogDescription className="mt-0.5">
                {schema.intro}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          {/* 启用开关 */}
          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium">启用渠道</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                关闭不会删除配置,可随时再开
              </div>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {/* 步骤说明(折叠不进来,直接展开,短) */}
          {schema.steps && schema.steps.length > 0 && (
            <div className="rounded-xl bg-muted/40 px-3 py-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground">
                  获取凭证步骤
                </span>
                {schema.docsUrl && (
                  <button
                    type="button"
                    onClick={() => openExternal(schema.docsUrl!)}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                  >
                    官方文档
                    <ExternalLink className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
              <ol className="list-inside list-decimal space-y-0.5 text-[11px] leading-relaxed text-muted-foreground">
                {schema.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          )}

          {/* WeChat 特殊路径:直接内嵌扫码登录面板 */}
          {schema.id === "openclaw-weixin" && (
            <WeixinLoginPanel />
          )}

          {/* 字段(没字段就不渲染) */}
          {schema.fields.length > 0 && (
            <div className="flex flex-col gap-3">
              {schema.fields.map((f) => (
                <label key={f.key} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">
                      {f.label}
                      {f.required && (
                        <span className="ml-1 text-destructive">*</span>
                      )}
                    </span>
                    {f.help && (
                      <span className="text-[10px] text-muted-foreground">
                        {f.help}
                      </span>
                    )}
                  </div>
                  <Input
                    type={f.type === "password" ? "password" : "text"}
                    value={values[f.key] ?? ""}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                    placeholder={f.placeholder}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
              ))}
            </div>
          )}
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={save.isPending}
          >
            取消
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={save.isPending || hasMissingRequired}
          >
            {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
