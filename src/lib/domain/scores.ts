// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 教务评教分数（校评）纯函数
// 端点数据 cm=xgpg_qbkcmycdzbData（全校课程评教成绩单分布，满分 7）：
//   行含 kch/jsm → 粒度为 课号×授课教师（同课不同师分数不同）：
//   avg = Σ(i×fsi)/Σfsi · count = Σfsi · 检索键 = kch + 教师token集合
// ═══════════════════════════════════════════════════════════════
import type { ScoreEntry } from './types';

/** 缓存结构版本（结构演进时递增，不匹配即弃缓存重拉） */
export const SCORE_VER = 2;

/** 学期评教 slim 缓存（存储键 K.semScore；学期绑定：换学期即失效重拉） */
export interface SemScoreCache {
  v: number;
  sem: string;
  ts: number;
  /** scoreKey(kch, 教师) → { a: 均分(7分制) · n: 参评人数 } */
  map: Record<string, { a: number; n: number }>;
}

/** 教师归一化 token（NFKC + 分隔符切分）——与社区点评同款口径 */
export function normTeacherTokens(s: string): string[] {
  return String(s || '')
    .normalize('NFKC')
    .split(/[,，、;；/\s]+/)
    .map(x => x.trim())
    .filter(Boolean);
}

/** 评教检索键：课号 + 教师token集合（排序拼接，顺序无关） */
export function scoreKey(kch: string, teacher: string): string {
  return kch.trim() + '\u0001' + normTeacherTokens(teacher).slice().sort().join('\u0002');
}

/** 单行 fs1..fs7 频数 → { avg, count }；全 0 / 缺字段 / 非法行 → null（不入表） */
export function scoreOfRow(row: Record<string, unknown> | null | undefined): ScoreEntry | null {
  let sum = 0;
  let count = 0;
  for (let i = 1; i <= 7; i++) {
    const f = Number(row ? row['fs' + i] : 0) || 0;
    sum += f * i;
    count += f;
  }
  if (count <= 0) return null;
  return { avg: Math.round((sum / count) * 100) / 100, count };
}

/** 全量评教 JSON（{ total, rows: [...] }）→ slim 缓存（纯函数；同键多行按人数加权合并） */
export function slimScores(raw: unknown, sem: string): SemScoreCache {
  const rows = raw && typeof raw === 'object' ? (raw as { rows?: unknown }).rows : null;
  const map: SemScoreCache['map'] = {};
  if (Array.isArray(rows)) {
    for (const it of rows) {
      if (!it || typeof it !== 'object') continue;
      const row = it as Record<string, unknown>;
      const kch = String(row.kch || '').trim();
      if (!kch) continue;
      const e = scoreOfRow(row);
      if (!e) continue;
      const key = scoreKey(kch, String(row.jsm || ''));
      const prev = map[key];
      if (prev) {
        // 同键多行（同课同师多条上报）：按人数加权合并
        const n = prev.n + e.count;
        map[key] = { a: Math.round(((prev.a * prev.n + e.avg * e.count) / n) * 100) / 100, n };
      } else {
        map[key] = { a: e.avg, n: e.count };
      }
    }
  }
  return { v: SCORE_VER, sem, ts: Date.now(), map };
}

/** 7 分制档位（与社区 5 分制徽章同色系：绿/蓝/橙/红） */
export type ScoreLv = 'lv-hi' | 'lv-good' | 'lv-mid' | 'lv-bad';
export function scoreLv(avg: number): ScoreLv {
  return avg >= 6.5 ? 'lv-hi' : avg >= 5.5 ? 'lv-good' : avg >= 4 ? 'lv-mid' : 'lv-bad';
}
