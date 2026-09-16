// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 剪贴板（content 层 DOM helper）
// content script 常无 clipboardWrite 权限（navigator.clipboard === undefined）→
// 可用性探测 + 隐藏 textarea execCommand 降级；返回是否成功，调用方决定兜底 UI。
// ═══════════════════════════════════════════════════════════════
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 降级 */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
