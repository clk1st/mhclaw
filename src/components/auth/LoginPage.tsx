import { FormEvent, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { ApiError } from "@/lib/api";
import {
  DeviceLoginFailed,
  startDeviceLogin,
  type DeviceCodeResp,
  type DeviceLoginFlow,
} from "@/lib/device-login";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/brand/Logo";
import { cn } from "@/lib/utils";

type View = "password" | "browser-waiting";

const REGISTER_URL = "https://github.com/clk1st/mhclaw#login";

function formatUserCode(code: string): string {
  const c = code.toUpperCase();
  if (c.length <= 4) return c;
  return `${c.slice(0, 4)}-${c.slice(4, 8)}`;
}

function getClientName(): string {
  try {
    const os = /Mac/i.test(navigator.platform)
      ? "macOS"
      : /Win/i.test(navigator.platform)
        ? "Windows"
        : /Linux/i.test(navigator.platform)
          ? "Linux"
          : navigator.platform;
    return `mhclaw desktop · ${os}`;
  } catch {
    return "mhclaw desktop";
  }
}

/**
 * 登录页(全屏)。
 * 主路径:邮箱密码登录。
 * 备选:底部小字"用浏览器登录"走 Device Flow。
 * 注册:统一跳网页端。
 */
export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const applyDeviceToken = useAuthStore((s) => s.applyDeviceToken);

  const [view, setView] = useState<View>("password");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [deviceInfo, setDeviceInfo] = useState<DeviceCodeResp | null>(null);
  const flowRef = useRef<DeviceLoginFlow | null>(null);

  useEffect(() => setError(null), [view]);
  useEffect(() => () => flowRef.current?.cancel(), []);

  // deep link 到达就唤醒当前 device flow,触发立即轮询(无需等 5s)
  useEffect(() => {
    return window.cjtClaw?.auth?.onDeepLink?.((url) => {
      try {
        const u = new URL(url);
        // mhclaw://auth/approved?code=USER_CODE
        if (
          u.protocol === "mhclaw:" &&
          (u.hostname === "auth" || u.host === "auth")
        ) {
          flowRef.current?.wake();
        }
      } catch {
        // 无效 URL,忽略
      }
    });
  }, []);

  const openBrowser = (url: string) => {
    window.cjtClaw?.system
      ?.openExternal(url)
      .catch(() => window.open(url, "_blank"));
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) return setError("请填写邮箱和密码");
    if (password.length < 6) return setError("密码至少 6 位");
    setBusy(true);
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || `请求失败 (${err.status})`);
      } else {
        setError(err instanceof Error ? err.message : "未知错误");
      }
    } finally {
      setBusy(false);
    }
  };

  const startBrowserLogin = async () => {
    setError(null);
    setBusy(true);
    setView("browser-waiting");
    setDeviceInfo(null);

    flowRef.current?.cancel();
    const flow = startDeviceLogin({
      clientName: getClientName(),
      onStarted: (info) => {
        setDeviceInfo(info);
        openBrowser(info.verification_uri_complete);
      },
    });
    flowRef.current = flow;

    try {
      const token = await flow.tokenPromise;
      await applyDeviceToken(token);
    } catch (err) {
      if (err instanceof DeviceLoginFailed) {
        if (err.kind !== "cancelled") {
          setError(err.message);
          setView("password");
        }
      } else {
        setError(err instanceof Error ? err.message : "未知错误");
        setView("password");
      }
    } finally {
      setBusy(false);
      flowRef.current = null;
    }
  };

  const cancelBrowserLogin = () => {
    flowRef.current?.cancel();
    flowRef.current = null;
    setView("password");
    setBusy(false);
    setDeviceInfo(null);
  };

  return (
    <div className="relative flex h-full min-h-screen w-full items-center justify-center px-6 app-drag">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-32 top-1/4 h-[480px] w-[480px] rounded-full bg-brand-gradient opacity-[0.18] blur-[120px]" />
        <div className="absolute -right-32 bottom-1/4 h-[420px] w-[420px] rounded-full bg-brand-gradient opacity-[0.14] blur-[120px]" />
      </div>

      <div className="relative w-full max-w-sm app-no-drag">
        <div className="mb-8 text-center">
          {/* IconGradient 自带 drop-shadow(按 alpha 跟形状走),不再叠 box-shadow,
              否则会把 squircle 外的 4 个透明角照成白方框 */}
          <Logo size={56} className="mx-auto mb-3" />
          <h1 className="text-2xl font-semibold tracking-tight">
            <span className="text-brand-gradient">mhclaw</span>
          </h1>
          <p className="mt-1.5 text-xs text-muted-foreground">
            让想法落地为现实 · AI 工作台
          </p>
        </div>

        <div className="glass-card rounded-2xl p-6">
          {view === "password" && (
            <form onSubmit={submitPassword} className="flex flex-col gap-3">
              <Field label="邮箱">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoFocus
                  required
                />
              </Field>
              <Field label="密码">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="至少 6 位"
                  autoComplete="current-password"
                  minLength={6}
                  required
                />
              </Field>

              {error && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}

              <Button type="submit" disabled={busy} className="mt-1 h-10 w-full">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                登录
              </Button>

              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setError(null);
                  setBusy(true);
                  try {
                    await login("admin", "123456");
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "演示登录失败");
                  } finally {
                    setBusy(false);
                  }
                }}
                className="rounded-md border border-dashed border-border/60 px-3 py-2 text-[11px] text-muted-foreground transition hover:border-foreground/40 hover:text-foreground disabled:opacity-50"
              >
                使用演示账号 · admin / 123456
              </button>

              <div className="mt-3 flex items-center justify-between border-t border-black/[0.05] pt-3 text-[11px] text-muted-foreground dark:border-white/[0.06]">
                <button
                  type="button"
                  onClick={startBrowserLogin}
                  className="hover:text-foreground hover:underline"
                >
                  用浏览器登录
                </button>
                <button
                  type="button"
                  onClick={() => openBrowser(REGISTER_URL)}
                  className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                >
                  注册
                  <ExternalLink className="h-3 w-3" />
                </button>
              </div>
            </form>
          )}

          {view === "browser-waiting" && (
            <div className="flex flex-col gap-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
              <div>
                <h2 className="text-base font-semibold">请在浏览器完成授权</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  确认以下授权码与浏览器中一致
                </p>
              </div>

              <div
                className={cn(
                  "mx-auto rounded-xl border px-5 py-3 font-mono text-2xl font-bold tracking-[0.3em]",
                  deviceInfo
                    ? "border-primary/30 bg-primary/5 text-foreground"
                    : "border-dashed border-border text-muted-foreground",
                )}
              >
                {deviceInfo ? formatUserCode(deviceInfo.user_code) : "····-····"}
              </div>

              <button
                type="button"
                onClick={() =>
                  deviceInfo &&
                  openBrowser(deviceInfo.verification_uri_complete)
                }
                disabled={!deviceInfo}
                className="inline-flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
              >
                <RefreshCw className="h-3 w-3" />
                重新打开浏览器
              </button>

              <Button
                type="button"
                variant="ghost"
                onClick={cancelBrowserLogin}
                className="mt-2 h-9 w-full justify-center text-xs"
              >
                取消
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
