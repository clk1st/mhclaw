/**
 * mammoth 主包自带 lib/index.js 的类型,但没给 mammoth.browser(UMD 浏览器 bundle)
 * 加声明。我们走 browser bundle 是因为它内置 jszip / xmldom 的浏览器实现,
 * 不会把 Node 的 fs / path 牵进 Vite 构建。
 * 这里只声明我们实际用到的 convertToHtml。
 */
declare module "mammoth/mammoth.browser" {
  export function convertToHtml(opts: {
    arrayBuffer: ArrayBuffer;
  }): Promise<{ value: string; messages: unknown[] }>;
}
