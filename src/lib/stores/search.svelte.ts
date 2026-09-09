/* eslint-disable */
// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 搜索/筛选状态（随时查询：服务端风暴护栏 + 本地叠加筛选）
// 说明：模块内不直接导出 $derived（编译器禁止）——派生值以纯函数导出，
// 由组件以 $derived.by(() => fn()) 包裹获得响应式。
// ═══════════════════════════════════════════════════════════════
import { PAGE_SIZE, TAG } from '../core/constants';
import { keyOf, lc, normSeq } from '../core/utils';
import { serverSearch, serverSearchStorm, isCodeLike, type SearchOpts } from '../api/search';
import type { Course } from '../domain/types';
import { isSportsCourse } from '../domain/flags';
import { conflictsWithPreview, buildPreviewSlotIndex } from '../domain/conflict';
import { mergeRows, session } from './session.svelte.ts';
import { onLaunchDone } from './bus.svelte.ts';

export const search = $state({
  q: '',
  chip: 'all',
  server: {
    day: '',
    period: '',
    grade: '',
    tongshi: '',
    feature: '',
    bksrem: '',
    yjsrem: '',
  },
  local: {
    conflict: '',
    credits: '',
    reviews: '',
    sort: '',
    xknote: '',
  },
  uiPage: 1,
  browsePage: 1,
  rows: null as Course[] | null,
  totalPages: 0,
  totalRows: 0,
  incomplete: false,
  error: '',
  loadingAll: false,
  searching: false,
  serverSig: '' as string,
  optsSnapshot: null as SearchOpts | null,
  browseHasMore: false,
  jumpCode: '',
  jumpSeq: '',
  jumpTeacher: '',
  lastHit: { code: '', seq: '' },
  scrollSeq: 0,
  loadAllNonce: 0,
});

export function hasText(): boolean {
  return search.q.trim().length > 0;
}

// 启动完成 → 浏览模式（无关键词）自动发起首查（旧版 launch 尾 filterCourses 语义）
onLaunchDone(() => {
  if (search.chip === 'all' && !search.q.trim()) scheduleServerQuery(true);
});

export function buildSearchOpts(): SearchOpts {
  const rawQ = search.q.trim();
  const codeLike = isCodeLike(rawQ);
  const s = search.server;
  return {
    kch: codeLike ? rawQ.split(/[-–]/)[0]!.trim() : '',
    kcm: codeLike ? '' : rawQ,
    weekday: s.day || '',
    section: s.period || '',
    grade: s.grade || '',
    rxklxm: s.tongshi || '',
    kctsm: s.feature || '',
    onlyAvailable: s.bksrem === '>0' || search.chip === 'available',
    gradAvail: s.yjsrem === '>0',
  };
}

function serverSig(): string {
  const s = search.server;
  return JSON.stringify([search.q.trim(), session.SEM, search.browsePage, s.tongshi, s.feature, s.grade, s.bksrem, s.yjsrem, s.day, s.period]);
}

const localChip = (c: string) => c === 'selected' || c === 'queue' || c === 'required' || c === 'elective' || c === 'sports';
const noQChip = (c: string) => c === 'selected' || c === 'queue';

function entryMatchesQ(c: Course, q: string): boolean {
  if (!q) return true;
  return lc(c.name).includes(q) || lc(c.code).includes(q) || lc(c.teacher).includes(q);
}

const TS_MAP: Record<string, string> = { TS1: '人文课组', TS2: '社科课组', TS3: '艺术课组', TS4: '科学课组' };

