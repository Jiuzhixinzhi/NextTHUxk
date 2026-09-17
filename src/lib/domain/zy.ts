// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 志愿号分配（纯计算核：server 权威 > confirmed 缓存 > 一级课表）
// B3 自 stores/session.resolveCourseZy 抽出；IO（弹窗/持久化/levelTable 拉取）
// 由调用方注入，本模块不 import svelte、不碰 DOM。
// ═══════════════════════════════════════════════════════════════
import type { Course } from './types';
import { keyOf } from '../core/utils';

/** 一级课表行（课程类型源；session.levelMap / fetchLevelTable 同构） */
export interface LevelInfo {
  typeCode: string;
  typeLabel: string;
  attr: string;
}

export interface ZyCacheEntry {
  zy: number;
  typeCode: string;
  typeLabel: string;
  confirmed: boolean;
}
export type ZyCacheMap = Record<string, ZyCacheEntry>;

export interface ZyAssignResult {
  /** 仍未取得志愿号的已选行（排队阶段默认第三志愿；浏览阶段可弹窗询问） */
  missingZy: Course[];
  /** 缓存是否有新写入（调用方据此决定是否落盘） */
  cacheUpdated: boolean;
}

/** 已选行志愿号分配：server 行带 zy → 权威写缓存（confirmed）；否则 confirmed
 *  缓存复用；再否则查一级课表（惰性取一次）补类型，行进 missingZy。
 *  非已选行清 zy/类型（未入 selMap 的池行不保留志愿号——既有语义）。
 *  键全部走 keyOf 归一（历史 Bug：原始课序拼键查归一后的 levelMap，
 *  前导零课班丢 typeCode/typeLabel）。 */
export async function assignZy(
  courses: Course[],
  selMap: Record<string, Course>,
  cache: ZyCacheMap,
  getLevelMap: () => Promise<Record<string, LevelInfo>>,
): Promise<ZyAssignResult> {
  let cacheUpdated = false;
  const missingZy: Course[] = [];
  let levelMap: Record<string, LevelInfo> | null = null;
  for (const c of courses) {
    const key = keyOf(c.code, c.seq);
    const s = selMap[key];
    c.selected = !!s;
    if (s) {
      if (s.zy && s.zy > 0) {
        c.zy = s.zy;
        c.typeCode = s.typeCode || '';
        c.typeLabel = s.typeLabel || '';
        cache[key] = { zy: s.zy, typeCode: s.typeCode || '', typeLabel: s.typeLabel || '', confirmed: true };
        cacheUpdated = true;
      } else {
        const cached = cache[key];
        if (cached && cached.zy > 0 && cached.confirmed) {
          c.zy = cached.zy;
          c.typeCode = cached.typeCode;
          c.typeLabel = cached.typeLabel;
        } else {
          if (!levelMap) levelMap = await getLevelMap();
          const lt = levelMap[key];
          if (lt) {
            c.typeCode = lt.typeCode;
            c.typeLabel = lt.typeLabel;
          } else {
            c.typeCode = s.typeCode || '';
            c.typeLabel = s.typeLabel || '';
          }
          c.zy = cached && cached.zy > 0 ? cached.zy : 0;
          missingZy.push(c);
        }
      }
    } else {
      c.zy = 0;
      c.typeCode = '';
      c.typeLabel = '';
    }
  }
  return { missingZy, cacheUpdated };
}

/** 排队阶段缺号默认第三志愿（不弹窗；confirmed:false——教务正式数据到货可覆盖） */
export function applyZyDefaults(missing: Course[], cache: ZyCacheMap): boolean {
  missing.forEach(c => {
    c.zy = 3;
    cache[keyOf(c.code, c.seq)] = { zy: 3, typeCode: c.typeCode || '', typeLabel: c.typeLabel || '', confirmed: false };
  });
  return missing.length > 0;
}

/** 弹窗手填志愿号落位——v2 语义恢复：手填即 confirmed:true 持久，
 *  跨会话/跨刷新不再重复询问（v3 曾标 confirmed:false 且缓存不水合，弹窗链路整体断裂）。 */
export function applyZyAnswers(missing: Course[], values: number[], cache: ZyCacheMap): boolean {
  let updated = false;
  missing.forEach((c, i) => {
    if (values[i] && values[i]! > 0) {
      c.zy = values[i]!;
      cache[keyOf(c.code, c.seq)] = { zy: c.zy, typeCode: c.typeCode || '', typeLabel: c.typeLabel || '', confirmed: true };
      updated = true;
    }
  });
  return updated;
}
