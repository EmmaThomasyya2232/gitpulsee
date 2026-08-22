-- 0004_webauth.sql —— Web 协议会话认证层
-- 彻底废除 GitHub Token(PAT) API 认证，改为 CookieJar + 固化指纹 + 静默自愈
ALTER TABLE accounts ADD COLUMN gh_password_enc TEXT;      -- AES-GCM 加密的 GitHub 登录密码
ALTER TABLE accounts ADD COLUMN gh_totp_enc TEXT;          -- AES-GCM 加密的该账号 2FA Secret(Base32)
ALTER TABLE accounts ADD COLUMN auth_state TEXT DEFAULT 'unverified'; -- unverified|valid|invalid
ALTER TABLE accounts ADD COLUMN last_probe_at TEXT;        -- 最近一次会话探测时间 ISO
-- 注：cookie_jar / fingerprint 两列在 0001 已预留，本迁移启用之
