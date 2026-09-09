// ═══════════════════════════════════════════════════════════════
// NextTHUxk — net 层纯函数测试：WebVPN 壳页判定 / 重进冷却状态机
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { isWebvpnShell, shouldReenter } from '../src/lib/net/http';

describe('isWebvpnShell', () => {
  it('主壳页标记命中', () => {
    expect(isWebvpnShell('<html><script>__vpn_hostname_data</script></html>')).toBe(true);
  });

  it('应用壳页标记命中', () => {
    expect(isWebvpnShell('var __vpn_app_hostname_data = "x";')).toBe(true);
  });

  it('正常教务页/死页不误判', () => {
    expect(isWebvpnShell('<html>选课系统 trr2 accessDenied</html>')).toBe(false);
    expect(isWebvpnShell('')).toBe(false);
  });
});

describe('shouldReenter（60s 冷却状态机）', () => {
  it('首次（无记录）放行', () => {
    expect(shouldReenter(1000, 0)).toBe(true);
    expect(shouldReenter(1000, -1)).toBe(true);
  });

  it('冷却窗口内拒绝', () => {
    expect(shouldReenter(60_000, 60_000)).toBe(false);
    expect(shouldReenter(60_000 + 59_999, 60_000)).toBe(false);
  });

  it('冷却期满放行（含边界）', () => {
    expect(shouldReenter(60_000 + 60_000, 60_000)).toBe(true);
    expect(shouldReenter(0, -60_000)).toBe(true);
  });

  it('自定义冷却窗', () => {
    expect(shouldReenter(10_000, 5_000, 5_000)).toBe(true);
    expect(shouldReenter(9_999, 5_000, 5_000)).toBe(false);
  });
});
