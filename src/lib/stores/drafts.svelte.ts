// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 草稿状态：命名方案集合 + 活跃草稿 + 预览目标
// 草稿 = 可直接编辑的工作集；卡片「加入草稿」= 加入活跃草稿（不提交正选），
// 且硬阻断新的时间冲突（对活跃草稿 + 自定义占用做区间重叠检测）。
// ═══════════════════════════════════════════════════════════════
import type { Course, Draft, DraftCourse, Flag } from '../domain/types';
import { TAG } from '../core/constants';
import { normSeq } from '../core/utils';
import { K, store } from '../storage/store';
import {
  draftCourseFrom,
  draftCourseFromSelected,
  draftDiff,
  draftKeyOf,
  newDraft,
  repairDraftCourses,
} from '../domain/draft';
import { allowedFlags, baseFlag } from '../domain/flags';
import { detectConflicts } from '../domain/conflict';
import { previewJoinRows } from '../domain/preview';
import { fetchSelectedCourses } from '../api/records';
import { dropCourse, submitCourse } from '../api/write';
import { confirmDialog, promptDialog } from './modal.svelte.ts';
import { showToast, showXkResult } from './toast.svelte.ts';
import { refreshPlanCoverage, refreshSelected, selectedPreviewRows, knoteRemember, session } from './session.svelte.ts';

export type PreviewTarget = { kind: 'selected' } | { kind: 'draft'; id: number };
export const draftStore = $state({
  drafts: [] as Draft[],
  activeId: 0,
  preview: { kind: 'selected' } as PreviewTarget,
  expandedId: 0,
  promoting: false,
});

export const MAX_DRAFTS = 5;

/** 活跃草稿（优先 activeId；无 ID 时取第一份）——纯函数，组件以 $derived 包裹 */
export function activeDraftNow(): Draft | undefined {
  return draftStore.drafts.find(d => d.id === draftStore.activeId) || draftStore.drafts[0];
}

export function previewCoursesNow(): DraftCourse[] {
  const p = draftStore.preview;
  if (p.kind === 'selected') return selectedPreviewRows() as DraftCourse[];
  const d = draftStore.drafts.find(x => x.id === p.id);
  return d ? d.courses : [];
}

/** 预览行（join 池行 note/time；当前已选含候补） */
export function previewRowsNow(): Course[] {
  const p = draftStore.preview;
  if (p.kind === 'selected') {
    return previewJoinRows(selectedPreviewRows() as Course[], session.allCourses, session.knote);
  }
  const d = draftStore.drafts.find(x => x.id === p.id);
  if (!d) return [];
  return d.courses as unknown as Course[];
}

export function previewIsSelected(): boolean {
  return draftStore.preview.kind === 'selected';
}

function persistSoon(): void {
  debouncedPersist();
}
let saveT: ReturnType<typeof setTimeout> | undefined;
function debouncedPersist(): void {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    saveT = undefined;
    try {
      store.set(K.drafts, JSON.parse(JSON.stringify(draftStore.drafts)));
    } catch (e) {
      console.warn(TAG, 'drafts persist:', e);
    }
  }, 300);
}

export function setPreview(kind: PreviewTarget): void {
  draftStore.preview = kind;
}

export async function loadDrafts(): Promise<void> {
  const saved = (await store.get<Draft[]>(K.drafts).catch(() => [])) || [];
  draftStore.drafts = saved;
  if (draftStore.drafts.some(d => !d.id)) {
    draftStore.drafts.forEach(d => {
      if (!d.id) d.id = Date.now();
    });
  }
  let migrated = false;
  draftStore.drafts.forEach(d => {
    d.courses.forEach(c => {
      if (!c.baseFlag) {
        const ac = session.allCourses.find(x => x.code === c.code);
        c.baseFlag = ac ? baseFlag(ac) : 'rx';
        migrated = true;
      }
    });
  });
  // 草稿 ID 全局唯一（备份导入/旧数据可能撞 id：each (d.id) 键控崩溃）
  const seenIds = new Set<number>();
  let idFixed = false;
  draftStore.drafts.forEach((d, i) => {
    if (!d.id || seenIds.has(d.id)) {
      d.id = Date.now() + i;
      idFixed = true;
    }
    seenIds.add(d.id);
  });
  if (idFixed) migrated = true;
  if (migrated) persistSoon();
  if (draftStore.activeId && !draftStore.drafts.some(d => d.id === draftStore.activeId)) draftStore.activeId = draftStore.drafts[0]?.id || 0;
  if (!draftStore.activeId) draftStore.activeId = draftStore.drafts[0]?.id || 0;
  if (session.allCourses.length && draftStore.drafts.length) refreshCoverage();
}

