-- 0005_add_gh_login.sql —— 补充 accounts.gh_login 列
-- webauth 改造中 index.js 的 A_cols 与 INSERT 引用了 gh_login（账号的 GitHub 登录名），
-- 但 0001~0004 均未创建该列，导致 /api/accounts 报 no such column: gh_login。
ALTER TABLE accounts ADD COLUMN gh_login TEXT;
