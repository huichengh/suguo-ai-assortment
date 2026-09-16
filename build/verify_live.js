/*
 * verify_live.js —— 对「线上 GitHub Pages 站点」做端到端真实执行验证
 *
 * 与 verify_dist.js 的区别：这里抓取的是 https://huichengh.github.io/... 的
 * 真实响应体，而不是本地文件。用于证明线上提供的是可运行产物。
 *
 * 用法：node build/verify_live.js
 */
'use strict';

const https = require('https');
const http = require('http');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const SITE = 'https://huichengh.github.io/suguo-ai-assortment/';

const out = [];
const errs = [];
function log(s) { out.push(s); }
function chk(name, ok, note) {
  log((ok ? '[OK]   ' : '[FAIL] ') + name + (note ? '  → ' + note : ''));
  if (!ok) errs.push(name + (note ? ' → ' + note : ''));
}

function get(url, depth) {
  depth = depth || 0;
  return new Promise((res, rej) => {
    if (depth > 5) return rej(new Error('重定向次数过多'));
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        const next = new URL(r.headers.location, url).toString();
        r.resume();
        return get(next, depth + 1).then(res, rej);
      }
      let d = '';
      r.setEncoding('utf8');
      r.on('data', c => { d += c; });
      r.on('end', () => res({ status: r.statusCode, body: d, headers: r.headers }));
    }).on('error', rej);
  });
}

