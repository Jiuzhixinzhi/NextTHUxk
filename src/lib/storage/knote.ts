// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 课表时间持久缓存（knote：用户三十二报「把时间暂存起来」）
// 凡见过能解析的时间/说明列就记下（chrome.storage.local，跨会话），预览 join 时
// 池里没有就用缓存兜底。外校课时间只在 kkxxSearch 说明列出现过一次也能永远用。
// ═══════════════════════════════════════════════════════════════
import { clockRangesOf, parseTimeSlots } from '../domain/time';
import { keyOf } from '../core/utils';
import { K, store } from './store';

export type KnoteMap = Record<string, { note: string; time: string }>;

export async function knoteLoad(): Promise<KnoteMap> {
  try {
    const v = await store.get<KnoteMap>(K.knote);
    if (!v || typeof v !== 'object') return {};
    // 键迁移：历史版本用原始课序拼键（'01'），统一为 keyOf 归一拼写（含 '01'/'1' 双写法去重）
    const out: KnoteMap = {};
    let changed = false;
    for (const [k, val] of Object.entries(v)) {
      const i = k.indexOf('_');
      const nk = i >= 0 ? keyOf(k.slice(0, i), k.slice(i + 1)) : k;
      if (nk !== k) changed = true;
      out[nk] = val;
    }
    // 迁移结果落盘（原只改内存映射，要等下一条 knote 写入才生效；幂等）
    if (changed) await store.set(K.knote, out).catch(() => {});
    return out;
  } catch {
    return {};
  }
}

/** 工厂：注入 getter 而非对象引用——session.knote 启动时会被整体替换，
 *  绑定旧对象会导致时间记忆永远写不进新对象（用户实测日志实锤）。 */
export function makeKnoteRemember(getKnote: () => KnoteMap) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    t = undefined;
    try {
      store.set(K.knote, getKnote());
    } catch {
      /* fail-soft */
    }
  };
  return function knoteRemember(code: string, seq: string | number, note: string, time: string): void {
    const knote = getKnote();
    const parses = parseTimeSlots(time || '').length > 0 || clockRangesOf(note || '', time || '').length > 0;
    if (!code || !parses) return;
    const k = keyOf(code, seq);
    const ex = knote[k];
    if (ex && (ex.note || '') === (note || '') && (ex.time || '') === (time || '')) return;
    knote[k] = { note: note || '', time: time || '' };
    if (t) clearTimeout(t);
    t = setTimeout(save, 400);
  };
}
