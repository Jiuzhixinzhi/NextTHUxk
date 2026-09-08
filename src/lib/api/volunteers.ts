// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 志愿统计（院系定向实时拉取，v1.5.1 语义移植）
// BR 表（tbzySearchBR）9 列 / Ty 表（tbzySearchTy）6 列；分页 pagedFetch；
// 错页校验（页里至少要有一行真属于该院系，否则不标 done、数据不进 map）；
// in-flight 去重；检查点窗口新鲜度由调用方注入。
// ═══════════════════════════════════════════════════════════════
import type { Course, Ctx, VolDatum } from '../domain/types';
import { TAG } from '../core/constants';
import { normSeq } from '../core/utils';
import { fetchPage, fetchPost } from '../net/http';
import { pagedFetch } from '../net/paged';
import { deptCodeOf, deptOfCourse } from './dept';
import { isSportsCourse } from '../domain/flags';

export function parseVolFromHtml(html: string): Record<string, VolDatum> {
  const map: Record<string, VolDatum> = {};
  const regex =
    /\[\s*"(\d+)"\s*,\s*"([^"]*?)"\s*,\s*"[^"]*?"\s*,\s*"([^"]*?)"\s*,\s*"(\d*)"\s*,\s*"(\d*)"\s*,\s*"(.*?)"\s*,\s*"(.*?)"\s*,\s*"(.*?)"\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    // 墓碑行过滤：capacity==0 && applied==0 = 已满课不在志愿池；报名>0 的 0 容量保留
    if (!(parseInt(m[4]!) || 0) && !(parseInt(m[5]!) || 0)) continue;
    const key = m[1]! + '_' + normSeq(m[2]!);
    map[key] = {
      code: m[1]!,
      seq: m[2]!,
      department: m[3],
      capacity: parseInt(m[4]!) || 0,
      applied: parseInt(m[5]!) || 0,
      volRequired: m[6],
      volElective: m[7],
      volOptional: m[8],
    };
  }
  return map;
}

export function parseVolSportsFromHtml(html: string): Record<string, VolDatum> {
  const map: Record<string, VolDatum> = {};
  const regex = /\[\s*"(\d+)"\s*,\s*"([^"]*?)"\s*,\s*"[^"]*?"\s*,\s*"(\d*)"\s*,\s*"(\d*)"\s*,\s*"(.*?)"\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    if (!(parseInt(m[3]!) || 0) && !(parseInt(m[4]!) || 0)) continue;
    const key = m[1]! + '_' + normSeq(m[2]!);
    map[key] = { code: m[1]!, seq: m[2]!, capacity: parseInt(m[3]!) || 0, applied: parseInt(m[4]!) || 0, volSports: m[5] };
  }
  return map;
}

export function parsePagerInfo(html: string): { pages: number; total: number } {
  const pages = /共\s*(\d+)\s*页/.exec(html);
  const total = /共\s*([\d,，]+)\s*条/.exec(html);
  return {
    pages: pages ? parseInt(pages[1]!) : 0,
    total: total ? parseInt(total[1]!.replace(/[,，]/g, '')) : 0,
  };
}

/** 定向课号志愿查询：BR 表单自带 p_kch 查询框（POST token+p_kch 精确拉该课全部课序） */
export async function fetchVolCourse(ctx: Ctx, code: string): Promise<Record<string, VolDatum>> {
  if (!ctx.isZhjwxk) return {};
  const url = ctx.BASE + '/xkBks.xkBksZytjb.do?m=tbzySearchBR&p_xnxq=' + ctx.SEM;
  const fh = await fetchPage(url);
  const token = (fh.match(/name="token"\s+value="([^"]+)"/) || [])[1] || '';
  const html = await fetchPost(
    ctx.BASE + '/xkBks.xkBksZytjb.do',
    'm=tbzySearchBR&page=-1&token=' + encodeURIComponent(token) +
      '&p_xnxq=' + encodeURIComponent(ctx.SEM) +
      '&p_sort.p1=&p_sort.p2=&p_sort.asc1=true&p_sort.asc2=true' +
      '&p_kch=' + encodeURIComponent(code) + '&p_kcm=&p_lrdwnm=',
  );
  const all = parseVolFromHtml(html);
  const out: Record<string, VolDatum> = {};
  for (const k of Object.keys(all)) if (all[k]!.code === String(code)) out[k] = all[k]!;
  console.log(TAG, 'volunteer 定向课号', code + ':', Object.keys(out).length, '行');
  return out;
}

