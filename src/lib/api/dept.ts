// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 院系代码表与推断
// 课号中段院系码回退：8 位课号第 2-4 位 = 开课院系码；须在值域白名单内。
// ═══════════════════════════════════════════════════════════════
import { isSportsCourse } from '../domain/flags';
import type { Course } from '../domain/types';

export const DEPT_CODES: Record<string, string> = {
  '建筑学院': '000', '城规系': '001', '建筑系': '002', '土木系': '003', '水利系': '004',
  '环境学院': '005', '机械系': '012', '精仪系': '013', '能动系': '014', '车辆学院': '015',
  '工业工程系': '016', '电机系': '022', '电子系': '023', '计算机系': '024', '自动化系': '025',
  '集成电路学院': '026', '航院': '031', '工物系': '032', '化工系': '034', '材料学院': '035',
  '数学系': '042', '物理系': '043', '化学系': '044', '生命学院': '045', '地学系': '046',
  '交叉信息院': '047', '高研院': '048', '经管学院': '051', '公管学院': '059', '金融学院': '060',
  '中文系': '063', '外文系': '064', '法学院': '066', '新闻学院': '067', '马克思主义学院': '068',
  '人文学院': '069', '社科学院': '070', '体育部': '072', '图书馆': '075', '艺教中心': '078',
  '美术学院': '080', '统计系': '088', '建管系': '091', '天文系': '092', '安全学院': '093',
  '人工智能学院': '094', '心理系': '095', '卫健学院': '096', '苏世民书院': '097', '建筑技术': '099',
  '核研院': '101', '教育学院': '103', '训练中心': '151', '电工电子中心': '155', '学生部': '207',
  '武装部': '209', '教务处': '254', '研究生院': '255', '校医院': '305', '药学院': '402',
  '临床医学院': '405', '软件学院': '410', '网络研究院': '412', '地区研究院': '413', '航发院': '415',
  '语言中心': '420', '新雅书院': '470', '致理书院': '471', '日新书院': '472', '未央书院': '473',
  '行健书院': '475', '求真书院': '476', '为先书院': '477', '秀钟书院': '478', '笃实书院': '479',
  '紫荆书院': '482', '自强书院': '483', '水木书院': '484', '数学教学中心': '492', '医学院': '500',
  '基础医学院': '501', '生医工程学院': '502', '医疗管理学院': '503', '国际研究生院': '599',
  '清华大学全球创新学院': '601',
};

let deptCodeSet: Set<string> | null = null;
const valueSet = () => (deptCodeSet ||= new Set(Object.values(DEPT_CODES)));

export function deptCodeOf(dept: string | undefined): string {
  const d = (dept || '').trim();
  if (!d) return '';
  if (DEPT_CODES[d]) return DEPT_CODES[d]!;
  const hit = Object.keys(DEPT_CODES).find(k => d.includes(k) || k.includes(d));
  return hit ? DEPT_CODES[hit]! : '';
}

export function deptCodeFromCode(code: string): string {
  const s = String(code || '');
  if (!/^\d{8}$/.test(s)) return '';
  return valueSet().has(s.slice(1, 4)) ? s.slice(1, 4) : '';
}

export function deptOfCourse(c: Course): string {
  return deptCodeOf(c.department) || (isSportsCourse(c) ? '' : deptCodeFromCode(c.code));
}

/** 课号 → 院系名反查（department 字段缺位时用；白名单外返回空串） */
export function deptNameOf(code: string): string {
  const v = deptCodeFromCode(code);
  if (!v) return '';
  return Object.keys(DEPT_CODES).find(k => DEPT_CODES[k] === v) || '';
}
