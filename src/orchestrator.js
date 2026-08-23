// ============================================================
// orchestrator.js —— 分布式调度核心
//   1) runDue(): 执行到期队列切片
//   2) replenishNotes(): 每日补充“笔记/签到”动作
//   3) createCampaign(): 把星标/关注计划切成按天、按账号的切片
// ============================================================
import { generateNote } from './ai.js';
import * as ghApi from './github.js';
import { unseal } from './crypto.js';

// ---------- 小工具 ----------
export const nowIso = () => new Date().toISOString();

export function offsetMinutes(tz = '+08:00') {
  const m = /^([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(String(tz).trim());
  if (!m) return 480;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + (m[3] ? Number(m[3]) : 0));
}

/** 把 (dateStr, h:m) 转换成本地时间对应的 UTC ISO */
export function plannedAt(tz, dateStr, h = 9, m = 0) {
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  const utcMs = Date.UTC(y, (mo || 1) - 1, d || 1, h, m) - offsetMinutes(tz) * 60000;
  return new Date(utcMs).toISOString();
}

function daysAhead(futureDays = 3) {
  const out = [];
  const base = new Date();
  for (let i = 0; i < futureDays; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** 用账号 id + 日期做确定性伪随机，控制“周活跃天数”的分布 */
export function isActiveDay(acc, isoDateStr) {
  if (acc.status && acc.status !== 'active') return false;
  if (acc.rest_until && acc.rest_until >= isoDateStr) return false;
  const n = Number(acc.weekly_active_days || 3);
  if (n >= 7) return true;
  let h = 5381;
  const s = `${acc.id}|${isoDateStr}`;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return (h % 7) < n;
}

// ---------- 泊松风格自然化时间引擎 ----------
/** 标准指数分布随机数（泊松过程的到达间隔基元） */
export function expRand(mean = 1) {
  return -Math.log(1 - Math.random()) * mean;
}

/**
 * 在 [winStart, winEnd]（本地分钟数）内生成一个"自然"时刻。
 * 混合策略：50% 均匀、50% 指数偏向前段（一天里人们倾向于在上午/早些时候冒泡），
 * 从而形成非机械、去规律的节奏。
 */
export function naturalMinute(winStart = 9 * 60, winEnd = 23 * 60) {
  const span = Math.max(1, Math.floor(winEnd - winStart));
  if (Math.random() < 0.5) return winStart + Math.floor(Math.random() * span);
  const e = Math.floor(expRand(span / 3));
  return Math.max(winStart, Math.min(winEnd - 1, winStart + e));
}

/** 与账号×天维度已用分钟去重：避免同一天同一时刻的机械重复 */
export function nextNaturalMinute(used = null, winStart = 9 * 60, winEnd = 23 * 60) {
  for (let i = 0; i < 8; i++) {
    const m = naturalMinute(winStart, winEnd);
    if (!used || !used.has(m)) {
      if (used) used.add(m);
      return m;
    }
  }
  // 兜底：返回窗口内第一个空闲分钟
  for (let m = winStart; m < winEnd; m++) {
    if (!used || !used.has(m)) {
      if (used) used.add(m);
      return m;
    }
  }
  return winStart + Math.floor(Math.random() * (winEnd - winStart));
}

// ---------- D1 查询 ----------
const S_cols = 'id,username,status,mode,ai_persona,note_repo,timezone,weekly_active_days,rest_until,last_action_at,created_at';

export async function listActiveAccounts(db) {
  const { results } = await db.prepare(`SELECT ${S_cols} FROM accounts WHERE status='active' ORDER BY username`).all();
  return results || [];
}

export async function getAccount(db, id) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first() || null;
}

// ---------- 执行单个切片（Token REST 通道：解密 Token → REST 动作 → 401/403 熔断） ----------
const accountToken = async (env, acc) => {
  if (!acc.github_token_enc) return null;
  try { return await unseal(env, acc.github_token_enc); } catch { return null; }
};

async function markTokenInvalid(db, id) {
  await db.prepare("UPDATE accounts SET status = 'token_invalid', auth_state = 'invalid' WHERE id = ?").bind(id).run();
}

export async function executeTask(env, row) {
  const db = env.DB;
  try {
    const acc = await getAccount(db, row.account_id);
    if (!acc) throw new Error('account_not_found');

    // Token 通道：解密 PAT；缺失/解密失败直接熔断为 token_invalid
    const token = await accountToken(env, acc);
    if (!token) {
      await markTokenInvalid(db, acc.id);
      throw new Error('no_github_token');
    }

    const payload = safeParse(row.action_payload, {});
    // 旧载荷兜底：若 payload.repo 是裸仓库名且账号明确有登录名，则补前缀；
    // 无登录名时保留原值交 REST（避免把目标猜错到他人命名空间）
    const fullRepo = (r) => (r && !r.includes('/') && (acc.gh_login || acc.username) ? `${acc.gh_login || acc.username}/${r}` : r);
    if (typeof payload.repo === 'string') payload.repo = fullRepo(payload.repo);
    let result;
    let target = payload.repo || payload.user || acc.note_repo || '';

    switch (row.action_type) {
      case 'star':
        target = payload.repo;
        result = await ghApi.starRepo(token, target);
        break;
      case 'unstar':
        target = payload.repo;
        result = await ghApi.unstarRepo(token, target);
        break;
      case 'follow':
        target = payload.user;
        result = await ghApi.followUser(token, target);
        break;
      case 'watch':
        target = payload.repo;
        result = await ghApi.watchRepo(token, target);
        break;
      case 'commit_note': {
        target = acc.note_repo || payload.repo;
        if (!target) throw new Error('missing_note_repo');
        // mode=ai 时尝试 LLM 生成日常文案（未配置/失败自动回退动作池）
        const note = await generateNote(env, acc, db);
        const dateTag = nowIso().slice(0, 10);
        result = await ghApi.commitNote(token, target, {
          content: note.content,
          message: payload.message || `daily note · ${dateTag}`,
          date: dateTag,
        });
        break;
      }
      case 'issue':
        target = payload.repo;
        if (!target) throw new Error('missing_repo');
        result = await ghApi.createIssue(
          token, target,
          payload.title || '👣 关注一下',
          await samplePool(db, 'stargazers', '给项目一个小脚印。'),
        );
        break;
      default:
        throw new Error(`unknown_action:${row.action_type}`);
    }

    const ok = result && result.status >= 200 && result.status < 300;
    if (ok) {
      await bumpCampaign(db, row.campaign_id);
      await db.prepare('UPDATE accounts SET last_action_at = ?, auth_state = ? WHERE id = ?')
        .bind(nowIso().slice(0, 19), 'valid', acc.id).run();
      await log(env, acc.id, row.action_type, target, result.status, trunc(result.data && result.data.message ? result.data.message : 'ok', 500), true);
      await finish(db, row.id, true);
      return;
    }

    // Token 失效/权限不足：熔断 token_invalid，本切片永久失败
    if (result && (result.status === 401 || result.status === 403)) {
      const msg = `token_auth_fail http_${result.status}`;
      await log(env, acc.id, row.action_type, target, result.status, msg, false);
      await markTokenInvalid(db, acc.id);
      await handleFailure(env, row, { msg, status: result.status, permanent: true });
      return;
    }

    // 非 2xx：目标不存在等配置类错误直接失败；限流/服务端类进入指数退避重试
    const msg = `${result && result.data && result.data.message ? result.data.message : `http_${result ? result.status : 0}`}`;
    await log(env, acc.id, row.action_type, target, result ? result.status : 0, msg, false);
    await handleFailure(env, row, { msg, status: result ? result.status : 0 });
  } catch (err) {
    const msg = String((err && err.message) || err).slice(0, 300);
    await log(env, row.account_id, row.action_type, '', 0, msg, false);
    await handleFailure(env, row, { msg, status: 0 });
  }
}

// ---------- 失败重试与指数退避 ----------
const RETRY_MAX = 3;
const RETRY_BASE_MS = 5 * 60 * 1000; // 首次退避 5 分钟，之后翻倍

export function retryDelayMs(retryCount, baseMs = RETRY_BASE_MS) {
  return baseMs * Math.pow(2, Math.min(retryCount || 0, 8));
}
export function shouldRetry(retryCount, max = RETRY_MAX) {
  return (retryCount || 0) < max;
}
const PERMANENT_MSGS = new Set(['account_not_found', 'no_github_token', 'auth_failed_circuit_break', 'missing_note_repo', 'missing_repo', 'unknown_action']);
export function isPermanentError(statusOrMsg, statusCode) {
  if (typeof statusOrMsg === 'number') return statusOrMsg === 401 || statusOrMsg === 403;
  if (statusCode === 401 || statusCode === 403) return true;
  return PERMANENT_MSGS.has(String(statusOrMsg || '').trim());
}

/** 失败统一出口：permanent=true 强制不重试；可重试 → 依指数退避重新入列；否则标记 failed */
async function handleFailure(env, row, { msg, status, permanent = false }) {
  const db = env.DB;
  if (!permanent && !isPermanentError(msg, status) && shouldRetry(row.retry_count)) {
    const delay = retryDelayMs(row.retry_count);
    const nextAt = new Date(Date.now() + delay).toISOString();
    await db.prepare(
      `UPDATE scheduled_actions_queue
          SET status = 'pending', planned_at = ?, retry_count = retry_count + 1, executed_at = NULL, error_msg = ?
        WHERE id = ?`
    ).bind(nextAt, `retry#${(row.retry_count || 0) + 1} at ${nextAt} · ${msg}`, row.id).run();
    return;
  }
  await finish(db, row.id, false, msg);
}

async function finish(db, id, ok, extra = null) {
  await db.prepare('UPDATE scheduled_actions_queue SET status = ?, executed_at = ?, error_msg = ? WHERE id = ?')
    .bind(ok ? 'done' : 'failed', nowIso(), extra, id).run();
}

async function log(env, accountId, type, target, status, msg, ok) {
  await env.DB.prepare(
    'INSERT INTO execution_logs (account_id, action_type, action_target, status_code, response_msg, is_success) VALUES (?,?,?,?,?,?)'
  ).bind(accountId || '', type, String(target || '').slice(0, 200), status || 0, String(msg || '').slice(0, 400), ok ? 1 : 0).run();
}

async function bumpCampaign(db, campaignId) {
  if (!campaignId) return;
  await db.prepare("UPDATE star_campaigns SET completed_count = completed_count + 1 WHERE id = ? AND status = 'running'").bind(campaignId).run();
  await db.prepare("UPDATE star_campaigns SET status = 'completed' WHERE id = ? AND completed_count >= total_target").bind(campaignId).run();
}

function safeParse(s, fallback) {
  try { return s ? JSON.parse(s) : { ...fallback }; } catch { return { ...fallback }; }
}

async function samplePool(db, category, fallback = null) {
  const row = await db.prepare('SELECT content FROM action_pools WHERE category = ? ORDER BY RANDOM() LIMIT 1').bind(category).first();
  return row ? row.content : (fallback || '');
}

function trunc(s, len) {
  const str = String(s ?? '');
  return str.length > len ? str.slice(0, len) : str;
}

// ---------- 定时器：到期任务 + 每日活跃补充 ----------
export async function runCycle(env) {
  // 熔断：仅执行 status='active' 账号的切片（invalid/paused 自动跳过）
  const { results: due } = await env.DB.prepare(
    `SELECT q.* FROM scheduled_actions_queue q
       JOIN accounts a ON a.id = q.account_id
      WHERE q.status = 'pending' AND q.planned_at <= ? AND a.status = 'active'
      ORDER BY q.planned_at ASC LIMIT ?`
  ).bind(nowIso(), Number(env.RUN_BATCH || 10)).all();
  for (const row of due) await executeTask(env, row);
  await replenishNotes(env, daysAhead(3));
}

export async function replenishNotes(env, dateStrs) {
  const accs = await listActiveAccounts(env.DB);
  for (const acc of accs) {
    if (!acc.note_repo) continue;
    for (const day of dateStrs) {
      const dayStart = plannedAt(acc.timezone, day, 0, 0);
      const dayEnd = plannedAt(acc.timezone, day, 23, 59);
      const { results } = await env.DB.prepare(
        `SELECT id FROM scheduled_actions_queue
          WHERE account_id = ? AND action_type = 'commit_note' AND status = 'pending'
            AND planned_at >= ? AND planned_at <= ? LIMIT 1`
      ).bind(acc.id, dayStart, dayEnd).all();
      if (results.length === 0) {
        const min = nextNaturalMinute(null, 8 * 60, 18 * 60); // 本地 08:00~18:00 自然时刻
        await env.DB.prepare(
          'INSERT INTO scheduled_actions_queue (campaign_id, account_id, action_type, action_payload, planned_at) VALUES (NULL,?,?,?,?)'
        ).bind(acc.id, 'commit_note', '{}', plannedAt(acc.timezone, day, Math.floor(min / 60), min % 60)).run();
      }
    }
  }
}

// ---------- 星计划：切片生成 ----------
export async function createCampaign(db, input, allAccounts) {
  const targetRepo = String(input.target_repo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
  const targetUser = String(input.target_user || '').trim();
  // 归一化：目标必须是 owner/repo 全名。
  // 兼容「填了目标用户名 + 仓库名」或「target_repo 已带 owner/」两种写法；
  // 只填裸仓库名时一律视为目标用户名缺失 → 明确报错，不做任何猜测式自动补前缀，
  // 避免把目标错误归属到当前账号命名空间导致 404（如 gitpulsee 实属其他用户）。
  const parts = targetRepo.split('/');
  let owner = parts[0] || '';
  let repoName = parts.length >= 2 && parts[0] ? targetRepo : '';
  if (parts.length === 1 && parts[0] && targetUser) { owner = targetUser; repoName = parts[0]; } // 显式目标用户补全
  const normalizedRepo = repoName ? `${owner}/${repoName}` : targetRepo.split('/')[1] ? `${parts[0]}/${parts.slice(1).join('/')}` : '';
  const actionTypes = String(input.action_mix || 'star,follow,watch').split(',').map((s) => s.trim()).filter(Boolean);
  if (!/^[A-Za-z0-9-]+\/[^/]+$/.test(normalizedRepo)) {
    throw new Error('target_repo 格式错误：必须填写完整 owner/repo（例如 EmmaThomasyya2232/gitpulsee），单一仓库名无法确定归属');
  }
  const total = Math.max(1, Number(input.total_target || 50));
  const days = Math.max(1, Math.min(90, Number(input.duration_days || 7)));

  let pool = allAccounts.filter((a) => a.status === 'active');
  if (input.account_ids && input.account_ids.length) {
    const set = new Set(input.account_ids);
    pool = pool.filter((a) => set.has(a.id));
  }

  // 预计算“账号 × 天”可用切片，按天分桶
  const slots = [];
  const base = new Date();
  for (let d = 1; d <= days; d++) {
    const cur = new Date(base);
    cur.setDate(cur.getDate() + d);
    const dayStr = cur.toISOString().slice(0, 10);
    for (const a of pool) if (isActiveDay(a, dayStr)) slots.push({ acc: a, dayStr });
  }
  if (!slots.length) throw new Error('没有可用账号/日期切片');

  const dayBuckets = new Map(); // dayStr -> [acc]
  for (const s of slots) {
    if (!dayBuckets.has(s.dayStr)) dayBuckets.set(s.dayStr, []);
    dayBuckets.get(s.dayStr).push(s.acc);
  }
  const dayStrs = [...dayBuckets.keys()];

  const cid = crypto.randomUUID();
  await db.prepare('INSERT INTO star_campaigns (id, target_repo, target_user, total_target, duration_days, action_mix, account_ids) VALUES (?,?,?,?,?,?,?)')
    .bind(cid, normalizedRepo, targetUser || null, total, days, actionTypes.join(','), input.account_ids ? JSON.stringify(input.account_ids) : null).run();

  let inserted = 0;
  const usedMin = new Map(); // `${accId}|${dayStr}` -> Set<分钟>
  for (let i = 0; i < total; i++) {
    // 轮盘选天：活跃账号越多的天越可能被选中（自然偏置）
    const totalW = dayStrs.reduce((sum, d) => sum + dayBuckets.get(d).length, 0);
    let r = Math.random() * totalW;
    let dayStr = dayStrs[0];
    for (const d of dayStrs) {
      r -= dayBuckets.get(d).length;
      if (r <= 0) { dayStr = d; break; }
    }
    const acc = dayBuckets.get(dayStr)[Math.floor(Math.random() * dayBuckets.get(dayStr).length)];
    const kind = actionTypes[i % actionTypes.length];
    const payload = kind === 'follow' ? { user: targetUser } : { repo: normalizedRepo };

    // 同一账号同一天的时刻去重（去机械感）
    const key = acc.id + '|' + dayStr;
    if (!usedMin.has(key)) usedMin.set(key, new Set());
    const minute = nextNaturalMinute(usedMin.get(key), 9 * 60, 23 * 60); // 本地 09:00~23:00
    await db.prepare(
      'INSERT INTO scheduled_actions_queue (campaign_id, account_id, action_type, action_payload, planned_at) VALUES (?,?,?,?,?)'
    ).bind(cid, acc.id, kind, JSON.stringify(payload), plannedAt(acc.timezone, dayStr, Math.floor(minute / 60), minute % 60)).run();
    inserted++;
  }

  return { id: cid, inserted, accounts: new Set(slots.map((s) => s.acc.id)).size, slots: slots.length };
}

export async function listCampaigns(db) {
  const { results } = await db.prepare('SELECT * FROM star_campaigns ORDER BY created_at DESC LIMIT 50').all();
  return results || [];
}

export async function getQueueStats(db) {
  const one = async (sql) => (await db.prepare(sql).first()).n;
  const [pending, done, failed, accounts, active, runs, okRuns] = await Promise.all([
    one("SELECT COUNT(*) AS n FROM scheduled_actions_queue WHERE status = 'pending'"),
    one("SELECT COUNT(*) AS n FROM scheduled_actions_queue WHERE status = 'done'"),
    one("SELECT COUNT(*) AS n FROM scheduled_actions_queue WHERE status = 'failed'"),
    one('SELECT COUNT(*) AS n FROM accounts'),
    one("SELECT COUNT(*) AS n FROM accounts WHERE status = 'active'"),
    one('SELECT COUNT(*) AS n FROM execution_logs'),
    one('SELECT COUNT(*) AS n FROM execution_logs WHERE is_success = 1'),
  ]);
  return { pending, done, failed, accounts, active, runs, okRuns };
}