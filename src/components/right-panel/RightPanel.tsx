import { ChevronRight, Eye, FileText, FolderTree, GitCompare } from "lucide-react";
import { usePreviewStore, type RightPanelTab } from "@/stores/preview-store";
import { useCurrentTaskFolder } from "@/hooks/use-task-folder";
import { useWatchTaskFolder } from "@/hooks/use-fs-tree";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PreviewTab } from "./PreviewTab";
import { ArtifactsTab } from "./ArtifactsTab";
import { FilesTab } from "./FilesTab";
import { ChangesTab } from "./ChangesTab";

interface TabDef {
  key: RightPanelTab;
  label: string;
  icon: typeof Eye;
}

const TABS: TabDef[] = [
  { key: "artifacts", label: "产物", icon: FileText },
  { key: "files", label: "全部文件", icon: FolderTree },
  { key: "changes", label: "变更", icon: GitCompare },
  { key: "preview", label: "预览", icon: Eye },
];

/**
 * 右侧工作面板容器：四 tab（产物/全部文件/变更/预览）+ 收起按钮。
 * 数据层（SQLite/chokidar/protocol）在主进程实装前，
 * 非 preview tab 显示占位，preview 已可用于 [embed] 声明的内容。
 */
export function RightPanel() {
  const tab = usePreviewStore((s) => s.tab);
  const setTab = usePreviewStore((s) => s.setTab);
  const closePanel = usePreviewStore((s) => s.closePanel);

  // 面板常驻的 chokidar 订阅:不管用户当前看哪个 tab,
  // 文件变更都要刷新 artifacts / fs:children / snapshot diff。
  const { data: taskPath } = useCurrentTaskFolder();
  useWatchTaskFolder(taskPath);

  return (
    <div className="surface-pane flex h-full flex-col shadow-[inset_1px_0_0_rgba(15,23,42,0.06)] dark:shadow-[inset_1px_0_0_rgba(255,255,255,0.06)]">
      {/* Tab bar:柔底胶囊式,选中态白 pill */}
      <div className="flex items-center gap-1 px-2 pt-2 pb-1">
        <div className="flex flex-1 gap-0.5 overflow-x-auto">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs transition",
                  active
                    ? "bg-white/85 font-medium text-foreground ring-1 ring-black/[0.05] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:bg-white/[0.08] dark:ring-white/10 dark:shadow-none"
                    : "text-foreground/55 hover:bg-white/50 hover:text-foreground dark:hover:bg-white/[0.04]",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={closePanel}
          className="shrink-0 text-foreground/55 hover:bg-black/[0.05] dark:hover:bg-white/[0.06]"
          title="收起面板"
        >
          <ChevronRight />
        </Button>
      </div>

      {/* Tab content —— min-h-0 是必须的:没有它 flex-1 的 item 在内容超长时不会压缩,
          子组件里 h-full overflow-auto 拿不到正确的容器高度,滚动条不出现 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "artifacts" && <ArtifactsTab />}
        {tab === "files" && <FilesTab />}
        {tab === "changes" && <ChangesTab />}
        {tab === "preview" && <PreviewTab />}
      </div>
    </div>
  );
}
