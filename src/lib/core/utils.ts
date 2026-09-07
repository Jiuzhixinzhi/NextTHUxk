// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 通用工具
// ═══════════════════════════════════════════════════════════════

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** 课序号归一：教务各页前导零不一致（志愿统计 "1" vs 选课页 "01"） */
export const normSeq = (s: string | number | undefined | null) => String(parseInt(String(s ?? ''), 10) || 0);

/** 复合键：code + 归一课序 */
export const keyOf = (code: string | number, seq: string | number | undefined | null) =>
  String(code) + '_' + normSeq(seq);

/** 原键（不归一，用于源数据寻址） */
export const rawKeyOf = (code: string | number, seq: string | number | undefined | null) =>
  String(code) + '_' + String(seq ?? '0');

/** 固定并发度跑完一批异步任务 */
export async function runPool<T>(items: T[], concurrency: number, fn: (item: T, idx: number) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]!, idx);
    }
  });
  await Promise.all(workers);
}

/** trailing debounce */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return function (this: unknown, ...args: A) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

// 小写化缓存（校名/课名种类有限，无泄漏风险）
const _lowerCache = new Map<string, string>();
export const lc = (s: string | undefined | null): string => {
  if (!s) return '';
  let v = _lowerCache.get(s);
  if (v === undefined) {
    v = s.toLowerCase();
    _lowerCache.set(s, v);
  }
  return v;
};

/** 预览/控制台时间格式：M/D HH:MM */
export const fmtTime = (ts?: number) => {
  if (!ts) return '无';
  const d = new Date(ts);
  return d.getMonth() + 1 + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
};
