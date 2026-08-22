// ============================================================
// audit.js —— 管理员操作审计
// 谁在什么时候、从哪个 IP、对控制台做了什么（登录 / 敏感写操作）
// ============================================================

/** 详情截断：防止超长内容刷爆数据库行 */
export function clipDetail(s, max = 300) {
  const str = String(s == null ? '' : s);
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

/** 提取客户端 IP：优先 Cloudflare 注入头，其次 XFF 第一段 */
export function clientIp(req) {
  const raw =
    req.headers.get('CF-Connecting-IP') ||
    req.headers.get('X-Forwarded-For') ||
    '';
  return raw.split(',')[0].trim() || null;
}

/** 写一条管理审计（永不抛错，避免影响主流程） */
export async function logAdmin(db, { accountId = null, username = null, action, detail = '', ip = null }) {
  try {
    await db
      .prepare('INSERT INTO admin_audit_logs (account_id, username, action, detail, ip) VALUES (?,?,?,?,?)')
      .bind(accountId, username, String(action), clipDetail(detail), ip)
      .run();
  } catch { /* 审计失败不阻断业务 */ }
}

/** 倒序查询最近的管理审计 */
export async function listAdminLogs(db, limit = 100) {
  const { results } = await db
    .prepare('SELECT * FROM admin_audit_logs ORDER BY id DESC LIMIT ?')
    .bind(Math.min(500, Number(limit) || 100))
    .all();
  return results || [];
}
