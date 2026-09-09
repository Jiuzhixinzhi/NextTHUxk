// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 模态框调度（类型化弹窗状态机；ModalHost 统一渲染）
// ═══════════════════════════════════════════════════════════════
import type { Course, DraftCourse, Flag } from '../domain/types';

export type ModalState =
  | { kind: 'none' }
  | { kind: 'course'; code: string; teacherId: string }
  | { kind: 'reviews'; code: string; seq: string }
  | { kind: 'creditSim'; courses: DraftCourse[]; title: string; certainKeys?: string[] }
  | { kind: 'probTrend'; code: string; seq: string; flag: Flag; zy: number }
  | { kind: 'manualEvent' }
  | { kind: 'zyConfirm'; courses: Course[]; resolve: (values: number[]) => void }
  | { kind: 'dialog'; title: string; message: string; danger?: boolean; confirmText?: string; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; title: string; message?: string; initial: string; placeholder?: string; resolve: (val: string | null) => void };

export const modal = $state({ cur: { kind: 'none' } as ModalState });

export function openWindow(state: Exclude<ModalState, { kind: 'none' } | { kind: 'dialog' } | { kind: 'prompt' } | { kind: 'zyConfirm' }>): void {
  modal.cur = state;
}

export function closeModal(): void {
  modal.cur = { kind: 'none' };
}

export function confirmDialog(title: string, message: string, danger = false): Promise<boolean> {
  return new Promise(resolve => {
    modal.cur = { kind: 'dialog', title, message, danger, resolve };
  });
}

export function promptDialog(title: string, initial: string, placeholder?: string, message?: string): Promise<string | null> {
  return new Promise(resolve => {
    modal.cur = { kind: 'prompt', title, initial, placeholder, message, resolve };
  });
}

export function zyConfirm(courses: Course[]): Promise<number[]> {
  return new Promise(resolve => {
    modal.cur = { kind: 'zyConfirm', courses, resolve };
  });
}

export function resolveZyModal(values: number[]): void {
  if (modal.cur.kind === 'zyConfirm') {
    modal.cur.resolve(values);
    modal.cur = { kind: 'none' };
  }
}

export function resolveDialog(ok: boolean): void {
  if (modal.cur.kind === 'dialog') {
    modal.cur.resolve(ok);
    modal.cur = { kind: 'none' };
  }
}

export function resolvePrompt(val: string | null): void {
  if (modal.cur.kind === 'prompt') {
    modal.cur.resolve(val);
    modal.cur = { kind: 'none' };
  }
}
