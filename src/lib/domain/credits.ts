// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 学分解析（纯函数）
// 本校课（纯数字课号）学分恒取课号末位（清华课号末位即学分；上游 PR #50 同款）；
// 外校前缀课号（PK/GPK/BW…）无末位语义 → 用表内解析值兜底。
// ═══════════════════════════════════════════════════════════════

/** 课号末位信用分：纯数字课号 = 末位数字；否则回退 fallback（表内解析值） */
export function creditsOf(code: string | undefined | null, fallback?: number): number {
  const c = String(code ?? '');
  if (/^\d+$/.test(c)) return parseInt(c.slice(-1), 10) || 0;
  return fallback || 0;
}
