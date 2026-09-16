/*
 * verify_dist.js —— 对「最终交付的单文件 HTML」做真实执行验证
 *
 * 与 smoke.js 的区别：smoke.js 逐个加载 7 个源 JS；这里直接从 dist 产物中
 * 抽出内联 <script> 并整体执行，验证的是「用户真正拿到的那一个文件」。
 *
 * 用法：node build/verify_dist.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
/* 优先验证 ASCII 命名的 index.html —— 静态托管与 GitHub Pages 实际提供的正是它 */
const DIST_EN = path.join(ROOT, 'dist', 'index.html');
const DIST_CN = path.join(ROOT, 'dist', '苏果智选-AI社区商超智能选品与品类优化平台.html');
const DIST = fs.existsSync(DIST_EN) ? DIST_EN : DIST_CN;

const out = [];
const errs = [];
function log(s) { out.push(s); }
function chk(name, ok, note) {
  log((ok ? '[OK]   ' : '[FAIL] ') + name + (note ? '  → ' + note : ''));
  if (!ok) errs.push(name + (note ? ' → ' + note : ''));
}

if (!fs.existsSync(DIST)) { console.error('产物不存在：' + DIST); process.exit(1); }
const html = fs.readFileSync(DIST, 'utf8');
log('[INFO] 产物体积 ' + (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1) + ' KB');

/* -------- 0. 双命名产物一致性 -------- */
if (fs.existsSync(DIST_CN) && fs.existsSync(DIST_EN)) {
  const a = fs.readFileSync(DIST_EN, 'utf8');
  const b = fs.readFileSync(DIST_CN, 'utf8');
  chk('双命名产物内容完全一致（index.html ↔ 中文名）', a === b,
    a === b ? '两份一致，' + (Buffer.byteLength(a, 'utf8') / 1024).toFixed(1) + ' KB' : '内容不一致，需重新构建');
} else {
  chk('双命名产物齐备', false, '缺失 ' + (!fs.existsSync(DIST_EN) ? 'index.html ' : '') + (!fs.existsSync(DIST_CN) ? '中文名文件' : ''));
}

/* -------- 1. 结构完整性 -------- */
chk('HTML 以 <!DOCTYPE html> 开头', /^<!DOCTYPE html>/i.test(html));
chk('存在构建信息注释', html.indexOf('单文件构建产物') >= 0);
chk('存在 #app 容器', /id="app"/.test(html));
chk('存在 #login 容器', /id="login"/.test(html));
chk('以 </html> 结尾（未截断）', /<\/html>\s*$/.test(html.trimEnd()));
chk('内联 script 数量为 2（主体 + boot）', (html.match(/<script>/g) || []).length === 2,
  '实际 ' + (html.match(/<script>/g) || []).length);

/* -------- 2. 抽出内联脚本 -------- */
const inline = [];
const sre = /<script>([\s\S]*?)<\/script>/g;
let m;
while ((m = sre.exec(html))) inline.push(m[1]);
chk('成功抽出内联脚本', inline.length >= 1, inline.length + ' 段');

const mainJs = inline[0];
chk('主体脚本不含 App.boot()（应独立一段）', mainJs.indexOf('App.boot()') < 0,
  mainJs.indexOf('App.boot()') < 0 ? '正确分离' : '意外混入');
chk('boot 段为 App.boot()', inline.length > 1 && /App\.boot\(\)/.test(inline[1]));

/* -------- 3. DOM 桩（与 smoke.js 同构，抽成独立沙箱） -------- */
function mkEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    _attrs: {}, _text: '', _cn: '', children: [], parentNode: null,
    innerHTML: '', style: {}, dataset: {}, classList: {
      add() {}, remove() {}, toggle() {}, contains() { return false; },
    },
    set textContent(v) { this._text = String(v); },
    get textContent() { return this._text; },
    set className(v) { this._cn = v; },
    get className() { return this._cn || ''; },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    removeAttribute(k) { delete this._attrs[k]; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    insertBefore(c) { this.children.unshift(c); return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    addEventListener(t, fn) { this._ev = this._ev || {}; (this._ev[t] = this._ev[t] || []).push(fn); },
    removeEventListener() {}, dispatchEvent() { return true; },
    click() {}, focus() {}, blur() {}, select() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    scrollTop: 0, scrollHeight: 100, scrollIntoView() {},
    value: '', checked: false, disabled: false, type: '', accept: '', files: [],
    onclick: null, onchange: null, oninput: null, onkeydown: null,
    ondrop: null, ondragover: null, ondragleave: null,
    getBoundingClientRect() { return { top: 0, left: 0, width: 680, height: 300 }; },
    cloneNode() { return mkEl(tag); },
  };
  return el;
}

