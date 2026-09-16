// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 并发分页抓取器测试（pagedFetch：重试 / EMPTY 吸收 / 熔断 / 补抓）
// 全部注入 fetchPage/parse，不触网；throttle/retryDelay/cooldown 压到最小。
// ═══════════════════════════════════════════════════════════════
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { pagedFetch, type PagedOptions } from '../src/lib/net/paged';

/** 假教务：html 形如 'pg2'，parse 出 ['row2']；'empty' 视为空页。
 *  fetchPage(p)：p<=1 返回首页（与真实调用方 `p <= 1 ? fh : …` 契约一致），
 *  因此本地索引 0/1 都对应服务端第 1 页 → 重复内容由 dedupe 吸收。 */
function fakeFetch(html: string) {
  const m = /^pg(\d+)$/.exec(html);
  return { items: m ? ['row' + m[1]] : [], hasData: !!m };
}

const base = (over?: Partial<PagedOptions<string>>) => ({
  firstHtml: 'pg1',
  fetchPage: async (p: number) => (p <= 1 ? 'pg1' : 'pg' + p),
  parse: fakeFetch,
  expectPages: 3,
  throttle: 0,
  retryDelay: 1,
  cooldown: 0,
  ...over,
}) satisfies PagedOptions<string>;

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('pagedFetch · 正常分页', () => {
  it('expectPages=3 → 收齐三页（首页重复抓取由 dedupe 吸收）', async () => {
    const out = await pagedFetch(base({ dedupe: (x) => x }));
    expect(out).toEqual(['row1', 'row2', 'row3']);
  });

  it('无 dedupe 时重复行原样保留（调用方自去重语义）', async () => {
    const out = await pagedFetch(base());
    expect(out).toContain('row1');
    expect(out).toContain('row3');
  });

  it('首页无数据 → 直接返回空（不进入分页）', async () => {
    const out = await pagedFetch(base({ firstHtml: 'empty' }));
    expect(out).toEqual([]);
  });

  it('fetchFirst 失败 → fail-soft 返回空', async () => {
    const out = await pagedFetch(base({
      firstHtml: null,
      fetchFirst: async () => {
        throw new Error('boom');
      },
    }));
    expect(out).toEqual([]);
  });

  it('缺 fetchFirst/firstHtml → 抛错（调用方契约）', async () => {
    await expect(pagedFetch({ fetchPage: base().fetchPage, parse: fakeFetch })).rejects.toThrow();
  });
});

describe('pagedFetch · 空页与重试', () => {
  it('空页先重试（retry 次），仍空 → 按真末页吸收，不抛错', async () => {
    let calls = 0;
    const out = await pagedFetch(base({
      fetchPage: async (p) => {
        if (p === 2) {
          calls++;
          return 'empty';
        }
        return p <= 1 ? 'pg1' : 'pg' + p;
      },
      dedupe: (x) => x,
    }));
    expect(calls).toBeGreaterThan(1); // 触发了重试
    expect(out).toEqual(['row1', 'row3']);
  });

  it('瞬时失败后成功：重试梯救回该页', async () => {
    let first = true;
    const out = await pagedFetch(base({
      firstHtml: null,
      fetchFirst: async () => 'pg1',
      fetchPage: async (p) => {
        if (p === 2 && first) {
          first = false;
          throw new Error('transient');
        }
        return p <= 1 ? 'pg1' : 'pg' + p;
      },
      dedupe: (x) => x,
    }));
    expect(out).toEqual(['row1', 'row2', 'row3']);
  });

  it('持续失败页被跳过，其余页照常返回', async () => {
    const out = await pagedFetch(base({
      fetchPage: async (p) => {
        if (p === 2) throw new Error('down');
        return p <= 1 ? 'pg1' : 'pg' + p;
      },
      dedupe: (x) => x,
    }));
    expect(out).toEqual(['row1', 'row3']);
  });
});

describe('pagedFetch · 补抓与熔断', () => {
  it('首轮缺口走补抓，能把缺页补齐', async () => {
    let failOnce = true;
    const out = await pagedFetch(base({
      expectPages: 4,
      maxPages: 4,
      concurrency: 1,
      fetchPage: async (p) => {
        if (p === 3 && failOnce) {
          failOnce = false;
          throw new Error('once');
        }
        return p <= 1 ? 'pg1' : 'pg' + p;
      },
      dedupe: (x) => x,
    }));
    expect(out).toEqual(['row1', 'row2', 'row3', 'row4']);
  });

  it('全页失败：不抛错、不挂死，返回已收行（首页已吸收）', async () => {
    const out = await pagedFetch(base({
      expectPages: 4,
      maxPages: 4,
      concurrency: 1,
      retry: 0,
      fetchPage: async () => {
        throw new Error('down');
      },
    }));
    expect(out).toEqual(['row1']);
  });

  it('错误连续 5 次触发熔断：后续页不再请求', async () => {
    const tried = new Set<number>();
    const out = await pagedFetch(base({
      expectPages: 20,
      maxPages: 20,
      concurrency: 1,
      retry: 0,
      fetchPage: async (p) => {
        tried.add(p);
        throw new Error('down');
      },
    }));
    expect(out).toEqual(['row1']);
    // 补抓熔断：错误达 5 次后不再发起，远小于 20 页
    expect(tried.size).toBeLessThan(20);
  });

  it('应抓页数受 maxPages 约束', async () => {
    const tried: number[] = [];
    await pagedFetch(base({
      expectPages: 100,
      maxPages: 3,
      concurrency: 1,
      fetchPage: async (p) => {
        tried.push(p);
        return p <= 1 ? 'pg1' : 'pg' + p;
      },
    }));
    expect(Math.max(...tried)).toBeLessThanOrEqual(3);
  });
});
