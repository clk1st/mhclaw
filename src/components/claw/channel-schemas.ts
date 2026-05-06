/**
 * 各 channel 的配置表单 schema。
 *
 * 配置路径约定:`channels.<id>.<field.key>` 或 `channels.<id>.<nested>.<key>`
 * 保存时一次性 patch 到 OpenClaw config,自动写入 `~/.mhclaw/mhclaw.json`。
 */

export interface FieldSpec {
  /** 相对 `channels.<id>.` 的路径 */
  key: string;
  label: string;
  placeholder?: string;
  /** 小字说明,显示在 label 右侧 */
  help?: string;
  type: "text" | "password";
  required?: boolean;
}

export interface ChannelSchema {
  id: string;
  displayName: string;
  /** 卡片 intro 下方的简短引导文字 */
  intro: string;
  /** 可选的申请 / 配置步骤(每条是一句 Markdown 文本,用 1. 2. 形式) */
  steps?: string[];
  /** 外链文档(打开浏览器) */
  docsUrl?: string;
  /** 社区插件(需要先 `openclaw plugins install <pkg>`) */
  isPlugin?: boolean;
  pluginPackage?: string;
  /** 配置字段 */
  fields: FieldSpec[];
}

export const CHANNEL_SCHEMAS: Record<string, ChannelSchema> = {
  telegram: {
    id: "telegram",
    displayName: "Telegram",
    intro: "在 @BotFather 发 /newbot 创建机器人,拿到 Bot Token 填下面。",
    steps: [
      "Telegram 里搜 @BotFather,发 /newbot",
      "按提示起名 + 起 username(必须以 bot 结尾)",
      "复制拿到的 Token(格式 123456:ABC-DEF_...)",
    ],
    docsUrl: "https://core.telegram.org/bots#creating-a-new-bot",
    fields: [
      {
        key: "botToken",
        label: "Bot Token",
        placeholder: "123456:ABC-DEF_ghi...",
        type: "password",
        required: true,
      },
    ],
  },

  discord: {
    id: "discord",
    displayName: "Discord",
    intro: "去 Discord Developer Portal 创建 Application,在 Bot 页面复制 Token。",
    steps: [
      "打开 https://discord.com/developers/applications 创建 Application",
      '左侧 "Bot" 标签,点 "Reset Token" 并复制(仅展示一次)',
      "Privileged Gateway Intents 里开启 Message Content Intent",
    ],
    docsUrl: "https://discord.com/developers/docs/getting-started",
    fields: [
      {
        key: "token",
        label: "Bot Token",
        placeholder: "MTA1Mzc...（以 M / N / O 开头）",
        type: "password",
        required: true,
      },
    ],
  },

  feishu: {
    id: "feishu",
    displayName: "飞书 / Lark",
    intro: "飞书开放平台自建应用 → 凭证与基础信息拿 App ID + App Secret。",
    steps: [
      "打开 open.feishu.cn,创建「企业自建应用」",
      "「凭证与基础信息」复制 App ID / App Secret",
      "「事件与回调」切到「长连接 WebSocket」(最省事),复制 Encrypt Key + Verification Token",
      "「权限管理」开通 im:message、im:message:send_as_bot 等权限",
    ],
    docsUrl: "https://open.feishu.cn/document/",
    fields: [
      {
        key: "accounts.default.appId",
        label: "App ID",
        placeholder: "cli_xxxxxxxxxx",
        type: "text",
        required: true,
      },
      {
        key: "accounts.default.appSecret",
        label: "App Secret",
        type: "password",
        required: true,
      },
      {
        key: "encryptKey",
        label: "Encrypt Key",
        help: "Webhook 模式必填",
        type: "password",
      },
      {
        key: "verificationToken",
        label: "Verification Token",
        help: "Webhook 模式必填",
        type: "password",
      },
    ],
  },

  ddingtalk: {
    id: "ddingtalk",
    displayName: "钉钉",
    intro:
      "钉钉开放平台 → 创建「企业内部应用」机器人,启用 Stream 模式,拿 AppKey + AppSecret。",
    steps: [
      "登录 open.dingtalk.com,创建「企业内部应用」选「机器人」",
      "「基础信息」复制 AppKey / AppSecret",
      "「开发管理」把消息接收方式切到「Stream 模式」",
      "「权限管理」开通「机器人自主回复」",
    ],
    docsUrl: "https://open.dingtalk.com/document/",
    fields: [
      {
        key: "appKey",
        label: "AppKey",
        placeholder: "dingxxxxxxxx",
        type: "text",
        required: true,
      },
      {
        key: "appSecret",
        label: "AppSecret",
        type: "password",
        required: true,
      },
    ],
  },

  wecom: {
    id: "wecom",
    displayName: "企业微信",
    intro:
      "企业微信管理后台 → 应用管理 → 自建应用,拿 CorpID + AgentID + Secret;配合 WebSocket 插件。",
    steps: [
      "work.weixin.qq.com 登录后,「我的企业」复制企业 ID(CorpID)",
      "「应用管理」创建应用,复制 AgentID + Secret",
      "「功能」→「接收消息」勾选「接收消息」,复制 Token + EncodingAESKey",
    ],
    docsUrl: "https://developer.work.weixin.qq.com/document/",
    fields: [
      {
        key: "corpId",
        label: "CorpID",
        placeholder: "ww0123456789abcdef",
        type: "text",
        required: true,
      },
      {
        key: "agentId",
        label: "AgentID",
        placeholder: "1000002",
        type: "text",
        required: true,
      },
      {
        key: "secret",
        label: "Secret",
        type: "password",
        required: true,
      },
      {
        key: "token",
        label: "Token",
        help: "接收消息回调用",
        type: "password",
      },
      {
        key: "encodingAESKey",
        label: "EncodingAESKey",
        help: "43 位固定长度",
        type: "password",
      },
    ],
  },

  "openclaw-weixin": {
    id: "openclaw-weixin",
    displayName: "微信",
    intro:
      "腾讯 iLink Bot,扫码登录(仅支持私聊)。目前需用命令行触发扫码流程,UI 内扫码还在路上。",
    steps: [
      "下面勾选「启用」并保存",
      "终端运行: openclaw channels login --channel openclaw-weixin",
      "手机扫码 + 确认授权,凭证自动保存",
      "重启 mhclaw 让 Gateway 重载",
    ],
    fields: [], // 纯扫码流程,无需表单字段
  },
};
