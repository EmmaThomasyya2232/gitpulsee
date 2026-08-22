// ============================================================
// totp.js —— RFC 6238 TOTP，纯 WebCrypto（HMAC-SHA1）
// ============================================================
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function randomSecret(bytesLen = 20) {
  const u = new Uint8Array(bytesLen);
  crypto.getRandomValues(u);
  let s = '';
  for (let i = 0; i < u.length; i++) s += B32[u[i] & 31];
  return s;
}

export function toBase32(bytes) {
  const u = new Uint8Array(bytes);
  let bits = 0, value = 0, out = '';
  for (let i = 0; i < u.length; i++) {
    value = (value << 8) | u[i];
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(s) {
  const clean = String(s).toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0, out = [];
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) continue;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/**
 * 生成当前 TOTP 候选值集合（含前后 drift 个时间窗）
 * @param {string} secret base32-TOTP 种子
 * @returns {Promise<string[]>} 候选 6 位验证码
 */
export async function totpCandidates(secret, { step = 30, digits = 6, drift = 1, now = Date.now() } = {}) {
  const t = Math.floor(now / 1000);
  const key = await crypto.subtle.importKey('raw', fromBase32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const values = [];
  for (let d = -drift; d <= drift; d++) {
    let counter = Math.floor(t / step) + d;
    const msg = new Uint8Array(8);
    for (let i = 7; i >= 0; i--) { msg[i] = counter & 0xff; counter = Math.floor(counter / 256); }
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
    const offset = sig[sig.length - 1] & 0x0f;
    const code = ((sig[offset] & 0x7f) << 24) | (sig[offset + 1] << 16) | (sig[offset + 2] << 8) | sig[offset + 3];
    values.push(String(code % 10 ** digits).padStart(digits, '0'));
  }
  return values;
}

export async function verifyTotp(secret, code) {
  const vals = await totpCandidates(secret);
  return vals.includes(String(code).trim());
}

export function otpauthUrl(username, secret) {
  return `otpauth://totp/gitpulse:${encodeURIComponent(username)}?secret=${secret}&issuer=gitpulse&algorithm=SHA1&digits=6&period=30`;
}