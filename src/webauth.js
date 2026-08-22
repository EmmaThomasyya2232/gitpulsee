// ============================================================
// webauth.js —— Web 协议会话层：固化指纹 / CookieJar / 静默自愈
// 彻底替代 GitHub Token(PAT) REST 通道：
//   探测(200→执行 / 302→重登) → TOTP 算号 → user_session 回写 → 失败熔断
// 所有 fetch 均可注入（fetchImpl），便于本地自测。
// ============================================================
import { unseal, seal } from './crypto.js';
import * as totp from './totp.js';

const GH = 'https://github.com';

// ---------- 固化指纹：一号一指纹，全生命周期不变 ----------
const FP_POOL = [
  { v: '132', plat: 'Windows' }, { v: '131', plat: 'Windows' }, { v: '130', plat: 'macOS' },
  { v: '129', plat: 'macOS' }, { v: '128', plat: 'Linux' }, { v: '133', plat: 'Windows' },
];
const LANG_POOL = ['zh-CN,zh;q=0.9,en;q=0.6', 'en-US,en;q=0.9,zh-CN;q=0.8', 'zh-CN,zh;q=0.9', 'en;q=0.9'];

/** 由账号 id 确定性生成指纹（同一账号永远同一环境，不同账号环境互异） */
export function makeFingerprint(seed) {
  let h = 5381;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  const p = FP_POOL[h % FP_POOL.length];
  const lang = LANG_POOL[(h >>> 8) % LANG_POOL.length];
  return {
    label: `chrome${p.v}-${p.plat.toLowerCase()}`,
    user_agent: `Mozilla/5.0 (${p.plat === 'Windows' ? 'Windows NT 10.0; Win64; x64' : p.plat === 'macOS' ? 'Macintosh; Intel Mac OS X 10_15_7' : 'X11; Linux x86_64'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${p.v}.0.0.0 Safari/537.36`,
    sec_ch_ua: `"Chromium";v="${p.v}", "Google Chrome";v="${p.v}", "Not?A_Brand";v="99"`,
    sec_ch_ua_platform: `"${p.plat}"`,
    sec_ch_ua_mobile: '?0',
    accept_language: lang,
  };
}

export function fingerprintHeaders(fp) {
  return {
    'User-Agent': fp.user_agent,
    'sec-ch-ua': fp.sec_ch_ua,
    'sec-ch-ua-platform': fp.sec_ch_ua_platform,
    'sec-ch-ua-mobile': fp.sec_ch_ua_mobile,
    'Accept-Language': fp.accept_language,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };
}

// ---------- CookieJar：解析 / 序列化 / 附着 ----------
export function newJar() { return {}; } // name -> value（全部作用于 github.com 域）

export function applySetCookies(jar, response) {
  const raws = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') || ''].filter(Boolean);
  for (const raw of raws) {
    const pair = raw.split(';')[0];
    const i = pair.indexOf('=');
    if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return jar;
}
export function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}
export function parseJar(jsonText) {
  try { const o = JSON.parse(jsonText); return o && typeof o === 'object' && Object.keys(o).length ? o : null; }
  catch { return null; }
}
export const hasUserSession = (jar) => Boolean(jar && (jar.user_session || jar.__Host_user_session_same_site));

