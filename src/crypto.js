// ============================================================
// crypto.js —— 纯 Web Crypto，零依赖
// 覆盖: AES-GCM 字段加密 / PBKDF2 口令散列 / HMAC-SHA256 会话签名
// ============================================================
const enc = new TextEncoder();
const dec = new TextDecoder();

const _keyCache = new Map(); // secret -> CryptoKey

export function toBase64(bytes) {
  const u = new Uint8Array(bytes);
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < u.length; i += step) s += String.fromCharCode(...u.subarray(i, i + step));
  return btoa(s);
}
export function fromBase64(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
export function toBase64Url(b64) {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64Url(s) {
  return fromBase64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
}
export function randomBytes(len) {
  const u = new Uint8Array(len);
  crypto.getRandomValues(u);
  return u;
}
export async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function masterKey(secretText) {
  const hit = _keyCache.get(secretText);
  if (hit) return hit;
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(secretText));
  const key = await crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
  _keyCache.set(secretText, key);
  return key;
}

// 格式: v1.<ivB64url>.<tagB64url>.<dataB64url>
export async function encryptWithKey(key, plain) {
  const iv = randomBytes(12);
  const raw = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)));
  const tag = raw.slice(raw.length - 16);
  const data = raw.slice(0, raw.length - 16);
  return 'v1.' + toBase64Url(toBase64(iv)) + '.' + toBase64Url(toBase64(tag)) + '.' + toBase64Url(toBase64(data));
}
export async function decryptWithKey(key, payload) {
  try {
    const p = String(payload).split('.');
    if (p.length !== 4 || p[0] !== 'v1') return null;
    const iv = fromBase64Url(p[1]);
    const tag = fromBase64Url(p[2]);
    const data = fromBase64Url(p[3]);
    const buf = new Uint8Array(data.length + tag.length);
    buf.set(data, 0);
    buf.set(tag, data.length);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, buf);
    return dec.decode(pt);
  } catch { return null; }
}
// 便捷封装：整条加密存储
export async function seal(env, plain) {
  return encryptWithKey(await masterKey(getSecret(env)), plain);
}
export async function unseal(env, payload) {
  if (!payload) return null;
  return decryptWithKey(await masterKey(getSecret(env)), payload);
}
function getSecret(env) {
  if (!env.MASTER_ENCRYPT_SECRET) throw new Error('缺少 secret: MASTER_ENCRYPT_SECRET');
  return env.MASTER_ENCRYPT_SECRET;
}

// ---- 口令散列 (PBKDF2-SHA256 x200000) ----
const PBKDF2_ITER = 200_000;
export async function hashPassword(plain, saltB64) {
  const salt = saltB64 ? fromBase64(saltB64) : randomBytes(16);
  const base = await crypto.subtle.importKey('raw', enc.encode(String(plain)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' }, base, 256);
  return toBase64(salt) + ':' + toBase64(bits);
}
export async function verifyPassword(plain, stored) {
  if (!stored) return false;
  const i = stored.indexOf(':');
  if (i <= 0) return false;
  const salt = stored.slice(0, i);
  const cand = await hashPassword(plain, salt);
  return cand === stored;
}

// ---- HMAC-SHA256 会话签名 ----
export async function hmacSign(payloadB64, secretText) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secretText), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64));
  return toBase64Url(toBase64(sig));
}