function refreshCoverage(): void {
  refreshPlanCoverage(draftStore.drafts.map(d => d.courses));
}

/** 保证存在活跃草稿（首个加入自动创建） */
export function ensureActiveDraft(): Draft {
  let d = activeDraftNow();
  if (!d) {
    d = newDraft('草稿' + (draftStore.drafts.length + 1), []);
    draftStore.drafts.push(d);
    draftStore.activeId = d.id;
    persistSoon();
  }
  return d;
}

type AddResult = { ok: boolean; msg: string };

/** 卡片「加入草稿」：不提交正选；硬阻断新的时间冲突（对活跃草稿 + 自定义占用） */
export function addCourseToActive(c: Course, flag: Flag, zy: number): AddResult {
  const d = ensureActiveDraft();
  const key = draftKeyOf(c);
  if (d.courses.some(s => draftKeyOf(s) === key)) return { ok: false, msg: '该课程已在草稿' + (draftStore.drafts.length ? '「' + d.name + '」' : '') + '中' };
  const dc = draftCourseFrom(c, flag, zy, baseFlag(c));
  const candidateLike = { ...dc, manual: false as const, day: undefined, begin: undefined, end: undefined } as Course;
  const conflicts = detectConflicts(
    (d.courses as unknown as Course[]).concat([candidateLike]),
    session.manualEvents,
  ).filter(x => x.a === dc.name || x.b === dc.name);
  if (conflicts.length) {
    const c0 = conflicts[0]!;
    return { ok: false, msg: '新增会与「' + (c0.a === dc.name ? c0.b : c0.a) + '」在 ' + c0.day + ' ' + c0.slot + ' 冲突——已阻止加入' };
  }
  d.courses.push(dc);
  knoteRemember(c.code, c.seq, c.note || c.xkTextNote || '', c.time || '');
  persistSoon();
  refreshCoverage();
  return { ok: true, msg: '已加入草稿「' + d.name + '」' };
}

/** 活跃草稿：改 flag/zy */
export function updateActiveCourse(idx: number, patch: Partial<Pick<DraftCourse, 'flag' | 'zy'>>): void {
  const d = activeDraftNow();
  if (!d || !d.courses[idx]) return;
  Object.assign(d.courses[idx]!, patch);
  persistSoon();
  refreshCoverage();
}

export function removeActiveCourse(idx: number): void {
  const d = activeDraftNow();
  if (!d || !d.courses[idx]) return;
  const name = d.courses[idx]!.name;
  d.courses.splice(idx, 1);
  persistSoon();
  refreshCoverage();
  showToast(true, '已从草稿「' + d.name + '」移除「' + name + '」');
}

/** 任意草稿行修改（非活跃草稿的展开编辑） */
export function updateDraftCourse(draftId: number, idx: number, patch: Partial<Pick<DraftCourse, 'flag' | 'zy'>>): void {
  const d = draftStore.drafts.find((x) => x.id === draftId);
  if (!d || !d.courses[idx]) return;
  Object.assign(d.courses[idx]!, patch);
  persistSoon();
  refreshCoverage();
}

export function removeDraftCourse(draftId: number, idx: number): void {
  const d = draftStore.drafts.find((x) => x.id === draftId);
  if (!d || !d.courses[idx]) return;
  d.courses.splice(idx, 1);
  persistSoon();
  refreshCoverage();
}

export async function createDraft(): Promise<void> {
  if (draftStore.drafts.length >= MAX_DRAFTS) {
    showToast(false, '草稿已满（' + MAX_DRAFTS + '/' + MAX_DRAFTS + '），请先删除一份');
    return;
  }
  const name = await promptDialog('新建草稿', '草稿' + (draftStore.drafts.length + 1));
  const d = newDraft((name || '').trim() || '草稿' + (draftStore.drafts.length + 1), []);
  draftStore.drafts.push(d);
  draftStore.activeId = d.id;
  persistSoon();
  refreshCoverage();
  showToast(true, '已新建草稿「' + d.name + '」');
}

export function setActive(id: number): void {
  draftStore.activeId = id;
}

