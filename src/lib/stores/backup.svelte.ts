// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 一键备份（统一导出/导入 JSON：草稿 + 自定义占用 + 概率缓存）
// v4：backupVer=3（+probHist 趋势历史 / volCache 志愿缓存）；导入兼容 v1-3。
// ═══════════════════════════════════════════════════════════════
import { curVer } from '../core/constants';
import { K, store } from '../storage/store';
import type { Draft, ManualEvent, VolDatum } from '../domain/types';
import { mergeHistSeries, sanitizeHistMap, type VolHistMap } from '../domain/probhist';
import { showToast } from './toast.svelte.ts';
import { confirmDialog } from './modal.svelte.ts';
import { draftStore, loadDrafts, importJson } from './drafts.svelte.ts';
import { session } from './session.svelte.ts';
import { search } from './search.svelte.ts';
import { probHist } from './probhist.svelte.ts';
import { mergeImportedVolCache, vol } from './volunteer.svelte.ts';
import { volSession } from '../api/volunteers';
import { volWindowStart } from '../update/check';
import { normSeq } from '../core/utils';

export async function draftCounts(): Promise<{ drafts: number; manual: number; hist: number }> {
  return { drafts: draftStore.drafts.length, manual: session.manualEvents.length, hist: Object.keys(probHist.map).length };
}

export async function backupExport(): Promise<void> {
  const manualEvents = session.manualEvents;
  // 概率缓存随备份走（$state Proxy 先深拷贝，勿直传序列化）
  const hist = probHist.sem === session.SEM ? probHist.map : {};
  const histOk = !!session.SEM && !!Object.keys(hist).length;
  const volOk = !!session.SEM && !!Object.keys(vol.map).length;
  if (!draftStore.drafts.length && !manualEvents.length && !histOk && !volOk) {
    showToast(false, '没有可备份的数据（草稿 / 占用 / 概率缓存均为空）');
    return;
  }
  const data = {
    app: 'NextTHUxk',
    backupVer: 3,
    ver: curVer(),
    sem: session.SEM || '',
    ts: Date.now(),
    drafts: JSON.parse(JSON.stringify(draftStore.drafts)),
    manualEvents: JSON.parse(JSON.stringify(manualEvents)),
    probHist: histOk ? { sem: session.SEM, map: JSON.parse(JSON.stringify(hist)) } : undefined,
    volCache: volOk
      ? {
          sem: session.SEM,
          windowStart: volWindowStart().getTime(),
          map: JSON.parse(JSON.stringify(vol.map)),
          depts: JSON.parse(JSON.stringify(volSession.depts)),
        }
      : undefined,
  };
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fname =
    'nextthuxk-backup-' + (data.sem || 'nosem') + '-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = fname;
  a.style.display = 'none';
  (document.body || document.documentElement).appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(a.href);
  }, 1000);
  const extras: string[] = [];
  if (histOk) extras.push('趋势' + Object.keys(hist).length + '课');
  if (volOk) extras.push('志愿' + Object.keys(vol.map).length + '行');
  showToast(true, '备份已下载：草稿 ' + draftStore.drafts.length + ' 份 · 占用 ' + manualEvents.length + ' 条' + (extras.length ? ' · ' + extras.join(' · ') : ''));
}

