import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * 顶层 ErrorBoundary：渲染异常时显示错误而不是白屏。
 * 不要依赖任何 shadcn/tailwind 组件，直接 inline 样式，
 * 避免级联失败导致连错误页也白屏。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info });
    console.error("[mhclaw] Unhandled render error:", error);
    console.error("[mhclaw] Component stack:", info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const { error, info } = this.state;
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          padding: "32px 40px",
          overflow: "auto",
          fontFamily:
            "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif",
          background: "#fafafa",
          color: "#111",
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
          ⚠ mhclaw 渲染出错
        </h1>
        <p style={{ color: "#666", marginTop: 6 }}>
          为了不让整个界面变白屏，已显示此错误页。修好后或刷新窗口（Cmd+R）即可恢复。
        </p>

        <h2 style={{ fontSize: 14, marginTop: 24, marginBottom: 6 }}>
          错误信息
        </h2>
        <pre
          style={{
            background: "#fff",
            border: "1px solid #eee",
            borderRadius: 8,
            padding: 12,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            margin: 0,
            color: "#b91c1c",
          }}
        >
          {error.name}: {error.message}
        </pre>

        {error.stack && (
          <>
            <h2 style={{ fontSize: 14, marginTop: 16, marginBottom: 6 }}>
              Stack
            </h2>
            <pre
              style={{
                background: "#fff",
                border: "1px solid #eee",
                borderRadius: 8,
                padding: 12,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                margin: 0,
                fontSize: 11,
                color: "#333",
                maxHeight: 320,
                overflow: "auto",
              }}
            >
              {error.stack}
            </pre>
          </>
        )}

        {info?.componentStack && (
          <>
            <h2 style={{ fontSize: 14, marginTop: 16, marginBottom: 6 }}>
              Component Stack
            </h2>
            <pre
              style={{
                background: "#fff",
                border: "1px solid #eee",
                borderRadius: 8,
                padding: 12,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                margin: 0,
                fontSize: 11,
                color: "#555",
                maxHeight: 240,
                overflow: "auto",
              }}
            >
              {info.componentStack}
            </pre>
          </>
        )}

        <div style={{ marginTop: 24, display: "flex", gap: 8 }}>
          <button
            onClick={() => location.reload()}
            style={{
              background: "#111",
              color: "#fff",
              border: 0,
              borderRadius: 6,
              padding: "8px 14px",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            刷新窗口
          </button>
          <button
            onClick={() => this.setState({ error: null, info: null })}
            style={{
              background: "#fff",
              color: "#111",
              border: "1px solid #ddd",
              borderRadius: 6,
              padding: "8px 14px",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            尝试继续
          </button>
        </div>
      </div>
    );
  }
}
