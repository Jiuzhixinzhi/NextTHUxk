// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 选课/退选/志愿调整写 API
// 一次性 token 链 + 业务拒绝字典 + 轮询确认真实结果（不假成功）。
// changeVolunteer 除外：唯一明确无轮询的写 API（固定 1000ms 后直接返回成功）。
// ═══════════════════════════════════════════════════════════════
import type { Course, Ctx, Flag } from '../domain/types';
import { TAG } from '../core/constants';
import { sleep } from '../core/utils';
import { fetchPage, fetchPost } from '../net/http';

export interface XkResult {
  ok: boolean;
  msg: string;
  submitted?: boolean;
  unknown?: boolean;
}

const REJECT_RE =
  /时间冲突|上课时间冲突|先修|不符合|不允许|无法选课|选课失败|提交失败|余量不足|课余量不足|人数已满|已选满|请先|验证码|超出|达不到|不满足|存在冲突|已选过|重复选课|操作被拒绝|被拒绝|失败|上限|已选课程学分/;

/** 通用：GET 搜索页拿 token → POST 表单 → 响应检测（成功/拒绝字典/排队确认页） */
export async function fetchFormSubmit(ctx: Ctx, searchUrl: string, postFields: Record<string, string>): Promise<XkResult> {
  const BASE = ctx.BASE;
  try {
    const html = await fetchPage(searchUrl);
    const tokenMatch = html.match(/name="token"\s+value="([^"]+)"/);
    if (!tokenMatch) return { ok: false, msg: '无法获取 token' };
    postFields.token = tokenMatch[1]!;
    const respText = await fetchPost(BASE + '/xkBks.vxkBksXkbBs.do', new URLSearchParams(postFields));
    if (respText.includes('accessDenied')) return { ok: false, msg: '操作被拒绝（会话失效）' };
    if (respText.includes('加入队列成功')) return { ok: true, submitted: true, msg: '已加入候补队列' };
    if (respText.includes('选课成功')) return { ok: true, submitted: true, msg: '选课成功' };

    const alertMsg = (respText.match(/alert\(["']([^"']{2,160})["']/) || [])[1];
    if (REJECT_RE.test(respText)) {
      const plain = respText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const snippet = (plain.match(/[^ ]{0,20}(?:冲突|先修|不符合|不允许|无法|失败|不足|已满|超出|请先|验证码|拒绝)[^ ]{0,30}/) || [])[0];
      return { ok: false, msg: ((alertMsg || snippet || '选课被教务拒绝').trim()).slice(0, 120) };
    }

    const isQueueConfirm = respText.includes('是否排队') && respText.includes('saveBksKcDl');
    if (isQueueConfirm) {
      await sleep(1500);
      // 关键：第二次 POST 必须用响应页面里的新 token（第一次的 token 已被消耗）
      const newTokenMatch = respText.match(/name="token"\s+value="([^"]+)"/);
      if (!newTokenMatch) {
        return { ok: false, msg: '排队页未返回新 token，请稍后重试' };
      }
      const queueFields = { ...postFields, m: 'saveBksKcDl', token: newTokenMatch[1]! };
      const qText = await fetchPost(BASE + '/xkBks.vxkBksXkbBs.do', new URLSearchParams(queueFields));
      if (qText.includes('加入队列成功')) return { ok: true, submitted: true, msg: '已加入候补队列' };
      if (qText.includes('选课成功')) return { ok: true, submitted: true, msg: '选课成功' };
      const qAlert = (qText.match(/alert\(["']([^"']{2,160})["']/) || [])[1];
      return { ok: false, unknown: true, msg: qAlert || '排队提交后响应无法识别' };
    }

    return {
      ok: false,
      submitted: false,
      unknown: true,
      msg: alertMsg || ('响应无法识别：' + respText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)),
    };
  } catch (e) {
    console.error(TAG, 'fetchFormSubmit ERROR:', e);
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}

/** 轮询等待：总时长 >= 原固定 sleep，提前满足提前返回 */
export async function pollUntil(fn: () => Promise<boolean>, delay: number, tries: number): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    await sleep(delay);
    if (await fn()) return true;
  }
  return false;
}

