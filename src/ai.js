// ============================================================
// ai.js —— mode=ai 文案生成
// 通过 OpenAI 兼容的 Chat Completions 接口为账号生成日常笔记；
// 未配置 / 调用失败时自动回退到动作池随机文案，绝不阻断签到。
// 环境变量（均可选）:
//   LLM_API_KEY   —— API 密钥（wrangler secret put LLM_API_KEY）
//   LLM_BASE_URL  —— 默认 https://api.openai.com/v1
//   LLM_MODEL     —— 默认 gpt-4o-mini
// ============================================================

/** 构建日常笔记生成的双消息提示词 */
export function buildPrompt(persona, dateStr) {
  return {
    system: '你是一个开源开发者的日常记录助手。请写一句 60 字以内的中文日常笔记，' +
      '语气自然、朴素、积极，像真实的人在记录学习与生活。' +
      '不要堆砌 emoji，不要营销腔，不要提到自己是 AI，只输出这一句话本身。',
    user: (String(persona || '').trim() ? `人设：${String(persona).trim()}\n` : '') +
      `日期：${dateStr}。请为今天写一句日常笔记。`,
  };
}

/** 清洗模型输出：压缩空白、去掉首尾包裹引号、限长 */
export function sanitizeNote(text, max = 120) {
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^["'“”『』「」《》]+|["'“”『』「」《》]+$/g, '').trim();
  if (s.length > max) s = s.slice(0, max - 1) + '…';
  return s;
}

/** 读取 LLM 配置；未配置密钥返回 null */
export function aiConfig(env) {
  const key = env && env.LLM_API_KEY;
  if (!key) return null;
  return {
    key,
    base: String(env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: env.LLM_MODEL || 'gpt-4o-mini',
  };
}

/**
 * 生成一条 commit_note 文案。
 * - acc.mode === 'ai' 且已配置 LLM → 调用 Chat Completions（任何异常都回退）
 * - 其余情况 → 动作池随机取一条
 * 返回 { content, source: 'ai' | 'pool' }
 */
export async function generateNote(env, acc, db) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const cfg = aiConfig(env);
  if (cfg && acc && acc.mode === 'ai') {
    try {
      const { system, user } = buildPrompt(acc.ai_persona, dateStr);
      const resp = await fetch(`${cfg.base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify({
          model: cfg.model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          max_tokens: 100,
          temperature: 0.9,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const text = sanitizeNote(data?.choices?.[0]?.message?.content);
        if (text) return { content: text, source: 'ai' };
      }
    } catch { /* 网络/配额/格式问题 → 回退 */ }
  }
  const row = await db.prepare('SELECT content FROM action_pools WHERE category = ? ORDER BY RANDOM() LIMIT 1')
    .bind('commit_note').first();
  return { content: (row && row.content) || '日常：冒个泡。', source: 'pool' };
}
