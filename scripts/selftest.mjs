// 自测脚本：验证核心密码学/会话/计划逻辑（无需部署即可本地运行）
// 运行: node scripts/selftest.mjs
import { seal, unseal, hashPassword, verifyPassword } from '../src/crypto.js';
import * as totp from '../src/totp.js';
import * as authM from '../src/auth.js';
import { plannedAt, offsetMinutes, isActiveDay, expRand, naturalMinute, nextNaturalMinute, retryDelayMs, shouldRetry, isPermanentError } from '../src/orchestrator.js';
import { clipDetail, clientIp } from '../src/audit.js';
import { buildPrompt, sanitizeNote, generateNote } from '../src/ai.js';

let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.error('  ✘ ' + name); }
}

const env = { MASTER_ENCRYPT_SECRET: 'unit-test-secret-正要' };

// 1) AES-GCM 加解密（中文 + emoji）
const sealed = await seal(env, '你好，世界 🔑 keep-alive');
const opened = await unseal(env, sealed);
ok('AES-GCM 加解密往返', opened === '你好，世界 🔑 keep-alive');

// 2) 秘钥缺失时应报错
let threw = false;
try { await seal({}, 'x'); } catch { threw = true; }
ok('缺少 MASTER_ENCRYPT_SECRET 时抛错', threw);

// 3) PBKDF2 口令散列
const h1 = await hashPassword('p@ss123456');
ok('口令散列-正确', await verifyPassword('p@ss123456', h1));
ok('口令散列-错误', (await verifyPassword('wrong', h1)) === false);

// 4) TOTP 生成与验证
const secret = totp.randomSecret();
const codes = await totp.totpCandidates(secret);
ok('TOTP 候选 6 位', codes.every((c) => /^[0-9]{6}$/.test(c)));
ok('TOTP 验证通过', await totp.verifyTotp(secret, codes[0]));
ok('TOTP 错误码拒绝', !(await totp.verifyTotp(secret, '000000')));

// 5) 会话签发与校验
const sess = await authM.issueSession('acct-123', 'sess-secret');
ok('会话签发/校验', (await authM.verifySession(sess.token, 'sess-secret')) === 'acct-123');
ok('会话防篡改', (await authM.verifySession('AAA.' + sess.token.split('.')[1], 'sess-secret')) === null);
ok('会话错误密钥', (await authM.verifySession(sess.token, 'nope')) === null);

// 6) 时区/计划换算：+08:00 的 8月22 09:00 = UTC 01:00
const iso = plannedAt('+08:00', '2026-08-22', 9, 0);
ok('plannedAt +08:00->UTC', iso === '2026-08-22T01:00:00.000Z');
ok('offsetMinutes(+08:00)=480', offsetMinutes('+08:00') === 480);
ok('offsetMinutes(-05:00)=-300', offsetMinutes('-05:00') === -300);

// 7) 周活跃天数分布
const acc = { id: 'u1', status: 'active', weekly_active_days: 5, rest_until: null };
let act = 0, tot_ = 0;
for (let d = 1; d <= 60; d++) {
  const dayStr = new Date(Date.UTC(2026, 0, d)).toISOString().slice(0, 10);
  if (isActiveDay(acc, dayStr)) act++;
  tot_++;
}
ok('活跃天数约 5/7（误差 ±20%）', act >= 33 && act <= 50);

// 8) cookie 往返
{
  const cookie = sess.cookie;
  const value = decodeURIComponent(cookie.match(/kah=([^;]+)/)[1]);
  ok('cookie 可解析并验证', (await authM.verifySession(value, 'sess-secret')) === 'acct-123');
}

