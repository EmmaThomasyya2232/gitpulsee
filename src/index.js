// ============================================================
// index.js —— Cloudflare Worker 入口
// 路由: 控制台页面 + JSON API
// ============================================================
import { consoleHTML } from './console.js';
import { seal, unseal, hashPassword, verifyPassword } from './crypto.js';
import * as totp from './totp.js';
import * as authM from './auth.js';
import * as orc from './orchestrator.js';
import * as audit from './audit.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
const err = (message, status = 400) => json({ ok: false, error: message }, status);
const ok = (data = {}) => json({ ok: true, ...data });

function sessionSecret(env) {
  return env.SESSION_SECRET || env.MASTER_ENCRYPT_SECRET || 'insecure-dev-session';
}

// 需要审计的管理写操作（成功才记录）
const AUDIT_ROUTES = [
  ['POST', '/api/accounts', 'account_create'],
  ['PUT', '/api/accounts/', 'account_update'],
  ['DELETE', '/api/accounts/', 'account_delete'],
  ['POST', '/api/campaigns', 'campaign_create'],
  ['POST', '/api/queue', 'queue_enqueue'],
  ['POST', '/api/pools', 'pool_create'],
  ['DELETE', '/api/pools/', 'pool_delete'],
];
function matchAudit(method, path) {
  if (path.endsWith('/cancel')) return 'campaign_cancel';
  if (path.endsWith('/run')) return 'queue_run_now';
  for (const [m, p, name] of AUDIT_ROUTES) {
    if (method === m && (path === p || path.startsWith(p))) return name;
  }
  return null;
}

async function requireAuth(req, env) {
  const token = authM.readCookie(req);
  return token ? authM.verifySession(token, sessionSecret(env)) : null;
}

// ---------- 认证 ----------
async function setup(req, env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM accounts').first();
  if (row.n > 0) return err('系统已初始化', 409);
  const body = await req.json().catch(() => ({}));
  const username = String(body.username || 'admin').trim();
  const password = String(body.password || '').trim();
  if (password.length < 8) return err('密码至少 8 位');
  const id = crypto.randomUUID();
  const tSecret = totp.randomSecret();
  await env.DB.prepare(
    `INSERT INTO accounts
      (id, username, password_hash, totp_secret_enc, github_token_enc, status, mode, timezone, weekly_active_days, note_repo)
     VALUES (?,?,?,?,?,'active','rule',?,?,?)`
  ).bind(id, username, await hashPassword(password), await seal(env, tSecret), null,
    body.timezone || '+08:00', Number(body.weekly_active_days || 5), body.note_repo || null).run();
  await audit.logAdmin(env.DB, { accountId: id, username, action: 'setup', detail: '初始化管理员', ip: audit.clientIp(req) });
  return json({
    ok: true,
    user: { id, username },
    otpauth: totp.otpauthUrl(username, tSecret),
    hint: '请在验证器 App 添加上面的 TOTP 之后登录，otpauth 只显示这一次。',
  });
}

