// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 服务端课程搜索（kkxxSearch / 页签兜底）
// 中文筛选参数（课名/教师）必须 gbkPercentEncode——GBK 页面 UTF-8 直发解出乱码
// LIKE 匹配不到 → 0 行。风暴护栏：精确课号 1 页；≤25 全量；>25 探 5；页间 30ms 错峰。
// ═══════════════════════════════════════════════════════════════
import type { Course, Ctx, ServerSearchResult } from '../domain/types';
import { TAG } from '../core/constants';
import { normSeq, runPool, sleep } from '../core/utils';
import { fetchPage, fetchPost } from '../net/http';
import { gbkPercentEncode } from '../net/gbk';

export function isXkDeadHtml(html: string): boolean {
  return (
    html.includes('accessDenied') ||
    html.includes('用户登陆超时或访问内容不存在。请重试') ||
    html.includes('电子身份服务系统') ||
    html.includes('do/off/ui/auth/login') ||
    html.includes('__vpn_app_hostname_data') ||
    html.includes('__vpn_hostname_data')
  );
}

export function parseCatalog(doc: Document): Course[] {
  const out: Course[] = [];
  doc.querySelectorAll('tr.trr2').forEach(row => {
    const tds = row.querySelectorAll('td');
    if (tds.length < 11) return;
    const cell = (i: number) => (tds[i]?.textContent || '').trim().replace(/\s+/g, ' ');
    const code = cell(1);
    const name = cell(3);
    // 外校课课号带前缀：PK/GPK/BW——纯字母数字且至少含一个数字
    if (!code || !name || !/^[A-Za-z0-9]+$/.test(code) || !/\d/.test(code)) return;
    const bksCap = parseInt(cell(6)) || 0;
    const bksRem = parseInt(cell(7)) || 0;
    const teacherLink = tds[5]?.querySelector('a[href*="showJsDetail"]');
    const teacherId = teacherLink?.getAttribute('href')?.match(/p_jsh=([^&]+)/)?.[1] || '';
    const detailHref = tds[3]?.querySelector('a[href*="showToXs"]')?.getAttribute('href') || '';
    const attrCell = [...tds].map(td => (td.textContent || '').trim()).find(c => c === '必修' || c === '限选' || c === '任选');
    out.push({
      code,
      seq: cell(2),
      name,
      credits: parseFloat(cell(4)) || 0,
      teacher: cell(5),
      teacherId,
      department: cell(0),
      time: cell(10),
      capacity: bksCap,
      remaining: bksRem,
      available: bksRem > 0,
      selected: false,
      queue: '',
      group: cell(0),
      attr: attrCell || '',
      detailUrl: detailHref,
      note: cell(11),
      xkTextNote: cell(11),
      courseFeature: cell(12),
      grade: cell(13),
      tongshiGroup: cell(18),
      gradCapacity: parseInt(cell(8)) || 0,
      gradRemaining: parseInt(cell(9)) || 0,
      volRequired: '',
      volElective: '',
      volOptional: '',
      volSports: '',
    });
  });
  return out;
}

export interface SearchOpts {
  page?: number;
  kch?: string;
  kcm?: string;
  teacher?: string;
  department?: string;
  weekday?: string;
  section?: string;
  grade?: string;
  rxklxm?: string;
  kctsm?: string;
  onlyAvailable?: boolean;
  gradAvail?: boolean;
  forceAll?: boolean;
}

