// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 版本更新检查（GitHub Releases）
// ═══════════════════════════════════════════════════════════════
import { curVer, DANGEROUS_VERS, TAG } from '../core/constants';
import { K, store } from '../storage/store';

/** 更新检查目标：fork 自己的 releases（上游 smartThise 是另一代码世系，
 *  版本号命名空间已冲突，比上游会把用户引向旧世代构建） */
const RELEASES_LATEST = 'https://api.github.com/repos/Jiuzhixinzhi/NextTHUxk/releases/latest';

export function cmpVer(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

export interface UpdateUi {
  onDanger: () => void;
  onUpdate: (ver: string, url: string) => void;
}

let timer: ReturnType<typeof setInterval> | null = null;

export async function checkUpdate(ui: UpdateUi, throttle = true): Promise<void> {
  const cur = curVer();
  if (DANGEROUS_VERS.includes(cur)) {
    ui.onDanger();
    return;
  }
  try {
    if (throttle) {
      const lastCheck = await store.get<number>(K.lastUpdateCheck);
      if (lastCheck && Date.now() - lastCheck < 30 * 60 * 1000) return;
    }
    const resp = await fetch(RELEASES_LATEST, { cache: 'no-store' });
    if (!resp.ok) return;
    const data = (await resp.json()) as { tag_name?: string; html_url?: string };
    await store.set(K.lastUpdateCheck, Date.now());
    const remote = (data.tag_name || '').replace(/^v/, '');
    if (remote && cmpVer(remote, cur) > 0) ui.onUpdate(remote, data.html_url || '');
  } catch (e) {
    console.warn(TAG, 'update check:', e);
  }
  if (!timer) {
    timer = setInterval(() => {
      store.set(K.lastUpdateCheck, 0);
      checkUpdate(ui).catch(() => {});
    }, 30 * 60 * 1000);
  }
}

/** 检查点窗口新鲜度判定（v1.5.0 语义）：ts ∈ [最近检查点, now) → 新鲜 */
export function volNeedsRefresh(ts: number): boolean {
  if (!ts) return true;
  return ts < volWindowStart().getTime();
}

export function nextVolCheckpoint(now: number): Date {
  const cp = [8, 12, 16, 20];
  const d = new Date(now);
  for (const h of cp) {
    const t = new Date(d);
    t.setHours(h, 0, 0, 0);
    if (t > d) return t;
  }
  const t = new Date(d);
  t.setDate(t.getDate() + 1);
  t.setHours(cp[0]!, 0, 0, 0);
  return t;
}

/** 当前检查点窗口起点：最近一个 ≤ now 的检查点（今天都未到则取昨日 20:00） */
export function volWindowStart(now: number = Date.now()): Date {
  const cp = [8, 12, 16, 20];
  const d = new Date(now);
  for (let i = cp.length - 1; i >= 0; i--) {
    const t = new Date(d);
    t.setHours(cp[i]!, 0, 0, 0);
    if (d >= t) return t;
  }
  const t = new Date(d);
  t.setDate(t.getDate() - 1);
  t.setHours(cp[cp.length - 1]!, 0, 0, 0);
  return t;
}
