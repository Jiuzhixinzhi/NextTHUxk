// ═══════════════════════════════════════════════════════════════
// NextTHUxk — HTTP 封装（WebVPN 壳页自愈：重进入口根换票）
// ═══════════════════════════════════════════════════════════════
import { decodeBest } from './decode';
import { TAG } from '../core/constants';

/** 15s 超时（AbortController）：无超时则单请求挂起会卡死一切等待它的链路 */
async function fetchWithTimeout(url: string, opts: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    return await fetch(url, { credentials: 'include', ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── WebVPN 壳页自愈（上游 v2.0.1 同款语义） ──────────────────
// 主 WebVPN 会话（SVPNWISSESSION）活着、仅 wengine_vpn_ticket 过期时，
// 请求被 302 到壳页；重进一次教务入口根（BASE）即自动换票，无需退出登录。
// 壳页由 WebVPN 网关产生（动作未达教务、token 未消耗），GET/POST 重试均安全。

/** 壳页标记（ASCII，gbk/utf8 双解码均可见） */
export function isWebvpnShell(html: string): boolean {
  return html.includes('__vpn_hostname_data') || html.includes('__vpn_app_hostname_data');
}

/** 60s 冷却判定（纯函数，供单测）：合流窗口内只重进一次 */
export function shouldReenter(now: number, lastAt: number, cooldownMs = 60000): boolean {
  return lastAt <= 0 || now - lastAt >= cooldownMs;
}

let reenterHook: (() => Promise<boolean>) | null = null;
let lastReenterAt = 0;
let reenterInFlight: Promise<boolean> | null = null;

/** session store 启动时注入换票函数（net 禁止 import stores，反向注入保分层） */
export function setWebvpnReenter(fn: (() => Promise<boolean>) | null): void {
  reenterHook = fn;
}

/** 单飞行重进：进行中的换票全窗共用；冷却内不重进（false=放弃本轮自救） */
function runReenter(): Promise<boolean> {
  if (reenterInFlight) return reenterInFlight;
  if (!reenterHook || !shouldReenter(Date.now(), lastReenterAt)) return Promise.resolve(false);
  lastReenterAt = Date.now();
  reenterInFlight = reenterHook()
    .catch((e: unknown) => {
      console.warn(TAG, 'webvpn 重进入口失败:', e);
      return false;
    })
    .finally(() => {
      setTimeout(() => {
        reenterInFlight = null;
      }, 0);
    });
  return reenterInFlight;
}

/** 自愈壳：壳页命中 → 重进换票 → 重试原请求一次；失败保留首次响应给上层诊断 */
async function withShellHeal<T>(raw: () => Promise<T>, textOf: (t: T) => string): Promise<T> {
  const first = await raw();
  if (!isWebvpnShell(textOf(first))) return first;
  const ok = await runReenter();
  if (!ok) return first;
  try {
    return await raw();
  } catch (e2) {
    console.warn(TAG, 'webvpn 换票后重试仍失败，保留壳页给上层诊断', e2);
    return first;
  }
}

/** 原体抓取（无自愈）：单解码，Content-Type 声明优先，否则编码探测。
 *  换票钩子抓入口根必须用原体——入口根若也是壳页要如实诊断而非再触发重进。 */
export async function fetchPageRaw(url: string, opts: RequestInit = {}): Promise<string> {
  const resp = await fetchWithTimeout(url, opts);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const buf = await resp.arrayBuffer();
  const ct = (resp.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('gb')) return new TextDecoder('gbk').decode(buf);
  if (ct.includes('utf-8')) return new TextDecoder('utf-8').decode(buf);
  return decodeBest(buf, url);
}

/** 单解码抓取（自愈壳） */
export function fetchPage(url: string, opts: RequestInit = {}): Promise<string> {
  return withShellHeal(() => fetchPageRaw(url, opts), t => t);
}

/** 双解码抓取：返回 gbk/utf8 两种解码，由调用方按解析结果挑 */
export async function fetchPageDual(url: string, opts: RequestInit = {}): Promise<{ gbk: string; utf8: string }> {
  return withShellHeal(
    async () => {
      const resp = await fetchWithTimeout(url, opts);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const buf = await resp.arrayBuffer();
      return {
        gbk: new TextDecoder('gbk').decode(buf),
        utf8: new TextDecoder('utf-8').decode(buf),
      };
    },
    t => t.gbk,
  );
}

/** 教务响应统一 GET+POST 便捷入口（写接口响应 GBK-only 解码的不一致在此统一） */
export async function fetchPost(url: string, body: URLSearchParams | string): Promise<string> {
  return withShellHeal(
    async () => {
      const resp = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const buf = await resp.arrayBuffer();
      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('utf-8')) return new TextDecoder('utf-8').decode(buf);
      // 教务表单 POST 响应默认 GBK
      return new TextDecoder('gbk').decode(buf);
    },
    t => t,
  );
}
