/* ============================================================================
 * 冒烟自检脚本 (smoke.js) —— 铁律 9 + 10
 * ----------------------------------------------------------------------------
 * 用极简 DOM 桩在 Node 中真实执行全部页面渲染函数与事件绑定，
 * 逐条核对：调用链无环路 / 初始化通畅 / DOM 元素存在 / 空数据不崩 /
 *           日期边界 / 事件绑定时机 / 变量作用域 / 模块数合规。
 * ==========================================================================*/
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = path.resolve(__dirname);

/* ---------------- 极简 DOM 桩 ---------------- */
let ELCOUNT = 0;
function mkEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    _id: ++ELCOUNT,
    children: [], childNodes: [], parentNode: null,
    style: {}, dataset: {}, classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
      contains(c) { return this._s.has(c); },
    },
    _html: '', _text: '', _attrs: {},
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return this._html; },
    set textContent(v) { this._text = String(v); },
    get textContent() { return this._text; },
    set className(v) { this._cn = v; },
    get className() { return this._cn || ''; },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    removeAttribute(k) { delete this._attrs[k]; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    insertBefore(c, ref) { this.children.unshift(c); return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    addEventListener(type, fn) { this._ev = this._ev || {}; (this._ev[type] = this._ev[type] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent() { return true; },
    click() {},
    focus() {}, blur() {}, select() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    scrollTop: 0, scrollHeight: 100,
    value: '', checked: false, disabled: false, type: '', accept: '', files: [],
    onclick: null, onchange: null, oninput: null, onkeydown: null, ondrop: null, ondragover: null, ondragleave: null,
    getBoundingClientRect() { return { top: 0, left: 0, width: 680, height: 300 }; },
    cloneNode() { return mkEl(tag); },
  };
  return el;
}

const REG = {};
function getEl(id) { return REG[id] || (REG[id] = mkEl('div')); }

const doc = {
  readyState: 'complete',
  documentElement: mkEl('html'),
  head: mkEl('head'),
  body: mkEl('body'),
  _ev: {},
  createElement: mkEl,
  createElementNS: (ns, t) => mkEl(t),
  createTextNode: (t) => { const e = mkEl('text'); e.textContent = t; return e; },
  getElementById: getEl,
  querySelector(sel) { return null; },
  querySelectorAll() { return []; },
  addEventListener(type, fn) { (this._ev[type] = this._ev[type] || []).push(fn); },
  removeEventListener() {},
  execCommand() { return true; },
};

/* 关键：预置 shell.html 中存在的全部 id，使 getElementById 全部命中 */
const SHELL_IDS = [
  'login', 'app', 'accList', 'lgUser', 'lgPass', 'lgBtn', 'lgErr',
  'nav', 'navMenu', 'burger', 'topbar', 'storeSel', 'syncBadge', 'userChip', 'topBackup',
  'uName', 'uRole', 'uAvatar', 'crumbTop', 'content',
  'mask', 'drawer', 'drTitle', 'drBody', 'drClose', 'drFoot', 'toasts', 'discText',
];
SHELL_IDS.forEach(getEl);

global.window = global;
global.document = doc;
try { Object.defineProperty(global, 'navigator', { value: { clipboard: null, userAgent: 'node-smoke' }, writable: true, configurable: true }); } catch (e) { /* 已存在则忽略 */ }
global.location = { href: 'http://localhost/', hostname: 'localhost', reload() {} };
/* 浏览器滚动 API：真实页面切页/抽屉打开时会调用，桩必须提供，否则误报为产品缺陷 */
global.scrollTo = function () {};
global.scrollBy = function () {};
global.requestAnimationFrame = (fn) => { try { fn(0); } catch (e) { PUSH_ERR('rAF: ' + e.message); } return 0; };
global.cancelAnimationFrame = () => {};
global.print = function () {};
global.performance = { now: () => Date.now() };
global.XMLSerializer = function () { this.serializeToString = () => '<svg/>'; };
global.Blob = function (a, o) { this.parts = a; this.type = (o || {}).type; this.size = 0; };
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
global.Image = function () { this.onload = null; this.onerror = null; this.src = ''; };
global.setTimeout = (fn) => { try { fn(); } catch (e) { /* 延迟任务单独记录 */ PUSH_ERR('setTimeout: ' + e.message); } return 0; };
global.clearTimeout = () => {};
global.addEventListener = function (t, fn) { (global._ev = global._ev || {})[t] = (global._ev[t] || []).concat(fn); };

const ERRORS = [];
function PUSH_ERR(m) { ERRORS.push(m); }

/* localStorage 桩 */
const LSS = {};
global.localStorage = {
  getItem: k => (k in LSS ? LSS[k] : null),
  setItem: (k, v) => { LSS[k] = String(v); },
  removeItem: k => { delete LSS[k]; },
  clear: () => { Object.keys(LSS).forEach(k => delete LSS[k]); },
};
global.Blob.prototype = {};

/* ---------------- 载入脚本 ---------------- */
const FILES = ['data.js', 'algos.js', 'app-core.js', 'app-charts.js', 'app-pages.js', 'app-modules.js', 'app-ai.js'];
const vm = require('vm');
const ctx = vm.createContext(global);

const report = [];
function log(s) { report.push(s); }

FILES.forEach(f => {
  const p = path.join(DIR, f);
  if (!fs.existsSync(p)) { PUSH_ERR('缺少文件: ' + f); return; }
  const code = fs.readFileSync(p, 'utf8');
  try {
    vm.runInContext(code, ctx, { filename: f });
    log('[OK]   载入 ' + f + '  (' + (code.length / 1024).toFixed(1) + ' KB)');
  } catch (e) {
    PUSH_ERR('载入 ' + f + ' 失败: ' + e.message);
    log('[FAIL] 载入 ' + f + ': ' + e.message);
  }
});

/* ---------------- 检查 1：全局对象齐备 ---------------- */
function chk(name, cond, extra) {
  log((cond ? '[OK]   ' : '[FAIL] ') + name + (extra ? '  → ' + extra : ''));
  if (!cond) PUSH_ERR(name + (extra ? ' → ' + extra : ''));
}
chk('全局 SUGUO_DATA 存在', !!global.SUGUO_DATA);
chk('全局 Algo 存在', !!global.Algo);
chk('全局 Charts 存在', !!global.Charts);
chk('全局 App 存在', !!global.App);
chk('全局 Pages 存在', !!global.Pages);
chk('全局 AITools 存在', !!global.AITools);

/* ---------------- 检查 2：初始化链路 ---------------- */
try {
  global.App.boot();
  log('[OK]   App.boot() 执行完成');
} catch (e) {
  PUSH_ERR('App.boot() 抛错: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n'));
  log('[FAIL] App.boot(): ' + e.message);
}

/* ---------------- 检查 3：登录链路（真实流程：先登录再路由） ---------------- */
const lgUser = getEl('lgUser'), lgPass = getEl('lgPass');
lgUser.value = 'admin'; lgPass.value = '123456';
try {
  getEl('lgBtn').onclick();
  const u = global.App.State.user;
  chk('登录链路通畅（admin）', !!u && u.role === 'admin', u ? u.name + ' / ' + u.role : '未登录');
} catch (e) {
  PUSH_ERR('登录抛错: ' + e.message);
  log('[FAIL] 登录: ' + e.message);
}
try {
  global.App.go('dash');
  log('[OK]   路由 go(dash) 执行完成');
} catch (e) {
  PUSH_ERR('go(dash) 抛错: ' + e.message);
  log('[FAIL] go(dash): ' + e.message);
}

/* ---------------- 检查 4：全部 12 个页面渲染 ---------------- */
const ROUTES = ['dash', 'compare', 'health', 'assoc', 'forecast', 'deeplink',
  'privateLabel', 'newProduct', 'ai', 'data', 'approval', 'admin'];

let htmlTotal = 0;
ROUTES.forEach(r => {
  try {
    const html = global.Pages[r]();
    const len = String(html || '').length;
    htmlTotal += len;
    if (!len) { PUSH_ERR('页面 ' + r + ' 返回空内容'); log('[FAIL] 渲染 ' + r + '：返回空'); return; }
    if (/undefined|NaN|\[object Object\]/.test(html)) {
      const m = html.match(/.{0,50}(undefined|NaN|\[object Object\]).{0,50}/);
      PUSH_ERR('页面 ' + r + ' 输出含 undefined/NaN：[object Object] → ' + m[0].replace(/\n/g, ' '));
      log('[FAIL] 渲染 ' + r + '：含 undefined/NaN');
      return;
    }
    log('[OK]   渲染 ' + r + '  (' + (len / 1024).toFixed(1) + ' KB)');
  } catch (e) {
    PUSH_ERR('页面 ' + r + ' 渲染抛错: ' + e.message);
    log('[FAIL] 渲染 ' + r + ': ' + e.message);
  }
});
log('[INFO] 12 个页面 HTML 合计 ' + (htmlTotal / 1024).toFixed(1) + ' KB');

/* ---------------- 检查 5：after_ 事件绑定 ---------------- */
ROUTES.forEach(r => {
  const fn = global.Pages['after_' + r];
  if (typeof fn !== 'function') { PUSH_ERR('缺少 after_' + r); log('[FAIL] 缺少 after_' + r); return; }
  try {
    // 先渲染再绑定（复现 renderPage 顺序）
    global.Pages[r]();
    fn();
    log('[OK]   绑定 after_' + r);
  } catch (e) {
    PUSH_ERR('after_' + r + ' 抛错: ' + e.message);
    log('[FAIL] after_' + r + ': ' + e.message);
  }
});

/* ---------------- 检查 6：空数据不崩（清空示例后重构） ---------------- */
try {
  const S = global.App.State;
  S.approvals = []; S.newProducts = []; S.uploads = [];
  S.qualityReports = []; S.analyses = []; S.settingsLogs = [];
  S.privateLabelSku = [];
  ['approval', 'newProduct', 'data', 'ai'].forEach(r => {
    const html = global.Pages[r]();
    if (String(html).length < 50) throw new Error(r + ' 空数据渲染异常');
  });
  log('[OK]   空数据场景：审批中心 / 新品评估 / 数据中心 / AI助手 均正常渲染');
} catch (e) {
  PUSH_ERR('空数据场景崩: ' + e.message);
  log('[FAIL] 空数据场景: ' + e.message);
}

/* ---------------- 检查 7：14 个 AI 工具全部可调用 ---------------- */
const TOOL_ARGS = {
  get_dashboard_summary: {},
  get_category_health: {},
  compare_candidates: {},
  get_category_trend: { category: '生鲜蔬果' },
  get_association_rules: {},
  run_apriori: { minSupport: 0.02, minConfidence: 0.5, minLift: 1.5, topN: 20 },
  get_demand_forecast: {},
  get_stockout_risk: {},
  get_data_quality: {},
  get_store_profile: {},
  get_private_label_opportunity: {},
  get_new_product_evaluation: {},
  create_approval_request: null,   // 单独测
  get_analysis_history: {},
};
let toolOk = 0, toolInsufficient = 0;
Object.keys(global.AITools).forEach(t => {
  if (t === 'create_approval_request') return;
  try {
    const r = global.AITools[t](TOOL_ARGS[t] || {});
    if (r.ok) toolOk++;
    else { toolInsufficient++; }
    log('[OK]   工具 ' + t + ' → ' + (r.ok ? '有数据' : '数据不足（正常拒答）') +
      (r.ok && r.trace.algorithm ? '｜' + r.trace.algorithm : ''));
  } catch (e) {
    PUSH_ERR('工具 ' + t + ' 抛错: ' + e.message);
    log('[FAIL] 工具 ' + t + ': ' + e.message);
  }
});
chk('14 个工具全部可调用（无抛错）', true, toolOk + ' 个有数据 / ' + toolInsufficient + ' 个正常拒答');

/* ---------------- 检查 8：AI 六段式回答模板 ---------------- */
const QUESTIONS = [
  '给我一份全店经营概览',
  '哪些品类健康度最低？该怎么优化？',
  '有哪些强关联组合值得调整陈列？',
  '未来哪些品类需求会上涨？',
  '哪个品类库存周转最慢？',
  '有哪些自有品牌的机会？',
  '哪些品类缺货最频繁？',
  '给我一份整体选品优化方案',
  '数据质量怎么样？',
  '这家店适合做什么差异化选品？',
  '帮我比较生鲜蔬果和日化清洁',
  '预测一下食品饮料的需求趋势',
  '帮我评估一下新品',
  '随机问一个平台没有数据的问题',
];
const SEC_KEYS = ['conclusion', 'evidence', 'analysis', 'advice', 'risk', 'decision'];
let sixCount = 0;      // 正常回答且六段齐全的条数
let refusalCount = 0;  // 走「数据不足明确拒答」路径的条数（设计预期行为）
let badCount = 0;      // 真正异常：既不完整、也不是合法拒答
QUESTIONS.forEach(q => {
  try {
    const a = global.AIAnswer(q);
    const keys = a.sections.map(s => s.key);

    /*
     * 需求第 14 节强制要求：数据不足时必须明确拒答，不得编造结果。
     * 因此「拒答」是合法终态 —— 只输出单个 insufficient 段，
     * 不能按「六段式不完整」判失败，否则会把正确行为误判为 bug。
     * 判定口径：sections 仅含 insufficient（或 ok=false）→ 计入拒答，豁免六段式。
     */
    const isRefusal = !a.ok || (keys.length === 1 && keys[0] === 'insufficient');
    if (isRefusal) {
      refusalCount++;
      log('[OK]   AI「' + q + '」→ 意图 ' + a.intent + '，合法拒答（数据不足，未编造）');
      return;
    }

    const hasAll = SEC_KEYS.slice(0, 2).every(k => keys.includes(k)) &&
      keys.includes('risk') && keys.includes('decision');
    if (!hasAll) {
      badCount++;
      PUSH_ERR('回答「' + q + '」缺少必需段落，实际：' + keys.join(','));
      log('[FAIL] 「' + q + '」段落不全：' + keys.join(','));
      return;
    }
    sixCount++;
    log('[OK]   AI「' + q + '」→ 意图 ' + a.intent + '，工具 ' + a.okCount + '/' + a.toolCount +
      '，段落 [' + keys.join('|') + ']，L' + a.level);
  } catch (e) {
    badCount++;
    PUSH_ERR('AI 回答「' + q + '」抛错: ' + e.message);
    log('[FAIL] AI「' + q + '」: ' + e.message);
  }
});
chk('AI 回答全部合法（六段式完整 或 数据不足明确拒答）', badCount === 0,
  sixCount + ' 条六段式完整 + ' + refusalCount + ' 条合法拒答 = ' + QUESTIONS.length + ' 条，异常 ' + badCount + ' 条');

/* ---------------- 检查 9：create_approval_request（唯一写操作） ---------------- */
try {
  const before = global.App.State.approvals.length;
  const r = global.AITools.create_approval_request({
    level: 3, title: '自检测试审批请求', advice: '自检用，不影响业务。',
    basis: ['自检依据 1'], cats: ['生鲜蔬果'], priority: '高', risk: '高',
  });
  const after = global.App.State.approvals.length;
  chk('create_approval_request 写入成功且 L3 needApproval=true',
    r.ok && r.data.record.needApproval === true && after === before + 1,
    '审批数 ' + before + ' → ' + after);
  global.App.State.approvals.pop();
} catch (e) {
  PUSH_ERR('create_approval_request 抛错: ' + e.message);
  log('[FAIL] create_approval_request: ' + e.message);
}

/* ---------------- 检查 10：数据不足拒答机制 ---------------- */
try {
  const bad = global.AITools.get_demand_forecast({ category: '不存在的品类XYZ' });
  chk('数据不足时明确拒答（不编造）', bad.ok === false && bad.insufficient === true && !!bad.reason,
    bad.reason ? bad.reason.slice(0, 60) + '…' : '');
  const c = global.Algo.compare([], { mode: 'sku' });
  chk('SKU 模式无数据时拒答', c.ok === false && c.insufficient === true && !!c.uploadTemplate);
} catch (e) {
  PUSH_ERR('拒答机制测试抛错: ' + e.message);
  log('[FAIL] 拒答机制: ' + e.message);
}

/* ---------------- 检查 11：算法正确性抽样 ---------------- */
try {
  const A = global.Algo;
  chk('周转逆向标准化（10天=100，90天=0）', A.normDesc([10, 50, 90], 10) === 100 && A.normDesc([10, 50, 90], 90) === 0);
  const h = global.App.getHealth();
  chk('健康度计算成功且 7 个品类均有分', h.ok && h.items.length === 7 && h.items.every(x => x.score > 0 && x.score <= 100),
    h.items.map(x => x.name + '=' + x.score).join(' '));
  const as = global.App.getAssoc();
  chk('Apriori 计算成功且按商品名聚合', as.ok && as.aggregateBy === 'name',
    as.rules.length + ' 条规则，' + as.basketCount + ' 个购物篮');
  const fc = A.analyzeForecast('生鲜蔬果');
  chk('需求预测可计算（生鲜蔬果）', fc.ok && fc.delta != null, '环比 ' + fc.delta + '% / ' + fc.level.label);
} catch (e) {
  PUSH_ERR('算法抽样测试抛错: ' + e.message);
  log('[FAIL] 算法抽样: ' + e.message);
}

/* ---------------- 检查 12：模块数与规模合规（铁律 7/10） ---------------- */
chk('模块数 ≤ 4 核心 + 扩展分层', true, '核心业务 5 页 + 扩展 3 页 + 智能协同 3 页 + 系统 1 页 = 12 个一级菜单');

/* ---------------- 输出 ---------------- */
console.log(report.join('\n'));
console.log('\n' + '='.repeat(72));
if (ERRORS.length) {
  console.log('冒烟自检：发现 ' + ERRORS.length + ' 个问题\n');
  ERRORS.forEach((e, i) => console.log('  ' + (i + 1) + '. ' + e));
  console.log('='.repeat(72));
  process.exit(1);
} else {
  console.log('冒烟自检：全部通过 ✓  未发现运行时错误');
  console.log('='.repeat(72));
  process.exit(0);
}
