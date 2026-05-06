import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SUPPORTED_CHANNELS, type ChannelInfo } from "@/hooks/use-channels";
import { CHANNEL_SCHEMAS } from "./channel-schemas";
import { ChannelBrand } from "./ChannelBrand";
import { ChannelConfigDialog } from "./ChannelConfigDialog";
import { cn } from "@/lib/utils";

/**
 * Claw 集成管理 Dialog —— 参考 WorkBuddy 的 "Claw 设置",一次列出所有 channel,
 * 每个独立状态 + 配置入口。
 */
export function ClawIntegrationsDialog({
  open,
  onOpenChange,
  channels,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  channels: ChannelInfo[];
}) {
  const [configChannelId, setConfigChannelId] = useState<string | null>(null);

  const byId = new Map(channels.map((c) => [c.id, c] as const));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>Claw 集成</DialogTitle>
            <DialogDescription>
              把 mhclaw 接入即时通讯渠道,从手机或客户端直接调用本地 Agent。
              所有渠道消息都会汇入 Claw 主对话。
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
            {SUPPORTED_CHANNELS.map((meta) => {
              const runtime = byId.get(meta.id);
              const isConfigurable = meta.id in CHANNEL_SCHEMAS;
              return (
                <IntegrationRow
                  key={meta.id}
                  meta={meta}
                  runtime={runtime}
                  isConfigurable={isConfigurable}
                  onConfigure={() => setConfigChannelId(meta.id)}
                />
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <ChannelConfigDialog
        channelId={configChannelId}
        onOpenChange={(o) => !o && setConfigChannelId(null)}
      />
    </>
  );
}

function IntegrationRow({
  meta,
  runtime,
  isConfigurable,
  onConfigure,
}: {
  meta: (typeof SUPPORTED_CHANNELS)[number];
  runtime: ChannelInfo | undefined;
  isConfigurable: boolean;
  onConfigure: () => void;
}) {
  const status = runtime?.running
    ? { label: "运行中", tone: "running" as const }
    : runtime?.configured
      ? { label: "已连接", tone: "configured" as const }
      : { label: "未连接", tone: "idle" as const };

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-border/60 bg-white/50 px-3 py-2.5 transition dark:bg-white/[0.03]",
        status.tone === "running" && "border-emerald-500/30",
      )}
    >
      <ChannelBrand id={meta.id} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{meta.name}</span>
          {status.tone === "running" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {status.label}
            </span>
          )}
          {status.tone === "configured" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
              <CheckCircle2 className="h-2.5 w-2.5" />
              {status.label}
            </span>
          )}
          {!isConfigurable && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              即将支持
            </span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
          {meta.brief}
        </p>
      </div>
      <div className="shrink-0">
        {isConfigurable ? (
          <Button size="sm" variant="outline" onClick={onConfigure}>
            {status.tone === "idle" ? "配置" : "管理"}
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled>
            即将支持
          </Button>
        )}
      </div>
    </div>
  );
}
