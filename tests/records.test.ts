// ═══════════════════════════════════════════════════════════════
// NextTHUxk — records 层解析测试：dlSearch 候补表幽灵行过滤
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { parseDlRows } from '../src/lib/api/records';

const row = (cls: string, tds: string[]) =>
  `<tr class="${cls}">${tds.map(t => `<td>${t}</td>`).join('')}</tr>`;

describe('parseDlRows', () => {
  it('WL 阶段表头行（trr class + 字面标签）不得解析为课程', () => {
    const html = row('trr1', ['选课属性', '志愿', '课程号', '课程名', '课序号', '队列总人数', '我的位置', '上课时间', '任课教师']);
    expect(parseDlRows(html)).toEqual([]);
  });

  it('表头行与真实数据行并存时只留下真实课', () => {
    const html =
      row('trr1', ['选课属性', '志愿', '课程号', '课程名', '课序号', '队列总人数', '我的位置', '上课时间', '任课教师']) +
      row('trr2', ['必修', '第一志愿', '10720011', '微积分', '1', '30', '5', '1-2(1-16周)', '张三']);
    const out = parseDlRows(html);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      code: '10720011',
      seq: '1',
      name: '微积分',
      teacher: '张三',
      time: '1-2(1-16周)',
      typeLabel: '必修',
      typeCode: '006',
      queueTotal: 30,
      myPos: 5,
      isCandidate: true,
    });
  });

  it('非数字课号或缺名行丢弃；缺课序号回落 0', () => {
    const html =
      row('trr2', ['必修', '第一志愿', '课程号', '微积分', '1', '0', '0', '', '张三']) +
      row('trr2', ['必修', '第一志愿', '10720011', '', '', '0', '0', '', '张三']) +
      row('trr2', ['限选', '第二志愿', '10720012', '线性代数', '', '0', '0', '', '李四']);
    const out = parseDlRows(html);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ code: '10720012', seq: '0', typeCode: '008' });
  });

  it('列数不足 7 的行忽略', () => {
    expect(parseDlRows(row('trr1', ['课程号', '课程名']))).toEqual([]);
  });

  it('实体前缀课号（&nbsp;）解码后仍能解析', () => {
    const html = row('trr2', ['必修', '第一志愿', '&nbsp;10720011', '微积分', '1', '30', '5', '1-2(1-16周)', '张三']);
    const out = parseDlRows(html);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ code: '10720011', name: '微积分' });
  });

  it('外校前缀课号保留；纯字母无数字课号丢弃', () => {
    const html =
      row('trr2', ['任选', '第一志愿', 'PK0001234', '跨校课', '1', '0', '0', '真实钟点', '外校教师']) +
      row('trr2', ['任选', '第一志愿', 'kxh', '模板行', '1', '0', '0', '', '']);
    const out = parseDlRows(html);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ code: 'PK0001234', name: '跨校课' });
  });

  it('越界数字实体不抛异常（该行课号守卫拒收 → 空）', () => {
    const html = row('trr2', ['必修', '第一志愿', '&#x110000;10720011', '微积分', '1', '0', '0', '', '张三']);
    expect(() => parseDlRows(html)).not.toThrow();
    expect(parseDlRows(html)).toEqual([]);
  });
});
