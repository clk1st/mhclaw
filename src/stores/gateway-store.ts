import { create } from "zustand";
import { GatewayClient } from "@/services/gateway-client";
import type {
  GatewayConnection,
  ConnectionStatus,
  BuiltinGatewayStatus,
} from "@/types/gateway";

const BUILTIN_GATEWAY_ID = "builtin";
const STORAGE_KEY = "mhclaw-gateways";

interface GatewayState {
  /** 所有 Gateway 连接（内置 + 远程） */
  gateways: GatewayConnection[];
  /** 当前激活的 Gateway ID */
  activeId: string | null;
  /** 活跃的 WebSocket 客户端 */
  clients: Map<string, GatewayClient>;
  /** 内置 Gateway 状态（仅 Electron） */
  builtinStatus: BuiltinGatewayStatus;

  /** 初始化：加载持久化的远程连接 + 设置内置连接 */
  init: () => void;
  /** 切换到指定 Gateway */
  switchTo: (id: string) => void;
  /** 添加远程 Gateway */
  addRemote: (name: string, url: string, token?: string) => void;
  /** 移除远程 Gateway */
  removeRemote: (id: string) => void;
  /** 更新连接状态 */
  updateStatus: (id: string, status: ConnectionStatus) => void;
  /** 更新内置 Gateway 状态 */
  updateBuiltinStatus: (status: BuiltinGatewayStatus) => void;
  /** 获取当前活跃的 client */
  getActiveClient: () => GatewayClient | null;
  /** 连接到指定 Gateway */
  connectTo: (id: string) => void;
  /** 断开指定 Gateway */
  disconnectFrom: (id: string) => void;
}