// ---------- 统一请求封装（自动带指纹 + Cookie） ----------
async function req(fetchImpl, url, { method = 'GET', jar, fp, form, headers = {} } = {}) {
  const h = { ...fingerprintHeaders(fp), ...headers };
  if (jar && Object.keys(jar).length) h.Cookie = cookieHeader(jar);
  let body;
  if (form) {
    body = new URLSearchParams(form).toString();
    h['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetchImpl(url, { method, headers: h, body, redirect: 'manual' });
  if (jar) applySetCookies(jar, r);
  return r;
}

/** 从 HTML 中提取 authenticity_token（登录/社交表单通用） */
export function extractToken(html) {
  const m = /name="authenticity_token"[^>]*value="([^"]+)"/.exec(String(html || ''))
    || /authenticity_token" value="([^"]+)"/.exec(String(html || ''));
  return m ? m[1] : null;
}

// ---------- 会话探测 ----------
/** 探测 Cookie 存活：200 且未跳登录页 = 有效；302/鉴权失败 = 失效 */
export async function probeSession(acc, { jar = null, fetchImpl = fetch } = {}) {
  const fp = acc.fingerprint ? JSON.parse(acc.fingerprint) : makeFingerprint(acc.id);
  const j = jar || parseJar(acc.cookie_jar);
  if (!j) return { alive: false, reason: 'no_cookie_jar' };
  const r = await req(fetchImpl, `${GH}/settings/profile`, { jar: j, fp });
  const finalUrl = r.url || '';
  const alive = r.status === 200 && !/\/(login|session|sessions)/.test(finalUrl);
  return { alive, status: r.status, finalUrl, jar: j };
}

// ---------- Web 协议登录（含 2FA TOTP 算号） ----------
export async function webLogin(env, acc, { fetchImpl = fetch } = {}) {
  if (!acc.gh_login || !acc.gh_password_enc) return { ok: false, reason: 'no_gh_credentials', jar: newJar() };
  const fp = acc.fingerprint ? JSON.parse(acc.fingerprint) : makeFingerprint(acc.id);
  const jar = newJar();
  try {
    // 1) 登录页：取 authenticity_token
    let r = await req(fetchImpl, `${GH}/login`, { jar, fp });
    const tok = extractToken(await r.text());
    if (!tok) return { ok: false, reason: 'login_page_no_token', jar };

    // 2) 提交账密（redirect=manual，手动合并 Set-Cookie）
    const password = await unseal(env, acc.gh_password_enc);
    r = await req(fetchImpl, `${GH}/session`, {
      method: 'POST', jar, fp,
      form: { login: acc.gh_login, password, authenticity_token: tok },
    });
    let body = await r.text();
    const loc = r.headers.get('location') || '';

    // 3) 2FA 挑战：用该账号自己的 TOTP Secret 现场算号
    if (/two-factor|2fa/i.test(loc + body.slice(0, 4000))) {
      const secret = acc.gh_totp_enc && await unseal(env, acc.gh_totp_enc);
      if (!secret) return { ok: false, reason: 'missing_2fa_secret', jar };
      const cands = await totp.totpCandidates(secret); // [上一窗, 当前窗, 下一窗]
      const tok2 = extractToken(body) || '';
      r = await req(fetchImpl, `${GH}/sessions/two-factor`, {
        method: 'POST', jar, fp,
        form: { otp: cands[1] || cands[0], authenticity_token: tok2 },
      });
      body = await r.text();
    }

    // 4) 判定结果并分类失败原因（供熔断与审计）
    if (hasUserSession(jar)) return { ok: true, reason: 'logged_in', jar };
    if (/captcha|challenge/i.test(body)) return { ok: false, reason: 'captcha_challenge', jar };
    if (/(incorrect|bad credentials|wrong)/i.test(body)) return { ok: false, reason: 'bad_credentials', jar };
    return { ok: false, reason: `unknown_http_${r.status}`, jar };
  } catch (e) {
    return { ok: false, reason: `network_${String((e && e.message) || e).slice(0, 80)}`, jar };
  }
}

// ---------- 数据库状态回写 ----------
async function setState(db, id, patch) {
  const sets = []; const vals = [];
  for (const [k, v] of Object.entries(patch)) { sets.push(`${k} = ?`); vals.push(v); }
  sets.push('last_probe_at = ?'); vals.push(new Date().toISOString().slice(0, 19));
  vals.push(id);
  await db.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
}

// ---------- 静默自愈总入口 ----------
/**
 * 执行任何任务前调用：
 *   force=false → 先用持久化 Cookie 探测，200 直接复用；
 *   失效/force  → 触发静默重登（解密密码 + TOTP 算号），新 session 加密回写数据库；
 *   自愈仍失败 → auth_state='invalid' + status='invalid'（熔断，队列自动跳过）。
 * 返回可用 Jar 或 null。
 */
export async function ensureSession(env, acc, { force = false, fetchImpl = fetch } = {}) {
  const db = env.DB;
  if (!force) {
    const p = await probeSession(acc, { fetchImpl });
    if (p.alive) {
      await setState(db, acc.id, { auth_state: 'valid' });
      await db.prepare("UPDATE accounts SET status = 'active' WHERE id = ? AND status != 'active'").bind(acc.id).run();
      return p.jar;
    }
  }
  const res = await webLogin(env, acc, { fetchImpl });
  if (res.ok) {
    await setState(db, acc.id, {
      cookie_jar: await seal(env, JSON.stringify(res.jar)),
      auth_state: 'valid',
    });
    await db.prepare("UPDATE accounts SET status = 'active' WHERE id = ? AND status != 'active'").bind(acc.id).run();
    return res.jar;
  }
  // 自愈失败：熔断——暂停账号，后续队列任务全部跳过
  await setState(db, acc.id, { auth_state: 'invalid' });
  await db.prepare("UPDATE accounts SET status = 'invalid' WHERE id = ?").bind(acc.id).run();
  return null;
}

// ---------- Web 协议业务动作（全部基于会话 Cookie + authenticity_token） ----------
/**
 * 统一动作入口。target: 'owner/repo' 或 'user'。
 * 返回 { ok, status, authFail } —— authFail=true 表示会话失效需走自愈。
 */
export async function webAct(fetchImpl, jar, fp, kind, target) {
  const isRepo = kind !== 'follow' && kind !== 'unfollow';
  const pageUrl = isRepo ? `${GH}/${target}` : `${GH}/${target}`;
  const r0 = await req(fetchImpl, pageUrl, { jar, fp });
  if (r0.status === 404) return { ok: false, status: 404, authFail: false, reason: 'not_found' };
  const token = extractToken(await r0.text());
  if (!token) return { ok: false, status: r0.status, authFail: true, reason: 'no_token_on_page' };

  let postUrl;
  switch (kind) {
    case 'star': postUrl = `${GH}/${target}/star`; break;
    case 'unstar': postUrl = `${GH}/${target}/unstar`; break;
    case 'follow': postUrl = `${GH}/${target}/follow`; break;
    case 'unfollow': postUrl = `${GH}/${target}/unfollow`; break;
    case 'watch': postUrl = `${GH}/${target}/subscription`; break;
    default: return { ok: false, status: 400, authFail: false, reason: `unknown_kind:${kind}` };
  }
  const form = { authenticity_token: token };
  if (kind === 'watch') form.do = 'subscribed';
  const r = await req(fetchImpl, postUrl, { method: 'POST', jar, fp, form });
  const ok = r.status >= 200 && r.status < 400;
  return { ok, status: r.status, authFail: !ok && (r.status === 401 || r.status === 302), reason: ok ? 'done' : `http_${r.status}` };
}

/** Web 上传日常笔记：POST /{repo}/upload/{branch}/{path}（multipart） */
export async function uploadNote(fetchImpl, jar, fp, repo, path, content, message) {
  const branch = 'main';
  const pageR = await req(fetchImpl, `${GH}/${repo}/upload/${branch}`, { jar, fp });
  const token = extractToken(await pageR.text());
  if (!token) return { ok: false, status: pageR.status, authFail: true, reason: 'no_token_on_page' };

  const fd = new FormData();
  fd.append('authenticity_token', token);
  fd.append('repository_id', '');
  fd.append('branch', branch);
  fd.append('path', path);
  fd.append('same_branch', '1');
  fd.append('commit_message', message || `daily note · ${new Date().toISOString().slice(0, 10)}`);
  fd.append('commit_choice', 'quick-press');
  fd.append('file', new Blob([content], { type: 'text/markdown' }), path.split('/').pop());
  const r = await fetchImpl(`${GH}/${repo}/upload/${branch}/${path}`, {
    method: 'POST',
    headers: { ...fingerprintHeaders(fp), Cookie: cookieHeader(jar) },
    body: fd,
    redirect: 'manual',
  });
  applySetCookies(jar, r);
  const ok = r.status >= 200 && r.status < 400;
  return { ok, status: r.status, authFail: !ok && (r.status === 401 || r.status === 302), reason: ok ? 'committed' : `http_${r.status}` };
}

/** Web 创建 issue：GET /{repo}/issues/new 取 token → POST /{repo}/issues */
export async function webIssue(fetchImpl, jar, fp, repo, title, bodyText) {
  const r0 = await req(fetchImpl, `${GH}/${repo}/issues/new`, { jar, fp });
  const token = extractToken(await r0.text());
  if (!token) return { ok: false, status: r0.status, authFail: true, reason: 'no_token_on_page' };
  const r = await req(fetchImpl, `${GH}/${repo}/issues`, {
    method: 'POST', jar, fp,
    form: { authenticity_token: token, title: title || '👣 关注一下', body: bodyText || '' },
  });
  const ok = r.status >= 200 && r.status < 400;
  return { ok, status: r.status, authFail: !ok && (r.status === 401 || r.status === 302), reason: ok ? 'created' : `http_${r.status}` };
}
