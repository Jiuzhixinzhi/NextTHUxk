// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 时间解析与课表几何（纯函数，无 DOM/无存储）
// ═══════════════════════════════════════════════════════════════

export interface Slot {
  day: string; // 周一…周日
  slot: string; // 1-2节 … 11-12节
  week: string; // 全周 / N-M周 / 单周…
}

export interface ClockRange {
  day: number; // 1-7
  begin: number; // 分钟
  end: number; // 分钟
  tag: string;
}

export const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const SLOT_NAMES = ['1-2节', '3-4节', '5-6节', '7-8节', '9-10节', '11-12节'];

// 大节→钟点映射（清华 1-14 节标准时段）；预览轴随块伸缩（30 分钟对齐）
const PV_BEGIN = ['', '08:00', '08:50', '09:50', '10:40', '11:30', '13:30', '14:20', '15:20', '16:10', '17:05', '17:55', '19:20', '20:10', '21:00'];
const PV_END = ['', '08:45', '09:35', '10:35', '11:25', '12:15', '14:15', '15:05', '16:05', '16:55', '17:50', '18:40', '20:05', '20:55', '21:45'];

export const pvToMin = (hm: string): number => {
  const p = String(hm).split(':');
  return Number(p[0]) * 60 + Number(p[1] || 0);
};

export const SLOT_RANGE: number[][] = [
  [pvToMin(PV_BEGIN[1]!), pvToMin(PV_END[2]!)],
  [pvToMin(PV_BEGIN[3]!), pvToMin(PV_END[5]!)],
  [pvToMin(PV_BEGIN[6]!), pvToMin(PV_END[7]!)],
  [pvToMin(PV_BEGIN[8]!), pvToMin(PV_END[9]!)],
  [pvToMin(PV_BEGIN[10]!), pvToMin(PV_END[11]!)],
  [pvToMin(PV_BEGIN[12]!), pvToMin(PV_END[14]!)],
];

export const PV_PX_PER_MIN = 0.72;
export const PV_AXIS_BEGIN = 8 * 60;
export const PV_AXIS_END = pvToMin(PV_END[14]!);

const slotCache = new Map<string, Slot[]>();

// ─── 周段同类项合并（同 day+大节 拆多周段，如 4-6(1-7周),4-6(8周) → 4-6(1-8周)）───
/** 周串 → 周号集合；无法数值化（全周/单周/双周/杂文本）返回 null */
function weekNumsOf(w: string): Set<number> | null {
  const s = w.replace(/\s/g, '');
  if (!s || s === '全周' || s === '单周' || s === '双周') return null;
  const out = new Set<number>();
  for (const part of s.split(/[,，、]/)) {
    const m = /^(\d+)(?:-(\d+))?周?$/.exec(part);
    if (!m) return null;
    const a = parseInt(m[1]!);
    const b = m[2] ? parseInt(m[2]!) : a;
    if (a < 1 || b < a || b > 25) return null;
    for (let i = a; i <= b; i++) out.add(i);
  }
  return out.size ? out : null;
}

/** 周号集合 → 连续段压缩标签（1-8周 / 1-7周,9周） */
function weekLabelOf(nums: number[]): string {
  const sorted = [...nums].sort((x, y) => x - y);
  const runs: string[] = [];
  let a = sorted[0]!;
  let p = a;
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i];
    if (n === undefined || n !== p + 1) {
      runs.push(a === p ? a + '周' : a + '-' + p + '周');
      a = n!;
      p = n!;
    } else p = n;
  }
  return runs.filter(Boolean).join(',');
}

/** 合并两个周段标签（同类项并集；数值化失败回落为文本拼接） */
function mergeWeek(a: string, b: string): string {
  const A = weekNumsOf(a);
  const B = weekNumsOf(b);
  if (A && B) return weekLabelOf([...A, ...B]);
  return a === b ? a : a + ',' + b;
}

/** 时间串解析 + 同类项合并（缓存：全校时间串种类有限） */
export function parseTimeSlots(timeStr: string | undefined | null): Slot[] {
  if (!timeStr) return [];
  const hit = slotCache.get(timeStr);
  if (hit) return hit;
  const slots: Slot[] = [];
  const re = /(\d+)\s*[-–—]\s*(\d+)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(timeStr)) !== null) {
    const dayNum = parseInt(m[1]!);
    const dajie = parseInt(m[2]!);
    if (dayNum >= 1 && dayNum <= 7 && dajie >= 1 && dajie <= 6) {
      slots.push({ day: DAY_NAMES[dayNum - 1]!, slot: SLOT_NAMES[dajie - 1]!, week: (m[3] || '').trim() || '全周' });
    }
  }
  // 历史 Bug：拆周段（4-6(1-7周),4-6(8周)）生成重复区间 → 课程被误判「与自己冲突」
  const merged = new Map<string, Slot>();
  for (const s of slots) {
    const k = s.day + '|' + s.slot;
    const ex = merged.get(k);
    merged.set(k, ex ? { ...ex, week: mergeWeek(ex.week, s.week) } : s);
  }
  const out = [...merged.values()];
  slotCache.set(timeStr, out);
  return out;
}

