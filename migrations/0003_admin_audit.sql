-- 0003: 管理员操作审计日志（控制台登录与敏感操作留痕）
CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT,                      -- 操作者账号 id（登录失败时可为空）
    username TEXT,                        -- 操作者用户名（尽力记录，含登录失败尝试）
    action TEXT NOT NULL,                 -- setup / login_ok / login_fail / account_create / campaign_cancel ...
    detail TEXT,                          -- 摘要说明
    ip TEXT,                              -- 来源 IP（CF-Connecting-IP）
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_time ON admin_audit_logs(created_at);
