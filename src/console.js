// ============================================================
// console.js —— 单页暗黑风控制台（TailwindCDN + 原生 JS）
// ============================================================
export const consoleHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>GitPulse · 账号守护台</title>
<script src="https://cdn.tailwindcss.com"><\/script>
<style>
  * { transition-property: background-color,border-color,color; transition-duration: .15s; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  .card { background:#12161d; border:1px solid #1e2630; border-radius:14px; }
  .btn { border-radius:10px; padding:6px 14px; font-size:13px; cursor:pointer; }
  .btn-primary { background:#4f8cff; color:#fff; } .btn-primary:hover{ background:#3b76e0; }
  .btn-ghost { border:1px solid #2b3542; color:#cbd5e1; } .btn-ghost:hover{ background:#1c2430; }
  .btn-danger { background:#7f1d1d; color:#fecaca; } .btn-danger:hover{ background:#991b1b; }
  .inp { width:100%; background:#0d141c; border:1px solid #263141; border-radius:9px; padding:7px 10px; font-size:13px; color:#e2e8f0; }
  .lbl { display:block; font-size:12px; color:#94a3b8; margin-bottom:4px; }
  .tab { padding:8px 14px; font-size:13px; border-radius:10px; color:#94a3b8; cursor:pointer; }
  .tab.active { background:#1c2430; color:#e2e8f0; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th { text-align:left; color:#64748b; font-weight:500; padding:8px 10px; border-bottom:1px solid #1e2930; }
  td { padding:8px 10px; border-bottom:1px solid #161e27; color:#cbd5e1; }
  .badge { font-size:11px; padding:2px 8px; border-radius:999px; }
  .badge-green{ background:#052e16; color:#86efac; } .badge-red{ background:#450a0a; color:#fca5a5; }
  .badge-yellow{ background:#422006; color:#fde68a; } .badge-gray{ background:#1f2937; color:#9ca3af; }
  ::-webkit-scrollbar { width:8px; height:8px; } ::-webkit-scrollbar-thumb{ background:#263141; border-radius:4px; }
</style>
</head>
<body class="bg-[#0b0f14] text-slate-200 min-h-screen">
<!-- ======= 登录 / 初始化 ======= -->
<div id="authView" class="hidden flex items-center justify-center min-h-screen px-4">
  <div class="card card-w-96 p-8 shadow-2xl" style="background:#11161e; border:1px solid #1e2930; border-radius:16px;">
    <div class="text-2xl font-semibold mb-1" style="letter-spacing:.5px;">🕯 GitPulse</div>
    <div class="text-xs text-slate-500 mb-6">开发者账号活跃度与分布式关注调度系统</div>
    <div id="authMode" class="flex gap-2 mb-5"></div>
    <div class="space-y-3">
      <div><label class="lbl">用户名</label><input id="aUser" class="inp" autocomplete="username" /></div>
      <div><label class="lbl">密码</label><input id="aPass" class="inp" type="password" autocomplete="current-password" /></div>
      <div id="totpRow" class="hidden"><label class="lbl">TOTP 六位验证码</label><input id="aTotp" class="inp" maxlength="6" /></div>
      <div id="tokenRow" class="hidden"><label class="lbl">GitHub Token（可选，初始化管理员）</label><input id="aToken" class="inp" type="password" /></div>
    </div>
    <div id="authMsg" class="text-xs text-rose-400 mt-3 min-h-[16px]"></div>
    <button id="authBtn" class="btn btn-primary w-full mt-4 py-2.5">进入控制台</button>
  </div>
</div>

<!-- ======= 主台 ======= -->
<div id="mainView" class="hidden min-h-screen">
  <header class="flex items-center justify-between px-6 py-3 border-b border-[#1a212b]">
    <div class="flex items-center gap-3 text-lg font-semibold">🕯 GitPulse <span class="text-xs text-slate-500 font-normal">账号守护台</span></div>
    <div class="flex items-center gap-3 text-sm text-slate-400" id="meBox"></div>
  </header>
  <div class="flex max-w-7xl mx-auto">
    <nav class="w-44 shrink-0 p-4 space-y-1" id="nav">
      <div class="tab active" data-v="overview">总览</div>
      <div class="tab" data-v="accounts">账号</div>
      <div class="tab" data-v="campaigns">星计划</div>
      <div class="tab" data-v="queue">任务队列</div>
      <div class="tab" data-v="pools">动作池</div>
      <div class="tab" data-v="logs">审计日志</div>
    </nav>
    <main class="flex-1 p-4 min-w-0" id="content"></main>
  </div>
</div>
<div id="toast" class="fixed top-4 right-4 z-50 hidden max-w-xs rounded-lg px-4 py-3 text-sm shadow-xl" style="background:#11161e; border:1px solid #263141;"></div>
<script>
// ================= GitPulse 控制台逻辑 =================
var NL = String.fromCharCode(10);
var state = { view: 'overview', user: null };
function $(id) { return document.getElementById(id); }
function toast(txt, color) {
  var t = $('toast');
  t.textContent = txt;
  t.style.borderColor = color || '#263141';
  t.classList.remove('hidden');
  clearTimeout(window._tt);
  window._tt = setTimeout(function () { t.classList.add('hidden'); }, 3200);
}
function bad(s) {
  var map = { active: 'badge-green', done: 'badge-green', running: 'badge-green', pending: 'badge-yellow', failed: 'badge-red', cancelled: 'badge-gray', paused: 'badge-gray', token_invalid: 'badge-red' };
  return '<span class="badge ' + (map[s] || 'badge-gray') + '">' + s + '</span>';
}
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function ghLink(id) {
  return '<a href="https://github.com/' + esc(id) + '" target="_blank" class="text-sky-400 hover:text-sky-300 underline">' + esc(id) + '</a>';
}
function apiq(path, opts) {
  var init = opts || {};
  init.headers = init.headers || {};
  if (init.body && typeof init.body !== 'string') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(init.body);
  }
  var p = { method: init.method || 'GET', credentials: 'same-origin', headers: init.headers };
  if (init.body) p.body = init.body;
  return fetch(path, p).then(function (r) {
    return r.json().then(function (j) {
      if (!j.ok) throw new Error(j.error || r.status);
      return j;
    });
  });
}

// ---------- 启动/登录 ----------
function init() {
  apiq('/api/auth/me').then(function (j) {
    state.user = j.user;
    showMain();
    refresh();
  }).catch(function () {
    apiq('/api/status').then(function (j) {
      if (j.stats && j.stats.accounts === 0) buildSetup(); else buildLogin();
    }).catch(function () { buildLogin(); });
  });
}
function buildLogin() {
  $('authView').classList.remove('hidden');
  $('mainView').classList.add('hidden');
  $('authMode').innerHTML = '<span class="badge badge-yellow">登录</span>';
  $('totpRow').classList.remove('hidden');
  $('tokenRow').classList.add('hidden');
  $('authBtn').textContent = '登录';
  $('authBtn').onclick = doLogin;
}
function buildSetup() {
  $('authView').classList.remove('hidden');
  $('mainView').classList.add('hidden');
  $('authMode').innerHTML = '<span class="badge badge-green">首次初始化 · 创建管理员</span>';
  $('totpRow').classList.add('hidden');
  $('tokenRow').classList.remove('hidden');
  $('authBtn').textContent = '创建管理员';
  $('authBtn').onclick = doSetup;
}
function doSetup() {
  apiq('/api/auth/setup', {
    method: 'POST',
    body: { username: $('aUser').value.trim(), password: $('aPass').value, github_token: $('aToken').value.trim() }
  }).then(function (j) {
    if (navigator.clipboard) navigator.clipboard.writeText(j.otpauth);
    toast('初始化成功，otpauth 已复制，请到验证器添加');
    buildLogin();
  }).catch(function (e) { $('authMsg').textContent = e.message; });
}
function doLogin() {
  apiq('/api/auth/login', {
    method: 'POST',
    body: { username: $('aUser').value.trim(), password: $('aPass').value, totpCode: $('aTotp').value.trim() }
  }).then(function (j) {
    state.user = j.user;
    showMain();
    refresh();
  }).catch(function (e) { $('authMsg').textContent = e.message; });
}
function showMain() {
  $('authView').classList.add('hidden');
  $('mainView').classList.remove('hidden');
  $('meBox').innerHTML = '<span>' + esc(state.user.username) + '</span>' +
    '<button class="btn btn-ghost" onclick="logout()">退出</button>';
}
function logout() {
  apiq('/api/auth/logout', { method: 'POST' }).then(function () { location.reload(); });
}
function switchView(v) {
  state.view = v;
  var tabs = document.querySelectorAll('#nav .tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].dataset.v === v);
  refresh();
}
function refresh() {
  var fn = { overview: renderOverview, accounts: renderAccounts, campaigns: renderCampaigns,
    queue: renderQueue, pools: renderPools, logs: renderLogs }[state.view] || renderOverview;
  }

// ---------- 渲染 ----------
function panel(title, inner) {
  return '<div class="card p-5 mb-4"><div class="text-sm font-medium text-slate-300 mb-3">' + title + '</div>' + inner + '</div>';
}
function fmtDT(s) {
  if (!s) return '-';
  var d = new Date(s);
  try { return d.toLocaleString('zh-CN', { hour12: false }); } catch (e) { return s; }
}

function renderOverview() {
  apiq('/api/status').then(function (j) {
    var s = j.stats;
    var data = [
      ['活跃账号', s.active, '#34d399'], ['待执行任务', s.pending, '#fbbf24'],
      ['已完成/失败', s.done + ' / ' + s.failed, '#60a5fa'], ['总执行', s.runs, '#c084fc'],
      ['成功率', (s.runs ? Math.round((s.okRuns / s.runs) * 100) : 0) + '%', '#34d399'],
      ['进行中计划', j.activeCampaigns || 0, '#f472b6']
    ];
    var html = '<div class="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">';
    for (var i = 0; i < data.length; i++) {
      html += '<div class="card p-5"><div class="text-xs text-slate-500">' + data[i][0] + '</div>' +
        '<div class="text-3xl font-bold mt-1" style="color:' + data[i][2] + '">' + data[i][1] + '</div></div>';
    }
    html += '</div>';
    html += panel('说明',
      '<p class="text-xs text-slate-500 leading-6">本系统每 30 分钟被 Cloudflare Cron 唤醒一次：' +
      '① 执行到期的任务切片（星标 / Follow / Watch / 笔记提交）并写入审计日志；' +
      '② 为每个活跃账号补充未来 3 天在自家 note_repo 的“签到提交”。' +
      '<br />实现隐喻：哪怕你不在了，账号也还会按时“冒个泡”——这也是给后来者的光。</p>');
    $('content').innerHTML = html;
  }).catch(function (e) { toast(e.message, '#fca5a5'); });
}

function accHtml(acc) {
  var tz = acc.timezone || '';
  var actBtn = acc.status === 'active'
    ? '<button class="btn btn-ghost" data-action="set-status" data-id="' + acc.id + '" data-val="paused">暂停</button>'
    : '<button class="btn btn-ghost" data-action="set-status" data-id="' + acc.id + '" data-val="active">启用</button>';
  // 会话认证状态徽章：Cookie有效 / 休眠中 / 需重新认证 / 未验证
  var auth = acc.auth_state || 'unverified';
  var authBadge = auth === 'valid'
    ? '<span class="text-[11px] px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300">Cookie有效</span>'
    : (acc.rest_until && acc.rest_until >= new Date().toISOString().slice(0, 10))
      ? '<span class="text-[11px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">休眠中</span>'
      : auth === 'invalid'
        ? '<span class="text-[11px] px-1.5 py-0.5 rounded bg-rose-900/60 text-rose-300">需重新认证</span>'
        : '<span class="text-[11px] px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-300">未验证</span>';
  var fpBtn = '<button class="btn btn-ghost ml-1" data-action="check-acc" data-id="' + acc.id + '">检测</button>' +
    '<button class="btn btn-ghost ml-1" data-action="reauth-acc" data-id="' + acc.id + '">重认证</button>';
  return '<td>' + esc(acc.username) + ' ' + (acc.note_repo ? ghLink(acc.note_repo) : '') + '</td>' +
    '<td>' + bad(acc.status) + '</td>' +
    '<td>' + authBadge + '</td>' +
    '<td class="text-slate-500 text-[11px]">' + esc(acc.fingerprint_label || '') + '</td>' +
    '<td>' + esc(acc.mode) + ' · ' + esc(tz) + '</td>' +
    '<td class="text-slate-500">' + esc(acc.weekly_active_days || '-') + '天/周 ' + (acc.rest_until ? ('休至' + acc.rest_until) : '') + '</td>' +
    '<td class="text-slate-500">' + fmtDT(acc.last_action_at) + '</td>' +
    '<td class="whitespace-nowrap">' + actBtn + fpBtn +
    '<button class="btn btn-danger ml-1" data-action="del-acc" data-id="' + acc.id + '">删</button></td>';
}

function renderAccounts() {
  apiq('/api/accounts').then(function (j) {
    var accs = j.accounts || [];
    var rows = '';
    for (var i = 0; i < accs.length; i++) rows += '<tr><td>' + (i + 1) + '</td>' + accHtml(accs[i]) + '</tr>';
    var html = panel('被守护账号（' + accs.length + '）',
      '<table><thead><tr><th>#</th><th>账号 / note_repo</th><th>状态</th><th>会话</th><th>指纹</th><th>模式·时区</th><th>活跃度</th><th>最近动作</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table>') +
    panel('添加账号（Web 会话通道，无需 GitHub Token）',
      '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' +
      '<div><label class="lbl">用户名</label><input id="nUser" class="inp" placeholder="GitHub 用户名" /></div>' +
      '<div><label class="lbl">GitHub 登录密码 *</label><input id="nGhPass" class="inp" type="password" placeholder="用于静默自愈重登，AES-GCM 加密存储" /></div>' +
      '<div><label class="lbl">GitHub 2FA 密钥(Base32,可空)</label><input id="nGhTotp" class="inp" placeholder="如 JBSWY3DPEHPK3PXP" /></div>' +
      '<div><label class="lbl">note_repo</label><input id="nRepo" class="inp" placeholder="owner/repo" /></div>' +
      '<div><label class="lbl">时区偏移</label><input id="nTz" class="inp" value="+08:00" /></div>' +
      '<div><label class="lbl">每周活跃天数</label><input id="nWky" class="inp" type="number" value="5" min="1" max="7" /></div>' +
      '<div><label class="lbl">休眠截止(可空)</label><input id="nRest" class="inp" type="date" /></div>' +
      '<div><label class="lbl">模式 rule/ai</label><input id="nMode" class="inp" value="rule" /></div>' +
      '<div><label class="lbl">控制台登录密码(可空)</label><input id="nPass" class="inp" type="password" /></div>' +
      '</div><button class="btn btn-primary mt-3" onclick="addAcc()">保存账号</button>');
    $('content').innerHTML = html;
  }).catch(function (e) { toast(e.message, '#fca5a5'); });
}

function addAcc() {
  apiq('/api/accounts', {
    method: 'POST',
    body: { username: $('nUser').value.trim(), gh_password: $('nGhPass').value, gh_totp: $('nGhTotp').value.trim(),
      note_repo: $('nRepo').value.trim(),
      timezone: $('nTz').value.trim() || '+08:00', weekly_active_days: Number($('nWky').value || 5),
      rest_until: $('nRest').value || '', mode: $('nMode').value.trim(), password: $('nPass').value || '' }
  }).then(function () {
    toast('账号已添加，otpauth 仅第一次返回，请复制保存');
    location.reload();
  }).catch(function (e) { toast(e.message, '#fca5a5'); });
}
function checkAcc(id) {
  toast('正在探测会话…', '#93c5fd');
  apiq('/api/accounts/' + id + '/check', { method: 'POST' }).then(function (j) {
    toast(j.detail || j.state, j.state === 'valid' ? '#86efac' : '#fca5a5');
    renderAccounts();
  }).catch(function (e) { toast(e.message, '#fca5a5'); });
}
function reauthAcc(id) {
  toast('正在重新认证（完整 Web 登录）…', '#93c5fd');
  apiq('/api/accounts/' + id + '/reauth', { method: 'POST' }).then(function (j) {
    toast(j.detail || j.state, j.state === 'valid' ? '#86efac' : '#fca5a5');
    renderAccounts();
  }).catch(function (e) { toast(e.message, '#fca5a5'); });
}
function setStatus(id, st) {
  apiq('/api/accounts/' + id, { method: 'PUT', body: { status: st } }).then(function () { renderAccounts(); })
    .catch(function (e) { toast(e.message, '#fca5a5'); });
}
function delAcc(id) {
  if (!confirm('确认删除该账号及其待执行任务？')) return;
  apiq('/api/accounts/' + id, { method: 'DELETE' }).then(function () { renderAccounts(); })
    .catch(function (e) { toast(e.message, '#fca5a5'); });
}
function fmt(n) { return n == null ? '' : n; }

// ---------- 星计划 ----------
function renderCampaigns() {
  apiq('/api/campaigns').then(function (j) {
    var cs = j.campaigns || [];
    var rows = '';
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i];
      rows += '<tr><td>' + esc(c.target_repo) + (c.target_user ? (' / ' + esc(c.target_user)) : '') + '</td>' +
        '<td>' + esc(c.action_mix) + '</td>' + '<td>' + c.total_target + '</td>' +
        '<td>' + fmt(c.completed_count) + '/' + c.total_target + '</td>' +
        '<td>' + bad(c.status) + '</td>' +
        '<td>' + (c.status === 'running' ? '<button class="btn btn-danger" data-action="cancel-cmp" data-id="' + c.id + '">取消</button>' : '-') + '</td></tr>';
    }
    var html =
      panel('新建分布式关注计划',
        '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' +
        '<div><label class="lbl">目标仓库 owner/repo</label><input id="cRepo" class="inp" placeholder="octocat/Hello-World" /></div>' +
        '<div><label class="lbl">目标用户(可空)</label><input id="cUser" class="inp" placeholder="用于 follow" /></div>' +
        '<div><label class="lbl">总切片数</label><input id="cTotal" class="inp" type="number" value="100" /></div>' +
        '<div><label class="lbl">持续天数</label><input id="cDays" class="inp" type="number" value="14" /></div>' +
        '<div class="col-span-2"><label class="lbl">动作组合</label><input id="cMix" class="inp" value="star,follow,watch" /></div>' +
        '</div><button class="btn btn-primary mt-3" onclick="createCmp()">生成计划</button>') +
      panel('计划列表（' + cs.length + '）',
        '<table><thead><tr><th>目标</th><th>动作</th><th>数量</th><th>进度</th><th>状态</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table>');
    $('content').innerHTML = html;
  }).catch(function (e) { toast(e.message, '#fca5a5'); });
}
function createCmp() {
  apiq('/api/campaigns', {
    method: 'POST',
    body: { target_repo: $('cRepo').value.trim(), target_user: $('cUser').value.trim(),
      total_target: Number($('cTotal').value || 100), duration_days: Number($('cDays').value || 14),
      action_mix: $('cMix').value.trim() }
  }).then(function (r) {
    toast('已生成 ' + r.inserted + ' 个任务切片');
    renderCampaigns();
  }).catch(function (e) { toast(e.message, '#fca5a5'); });
}
function cancelCampaign(id) {
  apiq('/api/campaigns/' + id + '/cancel', { method: 'POST' }).then(function () { renderCampaigns(); })
    .catch(function (e) { toast(e.message, '#fca5a5'); });
}

// ---------- 任务队列 ----------
var QFILTER = 'pending';
function renderQueue() {
  apiq('/api/queue?status=' + QFILTER + '&limit=100').then(function (j) {
    var qs = j.queue || [];
    var rows = '';
    for (var i = 0; i < qs.length; i++) {
      var q = qs[i];
      var pl = '';
      try { pl = JSON.stringify(JSON.parse(q.action_payload || '{}')); } catch (e) { pl = q.action_payload || ''; }
      var retryBadge = (q.retry_count || 0) > 0 ? '<span class="badge badge-yellow me-1" title="已自动重试 ' + q.retry_count + ' 次">🔁' + q.retry_count + '</span>' : '';
      rows += '<tr><td>#' + q.id + '</td><td>' + esc(String(q.account_id).slice(0, 8)) + '</td>' +
        '<td>' + esc(q.action_type) + '</td><td class="text-slate-500">' + esc(pl) + '</td>' +
        '<td>' + fmtDT(q.planned_at) + '</td>' + '<td>' + retryBadge + bad(q.status) + '</td>' +
        '<td>' + (q.status === 'pending' ? '<button class="btn btn-ghost" data-action="run-q" data-id="' + q.id + '">立即执行</button>' : esc(q.error_msg || '-')) + '</td></tr>';
    }
    var tabs = ['pending', 'done', 'failed', 'all'].map(function (f) {
      return '<button class="btn btn-ghost ' + (f === QFILTER ? 'opacity-100' : 'opacity-50') + '" data-action="qf" data-val="' + f + '">' + f + '</button>';
    }).join(' ') + ' <button class="btn btn-primary ml-3" data-action="run-all">执行全部待办</button>';
    var html = panel('任务队列 · ' + QFILTER,
      tabs + '<table class="mt-3"><thead><tr><th>#</th><th>账号</th><th>动作</th><th>载荷</th><th>计划时间</th><th>状态</th><th>操作/错误</th></tr></thead><tbody>' + rows + '</tbody></table>');
    $('content').innerHTML = html;
  }).catch(function (e) { toast(e.message, '#fca5a5'); });
}
function setQf(f) { QFILTER = f; renderQueue(); }
function runQueue(id) {
  apiq('/api/queue/' + id + '/run', { method: 'POST' }).then(function () { toast('已执行 #' + id); renderQueue(); })
    .catch(function (e) { toast(e.message, '#fca5a5'); });
}
function runAllNow() {
  apiq('/api/queue?status=pending&limit=100').then(function (j) {
    var ids = (j.queue || []).map(function (x) { return x.id; });
    var chain = Promise.resolve();
    ids.forEach(function (id) {
      chain = chain.then(function () {
        return apiq('/api/queue/' + id + '/run', { method: 'POST' }).catch(function () {});
      });
    });
    chain.then(function () { toast('本轮批量执行完成'); renderQueue(); });
  }).catch(function (e) { toast(e.message, '#fca5a5'); });
}

// ---------- 动作池 ----------
function renderPools() {
  apiq('/api/pools').then(function (j) {
    var ps = j.pools || [];
    var rows = '';
    for (var i = 0; i < ps.length; i++) {
      rows += '<tr><td>' + esc(ps[i].category) + '</td><td>' + esc(ps[i].content) + '</td>' +
        '<td>' + esc(ps[i].tag || '') + '</td>' +
        '<td><button class="btn btn-danger" data-action="del-pool" data-id="' + ps[i].id + '">删</button></td></tr>';
    }
    var html =
      panel('新增动作文案',
        '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' +
        '<div><label class="lbl">分类</label><input id="pCat" class="inp" value="commit_note" /></div>' +
        '<div class="col-span-2"><label class="lbl">内容</label><input id="pContent" class="inp" /></div>' +
        '<div><label class="lbl">标签</label><input id="pTag" class="inp" /></div>' +
        '</div><button class="btn btn-primary mt-3" onclick="addPool()">保存</button>') +
      panel('动作池（' + ps.length + '）',
        '<table><thead><tr><th>分类</th><th>内容</th><th>标签</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>');
    $('content').innerHTML = html;
  }).catch(function (e) { toast(e.message, '#fca5a5'); });
}
function addPool() {
  apiq('/api/pools', {
    method: 'POST',
    body: { category: $('pCat').value.trim(), content: $('pContent').value, tag: $('pTag').value.trim() }
  }).then(function () { renderPools(); }).catch(function (e) { toast(e.message, '#fca5a5'); });
}
function delPool(id) {
  apiq('/api/pools/' + id, { method: 'DELETE' }).then(function () { renderPools(); })
    .catch(function (e) { toast(e.message, '#fca5a5'); });
}

// ---------- 审计日志 ----------
var logView = 'exec'; // exec=执行日志 / admin=管理审计
function logSwitch() {
  return '<div class="mb-3 space-x-2">' +
    '<button class="btn ' + (logView === 'exec' ? 'btn-primary' : '') + '" data-action="log-view" data-val="exec">执行日志</button>' +
    '<button class="btn ' + (logView === 'admin' ? 'btn-primary' : '') + '" data-action="log-view" data-val="admin">管理审计</button>' +
    '</div>';
}
function renderLogs() {
  if (logView === 'admin') {
    apiq('/api/admin-audit?limit=100').then(function (j) {
      var ls = j.logs || [];
      var rows = '';
      for (var i = 0; i < ls.length; i++) {
        var a = ls[i];
        var actColor = (a.action === 'login_fail') ? '#fca5a5' : (a.action === 'login_ok' || a.action === 'setup') ? '#86efac' : '#cbd5e1';
        rows += '<tr><td>' + a.id + '</td><td>' + esc(a.username || '') + '</td>' +
          '<td style="color:' + actColor + '">' + esc(a.action) + '</td>' +
          '<td class="text-slate-500">' + esc(a.detail || '') + '</td>' +
          '<td class="text-slate-500">' + esc(a.ip || '') + '</td>' +
          '<td class="text-slate-500">' + esc(String(a.created_at || '').replace('T', ' ').slice(0, 19)) + '</td></tr>';
      }
      var html = logSwitch() + panel('管理审计（最近 ' + ls.length + ' 条）—— 控制台登录与敏感操作留痕',
        '<table><thead><tr><th>#</th><th>用户</th><th>动作</th><th>详情</th><th>IP</th><th>时间</th></tr></thead><tbody>' + rows + '</tbody></table>');
      $('content').innerHTML = html;
    }).catch(function (e) { toast(e.message, '#fca5a5'); });
    return;
  }
  apiq('/api/logs?limit=100').then(function (j) {
    var ls = j.logs || [];
    var rows = '';
    for (var i = 0; i < ls.length; i++) {
      var l = ls[i];
      rows += '<tr><td>' + l.id + '</td><td>' + esc(String(l.account_id || '').slice(0, 8)) + '</td>' +
        '<td>' + esc(l.action_type) + '</td><td class="text-slate-500">' + esc(l.action_target || '') + '</td>' +
        '<td>' + (l.is_success ? bad('done') : bad('failed')) + '</td>' +
        '<td class="text-slate-500">' + l.status_code + '</td>' +
        '<td class="text-slate-500">' + esc(l.response_msg) + '</td>' +
        '<td class="text-slate-500">' + (l.executed_at ? esc(String(l.executed_at).replace('T', ' ').slice(0, 19)) : '') + '</td></tr>';
    }
    var html = logSwitch() + panel('审计日志（最近 ' + ls.length + ' 条）',
      '<table><thead><tr><th>#</th><th>账号</th><th>动作</th><th>目标</th><th>结果</th><th>HTTP</th><th>响应</th><th>时间</th></tr></thead><tbody>' + rows + '</tbody></table>');
    $('content').innerHTML = html;
  }).catch(function (e) { toast(e.message, '#fca5a5'); });
}

// ---------- 事件委托 ----------
document.addEventListener('click', function (e) {
  var el = e.target;
  while (el && el !== document.body && !(el.getAttribute && el.getAttribute('data-action'))) el = el.parentElement;
  if (!el || !el.getAttribute) return;
  var act = el.getAttribute('data-action'), id = el.getAttribute('data-id'), val = el.getAttribute('data-val');
  if (act === 'set-status') setStatus(id, val);
  else if (act === 'del-acc') delAcc(id);
  else if (act === 'check-acc') checkAcc(id);
  else if (act === 'reauth-acc') reauthAcc(id);
  else if (act === 'cancel-cmp') cancelCampaign(id);
  else if (act === 'run-q') runQueue(id);
  else if (act === 'run-all') runAllNow();
  else if (act === 'qf') setQf(val);
  else if (act === 'del-pool') delPool(id);
  else if (act === 'log-view') { logView = val; renderLogs(); }
});

// ---------- 启动 ----------
document.addEventListener('DOMContentLoaded', function () {
  var tabs = document.querySelectorAll('#nav .tab');
  for (var i = 0; i < tabs.length; i++) {
    (function (tb) {
      tb.addEventListener('click', function () { switchView(tb.getAttribute('data-v')); });
    })(tabs[i]);
  }
  init();
});
</script>
`;