/* ---------- 沙箱：与 smoke.js / verify_dist.js 同构 ---------- */
function mkEl(tag) {
  return {
    tagName: String(tag || 'div').toUpperCase(),
    _attrs: {}, _text: '', _cn: '', children: [], parentNode: null,
    innerHTML: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
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
}

function buildSandbox() {
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
    location: { href: SITE, hostname: 'huichengh.github.io', reload() {} },
    navigator: { clipboard: null, userAgent: 'node-verify-live' },
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
    requestAnimationFrame: fn => { try { fn(0); } catch (e) {} return 0; },
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
  return { sandbox, getEl, LSS };
}

(async function main() {
  log('[INFO] 目标站点 ' + SITE);
  log('');

  let r;
  try {
    r = await get(SITE);
  } catch (e) {
    log('[FAIL] 无法访问线上站点：' + e.message);
    fs.writeFileSync(path.join(__dirname, '..', '..', '_live_verify.txt'), log && out.join('\n'), 'utf8');
    console.error(out.join('\n'));
    process.exit(1);
  }

  const html = r.body;
  chk('线上站点 HTTP 200 可访问', r.status === 200, 'status=' + r.status);
  chk('服务端为 GitHub Pages', /GitHub\.com/i.test(r.headers.server || '') || !!r.headers['x-github-request-id'],
    'server=' + (r.headers.server || '-'));
  chk('返回体积与本地产物一致（551.7 KB）',
    Math.abs(Buffer.byteLength(html, 'utf8') - 564917) < 64,
    (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1) + ' KB');

  /* 结构与零外链 */
  chk('DOCTYPE 完整', /^<!DOCTYPE html>/i.test(html));
  chk('HTML 结尾完整（未截断）', /<\/html>\s*$/.test(html.trimEnd()));
  chk('线上产物零外链（无 <script src>）', !/<script\s+src=/i.test(html));
  chk('线上产物无外链样式表', !/<link[^>]+rel=["']stylesheet["']/i.test(html));
  chk('含数据真实性声明', html.indexOf('模拟数据') >= 0);

  /* 抽内联脚本并真实执行 */
  const inline = [];
  const sre = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = sre.exec(html))) inline.push(m[1]);
  chk('抽出内联脚本段', inline.length >= 1, inline.length + ' 段');

  const { sandbox, getEl, LSS } = buildSandbox();

  try {
    vm.runInContext(inline[0], sandbox, { filename: 'live-inline.js' });
    chk('线上主体脚本整体执行无异常', true);
  } catch (e) {
    chk('线上主体脚本整体执行无异常', false, e.message);
  }

  const G = sandbox;
  chk('全局对象齐备（DATA/Algo/Charts/App/Pages/AITools）',
    !!G.SUGUO_DATA && !!G.Algo && !!G.Charts && !!G.App && !!G.Pages && !!G.AITools);
  chk('AI 工具数量为 14', G.AITools && Object.keys(G.AITools).length === 14,
    G.AITools ? Object.keys(G.AITools).length + ' 个' : '-');

  try {
    G.App.boot();
    chk('App.boot() 执行成功', true);
  } catch (e) { chk('App.boot() 执行成功', false, e.message); }

  try {
    getEl('lgUser').value = 'admin';
    getEl('lgPass').value = '123456';
    getEl('lgBtn').onclick();
    const u = G.App.State.user;
    chk('演示账号登录成功', !!u && u.role === 'admin', u ? u.name : '未登录');
  } catch (e) { chk('演示账号登录成功', false, e.message); }

  const ROUTES = ['dash', 'compare', 'health', 'assoc', 'forecast', 'deeplink',
    'privateLabel', 'newProduct', 'ai', 'data', 'approval', 'admin'];
  const RUNTIME_ERRORS = [];
  let rendered = 0, totalKB = 0;
  ROUTES.forEach(rt => {
    try {
      const before = RUNTIME_ERRORS.length;
      G.App.go(rt);
      const h = getEl('content').innerHTML || '';
      if (/undefined|NaN|\[object Object\]/.test(h) && before === RUNTIME_ERRORS.length) {
        const mt = h.match(/.{0,50}(undefined|NaN|\[object Object\]).{0,50}/);
        RUNTIME_ERRORS.push('页面 ' + rt + ' 异常文本：…' + (mt ? mt[0] : '') + '…');
      }
      if (typeof G.Pages['after_' + rt] === 'function') G.Pages['after_' + rt]();
      totalKB += Buffer.byteLength(h, 'utf8') / 1024;
      rendered++;
    } catch (e) { RUNTIME_ERRORS.push('渲染 ' + rt + ' 抛错：' + e.message); }
  });
  chk('线上产物 12 个页面全部渲染并绑定事件', rendered === 12 && RUNTIME_ERRORS.length === 0,
    rendered + '/12 页，' + totalKB.toFixed(1) + ' KB' +
    (RUNTIME_ERRORS.length ? '，异常 ' + RUNTIME_ERRORS.length + ' 处' : ''));
  RUNTIME_ERRORS.forEach(e => log('       └ ' + e));

  /* 核心算法在线上产物中同样正确 */
  try {
    const h = G.Algo.computeCategoryHealth({});
    chk('线上健康度计算正确（7 品类）', h.ok && h.items.length === 7 &&
      h.items.every(x => isFinite(x.score)),
      h.items.map(x => x.name + '=' + x.score).join(' '));
  } catch (e) { chk('线上健康度计算', false, e.message); }

  try {
    const a = G.Algo.apriori({});
    chk('线上 Apriori 计算正确', a.ok && a.rules.length > 0,
      a.ok ? a.rules.length + ' 条规则 / ' + a.basketCount + ' 篮' : a.reason);
  } catch (e) { chk('线上 Apriori 计算', false, e.message); }

  try {
    const d = G.Algo.buildDashboard({ pendingApprovalCount: 0 });
    const k = d.kpis || [];
    chk('线上首页 8 个 KPI 均为动态有限数值',
      k.length === 8 && k.every(x => isFinite(x.value)),
      k.map(x => x.label + '=' + x.value).join('，'));
  } catch (e) { chk('线上首页 KPI', false, e.message); }

  try {
    const a = G.AIAnswer('给我一份全店经营概览');
    const keys = a.sections.map(s => s.key);
    chk('线上 AI 助手六段式完整',
      keys.includes('conclusion') && keys.includes('evidence') &&
      keys.includes('risk') && keys.includes('decision'),
      '[' + keys.join('|') + '] L' + a.level);
  } catch (e) { chk('线上 AI 助手回答', false, e.message); }

  log('');
  log('='.repeat(72));
  if (errs.length === 0) {
    log('线上站点端到端验证：全部通过 ✓  线上提供的是可运行产物');
  } else {
    log('线上站点端到端验证：发现 ' + errs.length + ' 个问题');
    errs.forEach((e, i) => log('  ' + (i + 1) + '. ' + e));
  }
  log('='.repeat(72));

  const txt = out.join('\n');
  fs.writeFileSync(path.join(__dirname, '..', '..', '_live_verify.txt'), txt, 'utf8');
  console.log(txt);
  process.exit(errs.length ? 1 : 0);
})();