export const useGatewayStore = create<GatewayState>((set, get) => ({
  gateways: [],
  activeId: null,
  clients: new Map(),
  builtinStatus: { state: "stopped" },

  init: () => {
    const gateways: GatewayConnection[] = [];

    // 内置虾（Electron 环境下默认添加）
    const isElectron = !!window.cjtClaw?.isElectron;
    if (isElectron) {
      gateways.push({
        id: BUILTIN_GATEWAY_ID,
        name: "本地 Gateway",
        url: "ws://127.0.0.1:40789",
        type: "builtin",
        status: "disconnected",
      });

      // 监听内置 Gateway 状态
      window.cjtClaw!.gateway.onStatusChange((status) => {
        get().updateBuiltinStatus(status);
      });
    }

    // 从 localStorage 加载远程虾
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const remotes = JSON.parse(saved) as GatewayConnection[];
        for (const r of remotes) {
          gateways.push({ ...r, status: "disconnected" });
        }
      }
    } catch {
      // ignore
    }

    set({
      gateways,
      activeId: gateways.length > 0 ? gateways[0].id : null,
    });

    // 自动连接内置 Gateway(轮询等待 Gateway 启动后读取 token 再连接)
    // 窗口拉到 3 分钟:Windows 慢机 / 杀毒扫描场景下 Gateway 启动可达 100 秒+,
    // 原来 30 秒轮询会错过 token 出现的时刻,导致 WS 无 token 连接被拒。
    if (isElectron) {
      const tryConnect = async (attempt = 0) => {
        try {
          const status = await window.cjtClaw!.gateway.getStatus();
          if (status.token) {
            set((state) => ({
              gateways: state.gateways.map((g) =>
                g.id === BUILTIN_GATEWAY_ID ? { ...g, token: status.token } : g
              ),
            }));
            get().connectTo(BUILTIN_GATEWAY_ID);
            return;
          }
        } catch {
          // Gateway 还没启动
        }
        // 最多重试 120 次(共约 3 分钟),兼容 Windows 慢机
        if (attempt < 120) {
          setTimeout(() => tryConnect(attempt + 1), 1500);
        } else {
          // 超时仍尝试连接一次(不带 token 的情况 Gateway 会拒,但至少走到错误路径)
          get().connectTo(BUILTIN_GATEWAY_ID);
        }
      };
      setTimeout(() => tryConnect(), 2000);

      // 另起一路常驻监听:token 晚到时也能自动重连。
      // Gateway 启动非常慢或中途被 kill 重启时,gw.token 可能一直是 undefined,
      // 定时对比一下最新 token 跟当前 store 里的 token,不一致就重连。
      setInterval(async () => {
        try {
          const status = await window.cjtClaw!.gateway.getStatus();
          if (!status.token) return;
          const gw = get().gateways.find((g) => g.id === BUILTIN_GATEWAY_ID);
          if (!gw || gw.token === status.token) return;
          set((state) => ({
            gateways: state.gateways.map((g) =>
              g.id === BUILTIN_GATEWAY_ID ? { ...g, token: status.token } : g
            ),
          }));
          get().connectTo(BUILTIN_GATEWAY_ID);
        } catch {
          /* noop */
        }
      }, 5000);
    }
  },

  switchTo: (id) => {
    set({ activeId: id });
  },

  addRemote: (name, url, token) => {
    const id = `remote-${Date.now()}`;
    const connection: GatewayConnection = {
      id,
      name,
      url,
      token,
      type: "remote",
      status: "disconnected",
    };

    set((state) => {
      const gateways = [...state.gateways, connection];
      persistRemotes(gateways);
      return { gateways };
    });
  },

  removeRemote: (id) => {
    const { clients } = get();
    // 断开连接
    const client = clients.get(id);
    if (client) {
      client.disconnect();
      clients.delete(id);
    }

    set((state) => {
      const gateways = state.gateways.filter((g) => g.id !== id);
      persistRemotes(gateways);
      const activeId =
        state.activeId === id
          ? gateways[0]?.id ?? null
          : state.activeId;
      return { gateways, activeId };
    });
  },

  updateStatus: (id, status) => {
    set((state) => ({
      gateways: state.gateways.map((g) =>
        g.id === id ? { ...g, status } : g
      ),
    }));
  },

  updateBuiltinStatus: (status) => {
    set({ builtinStatus: status });
    // Gateway 启动后才把 token 写进 config,主进程会在 token 出现时再推一次状态。
    // 这里把最新 token 同步到 gw 对象,下次 connect 自带 token;已连接的也触发重连。
    const next = status as { token?: string };
    if (next.token) {
      const { gateways } = get();
      const gw = gateways.find((g) => g.id === BUILTIN_GATEWAY_ID);
      if (gw && gw.token !== next.token) {
        set((state) => ({
          gateways: state.gateways.map((g) =>
            g.id === BUILTIN_GATEWAY_ID ? { ...g, token: next.token } : g
          ),
        }));
        get().connectTo(BUILTIN_GATEWAY_ID);
      }
    }
  },

  getActiveClient: () => {
    const { activeId, clients } = get();
    if (!activeId) return null;
    return clients.get(activeId) ?? null;
  },

  connectTo: (id) => {
    const { gateways, clients, updateStatus } = get();
    const gw = gateways.find((g) => g.id === id);
    if (!gw) return;

    // 已有连接先断开
    const existing = clients.get(id);
    if (existing) {
      existing.disconnect();
    }

    updateStatus(id, "connecting");

    const client = new GatewayClient(gw.url, gw.token);
    client.onConnectionChange = (connected) => {
      updateStatus(id, connected ? "connected" : "disconnected");
    };
    client.connect();

    clients.set(id, client);
    set({ clients: new Map(clients) });
  },

  disconnectFrom: (id) => {
    const { clients } = get();
    const client = clients.get(id);
    if (client) {
      client.disconnect();
      clients.delete(id);
      set({ clients: new Map(clients) });
    }
    get().updateStatus(id, "disconnected");
  },
}));

/** 持久化远程连接到 localStorage */
function persistRemotes(gateways: GatewayConnection[]) {
  const remotes = gateways
    .filter((g) => g.type === "remote")
    .map(({ id, name, url, token, type }) => ({ id, name, url, token, type }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(remotes));
}
