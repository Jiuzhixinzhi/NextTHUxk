// ═══════════════════════════════════════════════════════════════
// NextTHUxk — HTTP 封装
// ═══════════════════════════════════════════════════════════════
import { decodeBest } from './decode';

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

/** 单解码抓取：Content-Type 声明优先，否则编码探测 */
export async function fetchPage(url: string, opts: RequestInit = {}): Promise<string> {
  const resp = await fetchWithTimeout(url, opts);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const buf = await resp.arrayBuffer();
  const ct = (resp.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('gb')) return new TextDecoder('gbk').decode(buf);
  if (ct.includes('utf-8')) return new TextDecoder('utf-8').decode(buf);
  return decodeBest(buf, url);
}

/** 双解码抓取：返回 gbk/utf8 两种解码，由调用方按解析结果挑 */
export async function fetchPageDual(url: string, opts: RequestInit = {}): Promise<{ gbk: string; utf8: string }> {
  const resp = await fetchWithTimeout(url, opts);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const buf = await resp.arrayBuffer();
  return {
    gbk: new TextDecoder('gbk').decode(buf),
    utf8: new TextDecoder('utf-8').decode(buf),
  };
}

/** 教务响应统一 GET+POST 便捷入口（写接口响应 GBK-only 解码的不一致在此统一） */
export async function fetchPost(url: string, body: URLSearchParams | string): Promise<string> {
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
}
