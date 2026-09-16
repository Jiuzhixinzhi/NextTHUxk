// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 志愿院系拉取判定测试（v1.5.0 窗口语义守门）
// 背景：v3 改写期把「过期则拉」整式取反（fresh 双重否定），导致检查点同步
// 不刷新过期院系、同窗口反复重拉。此文件锁死正向判定方向。
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { deptsToFetch } from '../src/lib/api/volunteers';
import type { Course } from '../src/lib/domain/types';

/** 课号中段 = 院系码（042 数学系）：20420011 → '042' */
const math = (code = '20420011'): Course => ({ code, seq: '1', name: '数学分析' });
/** 课号中段非白名单（006 空缺）且无 department → 院系不可解析 */
const unknown = (): Course => ({ code: '20060011', seq: '1', name: '未名课' });

const never = () => false;
const always = () => true;

describe('deptsToFetch 院系拉取判定', () => {
  it('未见院系（无时间戳）→ 拉', () => {
    expect(deptsToFetch([math()], {}, never)).toEqual(['042']);
  });

  it('窗口内院系（needsRefresh=false）→ 跳过', () => {
    expect(deptsToFetch([math()], { '042': Date.now() }, never)).toEqual([]);
  });

  it('过窗口院系（needsRefresh=true）→ 拉（v3 取反回归的守门）', () => {
    expect(deptsToFetch([math()], { '042': 1 }, always)).toEqual(['042']);
  });

  it('force → 窗口内也拉', () => {
    expect(deptsToFetch([math()], { '042': Date.now() }, never, true)).toEqual(['042']);
  });

  it('同一院系多门课只出一个院系码', () => {
    expect(deptsToFetch([math('20420011'), math('20420012')], {}, never)).toEqual(['042']);
  });

  it('院系不可解析的行不产生院系码', () => {
    expect(deptsToFetch([unknown()], {}, always)).toEqual([]);
  });

  it('混合：只产出需拉的院系', () => {
    const rows = [math('20420011'), { code: '20060011', seq: '1', name: '未名课' } as Course];
    // '006' 不在白名单 → 不可解析；20420011 → 042
    expect(deptsToFetch(rows, {}, never)).toEqual(['042']);
  });
});
