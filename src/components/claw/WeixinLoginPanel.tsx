"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Phase = "idle" | "starting" | "waiting-scan" | "success" | "error" | "cancelled";

/**
 * 微信扫码登录:
 *   1. 点"开始扫码" → 主进程 spawn `openclaw channels login --channel openclaw-weixin`
 *   2. 主进程拦截 stdout 里的 qrcodeUrl,推给渲染进程
 *   3. 这里用 qrcode 库把 URL 渲染成 PNG 贴上去
 *   4. CLI 自己轮询登录状态,成功或失败后退出,我们 onDone 收到结果
 */
export function WeixinLoginPanel() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrSourceUrl, setQrSourceUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");
  const unsubsRef = useRef<Array<() => void>>([]);

  const cleanup = () => {
    for (const u of unsubsRef.current) {
      try {
        u();
      } catch {
        /* noop */
      }
    }
    unsubsRef.current = [];
  };

  useEffect(() => () => cleanup(), []);

  const renderQrFromUrl = async (url: string) => {
    try {
      const dataUrl = await QRCode.toDataURL(url, {
        width: 220,
        margin: 1,
        errorCorrectionLevel: "M",
      });
      setQrDataUrl(dataUrl);
      setQrSourceUrl(url);
    } catch (err) {
      console.error("[weixin] render QR failed", err);
      setQrSourceUrl(url);
      setQrDataUrl(null);
    }
  };

  const start = async () => {
    cleanup();
    setPhase("starting");
    setQrDataUrl(null);
    setQrSourceUrl(null);
    setMessage("");

    const api = window.cjtClaw?.weixinLogin;
    if (!api) {
      toast.error("桌面端环境不可用");
      setPhase("error");
      return;
    }

    // 订阅事件
    const offQr = api.onQr(async ({ url }) => {
      setPhase("waiting-scan");
      await renderQrFromUrl(url);
    });
    const offDone = api.onDone(({ ok, code }) => {
      if (ok) {
        setPhase("success");
        toast.success("微信登录成功");
      } else if (code === null) {
        setPhase("cancelled");
      } else {
        setPhase("error");
        setMessage(`CLI 退出码 ${code}`);
      }
    });
    const offLog = api.onLog((chunk) => {
      // 截取关键提示(比如"扫码成功,等待确认")给用户看
      const m = chunk.match(/(扫码[^\n]*|登录成功|连接失败[^\n]*|等待[^\n]*)/);
      if (m) setMessage(m[1].trim());
    });
    unsubsRef.current.push(offQr, offDone, offLog);

    const res = await api.start();
    if (!res.ok) {
      toast.error(res.reason === "already-running" ? "已有进行中的登录" : "启动失败");
      setPhase("error");
    }
  };

  const cancel = async () => {
    await window.cjtClaw?.weixinLogin?.cancel();
    cleanup();
    setPhase("cancelled");
  };

  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-5">
      <div
        className={cn(
          "flex h-[220px] w-[220px] items-center justify-center rounded-lg bg-white",
          phase !== "waiting-scan" && "border border-dashed border-border/60",
        )}
      >
        {phase === "idle" && (
          <div className="px-4 text-center text-xs text-muted-foreground">
            点击「开始扫码」生成二维码
          </div>
        )}
        {phase === "starting" && (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        )}
        {phase === "waiting-scan" && qrDataUrl && (
          <img src={qrDataUrl} alt="微信登录二维码" className="h-full w-full" />
        )}
        {phase === "waiting-scan" && !qrDataUrl && qrSourceUrl && (
          <div className="px-3 text-center text-[11px] text-muted-foreground">
            二维码渲染失败,请用浏览器打开:
            <br />
            <span className="break-all text-foreground">{qrSourceUrl}</span>
          </div>
        )}
        {phase === "success" && (
          <div className="flex flex-col items-center gap-2 text-emerald-600">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-2xl">
              ✓
            </div>
            <span className="text-xs">登录成功</span>
          </div>
        )}
        {phase === "error" && (
          <div className="px-4 text-center text-xs text-destructive">
            登录失败
            {message && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                {message}
              </div>
            )}
          </div>
        )}
        {phase === "cancelled" && (
          <div className="px-4 text-center text-xs text-muted-foreground">
            已取消
          </div>
        )}
      </div>

      <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
        {phase === "waiting-scan"
          ? (message || "用微信扫一扫,然后在手机上确认登录")
          : "仅支持私聊。登录凭证保存在本地,不上传任何服务器。"}
      </p>

      <div className="flex gap-2">
        {phase === "idle" || phase === "error" || phase === "cancelled" ? (
          <Button type="button" size="sm" onClick={start}>
            开始扫码
          </Button>
        ) : null}
        {phase === "waiting-scan" || phase === "starting" ? (
          <>
            <Button type="button" size="sm" variant="ghost" onClick={cancel}>
              取消
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={start}>
              <RefreshCw className="h-3 w-3" />
              换一张
            </Button>
          </>
        ) : null}
        {phase === "success" ? (
          <span className="text-xs text-muted-foreground">
            可以关闭此窗口了
          </span>
        ) : null}
      </div>
    </div>
  );
}
