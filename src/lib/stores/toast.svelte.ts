// ═══════════════════════════════════════════════════════════════
// NextTHUxk — Toast（全局消息条）
// ═══════════════════════════════════════════════════════════════

export const toast = $state({ on: false, ok: true, msg: '' });

let t1: ReturnType<typeof setTimeout> | undefined;
let t2: ReturnType<typeof setTimeout> | undefined;

export function showToast(ok: boolean, msg: string): void {
  toast.ok = ok;
  toast.msg = msg;
  toast.on = true;
  clearTimeout(t1);
  clearTimeout(t2);
  t1 = setTimeout(() => {
    toast.on = false;
  }, 2500);
  t2 = setTimeout(() => {
    toast.on = false;
  }, 2800);
}

export function showXkResult(res: { ok: boolean; msg?: string }): void {
  showToast(res.ok, (res.msg || (res.ok ? '操作成功' : '操作失败')));
}
