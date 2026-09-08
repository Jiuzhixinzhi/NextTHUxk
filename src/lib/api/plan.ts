// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 培养方案解析与抓取
// ═══════════════════════════════════════════════════════════════
import type { Ctx, PlanCourse } from '../domain/types';
import { fetchPage } from '../net/http';

export function parsePlan(doc: Document): PlanCourse[] {
  const rows = doc.querySelectorAll('table#kcTable tr');
  const out: PlanCourse[] = [];
  let sem = '',
    season = '';
  for (const row of rows) {
    const tds = row.querySelectorAll('td');
    if (!tds.length) continue;
    const cells = [...tds].map(td => td.textContent!.trim().replace(/\s+/g, ' '));
    for (const td of tds) {
      const t = td.textContent || '';
      const sm = t.match(/(\d{4}-\d{4}学年)/);
      if (sm) sem = sm[1]!;
      const sn = t.match(/^(秋|春|夏)$/);
      if (sn) season = sn[1]!;
    }
    const code = cells.find(c => /^\d{8}$/.test(c));
    if (!code) continue;
    const name = cells.find(c => c.length > 1 && !/^\d+$/.test(c) && !['必修', '限选', '任选', '秋', '春', '夏'].includes(c) && !c.includes('学年'));
    const attr = cells.find(c => ['必修', '限选', '任选'].includes(c));
    const credit = cells.find(c => /^\d{1,2}(\.\d)?$/.test(c) && c !== code);
    const group = cells.find(c => c.length > 2 && !['必修', '限选', '任选'].includes(c) && !/^\d/.test(c) && !c.includes('学年') && c !== name);
    if (name) out.push({ semester: sem + ' ' + season, code, name: name.replace(/\s+/g, ''), attr: attr || '', credits: parseFloat(credit || '') || 0, group: group || '' });
  }
  return out;
}

export function parseFullProgram(doc: Document): PlanCourse[] {
  const rows = doc.querySelectorAll('#content_1 table tbody tr.trr2');
  const out: PlanCourse[] = [];
  let grp = '',
    attr = '';
  for (const row of rows) {
    const cells = [...row.querySelectorAll('td')].map(td => td.textContent!.trim());
    if (cells.length >= 9) {
      grp = cells[0]!;
      attr = cells[1] || attr;
    }
    const idx = cells.length >= 9 ? 2 : 0;
    const code = cells[idx],
      name = cells[idx + 1];
    if (code && name && /^\d+$/.test(code)) out.push({ code, name, credits: parseFloat(cells[idx + 2] || '') || 0, attr, group: grp, semester: '' });
  }
  return out;
}

export async function fetchTrainingPlan(ctx: Ctx): Promise<PlanCourse[]> {
  const { SEM, BASE, isZhjwxk, isZhjw } = ctx;
  if (isZhjwxk) {
    const html = await fetchPage(BASE + '/jhBks.vjhBksPyfakcbBs.do?m=showBksZxZdxjxjhXmxqkclist&p_xnxq=' + SEM);
    return parsePlan(new DOMParser().parseFromString(html, 'text/html'));
  }
  if (isZhjw) {
    const listHtml = await fetchPage(BASE + '/jhBks.vjhBksPyfakcbBs.do?m=grPyfabks&theRole=bks&theModule=pyfa');
    if (listHtml.includes('accessDenied')) return [];
    const m = /fajhh=(\d+)/.exec(listHtml);
    if (!m) return [];
    const html = await fetchPage(BASE + '/jhBks.vjhBksPyfakcbBs.do?m=index2&theModule=pyfa&p_fajhh=' + m[1]);
    return parseFullProgram(new DOMParser().parseFromString(html, 'text/html'));
  }
  return [];
}