export interface VolSession {
  depts: Record<string, number>;
  retried: Record<string, number>;
  /** BR 键=院系码（Record 返回）；Ty 键='ty'（VolDatum[]）——共享池仅做 in-flight 去重 */
  inflight: Record<string, Promise<unknown>>;
}

export const volSession: VolSession = { depts: {}, retried: {}, inflight: {} };

export interface VolOpts {
  force?: boolean;
  onDept?: (partial: Record<string, VolDatum>) => void;
  /** 检查点窗口新鲜度判定：ts 处于当前窗口 → false（跳过重拉） */
  fresh?: (ts: number) => boolean;
  onPersist?: () => void;
}

/** 院系定向爬取；返回本批全部行；in-flight 共享；失败容忍不记 done。 */
export async function fetchVolunteer(ctx: Ctx, courses: Course[], opts: VolOpts = {}): Promise<Record<string, VolDatum>> {
  if (!ctx.isZhjwxk) return {};
  const force = !!opts.force;
  const onDept = opts.onDept;
  const done = volSession.depts;
  const inflight = volSession.inflight;
  const fresh = (ts: number) => (opts.fresh ? opts.fresh(ts) : true);
  const pool = (courses || []).filter(c => c && c.code && !c.isCandidate);
  const map: Record<string, VolDatum> = {};
  const deptCodes = new Set<string>();
  pool.forEach(c => {
    const code = deptOfCourse(c);
    if (code && (force || !done[code] || fresh(done[code]))) deptCodes.add(code);
  });
  const hasSports = pool.some(c => isSportsCourse(c));
  const parseVol = (parseFn: (h: string) => Record<string, VolDatum>) => (html: string) => {
    const b = parseFn(html);
    const arr = Object.values(b);
    return { items: arr, hasData: arr.length > 0 };
  };
  const fetched: string[] = [];
  const fetchDept = (code: string): Promise<Record<string, VolDatum>> =>
    (async () => {
      const m: Record<string, VolDatum> = {};
      try {
        const first = ctx.BASE + '/xkBks.xkBksZytjb.do?m=tbzySearchBR&p_xnxq=' + ctx.SEM + '&p_lrdwnm=' + code;
        const fh = await fetchPage(first);
        const pg = parsePagerInfo(fh);
        const items = await pagedFetch({
          firstHtml: fh,
          fetchPage: p => (p <= 1 ? Promise.resolve(fh) : fetchPage(first + '&page=' + p + '&_t=' + Date.now())),
          parse: parseVol(parseVolFromHtml),
          maxPages: 25,
          concurrency: 3,
          throttle: 50,
          dedupe: v => v.code + '_' + normSeq(v.seq),
          expectPages: pg.pages,
          label: 'vol-BR-' + code,
        });
        const valid = items.some(v => deptCodeOf(v.department) === code);
        if (!valid) {
          console.warn(TAG, 'volunteer 错页：', code, '返回', items.length, '行但无本院系课程，不标记');
          return m;
        }
        items.forEach(v => {
          m[v.code + '_' + normSeq(v.seq)] = v;
        });
        done[code] = Date.now();
      } catch (e) {
        console.warn(TAG, 'volunteer dept ', code, e);
      }
      return m;
    })();
  const share = (key: string): Promise<Record<string, VolDatum>> => {
    let p = inflight[key] as Promise<Record<string, VolDatum>> | undefined;
    if (!p) {
      p = fetchDept(key);
      inflight[key] = p;
      p.then(
        () => undefined,
        () => undefined,
      ).finally(() => {
        if (inflight[key] === p) delete inflight[key];
      });
    }
    return p;
  };
  for (const code of deptCodes) {
    const m = await share(code);
    Object.assign(map, m);
    if (Object.keys(m).length) fetched.push(code);
    if (onDept && Object.keys(map).length) {
      try {
        onDept(map);
      } catch {
        /* fail-soft */
      }
    }
  }
  if (hasSports && (force || !done.ty || fresh(done.ty))) {
    try {
      const items: VolDatum[] = await (async () => {
        let p = inflight['ty'] as Promise<VolDatum[]> | undefined;
        if (!p) {
          p = (async () => {
            const first = ctx.BASE + '/xkBks.xkBksZytjb.do?m=tbzySearchTy&p_xnxq=' + ctx.SEM;
            const fh = await fetchPage(first);
            const pg = parsePagerInfo(fh);
            return pagedFetch({
              firstHtml: fh,
              fetchPage: p2 => (p2 <= 1 ? Promise.resolve(fh) : fetchPage(first + '&page=' + p2 + '&_t=' + Date.now())),
              parse: parseVol(parseVolSportsFromHtml),
              maxPages: 20,
              concurrency: 3,
              throttle: 50,
              dedupe: v => v.code + '_' + normSeq(v.seq),
              expectPages: pg.pages,
              label: 'vol-Ty',
            });
          })();
          inflight['ty'] = p;
          p.then(
            () => undefined,
            () => undefined,
          ).finally(() => {
            if (inflight['ty'] === p) delete inflight['ty'];
          });
        }
        return p;
      })();
      items.forEach(v => {
        const k = v.code + '_' + normSeq(v.seq);
        map[k] = Object.assign({ capacity: 0, applied: 0, volRequired: '', volElective: '', volOptional: '' }, map[k], v);
      });
      done.ty = Date.now();
      if (onDept && Object.keys(map).length) {
        try {
          onDept(map);
        } catch {
          /* fail-soft */
        }
      }
    } catch (e) {
      console.warn(TAG, 'volunteer Ty:', e);
    }
  }
  console.log(TAG, 'volunteer (dept-sync): ', Object.keys(map).length, 'entries, depts', fetched.join(',') || '(无新院系)');
  if (opts.onPersist) opts.onPersist();
  return map;
}

