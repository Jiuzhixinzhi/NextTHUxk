// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 核心记录抓取：已选 / 候补 / 课余量 / 一级课表 / 分类属性
// 随时查询架构：绝不整库预爬；池内按需 API 同步。
// ═══════════════════════════════════════════════════════════════
import type { Course, Ctx, PlanCourse, QueueDatum } from '../domain/types';
import { TAG } from '../core/constants';
import { normSeq, runPool, sleep } from '../core/utils';
import { fetchPage, fetchPageDual, fetchPost } from '../net/http';
import { pickDecoded } from '../net/decode';
import { gbkPercentEncode } from '../net/gbk';
import { isSportsCourse } from '../domain/flags';
import { creditsOf } from '../domain/credits';
import { matchPoolRow } from '../domain/match';
import { serverSearch } from './search';

// ─── 已选课程 ─────────────────────────────────────────────────

export async function fetchSelectedCourses(ctx: Ctx): Promise<Course[]> {
  if (!ctx.isZhjwxk) return [];
  const { SEM, BASE } = ctx;
  try {
    const html = await fetchPage(BASE + '/xkBks.vxkBksXkbBs.do?m=yxSearchTab&p_xnxq=' + SEM + '&tokenPriFlag=yx&_t=' + Date.now());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const zyMap: Record<string, { zy: number; typeCode: string; typeLabel: string }> = {};
    const zyRe = /\[\s*"(\d+),(\d+)"\s*,\s*"(\d+)"\s*,\s*"(\d+)"\s*,\s*"([^"]*)"\s*,\s*"[^"]*"\s*\]/g;
    let zm: RegExpExecArray | null;
    while ((zm = zyRe.exec(html)) !== null) {
      const [, code, seq, zy, typeCode, isSports] = zm;
      const typeLabel = isSports === '是' ? '体育' : ({ '006': '必修', '008': '限选', '007': '任选' } as Record<string, string>)[typeCode!] || '';
      zyMap[code + '_' + normSeq(seq)] = { zy: parseInt(zy!), typeCode: typeCode!, typeLabel };
    }
    const rows = doc.querySelectorAll('tr.trr2');
    const selected: Course[] = [];
    rows.forEach(row => {
      const radio = row.querySelector('input[name="p_del_id"]');
      const parts = (radio?.getAttribute('value') || '').split(';');
      const code = parts[1] || '';
      const seq = parts[2] || '';
      if (!code) return;
      const tds = row.querySelectorAll('td');
      const cell = (i: number) => (tds[i]?.textContent || '').trim().replace(/\s+/g, ' ');
      const zyInfo = (zyMap[code + '_' + normSeq(seq)] || {}) as { zy: number; typeCode: string; typeLabel: string };
      const cell2 = cell(2) || '';
      // 列序变更史（2026-2027-1 起课号独立成列）致 cell(2) 不可靠 → 退回整行匹配「第X志愿」
      const zyFromCell = cell2.match(/第([一二三])志愿/) || row.textContent!.match(/第([一二三])志愿/) || null;
      const zyNumFromCell = zyFromCell ? ({ '一': 1, '二': 2, '三': 3 } as Record<string, number>)[zyFromCell[1]!] : 0;
      const sportsDetected = !cell(1) && !!zyFromCell;
      const zyNum = zyInfo.zy || zyNumFromCell;
      const typeLabel = sportsDetected ? '体育' : cell(1) || zyInfo.typeLabel || '';
      // 2026-2027-1 起已选表列序变更：课号独立成列 → 自适应取第一个非纯数字候选格
      const nameCell = [cell(4), cell(3)].find(x => x !== '' && !/^\d+$/.test(x)) || '';
      // 教师列：cell(7) 常空（2026-2027-1 列序变更后），cell(2) 实为学分位——
      // 纯数字不是教师，宁可留空（上游 26a9340 同款；整体课表/池行随后回填真名）
      const teacherCell = cell(7) || (/^\d+$/.test(cell(2)) ? '' : cell(2));
      selected.push({
        code,
        seq,
        name: nameCell || cell(1) || code,
        teacher: teacherCell,
        time: cell(6) || cell(3),
        credits: creditsOf(code, parseFloat(cell(8) || cell(4)) || 0),
        typeLabel,
        zy: zyNum || 0,
        typeCode: sportsDetected ? 'ty' : zyInfo.typeCode || '',
      });
    });
    console.log(TAG, 'selected courses:', selected.length);
    if (!selected.length) {
      console.warn(TAG, 'yxSearchTab empty → falling back to level table');
      return await fallbackSelectedFromLevelTable(ctx);
    }
    return selected;
  } catch (e) {
    console.warn(TAG, 'fetch selected:', e);
    try {
      return await fallbackSelectedFromLevelTable(ctx);
    } catch {
      return [];
    }
  }
}

