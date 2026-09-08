// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 响应编码探测与解码
// ═══════════════════════════════════════════════════════════════

export const GBK_URL_RE = /zhjw|xkBks|jhBks|vjsKcbBs/;
const REPL = String.fromCharCode(0xfffd);

/** 编码探测解码（OneTHU reqvest 自动按响应转码的忠实等价）：
 *  ①服务端声明 charset → 按声明；②GBK/UTF-8 各解一遍，替换符（U+FFFD）
 *  单侧出现即判定；③都无替换符 → 标签数多者胜；④仍平 → 教务默认 GBK。 */
export function decodeBest(buf: ArrayBuffer, url: string): string {
  const asGbk = new TextDecoder('gbk').decode(buf);
  const asUtf8 = new TextDecoder('utf-8').decode(buf);
  const gbkBad = asGbk.includes(REPL);
  const utf8Bad = asUtf8.includes(REPL);
  if (gbkBad !== utf8Bad) return gbkBad ? asUtf8 : asGbk;
  const gTags = (asGbk.match(/</g) || []).length;
  const uTags = (asUtf8.match(/</g) || []).length;
  if (gTags !== uTags) return gTags > uTags ? asGbk : asUtf8;
  return GBK_URL_RE.test(url) ? asGbk : asUtf8;
}

/** 双解码结果选优：score = parse(html).length ×2 +（无替换符 +1）；平分回退 gbk。 */
export function pickDecoded<T>(parse: (html: string) => T, dual: { gbk: string; utf8: string }): T {
  const ga = parse(dual.gbk);
  const ua = parse(dual.utf8);
  const gs = Array.isArray(ga) ? ga.length * 2 + (dual.gbk.includes(REPL) ? 0 : 1) : 0;
  const us = Array.isArray(ua) ? ua.length * 2 + (dual.utf8.includes(REPL) ? 0 : 1) : 0;
  return us > gs ? ua : ga;
}
