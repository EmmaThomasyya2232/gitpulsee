# 更新日志（Changelog）

本项目的所有重要变更都会记录在此文件中。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.1.0] - 2026-08-23

### 变更：执行通道全面切换为 GitHub Token REST API 🔄

#### 背景
- GitHub 对 github.com 网页端启用了 **DataDome 风控**：Workers 数据中心 IP 无法通过
  「协议登录」（即使对齐 TLS/UA/Cookie，参考 curl_cffi 方案在服务器环境同样被拦截），
  手动导入 Cookie 又存在**会话频繁失效**的运维问题。
- REST API（`api.github.com` + PAT）不受 DataDome 影响，且 Token 长期有效、可随时吊销重发。

#### 变更
- **orchestrator.executeTask**：动作执行由「Web 会话探测→自愈→webAct」切换为
  「解密 `github_token_enc` → REST 动作 → 401/403 熔断 token_invalid」；
  commit_note 改走 `PUT /repos/{repo}/contents/{path}`。
- **添加账号表单**：必填项由「GitHub 登录密码」改为「GitHub Token (PAT)」；
  账密/2FA 转为可选备用字段（数据库列保留，备用 Web 通道未删除）。
- **检测/重新验证接口**：改为 `GET /api.github.com/user` Token 探测，
  返回具体中文原因（Token 有效 / 已失效 401 / 解密失败 / 限流）。
- **移除「导入 Cookie」功能**及对应 `/api/accounts/:id/cookies` 接口与登录失败文案表。
- **控制台徽章文案**：「Cookie有效」→「Token有效」，「需重新认证」→「Token失效」。

#### 兼容性
- 数据库无需迁移（`github_token_enc` 列 0001 已预留）。
- 旧账号若未填 Token，执行时会被熔断为 token_invalid 并提示补充 PAT
  （编辑账号填入 github_token 后自动恢复 unverified，检测通过即转 active）。

#### PAT 权限建议
- classic PAT：勾选 `repo` + `user`（follow 需要）。
- fine-grained PAT：按仓库勾选 Contents(读写) / Issues(读写) / Starring(读写)，
  账号权限勾选 Followers(读写)。

## [1.0.0] - 2026-08-22

### 首个正式版本 🎉

#### 新增
- **多身份管理**：账号入驻 / 状态机（active · paused · token_invalid）/ 时区 / 每周活跃天数
- **登录安全**：PBKDF2 口令散列 + TOTP 双因素（RFC 6238，纯 Web Crypto 实现）
- **加密存储**：GitHub Token 与 TOTP 种子使用 AES-256-GCM 密文落库
- **去规律化作息引擎**：确定性伪随机分配周活跃日，避开深夜时段
- **泊松式时间打散**：指数分布随机时刻 + 账号×天去重，Campaign 切片轮盘选天
- **平滑关注计划（Campaign）**：「N 天建立 M 个关注」拆解为账号×天离散切片，动作类型错峰轮转
- **GitHub REST 执行器**：star / unstar / follow / watch / commit_note / issue，全部幂等可重入
- **失败重试与熔断**：429/5xx/网络异常按 5min·2ⁿ 指数退避重试（最多 3 次），401/403 直接转 token_invalid
- **mode=ai 文案生成**：OpenAI 兼容接口按账号人设生成日常笔记，未配置/失败自动回退动作池
- **执行审计**：每次调用的账号、动作、目标、HTTP 状态、响应片断全量留痕
- **管理员操作审计**：登录成功/失败、敏感写操作留痕（含来源 IP），控制台双视图切换
- **暗黑风控制台**：总览 / 身份矩阵 / 计划看板 / 任务队列 / 动作池 / 审计日志
- **离线预览**：`preview.html` 无需部署即可在浏览器查看界面
- **本地自测**：`npm test` 42 项核心逻辑自测（加密/TOTP/会话/时区/时间引擎/重试/审计/AI/Web 会话自愈）
- **CI 流水线**：GitHub Actions 自动语法检查 + 自测 + 控制台内嵌 JS 校验

[1.0.0]: #100---2026-08-22
