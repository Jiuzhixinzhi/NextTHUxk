// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 课表预览时间轴布局（纯函数：重叠分道 + 轴伸缩）
// ═══════════════════════════════════════════════════════════════
import type { Course, ManualEvent } from './types';
import { DAY_NAMES, PV_AXIS_BEGIN, PV_AXIS_END, PV_PX_PER_MIN, hm, originOf, pvToMin, spansOf, SLOT_NAMES } from './time';

export interface PreviewBlock {
  key: string;
  day: number;
  begin: number;
  end: number;
  lane: number;
  lanes: number;
  label: string;
  when: string;
  color: string;
  probLabel: string;
  bg: string;
  origin: string;
  manual: boolean;
  id?: number;
  code?: string;
  seq?: string;
  title: string;
}

export interface UndetItem {
  label: string;
  code: string;
  seq: string;
  credits: number;
  manual: boolean;
  id?: number;
}

export interface PreviewLayout {
  A0: number;
  A1: number;
  H: number;
  blocks: PreviewBlock[];
  undet: UndetItem[];
  hasClock: boolean;
}

interface RawBlock {
  key: string;
  day: number;
  begin: number;
  end: number;
  label: string;
  when: string;
  color: string;
  probLabel: string;
  bg: string;
  manual: boolean;
  id?: number;
  code?: string;
  seq?: string;
  origin: string;
}

function pvColor(name: string): string {
  let h = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return ['#6d7ff0', '#3d8bfd', '#1fa487', '#e07a4f', '#b463d6', '#2f9edb', '#c9971f', '#4caf6e', '#d45c8a', '#7a63e8'][h % 10] || '#6d7ff0';
}

export function layoutPreview(
  rows: (Course | ManualEvent)[],
  metaOf: (c: Course | ManualEvent) => { color: string; probLabel: string; bg: string },
): PreviewLayout {
  const raw: RawBlock[] = [];
  const undet: UndetItem[] = [];
  rows.forEach(c => {
    const meta = metaOf(c);
    const teacher = (c as Course).teacher;
    const lbl = teacher ? c.name + '(' + teacher + ')' : c.name;
    const mk = (day: number, begin: number, end: number, tag: string, when: string): RawBlock => ({
      key: (c.code || 'm') + '_' + (c.seq || '0') + '_' + tag,
      day,
      begin,
      end,
      label: lbl,
      when,
      color: meta.color,
      probLabel: meta.probLabel,
      bg: meta.bg,
      manual: (c as ManualEvent).manual === true,
      id: (c as ManualEvent).id,
      code: c.code,
      seq: c.seq || '0',
      origin: originOf(String(c.code || '')),
    });
    const spans = spansOf(c);
    // 同大节多周段（如 1-2(1-9周),1-2(10-16周)）会生成同 key 同起止的重复块——
    // 按键聚合（when 文本并集），杜绝 each_key_duplicate
    const merged = new Map<string, RawBlock>();
    for (const s of spans) {
      const sc = SLOT_NAMES.indexOf(s.when) + 1;
      const b = mk(s.dayN, s.begin, s.end, '' + sc, s.dayN + '-' + s.when + (s.week ? '(' + s.week + ')' : ''));
      const k = b.key + '_' + b.begin + '_' + b.end;
      const ex = merged.get(k);
      if (ex) {
        if (!ex.when.includes(b.when)) ex.when = ex.when + ',' + b.when;
      } else {
        merged.set(k, b);
      }
    }
    for (const b of merged.values()) raw.push(b);
    if (!spans.length) {
      undet.push({ label: lbl, code: c.code, seq: c.seq || '0', credits: c.credits || 0, manual: (c as ManualEvent).manual === true, id: (c as ManualEvent).id });
    }
  });
  // 同日重叠分道（簇制）
  const laneOf = new Map<string, { lane: number; lanes: number }>();
  for (let day = 1; day <= 7; day++) {
    const list = raw.filter(b => b.day === day).sort((a, b) => a.begin - b.begin || a.end - b.end);
    let cluster: RawBlock[] = [];
    let clusterEnd = -1;
    const flush = () => {
      const ends: number[] = [];
      for (const b of cluster) {
        let lane = ends.findIndex(le => le <= b.begin);
        if (lane === -1) {
          lane = ends.length;
          ends.push(b.end);
        } else ends[lane] = b.end;
        laneOf.set(b.key, { lane, lanes: ends.length });
      }
      cluster = [];
      clusterEnd = -1;
    };
    for (const b of list) {
      if (cluster.length && b.begin >= clusterEnd) flush();
      cluster.push(b);
      clusterEnd = Math.max(clusterEnd, b.end);
    }
    flush();
  }
  const PX = PV_PX_PER_MIN;
  let A0 = PV_AXIS_BEGIN;
  let A1 = PV_AXIS_END;
  for (const b of raw) {
    A0 = Math.min(A0, b.begin);
    A1 = Math.max(A1, b.end);
  }
  A0 = Math.floor(A0 / 30) * 30;
  A1 = Math.ceil(A1 / 30) * 30;
  const H = Math.round((A1 - A0) * PX);
  const blocks: PreviewBlock[] = raw.map(b => {
    const ln = laneOf.get(b.key) || { lane: 0, lanes: 1 };
    const bc = b.color || pvColor(b.label);
    return {
      ...b,
      lane: ln.lane,
      lanes: ln.lanes,
      color: bc,
      title: [b.label, !b.manual && b.seq && b.seq !== '0' ? String(parseInt(b.seq, 10) || 0) : '', b.when || ''].filter(Boolean).join(' · '),
    };
  });
  return { A0, A1, H, blocks, undet, hasClock: raw.length > 0 };
}

export function axisHours(A0: number, A1: number): { top: number; label: string }[] {
  const out: { top: number; label: string }[] = [];
  for (let m = A0; m <= A1; m += 60) out.push({ top: Math.round((m - A0) * PV_PX_PER_MIN), label: hm(m) });
  return out;
}

export const dayNames = DAY_NAMES;
export { pvToMin };
