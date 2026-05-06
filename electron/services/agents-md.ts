/**
 * AGENTS.md contribution 注入服务。
 *
 * mhclaw 在 <agent-workspace>/AGENTS.md 末尾维护一段 marker 包裹的 contribution,
 * 告诉 agent mhclaw UI 的约定协议:
 *
 *   [embed ref url title /]           → 富内容预览按钮(OpenClaw Rich Output Protocol 原生)
 *   [Plan mode] / [Ask mode]          → 执行模式前缀
 *   [output_dir: /path]               → 本次任务产出目录声明
 *
 * 每次 mhclaw 启动 ensure 一次:
 * - AGENTS.md 不存在 → 创建一个含 contribution 的最小版本
 * - 存在但没 marker 段 → 末尾 append
 * - 存在且 marker 段内容过期(版本号不匹配) → 整段替换,保留外部内容
 */
import fs from "node:fs";
import path from "node:path";

const BEGIN = "<!-- MHWORK-CONTRIBUTION-BEGIN do-not-edit-this-section-manually -->";
const END = "<!-- MHWORK-CONTRIBUTION-END -->";
const VERSION_TAG = "v7"; // 升级约定时改 v8,触发重写

const CONTRIBUTION = `${BEGIN}
<!-- ${VERSION_TAG} -->
## mhclaw UI 约定

你运行在 mhclaw 桌面工作台里。UI 支持以下增强,**输出时请遵守**:

### 1) 文件产出声明 \`[embed]\`(**每次写文件后必做**)

**凡是你创建或修改了文件(Excel / PDF / Markdown / HTML / 图片 / 数据 / 代码 / 任何东西),都必须在回复里给出 \`[embed]\` 声明**,否则用户的"产物"面板看不到它,等于白干。

格式:

    [embed url="/Users/xxx/mhclaw/xxx/供应商名单.xlsx" title="供应商名单" /]

规则:
- **每个文件一条**,写了 N 个文件就给 N 条 embed
- url = 文件**绝对路径**(推荐)或 canvas 相对路径 / http 链接
- title = 按钮文案,用中文、简短、说清楚是什么(不是文件名也行)
- 自闭合 \`/]\`
- **即使用户没明确要求预览、你只是工具调用顺带写的文件,也要声明**
- 放在回复正文末尾,用户读完总结再看到按钮

用户会在右侧"产物"tab 看到按钮列表,点击可以预览文件内容。

### 2) 对话模式 marker
用户消息开头可能带:
- \`[Ask mode]\` → 只回答问题,**不调用任何工具、不执行任何操作**
- \`[Plan mode]\` → 先用 Markdown 编号列出你要做的步骤,等用户确认再动手
- 无 marker = Craft 模式,可以直接执行

### 3) 任务产出目录 \`[output_dir: /path]\`
用户消息可能带:

    [output_dir: /Users/xxx/mhclaw/20260415093856]

这是本次任务的**产出目录**。所有产出文件(报告 / 数据 / 图 / 代码)**必须写到这个目录下**,不要写到别处(家目录、临时目录、agent workspace 都不行)。
如果没有这个 marker,先询问用户要把产出放哪里,再开始写文件。

### 4) 本次发送指定的 skill 集 \`[skills: a, b, c]\`
用户消息可能带:

    [skills: skill-creator, weather, summarize]

这是用户**为本条消息**显式指定的 skill 集合。约定:
- **优先**使用列出来的这些 skill(及它们提供的工具),不在列表里的 skill **能不用就不用**
- 如果列出来的 skill 解决不了任务,如实告诉用户"列表里的 skill 不够,建议补 X / 取消限制"
- marker **不出现** = 没限制,按你正常的策略选 skill

### 5) 任务级记忆
本次任务的长期记忆在 \`<output_dir>/.mhclaw/memory/MEMORY.md\`,自动日志在 \`<output_dir>/.mhclaw/memory/YYYY-MM-DD.md\`。你可以读这些文件恢复历史上下文。

### 6) 浏览器工具
调 \`browser\` 工具时,**profile 参数传 \`user\` 或不传**(默认就是 user)。
- mhclaw 里的 \`user\` 被重定向成独立 Chrome 实例(不是你日常 Chrome),用户在里面登录过的账号(小红书 / 淘宝 / 微博等)会持久保留
- 如果该实例已经在跑,直接复用,**不要重复 \`start\`**;先用 \`browser status\` 查
- 遇到登录墙,告诉用户"请在 mhclaw 浏览器里登录 XX",不要编密码也不要切 profile
- 不要传 \`work\` / 其他 profile 名,mhclaw 里没启用,会超时失败

### 7) Skill 安装 / 配置 token 的**标准流程**

装新 skill 或给 skill 配 token(比如 \`TENCENT_DOCS_TOKEN\` / \`NOTION_API_KEY\`),**必须走 gateway 工具调用 RPC**,**不要**用 \`export\` / \`>> ~/.zshrc\` / \`launchctl\`。原因:mhclaw 是 Electron GUI 启动,不读 shell env,\`export\` 进程一死就没了;OpenClaw 原生 \`skills.entries.<key>.apiKey\` 会在**每轮 agent turn 开始前**按 skill frontmatter 的 \`primaryEnv\` 注入 \`process.env\`,无需重启、无需重开对话。

#### [重要] mhclaw 里没有 \`openclaw\` 这个 CLI

OpenClaw 作为 npm 依赖内嵌在 mhclaw 里,**系统 PATH 里没有 \`openclaw\` 命令**。以下写法会直接 \`command not found\`,**禁止**:

    [禁止] openclaw skills update ...
    [禁止] openclaw config patch ...
    [禁止] openclaw gateway call ...

所有对 gateway 的操作都**通过你手上的 \`gateway\` 工具调 RPC**。

#### [正解] 用 \`gateway\` 工具调 RPC

**步骤 1 - 装 skill**(用户提供 zip URL 的场景):

    # 1a. 下载 + 解压 skill 到 agent workspace 的 skills 目录(OpenClaw 会自动发现)
    curl -L -o /tmp/xxx.zip "<url>"
    unzip -q /tmp/xxx.zip -d ~/.mhclaw/workspace/skills/
    # 1b. 如果是 ClawHub 的 skill,调 gateway RPC 装:
    # gateway action=skills.install params={"source":"clawhub","slug":"<slug>"}

**步骤 2 - 配 apiKey**(关键,走 \`config.patch\`):

    # 注意:gateway.config.patch 参数名是 \`raw\`(字符串),不是 \`patch\`(对象)!
    # raw 必须是 JSON.stringify 的字符串(片段 JSON 也行,OpenClaw 会 merge)。
    gateway action=config.patch params={
      "raw": "{\\"skills\\":{\\"entries\\":{\\"tencent-docs\\":{\\"enabled\\":true,\\"apiKey\\":\\"<TOKEN>\\"}}}}",
      "baseHash": "<先 gateway.config.get 拿 hash>"
    }

或者更简单 —— 直接调 \`skills.update\` RPC:

    gateway action=skills.update params={"skillKey":"tencent-docs","apiKey":"<TOKEN>"}

**步骤 3 - 验证**:调 \`skills.status\` 看这个 skill 的 \`eligible\` 是 true,\`missing.env\` 为空,说明 gateway 已经拿到 token,下一轮你就能调它的 tool。

#### config.patch 常见坑

- 参数名 \`raw\`(字符串),不是 \`patch\`(对象)—— 用 \`patch\` 会报 \`raw required\`
- \`baseHash\` 必填,要从 \`gateway.config.get\` 先拿
- 限流 3 次 / 60 秒

#### 禁止行为清单

- [禁止] \`export TENCENT_DOCS_TOKEN=xxx\`(不生效,GUI app 读不到)
- [禁止] \`echo 'export ...' >> ~/.zshrc\`(同上,只影响新开终端)
- [禁止] \`launchctl setenv\`(要重启 app 才生效)
- [禁止] 在 tool call 参数里传 token(skill args schema 不接受,prompt 会泄漏)
- [禁止] 跑 \`openclaw\` CLI(PATH 里没有)

${END}`;