const REG = {};
const getEl = id => REG[id] || (REG[id] = mkEl('div'));
[
  'login', 'app', 'accList', 'lgUser', 'lgPass', 'lgBtn', 'lgErr',
  'nav', 'navMenu', 'burger', 'topbar', 'storeSel', 'syncBadge', 'userChip', 'topBackup',
  'uName', 'uRole', 'uAvatar', 'crumbTop', 'content',
  'mask', 'drawer', 'drTitle', 'drBody', 'drClose', 'drFoot', 'toasts', 'discText',
].forEach(getEl);

const docStub = {
  readyState: 'complete',
  documentElement: mkEl('html'), head: mkEl('head'), body: mkEl('body'), _ev: {},
  createElement: mkEl, createElementNS: (ns, t) => mkEl(t),
  createTextNode(t) { const e = mkEl('text'); e.textContent = t; return e; },
  getElementById: getEl, querySelector() { return null; }, querySelectorAll() { return []; },
  addEventListener(t, fn) { (this._ev[t] = this._ev[t] || []).push(fn); },
  removeEventListener() {}, execCommand() { return true; },
};

const LSS = {};
const sandbox = {
  console,
  document: docStub,
  location: { href: 'http://localhost/', hostname: 'localhost', reload() {} },
  navigator: { clipboard: null, userAgent: 'node-verify' },
  performance: { now: () => Date.now() },
  localStorage: {
    getItem: k => (k in LSS ? LSS[k] : null),
    setItem: (k, v) => { LSS[k] = String(v); },
    removeItem: k => { delete LSS[k]; },
    clear: () => { Object.keys(LSS).forEach(k => delete LSS[k]); },
  },
  XMLSerializer: function () { this.serializeToString = () => '<svg/>'; },
  Blob: function (a, o) { this.parts = a; this.type = (o || {}).type; this.size = 0; },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  Image: function () { this.onload = null; this.onerror = null; this.src = ''; },
  setTimeout: fn => { try { fn(); } catch (e) { errs.push('setTimeout: ' + e.message); } return 0; },
  clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  requestAnimationFrame: fn => { try { fn(0); } catch (e) { /* noop */ } return 0; },
  cancelAnimationFrame() {},
  scrollTo() {}, scrollBy() {}, print() {},
  addEventListener(t, fn) { (this._ev = this._ev || {})[t] = (this._ev[t] || []).concat(fn); },
  alert() {}, confirm: () => true, prompt: () => null,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
sandbox.Blob.prototype = {};

vm.createContext(sandbox);

/* -------- 4. 整体执行产物脚本 -------- */
try {
  vm.runInContext(mainJs, sandbox, { filename: 'dist-inline.js' });
  chk('产物主体脚本整体执行无异常', true);
} catch (e) {
  chk('产物主体脚本整体执行无异常', false, e.message);
}

const G = sandbox;
chk('window.SUGUO_DATA 已挂载', !!G.SUGUO_DATA, G.SUGUO_DATA ? (G.SUGUO_DATA.transactions || []).length + ' 个购物篮' : '缺失');
chk('window.Algo 已挂载', !!G.Algo && typeof G.Algo.computeCategoryHealth === 'function');
chk('window.Charts 已挂载', !!G.Charts && typeof G.Charts.hBar === 'function');
chk('window.App 已挂载', !!G.App && typeof G.App.boot === 'function');
chk('window.Pages 已挂载', !!G.Pages && typeof G.Pages.dash === 'function');
chk('window.AITools 已挂载', !!G.AITools && Object.keys(G.AITools).length === 14,
  G.AITools ? Object.keys(G.AITools).length + ' 个工具' : '缺失');

/* -------- 5. boot + 登录 + 全页面渲染 -------- */
try {
  G.App.boot();
  chk('App.boot() 执行成功', true);
} catch (e) { chk('App.boot() 执行成功', false, e.message); }

const RUNTIME_ERRORS = [];
try {
  getEl('lgUser').value = 'admin';
  getEl('lgPass').value = '123456';
  getEl('lgBtn').onclick();
  const u = G.App.State.user;
  chk('演示账号登录成功', !!u && u.role === 'admin', u ? u.name + ' / ' + u.role : '未登录');
} catch (e) { chk('演示账号登录成功', false, e.message); }

const ROUTES = ['dash', 'compare', 'health', 'assoc', 'forecast', 'deeplink',
  'privateLabel', 'newProduct', 'ai', 'data', 'approval', 'admin'];
let rendered = 0, totalKB = 0;
ROUTES.forEach(r => {
  try {
    const before = RUNTIME_ERRORS.length;
    G.App.go(r);
    const el = getEl('content');
    const h = el.innerHTML || '';
    const bad = /undefined|NaN|\[object Object\]/.test(h);
    if (bad && before === RUNTIME_ERRORS.length) {
      const mt = h.match(/.{0,50}(undefined|NaN|\[object Object\]).{0,50}/);
      RUNTIME_ERRORS.push('页面 ' + r + ' 出现异常文本：…' + (mt ? mt[0] : '') + '…');
    }
    if (typeof G.Pages['after_' + r] === 'function') G.Pages['after_' + r]();
    totalKB += Buffer.byteLength(h, 'utf8') / 1024;
    rendered++;
  } catch (e) {
    RUNTIME_ERRORS.push('渲染 ' + r + ' 抛错：' + e.message);
  }
});
chk('12 个页面全部渲染 + 事件绑定成功', rendered === 12 && RUNTIME_ERRORS.length === 0,
  rendered + '/12 页，合计 ' + totalKB.toFixed(1) + ' KB' +
  (RUNTIME_ERRORS.length ? '，异常 ' + RUNTIME_ERRORS.length + ' 处' : ''));
RUNTIME_ERRORS.forEach(e => log('       └ ' + e));

/* -------- 6. 核心业务正确性抽查 -------- */
try {
  const h = G.Algo.computeCategoryHealth({});
  const names = h.items.map(r => r.name + '=' + r.score);
  chk('健康度：7 品类均有分且无 NaN', h.ok && h.items.length === 7 &&
    h.items.every(r => typeof r.score === 'number' && isFinite(r.score)), names.join(' '));
} catch (e) { chk('健康度计算', false, e.message); }

try {
  const a = G.Algo.apriori({});
  chk('Apriori：按商品名聚合出规则', a.ok && a.rules.length > 0,
    a.ok ? a.rules.length + ' 条规则 / ' + a.basketCount + ' 个篮子 / ' +
      (a.itemCount || 0) + ' 条明细' : a.reason);
} catch (e) { chk('Apriori 计算', false, e.message); }

try {
  const d = G.Algo.buildDashboard({ pendingApprovalCount: 0 });
  const kpis = d.kpis || d.cards || [];
  const allNum = kpis.every(k => typeof k.value === 'number' && isFinite(k.value));
  chk('首页 8 个 KPI 均为动态有限数值', kpis.length === 8 && allNum,
    kpis.length + ' 个 KPI：' + kpis.map(k => k.label + '=' + k.value).join('，'));
} catch (e) { chk('首页 KPI 计算', false, e.message); }

/* -------- 7. AI 问答：六段式 / 合法拒答 -------- */
try {
  const qs = ['给我一份全店经营概览', '哪些品类健康度最低', '数据质量怎么样？', '随便问个没有数据的问题'];
  let six = 0, refus = 0, bad = 0;
  qs.forEach(q => {
    const a = G.AIAnswer(q);
    const keys = a.sections.map(s => s.key);
    if (!a.ok || (keys.length === 1 && keys[0] === 'insufficient')) { refus++; return; }
    const ok = keys.includes('conclusion') && keys.includes('evidence') &&
      keys.includes('risk') && keys.includes('decision');
    ok ? six++ : bad++;
  });
  chk('AI 问答：六段式完整 / 数据不足合法拒答', bad === 0,
    six + ' 条六段式 + ' + refus + ' 条合法拒答，异常 ' + bad);
} catch (e) { chk('AI 问答', false, e.message); }

/* -------- 8. 写操作与审批流 -------- */
try {
  const b = G.App.State.approvals.length;
  G.AITools.create_approval_request({
    level: 3, title: '产物验证用审批', advice: '验证用', basis: ['依据'],
    cats: ['生鲜蔬果'], priority: '高', risk: '高',
  });
  const after = G.App.State.approvals.length;
  chk('L3 写操作创建审批请求并进入审批中心', after === b + 1, b + ' → ' + after);
} catch (e) { chk('创建审批请求', false, e.message); }

/* -------- 9. 持久化 -------- */
try {
  const keys = Object.keys(LSS).filter(k => k.indexOf('wb_suguo_') === 0);
  chk('数据写入 localStorage（前缀 wb_suguo_）', keys.length > 0, keys.join(', '));
} catch (e) { chk('localStorage 持久化', false, e.message); }

/* -------- 10. 铁律合规 -------- */
chk('铁律 7：一级菜单 12 项（分层为 核心5+扩展3+智能3+系统1）',
  G.App.MENU.reduce((n, g) => n + g.items.length, 0) === 12,
  G.App.MENU.map(g => g.group + ':' + g.items.length).join(' | '));
chk('铁律 6：预置示例数据（含逾期审批）',
  G.App.State.approvals.length >= 3,
  G.App.State.approvals.length + ' 条审批请求（含逾期 AP20260916001）');

/*
 * 铁律 2 要求备份入口「不要藏在设置里」，须首屏一键可达。
 * 实现：顶栏「备份」按钮（#topBackup）→ 打开「我的账号」抽屉 → 导出/导入/清空。
 */
try {
  const hasFns = typeof G.App.exportAll === 'function' &&
    typeof G.App.importAll === 'function' &&
    typeof G.App.clearAll === 'function';
  chk('铁律 2：导出/导入/清空函数均已导出到 App',
    hasFns, ['exportAll', 'importAll', 'clearAll'].filter(k => typeof G.App[k] === 'function').join(', '));

  chk('铁律 2：顶栏存在首屏可见的「备份」按钮',
    html.indexOf('id="topBackup"') >= 0);

  G.App.showMe();
  const meHtml = getEl('drBody').innerHTML || '';
  const hasBtns = meHtml.indexOf('me-export') >= 0 &&
    meHtml.indexOf('me-import') >= 0 &&
    meHtml.indexOf('me-clear') >= 0;
  chk('铁律 2：「我的账号」抽屉内含导出/导入/清空三个动作', hasBtns,
    hasBtns ? '三动作齐备，抽屉 ' + (Buffer.byteLength(meHtml, 'utf8') / 1024).toFixed(1) + ' KB' : '缺失');
} catch (e) { chk('铁律 2：备份入口可达', false, e.message); }
chk('数据真实性：页面含「模拟数据」声明', html.indexOf('模拟数据') >= 0);

/* -------- 汇总 -------- */
log('');
log('='.repeat(72));
if (errs.length === 0) {
  log('交付产物验证：全部通过 ✓  未发现运行时错误');
} else {
  log('交付产物验证：发现 ' + errs.length + ' 个问题');
  errs.forEach((e, i) => log('  ' + (i + 1) + '. ' + e));
}
log('='.repeat(72));

const txt = out.join('\n');
fs.writeFileSync(path.join(ROOT, '..', '_dist_verify.txt'), txt, 'utf8');
console.log(txt);
process.exit(errs.length ? 1 : 0);
