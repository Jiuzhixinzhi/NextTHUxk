// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 存储封装（Chrome callback 与 Firefox Promise 双形态兼容）
// ═══════════════════════════════════════════════════════════════
import { SP, TAG } from '../core/constants';

const api: typeof chrome.storage.local & { get: typeof chrome.storage.local.get } =
  typeof browser !== 'undefined' ? (browser.storage.local as unknown as typeof chrome.storage.local) : chrome.storage.local;

export const store = {
  get<T = unknown>(k: string): Promise<T | undefined> {
    return new Promise(r => api.get(SP + k, d => r((d as Record<string, T>)[SP + k])));
  },
  set<T>(k: string, v: T): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const p = api.set({ [SP + k]: v });
        if (p && typeof p.then === 'function') {
          p.then(resolve, err => {
            console.warn(TAG, 'storage.set', SP + k, 'FAILED:', (err && err.message) || err);
            reject(err);
          });
        } else {
          resolve();
        }
      } catch (e) {
        console.warn(TAG, 'storage.set threw:', e);
        reject(e);
      }
    });
  },
  remove(k: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const p = api.remove(SP + k);
        if (p && typeof p.then === 'function') p.then(() => resolve(), (e: unknown) => reject(e));
        else resolve();
      } catch (e) {
        reject(e);
      }
    });
  },
  /** 读数组：坏形态（真值非数组）归一到 [] —— storage 损坏/异物写入的历史故障类
   *  （历史事故：plan 为真值非数组 → launch 的 (plan||[]).forEach 抛错、工作台打不开） */
  getArray<T>(k: string): Promise<T[]> {
    return store.get<unknown>(k).then(v => (Array.isArray(v) ? (v as T[]) : []));
  },
};

/** 存储键（不含前缀） */
export const K = {
  sem: 'sem',
  staticData: 'staticData',
  manualEvents: 'manualEvents',
  drafts: 'drafts',
  zyCache: 'zyCache',
  knote: 'knote',
  volCache: 'volCache',
  probHist: 'probHist',
  filtersOpen: 'filtersOpen',
  lastUpdateCheck: 'lastUpdateCheck',
  tbookIdx: 'tbookIdx',
  tbookIdxTs: 'tbookIdxTs',
  semScore: 'semScore',
  /** 遗留键：v3.0.0 起不再使用（stageCart=暂存、config=AI、grade=年级） */
  legacy: ['stageCart', 'config', 'grade'],
} as const;

/** 清理遗留键（升级直弃：暂存数据丢弃、AI 配置丢弃、年级丢弃） */
export async function cleanupLegacyKeys(): Promise<void> {
  for (const k of K.legacy) {
    try {
      await store.remove(k);
    } catch {
      /* fail-soft */
    }
  }
}