/** 单页服务端搜索（pageKind：ok=有行；empty=结果页但 0 行；unknown=异常页） */
export async function serverSearch(ctx: Ctx, o: SearchOpts = {}): Promise<ServerSearchResult> {
  const { SEM, BASE } = ctx;
  if (!ctx.isZhjwxk && !ctx.isWebvpn) return { rows: [], pageKind: 'unknown' };
  const page = Math.max(1, o.page || 1);
  const enc = gbkPercentEncode;
  const parts = ['m=kkxxSearch', 'p_xnxq=' + encodeURIComponent(SEM)];
  if (page > 1) parts.push('page=' + page);
  if (o.kch && o.kch.trim()) parts.push('p_kch=' + encodeURIComponent(o.kch.trim()));
  const kw = o.kcm && o.kcm.trim();
  if (kw) parts.push('p_kcm=' + enc(kw));
  const teacher = o.teacher && o.teacher.trim();
  if (teacher) parts.push('p_zjjsxm=' + enc(teacher));
  if (o.department) parts.push('p_kkdwnm=' + encodeURIComponent(o.department));
  if (o.weekday) parts.push('p_skxq=' + encodeURIComponent(o.weekday));
  if (o.section) parts.push('p_skjc=' + encodeURIComponent(o.section));
  if (o.grade) parts.push('p_ssnj=' + encodeURIComponent(o.grade));
  if (o.rxklxm) parts.push('p_rxklxm=' + encodeURIComponent(o.rxklxm));
  if (o.kctsm) parts.push('p_kctsm=' + encodeURIComponent(o.kctsm));
  if (o.onlyAvailable) parts.push('p_bkskyl_ig=0');
  if (o.gradAvail) parts.push('p_yjskyl_ig=0');
  const url = BASE + '/xkBks.vxkBksJxjhBs.do?' + parts.join('&') + '&_t=' + Date.now();
  let html: string;
  try {
    html = await fetchPage(url);
  } catch (e) {
    return { rows: [], pageKind: 'unknown', htmlHead: String(e instanceof Error ? e.message : e) };
  }
  if (isXkDeadHtml(html)) {
    return { rows: [], pageKind: 'unknown', htmlHead: '会话死页（' + html.replace(/<[^>]+>/g, ' ').trim().slice(0, 80) + '）' };
  }
  const rows = parseCatalog(new DOMParser().parseFromString(html, 'text/html'));
  const tp = /共\s*(\d+)\s*页/.exec(html);
  const totalPages = tp ? parseInt(tp[1]!, 10) : undefined;
  const tr = /共\s*[\d,]+\s*页（共\s*([\d,]+)\s*条记录/.exec(html);
  const totalRows = tr ? parseInt(tr[1]!.replace(/,/g, ''), 10) : undefined;
  if (rows.length > 0) return { rows, page, hasMore: true, totalPages, totalRows, pageKind: 'ok' };
  const isResultPage = html.includes('选课文字说明') || html.includes('trr2');
  return isResultPage
    ? { rows, page, hasMore: false, totalPages, pageKind: 'empty' }
    : { rows, page, hasMore: false, totalPages, totalRows, pageKind: 'unknown', htmlHead: html.slice(0, 600).replace(/\s+/g, ' ') };
}

// ─── 外校课号页签检索兜底（教务 web UI 同款路径：任选→限选→必修）───
export function parseTabGrid(html: string, attr: string): Course[] {
  const out: Course[] = [];
  for (const seg of html.match(/gridData\w*\s*=\s*\[[\s\S]*?\];/g) || []) {
    const rows = seg.match(/\[\s*"(?:[^"\\]|\\.)*"(?:\s*,\s*"(?:[^"\\]|\\.)*")+\s*\]/g) || [];
    for (const row of rows) {
      const cells: string[] = [];
      const cre = /"((?:[^"\\]|\\.)*)"/g;
      let cm: RegExpExecArray | null;
      while ((cm = cre.exec(row)) !== null) cells.push(cm[1]!);
      if (cells.length < 9) continue;
      const name = (cells[3] || '').replace(/<[^>]+>/g, '').trim();
      const code = (cells[4] || '').trim();
      if (!code || !name || !/\d/.test(code)) continue;
      let seq = (cells[5] || '').trim();
      const rid = (cells[0] || '').match(/value='([^']*);([^']*);([^']*);'/);
      if (rid && rid[2] === code && rid[3]) seq = rid[3];
      out.push({
        code,
        seq: seq || '0',
        name,
        attr: (cells[1] || '').replace(/<[^>]+>/g, '').trim() || attr || '',
        time: cells[6] || '',
        teacher: cells[7] || '',
        credits: parseFloat(cells[8] || '') || 0,
        capacity: 0,
        remaining: 0,
        available: true,
        selected: false,
        queue: '',
        group: '',
        note: '',
        xkTextNote: '',
        partial: true,
      });
    }
  }
  return out;
}

