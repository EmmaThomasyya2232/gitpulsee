-- 1. 开发者（被守护账号）表
CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,          -- PBKDF2(salt:hash)
    totp_secret_enc TEXT NOT NULL,        -- AES-GCM 加密后的 TOTP 种子
    github_token_enc TEXT,                -- AES-GCM 加密后的 GitHub Personal Access Token
    cookie_jar TEXT,                      -- 预留：浏览器会话 Cookie 罐（加密 json）
    fingerprint TEXT,                     -- 预留：账号指纹
    status TEXT DEFAULT 'active',         -- active | token_invalid | paused | banned
    mode TEXT DEFAULT 'rule',             -- rule: 规则驱动 | ai: AI 人格驱动
    ai_persona TEXT,                      -- AI 人格描述
    note_repo TEXT,                       -- 签到提交的目标仓库 (owner/repo)
    timezone TEXT DEFAULT '+08:00',       -- 时区偏移，例如 +08:00
    weekly_active_days INTEGER DEFAULT 3, -- 每周活跃天数
    rest_until TEXT,                      -- 休眠截止日期 YYYY-MM-DD
    last_action_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 2. 分布式项目关注（打星/关注）计划表
CREATE TABLE IF NOT EXISTS star_campaigns (
    id TEXT PRIMARY KEY,
    target_repo TEXT NOT NULL,            -- owner/repo
    target_user TEXT,
    total_target INTEGER NOT NULL,
    duration_days INTEGER NOT NULL,
    action_mix TEXT DEFAULT 'star,follow,watch',
    account_ids TEXT,                     -- JSON 数组，参与账号 id；空则全部活跃账号
    completed_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 3. 分布式执行切片队列
CREATE TABLE IF NOT EXISTS scheduled_actions_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id TEXT,
    account_id TEXT NOT NULL,
    action_type TEXT NOT NULL,            -- star | follow | watch | commit_note | issue
    action_payload TEXT,                  -- JSON: {"repo":"a/b","user":"u"}
    planned_at TEXT NOT NULL,             -- 计划执行时间 (ISO-8601)
    executed_at TEXT,
    status TEXT DEFAULT 'pending',        -- pending | done | failed
    error_msg TEXT
);
CREATE INDEX IF NOT EXISTS idx_queue_due ON scheduled_actions_queue(status, planned_at);
CREATE INDEX IF NOT EXISTS idx_queue_account ON scheduled_actions_queue(account_id);

-- 4. 动作池（文案/标题等模板）
CREATE TABLE IF NOT EXISTS action_pools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,               -- 例如 commit_note / star_comment
    content TEXT NOT NULL,
    tag TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 5. 执行审计流水日志
CREATE TABLE IF NOT EXISTS execution_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT,
    action_type TEXT NOT NULL,
    action_target TEXT,
    status_code INTEGER,
    response_msg TEXT,
    is_success BOOLEAN NOT NULL,
    executed_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_logs_account ON execution_logs(account_id);
CREATE INDEX IF NOT EXISTS idx_logs_time ON execution_logs(executed_at);

-- 6. 提示词与说明语句种子数据
INSERT OR IGNORE INTO action_pools (category, content, tag) VALUES
('commit_note', '日常：今天也在持续向前。', 'daily'),
('commit_note', '日常：整理了一点资料，慢慢积累。', 'daily'),
('commit_note', '日常：读了些别人的代码，收益很多。', 'daily'),
('commit_note', '日常：坚持比速度更重要。', 'daily'),
('commit_note', '日常：今天没有偷懒，冒个泡。', 'daily'),
('commit_note', '日常：在做一个长期的小项目。', 'daily'),
('stargazers', '给项目点个 star，支持开源精神。', 'template');