// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 教务评教分数（校评）纯函数测试
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { normTeacherTokens, scoreKey, scoreLv, scoreOfRow, slimScores } from '../src/lib/domain/scores';

describe('scoreOfRow（fs1..fs7 频数 → 均分/人数）', () => {
  it('示例行：仅 fs7=13 → 均分 7 · 13 人', () => {
    const e = scoreOfRow({ fs1: 0, fs2: 0, fs3: 0, fs4: 0, fs5: 0, fs6: 0, fs7: 13 });
    expect(e).toEqual({ avg: 7, count: 13 });
  });

  it('混合频数加权平均（Σi×fsi/Σfsi）', () => {
    const e = scoreOfRow({ fs5: 1, fs6: 1, fs7: 2 });
    expect(e).toEqual({ avg: 6.25, count: 4 });
  });

  it('全 0 / 缺字段 / 空行 → null', () => {
    expect(scoreOfRow({ fs1: 0, fs2: 0, fs3: 0, fs4: 0, fs5: 0, fs6: 0, fs7: 0 })).toBeNull();
    expect(scoreOfRow({})).toBeNull();
    expect(scoreOfRow(null)).toBeNull();
    expect(scoreOfRow(undefined)).toBeNull();
  });

  it('字符串数字可解析、非数值/字段兜底 0', () => {
    expect(scoreOfRow({ fs6: '3', fs7: null, fs1: 'x' })).toEqual({ avg: 6, count: 3 });
  });

  it('均分保留 2 位小数', () => {
    expect(scoreOfRow({ fs6: 1, fs7: 1 })).toEqual({ avg: 6.5, count: 2 });
    expect(scoreOfRow({ fs5: 2, fs6: 1, fs7: 1 })).toEqual({ avg: 5.75, count: 4 });
  });
});

describe('scoreKey（课号×教师检索键）', () => {
  it('教师 token 顺序无关、分隔符归一', () => {
    expect(scoreKey('30020912', '汤彬')).toBe('30020912\u0001汤彬');
    expect(scoreKey('1', '张三, 李四')).toBe(scoreKey('1', '李四、张三'));
    expect(scoreKey('1', '张三；李四')).toBe(scoreKey('1', '张三/李四'));
  });

  it('空教师 → 空 token 集（键仍唯一）', () => {
    expect(scoreKey('1', '')).toBe('1\u0001');
    expect(scoreKey('1', '  ')).toBe('1\u0001');
  });

  it('NFKC 归一 + 完整 token 集合（子集不误命中）', () => {
    expect(normTeacherTokens(' 张三 ／ 王五 ')).toEqual(['张三', '王五']);
    expect(scoreKey('1', '张三, 王五')).not.toBe(scoreKey('1', '张三'));
  });
});

describe('slimScores', () => {
  it('同课不同教师 → 不同键（各自分数独立）', () => {
    const cache = slimScores(
      {
        total: 2,
        rows: [
          { kch: '1', jsm: '张三', fs7: 10 },
          { kch: '1', jsm: '李四', fs5: 4 },
        ],
      },
      '2026-2027-1',
    );
    expect(Object.keys(cache.map)).toHaveLength(2);
    expect(cache.map[scoreKey('1', '张三')]).toEqual({ a: 7, n: 10 });
    expect(cache.map[scoreKey('1', '李四')]).toEqual({ a: 5, n: 4 });
  });

  it('同课同师多行 → 按人数加权合并', () => {
    const cache = slimScores(
      {
        rows: [
          { kch: '1', jsm: '张三', fs6: 1 },
          { kch: '1', jsm: '张三', fs7: 1 },
        ],
      },
      's',
    );
    expect(Object.keys(cache.map)).toHaveLength(1);
    expect(cache.map[scoreKey('1', '张三')]).toEqual({ a: 6.5, n: 2 });
  });

  it('联合授课行（jsm 含多师）整体为键；缺 kch / 全 0 行剔除；带版本与学期', () => {
    const cache = slimScores(
      {
        total: 3,
        rows: [
          { kch: '30020912', kcm: 'STEAM美育基础', jsm: '汤彬', fs7: 13, kkdwmc: '建筑学院' },
          { kch: '2', jsm: '张三,李四', fs1: 1 },
          { kch: '', fs1: 1 },
          { kch: '10000001' },
        ],
      },
      '2026-2027-1',
    );
    expect(cache.v).toBe(2);
    expect(cache.sem).toBe('2026-2027-1');
    expect(Object.keys(cache.map)).toHaveLength(2);
    expect(cache.map[scoreKey('30020912', '汤彬')]).toEqual({ a: 7, n: 13 });
    expect(cache.map[scoreKey('2', '张三,李四')]).toEqual({ a: 1, n: 1 });
  });

  it('非对象 / 无 rows / 坏行 → 空表', () => {
    expect(slimScores(null, 'x').map).toEqual({});
    expect(slimScores('bad', 'x').map).toEqual({});
    expect(slimScores({}, 'x').map).toEqual({});
    expect(slimScores({ rows: [null, 'x', 1] }, 'x').map).toEqual({});
  });
});

describe('scoreLv（7 分制档位）', () => {
  it('阈值边界：≥6.5 hi / ≥5.5 good / ≥4 mid / <4 bad', () => {
    expect(scoreLv(7)).toBe('lv-hi');
    expect(scoreLv(6.5)).toBe('lv-hi');
    expect(scoreLv(6.49)).toBe('lv-good');
    expect(scoreLv(5.5)).toBe('lv-good');
    expect(scoreLv(4)).toBe('lv-mid');
    expect(scoreLv(3.9)).toBe('lv-bad');
  });
});
