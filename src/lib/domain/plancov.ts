// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 培养方案覆盖检测（纯函数）
// 覆盖范围：正选 + 全部草稿。特殊规则：体育互通、英语(3)=进阶读写/二外、英语(1)(2)=阅读写作/听说交流。
// ═══════════════════════════════════════════════════════════════
import type { Course, DraftCourse, PlanCourse } from './types';
import { NOT_SPORTS_NAME, isSportsCourse } from './flags';

export interface CoverageRow extends PlanCourse {
  covered: boolean;
  coveredBy: string;
}

export function checkPlanCoverage(planData: PlanCourse[], pool: Course[], drafts: DraftCourse[][]): CoverageRow[] {
  const codes = new Map<string, { name: string; teacher?: string }>();
  const collect = (list: { code: string; name: string; teacher?: string }[]) =>
    list.forEach(c => {
      codes.set(c.code, { name: c.name, teacher: c.teacher });
    });
  pool.filter(c => c.selected).forEach(c => codes.set(c.code, { name: c.name, teacher: c.teacher }));
  drafts.forEach(d => collect(d));
  const lookup = (code: string) => {
    const hit = pool.find(x => x.code === code);
    return hit ? (hit as Course) : undefined;
  };
  const isSports = (code: string) => {
    const c = lookup(code);
    return !!c && isSportsCourse(c);
  };
  const hasSports = [...codes.keys()].some(isSports) || drafts.some(d => d.some(c => isSports(c.code)));
  const isSecondLang = (code: string): boolean => {
    const c = lookup(code);
    const name = c ? c.name : [...codes.keys()].find(k => k === code) ? code : '';
    return !!c && (c.name.includes('第二外国语') || c.name.includes('二外'));
  };
  const hasSecondLang = drafts.some(d => d.some(c => c.name.includes('第二外国语') || c.name.includes('二外'))) || [...codes.keys()].some(isSecondLang);
  const isAdvEnglish = (code: string): boolean => {
    const c = lookup(code);
    return !!c && (c.name.includes('进阶读写') || c.name.includes('进阶'));
  };
  const hasAdvEnglish = drafts.some(d => d.some(c => c.name.includes('进阶读写') || c.name.includes('进阶'))) || [...codes.keys()].some(isAdvEnglish);
  const isBasicEnglish = (code: string): boolean => {
    const c = lookup(code);
    return !!c && (c.name.includes('阅读写作') || c.name.includes('听说交流'));
  };
  const hasBasicEnglish = drafts.some(d => d.some(c => c.name.includes('阅读写作') || c.name.includes('听说交流'))) || [...codes.keys()].some(isBasicEnglish);

  return planData.map(p => {
    let covered = codes.has(p.code);
    let coveredBy = covered ? codes.get(p.code)?.name || codes.get(p.code)?.teacher || '' : '';
    if (!covered && (p.attr === '体育' || p.name.includes('体育') || (p.group || '').includes('体育'))) {
      if (hasSports) {
        covered = true;
        coveredBy = '(已有体育课)';
      }
    }
    if (!covered && /英语\(3\)/.test(p.name)) {
      if (hasAdvEnglish) {
        covered = true;
        coveredBy = '(英语进阶读写)';
      } else if (hasSecondLang) {
        covered = true;
        coveredBy = '(第二外国语替代)';
      }
    }
    if (!covered && /英语\([12]\)/.test(p.name) && hasBasicEnglish) {
      covered = true;
      coveredBy = '(英语阅读写作/听说交流)';
    }
    return { ...p, covered, coveredBy };
  });
}

export function isSportsPlan(p: PlanCourse): boolean {
  return p.attr === '体育' || p.name.includes('体育') || (p.group || '').includes('体育');
}
