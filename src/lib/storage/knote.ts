// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 课表时间持久缓存（knote：用户三十二报「把时间暂存起来」）
// 凡见过能解析的时间/说明列就记下（chrome.storage.local，跨会话），预览 join 时
// 池里没有就用缓存兜底。外校课时间只在 kkxxSearch 说明列出现过一次也能永远用。
// ═══════════════════════════════════════════════════════════════
import { clockRangesOf, parseTimeSlots } from '../domain/time';
import { K, store } from './store';

export type KnoteMap = Record<string, { note: string; time: string }>;

export async function knoteLoad(): Promise<KnoteMap> {
  try {
    const v = await store.get<KnoteMap>(K.knote);
    return v && typeof v === 'object' ? v : {};
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
    const k = code + '_' + (seq || '0');
    const ex = knote[k];
    if (ex && (ex.note || '') === (note || '') && (ex.time || '') === (time || '')) return;
    knote[k] = { note: note || '', time: time || '' };
    if (t) clearTimeout(t);
    t = setTimeout(save, 400);
  };
}
