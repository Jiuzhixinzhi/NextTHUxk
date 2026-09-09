// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 轻量总线：跨 store 挂勾（避免循环依赖）
// ═══════════════════════════════════════════════════════════════
import type { Course } from '../domain/types';

type MergedHook = (rows: Course[], filled: number) => void;

const rowsMergedHooks: MergedHook[] = [];

export function onServerRowsMerged(fn: MergedHook): void {
  rowsMergedHooks.push(fn);
}

export function emitServerRowsMerged(rows: Course[], filled: number): void {
  for (const fn of rowsMergedHooks) {
    try {
      fn(rows, filled);
    } catch {
      /* fail-soft */
    }
  }
}

// ─── 启动完成钩子（launch 结束 → 各 store 自举，如首查浏览页） ─────
const launchDoneHooks: (() => void)[] = [];

export function onLaunchDone(fn: () => void): void {
  launchDoneHooks.push(fn);
}

export function emitLaunchDone(): void {
  for (const fn of launchDoneHooks) {
    try {
      fn();
    } catch {
      /* fail-soft */
    }
  }
}

// ─── 已选变更钩子（refreshSelected 后 → 培养方案覆盖数重算等） ─────
const selectedChangedHooks: (() => void)[] = [];

export function onSelectedChanged(fn: () => void): void {
  selectedChangedHooks.push(fn);
}

export function emitSelectedChanged(): void {
  for (const fn of selectedChangedHooks) {
    try {
      fn();
    } catch {
      /* fail-soft */
    }
  }
}
