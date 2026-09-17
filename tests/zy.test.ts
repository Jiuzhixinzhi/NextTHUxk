// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 志愿号分配纯核测试（B3 守门）
// 锁死：server 权威 > confirmed 缓存 > 一级课表的优先级；课序前导零归一；
// 手填 confirmed:true（v2 语义恢复）；排队默认 3 保持可覆盖。
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { applyZyAnswers, applyZyDefaults, assignZy, type LevelInfo, type ZyCacheMap } from '../src/lib/domain/zy';
import type { Course } from '../src/lib/domain/types';

const c = (v: Record<string, unknown> = {}): Course => ({ code: '10720011', seq: '01', name: '甲课', ...v }) as unknown as Course;

const level = (v: Record<string, LevelInfo> = {}): Record<string, LevelInfo> => v;

const boom = async (): Promise<Record<string, LevelInfo>> => {
  throw new Error('levelMap 不应被拉取');
};

describe('assignZy（分配优先级）', () => {
  it('server 行带 zy：权威落行并写缓存（confirmed:true）', async () => {
    const cache: ZyCacheMap = {};
    const row = c({ zy: 0 });
    const res = await assignZy([row], { '10720011_1': c({ zy: 2, typeCode: '008', typeLabel: '限选' }) }, cache, boom);
    expect(row).toMatchObject({ zy: 2, typeCode: '008', typeLabel: '限选', selected: true });
    expect(cache['10720011_1']).toEqual({ zy: 2, typeCode: '008', typeLabel: '限选', confirmed: true });
    expect(res.cacheUpdated).toBe(true);
    expect(res.missingZy).toHaveLength(0);
  });

  it('课序前导零归一：课行 01 命中 selMap 键 1（历史 Bug 守门）', async () => {
    const row = c({ seq: '01', zy: 0 });
    await assignZy([row], { '10720011_1': c({ seq: '1', zy: 1 }) }, {}, boom);
    expect(row.zy).toBe(1);
  });

  it('confirmed 缓存命中：静默复用，不拉一级课表、不入 missingZy', async () => {
    const row = c({ zy: 0 });
    const cache: ZyCacheMap = { '10720011_1': { zy: 3, typeCode: '007', typeLabel: '任选', confirmed: true } };
    const res = await assignZy([row], { '10720011_1': c({ zy: 0 }) }, cache, boom);
    expect(row).toMatchObject({ zy: 3, typeCode: '007', typeLabel: '任选' });
    expect(res.missingZy).toHaveLength(0);
    expect(res.cacheUpdated).toBe(false);
  });

  it('server 无 zy 且缓存未确认：查一级课表补类型，行入 missingZy、zy 保持 0', async () => {
    const row = c({ zy: 0 });
    const cache: ZyCacheMap = { '10720011_1': { zy: 3, typeCode: '', typeLabel: '', confirmed: false } };
    const res = await assignZy([row], { '10720011_1': c({ zy: 0, typeCode: '', typeLabel: '' }) }, cache, () =>
      Promise.resolve(level({ '10720011_1': { typeCode: '006', typeLabel: '必修', attr: '必修' } })),
    );
    expect(row).toMatchObject({ typeCode: '006', typeLabel: '必修', zy: 3 });
    expect(res.missingZy).toEqual([row]);
  });

  it('未确认缓存无 zy：levelMap 也无此课时类型退回 server 行拼写、zy=0', async () => {
    const row = c({ zy: 0 });
    const res = await assignZy([row], { '10720011_1': c({ zy: 0, typeCode: '', typeLabel: '' }) }, {}, () => Promise.resolve(level()));
    expect(row).toMatchObject({ zy: 0, typeCode: '', typeLabel: '' });
    expect(res.missingZy).toEqual([row]);
  });

  it('非已选行：清 zy/类型（未入 selMap 的池行不保留志愿号）', async () => {
    const row = c({ zy: 2, typeCode: '008', typeLabel: '限选', selected: true });
    await assignZy([row], {}, {}, boom);
    expect(row).toMatchObject({ zy: 0, typeCode: '', typeLabel: '', selected: false });
  });

  it('levelMap 惰性取一次：多个缺号行只触发一次拉取', async () => {
    let calls = 0;
    const get: () => Promise<Record<string, LevelInfo>> = async () => {
      calls++;
      return level();
    };
    await assignZy([c(), c({ code: '10720012' })], { '10720011_1': c({ zy: 0 }), '10720012_1': c({ zy: 0 }) }, {}, get);
    expect(calls).toBe(1);
  });
});

describe('applyZyDefaults / applyZyAnswers（缺号兜底）', () => {
  it('排队默认：zy=3 且 confirmed:false（教务正式数据到货可覆盖）', () => {
    const cache: ZyCacheMap = {};
    const rows = [c(), c({ code: '10720012' })];
    expect(applyZyDefaults(rows, cache)).toBe(true);
    expect(rows.every(r => r.zy === 3)).toBe(true);
    expect(cache['10720011_1']!.confirmed).toBe(false);
  });

  it('手填落位：正值写入且 confirmed:true（v2 语义——跨会话不再重复询问）', () => {
    const cache: ZyCacheMap = {};
    const rows = [c(), c({ code: '10720012' })];
    expect(applyZyAnswers(rows, [2, 0], cache)).toBe(true);
    expect(rows[0]!.zy).toBe(2);
    expect(rows[1]!.zy || 0).toBe(0);
    expect(cache['10720011_1']).toMatchObject({ zy: 2, confirmed: true });
    expect(cache['10720012_1']).toBeUndefined();
  });

  it('空缺号列表不产生写入', () => {
    expect(applyZyDefaults([], {})).toBe(false);
    expect(applyZyAnswers([], [1], {})).toBe(false);
  });
});
