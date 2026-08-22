// ============================================================
// auth.js —— 会话状态（HMAC-SHA256 签名，无服务端会话存储）
// ============================================================
import { hmacSign, toBase64, fromBase64Url, toBase64Url, sha256Hex } from './crypto.js';

const COOKIE = 'kah';
const TTL = 30 * 24 * 3600 * 1000; // 30 天

function b64url(obj) {
  return toBase64Url(toBase64(new TextEncoder().encode(typeof obj === 'string' ? obj : JSON.stringify(obj))));
}

export async function issueSession(accountId, secret) {
  const payload = b64url({ ua: accountId, exp: Date.now() + TTL, jti: btoa(String(Math.random() + Date.now())) });
  const sig = await hmacSign(payload, secret);
  return { token: `${payload}.${sig}`, cookie: `${COOKIE}=${payload}.${sig}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TTL / 1000)}` };
}

export async function verifySession(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const idx = token.lastIndexOf('.');
  if (idx <= 0) return null;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expect = await hmacSign(payload, secret);
  if (expect !== sig) return null;
  try {
    const obj = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    if (!obj.ua || obj.exp < Date.now()) return null;
    return obj.ua;
  } catch { return null; }
}

export function readCookie(req) {
  const header = req.headers.get('Cookie') || '';
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(header);
  return m ? decodeURIComponent(m[1]) : null;
}

export function logoutCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export { COOKIE };