// 9) 泊松风格自然化时间引擎
{
  const es = [];
  for (let i = 0; i < 500; i++) es.push(expRand(10));
  ok('expRand 全部为正', es.every((v) => v > 0));
  const empMean = es.reduce((a, b) => a + b, 0) / es.length;
  ok('expRand 均值约等于 mean(10) ±50%', Math.abs(empMean - 10) < 5);

  let inBounds = true;
  for (let i = 0; i < 2000; i++) {
    const m = naturalMinute(9 * 60, 23 * 60);
    if (m < 9 * 60 || m > 23 * 60 - 1) inBounds = false;
  }
  ok('naturalMinute 2000 样本全部落在窗口内', inBounds);

  const used = new Set();
  const vals = [];
  for (let i = 0; i < 20; i++) vals.push(nextNaturalMinute(used, 9 * 60, 9 * 60 + 20));
  ok('nextNaturalMinute 对账号×天去重（20 个互不相同）', new Set(vals).size === 20);
}

// 10) 失败重试与指数退避
{
  ok('retryDelayMs 指数退避 (0/1/2/3 → 5/10/20/40 分钟)',
    retryDelayMs(0) === 300000 && retryDelayMs(1) === 600000 &&
    retryDelayMs(2) === 1200000 && retryDelayMs(3) === 2400000);
  ok('shouldRetry 边界（max=3: 0→重试, 3→放弃）', shouldRetry(0) && shouldRetry(2) && !shouldRetry(3));
  ok('isPermanentError: 401/403 永久失败', isPermanentError(401) && isPermanentError(403) && isPermanentError('x', 403));
  ok('isPermanentError: 可重试错误（429/500/网络异常）', !isPermanentError(429) && !isPermanentError(500) && !isPermanentError('network timeout'));
  ok('isPermanentError: 配置类错误永久', isPermanentError('no_github_token') && isPermanentError('auth_failed_circuit_break') && isPermanentError('unknown_action'));
}

// 11) 管理审计工具函数
{
  ok('clipDetail: 短文本原样返回', clipDetail('登录成功') === '登录成功');
  const long = 'x'.repeat(500);
  const clipped = clipDetail(long, 100);
  ok('clipDetail: 超长截断到 max 且带省略号', clipped.length === 100 && clipped.endsWith('…'));
  ok('clipDetail: null 安全', clipDetail(null) === '' && clipDetail(undefined, 10) === '');
  const reqCF = new Request('https://demo.example/api/x', { headers: { 'CF-Connecting-IP': '203.0.113.7' } });
  const reqXFF = new Request('https://demo.example/api/x', { headers: { 'X-Forwarded-For': '198.51.100.9, 10.0.0.1' } });
  const reqNone = new Request('https://demo.example/api/x');
  ok('clientIp: CF 头优先 / XFF 取第一段 / 无头为 null',
    clientIp(reqCF) === '203.0.113.7' && clientIp(reqXFF) === '198.51.100.9' && clientIp(reqNone) === null);
}

// 12) mode=ai 文案生成（提示词 / 清洗 / 回退）
{
  const p = buildPrompt('喜欢 Linux 与老式机械键盘', '2026-08-22');
  ok('buildPrompt: 系统消息含约束，用户消息含人设与日期',
    p.system.includes('日常笔记') && p.user.includes('机械键盘') && p.user.includes('2026-08-22'));
  ok('sanitizeNote: 压缩空白/去包裹引号/限长',
    sanitizeNote('  "你好  世界"  ') === '你好 世界' && sanitizeNote('x'.repeat(200)).length === 120);
  const fakeDb = { prepare: () => ({ bind: () => ({ first: async () => ({ content: '池子文案' }) }) }) };
  const r1 = await generateNote({}, { mode: 'ai', ai_persona: '测试' }, fakeDb);
  ok('generateNote: 未配置 LLM_API_KEY 时回退动作池', r1.source === 'pool' && r1.content === '池子文案');
  const r2 = await generateNote({ LLM_API_KEY: 'k' }, { mode: 'rule' }, fakeDb);
  ok('generateNote: mode=rule 不触发 LLM 调用', r2.source === 'pool');
}

// 13) 已删除 —— Web 会话层测试（webauth.js 随 Token 通道切换移除）
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);