export async function backupImport(jsonStr: string): Promise<void> {
  try {
    const data = JSON.parse(jsonStr) as {
      app?: string;
      backupVer?: number;
      sem?: string;
      drafts?: Draft[];
      manualEvents?: ManualEvent[];
      stageCart?: Draft['courses'];
      probHist?: { sem?: string; map?: VolHistMap };
      volCache?: { sem?: string; windowStart?: number; map?: Record<string, VolDatum>; depts?: Record<string, number> };
    };
    if (!data || data.app !== 'NextTHUxk' || (Number(data.backupVer) !== 1 && Number(data.backupVer) !== 2 && Number(data.backupVer) !== 3)) {
      throw new Error('不是 NextTHUxk 备份文件（app/backupVer 校验失败）');
    }
    const draftRows = Array.isArray(data.drafts) ? data.drafts : [];
    const manualRows = Array.isArray(data.manualEvents) ? data.manualEvents : [];
    const histIn = data.probHist && data.probHist.map && Object.keys(data.probHist.map).length ? data.probHist : null;
    const volIn = data.volCache && data.volCache.map && Object.keys(data.volCache.map).length ? data.volCache : null;
    if (!draftRows.length && !manualRows.length && !histIn && !volIn && !(Array.isArray(data.stageCart) && data.stageCart.length)) {
      throw new Error('备份文件中没有可导入的数据');
    }
    if (data.sem && session.SEM && data.sem !== session.SEM) {
      if (!(await confirmDialog('学期不符', '备份文件学期为 ' + data.sem + '，当前为 ' + session.SEM + '。仍要导入吗？'))) return;
    }
    // 1) v1 暂存 → 并入活跃草稿（升级直弃语义下仍尽力抢救课程内容）
    let stageAdded = 0;
    if (Array.isArray(data.stageCart) && data.stageCart.length) {
      const res = importJson(JSON.stringify({ v: 1, name: '暂存课表', courses: data.stageCart }));
      if (res.ok) stageAdded = parseInt((res.msg.match(/导入 (\d+) 门/) || [])[1] || '0', 10);
    }
    // 2) 草稿：同名替换内容、异名追加；满 5 份时替换交互
    let dAdd = 0,
      dRep = 0,
      dSkip = 0;
    for (let i = 0; i < draftRows.length; i++) {
      const dd = draftRows[i];
      if (!dd || !Array.isArray(dd.courses)) {
        dSkip++;
        continue;
      }
      dd.name = (dd.name || '').trim() || '导入草稿 ' + (i + 1);
      const exist = draftStore.drafts.find(x => x.name === dd.name);
      if (exist) {
        exist.courses = dd.courses;
        exist.createdAt = dd.createdAt || exist.createdAt || Date.now();
        if (!exist.id) exist.id = Date.now();
        dRep++;
        continue;
      }
      if (draftStore.drafts.length >= 5) {
        showToast(false, '草稿已满(5/5)，导入「' + dd.name + '」被跳过（请先删除一份再试）');
        dSkip++;
        continue;
      }
      draftStore.drafts.push({ id: dd.id || Date.now() + i, name: dd.name, courses: dd.courses, createdAt: dd.createdAt || Date.now() });
      dAdd++;
    }
    if (dAdd || dRep) {
      try {
        await store.set(K.drafts, JSON.parse(JSON.stringify(draftStore.drafts)));
      } catch {
        /* fail-soft */
      }
    }
    // 3) 占用：按 名称+星期+起止 去重
    let mAdd = 0;
    const mSeen = new Set(session.manualEvents.map(m => [m.name, m.day, m.begin, m.end].join('|')));
    manualRows.forEach(m => {
      if (!m || !m.name) return;
      const key = [m.name, m.day, m.begin, m.end].join('|');
      if (mSeen.has(key)) return;
      mSeen.add(key);
      const id = Date.now() + mAdd;
      session.manualEvents.push({
        id,
        name: m.name,
        code: 'manual-' + id,
        seq: '0',
        day: parseInt(String(m.day), 10) || 1,
        begin: m.begin || '18:00',
        end: m.end || '19:30',
        time: '',
        manual: true,
        credits: 0,
      });
      mAdd++;
    });
    if (mAdd) {
      try {
        await store.set(K.manualEvents, JSON.parse(JSON.stringify(session.manualEvents)));
      } catch {
        /* fail-soft */
      }
    }
    // 4) 概率趋势历史：备份学期与当前一致才并入（逐点合并：按 t 排序去重 / 同窗替换 / 60 窗口截断）
    let histAdd = 0;
    let histSkipSem = false;
    let histNotReady = false;
    if (histIn) {
      if (String(histIn.sem || data.sem || '') !== session.SEM) {
        histSkipSem = true;
      } else {
        if (!probHist.ready) await waitProbHistReady();
        if (!probHist.ready) {
          histNotReady = true;
        } else if (probHist.sem === session.SEM) {
          const incoming = sanitizeHistMap(histIn.map!);
          if (Object.keys(incoming).length) {
            histAdd = mergeHistSeries(probHist.map, incoming);
            if (histAdd) {
              try {
                await store.set(K.probHist, { sem: session.SEM, map: JSON.parse(JSON.stringify(probHist.map)) });
              } catch {
                /* fail-soft */
              }
            }
          }
        }
      }
    }
    // 5) 志愿缓存：同学期且同检查点窗口才并入（跨学期/跨窗口数据陈旧，展示会失真——明确跳过）
    let volAdd = -1;
    let volSkipSem = false;
    if (volIn) {
      if (String(volIn.sem || data.sem || '') !== session.SEM) {
        volSkipSem = true;
      } else {
        volAdd = mergeImportedVolCache(
          session.SEM,
          Number(volIn.windowStart) || 0,
          volIn.map!,
          volIn.depts || {},
          session.allCourses.concat(search.rows || []),
        );
      }
    }
    const parts: string[] = [];
    if (stageAdded) parts.push('暂存并入+' + stageAdded);
    if (dAdd) parts.push('草稿新增' + dAdd);
    if (dRep) parts.push('草稿替换' + dRep);
    if (dSkip) parts.push('草稿跳过' + dSkip);
    if (mAdd) parts.push('占用+' + mAdd);
    if (histAdd) parts.push('趋势历史+' + histAdd + '课');
    else if (histSkipSem) parts.push('趋势历史学期不符（跳过）');
    else if (histNotReady) parts.push('趋势历史未就绪（跳过）');
    if (volAdd > 0) parts.push('志愿缓存+' + volAdd + '行');
    else if (volSkipSem) parts.push('志愿缓存学期不符（跳过）');
    else if (volIn && volAdd < 0) parts.push('志愿缓存窗口不符（跳过）');
    showToast(true, parts.length ? '备份导入完成：' + parts.join(' · ') : '备份导入完成：无新增（数据均已存在）');
    void normSeq;
    void loadDrafts;
  } catch (e) {
    showToast(false, '导入失败: ' + (e instanceof Error ? e.message : String(e)));
  }
}

/** 水合竞态保险：probHist.ready 置位前轮询等待（≤3s） */
async function waitProbHistReady(): Promise<void> {
  for (let i = 0; i < 60 && !probHist.ready; i++) await new Promise(r => setTimeout(r, 50));
}
