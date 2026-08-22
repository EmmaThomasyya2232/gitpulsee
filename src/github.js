// ============================================================
// github.js —— GitHub REST API 客户端（纯 fetch）
// 所有操作均为幂等/可重入：star/follow/subscription 天然幂等，
// commit_note 通过 文件 sha 实现 upsert。
// ============================================================
const API = 'https://api.github.com';

function authHeader(token) {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'gitpulse/1.0' };
}

export async function gh(method, url, token, body) {
  const res = await fetch(API + url, {
    method,
    headers: { ...authHeader(token), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  return { status: res.status, data };
}

export const starRepo = (token, repo) => gh('PUT', `/user/starred/${encodeURIComponent(repo)}`, token);
export const unstarRepo = (token, repo) => gh('DELETE', `/user/starred/${encodeURIComponent(repo)}`, token);
export const followUser = (token, user) => gh('PUT', `/user/following/${encodeURIComponent(user)}`, token);
export const watchRepo = (token, repo) => gh('PUT', `/repos/${encodeURIComponent(repo)}/subscription`, token, { subscribed: true });

/**
 * 向 note_repo 写入一条“笔记/签到”提交（遍历 main → master）
 */
export async function commitNote(token, repo, { content, message, date }) {
  const safe = String(repo).replace(/[^\w-.\/]/g, '');
  const path = `activity/${String(date)}.md`;
  const b64 = utf8ToB64(content);
  const get = await gh('GET', `/repos/${safe}/contents/${path}`, token);
  const sha = get.status === 200 && get.data && get.data.sha ? get.data.sha : undefined;
  const payload = { message: message || `daily note · ${date}`, content: b64 };
  if (sha) payload.sha = sha;
  const put = await gh('PUT', `/repos/${safe}/contents/${path}`, token, payload);
  return put;
}

export function utf8ToB64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}