/** Gateway 连接信息 */
export interface GatewayConnection {
  id: string;
  name: string;
  /** ws://host:port */
  url: string;
  token?: string;
  /** 内置虾 vs 远程虾 */
  type: "builtin" | "remote";
  status: ConnectionStatus;
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

/** Gateway WebSocket 请求 */
export interface GatewayRequest {
  type: "req";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

/** Gateway WebSocket 响应 */
export interface GatewayResponse {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
}

/** Gateway WebSocket 事件 */
export interface GatewayEvent {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
}

export type GatewayMessage = GatewayResponse | GatewayEvent;

/**
 * OpenClaw / Anthropic 透传过来的 content block。
 * - text         → 普通 Markdown 段
 * - tool_use     → 一次工具调用的 input(调用时立即出现,结果在对应 tool_result)
 * - tool_result  → 某个 tool_use 的结果(通过 tool_use_id 配对)
 * - thinking     → extended thinking 内容(部分模型会发)
 * 未知 type 以 unknown 回落,UI 显示为原始 JSON。
 */
export type MessageBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input?: unknown }
  | {
      type: "tool_result";
      tool_use_id: string;
      content?: unknown;
      is_error?: boolean;
    }
  | { type: "thinking"; thinking?: string }
  | { type: string; [k: string]: unknown };

/** 聊天消息 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  /**
   * 文本内容(所有 text block 拼接)。保留给现有消费者:
   * embed 解析、stripMarkers、搜索等仍以纯 text 为准。
   */
  content: string;
  /**
   * 完整 content block 数组(流式期间累积)。
   * 渲染层应优先用 blocks,只有在 blocks 缺失(如 history 回放)时回落到 content。
   */
  blocks?: MessageBlock[];
  timestamp: number;
  /** 是否正在流式输出 */
  streaming?: boolean;
  /** 内部用：关联 runId */
  _runId?: string;
  /** 发送这条 user 消息时勾选的 skillKey 列表(user bubble 前展示对应 chip) */
  selectedSkills?: string[];
}

/** Gateway 状态（来自 Electron main process） */
export type BuiltinGatewayStatus =
  | { state: "stopped" }
  | { state: "running"; port: number; pid?: number }
  | { state: "restarting"; attempt: number }
  | { state: "error"; error: string };
