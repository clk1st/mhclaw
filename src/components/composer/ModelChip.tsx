import { Brain, Check, ChevronDown, Plus, Settings2, AlertCircle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  useActiveModel,
  useConfiguredModels,
  useSwitchActiveModel,
  type ConfiguredModel,
} from "@/hooks/use-models";
import { useSetupStore } from "@/stores/setup-store";

/**
 * Composer 里的模型选择器 chip。
 *
 * 设计决策(跟 Ryan 对齐):
 *  - 作用域:**全局**(写 agents.defaults.model)—— 切换后所有会话立即生效
 *  - 零配置态:显示"请配置模型"引导,点击打开 SetupWizard
 *  - 正常态:显示当前激活 model 名;下拉列出所有已配置模型,radio 点击即切换
 *  - 被删的激活 model / 从没设过 → hook 自动 fallback 到"最后配置的一个"
 *  - 对标 WorkBuddy 的 Auto chip,但暂不实现"自动路由"(等自建后端再说)
 */
export function ModelChip() {
  const active = useActiveModel();
  const list = useConfiguredModels();
  const switchModel = useSwitchActiveModel();
  const openSetup = useSetupStore((s) => s.openDialog);

  const isEmpty = list.length === 0;
  const label = isEmpty
    ? "请配置模型"
    : active
      ? active.info.name || active.modelId
      : "未选择";

  const handlePick = async (fullId: string) => {
    if (active?.fullId === fullId) return;
    await switchModel.mutateAsync(fullId);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs ring-1 transition",
            isEmpty
              ? "bg-destructive/5 text-destructive ring-destructive/20 hover:bg-destructive/10"
              : "bg-white/50 text-foreground ring-black/[0.04] hover:bg-white hover:ring-black/10 dark:bg-white/[0.04] dark:ring-white/[0.06] dark:hover:bg-white/[0.08] dark:hover:ring-white/15",
          )}
          title={
            isEmpty
              ? "还没有配置任何模型,点击开始配置"
              : active
                ? `当前模型:${label} · ${active.providerId}`
                : "未选择模型"
          }
        >
          {isEmpty ? (
            <AlertCircle className="h-3 w-3" />
          ) : (
            <Brain className="h-3 w-3 text-foreground/55" />
          )}
          <span className="max-w-[120px] truncate">{label}</span>
          <ChevronDown className="h-2.5 w-2.5 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          已配置的模型
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {isEmpty ? (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            还没有配置任何模型
          </div>
        ) : (
          list.map((m) => (
            <ModelRow
              key={m.fullId}
              model={m}
              active={active?.fullId === m.fullId}
              onClick={() => handlePick(m.fullId)}
            />
          ))
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => openSetup()}
          className="flex items-center gap-2 py-2 text-primary"
        >
          {isEmpty ? (
            <>
              <Plus className="h-3.5 w-3.5" />
              <span className="text-sm font-medium">配置模型</span>
            </>
          ) : (
            <>
              <Settings2 className="h-3.5 w-3.5" />
              <span className="text-sm">管理 / 添加模型</span>
            </>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelRow({
  model,
  active,
  onClick,
}: {
  model: ConfiguredModel;
  active: boolean;
  onClick: () => void;
}) {
  const name = model.info.name || model.modelId;
  // ctx 窗口数据来自 mhclaw 内的 preset 默认值(128K/200K),跟各厂商真实
  // 上限常常对不上,展示出来反而误导用户,索性不显示
  const reasoning = model.info.reasoning ? "reasoning" : "";
  const tags = [reasoning].filter(Boolean);

  return (
    <DropdownMenuItem
      onClick={onClick}
      className={cn("flex items-start gap-2 py-2", active && "bg-accent")}
    >
      {/* Radio dot */}
      <span
        className={cn(
          "mt-1 flex h-3 w-3 shrink-0 items-center justify-center rounded-full border",
          active
            ? "border-primary bg-primary"
            : "border-muted-foreground/40",
        )}
      >
        {active && <span className="h-1.5 w-1.5 rounded-full bg-background" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{name}</span>
          {active && <Check className="h-3 w-3 shrink-0 text-primary" />}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="font-mono">{model.providerId}</span>
          {tags.length > 0 && (
            <>
              <span className="opacity-50">·</span>
              <span>{tags.join(" · ")}</span>
            </>
          )}
        </div>
      </div>
    </DropdownMenuItem>
  );
}