// ── 外校课（北大/北外）时间与来源（OneTHU Courses.tsx 移植）──
/** 外校钟点解析 v2（北大/北外官方时间描述全格式实证）：
 *  支持周X/星期X、复合日「周二、四」「星期二/星期日」、多段「、;；」分隔、
 *  破折号—–-通吃、全角括号、课级/段级「单周」「双周」、周段「(1-16周)」。 */
export function clockRangesOf(note: string | undefined | null, time: string | undefined | null): ClockRange[] {
  const raw = (note || '') + ' ' + (time || '');
  if (!raw.trim()) return [];
  const s = raw
    .replace(/星期/g, '周')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[—–]/g, '-')
    .replace(/；/g, ';')
    .replace(/[{}]/g, '(')
    .replace(/」/g, ')');
  const dayChar = '一二三四五六日天';
  const dayIdx: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
  const parityOf = (t: string) => (/单周/.test(t) ? '单周' : /双周/.test(t) ? '双周' : '');
  const out: ClockRange[] = [];
  let globalParity = '';
  for (const seg of s.split(';')) {
    const re = /((?:周?[一二三四五六日天][、/,]?)+)\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g;
    let m: RegExpExecArray | null;
    let segHit = false;
    while ((m = re.exec(seg)) !== null) {
      const days = [...m[1]!].filter(ch => dayChar.includes(ch)).map(ch => dayIdx[ch]!);
      const begin = Number(m[2]) * 60 + Number(m[3]);
      const end = Number(m[4]) * 60 + Number(m[5]);
      const after = seg.slice(m.index + m[0].length, m.index + m[0].length + 12);
      const wk = /\((\d+-\d+周?)\)/.exec(after)?.[1] ?? '';
      const parity = parityOf(seg.slice(m.index));
      for (const day of days) {
        if (day >= 1 && end > begin) {
          const bits = [parity, wk].filter(Boolean);
          out.push({ day, begin, end, tag: bits.join('·') });
          segHit = true;
        }
      }
    }
    if (!segHit) {
      const p = parityOf(seg);
      if (p) globalParity = p;
    }
  }
  if (globalParity)
    for (const r of out) {
      if (!r.tag.includes('周') || /\d+-\d+/.test(r.tag)) {
        r.tag = [globalParity, ...r.tag.split('·').filter(t => !/^(单周|双周)$/.test(t))].filter(Boolean).join('·');
      }
    }
  return out;
}

/** 外校课来源标注：PK=北大本科、GPK=北大研究生、BW=北外 */
export function originOf(code: string): string {
  code = String(code || '');
  return code.startsWith('GPK') ? '北大研' : code.startsWith('PK') ? '北大' : code.startsWith('BW') ? '北外' : '';
}

export const ORIGIN_COLORS: Record<string, string> = { 北大: '#c0392b', 北大研: '#c0392b', 北外: '#1f4e79' };

const PV_PALETTE = ['#6d7ff0', '#3d8bfd', '#1fa487', '#e07a4f', '#b463d6', '#2f9edb', '#c9971f', '#4caf6e', '#d45c8a', '#7a63e8'];

/** 课块配色（无概率色时按课名稳定取色） */
export function pvColorOf(name: string): string {
  let h = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PV_PALETTE[h % PV_PALETTE.length] || '#6d7ff0';
}

export const hm = (m: number) =>
  String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

/** 大节/钟点 → 冲突区间（semantics 与旧 detectConflicts 一致；week 供预览块标题） */
export function spansOf(
  c: {
    time?: string;
    note?: string;
    manual?: boolean;
    day?: number;
    begin?: string;
    end?: string;
  },
  pvToMinFn = pvToMin,
): { dayN: number; begin: number; end: number; when: string; week: string }[] {
  const out: { dayN: number; begin: number; end: number; when: string; week: string }[] = [];
  if (c.manual && c.begin && c.end && String(c.day) && pvToMinFn(c.begin) < pvToMinFn(c.end)) {
    out.push({ dayN: Number(c.day), begin: pvToMinFn(c.begin), end: pvToMinFn(c.end), when: c.begin + '-' + c.end, week: '' });
    return out;
  }
  for (const { day, slot, week } of parseTimeSlots(c.time || '')) {
    const d = DAY_NAMES.indexOf(day) + 1;
    const s = SLOT_NAMES.indexOf(slot) + 1;
    const r = SLOT_RANGE[s - 1];
    if (d && r) out.push({ dayN: d, begin: r[0]!, end: r[1]!, when: slot, week });
  }
  return out;
}
