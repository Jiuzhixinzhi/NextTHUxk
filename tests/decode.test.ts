// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 响应编码探测/解码测试（decodeBest / pickDecoded）
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { decodeBest, pickDecoded, pickDecodedWithSource, GBK_URL_RE } from '../src/lib/net/decode';

const buf = (bytes: number[]) => new Uint8Array(bytes).buffer;

describe('decodeBest（编码探测）', () => {
  it('GBK 中文：UTF-8 解出替换符 → 判 GBK', () => {
    // 0xB0 0xA1 = GBK「啊」；作为 UTF-8 无效 → U+FFFD
    expect(decodeBest(buf([0xb0, 0xa1]), 'https://zhjwxk.cic.tsinghua.edu.cn/xkBks.do')).toBe('啊');
  });

  it('UTF-8 中文 + 非教务 URL：标签数平分时按 URL 规则回退 UTF-8', () => {
    const out = decodeBest(buf([...new TextEncoder().encode('<p>课程</p>')]), 'https://example.com/a');
    expect(out).toBe('<p>课程</p>');
  });

  it('纯 ASCII：两侧解码一致', () => {
    const out = decodeBest(buf([...new TextEncoder().encode('<b>x</b>')]), 'https://example.com/a');
    expect(out).toBe('<b>x</b>');
  });

  it('GBK_URL_RE 覆盖教务域名', () => {
    expect(GBK_URL_RE.test('https://zhjwxk.cic.tsinghua.edu.cn/xkBks.vxkBksXkbBs.do')).toBe(true);
    expect(GBK_URL_RE.test('https://zhjw.cic.tsinghua.edu.cn/jhBks')).toBe(true);
    expect(GBK_URL_RE.test('https://example.com/a')).toBe(false);
  });
});

describe('pickDecoded（双解码选优）', () => {
  const rows = (s: string) => s.split(',').filter(Boolean);

  it('解析行数多者胜（×2 加权）', () => {
    expect(pickDecoded(rows, { gbk: 'a,b,c', utf8: 'a' })).toEqual(['a', 'b', 'c']);
    expect(pickDecoded(rows, { gbk: 'a', utf8: 'a,b,c' })).toEqual(['a', 'b', 'c']);
  });

  it('行数相同 → 无替换符者胜', () => {
    const out = pickDecoded(rows, { gbk: 'a,\uFFFD', utf8: 'a,b' });
    expect(out).toEqual(['a', 'b']);
  });

  it('完全平分 → 回退 GBK', () => {
    expect(pickDecoded(rows, { gbk: 'a,b', utf8: 'a,b' })).toEqual(['a', 'b']);
  });

  it('解析结果非数组 → 该侧计 0 分', () => {
    const parse = (h: string) => (h === 'bad' ? null : rows(h));
    expect(pickDecoded(parse, { gbk: 'bad', utf8: 'a' })).toEqual(['a']);
    expect(pickDecoded(parse, { gbk: 'bad', utf8: 'bad' })).toBeNull();
  });

  it('pickDecodedWithSource：值 = pickDecoded，且返回胜出原文（取 token/页码用）', () => {
    const parse = rows;
    const dual = { gbk: 'a', utf8: 'a,b' };
    const picked = pickDecodedWithSource(parse, dual);
    expect(picked.value).toEqual(pickDecoded(parse, dual));
    expect(picked.html).toBe(dual.utf8);
    expect(pickDecodedWithSource(parse, { gbk: 'a,b', utf8: 'a' }).html).toBe('a,b');
  });
});
