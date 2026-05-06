import type { McpServerConfig, McpServerStdio } from "@/hooks/use-mcp-servers";

/**
 * 历史兼容:老版本把 HTTP MCP 包成 `stdio + npx mcp-remote <url>` 存,
 * 为了绕 `@modelcontextprotocol/sdk` SSEClientTransport 的 header 丢失 bug。
 * 新版本 OpenClaw 的 pi-bundle-mcp-tools 已经用 StreamableHTTPClientTransport /
 * buildSseEventSourceFetch 能稳定传 headers,我们不再 wrap。
 *
 * 这里只保留反向 unwrap,供 `useMcpServers` 读时把老数据归一成 `{url, headers,
 * transport}` 形,用户下次编辑保存即完成迁移。
 */

export interface HttpIntent {
  url: string;
  transport?: "sse" | "streamable-http";
  headers?: Record<string, string>;
}

/**
 * 从 stdio 配置反查是不是 mcp-remote 包装的 HTTP,返回原始意图(url+transport+headers)。
 * 识别标志:command === "npx" 且 args 里包含 mcp-remote。
 * 返回 null 表示这就是真 stdio server(如 @wcgw/mcp 这种),不可反 unwrap。
 */
export function tryUnwrapMcpRemote(
  s: McpServerConfig,
): HttpIntent | null {
  const stdio = s as McpServerStdio;
  if (!stdio.command || stdio.command !== "npx") return null;
  const args = stdio.args ?? [];
  const hasMcpRemote = args.some(
    (a) => typeof a === "string" && /^mcp-remote(@|$)/.test(a),
  );
  if (!hasMcpRemote) return null;

  const url = args.find((a) => typeof a === "string" && /^https?:\/\//.test(a));
  if (!url) return null;

  let transport: HttpIntent["transport"] | undefined;
  const headers: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--transport" && i + 1 < args.length) {
      const t = args[i + 1];
      if (t === "sse-only") transport = "sse";
      else if (t === "http-only") transport = "streamable-http";
      i++;
    } else if (a === "--header" && i + 1 < args.length) {
      const kv = args[i + 1];
      const colon = kv.indexOf(":");
      if (colon > 0) {
        headers[kv.slice(0, colon).trim()] = kv.slice(colon + 1).trim();
      }
      i++;
    }
  }

  return {
    url,
    transport,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  };
}
