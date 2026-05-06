/**
 * 把一行 shell 风格的命令切成 token 数组,支持双引号 / 单引号 / 简单转义。
 *
 * 用于 MCP "命令"输入框:用户粘 `npx -y @notionhq/mcp` 进来,保存时切成
 * `{ command: "npx", args: ["-y", "@notionhq/mcp"] }`。带空格的参数要用引号:
 *    `npx -y "--x=a b" foo`  →  ["npx", "-y", "--x=a b", "foo"]
 */
export function shellSplit(line: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const raw = m[1] ?? m[2] ?? m[3] ?? "";
    tokens.push(raw.replace(/\\(.)/g, "$1"));
  }
  return tokens;
}

/**
 * 反向:把 command + args 拼回一行供展示 / 编辑。带空格或特殊字符的 token
 * 用双引号包住。
 */
export function shellJoin(tokens: string[]): string {
  return tokens
    .map((t) => (/[\s"'$`\\]/.test(t) ? `"${t.replace(/(["\\$`])/g, "\\$1")}"` : t))
    .join(" ");
}
