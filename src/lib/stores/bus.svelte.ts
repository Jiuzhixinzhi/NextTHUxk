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
let _launchSettled = false;

export function onLaunchDone(fn: () => void): void {
  launchDoneHooks.push(fn);
}

export function emitLaunchDone(): void {
  _launchSettled = true;
  for (const fn of launchDoneHooks) {
    try {
      fn();
    } catch {
      /* fail-soft */
    }
  }
}

/** 启动是否落定（launch 编排结束）——后台补拉的前置门（上游 PR #46 启动门控） */
export function launchSettled(): boolean {
  return _launchSettled;
}

/** 新一轮 launch 开始：复位落定标记（切学期/重开工作台时后台补拉闸门不得沿用旧值） */
export function markLaunchStart(): void {
  _launchSettled = false;
}

// ─── 前台查询占用（kkxxSearch 服务端会话游标敏感） ────────────────
// 浏览模式翻页靠服务端会话游标（无参 page=N 延续上次结果集）；后台补拉若并发
// 发 kkxxSearch 会污染游标（上游 PR #46 串行队列+会话键的等价闸门）。前台进出
// 计数，后台扫页据此让路。
let _fgBusy = 0;

export function fgEnter(): void {
  _fgBusy++;
}

export function fgExit(): void {
  _fgBusy = Math.max(0, _fgBusy - 1);
}

export function fgBusy(): boolean {
  return _fgBusy > 0;
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
