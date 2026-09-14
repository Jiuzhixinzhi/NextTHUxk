// ═══════════════════════════════════════════════════════════════
// NextTHUxk — net 层纯函数测试：WebVPN 壳页判定 / 重进冷却状态机
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { isWebvpnShell, shouldReenter } from '../src/lib/net/http';
import { isSsoLoginHtml, isXkDeadHtml } from '../src/lib/api/search';

describe('死页细分（SSO 登录页 vs 会话死页）', () => {
  it('SSO 特征命中（换票救不了）', () => {
    expect(isSsoLoginHtml('<a href="do/off/ui/auth/login">登录</a>')).toBe(true);
    expect(isSsoLoginHtml('passLogin()')).toBe(true);
    expect(isSsoLoginHtml('电子身份服务系统')).toBe(true);
    expect(isSsoLoginHtml('<html>选课系统 trr2</html>')).toBe(false);
  });

  it('会话死页不再吞并 SSO 特征', () => {
    expect(isXkDeadHtml('<html>accessDenied</html>')).toBe(true);
    expect(isXkDeadHtml('用户登陆超时或访问内容不存在。请重试')).toBe(true);
    expect(isXkDeadHtml('do/off/ui/auth/login')).toBe(false);
    expect(isXkDeadHtml('电子身份服务系统')).toBe(false);
  });
});

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
