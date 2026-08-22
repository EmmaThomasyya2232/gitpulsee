-- 0002: 为调度队列增加失败重试计数（配合指数退避）
ALTER TABLE scheduled_actions_queue ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;