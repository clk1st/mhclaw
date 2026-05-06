/**
 * 简单 LCS 行级 diff,无外部依赖。
 *
 * 经典 O(n*m) DP,对小到中等文件(< 数千行)足够。
 * 大文件(几十万行)再切到 Myers 算法或外部库。
 */
export type DiffKind = "common" | "add" | "del";

export interface DiffLine {
  kind: DiffKind;
  line: string;
  /** 原始行号(1-based),仅 common / del 有 */
  oldLineNo?: number;
  /** 新版本行号(1-based),仅 common / add 有 */
  newLineNo?: number;
}

export function diffLines(baseline: string, current: string): DiffLine[] {
  const A = baseline.split("\n");
  const B = current.split("\n");
  const m = A.length;
  const n = B.length;

  // dp[i][j] = LCS 长度,从 (i,j) 到末尾
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (A[i] === B[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) {
      out.push({ kind: "common", line: A[i], oldLineNo: i + 1, newLineNo: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "del", line: A[i], oldLineNo: i + 1 });
      i++;
    } else {
      out.push({ kind: "add", line: B[j], newLineNo: j + 1 });
      j++;
    }
  }
  while (i < m) out.push({ kind: "del", line: A[i], oldLineNo: ++i });
  while (j < n) out.push({ kind: "add", line: B[j], newLineNo: ++j });
  return out;
}

/** 统计 +/-/共同行数,UI badge 用 */
export function diffStats(lines: DiffLine[]): { adds: number; dels: number; common: number } {
  let adds = 0;
  let dels = 0;
  let common = 0;
  for (const l of lines) {
    if (l.kind === "add") adds++;
    else if (l.kind === "del") dels++;
    else common++;
  }
  return { adds, dels, common };
}