/**
 * Ensure AGENTS.md 里有最新版本的 mhclaw contribution 段。
 * @param agentWorkspace agent workspace 路径(~/.mhclaw/workspace)
 */
export function ensureAgentsMdContribution(agentWorkspace: string): void {
  if (!fs.existsSync(agentWorkspace)) {
    fs.mkdirSync(agentWorkspace, { recursive: true });
  }
  const filePath = path.join(agentWorkspace, "AGENTS.md");

  let existing = "";
  if (fs.existsSync(filePath)) {
    try {
      existing = fs.readFileSync(filePath, "utf-8");
    } catch {
      existing = "";
    }
  }

  const beginIdx = existing.indexOf(BEGIN);
  const endIdx = existing.indexOf(END);

  // 版本检测:marker 段内的 <!-- vX --> 跟当前不一致则重写
  const expectedVersionLine = `<!-- ${VERSION_TAG} -->`;
  const hasCurrentVersion =
    beginIdx !== -1 &&
    endIdx !== -1 &&
    existing.slice(beginIdx, endIdx).includes(expectedVersionLine);

  if (hasCurrentVersion) {
    // 已是最新,跳过
    return;
  }

  let next: string;
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    // 替换旧 marker 段
    const before = existing.slice(0, beginIdx).replace(/\s+$/, "");
    const after = existing.slice(endIdx + END.length).replace(/^\s+/, "");
    next = [before, CONTRIBUTION, after].filter(Boolean).join("\n\n") + "\n";
  } else if (existing.trim()) {
    // 追加到末尾
    next = existing.replace(/\s+$/, "") + "\n\n" + CONTRIBUTION + "\n";
  } else {
    // 文件为空或不存在 → 创建最小版本
    next =
      `# Agent 指令\n\n这是 agent 的操作指南。mhclaw 维护下方 contribution 段,其余内容由你控制。\n\n` +
      CONTRIBUTION +
      "\n";
  }

  fs.writeFileSync(filePath, next);
  console.log(`[AgentsMd] Contribution ${VERSION_TAG} ensured at ${filePath}`);
}
