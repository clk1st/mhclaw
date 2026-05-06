import { v4 as uuid } from "uuid";
import type {
  GatewayRequest,
  GatewayResponse,
  GatewayEvent,
  GatewayMessage,
} from "@/types/gateway";

type EventHandler = (event: GatewayEvent) => void;

// 诊断计数器(见 handleEvent)
let __evDiagCount = 0;

type PendingRequest = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Gateway WebSocket 客户端
 *
 * 封装与 OpenClaw Gateway 的 WebSocket 通信：
 * - connect challenge → auth 握手
 * - 请求-响应（带超时）
 * - 事件订阅
 * - 自动重连
 */
export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private globalHandlers = new Set<EventHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;
  private challengeNonce: string | null = null;

  readonly url: string;
  private token?: string;
  private requestTimeout = 30_000;

  onConnectionChange?: (connected: boolean) => void;

  constructor(url: string, token?: string) {
    this.url = url;
    this.token = token;
  }

  /** 连接到 Gateway */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.shouldReconnect = true;
    this.doConnect();
  }

  private doConnect() {
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      console.error("[GatewayClient] WebSocket creation failed:", err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log(`[GatewayClient] Connected to ${this.url}`);
      // 等 Gateway 发 connect.challenge
    };

    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as GatewayMessage;
        this.handleMessage(msg);
      } catch (err) {
        console.error("[GatewayClient] Failed to parse message:", err);
      }
    };

    this.ws.onclose = () => {
      console.log("[GatewayClient] Disconnected");
      this.onConnectionChange?.(false);
      this.rejectAllPending("Connection closed");
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (err) => {
      console.error("[GatewayClient] WebSocket error:", err);
    };
  }

  private handleMessage(msg: GatewayMessage) {
    if (msg.type === "event") {
      this.handleEvent(msg);
    } else if (msg.type === "res") {
      this.handleResponse(msg);
    }
  }

  private handleEvent(event: GatewayEvent) {
    // connect.challenge → 发送认证
    if (event.event === "connect.challenge") {
      const payload = event.payload as { nonce: string; ts: number };
      this.challengeNonce = payload.nonce;
      this.sendConnect();
      return;
    }

    // 诊断:打印每个事件的名字 + 订阅数(前 80 条,之后静默避免刷屏)
    const perCount = this.eventHandlers.get(event.event)?.size ?? 0;
    const anyCount = this.globalHandlers.size;
    if (__evDiagCount < 80) {
      __evDiagCount++;
      console.log(
        `[GWEv] #${__evDiagCount} event="${event.event}" per-handlers=${perCount} any-handlers=${anyCount}`,
      );
    }

    // 分发事件
    const handlers = this.eventHandlers.get(event.event);
    handlers?.forEach((h) => h(event));
    this.globalHandlers.forEach((h) => h(event));
  }

  private handleResponse(res: GatewayResponse) {
    const pending = this.pending.get(res.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(res.id);

    if (res.ok) {
      pending.resolve(res.payload);
    } else {
      pending.reject(
        new Error(res.error?.message ?? "Unknown error")
      );
    }
  }

  /** 发送认证握手 */
  private sendConnect() {
    const connectReq: GatewayRequest = {
      type: "req",
      id: uuid(),
      method: "connect",
      params: {
        minProtocol: 1,
        maxProtocol: 99,
        client: {
          id: "openclaw-control-ui",
          version: "0.1.0",
          platform: "mhclaw",
          mode: "ui",
        },
        role: "operator",
        scopes: [
          "operator.read",
          "operator.write",
          "operator.admin",
          "operator.approvals",
          "operator.pairing",
        ],
        auth: this.token ? { token: this.token } : undefined,
      },
    };

    // 监听 connect 的响应
    this.pending.set(connectReq.id, {
      resolve: () => {
        console.log("[GatewayClient] Authenticated successfully");
        this.onConnectionChange?.(true);
      },
      reject: (err) => {
        console.error("[GatewayClient] Auth failed:", err.message);
        this.onConnectionChange?.(false);
      },
      timer: setTimeout(() => {
        this.pending.delete(connectReq.id);
        console.error("[GatewayClient] Connect timeout");
      }, 10_000),
    });

    this.send(connectReq);
  }

  /** 发送请求并等待响应 */
  async request<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number }
  ): Promise<T> {
    const id = uuid();
    const req: GatewayRequest = { type: "req", id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, options?.timeoutMs ?? this.requestTimeout);

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      this.send(req);
    });
  }

  /** 订阅特定事件 */
  on(event: string, handler: EventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
    return () => this.eventHandlers.get(event)?.delete(handler);
  }

  /** 订阅所有事件 */
  onAny(handler: EventHandler): () => void {
    this.globalHandlers.add(handler);
    return () => this.globalHandlers.delete(handler);
  }

  /** 断开连接 */
  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.rejectAllPending("Disconnected");
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) {
        console.log("[GatewayClient] Reconnecting...");
        this.doConnect();
      }
    }, 3000);
  }

  private rejectAllPending(reason: string) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }
}
