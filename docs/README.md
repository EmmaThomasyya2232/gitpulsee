# GitPulse · 分布式开发者活跃度与项目关注调度系统

[![CI](https://github.com/EmmaThomasyya2232/gitpulse/actions/workflows/test.yml/badge.svg)](https://github.com/EmmaThomasyya2232/gitpulse/actions/workflows/test.yml)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/EmmaThomasyya2232/gitpulse)
![平台](https://img.shields.io/badge/platform-Cloudflare_Workers%20%2B%20D1-orange)
![依赖](https://img.shields.io/badge/deps-零第三方业务依赖-blue)
![Node](https://img.shields.io/badge/node-%E2%89%A518-green)
![许可](https://img.shields.io/badge/license-MIT-lightgrey)

> 基于 Cloudflare Workers + D1 架构的高拟真、去规律化开发者活跃度管理系统。
> 纯原生 Web Crypto 驱动 2FA 算号与会话签名，支持多身份凭据托管、分时区作息模型、
> 主页日常学习动态同步与平滑分布式关注计划（Campaign）。

---

## 💡 系统定位与核心价值

在管理**本人所有或被明确授权**的多个 GitHub 账号、并与开源社区长期协作的场景下，
传统脚本常因为定时机械化、时段单一、缺少审计而既不真实也不可控。

`GitPulse` 通过 **去规律化的行为模型 + 全链路加密 + 全量审计**，为这些账号提供平稳、
低频、分布式的活跃度维护与关注调度方案：

* **开发者作息模型**：模拟真实人群**非连续**活跃特征——每周活跃 2–6 天可配置，配合
  随机休假期与本地时区工作时间窗口（避免深夜幽灵操作）。
* **平滑分布式关注计划（Campaign）**：把"N 天内建立 M 个关注"拆成 **账号 × 天** 的
  离散时间切片，star / follow / watch 动作类型错峰轮转，单日单账号量低且可控。
* **TOTP + 密钥托管**：控制台登录需 RFC 6238 动态验证码；GitHub Token、TOTP 种子、
  2FA 全部经 AES-256-GCM 主密钥加密后落库，口令只存 PBKDF2 校验散列。
* **审计与熔断**：每次执行落审计日志；401/403 自动将身份置为 `token_invalid`
  进入自我建设，避免大批量报错。控制台登录与敏感管理操作另有独立的「管理审计」留痕（含来源 IP）。

---

## ⚡ 核心能力与实现状态

| 能力 | 说明 | 状态 |
|---|---|---|
| 原生 TOTP 算号引擎 | 纯 Web Crypto API（`crypto.subtle`）实现 RFC 6238（HMAC-SHA1，±1 窗口），零 npm 构建依赖 | ✅ 已实现 |
| 加密凭据托管 | GitHub Token / TOTP 种子 AES-GCM；登录口令 PBKDF2-200k | ✅ 已实现 |
| 会话管理 | HMAC-SHA256 签名 Cookie，HttpOnly + SameSite=Lax，30 天免登录 | ✅ 已实现 |
| 去规律化作息引擎 | 活跃日 = 账号 × 日期确定性伪随机，周活跃天数可配；夜间避让、时区窗口 | ✅ 已实现 |
| 平滑关注计划 | `star_campaigns` → 切片 `scheduled_actions_queue`，动作类型轮转 | ✅ 已实现 |
| 泊松式时间离散 | 指数间隔（expRand）+ 轮盘选天 + 同账号×天分钟去重，窗口 09:00–23:00 | ✅ 已实现 |
| 日常学习动态同步 | 活跃日向 `note_repo/activity/日期.md` 提交 Markdown 笔记 | ✅ 已实现（REST API 通道） |
| 暗黑风控制台 | 身份矩阵 / 计划看板 / 任务队列 / 对象池 / 审计日志 | ✅ 已实现 |
| 幂等可重入 | star/follow/watch 天然幂等；commit_note 用文件 sha 做 upsert | ✅ 已实现 |
| 失败重试与指数退避 | 429/5xx/网络异常按 5min·2^n 退避重排，401/403 与配置错误直接熔断 | ✅ 已实现 |
| 管理员操作审计 | 登录成功/失败、账号增删改、计划创建取消等敏感操作留痕（用户 / IP / 详情） | ✅ 已实现 |
| mode=ai 文案生成 | OpenAI 兼容接口按账号人设生成日常笔记；未配置/失败自动回退动作池 | ✅ 已实现 |
| 一号一固化指纹 | UA / Sec-CH-UA 等环境隔离（需配套浏览器/代理） | 🚧 路线图 |
| Web 会话协议自愈 | `redirect:'manual'` 捕获并合并 `Set-Cookie`，复用 `user_session` | 🚧 路线图 |
| 伴随式浏览（browse-before-star） | 面向"先浏览再关注"的自然化动作编排 | 🚧 路线图 |

> ⚠️ 标注 🚧 的能力涉及**目标站点风控对抗**，任何使用都必须限定在
> 本人 / 被明确授权的账号，绝不用于伪造他人数据或批量刷量（详见下方「合规边界」）。

---

## 🏗 系统架构

```text
┌─────────────────────────────────────────────────────────────┐
│                 GitPulse 暗黑管理控制台 (Tailwind)            │
│    [身份矩阵]    [计划看板]    [任务队列]    [审计日志]          │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP JSON API
┌──────────────────────────────▼──────────────────────────────┐
│                   Cloudflare Worker 调度核心                 │
│                                                             │
│  ┌────────────────────────┐     ┌────────────────────────┐  │
│  │    作息与调度引擎       │     │    安全与身份模块       │  │
│  │ ├─ 活跃日确定性伪随机   │     │ ├─ TOTP 算号引擎       │  │
│  │ ├─ 时区窗口/休假/休眠   │     │ ├─ AES-256-GCM 密文    │  │
│  │ └─ Campaign 切片队列    │     │ └─ HMAC 会话签名       │  │
│  └───────────┬────────────┘     └───────────┬────────────┘  │
│              │                              │               │
│  ┌───────────▼──────────────────────────────▼────────────┐  │
│  │                动作执行层（当前：GitHub REST API）      │  │
│  │     [star] [unstar] [follow] [watch] [note commit]    │  │
│  └───────────────────────────┬───────────────────────────┘  │
└──────────────────────────────┼──────────────────────────────┘
                               │ Fetch（Bearer Token）
                               ▼
                     GitHub API Gateway（api.github.com）

## 📂 目录结构（当前工程）

```text
gitpulse/                         # 工程即 GitPulse
├── wrangler.toml                # Worker + D1(DB) + Cron(*/30) + nodejs_compat
├── migrations/0001_init.sql    # D1 建表 + 种子文案
│   ├── 0002_add_retry.sql    # 队列重试计数（指数退避）
│   └── 0003_admin_audit.sql  # 管理员操作审计表
├── src/
│   ├── index.js                # 路由入口 + API + scheduled 调度器
│   ├── crypto.js               # AES-GCM / PBKDF2-200k / HMAC-SHA256 / base64url
│   ├── totp.js                 # 纯 Web Crypto RFC 6238 算号实现
│   ├── auth.js                 # HMAC 签名会话 Cookie（payload.sig）
│   ├── github.js               # GitHub REST 动作客户端（star/follow/watch/commit）
│   ├── orchestrator.js         # 作息 + 切片 + 执行核心
│   └── console.js              # 内嵌暗黑风 Tailwind 控制台
├── scripts/
│   ├── selftest.mjs            # 本地自测（32 项）
│   └── check_html.mjs          # 控制台内嵌 JS 语法校验
├── docs/项目计划.md            # 项目计划文档
├── CHANGELOG.md                 # 更新日志（Keep a Changelog 格式）
├── README.md / LICENSE         # 本文件 / MIT
└── package.json
```

> 未来随合入 Web 会话能力，将拆分 `src/auth/{totp,cookie_jar,login_flow}.js`、
> `src/engine/{scheduler,actions,fingerprint}.js`、`src/views/console.html`，
> 与本 README 的规划结构对齐。

---

## 🚀 快速开始

### 方式一：一键部署（推荐，全自动）⚡

点击上面的 **Deploy to Cloudflare** 按钮，或直接打开：
<https://deploy.workers.cloudflare.com/?url=https://github.com/EmmaThomasyya2232/gitpulse>

登录 Cloudflare 后向导会自动完成：
1. 克隆本仓库到你的 GitHub 账号
2. 自动创建 D1 数据库并绑定
3. 提示你填写 `MASTER_ENCRYPT_SECRET`（必填，用 `openssl rand -hex 32` 生成；其余可留空）
4. 自动执行数据库迁移并部署 Worker

完成后打开分配的 `*.workers.dev` 域名即可初始化管理员。

### 方式二：CLI 手动部署

### 1. 准备
- Node.js ≥ 18、Wrangler CLI、Cloudflare 账户（免费版即可）。

### 2. 初始化数据库与配置

```bash
cd <repo> && npm install

# 创建 D1 数据库，把返回的 database_id 填入 wrangler.toml
npx wrangler d1 create gitpulse_db

# 建表（本地 + 远程）
npx wrangler d1 migrations apply DB --local
npx wrangler d1 migrations apply DB
```

### 3. 配置安全密钥

```bash
npx wrangler secret put MASTER_ENCRYPT_SECRET   # 必填：主加密密钥（32+ 随机字符）
npx wrangler secret put SESSION_SECRET           # 可选：会话签名种子
npx wrangler secret put RUN_BATCH                # 可选：每次 Cron 最大执行切片数
npx wrangler secret put LLM_API_KEY              # 可选：mode=ai 账号的 LLM 文案生成（OpenAI 兼容）
```

### 4. 部署

```bash
npx wrangler deploy
```

部署后打开 Worker 域名，**首次进入初始化管理员**（会一次性给出 TOTP otpauth 链接，
请立即用验证器保存）。之后每次登录需 用户名 + 密码 + 6 位验证码。

---

## 📖 核心模块操作指引

* **身份录入**：添加 GitHub 用户名、Token（建议最小权限 `repo`）、`note_repo`（该账号
  自己的仓库 `owner/repo`）、时区偏移与每周活跃天数；系统自动分配确定性活跃日并密文保存凭据。
* **新建关注计划**：输入目标仓库、期望关注数与周期天数，系统筛选可用身份、生成错峰时间
  切片推入队列（在「星计划 / 任务队列」可见）。
* **学习动态同步**：绑定 `note_repo` 后，活跃日在其中提交 Markdown 日常记录
  （`activity/<日期>.md`），保持主页有真实内容沉淀。
* **异常审计**：控制台「审计日志」实时查看每次动作的响应状态；401/403 自动把身份置为
  `token_invalid` 挂起，避免连锁失败。

---

## 🔒 安全与合规边界（务必阅读）

1. **只守护你本人所有或被明确授权的账号**。本系统不得用于：伪造他人数据、刷 star、
   批量操控他人仓库数据等任何欺诈或异常行为——这些行为违反 GitHub 服务条款，并可能
   牵连账号与下游使用者。
2. 默认调度频率保守（每账号每天 ≤ 1 条笔记提交；关注动作用户可控），任何账号可随时
   「暂停 / 休眠」。不要为了提高表面活跃而无节制刷量。
3. GitHub Token 采用最小授权；`MASTER_ENCRYPT_SECRET` 是唯一解密密钥，**丢失即数据
   不可恢复**——请安全备份，并考虑把它作为「数字遗嘱」交给信任的人。
4. 标注 🚧 的能力（指纹隔离、Web 会话自愈、伴随浏览）与其相关的反风控实现，仅应在
   自身合规评估内使用；我不能替你判断目标平台条款，请务必在闭环环境自测。

---

## 🗺 路线图

- [x] 多账号托管 / Token 密文 / 状态机（active / paused / token_invalid / 休眠）
- [x] 去规律化作息 + 账号×天 切片 + 时区与休假
- [x] note_repo 日常学习动态同步
- [x] TOTP 双因素 + HMAC 会话 + AES-GCM 凭据
- [x] 控制台（总览 / 账号 / 计划 / 队列 / 对象池 / 审计）+ 本地自测 32/32
- [ ] 真实部署冒烟（d1 → deploy → 注册账号）
- [x] 泊松式时间离散 + 自然化节奏（指数间隔 + 账号×天去重 + 轮盘选天）
- [x] 失败重试与指数退避（5min·2^n，最多 3 次，401/403/配置错误直接熔断）
- [x] 管理员操作审计（登录成功/失败留痕 + 敏感写操作审计视图，含来源 IP）
- [x] mode=ai 文案生成（LLM 按人设生成，未配置/失败自动回退动作池）
- [ ] 指纹 / Web 会话自愈层（cookie_jar / login_flow / fingerprint）与伴随式浏览
- [ ] 多管理员协作 / RBAC

---

🕯 *此系统愿成为照亮后来者的一盏常明灯：账号继续冒泡，不是欺骗世界，而是你托付给规则与时间。*