export async function tabSearchByKch(ctx: Ctx, kch: string): Promise<Course[]> {
  const { SEM, BASE } = ctx;
  if (!ctx.isZhjwxk && !ctx.isWebvpn) return [];
  const tabs = [
    { m: 'rxSearch', flag: 'rx', attr: '任选' },
    { m: 'xxSearch', flag: 'xx', attr: '限选' },
    { m: 'bxSearch', flag: 'bx', attr: '必修' },
  ];
  for (const tab of tabs) {
    try {
      let fh = await fetchPage(BASE + '/xkBks.vxkBksXkbBs.do?m=' + tab.m + '&p_xnxq=' + SEM + '&tokenPriFlag=' + tab.flag + '&p_kch=' + encodeURIComponent(kch) + '&_t=' + Date.now());
      if (isXkDeadHtml(fh)) continue;
      if (!/gridData\w*\s*=/.test(fh)) {
        const token = (fh.match(/name="token"\s+value="([^"]+)"/) || [])[1] || '';
        if (!token) continue;
        try {
          fh = await fetchPost(
            BASE + '/xkBks.vxkBksXkbBs.do',
            new URLSearchParams({ m: tab.m, page: '', token, p_xnxq: SEM, tokenPriFlag: tab.flag, p_kch: kch, p_kcm: '', p_rxklxm: '' }),
          );
        } catch {
          continue;
        }
      }
      const rows = parseTabGrid(fh, tab.attr);
      if (rows.length) {
        console.log(TAG, '外校课号页签检索命中:', kch, tab.attr, rows.length + ' 行');
        return rows;
      }
    } catch (e) {
      console.warn(TAG, 'tabSearch ' + tab.m + ':', e);
    }
  }
  return [];
}

/** 风暴护栏版服务端搜索：精确课号 1 页；≤25 全量；>25 或未知探 5；forceAll 显式全量。 */
export async function serverSearchStorm(ctx: Ctx, o: SearchOpts = {}): Promise<ServerSearchResult> {
  const exactCode = !o.kcm && !!(o.kch || '').trim();
  const first = await serverSearch(ctx, { ...o, page: 1 });
  let rows = first.rows || [];
  if (!rows.length && exactCode && !/^\d+$/.test((o.kch || '').trim())) {
    const tabRows = await tabSearchByKch(ctx, (o.kch || '').trim());
    if (tabRows.length) return { rows: tabRows, page: 1, hasMore: false, totalPages: 1, totalRows: tabRows.length, pageKind: 'ok', viaTab: true };
  }
  const tp = first.totalPages || 0;
  const probeTo = exactCode && !o.forceAll ? 1 : o.forceAll ? (tp > 0 ? tp : 25) : tp > 0 ? (tp <= 25 ? tp : 5) : 25;
  if (probeTo > 1) {
    const merged = new Map<string, Course>();
    rows.forEach(r => merged.set(r.code + '_' + (r.seq || '0'), r));
    const pages: number[] = [];
    for (let p = 2; p <= probeTo; p++) pages.push(p);
    await runPool(pages, 5, async (p, idx) => {
      await sleep(30 * (idx % 5));
      try {
        const r = await serverSearch(ctx, { ...o, page: p });
        (r.rows || []).forEach(row => {
          const k = row.code + '_' + (row.seq || '0');
          if (!merged.has(k)) {
            merged.set(k, row);
            rows.push(row);
          }
        });
      } catch (e) {
        console.warn(TAG, 'server search page', p, e);
      }
    });
  }
  // 教师名兜底：课名 0 行且非纯数字 → 换教师通道重试一次
  if (!rows.length && o.kcm && o.kcm.trim() && !/^\d+$/.test(o.kcm.trim()) && !o.teacher) {
    const retry = await serverSearchStorm(ctx, { ...o, kcm: '', teacher: o.kcm.trim() });
    if (retry.rows && retry.rows.length) return retry;
  }
  return {
    rows,
    totalPages: first.totalPages,
    totalRows: first.totalRows,
    pageKind: rows.length ? 'ok' : (first.pageKind || 'empty'),
    htmlHead: first.htmlHead,
  };
}

export function isCodeLike(kw: string): boolean {
  const k = String(kw || '').trim();
  return k.length >= 5 && !/[\u4e00-\u9fff]/.test(k) && /\d/.test(k) && /^[A-Za-z0-9][-A-Za-z0-9]*$/.test(k);
}

export function normSeqOf(seq: string | number) {
  return normSeq(seq);
}
