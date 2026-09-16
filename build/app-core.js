/* ============================================================================
 * 苏果智选 · 核心运行时 (app-core.js)
 * ----------------------------------------------------------------------------
 * 分层：数据层(Store) -> 计算层(Algo) -> 渲染层(Pages/Modules)
 * 单向调用（铁律 9）：渲染函数之间严禁互调，统一由 refreshPage() 调度。
 * ==========================================================================*/
(function (global) {
  'use strict';

  var D = global.SUGUO_DATA;
  var A = global.Algo;

  /* ==================== 角色与权限 ==================== */

  var ROLES = {
    admin: { name: '系统管理员', desc: '全部权限', perms: ['*'] },
    purchase: {
      name: '采购经理', desc: '商品比较 / 选品建议 / 新品 / 审批申请',
      perms: ['dash', 'compare', 'health', 'assoc', 'forecast', 'deeplink', 'privateLabel', 'newProduct',
        'ai', 'data', 'approval', 'admin.dataset', 'admin.settings', 'admin.log'],
    },
    category: {
      name: '品类经理', desc: '品类诊断 / 关联规则 / 需求预测 / 品类优化',
      perms: ['dash', 'compare', 'health', 'assoc', 'forecast', 'deeplink', 'privateLabel',
        'ai', 'data', 'approval'],
    },
    manager: {
      name: '门店店长', desc: '查看本门店分析 / 查看建议 / 提交反馈',
      perms: ['dash', 'compare', 'health', 'assoc', 'forecast', 'deeplink', 'ai', 'approval'],
    },
    viewer: { name: '普通查看人员', desc: '只读', perms: ['dash', 'health', 'assoc', 'forecast', 'deeplink'] },
  };

  var USERS = [
    { u: 'admin', p: '123456', name: '管理员·张明', role: 'admin', store: 'ALL' },
    { u: 'purchase', p: '123456', name: '采购经理·李静', role: 'purchase', store: 'S001' },
    { u: 'category', p: '123456', name: '品类经理·王涛', role: 'category', store: 'S001' },
    { u: 'manager', p: '123456', name: '店长·陈晓峰', role: 'manager', store: 'S001' },
    { u: 'viewer', p: '123456', name: '查看员·刘宇', role: 'viewer', store: 'S001' },
  ];

  function can(perm) {
    if (!State.user) return false;
    var p = ROLES[State.user.role].perms;
    return p.indexOf('*') >= 0 || p.indexOf(perm) >= 0;
  }

  /* ==================== 门店 ==================== */

  var STORES = [
    {
      id: 'S001', name: '华润苏果（南京江宁黄金海岸广场店）', short: '黄金海岸广场店',
      city: '南京市江宁区', biz: '社区商业综合体',
      profile: {
        area3km: null, residentRatio: null, officeRatio: null, studentRatio: null, elderRatio: null,
        consumption: null, residentPoi: null, officePoi: null, schoolPoi: null,
        competitors: [], delivery: null,
      },
      note: '门店画像量化字段待接入门店周边人口 / POI 数据后启用。',
    },
    { id: 'S002', name: '华润苏果（南京鼓楼湖南路店）', short: '湖南路店', city: '南京市鼓楼区', biz: '城市商业街', profile: null, note: '演示占位门店，多店数据待接入。' },
    { id: 'S003', name: '华润苏果（南京浦口江浦店）', short: '江浦店', city: '南京市浦口区', biz: '社区居住区', profile: null, note: '演示占位门店，多店数据待接入。' },
  ];

  /* ==================== 全局状态 ==================== */

  var LS = 'wb_suguo_';

  var State = {
    user: null,
    storeId: 'S001',
    route: 'dash',
    dataMeta: null,
    uploads: [],          // 上传的数据集记录
    qualityReports: [],   // 数据质量报告
    approvals: [],        // 审批请求
    analyses: [],         // AI 分析记录
    auditLogs: [],        // 操作日志
    modelLogs: [],        // 模型运行日志
    settingsLogs: [],     // 参数变更留痕
    newProducts: [],      // 新品候选池
    privateLabelSku: [],  // 自有品牌 SKU 级数据（待接入）
    settings: {
      weights: { qty: 30, gp: 30, turnover: 20, space: 20 },
      apriori: { minSupport: 0.02, minConfidence: 0.50, minLift: 1.50, topN: 20, aggregateBy: 'name' },
      forecast: { horizon: 4, minHistory: 12 },
      risk: { turnoverDays: 45, spaceEff: 400, stockout: 4, healthScore: 55 },
    },
    healthCache: null,
    assocCache: null,
    dashCache: null,
    planCache: null,
    compareSel: [],
    compareMode: 'category',
    chat: [],
    logoTimer: null,
  };

  /* ==================== 存储层 ==================== */

  function save(key, val) {
    try { localStorage.setItem(LS + key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }
  function load(key, dflt) {
    try {
      var v = localStorage.getItem(LS + key);
      return v === null ? dflt : JSON.parse(v);
    } catch (e) { return dflt; }
  }

  function persist() {
    save('approvals', State.approvals);
    save('uploads', State.uploads);
    save('qualityReports', State.qualityReports);
    save('analyses', State.analyses);
    save('auditLogs', State.auditLogs);
    save('modelLogs', State.modelLogs);
    save('settingsLogs', State.settingsLogs);
    save('newProducts', State.newProducts);
    save('privateLabelSku', State.privateLabelSku);
    save('settings', State.settings);
    save('storeId', State.storeId);
    setSync('saved');
  }

  function setSync(mode) {
    var el = document.getElementById('syncBadge');
    if (!el) return;
    el.className = 'sync' + (mode === 'saved' ? '' : mode === 'off' ? ' off' : ' syncing');
    var tx = el.querySelector('.tx');
    if (tx) tx.textContent = mode === 'saved' ? '本地存储' : mode === 'off' ? '离线模式' : '保存中';
  }

  function audit(action, target, detail) {
    State.auditLogs.unshift({
      id: 'LOG' + Date.now() + Math.floor(Math.random() * 900 + 100),
      user: State.user ? State.user.name : '系统',
      role: State.user ? ROLES[State.user.role].name : '-',
      action: action, target: target || '-', detail: detail || '-',
      ip: '127.0.0.1',
      at: nowStr(),
    });
    if (State.auditLogs.length > 400) State.auditLogs.length = 400;
  }

  function modelRun(algorithm, dataset, params, durationMs, ok) {
    State.modelLogs.unshift({
      id: 'RUN' + Date.now() + Math.floor(Math.random() * 900 + 100),
      algorithm: algorithm, dataset: dataset,
      params: typeof params === 'string' ? params : JSON.stringify(params),
      duration: durationMs, status: ok ? '成功' : '失败',
      rows: D.sales.length,
      at: nowStr(),
    });
    if (State.modelLogs.length > 300) State.modelLogs.length = 300;
  }

  function nowStr() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /* ==================== 计算层缓存（单向，供渲染层读取） ==================== */

  function getHealth(force) {
    if (!State.healthCache || force) {
      var t0 = performance.now();
      State.healthCache = A.computeCategoryHealth({
        weights: {
          qty: State.settings.weights.qty / 100,
          gp: State.settings.weights.gp / 100,
          turnover: State.settings.weights.turnover / 100,
          space: State.settings.weights.space / 100,
        },
      });
      modelRun('CategoryHealthScore', 'dataset_category_sales.csv',
        State.settings.weights, Math.round(performance.now() - t0), State.healthCache.ok);
    }
    return State.healthCache;
  }

  function getAssoc(force) {
    if (!State.assocCache || force) {
      var t0 = performance.now();
      State.assocCache = A.apriori({
        minSupport: State.settings.apriori.minSupport,
        minConfidence: State.settings.apriori.minConfidence,
        minLift: State.settings.apriori.minLift,
        topN: State.settings.apriori.topN,
        aggregateBy: State.settings.apriori.aggregateBy,
      });
      modelRun('Apriori', 'dataset_transactions_sample.csv',
        State.settings.apriori, Math.round(performance.now() - t0), State.assocCache.ok);
    }
    return State.assocCache;
  }

  function getDash(force) {
    if (!State.dashCache || force) {
      State.dashCache = A.buildDashboard({
        weights: {
          qty: State.settings.weights.qty / 100,
          gp: State.settings.weights.gp / 100,
          turnover: State.settings.weights.turnover / 100,
          space: State.settings.weights.space / 100,
        },
        // 算法层为纯函数，应用层状态由这里注入（不反向依赖）
        pendingApprovalCount: (State.approvals || []).filter(function (a) {
          return a.status === '待审批';
        }).length,
      });
    }
    return State.dashCache;
  }

  function getPlan(force) {
    if (!State.planCache || force) {
      State.planCache = A.buildAssortmentPlan({
        weights: {
          qty: State.settings.weights.qty / 100,
          gp: State.settings.weights.gp / 100,
          turnover: State.settings.weights.turnover / 100,
          space: State.settings.weights.space / 100,
        },
      });
    }
    return State.planCache;
  }

  function invalidate() {
    State.healthCache = null;
    State.assocCache = null;
    State.dashCache = null;
    State.planCache = null;
  }

  /* ==================== 格式化工具 ==================== */

  function fmtNum(v, d) {
    if (v == null || v === '' || isNaN(v)) return '—';
    d = d == null ? 0 : d;
    return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtMoney(v, d) {
    if (v == null || isNaN(v)) return '—';
    return '¥' + fmtNum(v, d == null ? 0 : d);
  }
  function fmtPct(v, d) {
    if (v == null || isNaN(v)) return '—';
    return (v > 0 ? '+' : '') + Number(v).toFixed(d == null ? 1 : d) + '%';
  }
  function fmtScore(v) { return v == null ? '—' : Number(v).toFixed(1).replace(/\.0$/, ''); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function diff(a, b) {
    var d = Math.round((a - b) * 10) / 10;
    return (d > 0 ? '+' : '') + d;
  }
  function uid(prefix) {
    return (prefix || 'ID') + Date.now().toString(36).toUpperCase() +
      Math.random().toString(36).slice(2, 6).toUpperCase();
  }
  function download(name, text, mime) {
    var blob = new Blob(['\ufeff' + text], { type: (mime || 'text/csv') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
  }
  function toCSV(rows, headers) {
    if (!rows || !rows.length) return '';
    headers = headers || Object.keys(rows[0]);
    var q = function (v) {
      var s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [headers.join(',')].concat(
      rows.map(function (r) { return headers.map(function (h) { return q(r[h]); }).join(','); })
    ).join('\n');
  }
  function parseCSV(text) {
    // 支持引号转义与 BOM
    text = String(text).replace(/^\ufeff/, '');
    var rows = [], cur = [], field = '', inQ = false, i = 0;
    while (i < text.length) {
      var c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ',') { cur.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || cur.length) { cur.push(field); rows.push(cur); }
    rows = rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
    if (rows.length < 2) return [];
    var headers = rows[0].map(function (h) { return String(h).trim(); });
    return rows.slice(1).map(function (r) {
      var o = {};
      headers.forEach(function (h, k) { o[h] = r[k] === undefined ? '' : String(r[k]).trim(); });
      return o;
    });
  }

  /* ==================== Toast / 抽屉 ==================== */

  var ICON = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6L9 17l-5-5"/></svg>',
    err: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>',
  };

  function toast(msg, type, ms) {
    var box = document.getElementById('toasts');
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.innerHTML = (ICON[type] || ICON.info) + '<span>' + esc(msg) + '</span>';
    box.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .25s,transform .25s';
      el.style.opacity = '0'; el.style.transform = 'translateY(10px)';
      setTimeout(function () { el.remove(); }, 260);
    }, ms || 2600);
  }

  function openDrawer(title, bodyHTML, footHTML) {
    document.getElementById('drTitle').textContent = title;
    document.getElementById('drBody').innerHTML = bodyHTML;
    document.getElementById('drFoot').innerHTML = footHTML || '';
    document.getElementById('drawer').classList.add('on');
    document.getElementById('mask').classList.add('on');
  }
  function closeDrawer() {
    document.getElementById('drawer').classList.remove('on');
    document.getElementById('mask').classList.remove('on');
  }

  function confirmDialog(title, msg, onOk, okLabel) {
    openDrawer(title,
      '<div class="note warn">' + ICON.warn + '<div>' + msg + '</div></div>',
      '<button class="btn" data-act="dr-cancel">取消</button>' +
      '<button class="btn danger" data-act="dr-ok">' + esc(okLabel || '确认') + '</button>');
    document.getElementById('drFoot').onclick = function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'dr-ok') { closeDrawer(); if (onOk) onOk(); }
      else closeDrawer();
    };
  }

  /* ==================== SVG 图标库 ==================== */

  var SVG = {
    dash: '<path d="M3 13h8V3H3v10zm10 8h8V11h-8v10zM3 21h8v-6H3v6zm10-12h8V3h-8v6z"/>',
    compare: '<path d="M9 3v18M15 3v18M3 9h6M15 9h6M3 15h6M15 15h6"/>',
    health: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    link: '<path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7"/>',
    trend: '<path d="M23 6l-9.5 9.5-5-5L1 18M17 6h6v6"/>',
    store: '<path d="M3 9l1.5-6h15L21 9M3 9h18v11a1 1 0 01-1 1H4a1 1 0 01-1-1V9zM8 21v-6h8v6"/>',
    brand: '<path d="M20.6 3.4a5 5 0 00-7 0L7 9.9V17h7.1l6.5-6.4a5 5 0 000-7.2zM7 21H3v-4"/>',
    newp: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    ai: '<path d="M12 2a3 3 0 013 3v1h2a2 2 0 012 2v2h1a2 2 0 010 4h-1v2a2 2 0 01-2 2h-2v1a3 3 0 01-6 0v-1H7a2 2 0 01-2-2v-2H4a2 2 0 010-4h1V8a2 2 0 012-2h2V5a3 3 0 013-3z"/><circle cx="12" cy="12" r="2.5"/>',
    data: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    approval: '<path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>',
    admin: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.7 1.7 0 009 19.4a1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
    alert: '<path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>',
    box: '<path d="M21 16V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.3 7l8.7 5 8.7-5M12 22V12"/>',
    refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0114.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0020.5 15"/>',
    trendup: '<path d="M23 6l-9.5 9.5-5-5L1 18M17 6h6v6"/>',
    gavel: '<path d="M14 13l-8.5 8.5a2.1 2.1 0 01-3-3L11 10M3 21h10M14 4l6 6M12.5 5.5l6 6M9 8l6 6"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    down: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    flat: '<path d="M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    upload: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v13"/>',
    download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    doc: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
    file: '<path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M13 2v7h7"/>',
    users: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>',
    flow: '<rect x="3" y="3" width="7" height="6" rx="1.5"/><rect x="14" y="15" width="7" height="6" rx="1.5"/><path d="M6.5 9v5a3 3 0 003 3h4"/>',
    log: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 15h6M9 11h3"/>',
    cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a1 1 0 01-1 1H7a1 1 0 01-1-1L5 6"/>',
    edit: '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4z"/>',
    filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-7.2-7.2a2 2 0 01-.6-1.4V4a2 2 0 012-2h8a2 2 0 011.4.6l6.4 6.4a2 2 0 010 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    rocket: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2M12 15l-3-3a22 22 0 012-3.9A12.9 12.9 0 0122 2a12.9 12.9 0 01-6.1 11 22 22 0 01-3.9 2z"/><path d="M9 12H4s.5-2.8 2-4c1.7-1.4 5 0 5 0M12 15v5s2.8-.5 4-2c1.4-1.7 0-5 0-5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    layers: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>',
    zap: '<path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z"/>',
    send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
    lock: '<rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    warn: '<path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>',
    cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  };

  function icon(name, cls, size) {
    var p = SVG[name] || SVG.info;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round"' +
      (cls ? ' class="' + cls + '"' : '') +
      (size ? ' width="' + size + '" height="' + size + '"' : '') +
      '>' + p + '</svg>';
  }
  function iconFill(name, cls, size) {
    var p = SVG[name] || SVG.info;
    return '<svg viewBox="0 0 24 24" fill="currentColor"' +
      (cls ? ' class="' + cls + '"' : '') +
      (size ? ' width="' + size + '" height="' + size + '"' : '') +
      '>' + p + '</svg>';
  }

  /* ==================== 菜单定义 ==================== */

  var MENU = [
    { group: '核心业务', items: [
      { id: 'dash', name: '首页 / AI经营驾驶舱', icon: 'dash', perm: 'dash' },
      { id: 'compare', name: '选品比较中心', icon: 'compare', perm: 'compare', hot: true },
      { id: 'health', name: '品类健康诊断', icon: 'health', perm: 'health', hot: true },
      { id: 'assoc', name: '关联陈列分析', icon: 'link', perm: 'assoc', hot: true },
      { id: 'forecast', name: '需求预测', icon: 'trend', perm: 'forecast', hot: true },
    ] },
    { group: '扩展分析', items: [
      { id: 'deeplink', name: '千店千面', icon: 'store', perm: 'deeplink', wait: true },
      { id: 'privateLabel', name: '自有品牌机会', icon: 'brand', perm: 'privateLabel', wait: true },
      { id: 'newProduct', name: '新品评估', icon: 'newp', perm: 'newProduct' },
    ] },
    { group: '智能与协同', items: [
      { id: 'ai', name: 'AI选品助手', icon: 'ai', perm: 'ai' },
      { id: 'data', name: '数据中心', icon: 'data', perm: 'data' },
      { id: 'approval', name: '审批中心', icon: 'approval', perm: 'approval' },
    ] },
    { group: '系统管理', items: [
      { id: 'admin', name: '系统管理', icon: 'admin', perm: 'admin.view' },
    ] },
  ];

  var PAGE_TITLE = {
    dash: 'AI经营驾驶舱', compare: '选品比较中心', health: '品类健康诊断',
    assoc: '关联陈列分析', forecast: '需求预测', deeplink: '千店千面',
    privateLabel: '自有品牌机会', newProduct: '新品评估', ai: 'AI选品助手',
    data: '数据中心', approval: '审批中心', admin: '系统管理',
  };

  /* ==================== 路由 ==================== */

  function go(route) {
    if (!PAGE_TITLE[route]) route = 'dash';
    State.route = route;
    renderNav();
    renderPage();
    document.getElementById('crumbTop').textContent = PAGE_TITLE[route];
    var c = document.getElementById('content');
    if (c) c.scrollTop = 0;
    window.scrollTo(0, 0);
    document.getElementById('nav').classList.remove('on');
    save('route', route);
  }

  function renderNav() {
    var html = '';
    MENU.forEach(function (g) {
      html += '<div class="nav-group">' + esc(g.group) + '</div>';
      g.items.forEach(function (it) {
        if (!canPerm(it.perm)) return;
        html += '<button class="nav-item' + (State.route === it.id ? ' active' : '') +
          '" data-route="' + it.id + '">' + icon(it.icon) + '<span>' + esc(it.name) + '</span>' +
          (it.hot ? '<span class="tag">核心</span>' : '') +
          (it.wait ? '<span class="tag">待接入</span>' : '') +
          '</button>';
      });
    });
    document.getElementById('navMenu').innerHTML = html;
  }

  function canPerm(p) {
    if (!State.user) return false;
    if (p === 'admin.view') return State.user.role === 'admin';
    var base = p.split('.')[0];
    return can(base);
  }

  function renderPage() {
    var fn = global.Pages && global.Pages[State.route];
    var el = document.getElementById('content');
    // 权限兜底
    if (!fn) { el.innerHTML = emptyState('页面开发中', '该模块尚未实现。'); return; }
    var needs = MENU.reduce(function (acc, g) {
      g.items.forEach(function (i) { if (i.id === State.route) acc = i.perm; });
      return acc;
    }, 'dash');
    if (!canPerm(needs)) {
      el.innerHTML = emptyState('无访问权限',
        '当前账号角色为「' + (State.user ? ROLES[State.user.role].name : '未登录') + '」，不具备访问「' +
        PAGE_TITLE[State.route] + '」的权限。请联系管理员调整角色。',
        'shield');
      return;
    }
    el.innerHTML = fn();
    if (global.Pages['after_' + State.route]) global.Pages['after_' + State.route]();
  }

  /** 统一刷新入口（铁律 9：所有联动更新走这里） */
  function refreshPage() {
    renderPage();
  }

  function emptyState(title, desc, ic, actsHTML) {
    return '<div class="card"><div class="empty">' + icon(ic || 'file') +
      '<h4>' + esc(title) + '</h4><p>' + desc + '</p>' +
      (actsHTML ? '<div class="acts">' + actsHTML + '</div>' : '') +
      '</div></div>';
  }

  function insufficient(title, reason, actsHTML) {
    return '<div class="note bad" style="margin-bottom:14px">' + ICON.warn +
      '<div><b>' + esc(title) + '</b><br>' + esc(reason) + '</div></div>' + (actsHTML || '');
  }

  /* ==================== 启动 ==================== */

  function boot() {
    // 恢复本地状态
    State.storeId = load('storeId', 'S001');
    State.approvals = load('approvals', []);
    State.uploads = load('uploads', []);
    State.qualityReports = load('qualityReports', []);
    State.analyses = load('analyses', []);
    State.auditLogs = load('auditLogs', []);
    State.modelLogs = load('modelLogs', []);
    State.settingsLogs = load('settingsLogs', []);
    State.newProducts = load('newProducts', []);
    State.privateLabelSku = load('privateLabelSku', []);
    var st = load('settings', null);
    if (st) {
      if (st.weights) State.settings.weights = st.weights;
      if (st.apriori) State.settings.apriori = Object.assign(State.settings.apriori, st.apriori);
      if (st.risk) State.settings.risk = Object.assign(State.settings.risk, st.risk);
    }
    State.dataMeta = D.meta;

    // 门店选择器
    var ss = document.getElementById('storeSel');
    ss.innerHTML = STORES.map(function (s) {
      return '<option value="' + s.id + '"' + (s.id === State.storeId ? ' selected' : '') + '>' +
        esc(s.short) + '</option>';
    }).join('');
    ss.onchange = function () {
      State.storeId = ss.value;
      save('storeId', State.storeId);
      toast('已切换门店：' + curStore().short, 'ok');
      audit('切换门店', curStore().name, '门店上下文变更');
      invalidate();
      refreshPage();
    };

    // 登录账号列表
    document.getElementById('accList').innerHTML = USERS.map(function (u, i) {
      return '<div class="acc" data-i="' + i + '">' +
        '<div class="ai">' + esc(u.name.slice(0, 1)) + '</div>' +
        '<div><div class="an">' + esc(u.name) + '</div></div>' +
        '<div class="ar">' + esc(ROLES[u.role].name) + '</div></div>';
    }).join('');
    document.getElementById('accList').onclick = function (e) {
      var el = e.target.closest('.acc'); if (!el) return;
      var u = USERS[+el.dataset.i];
      document.getElementById('lgUser').value = u.u;
      document.getElementById('lgPass').value = u.p;
      doLogin();
    };

    document.getElementById('lgBtn').onclick = doLogin;
    document.getElementById('lgPass').onkeydown = function (e) { if (e.key === 'Enter') doLogin(); };
    document.getElementById('lgUser').onkeydown = function (e) { if (e.key === 'Enter') document.getElementById('lgPass').focus(); };

    // 顶部交互
    document.getElementById('burger').onclick = function () {
      document.getElementById('nav').classList.toggle('on');
    };
    document.getElementById('mask').onclick = closeDrawer;
    document.getElementById('drClose').onclick = closeDrawer;
    document.getElementById('userChip').onclick = showMe;

    /*
     * 顶栏「备份」按钮：一件直达导出/导入（铁律 2 要求备份入口不在深层设置里）。
     * 与 userChip 一样打开「我的账号」抽屉，抽屉内含导出/导入/清空三个动作。
     */
    var topBackup = document.getElementById('topBackup');
    if (topBackup) topBackup.onclick = showMe;

    document.getElementById('navMenu').onclick = function (e) {
      var b = e.target.closest('[data-route]'); if (!b) return;
      go(b.dataset.route);
    };

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDrawer();
    });

    /*
     * 底部常驻免责声明栏：三重声明 —— 原型性质、参赛用途、数据来源。
     * 这三条必须始终同时出现，避免被误读为已上线的商业系统或真实经营数据。
     */
    document.getElementById('discText').textContent =
      '【原型演示 · 参赛作品】本平台为参加比赛而开发的软件原型（Prototype），' +
      '用于展示 AI 选品辅助决策的技术构想，尚未接入任何企业生产系统、未做商业部署。' +
      D.meta.disclaimer + ' 所有算法结果均标注来源数据集、算法名称、参数与生成时间，可完整追溯。';

    // 首次进入：预置演示数据
    seedIfEmpty();
  }

  function curStore() {
    return STORES.filter(function (s) { return s.id === State.storeId; })[0] || STORES[0];
  }

  function doLogin() {
    var u = document.getElementById('lgUser').value.trim();
    var p = document.getElementById('lgPass').value;
    var found = USERS.filter(function (x) { return x.u === u; })[0];
    var err = document.getElementById('lgErr');
    if (!found || found.p !== p) {
      err.textContent = !found ? '账号不存在，请从下方列表选择演示账号。' : '密码错误。演示账号密码均为 123456。';
      err.classList.add('on');
      return;
    }
    err.classList.remove('on');
    State.user = { u: found.u, name: found.name, role: found.role, store: found.store };
    save('user', State.user);
    document.getElementById('login').classList.add('hide');
    document.getElementById('app').classList.add('on');
    document.getElementById('uName').textContent = found.name;
    document.getElementById('uRole').textContent = ROLES[found.role].name;
    document.getElementById('uAvatar').textContent = found.name.slice(-2, -1) || found.name[0];
    audit('登录系统', '登录', '角色：' + ROLES[found.role].name);
    var r = load('route', 'dash');
    go(PAGE_TITLE[r] ? r : 'dash');
    toast('欢迎回来，' + found.name, 'ok');
  }

  /* ==================== 预置演示数据 ==================== */

  function seedIfEmpty() {
    if (load('seeded', false)) return;
    var now = Date.now();
    var H = 3600e3, Dd = 24 * H;

    // ---- 待办类：审批请求（含 1 条逾期） ----
    State.approvals = [
      {
        id: 'AP20260916001', level: 3, source: '品类健康诊断',
        title: '建议对「纺织服装」品类启动退出评估',
        advice: '纺织服装健康度 0.6 分（★☆☆☆☆ 差），12 个月累计缺货 45 次，库存周转 87.3 天、坪效 270 元/㎡/月，均为全店最低。建议启动品类退出评估，先压缩货架面积 50%，观察 2 个月后决定是否全面退出。',
        basis: [
          '健康度 0.6 分，7 个品类中排名第 7',
          '库存周转 87.3 天（健康线 45 天），资金占用最重',
          '坪效 270 元/㎡/月（全店均值 875 元/㎡/月）',
          '近 12 个月累计缺货 45 次',
          '销量贡献 4.1%、毛利贡献 8.3%，均为最低',
        ],
        cats: ['纺织服装'], priority: '高', risk: '高', needApproval: true,
        applicant: '品类经理·王涛', approver: null, status: '待审批', comment: '',
        createdAt: new Date(now - 30 * H).toISOString(),
        dueAt: new Date(now - 6 * H).toISOString(),   // 逾期
      },
      {
        id: 'AP20260916002', level: 3, source: 'AI综合选品方案',
        title: '建议精简「日化清洁」品类 SKU 数量',
        advice: '日化清洁健康度 25.4 分（★☆☆☆☆ 差），SKU 数量偏多、周转 44.3 天超健康线。建议按「高频刚需保留、低频长尾退出」原则精简 SKU 约 30%，优先保留洗发水、沐浴露、牙膏、洗衣液等高频品。',
        basis: [
          '健康度 25.4 分，排名第 5',
          '库存周转 44.3 天，超过 45 天健康线临界',
          '坪效 520 元/㎡/月，低于全店加权均值',
          '销量占比 9.8% 但 SKU 数量偏高，单 SKU 产出低',
        ],
        cats: ['日化清洁'], priority: '高', risk: '中', needApproval: true,
        applicant: '采购经理·李静', approver: null, status: '待审批', comment: '',
        createdAt: new Date(now - 20 * H).toISOString(),
        dueAt: new Date(now + 20 * H).toISOString(),
      },
      {
        id: 'AP20260916003', level: 2, source: '关联陈列分析',
        title: '建议设置「火锅食材专区」并调整关联陈列',
        advice: '基于交易数据实时重算，「丸子 → 肥牛卷」提升度 5.98、「火锅底料 → 丸子」提升度 3.15，属强关联。建议在生鲜区旁设置火锅食材专区，将火锅底料、丸子、肥牛卷集中陈列，并配套组合促销。',
        basis: [
          '丸子 → 肥牛卷：支持度 0.0416，置信度 0.5061，提升度 5.982',
          '附件参考规则：火锅底料 → 丸子 置信度 0.712，提升度 3.15',
          '火锅食材品类在交易数据中出现 2882 条明细',
        ],
        cats: ['生鲜蔬果', '肉禽蛋品'], priority: '中', risk: '低', needApproval: false,
        applicant: '品类经理·王涛', approver: '品类经理·王涛', status: '已通过',
        comment: '同意执行，先在端头试陈列两周看转化。',
        createdAt: new Date(now - 5 * Dd).toISOString(),
        dueAt: new Date(now - 3 * Dd).toISOString(),
      },
      {
        id: 'AP20260916004', level: 2, source: '需求预测',
        title: '建议对「生鲜蔬果」提前备货并核查供应商产能',
        advice: '生鲜蔬果未来 4 期需求预测均值 8488.5 件，较最近 4 期实际 7809.8 件上涨 8.7%（温和上涨）。建议提前 1 周加密订货频次，并核查主要供应商在需求高峰期的供货能力。',
        basis: [
          '未来 4 期预测均值 8488.5 件 vs 最近 4 期实际 7809.8 件',
          '环比 +8.7%，趋势判定：温和上涨',
          '近 12 个月该品类累计缺货 4 次（生鲜断货影响体验）',
        ],
        cats: ['生鲜蔬果'], priority: '中', risk: '中', needApproval: false,
        applicant: '店长·陈晓峰', approver: null, status: '待审批', comment: '',
        createdAt: new Date(now - 2 * H).toISOString(),
        dueAt: new Date(now + 2 * Dd).toISOString(),
      },
      {
        id: 'AP20260916005', level: 3, source: '选品比较中心',
        title: '建议压缩「家居用品」陈列面积',
        advice: '家居用品健康度 13.5 分（★☆☆☆☆ 差），库存周转 60 天、坪效 383 元/㎡/月，两项均显著低于健康线。建议压缩陈列面积 40%，保留清洁工具、收纳用品等核心 SKU。',
        basis: [
          '健康度 13.5 分，排名第 6',
          '库存周转 60 天，远超 45 天健康线',
          '坪效 383 元/㎡/月 vs 全店加权均值 875 元/㎡/月',
          '销量贡献仅 6.7%',
        ],
        cats: ['家居用品'], priority: '高', risk: '中', needApproval: true,
        applicant: '采购经理·李静', approver: null, status: '待审批', comment: '',
        createdAt: new Date(now - 3 * Dd).toISOString(),
        dueAt: new Date(now + 4 * Dd).toISOString(),
      },
      {
        id: 'AP20260916006', level: 2, source: 'AI综合选品方案',
        title: '建议扩大「生鲜蔬果」直采品类范围',
        advice: '生鲜蔬果健康度 100 分（★★★★★ 优秀），销量贡献 27%、坪效 1462 元/㎡/月均为全店第一。建议扩大产地直采品类范围，强化「家门口的社区厨房」定位。',
        basis: [
          '健康度 100 分，排名第 1',
          '销量贡献 27%，全店第一',
          '坪效 1462 元/㎡/月，全店第一',
          '库存周转 11.5 天，全店最快',
        ],
        cats: ['生鲜蔬果'], priority: '中', risk: '低', needApproval: false,
        applicant: '品类经理·王涛', approver: null, status: '已驳回',
        comment: '直采范围扩大需先确认冷链仓储能力，暂缓。',
        createdAt: new Date(now - 6 * Dd).toISOString(),
        dueAt: new Date(now - 4 * Dd).toISOString(),
      },
    ];

    // ---- 新品候选池示例 ----
    State.newProducts = [
      {
        id: 'NP001', name: '润家 低钠竹盐酱油 500ml', cat: 'C003', catName: '粮油调味',
        brand: '润家（自有品牌）', cost: 6.80, price: 12.90, margin: 47.3,
        supplier: '苏果自有品牌供应链', target: '社区家庭 / 中老年健康需求',
        spec: '500ml/瓶', pack: '玻璃瓶装 · 12瓶/箱', season: '全季节',
        selling: '低钠配方，契合中老年控盐健康需求，自有品牌毛利空间大',
        isPrivate: true, refSku: '海天酱油 / 六月鲜',
        createdAt: new Date(now - 7 * Dd).toISOString(),
      },
      {
        id: 'NP002', name: '自热小火锅 麻辣牛油 400g', cat: 'C004', catName: '食品饮料',
        brand: '莫小仙', cost: 8.50, price: 15.90, margin: 46.5,
        supplier: '南京快消品贸易有限公司', target: '上班族 / 学生',
        spec: '400g/盒', pack: '盒装 · 24盒/箱', season: '秋冬旺季',
        selling: '契合已识别的「火锅聚餐场景」，与现有火锅食材形成场景互补',
        isPrivate: false, refSku: '自嗨锅 / 海底捞自热',
        createdAt: new Date(now - 4 * Dd).toISOString(),
      },
    ];

    // 默认管理员登录态为空，需手动登录

    save('approvals', State.approvals);
    save('newProducts', State.newProducts);
    save('seeded', true);
    save('settings', State.settings);
  }

  /* ==================== 我的信息 ==================== */

  function showMe() {
    var u = State.user;
    var r = ROLES[u.role];
    var body =
      '<div class="grid g2" style="margin-bottom:14px">' +
      '<div class="card"><div class="card-b">' +
      '<div style="font-size:11px;color:var(--ink-3);margin-bottom:4px">当前账号</div>' +
      '<div style="font-size:16px;font-weight:700">' + esc(u.name) + '</div>' +
      '<div style="font-size:12px;color:var(--ink-3);margin-top:3px">登录名：' + esc(u.u) + '</div>' +
      '</div></div>' +
      '<div class="card"><div class="card-b">' +
      '<div style="font-size:11px;color:var(--ink-3);margin-bottom:4px">角色</div>' +
      '<div style="font-size:16px;font-weight:700">' + esc(r.name) + '</div>' +
      '<div style="font-size:12px;color:var(--ink-3);margin-top:3px">' + esc(r.desc) + '</div>' +
      '</div></div></div>' +
      '<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>' + icon('shield') + '权限清单</h3></div>' +
      '<div class="card-b"><div style="display:flex;gap:6px;flex-wrap:wrap">' +
      (r.perms[0] === '*' ? '<span class="chip brand">全部权限</span>' :
        r.perms.map(function (p) {
          var nm = { dash: '驾驶舱', compare: '选品比较', health: '品类诊断', assoc: '关联分析', forecast: '需求预测', deeplink: '千店千面', privateLabel: '自有品牌', newProduct: '新品评估', ai: 'AI助手', data: '数据中心', approval: '审批中心' }[p] || p;
          return '<span class="chip gray">' + esc(nm) + '</span>';
        }).join('')) +
      '</div></div></div>' +
      '<div class="card"><div class="card-h"><h3>' + icon('data') + '数据存储</h3></div><div class="card-b">' +
      '<div style="font-size:12.5px;line-height:1.8;color:var(--ink-2)">' +
      '本演示版数据保存在浏览器 <code>localStorage</code>（键前缀 <code>wb_suguo_</code>），刷新或关闭页面不丢失。<br>' +
      '清除浏览器数据会导致本地记录丢失，建议定期导出备份。' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:13px;flex-wrap:wrap">' +
      '<button class="btn" data-act="me-export">' + icon('download') + '导出全部数据（JSON）</button>' +
      '<button class="btn" data-act="me-import">' + icon('upload') + '导入恢复</button>' +
      '<button class="btn danger" data-act="me-clear">' + icon('trash') + '清空本地数据</button>' +
      '</div></div></div>';

    openDrawer('我的账号', body, '<button class="btn" data-act="dr-cancel">关闭</button>');
    document.getElementById('drFoot').onclick = function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'dr-cancel') closeDrawer();
    };
    document.getElementById('drBody').onclick = function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'me-export') exportAll();
      if (b.dataset.act === 'me-import') importAll();
      if (b.dataset.act === 'me-clear') clearAll();
    };
  }

  function exportAll() {
    var payload = {
      _meta: { app: '苏果智选', version: '1.0', exportedAt: nowStr(), user: State.user ? State.user.name : '-' },
      approvals: State.approvals, newProducts: State.newProducts,
      uploads: State.uploads, qualityReports: State.qualityReports,
      analyses: State.analyses, auditLogs: State.auditLogs,
      modelLogs: State.modelLogs, settingsLogs: State.settingsLogs,
      settings: State.settings, privateLabelSku: State.privateLabelSku,
    };
    var txt = JSON.stringify(payload, null, 2);
    download('苏果智选_数据备份_' + nowStr().replace(/[-: ]/g, '') + '.json', txt, 'application/json');
    audit('导出数据备份', '全部业务数据', '共 ' + (State.approvals.length + State.newProducts.length) + ' 条记录');
    persist();
    toast('数据备份已导出（' + (txt.length / 1024).toFixed(1) + ' KB）', 'ok');
  }

  function importAll() {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = function () {
      var f = inp.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var d = JSON.parse(fr.result);
          var n = 0;
          ['approvals', 'newProducts', 'uploads', 'qualityReports', 'analyses',
            'auditLogs', 'modelLogs', 'settingsLogs', 'privateLabelSku'].forEach(function (k) {
            if (Array.isArray(d[k])) { State[k] = d[k]; n += d[k].length; }
          });
          if (d.settings) State.settings = Object.assign(State.settings, d.settings);
          audit('导入数据恢复', f.name, '恢复 ' + n + ' 条记录');
          persist(); invalidate(); refreshPage(); closeDrawer();
          toast('已恢复 ' + n + ' 条记录', 'ok');
        } catch (e) {
          toast('导入失败：文件格式不正确', 'err');
        }
      };
      fr.readAsText(f);
    };
    inp.click();
  }

  function clearAll() {
    confirmDialog('清空本地数据',
      '将删除本机保存的全部审批记录、上传记录、分析历史、操作日志与算法参数设置，' +
      '并恢复为初始演示数据。<br><br><b>此操作不可撤销。</b>建议先导出备份。',
      function () {
        var keys = ['approvals', 'newProducts', 'uploads', 'qualityReports', 'analyses',
          'auditLogs', 'modelLogs', 'settingsLogs', 'privateLabelSku', 'settings', 'seeded', 'route'];
        keys.forEach(function (k) { localStorage.removeItem(LS + k); });
        State.approvals = []; State.newProducts = []; State.uploads = [];
        State.qualityReports = []; State.analyses = []; State.auditLogs = [];
        State.modelLogs = []; State.settingsLogs = []; State.privateLabelSku = [];
        State.settings = {
          weights: { qty: 30, gp: 30, turnover: 20, space: 20 },
          apriori: { minSupport: 0.02, minConfidence: 0.50, minLift: 1.50, topN: 20, aggregateBy: 'name' },
          forecast: { horizon: 4, minHistory: 12 },
          risk: { turnoverDays: 45, spaceEff: 400, stockout: 4, healthScore: 55 },
        };
        seedIfEmpty();
        invalidate(); refreshPage(); closeDrawer();
        toast('本地数据已清空并重置为初始演示数据', 'ok');
      }, '确认清空');
  }

  /* ==================== 导出 ==================== */

  global.App = {
    State: State, ROLES: ROLES, USERS: USERS, STORES: STORES, MENU: MENU, PAGE_TITLE: PAGE_TITLE,
    boot: boot, go: go, refreshPage: refreshPage, renderNav: renderNav, renderPage: renderPage,
    can: can, canPerm: canPerm, curStore: curStore,
    icon: icon, iconFill: iconFill, SVG: SVG, ICON: ICON,
    fmtNum: fmtNum, fmtMoney: fmtMoney, fmtPct: fmtPct, fmtScore: fmtScore, esc: esc,
    diff: diff, uid: uid, nowStr: nowStr,
    toast: toast, openDrawer: openDrawer, closeDrawer: closeDrawer, confirmDialog: confirmDialog,
    emptyState: emptyState, insufficient: insufficient,
    download: download, toCSV: toCSV, parseCSV: parseCSV,
    getHealth: getHealth, getAssoc: getAssoc, getDash: getDash, getPlan: getPlan,
    invalidate: invalidate, persist: persist, audit: audit, modelRun: modelRun,
    exportAll: exportAll, importAll: importAll, clearAll: clearAll, showMe: showMe, setSync: setSync,
    save: save, load: load, LS: LS,
  };
})(window);
