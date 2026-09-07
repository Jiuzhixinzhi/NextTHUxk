// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 常量
// ═══════════════════════════════════════════════════════════════
import type { Flag } from '../domain/types';

export const TAG = '[NextTHUxk]';

/** 存储键前缀 */
export const SP = 'nextthuxk_';

/** 存储结构版本：结构变更必须递增（不匹配即整体清缓存）；7 = v3.0.0 草稿模型 + AI/暂存移除 */
export const DATA_VER = 7;

/** 发布版本（与 manifest.json 同步） */
export const CUR_VER = '3.0.0';

/** 构建标记：面板+启动日志可见，防旧构建疑案 */
export const BUILD = '3000003';

/** 存在严重缺陷的版本（顶部红色警示横幅） */
export const DANGEROUS_VERS = ['1.0.1', '1.0.2', '1.0.3', '1.1.2', '1.2.0'];

/** 志愿名额校规上限：前两位 [志愿档, 上限]，3 志愿不限 */
export const ZY_LIMITS: Record<Flag, [number, number][]> = {
  bx: [[1, 1], [2, 2], [3, Infinity]],
  xx: [[1, 1], [2, 2], [3, Infinity]],
  rx: [[1, 1], [2, 2], [3, Infinity]],
  ty: [[1, 1], [2, 1], [3, Infinity]],
};

/** 教务志愿统计检查点（每日 8/12/16/20） */
export const VOL_CHECKPOINTS = [8, 12, 16, 20];

/** 服务端每页条数（OneTHU 同款） */
export const PAGE_SIZE = 20;