export async function submitCourse(ctx: Ctx, code: string, seq: string, zy: number, flag: Flag): Promise<XkResult> {
  const { SEM, BASE } = ctx;
  zy = zy || 3;
  flag = flag || 'bx';
  const mSearch = { bx: 'bxSearch', xx: 'xxSearch', rx: 'rxSearch', ty: 'tySearch' }[flag] || 'bxSearch';
  const mVal = { bx: 'saveBxKc', xx: 'saveXxKc', rx: 'saveRxKc', ty: 'saveTyKc' }[flag] || 'saveBxKc';
  const extra = flag === 'rx' ? '&is_zyrxk=1' : '';
  const searchUrl = BASE + '/xkBks.vxkBksXkbBs.do?m=' + mSearch + '&p_xnxq=' + SEM + '&tokenPriFlag=' + flag + extra;
  const idName = { bx: 'p_bxk_id', xx: 'p_xxk_id', rx: 'p_rx_id', ty: 'p_rxTy_id' }[flag]!;
  const zyName = { bx: 'p_bxk_xkzy', xx: 'p_xxk_xkzy', rx: 'p_rx_xkzy', ty: 'p_rxTy_xkzy' }[flag]!;
  const fields: Record<string, string> = { m: mVal, p_xnxq: SEM, tokenPriFlag: flag, page: '' };
  fields[idName] = SEM + ';' + code + ';' + seq + ';';
  fields[zyName] = String(zy);
  if (flag === 'rx') {
    fields.is_zyrxk = '1';
    fields.p_rxklxm = '';
  }
  if (flag === 'ty') fields.rxTyType = '';
  const res = await fetchFormSubmit(ctx, searchUrl, fields);
  if (!res.submitted) {
    if (!res.unknown) return res;
    const hitSelUnknown = async () => {
      const sel = await fetchSelectedForWrite(ctx);
      return sel.some(s => s.code === code && String(s.seq) === String(seq));
    };
    if (await pollUntil(hitSelUnknown, 700, 3)) return { ok: true, msg: '选课成功' };
    const candUnknown = await fetchCandidatesForWrite(ctx);
    if (candUnknown.some(s => s.code === code && String(s.seq) === String(seq))) return { ok: true, msg: '已加入候补队列' };
    return { ok: false, msg: res.msg };
  }
  const hitSel = async () => {
    const sel = await fetchSelectedForWrite(ctx);
    return sel.some(s => s.code === code && String(s.seq) === String(seq));
  };
  if (await pollUntil(hitSel, 700, 3)) return { ok: true, msg: '选课成功' };
  const cand = await fetchCandidatesForWrite(ctx);
  const foundQueue = cand.some(s => s.code === code && String(s.seq) === String(seq));
  return foundQueue ? { ok: true, msg: '已加入候补队列' } : { ok: false, msg: '选课未生效，请确认课程类型是否正确' };
}

export async function dropCourse(ctx: Ctx, code: string, seq: string, isQueue: boolean): Promise<XkResult> {
  const { SEM, BASE } = ctx;
  if (isQueue) {
    const searchUrl = BASE + '/xkBks.vxkBksXkbBs.do?m=dlSearchTab&p_xnxq=' + SEM;
    const res = await fetchFormSubmit(ctx, searchUrl, { m: 'dlDelete', p_xnxq: SEM, page: '', 'p_del_id': SEM + ';' + code + ';' + seq + ';' });
    if (!res.submitted) return res;
    const gone = async () => {
      const cand = await fetchCandidatesForWrite(ctx);
      return !cand.some(s => s.code === code && String(s.seq) === String(seq));
    };
    if (await pollUntil(gone, 500, 3)) return { ok: true, msg: '已退出候补队列' };
    return { ok: false, msg: '退出队列未生效，请稍后重试' };
  }
  const searchUrl = BASE + '/xkBks.vxkBksXkbBs.do?m=yxSearchTab&p_xnxq=' + SEM + '&tokenPriFlag=yx';
  const res = await fetchFormSubmit(ctx, searchUrl, {
    m: 'deleteYxk',
    p_xnxq: SEM,
    page: '',
    tokenPriFlag: 'yx',
    tk: '',
    jhzy_kch: '',
    jhzy_kxh: '',
    jhzy_zy: '',
    'p_del_id': SEM + ';' + code + ';' + seq + ';',
  });
  if (!res.submitted) return res;
  const gone = async () => {
    const sel = await fetchSelectedForWrite(ctx);
    return !sel.some(s => s.code === code && String(s.seq) === String(seq));
  };
  if (await pollUntil(gone, 500, 3)) return { ok: true, msg: '退选成功' };
  return { ok: false, msg: '退选未生效，请稍后重试' };
}

export async function changeVolunteer(ctx: Ctx, code: string, seq: string, targetZy: number): Promise<XkResult> {
  const { SEM, BASE } = ctx;
  const searchUrl = BASE + '/xkBks.vxkBksXkbBs.do?m=yxSearchTab&p_xnxq=' + SEM + '&tokenPriFlag=yx';
  const res = await fetchFormSubmit(ctx, searchUrl, {
    m: 'changeZY',
    p_xnxq: SEM,
    tokenPriFlag: 'yx',
    page: '',
    tk: '',
    jhzy_kch: code,
    jhzy_kxh: seq,
    jhzy_zy: String(targetZy),
  });
  if (!res.submitted) return { ok: false, msg: '志愿调整提交失败' };
  await sleep(1000);
  return { ok: true, msg: '志愿已调整为第' + targetZy + '志愿' };
}

import { fetchSelectedCourses, fetchCandidateCourses } from './records';

const fetchSelectedForWrite = fetchSelectedCourses;
const fetchCandidatesForWrite = fetchCandidateCourses;