export function toggleExpand(id: number): void {
  draftStore.expandedId = draftStore.expandedId === id ? 0 : id;
}

export async function deleteDraft(id: number): Promise<void> {
  const d = draftStore.drafts.find(x => x.id === id);
  if (!d) return;
  if (!(await confirmDialog('删除草稿「' + d.name + '」？', '删除后无法恢复（导出分享可留档）。'))) return;
  const wasActive = draftStore.activeId === id;
  draftStore.drafts = draftStore.drafts.filter(x => x.id !== id);
  if (wasActive) draftStore.activeId = draftStore.drafts[0]?.id || 0;
  if (draftStore.preview.kind === 'draft' && draftStore.preview.id === id) draftStore.preview = { kind: 'selected' };
  if (draftStore.expandedId === id) draftStore.expandedId = 0;
  persistSoon();
  refreshCoverage();
  showToast(true, '已删除草稿「' + d.name + '」');
}

export async function renameDraft(id: number): Promise<void> {
  const d = draftStore.drafts.find(x => x.id === id);
  if (!d) return;
  const name = await promptDialog('重命名草稿', d.name);
  if (!name || !name.trim() || name.trim() === d.name) return;
  d.name = name.trim();
  persistSoon();
  showToast(true, '已重命名为「' + d.name + '」');
}

/** 已选载入：当前已选整表并入活跃草稿（按课班去重） */
export function loadSelectedIntoActive(): AddResult {
  const selected = session.allCourses.filter(c => c.selected);
  if (!selected.length) return { ok: false, msg: '没有已选课程' };
  const d = ensureActiveDraft();
  let added = 0,
    skipped = 0;
  const seen = new Set(d.courses.map(draftKeyOf));
  selected.forEach(row => {
    const key = draftKeyOf(row);
    if (seen.has(key)) {
      skipped++;
      return;
    }
    seen.add(key);
    d.courses.push(draftCourseFromSelected(row));
    knoteRemember(row.code, row.seq, row.note || row.xkTextNote || '', row.time || '');
    added++;
  });
  if (!added) return { ok: false, msg: '所选课程均已在草稿「' + d.name + '」中' };
  persistSoon();
  refreshCoverage();
  return { ok: true, msg: '已载入 ' + added + ' 门已选课程到草稿「' + d.name + '」' + (skipped ? '（跳过已在稿 ' + skipped + ' 门）' : '') };
}

/** JSON 导入（分享格式）：并入活跃草稿 */
export function importJson(jsonStr: string): AddResult {
  let data: { name?: string; courses: unknown[] };
  try {
    data = JSON.parse(jsonStr.trim());
  } catch {
    return { ok: false, msg: '导入失败: JSON 解析错误' };
  }
  if (!Array.isArray(data.courses)) return { ok: false, msg: '导入失败: 数据格式错误' };
  const d = ensureActiveDraft();
  let added = 0;
  const seen = new Set(d.courses.map(draftKeyOf));
  data.courses.forEach((raw: unknown) => {
    const c = raw as Partial<DraftCourse>;
    if (!c || typeof c !== 'object' || !c.code) return;
    const k = c.code + '_' + normSeq(String(c.seq || '0'));
    if (seen.has(k)) return;
    seen.add(k);
    const fallbackFlag = (c.baseFlag as Flag) || 'rx';
    const push: DraftCourse = {
      code: c.code,
      seq: c.seq || '0',
      name: c.name || '',
      teacher: c.teacher || '',
      time: c.time || '',
      credits: c.credits || 0,
      flag: (c.flag as Flag) || fallbackFlag,
      zy: parseInt(String(c.zy), 10) || 3,
      baseFlag: fallbackFlag,
      note: c.note || '',
    };
    const ac = session.allCourses.find(x => x.code === c.code && String(x.seq || '0') === String(c.seq || '0'));
    if (!push.baseFlag) push.baseFlag = ac ? baseFlag(ac) : fallbackFlag;
    d.courses.push(push);
    knoteRemember(push.code, push.seq, push.note || (ac?.note || ac?.xkTextNote || ''), push.time || (ac?.time || ''));
    added++;
  });
  if (!added) return { ok: false, msg: '导入完成：没有新增课程（均已存在）' };
  persistSoon();
  refreshCoverage();
  return { ok: true, msg: '已导入 ' + added + ' 门课程到草稿「' + d.name + '」' };
}

