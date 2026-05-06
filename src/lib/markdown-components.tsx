import type { Components } from "react-markdown";

/**
 * ReactMarkdown 公用 components 覆盖。
 *
 * 为什么不用默认 <a>:ReactMarkdown 输出原生 <a href>,在 Electron webContents
 * 里一点就把整页导航走(mhclaw 变成目标网页)。统一拦掉,用 shell.openExternal
 * 在系统浏览器打开。
 *
 * 所有用到 <ReactMarkdown> 的地方都应传这份 components(或自己的 spread)。
 */
export const markdownLinkComponents: Components = {
  a: ({ href, children, ...rest }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => {
        if (!href) return;
        e.preventDefault();
        window.cjtClaw?.system
          ?.openExternal(href)
          .catch(() => window.open(href, "_blank"));
      }}
      {...rest}
    >
      {children}
    </a>
  ),
};
