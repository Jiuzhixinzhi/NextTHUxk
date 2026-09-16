// ═══════════════════════════════════════════════════════════════
// NextTHUxk — GBK 表结构守卫（历史 Bug：正则截取多 5 个字符致整表错位）
// 表条目数与 b64 半表长度必须一致，且字符无重复——错位即报警。
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { GBK_CHARS, GBK_BYTES_B64 } from '../src/lib/net/gbk-table';
import { gbkPercentEncode } from '../src/lib/net/gbk';

describe('GBK 表结构', () => {
  it('字符数与 b64 半表长度一致（每字符 1 字节，双半表）', () => {
    const bin = Uint8Array.from(atob(GBK_BYTES_B64), c => c.charCodeAt(0));
    expect(bin.length % 2).toBe(0);
    expect(GBK_CHARS.length).toBe(bin.length / 2);
  });

  it('字符表无重复（错位会产生重复项）', () => {
    expect(new Set(GBK_CHARS).size).toBe(GBK_CHARS.length);
  });

  it('编码往返：中文编码结果与服务端约定的 GBK 百分号一致', () => {
    // 高 = U+9AD8 → GBK B8 DF（与 tests/domain.test.ts 既有断言同源）
    expect(gbkPercentEncode('高')).toBe('%B8%DF');
    expect(gbkPercentEncode('北京大学')).toBe('%B1%B1%BE%A9%B4%F3%D1%A7');
  });

  it('表外字符回落 UTF-8 百分号（不抛错）', () => {
    const out = gbkPercentEncode('𠀀');
    expect(out).toContain('%');
    expect(() => decodeURIComponent(out)).not.toThrow();
  });
});