/** 志愿数据合并进课程池行（段精确匹配，多段宁缺毋滥） */
export function applyVolunteer(courses: Course[], volData: Record<string, VolDatum> | undefined): boolean {
  const byCodeAll: Record<string, VolDatum[]> = {};
  for (const v of Object.values(volData || {})) (byCodeAll[v.code] = byCodeAll[v.code] || []).push(v);
  const norm = (s: string | number) => String(parseInt(String(s), 10) || 0);
  let changed = 0;
  (courses || []).forEach(c => {
    const rows = byCodeAll[c.code] || [];
    const v =
      volData?.[c.code + '_' + (c.seq || '0')] ||
      volData?.[c.code + '_' + norm(c.seq)] ||
      rows.find(r => norm(r.seq) === norm(c.seq)) ||
      (rows.length === 1 ? rows[0] : null);
    if (v) {
      const eq =
        c.volRequired === v.volRequired &&
        c.volElective === v.volElective &&
        c.volOptional === v.volOptional &&
        (c.volSports || '') === (v.volSports || '') &&
        c.volCapacity === v.capacity &&
        Number(c.volApplied || 0) === Number(v.applied || 0);
      c.volRequired = v.volRequired;
      c.volElective = v.volElective;
      c.volOptional = v.volOptional;
      c.volSports = v.volSports || '';
      c.volCapacity = v.capacity;
      c.volApplied = v.applied || 0;
      if (!eq) changed++;
    } else {
      const wasEmpty = !(c.volRequired || c.volElective || c.volOptional || c.volSports);
      c.volRequired = '';
      c.volElective = '';
      c.volOptional = '';
      c.volSports = '';
      if (!wasEmpty) changed++;
    }
  });
  return changed > 0;
}