export function exportText(draft: Draft): string {
  return JSON.stringify({
    v: 1,
    name: draft.name,
    courses: draft.courses.map(c => ({
      code: c.code,
      seq: c.seq,
      name: c.name,
      teacher: c.teacher,
      time: c.time,
      credits: c.credits,
      flag: c.flag,
      zy: c.zy,
      baseFlag: c.baseFlag,
    })),
  });
}

export async function copyExport(draft: Draft): Promise<void> {
  const json = exportText(draft);
  try {
    await navigator.clipboard.writeText(json);
    showToast(true, '「' + draft.name + '」已复制到剪贴板，可分享给他人');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = json;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast(true, '「' + draft.name + '」已复制到剪贴板');
  }
}

/** 提交选课（差量对齐）：与已选重合课不动，只退多余、选新增 */
export async function promote(draft: Draft): Promise<void> {
  if (draftStore.promoting) {
    showToast(false, '提交进行中，请稍候…');
    return;
  }
  draftStore.promoting = true;
  try {
    if (!draft.courses.length) {
      showToast(false, '草稿「' + draft.name + '」没有课程');
      return;
    }
    const current = await fetchSelectedCourses({ SEM: session.SEM, BASE: session.BASE, isZhjwxk: session.isZhjwxk, isZhjw: session.isZhjw, isWebvpn: session.isWebvpn });
    const { kept, toDrop, toAdd } = draftDiff(current, draft.courses);
    if (!toDrop.length && !toAdd.length) {
      showToast(true, '课表「' + draft.name + '」与当前已选一致，无需提交');
      return;
    }
    const ok = await confirmDialog(
      '提交「' + draft.name + '」？',
      '保留重合 ' + kept.length + ' 门 · 退选 ' + toDrop.length + ' 门 · 新选 ' + toAdd.length + ' 门。',
      false,
    );
    if (!ok) return;
    const ctx = { SEM: session.SEM, BASE: session.BASE, isZhjwxk: session.isZhjwxk, isZhjw: session.isZhjw, isWebvpn: session.isWebvpn };
    for (let i = 0; i < toDrop.length; i++) {
      showToast(false, '退选差量 ' + (i + 1) + '/' + toDrop.length + ': ' + toDrop[i]!.name);
      const isQueue = session.candidateCourses.some(c => c.code === toDrop[i]!.code && String(c.seq) === String(toDrop[i]!.seq));
      const r = await dropCourse(ctx, toDrop[i]!.code, toDrop[i]!.seq, isQueue);
      if (!r.ok) {
        await refreshSelectedNoModal();
        showToast(false, '提交中断：退选「' + toDrop[i]!.name + '」失败 — ' + (r.msg || '未知错误') + '（此前已退 ' + i + ' 门），请刷新核对后重试');
        return;
      }
      await new Promise(r2 => setTimeout(r2, 1000));
    }
    for (let i = 0; i < toAdd.length; i++) {
      const c = toAdd[i]!;
      showToast(false, '新选差量 ' + (i + 1) + '/' + toAdd.length + ': ' + c.name);
      const r = await submitCourse(ctx, c.code, c.seq, c.zy || 3, c.flag || 'bx');
      if (!r.ok) {
        await refreshSelectedNoModal();
        showToast(false, '提交中断：新选「' + c.name + '」未生效 — ' + (r.msg || '未知错误') + '（此前已选 ' + i + ' 门、已退 ' + toDrop.length + ' 门），请刷新核对后重试');
        return;
      }
      await new Promise(r2 => setTimeout(r2, 2000));
    }
    await refreshSelectedNoModal();
    showToast(true, '课表「' + draft.name + '」已提交：新选 ' + toAdd.length + ' · 退选 ' + toDrop.length + ' · 保留 ' + kept.length);
  } catch (e) {
    showToast(false, '提交出错: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    draftStore.promoting = false;
  }
}

async function refreshSelectedNoModal() {
  await refreshSelected(false).catch(() => {});
}

/** 草稿行 flag 合法性修复（载入时） */
export function repairCourseFlag(c: DraftCourse): Flag {
  const bf = c.baseFlag || 'rx';
  const allowed = allowedFlags(bf);
  if (!allowed.includes(c.flag)) {
    c.flag = allowed[0]!;
    persistSoon();
  }
  return c.flag;
}

export function normSeqK(s: string | number): string {
  return normSeq(s);
}