function computeDisplayed(): Course[] {
  const f = search.chip;
  let list: Course[];
  if (localChip(f)) {
    list = session.allCourses;
    if (f === 'selected') {
      const seen = new Set<string>();
      const candKeys = new Set(session.candidateCourses.map(c => keyOf(c.code, c.seq)));
      list = list.filter(c => {
        if (!c.selected && !c.isCandidate && !candKeys.has(keyOf(c.code, c.seq))) return false;
        const k = keyOf(c.code, c.seq);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    } else if (f === 'queue') {
      const qKeys = new Set(session.candidateCourses.map(c => keyOf(c.code, c.seq)));
      list = list.filter(c => qKeys.has(keyOf(c.code, c.seq)));
    }
  } else {
    list = search.rows || [];
  }
  const q = search.q.toLowerCase();
  if (q && !noQChip(f)) list = list.filter(c => entryMatchesQ(c, q));
  if (f === 'available') list = list.filter(c => c.available);
  else if (f === 'required') list = list.filter(c => c.attr === '必修' || c.typeLabel === '必修');
  else if (f === 'elective') list = list.filter(c => c.attr === '限选' || c.typeLabel === '限选');
  else if (f === 'sports') list = list.filter(c => isSportsCourse(c));
  const cf = search.local.credits;
  if (cf) {
    if (cf === '5+') list = list.filter(c => (c.credits || 0) >= 5);
    else list = list.filter(c => c.credits === parseInt(cf));
  }
  const df = search.server.day;
  const pf = search.server.period;
  if (df || pf) {
    const bothRe = df && pf ? new RegExp(df + '-' + pf + '\\(') : null;
    const dayRe = df ? new RegExp(df + '-\\d') : null;
    const periodRe = pf ? new RegExp('\\d+-' + pf + '\\(') : null;
    list = list.filter(c => {
      if (!c.time) return false;
      if (bothRe) return bothRe.test(c.time);
      if (dayRe) return dayRe.test(c.time);
      return periodRe!.test(c.time);
    });
  }
  const cf2 = search.local.conflict;
  if (cf2) {
    const idx = buildPreviewSlotIndex(previewPoolForConflict(), session.manualEvents);
    list = list.filter(c => {
      const conflicts = conflictsWithPreview(c, idx);
      return cf2 === 'noconflict' ? conflicts.length === 0 : conflicts.length > 0;
    });
  }
  const tsVal = search.server.tongshi;
  if (tsVal) {
    list = list.filter(c => (c.tongshiGroup || '').includes(TS_MAP[tsVal] || ''));
  }
  const featVal = search.server.feature;
  if (featVal) list = list.filter(c => (c.courseFeature || '').includes(featVal));
  const gradeVal = search.server.grade;
  if (gradeVal) list = list.filter(c => (c.grade || '').includes(gradeVal));
  const bksVal = search.server.bksrem;
  if (bksVal === '>0') list = list.filter(c => (c.remaining || 0) > 0);
  const yjsVal = search.server.yjsrem;
  if (yjsVal === '>0') list = list.filter(c => (c.gradRemaining || 0) > 0);
  const xkNote = search.local.xknote.trim().toLowerCase();
  if (xkNote) list = list.filter(c => lc(c.xkTextNote).includes(xkNote));
  const rv = search.local.reviews;
  if (rv) {
    list = list.filter(c => {
      const t = c._tbRef;
      if (!t || !t.count) return false;
      if (rv === 'has') return true;
      if (rv === 'cnt5') return t.count >= 5;
      if (rv === 'r45') return t.avg >= 4.5;
      if (rv === 'r40') return t.avg >= 4;
      if (rv === 'low') return t.avg <= 3;
      return true;
    });
  }
  const sortBy = search.local.sort;
  if (sortBy && list.length > 1) {
    list = list.slice().sort((a, b) => {
      const ta = a._tbRef && a._tbRef.count ? a._tbRef : null;
      const tb = b._tbRef && b._tbRef.count ? b._tbRef : null;
      const av = ta ? ta.avg : null;
      const bv = tb ? tb.avg : null;
      const ca = ta ? ta.count : -1;
      const cb = tb ? tb.count : -1;
      if (sortBy === 'rate_desc') return bv == null ? -1 : av == null ? 1 : bv - av || cb - ca;
      if (sortBy === 'rate_asc') return bv == null ? 1 : av == null ? -1 : av - bv || ca - cb;
      if (sortBy === 'cnt_desc') return cb - ca;
      return 0;
    });
  }
  return list;
}

function previewPoolForConflict(): Course[] {
  const sel = session.allCourses.filter(c => c.selected);
  const seen = new Set(sel.map(c => keyOf(c.code, c.seq)));
  const candidates = session.candidateCourses.filter(cc => !seen.has(keyOf(cc.code, cc.seq)));
  return sel.concat(candidates);
}

export function isSearchMode(): boolean {
  const so = buildSearchOpts();
  return !localChip(search.chip) && !!(so.kch || so.kcm || so.weekday || so.section || so.grade || so.rxklxm || so.kctsm || so.onlyAvailable || so.gradAvail);
}

export function isLocalFiltersActive(): boolean {
  return (
    search.chip === 'available' ||
    search.local.conflict !== '' ||
    search.local.credits !== '' ||
    search.local.xknote.trim() !== '' ||
    search.local.reviews !== ''
  );
}

/** 服务端模式：当前页切片；浏览模式：无切片 */
export function getVisibleRows(): Course[] {
  if (!isSearchMode()) return computeDisplayed();
  const totalPages = totalPagesNow();
  const page = Math.min(Math.max(1, search.uiPage), Math.max(1, totalPages));
  return computeDisplayed().slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
}

export function totalPagesNow(): number {
  return isSearchMode()
    ? isLocalFiltersActive()
      ? Math.max(1, Math.ceil(computeDisplayed().length / PAGE_SIZE))
      : search.totalPages || Math.max(1, Math.ceil(computeDisplayed().length / PAGE_SIZE))
    : 0;
}

export function getPager(): { curPage: number; totalPages: number; totalRows: number; count: number; incomplete: boolean } {
  const totalPages = totalPagesNow();
  const curPage = isSearchMode() ? Math.min(Math.max(1, search.uiPage), Math.max(1, totalPages)) : search.browsePage;
  return { curPage, totalPages, totalRows: search.totalRows, count: computeDisplayed().length, incomplete: search.incomplete };
}

export function getDisplayed(): Course[] {
  return computeDisplayed();
}

// ─── 动作 ─────────────────────────────────────────────────────

const isLocalChipNow = () => localChip(search.chip);

export function onInput(v: string): void {
  search.q = v;
  if (isLocalChipNow()) return;
  scheduleServerQuery(false);
  search.searching = true;
}

export function onEnter(): void {
  if (isLocalChipNow()) return;
  scheduleServerQuery(true);
}

export function clearQuery(): void {
  search.q = '';
  if (isLocalChipNow()) return;
  scheduleServerQuery(true);
}

export function setChip(c: string): void {
  search.chip = c;
  search.uiPage = 1;
  if (localChip(c)) return;
  if (c === 'all' && !search.rows && search.serverSig !== serverSig()) {
    scheduleServerQuery(true);
  } else if (search.serverSig !== serverSig()) {
    scheduleServerQuery(false);
  }
}

export function setServerField(k: 'day' | 'period' | 'grade' | 'tongshi' | 'feature' | 'bksrem' | 'yjsrem', v: string): void {
  search.server[k] = v;
  search.uiPage = 1;
  if (isLocalChipNow()) return;
  scheduleServerQuery(false);
}

export function setLocalField(k: 'conflict' | 'credits' | 'reviews' | 'sort' | 'xknote', v: string): void {
  search.local[k] = v;
  search.uiPage = 1;
}

export function gotoPage(n: number): void {
  if (!isSearchMode()) {
    search.browsePage = Math.max(1, n);
    search.serverSig = '';
    scheduleServerQuery(true);
    return;
  }
  search.uiPage = Math.min(Math.max(1, n), Math.max(1, totalPagesNow()));
}

export function loadAll(): void {
  if (search.loadingAll) return;
  search.loadingAll = true;
  search.loadAllNonce++;
  const sigAtStart = search.serverSig;
  void (async () => {
    try {
      const opts = Object.assign({}, search.optsSnapshot || buildSearchOpts(), { forceAll: true });
      const res = await serverSearchStorm(toCtx(), opts);
      if (search.serverSig !== sigAtStart) {
        console.warn(TAG, 'load all 过期丢弃（查询已变化）');
      } else {
        applyMarks(res.rows || []);
        search.rows = res.rows || [];
        if ((res.rows || []).length) mergeRows(res.rows);
        search.incomplete = !!(res.totalRows && (res.rows || []).length < res.totalRows);
        if (res.totalPages) search.totalPages = res.totalPages;
        if (res.totalRows) search.totalRows = res.totalRows;
        search.error = res.pageKind === 'unknown' ? '教务返回异常页——WebVPN/教务会话可能已失效，请退出重新登录' : '';
      }
    } catch (e) {
      console.warn(TAG, 'load all:', e);
    } finally {
      search.loadingAll = false;
    }
  })();
}

function applyMarks(rows: Course[]): void {
  const selKeys = new Set(session.allCourses.filter(c => c.selected).map(c => keyOf(c.code, c.seq)));
  const candKeys = new Set(session.candidateCourses.map(c => keyOf(c.code, c.seq)));
  rows.forEach(r => {
    const k = keyOf(r.code, r.seq);
    r.selected = selKeys.has(k);
    r.isCandidate = candKeys.has(k);
  });
}

function toCtx() {
  return { SEM: session.SEM, BASE: session.BASE, isZhjwxk: session.isZhjwxk, isZhjw: session.isZhjw, isWebvpn: session.isWebvpn };
}

let ssTimer: ReturnType<typeof setTimeout> | undefined;
export function scheduleServerQuery(immediate: boolean): void {
  clearTimeout(ssTimer);
  if (immediate) {
    ssTimer = undefined;
    void runServerQuery();
    return;
  }
  ssTimer = setTimeout(() => {
    ssTimer = undefined;
    void runServerQuery();
  }, 500);
}

let ssBusy = false;
let ssPending = false;

export async function runServerQuery(): Promise<void> {
  if (ssBusy) {
    ssPending = true;
    return;
  }
  ssBusy = true;
  try {
    for (let guard = 0; guard < 4; guard++) {
      const ranSig = search.serverSig;
      const opts = buildSearchOpts();
      const queryMode = !!(opts.kch || opts.kcm || opts.weekday || opts.section || opts.grade || opts.rxklxm || opts.kctsm || opts.onlyAvailable || opts.gradAvail);
      if (!queryMode) opts.page = search.browsePage || 1;
      let res;
      try {
        res = queryMode ? await serverSearchStorm(toCtx(), opts) : await serverSearch(toCtx(), opts);
        if (queryMode && opts.kch && !(res.rows || []).length) {
          const poolHit = session.allCourses.find(c => c.name && (c.code === opts.kch || c.code.startsWith(opts.kch!)));
          if (poolHit) {
            console.log(TAG, '课号 0 行 → 课名重搜:', opts.kch, '→', poolHit.name);
            const res2 = await serverSearchStorm(toCtx(), Object.assign({}, opts, { kch: '', kcm: poolHit.name }));
            if ((res2.rows || []).length) {
              res = res2;
              opts.kcm = poolHit.name;
            }
          }
        }
        applyMarks(res.rows || []);
        search.rows = res.rows || [];
        search.browseHasMore = res.pageKind === 'ok' && (res.rows || []).length > 0;
        if ((res.rows || []).length) mergeRows(res.rows);
        search.totalPages = res.totalPages || 0;
        search.totalRows = res.totalRows || 0;
        search.incomplete = queryMode && !!(res.totalRows && (res.rows || []).length < res.totalRows);
        search.error =
          res.pageKind === 'unknown'
            ? '教务返回异常页' + (res.htmlHead ? '（' + String(res.htmlHead).slice(0, 80) + '…）' : '') + '——WebVPN/教务会话可能已失效，请退出重新登录'
            : res.pageKind === 'empty'
              ? ''
              : '';
      } catch (e) {
        console.warn(TAG, 'server search scheduled:', e);
        search.rows = search.rows || [];
        search.browseHasMore = false;
        search.error = '查询失败：' + (e instanceof Error ? e.message : String(e));
      }
      if (search.serverSig === ranSig) {
        const snap: SearchOpts = { ...opts };
        delete snap['page'];
        delete snap['forceAll'];
        search.optsSnapshot = snap;
        break;
      }
    }
  } finally {
    ssBusy = false;
  }
  if (ssPending) {
    ssPending = false;
    void runServerQuery();
    return;
  }
  search.searching = false;
  highlightJumpTarget();
}

/** 浏览模式跳页 */
export function browseGoto(page: number): void {
  search.browsePage = Math.max(1, page);
  search.serverSig = '';
  scheduleServerQuery(true);
}

// ─── 跳转定位（课表/草稿 → 左侧搜索定位高亮） ─────────────────
// 身份仲裁（上游 #33「课序会骗人」同款分层）：课序会陈旧/缺位，教师才是最高身份。
// 匹配序：课号+课序+教师 → 课号+教师（唯一直认）→ 课号+课序（旧行为）→ 放弃高亮不冒认。

/** 教师归一（去空白+小写） */
function normTeacher(s: string | undefined | null): string {
  return (s || '').toLowerCase().replace(/\s+/g, '');
}

/** 教师命中：行教师含查询教师即可（多师行「刘烨、王洪川」含「刘烨」）；
 *  反向包含不做——查询串含多师时防「王洪川」单师行误中 */
function teacherHit(r: Course, teacher: string): boolean {
  if (!teacher) return false;
  const t = normTeacher(r.teacher);
  return !!t && (t === teacher || t.includes(teacher));
}

export function jumpTo(code: string, seq: string, teacher?: string): void {
  search.chip = 'all';
  for (const k of Object.keys(search.server)) search.server[k as keyof typeof search.server] = '';
  for (const k of Object.keys(search.local)) search.local[k as keyof typeof search.local] = '';
  search.uiPage = 1;
  search.q = code;
  search.jumpCode = code;
  search.jumpSeq = seq || '0';
  search.jumpTeacher = teacher || '';
  search.serverSig = '';
  search.rows = null;
  scheduleServerQuery(true);
}

export async function highlightJumpTarget(): Promise<void> {
  const code = search.jumpCode;
  if (!code) return;
  const seq = normSeq(search.jumpSeq || '0');
  const teacher = normTeacher(search.jumpTeacher);
  let rows = search.rows || [];
  const findTiered = (): { idx: number; row: Course | null } => {
    const q = search.q.toLowerCase();
    const src = q ? rows.filter(c => entryMatchesQ(c, q)) : rows;
    const sameCode = src.filter(r => String(r.code) === String(code));
    // ① 课号+课序+教师 全信号
    let row = sameCode.find(r => normSeq(r.seq || '0') === seq && teacherHit(r, teacher)) || null;
    // ② 课号+教师：唯一直认；同师多课须课序在师内判得出，判不出不冒认
    if (!row && teacher) {
      const hits = sameCode.filter(r => teacherHit(r, teacher));
      if (hits.length === 1) row = hits[0]!;
      else if (hits.length > 1) row = hits.find(r => normSeq(r.seq || '0') === seq) || null;
    }
    // ③ 课号+课序（旧行为兜底）
    if (!row) row = sameCode.find(r => normSeq(r.seq || '0') === seq) || null;
    return row ? { idx: src.indexOf(row), row } : { idx: -1, row: null };
  };
  let hit = findTiered();
  if (hit.idx < 0 && search.incomplete && search.totalPages >= 2 && search.totalPages <= 25 && !search.loadingAll) {
    console.log(TAG, '跳转目标未落在已探测页，自动补齐全量（共', search.totalRows, '行 /', search.totalPages, '页）:', code + '_' + seq);
    const sigAt = search.serverSig;
    try {
      const opts = Object.assign({}, search.optsSnapshot || buildSearchOpts(), { forceAll: true });
      const res = await serverSearchStorm(toCtx(), opts);
      if (search.serverSig !== sigAt) return;
      applyMarks(res.rows || []);
      search.rows = res.rows || [];
      if ((res.rows || []).length) mergeRows(res.rows);
      search.incomplete = false;
      rows = search.rows || [];
      hit = findTiered();
    } catch {
      /* fail-soft */
    }
  }
  search.jumpCode = '';
  search.jumpTeacher = '';
  if (hit.idx < 0 || !hit.row) return; // 诚实缺省：判不出不高亮，绝不冒认同名第一门
  search.uiPage = Math.floor(hit.idx / PAGE_SIZE) + 1;
  // lastHit 存行原始 seq：高亮选择器按 data-seq={c.seq} 原样匹配（归一化 '1' 会失配 '01'）
  search.lastHit = { code, seq: hit.row.seq || '0' };
  search.scrollSeq++;
}