export async function fallbackSelectedFromLevelTable(ctx: Ctx): Promise<Course[]> {
  const map = await fetchLevelTable(ctx);
  const out: Course[] = [];
  for (const key of Object.keys(map)) {
    const i = key.indexOf('_');
    const code = key.slice(0, i)!;
    const seq = key.slice(i + 1) || '0';
    const info = map[key]!;
    out.push({ code, seq, name: '', teacher: '', time: '', credits: 0, typeLabel: info.typeLabel, typeCode: info.typeCode || '', zy: 0, fromLevelTable: true });
  }
  console.log(TAG, 'selected fallback (level table):', out.length);
  return out;
}

// ─── 候补课程 ─────────────────────────────────────────────────

/** 一级课表读课表脚本块：p_id=..;课号 …候选：名 …getElementById('a{节}_{天}') */
export function parseTimetableCandidates(html: string): Course[] {
  const byCode = new Map<string, Course>();
  const re = /p_id=\d+;(\d{6,})[\s\S]{0,600}?候选：([^<&"'\n]{1,60})[\s\S]{0,600}?getElementById\('a([1-6])_([1-7])'\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const code = m[1]!;
    const name = (m[2] || '').trim();
    const slot = m[3]!,
      day = m[4]!;
    if (!code || !name || !day || !slot) continue;
    const block = html.slice(m.index, m.index + m[0].length);
    const parts = [...block.matchAll(/strHTML1 \+= "；([^"]*)"/g)].map(x => x[1] || '');
    const slotStr = day + '-' + slot + '(' + (parts[2] || '全周') + ')';
    const prev = byCode.get(code);
    if (prev) {
      if (!prev.time!.includes(slotStr)) prev.time += ',' + slotStr;
      continue;
    }
    byCode.set(code, {
      typeLabel: parts[1] || '',
      code,
      name,
      seq: '0',
      queueTotal: 0,
      myPos: 0,
      time: slotStr,
      teacher: parts[0] || '',
      credits: 0,
      typeCode: '007',
      zy: 3,
      isCandidate: true,
      selected: false,
    });
  }
  return [...byCode.values()];
}

/** 极简 HTML 实体解码：够用于单元格内文（&nbsp; 与常见命名/数字实体），
 *  避免 `&nbsp;10720011` 这类前缀把纯数字课号守卫误伤。 */
const decodeCellEntities = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (full, e: string) => {
    if (e[0] === '#') {
      const n = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : full;
    }
    return ({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()] ?? full;
  });

/** dlSearch 候补表解析：td 列序固定。课号须字母数字且至少含一位数字——外校课含
 *  PK/GPK/BW 前缀（同 parseCatalog 守卫）；WL 阶段页面表头/模板行也带 trr class，
 *  其字面标签（课程号/课程名/上课时间…）曾混入候选队列形成无法退选的幽灵行（用户报）。 */
export function parseDlRows(html: string): Course[] {
  const out: Course[] = [];
  const rowRe = /<tr[^>]*class="trr[12]"[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const tds = [...m[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(t =>
      decodeCellEntities(t[1]!.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim(),
    );
    if (tds.length < 7) continue;
    const td = (i: number) => tds[i] || '';
    const typeLabel = td(0);
    const zyStr = td(1);
    const code = td(2);
    const name = td(3);
    const seq = td(4);
    const queueTotal = parseInt(td(5)) || 0;
    const myPos = parseInt(td(6)) || 0;
    if (!/^[A-Za-z0-9]+$/.test(code) || !/\d/.test(code) || !name) continue;
    const zyNum = zyStr.match(/第([一二三1-3])志愿/);
    const typeCode = typeLabel === '体育' ? 'ty' : typeLabel === '必修' ? '006' : typeLabel === '限选' ? '008' : '007';
    out.push({
      code,
      seq: seq || '0',
      name,
      teacher: td(8),
      time: td(7) || '',
      credits: creditsOf(code, 0),
      typeLabel,
      typeCode,
      zy: zyNum ? ({ '一': 1, '二': 2, '三': 3 } as Record<string, number>)[zyNum[1]!] || parseInt(zyNum[1]!) || 3 : 3,
      queueTotal,
      myPos,
      isCandidate: true,
      selected: false,
    });
  }
  return out;
}

/** 候补名单抓取结果：ok=false 表示未取得权威完整名单（dlSearch 失败/翻页丢失/超页截断），
 *  调用方不可据此清理草稿排队标记或过滤提交差量（合法空表 ok=true） */
export interface CandidateFetchResult {
  rows: Course[];
  ok: boolean;
}

export async function fetchCandidateCourses(ctx: Ctx): Promise<CandidateFetchResult> {
  if (!ctx.isZhjwxk) return { rows: [], ok: false };
  const { SEM, BASE } = ctx;
  try {
    const dual = await fetchPageDual(BASE + '/xkBks.vxkBksXkbBs.do?m=dlSearch&p_xnxq=' + SEM).catch((e: unknown) => {
      console.warn(TAG, 'dlSearch failed (' + (e instanceof Error ? e.message : e) + ' → 课表兜底');
      return null;
    });
    if (dual && dual.gbk.includes('accessDenied') && dual.utf8.includes('accessDenied')) return { rows: [], ok: false };
    // 双解码择优（pickDecoded 同款：行数多者胜，平分回退 gbk）；此处保留胜出原文以取 token/共X页
    const gRows = dual ? parseDlRows(dual.gbk) : [];
    const uRows = dual ? parseDlRows(dual.utf8) : [];
    const candidates = uRows.length > gRows.length ? uRows : gRows;
    const html0 = dual ? (uRows.length > gRows.length ? dual.utf8 : dual.gbk) : '';
    // 防御性翻页：候补表分页时单 GET 首页会静默丢行（镜像 fetchCategoryAttrs 的 token POST；
    // 单页者 totalPages=1，零额外请求）
    const token = (html0.match(/name="token"\s+value="([^"]+)"/) || [])[1] || '';
    const rawPages = parseInt((html0.match(/共\s*(\d+)\s*页/) || [])[1] || '', 10) || 1;
    const totalPages = Math.min(rawPages, 10);
    const capped = rawPages > totalPages;
    let pagesDropped = false;
    if (token && totalPages > 1) {
      for (let p = 2; p <= totalPages; p++) {
        try {
          const h = await fetchPost(BASE + '/xkBks.vxkBksXkbBs.do', new URLSearchParams({ m: 'dlSearch', page: String(p), token, p_xnxq: SEM }));
          const more = parseDlRows(h).filter(c => !candidates.some(x => x.code + '_' + normSeq(x.seq) === c.code + '_' + normSeq(c.seq)));
          candidates.push(...more);
          console.log(TAG, 'dlSearch 第' + p + '页: +' + more.length);
        } catch (e) {
          console.warn(TAG, 'dlSearch 第' + p + '页失败:', e);
          pagesDropped = true;
          break;
        }
      }
    }
    const rawRows = (html0.match(/<tr[^>]*class="trr[12]"/g) || []).length;
    console.log(TAG, 'candidate courses:', candidates.length, '（原始表行 ' + rawRows + ' · 共 ' + rawPages + ' 页 · 丢弃 ' + Math.max(0, rawRows - candidates.length) + '）');
    if (!candidates.length) {
      try {
        const kbDual = await fetchPageDual(BASE + '/xkBks.vxkBksXkbBs.do?m=kbSearch&p_xnxq=' + SEM);
        const kbCand = pickDecoded(parseTimetableCandidates, kbDual);
        console.log(TAG, 'dlSearch empty → kbSearch candidates:', kbCand.length);
        if (kbCand.length) return { rows: kbCand, ok: true };
        console.warn(TAG, 'kbSearch 0 candidates: gbk len', kbDual.gbk.length, 'utf8 len', kbDual.utf8.length, 'p_id blocks:', (kbDual.gbk.match(/p_id=/g) || []).length);
      } catch (e) {
        console.warn(TAG, 'kbSearch fallback:', e);
      }
    }
    // ok 仅在「首页成功且翻页无丢失/未截断」时为真（权威完整名单）；否则调用方应保守处理
    return { rows: candidates, ok: !!dual && !pagesDropped && !capped };
  } catch (e) {
    console.warn(TAG, 'candidate fetch:', e);
    return { rows: [], ok: false };
  }
}

/** 候补课元数据回填（按课号单查一页补齐学分/容量/时间）。
 *  shouldPause 由调用方注入（检查点同步传前台占用判定）——前台查询在途时让路，
 *  避免后台 kkxxSearch 污染服务端会话游标（上游 PR #46 同款；api 层不 import stores）。 */
export async function backfillCandidateMeta(ctx: Ctx, candidates: Course[], shouldPause?: () => boolean): Promise<void> {
  const todo = (candidates || []).filter(c => c && c.code && !c.credits);
  if (!todo.length) return;
  await runPool(todo, 4, async c => {
    await sleep(30);
    if (shouldPause?.()) return;
    try {
      const r = await serverSearch(ctx, { kch: c.code });
      const same = (r.rows || []).filter(x => String(x.code) === String(c.code));
      const hit = matchPoolRow(same.length ? same : (r.rows || []), c.seq, c.teacher);
      if (hit) {
        c.credits = hit.credits || 0;
        c.capacity = hit.capacity || 0;
        c.remaining = hit.remaining || 0;
        c.available = !!hit.available;
        if (!c.teacher && hit.teacher) c.teacher = hit.teacher;
        if (!c.time && hit.time) c.time = hit.time;
        c.xkTextNote = hit.xkTextNote || '';
      }
    } catch (e) {
      console.warn(TAG, 'cand meta', c.code, e);
    }
  });
  console.log(TAG, 'candidate metadata backfilled:', todo.length);
}

// ─── 一级课表 / 分类属性（课程类型源） ───────────────────────────

export async function fetchLevelTable(ctx: Ctx): Promise<Record<string, { typeCode: string; typeLabel: string; attr: string }>> {
  if (!ctx.isZhjwxk) return {};
  const { SEM, BASE } = ctx;
  try {
    const url = BASE + '/xkBks.vxkBksXkbBs.do?p_xnxq=' + SEM + '&pathContent=' + gbkPercentEncode('一级课表');
    const dual = await fetchPageDual(url).catch(async () => null);
    const html = dual ? (dual.gbk.includes('trr2') || dual.gbk.includes('trr1') ? dual.gbk : dual.utf8) : await fetchPage(url);
    const map: Record<string, { typeCode: string; typeLabel: string; attr: string }> = {};
    const rowRe = /<tr[^>]*class="trr[12]"[^>]*>([\s\S]*?)<\/tr>/g;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(html)) !== null) {
      const cells = [...m[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(t => t[1]!.replace(/<[^>]*>/g, '').trim().replace(/\s+/g, ' '));
      let code = '',
        seq = '',
        attr = '';
      for (let i = 0; i < cells.length; i++) {
        if (/^\d{8}$/.test(cells[i] || '') && !code) {
          code = cells[i]!;
          seq = cells[i + 1] || '0';
          attr = cells[i + 2] || '';
          if (!/^(必修|限选|任选)$/.test(attr)) attr = '';
        }
      }
      if (!code) continue;
      const isSports = !attr;
      const typeLabel = isSports ? '体育' : attr;
      const typeCode = isSports ? 'ty' : attr === '必修' ? '006' : attr === '限选' ? '008' : '007';
      map[code + '_' + normSeq(seq)] = { typeCode, typeLabel, attr };
    }
    console.log(TAG, 'level table:', Object.keys(map).length, 'courses');
    return map;
  } catch (e) {
    console.warn(TAG, 'level table:', e);
    return {};
  }
}

/** 行类型补齐：搜索/池行从 levelMap + 培养方案 attr 回填 */
export function applyLevelMap(rows: Course[], levelMap: Record<string, { typeCode: string; typeLabel: string; attr: string }>, planData: PlanCourse[]): Course[] {
  const planAttr = new Map<string, string>();
  (planData || []).forEach(p => {
    if (p.code && p.attr) planAttr.set(p.code, p.attr);
  });
  rows.forEach(c => {
    const e = levelMap[c.code + '_' + normSeq(c.seq)];
    if (e) {
      if (e.attr) c.attr = e.attr;
      c.typeLabel = e.typeLabel;
      c.typeCode = e.typeCode;
    } else if (!c.attr && planAttr.has(c.code)) {
      c.attr = planAttr.get(c.code);
    }
  });
  return rows;
}

/** 预选分类页属性（bx/xx tab 方案级小列表；任选/体育 tab 不抓——attr 缺省即任选/department 启发覆盖） */
export async function fetchCategoryAttrs(ctx: Ctx): Promise<Record<string, { typeCode: string; typeLabel: string; attr: string }>> {
  if (!ctx.isZhjwxk) return {};
  const { SEM, BASE } = ctx;
  const out: Record<string, { typeCode: string; typeLabel: string; attr: string }> = {};
  const tabs = [
    { m: 'bxSearch', flag: 'bx', attr: '必修', code: '006' },
    { m: 'xxSearch', flag: 'xx', attr: '限选', code: '008' },
  ];
  const parseRows = (html: string): { code: string; seq: string }[] => {
    const rows: { code: string; seq: string }[] = [];
    for (const seg of html.match(/gridData\w*\s*=\s*\[[\s\S]*?\];/g) || []) {
      const re = /\[\s*"[^"]*"\s*,\s*"([A-Za-z0-9]+)"\s*,\s*"([^"]*)"\s*,\s*"[^"]*"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(seg)) !== null) {
        if (/\d/.test(m[1]!)) rows.push({ code: m[1]!, seq: m[2]! });
      }
    }
    return rows;
  };
  await runPool(tabs, 2, async tab => {
    try {
      const firstUrl = BASE + '/xkBks.vxkBksXkbBs.do?m=' + tab.m + '&p_xnxq=' + SEM + '&tokenPriFlag=' + tab.flag;
      let fh = await fetchPage(firstUrl);
      const token = (fh.match(/name="token"\s+value="([^"]+)"/) || [])[1] || '';
      if (!/gridData\w*\s*=/.test(fh) && token) {
        try {
          fh = await fetchPost(BASE + '/xkBks.vxkBksXkbBs.do', new URLSearchParams({ m: tab.m, page: '1', token, p_xnxq: SEM, tokenPriFlag: tab.flag }));
        } catch {
          /* fallthrough */
        }
      }
      if (!/gridData\w*\s*=/.test(fh)) {
        console.warn(TAG, 'category ' + tab.m + ' 无网格');
        return;
      }
      const totalPages = Math.min(parseInt((fh.match(/共\s*(\d+)\s*页/) || [])[1] || '', 10) || 1, 10);
      const htmls = [fh];
      for (let p = 2; p <= totalPages; p++) {
        try {
          htmls.push(await fetchPost(BASE + '/xkBks.vxkBksXkbBs.do', new URLSearchParams({ m: tab.m, page: String(p), token, p_xnxq: SEM, tokenPriFlag: tab.flag })));
        } catch {
          break;
        }
      }
      let n = 0;
      for (const h of htmls)
        for (const r of parseRows(h)) {
          out[r.code + '_' + normSeq(r.seq)] = { attr: tab.attr, typeCode: tab.code, typeLabel: tab.attr };
          n++;
        }
      console.log(TAG, 'category ' + tab.attr + ': ' + n + ' 门（' + totalPages + ' 页）');
    } catch (e) {
      console.warn(TAG, 'category ' + tab.m + ':', e);
    }
  });
  return out;
}

// ─── 课余量 / 排队 ────────────────────────────────────────────

export async function fetchQueueData(ctx: Ctx, courses: Course[]): Promise<{ map: Record<string, QueueDatum>; phase: boolean }> {
  if (!ctx.isZhjwxk) return { map: {}, phase: false };
  const { SEM, BASE } = ctx;
  try {
    const firstHtml = await fetchPage(BASE + '/xkBks.vxkBksXkbBs.do?m=xkqkSearch&p_xnxq=' + SEM);
    if (!firstHtml.includes('gridData') || firstHtml.includes('accessDenied')) return { map: {}, phase: false };
    const gridRegex = /\[\s*"(\d+)"\s*,\s*"([^"]*?)"\s*,\s*"[^"]*?"\s*,\s*"(\d*)"\s*,\s*"(\d*)"\s*,\s*"[^"]*?"\s*,\s*"[^"]*?"\s*\]/g;
    const map: Record<string, QueueDatum> = {};
    let gm: RegExpExecArray | null;
    while ((gm = gridRegex.exec(firstHtml)) !== null) {
      const key = gm[1]! + '_' + normSeq(gm[2]!);
      map[key] = { code: gm[1]!, seq: gm[2]!, qCapacity: parseInt(gm[3]!) || 0, qRemaining: parseInt(gm[4]!) || 0, qQueue: 0 };
    }
    const token = (firstHtml.match(/name="token"\s+value="([^"]+)"/) || [])[1] || '';
    const formAction = BASE + '/xkBks.vxkBksJxjhBs.do';
    if (token) {
      const codes = [...new Set((courses || []).map(c => String(c.code || '').trim()).filter(Boolean))];
      const kylPost = async (code: string, page: number): Promise<string> => {
        const body = new URLSearchParams({
          m: 'kylSearch',
          page: String(page),
          token,
          'p_sort.p1': '',
          'p_sort.p2': '',
          'p_sort.asc1': 'true',
          'p_sort.asc2': 'true',
          p_xnxq: SEM,
          pathContent: '',
          p_kch: code,
          p_kxh: '',
          p_kcm: '',
          p_skxq: '',
          p_skjc: '',
          bt: '',
        });
        return fetchPost(formAction, body);
      };
      const kylRe = /\[\s*"(\d+)"\s*,\s*"([^"]*?)"\s*,\s*"[^"]*?"\s*,\s*"(\d*)"\s*,\s*"(\d*)"\s*,\s*"[^"]*?"\s*,\s*"[^"]*?"\s*\]/g;
      const mergeKylGrid = (html: string): number => {
        let n = 0;
        let pm: RegExpExecArray | null;
        kylRe.lastIndex = 0;
        while ((pm = kylRe.exec(html)) !== null) {
          const key = pm[1]! + '_' + normSeq(pm[2]!);
          if (!map[key]) {
            map[key] = { code: pm[1]!, seq: pm[2]!, qCapacity: parseInt(pm[3]!) || 0, qRemaining: parseInt(pm[4]!) || 0, qQueue: 0 };
            n++;
          }
        }
        return n;
      };
      await runPool(codes, 5, async (code, idx) => {
        await sleep(30 * (idx % 5));
        try {
          const first = await kylPost(code, 0);
          if (!first.includes('gridData')) return;
          mergeKylGrid(first);
          // 翻页（OneTHU getXkQueueData 同款，页号从 0 起）：单课号也可能几十班——
          // 形势与政策一班一师全学期 ~40 班，一页装不下；只取第 1 页会漏后半教师
          // （用户实锤王洪川班查不到余量）。页数按分页「共N页」，单课号上限 10 页防失控。
          const totalPages = Math.min(parseInt((first.match(/共\s*(\d+)\s*页/) || [])[1] || '', 10) || 1, 10);
          for (let p = 1; p < totalPages; p++) {
            const html = await kylPost(code, p);
            if (!html.includes('gridData')) break;
            if (mergeKylGrid(html) === 0) break;
          }
        } catch (e) {
          console.warn(TAG, 'kyl code', code, e);
        }
      });
    }
    const parts = Object.values(map).map(q => SEM + '_' + q.code + '_' + q.seq);
    const batches: string[][] = [];
    for (let i = 0; i < parts.length; i += 100) batches.push(parts.slice(i, i + 100));
    let qFailStreak = 0;
    let qFailWarned = false;
    let queueFailed = false;
    await runPool(
      batches,
      4,
      async kcMsg =>
        new Promise<void>(resolve => {
          if (qFailStreak >= 3) return resolve();
          fetch(BASE + '/xkBks.vxkBksXkbBs.do?m=selectBksDlCount&kc_message=' + encodeURIComponent(kcMsg.join(';')), { credentials: 'include' })
            .then(async qResp => {
              if (!qResp.ok) {
                qFailStreak++;
                return;
              }
              const qText = new TextDecoder('gbk').decode(await qResp.arrayBuffer());
              const qData = JSON.parse(qText);
              if (Array.isArray(qData)) {
                qData.forEach(obj => {
                  const key = obj.kch + '_' + normSeq(obj.kxh);
                  if (map[key]) map[key].qQueue = parseInt(obj.dlrs) || 0;
                });
                qFailStreak = 0;
              }
            })
            .catch(() => {
              qFailStreak++;
              if (!qFailWarned && qFailStreak >= 3) {
                qFailWarned = true;
                queueFailed = true;
                console.warn(TAG, 'queue count batches keep failing — session may be invalidated');
              }
            })
            .finally(() => resolve());
        }),
    );
    if (queueFailed) console.warn(TAG, 'queue count failed');
    console.log(TAG, 'queue data (pool-sync):', Object.keys(map).length, 'courses');
    return { map, phase: true };
  } catch (e) {
    console.warn(TAG, 'queue data fetch:', e);
    return { map: {}, phase: false };
  }
}

// ─── 课程详情 ─────────────────────────────────────────────────

export async function fetchCourseDetail(ctx: Ctx, teacherId: string, code: string): Promise<Record<string, string> | null> {
  if (!ctx.isZhjwxk) return null;
  const url = ctx.BASE + '/js.vjsKcbBs.do?m=showToXs&p_id=' + encodeURIComponent(teacherId + ';' + code);
  try {
    const html = await fetchPage(url);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('form table table.table-striped') || doc.querySelector('form table.table-striped') || doc.querySelector('table.table-striped');
    if (!table) return null;
    const rows = table.querySelectorAll('tr');
    const fields: Record<string, string> = {};
    const skipLabels = new Set(['课程名', '课程号']);
    rows.forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 2) return;
      const l1 = tds[0]?.textContent?.trim().replace(/：/g, '') || '';
      const v1 = tds[1]?.textContent?.trim() || '';
      if (l1 && v1 && l1.length < 20 && !/^\d+$/.test(l1) && !skipLabels.has(l1)) fields[l1] = v1;
      if (tds.length >= 4) {
        const l2 = tds[2]?.textContent?.trim().replace(/：/g, '') || '';
        const v2 = tds[3]?.textContent?.trim() || '';
        if (l2 && v2 && l2.length < 20 && !/^\d+$/.test(l2) && !skipLabels.has(l2)) fields[l2] = v2;
      }
    });
    return fields;
  } catch (e) {
    console.warn(TAG, 'detail fetch:', e);
    return null;
  }
}

/** 体育课启发（records 用 isSportsCourse 同款语义，避免循环依赖） */
export const isSportsCourseHeuristic = isSportsCourse;
