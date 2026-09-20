/* ============================================================================
 * 苏果智选 · 后台 API 适配层 (app-api.js)
 * ----------------------------------------------------------------------------
 * 职责：把单文件版的「内联数据集」切换为「FastAPI 后台数据集」。
 *
 * 架构约束（铁律 9）：本文件**不调用任何渲染函数**，只做三件事：
 *   1. 替换数据层（window.SUGUO_DATA 的 sales / forecast）
 *   2. 覆写数据访问器（App.getAssoc —— 交易量大，关联规则由后台算好取回）
 *   3. 调用 App.invalidate() + App.refreshPage()，由后者统一调度重渲染
 *
 * 为什么不在后台重算健康度：
 *   算法层是纯函数，前后端实现等价（已由 pytest 第 5 项逐项对照验证）。
 *   因此数据从后台来、算法在客户端算，既拿到真实数据接入，
 *   又保留了参数（权重）即时调整的交互体验。
 *
 * 降级策略：后台不可用时页面自动回退到内联数据，功能不受影响。
 * ==========================================================================*/
(function (global) {
  'use strict';

  var LS_KEY = 'wb_suguo_api_cfg';
  var DEFAULT_BASE = 'http://127.0.0.1:8000';

  var Api = {
    connected: false,
    baseUrl: DEFAULT_BASE,
    username: '',
    token: '',
    lastSync: null,
    lastError: null,
    remoteAssoc: null,
    parity: null,
    _installed: false,
    _orig: {},
    _backup: null
  };

  /* ------------------------------ 配置读写 ------------------------------ */

  function loadCfg() {
    try {
      return JSON.parse(global.localStorage.getItem(LS_KEY) || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function saveCfg(c) {
    try {
      global.localStorage.setItem(LS_KEY, JSON.stringify(c));
    } catch (e) { /* 隐私模式下 localStorage 可能不可写，忽略 */ }
  }

  function clearCfg() {
    try {
      global.localStorage.removeItem(LS_KEY);
    } catch (e) { /* 同上 */ }
  }

  /* ------------------------------ HTTP 封装 ------------------------------ */

  function request(path, opts) {
    opts = opts || {};
    if (typeof global.fetch !== 'function') {
      return Promise.reject(new Error('当前运行环境不支持 fetch，无法连接后台。'));
    }
    var url = Api.baseUrl.replace(/\/+$/, '') + path;
    var headers = { 'Content-Type': 'application/json' };
    if (Api.token) headers.Authorization = 'Bearer ' + Api.token;

    return global.fetch(url, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = JSON.parse(text); } catch (e) { /* 非 JSON 响应 */ }
        if (!res.ok) {
          var msg = (data && (data.detail || data.message)) || ('HTTP ' + res.status);
          var err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  /* --------------------- 数据层切换（唯一改动数据的地方） --------------------- */

  function backupOnce() {
    if (Api._backup) return;
    var D = global.SUGUO_DATA;
    if (!D) return;
    Api._backup = {
      sales: D.sales,
      forecast: D.forecast,
      categories: D.categories
    };
  }

  function applyDataset(payload) {
    var D = global.SUGUO_DATA;
    if (!D || !payload) return;

    // 字段名从后端 snake_case 映射回前端算法层约定，数值不做任何加工
    D.sales = (payload.sales || []).map(function (r) {
      return {
        cid: r.cid,
        name: r.name,
        month: r.month,
        qty: r.qty,
        amt: r.amt,
        gp: r.gp,
        turnoverDays: r.turnover_days,
        spaceEff: r.space_eff,
        stockout: r.stockout,
        skuCount: r.sku_count
      };
    });

    D.forecast = (payload.forecast || []).map(function (f) {
      return {
        cat: f.cat,
        points: (f.points || []).map(function (p) {
          return {
            week: p.week, label: p.label, hist: p.hist, fc: p.fc,
            lo: p.lo, hi: p.hi, type: p.type
          };
        })
      };
    });

    if (payload.categories && payload.categories.length) {
      D.categories = payload.categories.map(function (c) {
        return { id: c.id, code: c.code, name: c.name, role: c.role };
      });
    }
  }

  function restoreDataset() {
    var D = global.SUGUO_DATA;
    if (!D || !Api._backup) return;
    D.sales = Api._backup.sales;
    D.forecast = Api._backup.forecast;
    D.categories = Api._backup.categories;
  }

  function install() {
    var App = global.App;
    if (!App || Api._installed) return;
    Api._orig.getAssoc = App.getAssoc;

    // 关联规则依赖 22022 条交易明细，不适合下发到前端，
    // 因此改由后台算好后取回；其余模块在客户端用等价算法重算。
    App.getAssoc = function (force) {
      if (Api.connected && Api.remoteAssoc && !force) return Api.remoteAssoc;
      return Api._orig.getAssoc.apply(App, arguments);
    };

    Api._installed = true;
  }

  function uninstall() {
    var App = global.App;
    if (!App || !Api._installed) return;
    App.getAssoc = Api._orig.getAssoc;
    Api._installed = false;
  }

  function refreshUI() {
    var App = global.App;
    if (App && typeof App.invalidate === 'function') App.invalidate();
    if (App && typeof App.refreshPage === 'function') App.refreshPage();
    updateBadge();
  }

  /* ------------------------------ 状态角标 ------------------------------ */

  function updateBadge() {
    var badge = document.getElementById('syncBadge');
    if (!badge) return;
    var tx = badge.querySelector('.tx');
    if (!tx) return;
    if (Api.connected) {
      tx.textContent = '后台已连接';
      badge.setAttribute('title',
        '数据来源：FastAPI 后台 ' + Api.baseUrl + '（登录账号 ' + Api.username + '）\n' +
        '最近同步：' + (Api.lastSync || '—'));
    } else {
      tx.textContent = '本地存储';
      badge.setAttribute('title', '当前使用内联数据集（离线模式）');
    }
  }

  /* ------------------------------ 一致性对照 ------------------------------ */

  function runParity(localHealth, remoteHealth) {
    if (!localHealth || !localHealth.ok || !remoteHealth || !remoteHealth.ok) return null;
    var remoteByName = {};
    remoteHealth.items.forEach(function (i) { remoteByName[i.name] = i.score; });

    var rows = [];
    var maxDiff = 0;
    localHealth.items.forEach(function (i) {
      var remote = remoteByName[i.name];
      if (remote === undefined) return;
      var diff = Math.abs(i.score - remote);
      if (diff > maxDiff) maxDiff = diff;
      rows.push({ name: i.name, local: i.score, remote: remote, diff: Math.round(diff * 100) / 100 });
    });
    return { rows: rows, maxDiff: Math.round(maxDiff * 100) / 100 };
  }

  /* ------------------------------ 连接 / 断开 ------------------------------ */

  function connect(baseUrl, username, password) {
    Api.baseUrl = (baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
    Api.lastError = null;

    // 一致性对照必须在切换数据层之前完成：用「原始内联数据」的本地结果
    // 与「后台数据」的后台结果比对，才能证明两套实现等价。
    var localHealth = null;
    try {
      if (global.Algo) localHealth = global.Algo.computeCategoryHealth({});
    } catch (e) { /* 本地算法不可用时跳过对照 */ }

    return request('/api/v1/auth/login', {
      method: 'POST',
      body: { username: username, password: password }
    }).then(function (login) {
      Api.token = login.access_token;
      Api.username = (login.user && login.user.username) || username;

      return Promise.all([
        request('/api/v1/data/algo-dataset'),
        request('/api/v1/analysis/apriori', {
          method: 'POST',
          body: {
            min_support: 0.02, min_confidence: 0.5, min_lift: 1.5,
            top_n: 30, aggregate_by: 'name'
          }
        }),
        request('/api/v1/analysis/health', { method: 'POST', body: { months: 12 } })
      ]);
    }).then(function (res) {
      var dataset = res[0], apriori = res[1], remoteHealth = res[2];

      backupOnce();
      install();
      Api.remoteAssoc = apriori;
      Api.parity = runParity(localHealth, remoteHealth);
      applyDataset(dataset);

      Api.connected = true;
      Api.lastSync = new Date().toLocaleString('zh-CN', { hour12: false });
      saveCfg({
        baseUrl: Api.baseUrl, username: Api.username,
        token: Api.token, savedAt: Api.lastSync
      });

      refreshUI();
      return {
        ok: true,
        dataRows: (dataset.sales || []).length,
        forecastGroups: (dataset.forecast || []).length,
        rules: (apriori.rules || []).length,
        parity: Api.parity
      };
    }).catch(function (err) {
      Api.connected = false;
      Api.token = '';
      Api.lastError = err.message || String(err);
      updateBadge();
      throw err;
    });
  }

  function disconnect() {
    var backup = Api._backup;
    Api.connected = false;
    Api.token = '';
    Api.remoteAssoc = null;
    Api.parity = null;
    Api.lastSync = null;
    uninstall();
    restoreDataset();
    // restoreDataset 依赖 _backup，恢复后即可释放
    Api._backup = backup;
    clearCfg();
    refreshUI();
    return { ok: true };
  }

  /* -------------------------- 启动时自动重连（可选） -------------------------- */

  function autoConnect() {
    var cfg = loadCfg();
    if (!cfg.baseUrl || !cfg.token) return;   // 从未连接过 → 保持离线模式
    Api.baseUrl = cfg.baseUrl;
    Api.username = cfg.username || '';
    Api.token = cfg.token;

    var localHealth = null;
    try {
      if (global.Algo) localHealth = global.Algo.computeCategoryHealth({});
    } catch (e) { /* 忽略 */ }

    Promise.all([
      request('/api/v1/data/algo-dataset'),
      request('/api/v1/analysis/apriori', {
        method: 'POST',
        body: { min_support: 0.02, min_confidence: 0.5, min_lift: 1.5, top_n: 30, aggregate_by: 'name' }
      }),
      request('/api/v1/analysis/health', { method: 'POST', body: { months: 12 } })
    ]).then(function (res) {
      backupOnce();
      install();
      Api.remoteAssoc = res[1];
      Api.parity = runParity(localHealth, res[2]);
      applyDataset(res[0]);
      Api.connected = true;
      Api.lastSync = new Date().toLocaleString('zh-CN', { hour12: false });
      refreshUI();
    }).catch(function () {
      // 令牌过期或后台未启动：静默回退到离线模式，不打断用户
      Api.connected = false;
      Api.token = '';
      updateBadge();
    });
  }

  /* ------------------------------ 连接面板 ------------------------------ */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parityTable() {
    if (!Api.parity || !Api.parity.rows.length) {
      return '<p class="api-note">未生成一致性对照（本地算法不可用或后台未返回健康度结果）。</p>';
    }
    var rows = Api.parity.rows.map(function (r) {
      return '<tr><td>' + esc(r.name) + '</td>' +
        '<td class="num">' + r.local + '</td>' +
        '<td class="num">' + r.remote + '</td>' +
        '<td class="num">' + r.diff.toFixed(2) + '</td></tr>';
    }).join('');
    var verdict = Api.parity.maxDiff < 0.5
      ? '<span class="api-ok">两套独立实现结果一致（最大偏差 ' + Api.parity.maxDiff + ' 分）</span>'
      : '<span class="api-warn">存在偏差，最大 ' + Api.parity.maxDiff + ' 分，请核对算法参数</span>';
    return '<table class="api-table"><thead><tr>' +
      '<th>品类</th><th>本地（内联数据）</th><th>后台（接口数据）</th><th>偏差</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' + verdict;
  }

  function panelHtml() {
    var status = Api.connected
      ? '<div class="api-status ok">已连接 · ' + esc(Api.baseUrl) + ' · 账号 ' + esc(Api.username) +
        ' · 同步于 ' + esc(Api.lastSync) + '</div>'
      : (Api.lastError
        ? '<div class="api-status err">连接失败：' + esc(Api.lastError) + '</div>'
        : '<div class="api-status">当前为离线模式，使用内联数据集。</div>');

    return '' +
      '<div class="api-title">后台服务连接（FastAPI）</div>' +
      status +
      '<div class="api-form">' +
      '<label>服务地址<input id="apiBase" type="text" value="' + esc(Api.baseUrl) + '" placeholder="http://127.0.0.1:8000"></label>' +
      '<label>账号<input id="apiUser" type="text" value="' + esc(Api.username || 'admin') + '"></label>' +
      '<label>密码<input id="apiPass" type="password" value="" placeholder="演示账号密码 123456"></label>' +
      '</div>' +
      '<div class="api-actions">' +
      '<button class="api-btn primary" id="apiConnect">连接后台</button>' +
      '<button class="api-btn" id="apiDisconnect"' + (Api.connected ? '' : ' disabled') + '>断开并回到离线</button>' +
      '<button class="api-btn ghost" id="apiClose">关闭</button>' +
      '</div>' +
      '<div class="api-section"><div class="api-h">前后端算法一致性对照</div>' + parityTable() + '</div>' +
      '<p class="api-note">连接后：品类销售与需求预测数据来自后台接口，健康度、比较、趋势在客户端用等价算法实时重算；' +
      '关联规则因依赖 2.2 万条交易明细，由后台计算后取回。后台不可用时自动回退到内联数据集。</p>';
  }

  var panelEl = null;

  function closePanel() {
    if (panelEl && panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);
    panelEl = null;
  }

  function bindPanel(host) {
    var btnC = host.querySelector('#apiConnect');
    var btnD = host.querySelector('#apiDisconnect');
    var btnX = host.querySelector('#apiClose');

    if (btnC) btnC.onclick = function () {
      var base = (host.querySelector('#apiBase').value || '').trim();
      var user = (host.querySelector('#apiUser').value || '').trim();
      var pass = host.querySelector('#apiPass').value || '';
      if (!user || !pass) {
        host.querySelector('.api-status').className = 'api-status err';
        host.querySelector('.api-status').textContent = '请填写账号与密码。';
        return;
      }
      btnC.disabled = true;
      btnC.textContent = '连接中…';
      connect(base, user, pass).then(function (r) {
        renderPanel();
        if (global.App && global.App.toast) {
          global.App.toast('已连接后台，数据已切换（销售 ' + r.dataRows + ' 行 / 规则 ' + r.rules + ' 条）', 'ok');
        }
      }).catch(function () {
        renderPanel();
      });
    };

    if (btnD) btnD.onclick = function () {
      disconnect();
      renderPanel();
      if (global.App && global.App.toast) global.App.toast('已断开后台，回到离线模式', 'ok');
    };

    if (btnX) btnX.onclick = closePanel;
  }

  function renderPanel() {
    closePanel();
    if (!document.body) return;
    var overlay = document.createElement('div');
    overlay.className = 'api-overlay';
    var box = document.createElement('div');
    box.className = 'api-panel';
    box.innerHTML = panelHtml();
    overlay.appendChild(box);
    overlay.onclick = function (e) { if (e.target === overlay) closePanel(); };
    document.body.appendChild(overlay);
    panelEl = overlay;
    bindPanel(box);
    var first = box.querySelector('#apiPass');
    if (first) { try { first.focus(); } catch (e) { /* 忽略 */ } }
  }

  /* ------------------------------ 对外接口 ------------------------------ */

  Api.connect = connect;
  Api.disconnect = disconnect;
  Api.autoConnect = autoConnect;
  Api.openPanel = renderPanel;
  Api.closePanel = closePanel;
  Api.status = function () {
    return {
      connected: Api.connected, baseUrl: Api.baseUrl, username: Api.username,
      lastSync: Api.lastSync, error: Api.lastError, parity: Api.parity
    };
  };

  global.SuguoApi = Api;

  /* ------------------------------ 初始化 ------------------------------ */

  function init() {
    var btn = document.getElementById('topApi');
    if (btn) btn.onclick = renderPanel;
    updateBadge();
    autoConnect();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : this);
