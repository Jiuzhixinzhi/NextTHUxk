// ═══════════════════════════════════════════════════════════════
// NextTHUxk — WebVPN 站点识别（BASE 前缀 + AES 主机段解密）
// key = iv = "wrdvpnisthebest!"（AES-128-CBC）——勿改：与 WebVPN 前端契约绑定。
// ═══════════════════════════════════════════════════════════════
import { TAG } from '../core/constants';

export const WEBVPN_PREFIX_RE = /^\/(https?)\/([0-9a-f]{32,})(?=\/|$)/i;

export interface SiteIdentity {
  isZhjwxk: boolean;
  isZhjw: boolean;
  isWebvpn: boolean;
  /** 相对路径前缀（WebVPN 编码站点段），BASE 拼接用 */
  BASE: string;
}

export function initSite(pathname: string, hostname: string, origin: string): SiteIdentity {
  let BASE = origin;
  const isWebvpn = hostname === 'webvpn.tsinghua.edu.cn';
  let isZhjwxk = hostname === 'zhjwxk.cic.tsinghua.edu.cn';
  let isZhjw = hostname === 'zhjw.cic.tsinghua.edu.cn';
  const m = pathname.match(WEBVPN_PREFIX_RE);
  if (m) BASE += '/' + m[1] + '/' + m[2];
  return { isZhjwxk, isZhjw, isWebvpn, BASE };
}

let siteP: Promise<SiteIdentity> | null = null;

/** 单飞行：识别站点 + 解析 BASE（WebVPN 下先解密主机段再定站点） */
export function ensureSiteIdentity(loc: { pathname: string; hostname: string; origin: string }): Promise<SiteIdentity> {
  if (siteP) return siteP;
  siteP = (async () => {
    const identity = initSite(loc.pathname, loc.hostname, loc.origin);
    if (identity.isWebvpn && !identity.isZhjwxk && !identity.isZhjw) {
      let host = '';
      const m = loc.pathname.match(WEBVPN_PREFIX_RE);
      if (m && m[2]!.length % 2 === 0) {
        try {
          const raw = new Uint8Array((m[2]!.match(/../g) || []).map(h => parseInt(h, 16)));
          const keyBytes = new TextEncoder().encode('wrdvpnisthebest!');
          const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
          const pt = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: keyBytes }, key, raw));
          host = [...pt].filter(c => c >= ' ' && c <= '~').join('');
        } catch (e) {
          console.warn(TAG, 'webvpn host decode fail:', e instanceof Error ? e.message : e);
        }
      }
      const after = m ? loc.pathname.slice(m[0].length) : loc.pathname;
      if (/zhjwxk/i.test(host) || /xkBks\./i.test(after)) identity.isZhjwxk = true;
      else if (/zhjw\.cic/i.test(host)) identity.isZhjw = true;
      console.log(TAG, 'site identity:', identity.isZhjwxk ? 'zhjwxk' : identity.isZhjw ? 'zhjw' : 'unknown', '| BASE=' + identity.BASE, host ? '| host=' + host : '');
    }
    return identity;
  })();
  return siteP;
}
