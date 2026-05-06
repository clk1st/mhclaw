/**
 * Device Authorization Grant 客户端。
 *
 * 典型用法:
 *   const flow = startDeviceLogin({
 *     onStarted: info => {
 *       // 展示 user_code,打开浏览器
 *     },
 *     clientName: "mhclaw desktop · macOS",
 *   });
 *   const token = await flow.tokenPromise;  // 成功
 *   // or flow.cancel() 取消
 */
import { apiFetch, ApiError } from "./api";

export interface DeviceCodeResp {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface TokenResp {
  access_token: string;
  token_type: string;
  expires_in_minutes: number;
}

export type DeviceLoginError =
  | "access_denied"
  | "expired_token"
  | "cancelled"
  | "network_error";

export class DeviceLoginFailed extends Error {
  constructor(public kind: DeviceLoginError, message?: string) {
    super(message || kind);
    this.name = "DeviceLoginFailed";
  }
}

export interface StartDeviceLoginOptions {
  clientName?: string;
  onStarted: (info: DeviceCodeResp) => void;
  /** 授权成功的提示(调用方会拿到 token) */
  onApproved?: (token: TokenResp) => void;
}

export interface DeviceLoginFlow {
  /** 成功得到 token,失败抛 DeviceLoginFailed */
  tokenPromise: Promise<TokenResp>;
  /** 取消轮询(用户关掉页面) */
  cancel: () => void;
  /** 提前唤醒(deep link 回调到达,让轮询立刻试一次而不等 interval) */
  wake: () => void;
}

export function startDeviceLogin(opts: StartDeviceLoginOptions): DeviceLoginFlow {
  let cancelled = false;
  let woken = false;
  const cancel = () => {
    cancelled = true;
  };
  const wake = () => {
    woken = true;
  };

  const run = async (): Promise<TokenResp> => {
    // 1) 拿 device_code
    const info = await apiFetch<DeviceCodeResp>("/api/auth/device/code", {
      method: "POST",
      noAuth: true,
      body: { client_name: opts.clientName ?? "mhclaw desktop" },
    });
    opts.onStarted(info);

    const deadline = Date.now() + info.expires_in * 1000;
    let interval = Math.max(2, info.interval); // 秒

    // 首次先立刻试一次(通常会拿 authorization_pending,但能校验 device_code 有效)
    // 随后按 interval 轮询,期间如果 deep link 唤醒,sleep 立即返回。
    let firstTick = true;
    while (!cancelled) {
      if (Date.now() > deadline) {
        throw new DeviceLoginFailed("expired_token", "授权超时,请重试");
      }
      if (!firstTick) {
        await sleep(
          interval * 1000,
          () => cancelled,
          () => woken,
        );
        if (woken) woken = false;
      }
      firstTick = false;
      if (cancelled) break;

      try {
        // 轮询 API 设计: 还在等就返回 200 + {status: "authorization_pending" |
        // "slow_down"},避免 DevTools 4xx 飘红;真正失败才 4xx(expired/denied)
        const resp = await apiFetch<
          TokenResp | { status: "authorization_pending" | "slow_down" }
        >("/api/auth/device/token", {
          method: "POST",
          noAuth: true,
          body: { device_code: info.device_code },
        });
        if ("access_token" in resp) {
          opts.onApproved?.(resp);
          return resp;
        }
        if (resp.status === "slow_down") interval += 5;
        // authorization_pending / slow_down: 继续轮询
      } catch (err) {
        if (!(err instanceof ApiError)) {
          throw new DeviceLoginFailed("network_error", "网络错误,请重试");
        }
        const code = err.message;
        if (code === "access_denied") {
          throw new DeviceLoginFailed("access_denied", "已被拒绝");
        }
        if (code === "expired_token") {
          throw new DeviceLoginFailed("expired_token", "授权码已过期");
        }
        throw new DeviceLoginFailed("network_error", err.message);
      }
    }

    throw new DeviceLoginFailed("cancelled", "已取消");
  };

  return { tokenPromise: run(), cancel, wake };
}

function sleep(
  ms: number,
  isCancelled: () => boolean,
  isWoken?: () => boolean,
): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (
        isCancelled() ||
        (isWoken && isWoken()) ||
        Date.now() - start >= ms
      ) {
        resolve();
        return;
      }
      setTimeout(tick, 150);
    };
    tick();
  });
}
