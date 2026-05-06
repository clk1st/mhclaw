import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  History,
  Loader2,
  Network,
  RefreshCw,
  Plus,
  Server,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  KvEditor,
  pairsToRecord,
  recordToPairs,
  type KvPair,
} from "@/components/ui/kv-editor";
import { shellSplit, shellJoin } from "@/lib/shell-split";
import {
  useImportMcpServers,
  useMcpServers,
  useMcpServerProbe,
  useMcpHealth,
  useTriggerMcpProbe,
  useRemoveMcpServer,
  useToggleMcpServer,
  useUpsertMcpServer,
  type McpServerConfig,
  type McpServerEntry,
  type McpServerHttp,
  type McpServerStdio,
  useMcpSnapshotTail,
  type McpHealthStatusEntry,
} from "@/hooks/use-mcp-servers";
import { cn } from "@/lib/utils";
import { showConfirm } from "@/lib/prompt";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ViewMode =
  | { kind: "list" }
  | { kind: "edit"; entry?: McpServerEntry }
  | { kind: "snapshot" };

export function McpManagerDialog({ open, onOpenChange }: Props) {
  const [view, setView] = useState<ViewMode>({ kind: "list" });

  const handleOpenChange = (v: boolean) => {
    if (!v) setView({ kind: "list" });
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col gap-0 p-0">
        {view.kind === "list" ? (
          <ListView
            onAddNew={() => setView({ kind: "edit" })}
            onEdit={(e) => setView({ kind: "edit", entry: e })}
            onShowSnapshot={() => setView({ kind: "snapshot" })}
          />
        ) : view.kind === "snapshot" ? (
          <SnapshotView onBack={() => setView({ kind: "list" })} />
        ) : (
          <EditView
            entry={view.entry}
            onBack={() => setView({ kind: "list" })}
            onSaved={() => setView({ kind: "list" })}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ListView({
  onAddNew,
  onEdit,
  onShowSnapshot,
}: {
  onAddNew: () => void;
  onEdit: (entry: McpServerEntry) => void;
  onShowSnapshot: () => void;
}) {
  const { data, isLoading, error } = useMcpServers();
  const toggle = useToggleMcpServer();
  const remove = useRemoveMcpServer();
  const { byName: healthByName } = useMcpHealth();

  const entries = data?.entries ?? [];

  return (
    <>
      <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <DialogTitle className="flex items-center gap-2">
              <Network className="h-4 w-4" />
              MCP 服务管理
            </DialogTitle>
            <DialogDescription className="mt-1">
              接入 MCP 服务,为 AI 扩展更多工具能力
            </DialogDescription>
          </div>
          <div className="mr-8 flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={onShowSnapshot} title="最近 MCP 调用日志">
              <History />
              调用日志
            </Button>
            <Button size="sm" onClick={onAddNew}>
              <Plus />
              添加服务
            </Button>
          </div>
        </div>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            加载失败:{(error as Error).message}
          </div>
        ) : entries.length === 0 ? (
          <Empty />
        ) : (
          <div className="flex flex-col gap-2">
            {entries.map((e) => (
              <ServerRow
                key={e.name}
                entry={e}
                health={healthByName.get(e.name)}
                busy={toggle.isPending || remove.isPending}
                onToggle={(v) =>
                  toggle.mutate({ name: e.name, config: e.config, disabled: !v })
                }
                onDelete={async () => {
                  const ok = await showConfirm({
                    title: "删除 MCP 服务?",
                    description: `"${e.name}" 将从配置中移除,可以重新添加。`,
                    confirmText: "删除",
                    danger: true,
                  });
                  if (ok) remove.mutate(e.name);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Empty() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      <Server className="mx-auto h-8 w-8 text-muted-foreground/50" />
      <p className="mt-3 text-sm text-muted-foreground">尚未配置任何 MCP 服务</p>
      <p className="mt-1 text-xs text-muted-foreground/70">
        点击右上"+ 添加服务"接入 chrome-devtools / context7 / 自家 MCP 等
      </p>
    </div>
  );
}

const STATUS_DOT: Record<
  McpHealthStatusEntry["status"],
  { color: string; animate: boolean; label: string }
> = {
  configured: { color: "bg-zinc-400", animate: false, label: "等待首次探测" },
  connecting: { color: "bg-amber-500", animate: true, label: "连接中" },
  available: { color: "bg-emerald-500", animate: false, label: "可用" },
  unavailable: { color: "bg-red-500", animate: false, label: "不可用" },
  disabled: { color: "bg-zinc-400/40", animate: false, label: "已禁用" },
};

function statusSubline(
  status: McpHealthStatusEntry["status"],
  toolCount: number | undefined,
  lastError: string | undefined,
  health: McpHealthStatusEntry | undefined,
): string {
  switch (status) {
    case "available":
      return `${toolCount ?? "?"} 个工具可用`;
    case "connecting":
      return "正在连接 / 拉取工具列表…";
    case "unavailable":
      return `不可用${lastError ? `:${lastError}` : ""}${
        health?.lastSuccessAt
          ? " · 仍以上次成功的工具集对外暴露"
          : " · 需连接成功后工具才会进入 catalog"
      }`;
    case "disabled":
      return "已禁用";
    case "configured":
    default:
      return "已配置 · 等待首次探测";
  }
}

function ServerRow({
  entry,
  health,
  busy,
  onToggle,
  onDelete,
}: {
  entry: McpServerEntry;
  health: McpHealthStatusEntry | undefined;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const enabled = !(entry.config as { disabled?: boolean }).disabled;
  // 工具列表展开时按需 fire-and-forget probe (拿当前实际 tool list / description),
  // 跟 supervisor 持续维护的 health 解耦, 避免每个 row 都长期占资源。
  const probeQuery = useMcpServerProbe(entry.name, entry.config, enabled && expanded);
  const probe = probeQuery.data;
  const tools = probe?.tools ?? [];
  const triggerProbe = useTriggerMcpProbe();

  // ===== 5 态 (UI 展示, 来源 supervisor health, 跟 broker stable catalog 解耦) =====
  // disabled : 用户禁用
  // configured : 已加配置但还没 probe 过 (mhclaw 启动后第一秒)
  // connecting : 正在 probe / connect 中
  // available : 上次 probe 成功 (broker 暴露其工具)
  // unavailable : 上次 probe 失败 (broker 仍保留 last-known-good 在 catalog 内,
  //               但 callTool 会返回结构化错误 + 触发后台重连)
  const status: McpHealthStatusEntry["status"] = !enabled
    ? "disabled"
    : (health?.status ?? "configured");
  const toolCount = health?.toolCount ?? tools.length;
  const lastError = health?.lastError;

  const dot = STATUS_DOT[status];
  const subline = statusSubline(status, toolCount, lastError, health);

  // 首字母图标 + 品牌色(按 name 生成稳定色)—— 对齐 WorkBuddy 截图风格
  const initial = (entry.name[0] ?? "?").toUpperCase();
  const hue = [...entry.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const iconStyle = {
    background: `hsl(${hue} 70% 55%)`,
  };

  return (
    <div
      className={cn(
        "group rounded-xl border border-border bg-card transition hover:border-foreground/20",
        !enabled && "opacity-60",
      )}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => toolCount > 0 && setExpanded((v) => !v)}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition",
            toolCount > 0
              ? "hover:bg-muted hover:text-foreground"
              : "opacity-0 pointer-events-none",
          )}
          title={expanded ? "收起" : "展开查看工具"}
        >
          <ChevronRight
            className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")}
          />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold text-white"
            style={iconStyle}
          >
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{entry.name}</span>
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  dot.color,
                  dot.animate && "animate-pulse",
                )}
                title={dot.label}
              />
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {subline}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              triggerProbe.mutate(entry.name);
              if (expanded) probeQuery.refetch();
            }}
            disabled={busy || !enabled || status === "connecting"}
            title={
              !enabled
                ? "启用后才能探测"
                : status === "connecting"
                  ? "探测中…"
                  : "重新探测 MCP server"
            }
            className="text-muted-foreground hover:text-foreground"
          >
            {status === "connecting" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onDelete}
            disabled={busy}
            title="删除"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 />
          </Button>
          <Switch
            checked={enabled}
            disabled={busy}
            onCheckedChange={onToggle}
            className="ml-1"
          />
        </div>
      </div>
      {expanded && toolCount > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-border/60 bg-muted/30 px-4 py-2.5">
          {tools.map((t) => (
            <span
              key={t.name}
              title={t.description}
              className="rounded bg-background px-1.5 py-0.5 font-mono text-[10.5px] text-foreground/80 ring-1 ring-border/60"
            >
              {t.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}


type EditKind = "stdio" | "sse" | "streamable-http" | "json";

const KIND_OPTIONS: { value: EditKind; label: string }[] = [
  { value: "stdio", label: "STDIO" },
  { value: "sse", label: "SSE" },
  { value: "streamable-http", label: "Streamable HTTP" },
  { value: "json", label: "JSON" },
];

function EditView({
  entry,
  onBack,
  onSaved,
}: {
  entry?: McpServerEntry;
  onBack: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!entry;
  const initialKind: EditKind = !entry
    ? "stdio"
    : entry.transport === "stdio"
      ? "stdio"
      : entry.transport === "sse"
        ? "sse"
        : "streamable-http";
  const [kind, setKind] = useState<EditKind>(initialKind);

  return (
    <>
      <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon-sm" onClick={onBack} className="-ml-1">
            <ArrowLeft />
          </Button>
          <div className="min-w-0 flex-1">
            <DialogTitle>{isEdit ? `编辑 ${entry.name}` : "添加服务"}</DialogTitle>
            <DialogDescription className="mt-1">
              {isEdit ? "修改 MCP 服务配置" : "接入 MCP 服务,粘贴官方文档里的配置或填表"}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="flex flex-col gap-4">
          <Field label="类型" hint="自定义服务的配置方式">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as EditKind)}
              disabled={isEdit}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {KIND_OPTIONS.map((opt) => (
                <option
                  key={opt.value}
                  value={opt.value}
                  disabled={opt.value === "json" && isEdit}
                >
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
          {kind === "stdio" && <StdioForm entry={entry} onSaved={onSaved} />}
          {(kind === "sse" || kind === "streamable-http") && (
            <HttpForm entry={entry} transport={kind} onSaved={onSaved} />
          )}
          {kind === "json" && <JsonImportForm onSaved={onSaved} />}
        </div>
      </div>
    </>
  );
}

function StdioForm({
  entry,
  onSaved,
}: {
  entry?: McpServerEntry;
  onSaved: () => void;
}) {
  const init = entry?.config as McpServerStdio | undefined;
  const [name, setName] = useState(entry?.name ?? "");
  // 命令 + 参数合并成一行,跟终端一致;保存时 shellSplit 切成 command+args
  const [commandLine, setCommandLine] = useState(() =>
    init?.command ? shellJoin([init.command, ...(init.args ?? [])]) : "",
  );
  const [envPairs, setEnvPairs] = useState<KvPair[]>(() =>
    recordToPairs(init?.env),
  );
  const [error, setError] = useState<string | null>(null);
  const upsert = useUpsertMcpServer();

  const handleSave = async () => {
    if (!name.trim()) return setError("请填写服务名称");
    if (!/^[a-zA-Z0-9._-]+$/.test(name.trim()))
      return setError("名称只能包含字母数字 . _ -");

    const tokens = shellSplit(commandLine.trim());
    if (tokens.length === 0) return setError("请填写命令");
    const command = tokens[0];
    const args = tokens.slice(1);
    const env = pairsToRecord(envPairs);

    const config: McpServerStdio = {
      command,
      ...(args.length ? { args } : {}),
      ...(Object.keys(env).length ? { env } : {}),
    };

    setError(null);
    try {
      await upsert.mutateAsync({ name: name.trim(), config });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Field label="名称" hint="字母数字 . _ - · 作为 MCP key">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-mcp-server"
          disabled={!!entry}
        />
      </Field>
      <Field label="命令">
        <Input
          value={commandLine}
          onChange={(e) => setCommandLine(e.target.value)}
          placeholder="npx -y @modelcontextprotocol/server-filesystem"
          className="font-mono text-xs"
        />
      </Field>
      <Field label="环境变量">
        <KvEditor
          pairs={envPairs}
          onChange={setEnvPairs}
          placeholderKey="KEY"
          placeholderValue="value"
          separator="="
        />
      </Field>
      {error && <ErrorBox message={error} />}
      <SubmitRow onSave={handleSave} pending={upsert.isPending} edit={!!entry} />
    </div>
  );
}

function HttpForm({
  entry,
  transport,
  onSaved,
}: {
  entry?: McpServerEntry;
  /** EditView 通过"类型"下拉控制,这里直接用传入值 */
  transport: "sse" | "streamable-http";
  onSaved: () => void;
}) {
  // useMcpServers 读时已做 unwrap,这里 entry.config 就是 HTTP 形 {url, headers, transport}
  const init = entry?.config as McpServerHttp | undefined;
  const [name, setName] = useState(entry?.name ?? "");
  const [url, setUrl] = useState(init?.url ?? "");
  const [headerPairs, setHeaderPairs] = useState<KvPair[]>(() =>
    recordToPairs(init?.headers),
  );
  const [error, setError] = useState<string | null>(null);
  const upsert = useUpsertMcpServer();

  const handleSave = async () => {
    if (!name.trim()) return setError("请填写服务名称");
    if (!/^[a-zA-Z0-9._-]+$/.test(name.trim()))
      return setError("名称只能包含字母数字 . _ -");
    if (!/^https?:\/\//i.test(url.trim()))
      return setError("URL 必须以 http(s):// 开头");

    const headers = pairsToRecord(headerPairs);
    // OpenClaw 原生支持 Streamable HTTP / SSE 并能带 headers,原样存。
    const config: McpServerHttp = {
      url: url.trim(),
      transport,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    };

    setError(null);
    try {
      await upsert.mutateAsync({ name: name.trim(), config });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Field label="名称">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-mcp-server"
          disabled={!!entry}
        />
      </Field>
      <Field label="URL">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={
            transport === "sse"
              ? "https://example.com/mcp/sse"
              : "https://example.com/mcp"
          }
          className="font-mono text-xs"
        />
      </Field>
      <Field label="HTTP Headers" hint="用于认证或其他自定义头,如 Authorization: Bearer xxx">
        <KvEditor
          pairs={headerPairs}
          onChange={setHeaderPairs}
          placeholderKey="Header 名称"
          placeholderValue="值"
          separator=":"
        />
      </Field>
      {error && <ErrorBox message={error} />}
      <SubmitRow onSave={handleSave} pending={upsert.isPending} edit={!!entry} />
    </div>
  );
}

const JSON_PLACEHOLDER = `{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-xxx"]
    }
  }
}`;

function JsonImportForm({ onSaved }: { onSaved: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const importMutation = useImportMcpServers();

  const summary = useMemo(() => {
    if (!text.trim()) return 0;
    try {
      return Object.keys(parseImportJson(text)).length;
    } catch {
      return -1;
    }
  }, [text]);

  const handleImport = async () => {
    try {
      const servers = parseImportJson(text);
      if (Object.keys(servers).length === 0) {
        setError("没有可导入的服务");
        return;
      }
      setError(null);
      await importMutation.mutateAsync(servers);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "JSON 解析失败");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        粘贴 Claude Desktop 标准格式(顶层{" "}
        <code className="font-mono">mcpServers</code>)或 OpenClaw 原生格式(
        <code className="font-mono">mcp.servers</code>),一键批量导入。
        <br />
        <span className="text-[11px] text-muted-foreground/80">
          ⓘ 与现有 mcp.servers <strong>合并</strong>:同名服务覆盖,其他保留(JSON Merge Patch)。
        </span>
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={JSON_PLACEHOLDER}
        className="min-h-[280px] font-mono text-xs"
        spellCheck={false}
      />
      <div className="text-xs text-muted-foreground">
        {!text.trim()
          ? "粘贴 JSON 后会显示识别到的服务数"
          : summary > 0
            ? `识别到 ${summary} 个服务`
            : summary === 0
              ? "未识别到合法服务"
              : "JSON 格式不正确"}
      </div>
      {error && <ErrorBox message={error} />}
      <div className="flex justify-end">
        <Button
          onClick={handleImport}
          disabled={importMutation.isPending || summary <= 0}
        >
          {importMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : null}
          导入 {summary > 0 ? `(${summary})` : ""}
        </Button>
      </div>
    </div>
  );
}

function parseImportJson(text: string): Record<string, McpServerConfig> {
  const obj = JSON.parse(text);
  if (typeof obj !== "object" || !obj) throw new Error("不是 JSON 对象");
  const candidates = [obj.mcpServers, obj.mcp?.servers, obj.servers, obj];
  for (const c of candidates) {
    if (c && typeof c === "object" && !Array.isArray(c)) {
      const filtered: Record<string, McpServerConfig> = {};
      for (const [k, v] of Object.entries(c)) {
        if (
          v &&
          typeof v === "object" &&
          ((v as Record<string, unknown>).command ||
            (v as Record<string, unknown>).url)
        ) {
          filtered[k] = normalizeImportedServer(
            v as Record<string, unknown>,
          ) as McpServerConfig;
        }
      }
      if (Object.keys(filtered).length > 0) return filtered;
    }
  }
  throw new Error("找不到合法的 servers 段");
}

/**
 * 粘贴 JSON 的归一化 —— OpenClaw 原生支持 HTTP MCP 带 headers,原样存就行,不再 wrap。
 *  1. 老字段名 `type` 迁到 `transport`
 *  2. HTTP server 缺 transport → 按 URL 路径启发(`/sse` → sse;其他 → streamable-http)
 *  3. stdio / HTTP 都原样返回,存的就是用户粘的形
 */
function normalizeImportedServer(v: Record<string, unknown>): Record<string, unknown> {
  const out = { ...v };
  if (!out.transport && typeof out.type === "string") {
    out.transport = out.type;
    delete out.type;
  }
  if (typeof out.url === "string" && !out.transport) {
    const u = out.url.toLowerCase();
    out.transport = /\/(sse|events)(\?|\/|$)/.test(u)
      ? "sse"
      : "streamable-http";
  }
  return out;
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
        <span className="text-xs font-medium">{label}</span>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function SubmitRow({
  onSave,
  pending,
  edit,
}: {
  onSave: () => void;
  pending: boolean;
  edit: boolean;
}) {
  return (
    <div className="flex justify-end pt-2">
      <Button onClick={onSave} disabled={pending}>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {edit ? "保存" : "添加服务"}
      </Button>
    </div>
  );
}

function SnapshotView({ onBack }: { onBack: () => void }) {
  const { data, isLoading, refetch, isFetching } = useMcpSnapshotTail({ limit: 200 });
  const rows = data ?? [];
  // 按 brokerSessionId group: 同一 OpenClaw connect 视为一组
  const groups = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = map.get(r.brokerSessionId) ?? [];
      arr.push(r);
      map.set(r.brokerSessionId, arr);
    }
    // 按组内最新一条时间倒序
    return Array.from(map.entries()).sort((a, b) => {
      const ta = Math.max(...a[1].map((r) => r.ts));
      const tb = Math.max(...b[1].map((r) => r.ts));
      return tb - ta;
    });
  }, [rows]);

  return (
    <>
      <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="-ml-2 mb-1 h-7 gap-1 text-xs text-muted-foreground"
            >
              <ArrowLeft className="h-3 w-3" />
              返回
            </Button>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-4 w-4" />
              MCP 调用日志
            </DialogTitle>
            <DialogDescription className="mt-1">
              broker 收到的最近 200 条 callTool 记录,按 OpenClaw 连接(broker session)分组
            </DialogDescription>
          </div>
          <div className="mr-8 flex shrink-0 items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              刷新
            </Button>
          </div>
        </div>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
            <History className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">暂无 MCP 调用记录</p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              broker 在 AI 真正调用 MCP 工具时记录,每条 chat 任务可能触发多次
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map(([sid, entries]) => (
              <div
                key={sid}
                className="rounded-lg border border-border bg-card/40"
              >
                <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
                  <span className="font-mono">{sid.slice(0, 8)}</span>
                  <span className="opacity-60">·</span>
                  <span>{entries.length} 次调用</span>
                </div>
                <div className="divide-y divide-border/40">
                  {entries.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 px-3 py-2 text-xs"
                    >
                      <span
                        className={cn(
                          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                          r.outcome === "ok"
                            ? "bg-emerald-500/10 text-emerald-600"
                            : r.outcome === "rejected"
                              ? "bg-zinc-500/10 text-zinc-600"
                              : "bg-red-500/10 text-red-600",
                        )}
                      >
                        {r.outcome}
                      </span>
                      <span className="font-mono text-muted-foreground/80">
                        {new Date(r.ts).toLocaleTimeString("zh-CN", {
                          hour12: false,
                        })}
                      </span>
                      <span className="truncate font-medium">
                        {r.serverName}
                        <span className="text-muted-foreground">.</span>
                        {r.toolName}
                      </span>
                      {typeof r.durationMs === "number" && (
                        <span className="ml-auto shrink-0 text-muted-foreground">
                          {r.durationMs}ms
                        </span>
                      )}
                      {r.error && (
                        <span className="ml-auto max-w-[40%] shrink-0 truncate text-right text-red-500/80">
                          {r.error}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
