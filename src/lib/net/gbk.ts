// ═══════════════════════════════════════════════════════════════
// NextTHUxk — GBK 查询参数编码（OneTHU packages/core/zhjwxk/gbk-table.ts 逐字节移植）
// 教务页面 GBK：中文筛选参数必须 GBK 百分号编码，UTF-8 直发服务端解出乱码
// → LIKE 匹配不到 → 正常页面 0 行（OneTHU 2026-09 实测实锤）。
// ═══════════════════════════════════════════════════════════════
import { GBK_CHARS, GBK_BYTES_B64 } from './gbk-table';

let IDX: Map<string, number> | null = null;
let B1: Uint8Array | null = null;
let B2: Uint8Array | null = null;

function ensureTable() {
  if (IDX) return;
  const bin = Uint8Array.from(atob(GBK_BYTES_B64), c => c.charCodeAt(0));
  const half = bin.length / 2;
  B1 = bin.slice(0, half);
  B2 = bin.slice(half);
  IDX = new Map();
  for (let i = 0; i < GBK_CHARS.length; i++) IDX.set(GBK_CHARS[i]!, i);
}

/** 按查询参数语义编码：ASCII 原样（% 字面量除外），CJK → GBK 百分号；表外字符回落 UTF-8。 */
export function gbkPercentEncode(s: string): string {
  if (!/[^\x20-\x7e]/.test(s) && !s.includes('%')) return s; // 纯 ASCII 且无 % 字面量 → 直通
  ensureTable();
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c === 0x25) {
      out += '%25';
      continue;
    }
    if (c >= 0x20 && c <= 0x7e) {
      out += ch;
      continue;
    }
    const i = IDX!.get(ch);
    if (i === undefined || !B1 || !B2) {
      out += encodeURIComponent(ch);
      continue;
    }
    const hex = (v: number) => v.toString(16).toUpperCase().padStart(2, '0');
    out += '%' + hex(B1[i]!) + '%' + hex(B2[i]!);
  }
  return out;
}