async function login(req, env) {
  const body = await req.json().catch(() => ({}));
  const { username, password, totpCode } = body;
  const ip = audit.clientIp(req);
  const noteFail = (detail) =>
    audit.logAdmin(env.DB, { username: String(username || ''), action: 'login_fail', detail, ip });
  if (!username || !password) return err('需要 username 与 password');
  const acc = await env.DB.prepare('SELECT * FROM accounts WHERE username = ? COLLATE NOCASE').bind(String(username)).first();
  if (!acc) { await noteFail('账号不存在'); return err('账号不存在', 401); }
  if (!acc.password_hash || !(await verifyPassword(String(password), acc.password_hash))) {
    await noteFail('密码错误'); return err('密码错误', 401);
  }
  if (acc.totp_secret_enc) {
    const secret = await unseal(env, acc.totp_secret_enc);
    if (secret && !(await totp.verifyTotp(secret, String(totpCode || '')))) {
      await noteFail('TOTP 验证失败'); return err('TOTP 验证失败', 401);
    }
  }
  const { token, cookie } = await authM.issueSession(acc.id, sessionSecret(env));
  await audit.logAdmin(env.DB, { accountId: acc.id, username: acc.username, action: 'login_ok', detail: '登录成功', ip });
  return new Response(JSON.stringify({ ok: true, user: { id: acc.id, username: acc.username } }), {
    status: 200,
    headers: { 'Set-Cookie': cookie, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function me(req, env, accountId) {
  const acc = await orc.getAccount(env.DB, accountId);
  if (!acc) return err('未找到账号', 404);
  const { github_token_enc, totp_secret_enc, password_hash, ...pub } = acc;
  return ok({ user: pub });
}

async function listAccounts(env) {
  const { results } = await env.DB.prepare(
    'SELECT id,username,status,mode,ai_persona,note_repo,timezone,weekly_active_days,rest_until,last_action_at,created_at FROM accounts ORDER BY created_at'
  ).all();
  return ok({ accounts: results || [] });
}

async function createAccount(req, env) {
  const body = await req.json().catch(() => ({}));
  const username = String(body.username || '').trim();
  if (!username) return err('username 必填');
  const exists = await env.DB.prepare('SELECT id FROM accounts WHERE username = ? COLLATE NOCASE').bind(username).first();
  if (exists) return err('账号已存在');
  const id = crypto.randomUUID();
  const tSecret = totp.randomSecret();
  const encToken = body.github_token ? await seal(env, String(body.github_token).trim()) : null;
  const passwordHash = body.password ? await hashPassword(String(body.password)) : null;
  await env.DB.prepare(
    `INSERT INTO accounts
      (id, username, password_hash, totp_secret_enc, github_token_enc, status, mode, ai_persona, note_repo, timezone, weekly_active_days, rest_until)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, username, passwordHash, await seal(env, tSecret), encToken,
    'active', body.mode || 'rule', body.ai_persona || null, body.note_repo || null,
    body.timezone || '+08:00', Number(body.weekly_active_days || 5), body.rest_until || null
  ).run();
  return ok({ id, username, otpauth: totp.otpauthUrl(username, tSecret), tip: 'otpauth 仅显示这一次，请立即保存' });
}

async function updateAccount(req, env, url) {
  const accountId = url.pathname.split('/')[3];
  const body = await req.json().catch(() => ({}));
  const fields = [];
  const vals = [];
  for (const [k, v] of Object.entries(body)) {
    if (['status', 'mode', 'ai_persona', 'note_repo', 'timezone', 'weekly_active_days', 'rest_until'].includes(k)) {
      fields.push(`${k} = ?`);
      vals.push(v);
    }
    if (k === 'github_token' && v) {
      fields.push('github_token_enc = ?');
      vals.push(await seal(env, String(v).trim()));
    }
  }
  if (!fields.length) return err('没有可更新的字段');
  vals.push(accountId);
  await env.DB.prepare(`UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`).bind(...vals).run();
  return ok({ updated: accountId });
}

async function removeAccount(env, url) {
  const id = url.pathname.split('/')[3];
  if (!id) return err('缺少 id');
  await env.DB.prepare('DELETE FROM scheduled_actions_queue WHERE account_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(id).run();
  return ok({ deleted: id });
}

// ---------- 动作池 ----------
async function listPools(env) {
  const { results } = await env.DB.prepare('SELECT id, category, content, tag FROM action_pools ORDER BY category, id DESC LIMIT 300').all();
  return ok({ pools: results || [] });
}
async function addPool(req, env) {
  const body = await req.json().catch(() => ({}));
  if (!body.category || !body.content) return err('category 与 content 必填');
  const r = await env.DB.prepare('INSERT INTO action_pools (category, content, tag) VALUES (?,?,?)')
    .bind(body.category, body.content, body.tag || null).run();
  return ok({ id: r.meta.last_row_id });
}
async function deletePool(env, url) {
  const id = Number(url.pathname.split('/')[3]);
  if (!id) return err('缺少 id');
  await env.DB.prepare('DELETE FROM action_pools WHERE id = ?').bind(id).run();
  return ok({ deleted: id });
}

// ---------- 星计划 ----------
async function listCampaigns(env) {
  return ok({ campaigns: await orc.listCampaigns(env.DB) });
}
async function createCampaignHandler(req, env) {
  const body = await req.json().catch(() => ({}));
  const all = await orc.listActiveAccounts(env.DB);
  try {
    return ok(await orc.createCampaign(env.DB, body, all));
  } catch (e) {
    return err(String((e && e.message) || e), 400);
  }
}
async function cancelCampaign(env, url) {
  const id = url.pathname.split('/')[3];
  const r = await env.DB.prepare("UPDATE star_campaigns SET status = 'cancelled' WHERE id = ?").bind(id).run();
  await env.DB.prepare("UPDATE scheduled_actions_queue SET status = 'cancelled' WHERE campaign_id = ? AND status = 'pending'").bind(id).run();
  return ok({ changed: r.meta.changes });
}

// ---------- 任务队列 ----------
async function listQueue(req, env) {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') || 'all';
  const limit = Math.min(200, Number(url.searchParams.get('limit') || 50));
  const { results } = status === 'all'
    ? await env.DB.prepare('SELECT * FROM scheduled_actions_queue ORDER BY planned_at DESC LIMIT ?').bind(limit).all()
    : await env.DB.prepare('SELECT * FROM scheduled_actions_queue WHERE status = ? ORDER BY planned_at DESC LIMIT ?').bind(status, limit).all();
  return ok({ queue: results || [] });
}
async function enqueue(req, env) {
  const body = await req.json().catch(() => ({}));
  if (!body.account_id || !body.action_type) return err('account_id 与 action_type 必填');
  const planned = body.planned_at || new Date(Date.now() + 60_000).toISOString();
  const r = await env.DB.prepare('INSERT INTO scheduled_actions_queue (account_id, action_type, action_payload, planned_at) VALUES (?,?,?,?)')
    .bind(body.account_id, body.action_type, body.action_payload ? JSON.stringify(body.action_payload) : '{}', planned).run();
  return ok({ id: r.meta.last_row_id, planned_at: planned });
}
async function runNow(env, url) {
  const id = Number(url.pathname.split('/')[3]);
  if (!id) return err('缺少 id');
  const row = await env.DB.prepare('SELECT * FROM scheduled_actions_queue WHERE id = ?').bind(id).first();
  if (!row) return err('任务不存在', 404);
  await orc.executeTask(env, row);
  return ok({ executed: row.id });
}

// ---------- 日志与状态 ----------
async function logs(req, env) {
  const url = new URL(req.url);
  const limit = Math.min(200, Number(url.searchParams.get('limit') || 50));
  const { results } = await env.DB.prepare('SELECT * FROM execution_logs ORDER BY id DESC LIMIT ?').bind(limit).all();
  return ok({ logs: results || [] });
}
async function status(env) {
  const stats = await orc.getQueueStats(env.DB);
  const campaigns = await orc.listCampaigns(env.DB);
  return ok({ app: env.APP_NAME || 'gitpulse', stats, activeCampaigns: campaigns.filter((c) => c.status === 'running').length });
}

// ---------- 路由 ----------
async function handleRequest(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === 'GET' && (path === '/' || path === '/console')) {
      return new Response(consoleHTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    if (req.method === 'GET' && path === '/favicon.ico') {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="82" font-size="80">📈</text></svg>';
      return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
    }
    if (req.method === 'GET' && path === '/api/status') return status(env);
    if (req.method === 'POST' && path === '/api/auth/setup') return setup(req, env);
    if (req.method === 'POST' && path === '/api/auth/login') return login(req, env);
    if (req.method === 'POST' && path === '/api/auth/logout') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Set-Cookie': authM.logoutCookie(), 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    if (!path.startsWith('/api/')) return err('not found', 404);
    const accountId = await requireAuth(req, env);
    if (!accountId) return err('未登录或会话过期', 401);

    let resp = null;
    try {
      if (req.method === 'GET' && path === '/api/auth/me') resp = await me(req, env, accountId);
      else if (req.method === 'GET' && path === '/api/accounts') resp = await listAccounts(env);
      else if (req.method === 'POST' && path === '/api/accounts') resp = await createAccount(req, env);
      else if (req.method === 'PUT' && path.startsWith('/api/accounts/')) resp = await updateAccount(req, env, url);
      else if (req.method === 'DELETE' && path.startsWith('/api/accounts/')) resp = await removeAccount(env, url);
      else if (req.method === 'GET' && path === '/api/campaigns') resp = await listCampaigns(env);
      else if (req.method === 'POST' && path === '/api/campaigns') resp = await createCampaignHandler(req, env);
      else if (req.method === 'POST' && path.startsWith('/api/campaigns/') && path.endsWith('/cancel')) resp = await cancelCampaign(env, url);
      else if (req.method === 'GET' && path === '/api/queue') resp = await listQueue(req, env);
      else if (req.method === 'POST' && path === '/api/queue') resp = await enqueue(req, env);
      else if (req.method === 'POST' && path.startsWith('/api/queue/') && path.endsWith('/run')) resp = await runNow(env, url);
      else if (req.method === 'GET' && path === '/api/pools') resp = await listPools(env);
      else if (req.method === 'POST' && path === '/api/pools') resp = await addPool(req, env);
      else if (req.method === 'DELETE' && path.startsWith('/api/pools/')) resp = await deletePool(env, url);
      else if (req.method === 'GET' && path === '/api/logs') resp = await logs(req, env);
      else if (req.method === 'GET' && path === '/api/admin-audit') {
        const limit = Math.min(200, Number(url.searchParams.get('limit') || 100));
        resp = ok({ logs: await audit.listAdminLogs(env.DB, limit) });
      }
      if (!resp) resp = err('not found', 404);
    } catch (e) {
      resp = err(String((e && e.message) || e), 500);
    }
    // 管理写操作成功后留痕（审计失败不影响响应）
    const act = matchAudit(req.method, path);
    if (act && resp.status < 400) {
      await audit.logAdmin(env.DB, { accountId, action: act, detail: `${req.method} ${path}`, ip: audit.clientIp(req) });
    }
    return resp;
}

// 全局异常兜底：任何未捕获错误都返回 JSON（便于控制台排查），而不是 Cloudflare HTML 错误页
export default {
  async fetch(req, env) {
    try {
      return await handleRequest(req, env);
    } catch (e) {
      console.error('unhandled error:', e && (e.stack || e.message || e));
      return err(`服务器内部错误: ${String((e && e.message) || e)}`, 500);
    }
  },
  async scheduled(event, env) {
    try { await orc.runCycle(env); } catch (e) { console.error('scheduled error', e); }
  },
};