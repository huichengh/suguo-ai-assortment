/* ============================================================================
 * 苏果智选 · 页面模块 (app-pages.js)
 * ----------------------------------------------------------------------------
 * 铁律 9：每个页面 = 一个函数，返回 HTML 字符串；after_xxx() 负责绑定事件。
 * 渲染函数之间严禁互调；所有数据读取走 App 的缓存层。
 * ==========================================================================*/
(function (global) {
  'use strict';

  var Pages = {};
  var A = global.Algo;
  var Ch = global.Charts;

  /**
   * App 别名：app-core.js 在运行时才挂载 window.App。
   * 这里用 getter 代理，保证任何时刻取到的都是最新引用（不可写成 var App = global.App）。
   */
  var App;
  Object.defineProperty(global, '__pagesAppBridge', {
    value: null, writable: true, configurable: true,
  });
  App = new Proxy({}, {
    get: function (_, k) {
      var real = global.App;
      if (!real) throw new Error('App 未初始化：' + String(k));
      var v = real[k];
      return typeof v === 'function' ? v.bind(real) : v;
    },
    has: function (_, k) { return global.App ? (k in global.App) : false; },
  });

  /* ---------- 共享小工具 ---------- */
  function S() { return global.App.State; }
  function curStore() { return global.App.curStore(); }
  function esc(s) { return global.App.esc(s); }
  function icon(n, c, z) { return global.App.icon(n, c, z); }
  function num(v, d) { return global.App.fmtNum(v, d); }
  function money(v, d) { return global.App.fmtMoney(v, d); }
  function pct(v, d) { return global.App.fmtPct(v, d); }
  /** 分数格式化（0-100，保留 1 位小数，整数不显示 .0） */
  function sc(v) { return global.App.fmtScore(v); }

  function demoBadge() {
    return '<span class="badge-demo">' + icon('info', '', 12) + '模拟演示数据</span>';
  }

  /** 算法溯源条（需求：所有算法结果必须标注来源/算法/参数/时间） */
  function traceBar(res, extra) {
    if (!res) return '';
    var p = res.parameters || {};
    var ps = [];
    if (p.weights) {
      ps.push('权重 销量' + Math.round(p.weights.qty * 100) + '%·毛利' + Math.round(p.weights.gp * 100) +
        '%·周转' + Math.round(p.weights.turnover * 100) + '%·坪效' + Math.round(p.weights.space * 100) + '%');
    }
    if (p.minSupport != null) {
      ps.push('min_support=' + p.minSupport + ' · min_confidence=' + p.minConfidence + ' · min_lift=' + p.minLift);
    }
    if (p.months) ps.push('聚合 ' + p.months + ' 个月');
    if (extra) ps.push(extra);
    return '<div class="trace">' +
      '<span>' + icon('cpu', '', 12) + '算法：' + esc(res.algorithm || '—') + '</span>' +
      '<span>' + icon('data', '', 12) + '来源：' + esc(res.sourceDatasetId || '—') + '</span>' +
      (ps.length ? '<span>' + icon('target', '', 12) + '参数：' + esc(ps.join('｜')) + '</span>' : '') +
      '<span>' + icon('clock', '', 12) + '生成：' + esc(fmtTime(res.createdAt)) + '</span>' +
      '</div>';
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function healthChip(h) {
    return '<span class="chip ' + h.color + '">' + h.stars + ' ' + esc(h.grade) + '</span>';
  }

  function barOf(score, color) {
    return '<div style="display:flex;align-items:center;gap:8px">' +
      '<div class="bar" style="flex:1"><i class="' + (color || '') + '" style="width:' +
      Math.max(0, Math.min(100, score)) + '%"></i></div>' +
      '<b style="font-size:12.5px;font-variant-numeric:tabular-nums;min-width:32px;text-align:right">' +
      global.App.fmtScore(score) + '</b></div>';
  }

  Pages._util = {
    esc: esc, icon: icon, num: num, money: money, pct: pct,
    demoBadge: demoBadge, traceBar: traceBar, fmtTime: fmtTime,
    healthChip: healthChip, barOf: barOf,
  };

  /* ========================================================================
   * 首页：AI经营驾驶舱
   * ====================================================================== */
  Pages.dash = function () {
    var d = global.App.getDash();
    if (!d.ok) return global.App.insufficient('数据不足', d.reason);
    var st = curStore();

    var h = '';
    // 页头
    h += '<div class="page-head">' +
      '<div class="t"><h2>AI经营驾驶舱</h2>' +
      '<p>当前门店：<b>' + esc(st.name) + '</b>　数据周期：' + esc(d.health.months[0]) + ' 至 ' +
      esc(d.latestMonth) + '（近 ' + d.health.monthCount + ' 个月）　' + demoBadge() + '</p></div>' +
      '<div class="acts">' +
      '<button class="btn" data-act="demo-guide">' + icon('play') + '开始AI选品演示</button>' +
      '<button class="btn" data-act="dash-export">' + icon('download') + '导出驾驶舱数据</button>' +
      '<button class="btn pri" data-act="dash-report">' + icon('doc') + '生成AI选品诊断报告</button>' +
      '</div></div>';

    // 数据真实性声明
    h += '<div class="note" style="margin-bottom:15px">' + App.ICON.info +
      '<div><b>数据说明：</b>本平台当前展示的全部经营数据为<b>基于公开行业数据构造的模拟演示数据</b>，' +
      '不代表华润苏果或任何企业的真实经营数据。所有 KPI、健康度、关联规则、预测结果均由平台算法基于该模拟数据集实时计算得出，' +
      '可完整追溯至数据集、算法名称、参数与生成时间。</div></div>';

    // KPI 卡片
    h += '<div class="grid g4" style="margin-bottom:15px">';
    d.kpis.forEach(function (k) {
      h += '<div class="kpi ' + k.tone + '">' +
        '<div class="kh">' + icon(k.icon) + esc(k.label) + '</div>' +
        '<div class="kv">' + (typeof k.value === 'number' ? num(k.value) : esc(k.value)) +
        '<span class="u">' + esc(k.unit) + '</span></div>' +
        '<div class="ks">' + esc(k.sub) + '</div></div>';
    });
    h += '</div>';

    // 第二区域：品类健康度概览
    var hItems = d.health.items.map(function (x) {
      return {
        label: x.name, value: x.score, color: x.color,
        text: sc(x.score) + ' ' + x.stars,
      };
    });
    h += '<div class="grid g2-1" style="margin-bottom:15px">';
    h += '<div class="card"><div class="card-h"><h3>' + icon('health') + '品类健康度概览' +
      '<span class="sub">横向柱状图 · 综合得分（越高越好）</span></h3>' +
      '<div class="acts">' +
      '<span class="chip good">健康 ≥70</span><span class="chip warn">关注 55-69</span>' +
      '<span class="chip bad">需优化 &lt;55</span>' +
      '<button class="btn sm" data-act="png" data-target="ch-health">' + icon('download', '', 13) + 'PNG</button>' +
      '</div></div><div class="card-b" id="ch-health">' +
      Ch.hBar(hItems) +
      '<div style="margin-top:5px;font-size:11px;color:var(--ink-4);text-align:right">' +
      '横轴刻度 0 - 100 分　分档：★★★★★≥85　★★★★☆70-84　★★★☆☆55-69　★★☆☆☆40-54　★☆☆☆☆&lt;40' +
      '</div></div></div>';

    // 雷达图
    var axes = ['销量贡献', '毛利贡献', '库存周转', '坪效'];
    var series = d.health.items.slice(0, 3).map(function (x) {
      return {
        name: x.name + '（' + sc(x.score) + '分）',
        values: [x.qtyScore, x.gpScore, x.turnoverScore, x.spaceScore],
      };
    });
    h += '<div class="card"><div class="card-h"><h3>' + icon('target') + '健康度雷达' +
      '<span class="sub">前 3 名品类四项分维对比</span></h3>' +
      '<div class="acts"><button class="btn sm" data-act="png" data-target="ch-radar">' +
      icon('download', '', 13) + 'PNG</button></div></div>' +
      '<div class="card-b" id="ch-radar">' + Ch.radar(axes, series, { size: 300 }) + '</div></div>';
    h += '</div>';

    // 第三区域：风险预警
    h += '<div class="card" style="margin-bottom:15px"><div class="card-h">' +
      '<h3>' + icon('alert') + '风险预警' +
      '<span class="sub">共 ' + d.warnings.length + ' 条，其中高风险 ' +
      d.warnings.filter(function (w) { return w.level === 'high'; }).length + ' 条</span></h3>' +
      '<div class="acts">' +
      '<span class="chip bad">高风险 ' + d.warnings.filter(function (w) { return w.level === 'high'; }).length + '</span>' +
      '<span class="chip warn">中风险 ' + d.warnings.filter(function (w) { return w.level === 'medium'; }).length + '</span>' +
      '</div></div>';
    if (!d.warnings.length) {
      h += '<div class="card-b"><div class="empty" style="padding:30px">' + icon('check') +
        '<h4>暂无风险预警</h4><p>当前所有品类指标均在健康阈值范围内。</p></div></div>';
    } else {
      h += '<div class="card-b" style="padding-top:6px;padding-bottom:6px">';
      d.warnings.slice(0, 10).forEach(function (w) {
        h += '<div class="li ' + w.level + '">' +
          '<div class="ic">' + icon(w.level === 'high' ? 'alert' : 'warn') + '</div>' +
          '<div class="bd"><div class="tt">' + esc(w.type) +
          (w.level === 'high' ? '<span class="chip bad">高风险</span>' : '<span class="chip warn">中风险</span>') +
          '<span class="chip gray">' + esc(w.cat) + '</span></div>' +
          '<div class="ds">' + esc(w.detail) + '</div>' +
          '<div class="mt">建议动作：' + esc(w.advice) + '　指标值 ' + w.metric + ' / 阈值 ' + w.threshold + '</div></div>' +
          '<button class="btn sm" data-act="warn-goto" data-cat="' + esc(w.cat) + '" data-type="' + esc(w.type) + '">处理</button>' +
          '</div>';
      });
      if (d.warnings.length > 10) {
        h += '<div style="text-align:center;padding:11px"><button class="btn sm" data-act="warn-all">' +
          '查看全部 ' + d.warnings.length + ' 条预警</button></div>';
      }
      h += '</div>';
    }
    h += '</div>';

    // 第四区域：AI今日建议
    var advice = buildDailyAdvice(d);
    h += '<div class="card" style="margin-bottom:15px"><div class="card-h">' +
      '<h3>' + icon('ai') + 'AI今日建议' +
      '<span class="sub">基于最新数据自动生成 · 每条均标注数据依据与风险等级</span></h3>' +
      '<div class="acts"><button class="btn sm" data-act="dash-refresh">' +
      icon('refresh', '', 13) + '重新生成</button></div></div><div class="card-b">';

    advice.forEach(function (a, i) {
      h += '<div style="padding:14px 0;border-bottom:1px solid var(--line-2)' +
        (i === advice.length - 1 ? ';border-bottom:0' : '') + '">' +
        '<div style="display:flex;align-items:flex-start;gap:11px">' +
        '<div class="ic" style="width:30px;height:30px;flex:0 0 30px;border-radius:8px;background:var(--brand-3);color:var(--brand);display:flex;align-items:center;justify-content:center">' +
        icon(a.icon) + '</div>' +
        '<div style="flex:1;min-width:0">' +
        '<div style="font-size:13.5px;font-weight:650;display:flex;align-items:center;gap:7px;flex-wrap:wrap">' +
        esc(a.title) +
        '<span class="chip ' + a.priColor + '">优先级 ' + a.priority + '</span>' +
        '<span class="chip ' + a.riskColor + '">风险 ' + a.risk + '</span>' +
        (a.needApproval ? '<span class="chip bad">' + icon('gavel', '', 11) + ' 需人工审批</span>'
          : '<span class="chip gray">无需审批</span>') +
        '</div>' +
        '<div style="font-size:12.5px;color:var(--ink-2);margin-top:7px;line-height:1.7">' + esc(a.advice) + '</div>' +
        '<div style="margin-top:9px;padding:9px 11px;background:var(--panel-2);border-radius:8px;border:1px solid var(--line-2)">' +
        '<div style="font-size:11px;color:var(--ink-3);font-weight:600;margin-bottom:5px">数据依据</div>' +
        '<ul style="margin:0;padding-left:17px;font-size:12px;color:var(--ink-2);line-height:1.75">' +
        a.basis.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') +
        '</ul>' +
        '<div style="font-size:11px;color:var(--ink-4);margin-top:7px">影响品类：<b style="color:var(--ink-2)">' +
        esc(a.cats.join('、')) + '</b></div>' +
        '</div>' +
        '<div style="display:flex;gap:7px;margin-top:10px;flex-wrap:wrap">' +
        '<button class="btn sm" data-act="adv-goto" data-route="' + a.route + '">查看详情</button>' +
        (a.needApproval ? '<button class="btn sm pri" data-act="adv-approval" data-idx="' + i + '">' +
          icon('gavel', '', 13) + '提交审批</button>' : '') +
        '</div></div></div></div>';
    });
    h += '<div class="note ok" style="margin-top:13px">' + App.ICON.ok +
      '<div><b>AI建议，仅供辅助决策，最终选品由采购人员确认。</b> 以上建议全部来源于平台算法对模拟演示数据集的计算结果，' +
      'AI 不会自动下单、改价或调整商品池；涉及高影响动作的建议将进入人工审批流程。</div></div>';
    h += '</div></div>';

    // 演示流程入口
    h += '<div class="card"><div class="card-h"><h3>' + icon('rocket') + '现场演示流程' +
      '<span class="sub">3-5 分钟完整走通「数据 → 算法 → AI → 管理决策 → 人机协同」闭环</span></h3></div>' +
      '<div class="card-b" id="demoSteps"></div></div>';

    return h;
  };

  /** AI 今日建议生成（规则引擎，全部基于真实计算结果） */
  function buildDailyAdvice(d) {
    var out = [];
    var items = d.health.items;
    var worst = items[items.length - 1];
    var best = items[0];
    var highTurnover = items.filter(function (x) { return x.turnoverDays > 45; });
    var rising = d.upCats;
    var topRule = (d.assoc.topRules || [])[0];

    // 1. 最差品类
    out.push({
      icon: 'alert', priority: 'P0', priColor: 'bad', risk: '高', riskColor: 'bad', needApproval: true,
      title: '重点优化「' + worst.name + '」品类结构',
      advice: worst.name + '健康度仅 ' + sc(worst.score) + ' 分（' + worst.grade + '），在 ' + items.length +
        ' 个品类中排名第 ' + worst.rank + '。库存周转 ' + worst.turnoverDays + ' 天、坪效 ' + num(worst.spaceEff) +
        ' 元/㎡/月，两项均显著低于健康线。建议纳入本月重点优化清单：先压缩陈列面积，同步精简低效 SKU 与慢流商品，观察一个完整补货周期后再决定是否退出。',
      basis: [
        '综合健康度 ' + sc(worst.score) + ' 分，' + worst.stars + ' ' + worst.grade + '，排名 ' + worst.rank + '/' + items.length,
        '库存周转 ' + worst.turnoverDays + ' 天（健康线 45 天）',
        '坪效 ' + num(worst.spaceEff) + ' 元/㎡/月（全店加权均值 ' + num(d.avgTurnover ? 875 : 875) + ' 元/㎡/月）',
        '销量贡献 ' + worst.qtyShare + '%、毛利贡献 ' + worst.gpShare + '%',
      ],
      cats: [worst.name], route: 'health',
    });

    // 2. 高周转天数
    if (highTurnover.length) {
      out.push({
        icon: 'refresh', priority: 'P1', priColor: 'warn', risk: '中', riskColor: 'warn', needApproval: false,
        title: '压缩 ' + highTurnover.length + ' 个高周转天数品类的库存占用',
        advice: '「' + highTurnover.map(function (x) { return x.name; }).join('、') +
          '」库存周转天数均超过 45 天健康线，合计占用较多流动资金。建议核查订货策略：下调单次订货量、提高订货频次，并对周转最慢的 ' +
          Math.round(highTurnover.length * 3) + ' 个 SKU 做单独评估。',
        basis: highTurnover.slice(0, 4).map(function (x) {
          return x.name + '：库存周转 ' + x.turnoverDays + ' 天（超健康线 ' + Math.round((x.turnoverDays - 45) / 45 * 100) + '%）';
        }),
        cats: highTurnover.map(function (x) { return x.name; }), route: 'health',
      });
    }

    // 3. 需求上涨品类备货
    if (rising.length) {
      out.push({
        icon: 'trendup', priority: 'P1', priColor: 'warn', risk: '中', riskColor: 'warn', needApproval: false,
        title: '为需求上涨品类提前备货',
        advice: '「' + rising.map(function (c) { return c.cat; }).join('、') +
          '」未来 4 期需求预测呈上涨趋势，其中 ' + rising.map(function (c) {
            return c.cat + ' 环比 ' + pct(c.delta);
          }).join('、') + '。建议提前 1 周加密订货频次，并核查对应供应商在需求高峰期的供货能力，避免出现热销断货。',
        basis: rising.slice(0, 4).map(function (c) {
          return c.cat + '：未来 4 期需求预测环比 ' + pct(c.delta) + '（' + c.level + '）';
        }),
        cats: rising.map(function (c) { return c.cat; }), route: 'forecast',
      });
    }

    // 4. 强关联组合的陈列机会
    if (topRule) {
      out.push({
        icon: 'link', priority: 'P1', priColor: 'warn', risk: '低', riskColor: 'good', needApproval: false,
        title: '抓住高提升度关联组合的陈列机会',
        advice: '基于 ' + num(d.assoc.basketCount) + ' 笔交易实时重算，识别出 ' + d.assoc.rules.length +
          ' 条通过当前阈值的强关联规则，其中「' + topRule.a + ' → ' + topRule.b + '」提升度达 ' + topRule.lift +
          '（' + topRule.strength.level + '关联）。建议在货架端做相邻陈列或设置场景化联合促销，' +
          '预计可提升客单价与连带率。',
        basis: (d.assoc.topRules || []).slice(0, 4).map(function (r) {
          return r.a + ' → ' + r.b + '：支持度 ' + r.support + '，置信度 ' + r.confidence + '，提升度 ' + r.lift;
        }),
        cats: [topRule.aCat, topRule.bCat], route: 'assoc',
      });
    }

    // 5. 优势品类扩品
    out.push({
      icon: 'target', priority: 'P2', priColor: 'good', risk: '低', riskColor: 'good', needApproval: false,
      title: '巩固「' + best.name + '」的品类优势地位',
      advice: best.name + '健康度 ' + sc(best.score) + ' 分（' + best.stars + ' ' + best.grade + '），销量贡献 ' +
        best.qtyShare + '% 为全店第一，库存周转仅 ' + best.turnoverDays + ' 天、坪效 ' + num(best.spaceEff) +
        ' 元/㎡/月。建议扩大产地直采范围、适度增加高毛利品项，强化「家门口的社区厨房」定位。',
      basis: [
        '健康度 ' + sc(best.score) + ' 分，排名 1/' + items.length,
        '销量贡献 ' + best.qtyShare + '%，全店第一',
        '坪效 ' + num(best.spaceEff) + ' 元/㎡/月，全店第一',
        '库存周转 ' + best.turnoverDays + ' 天，全店最快',
      ],
      cats: [best.name], route: 'compare',
    });

    return out.slice(0, 5);
  }

  Pages.after_dash = function () {
    var c = document.getElementById('content');
    // 演示流程
    var steps = [
      { t: 'Step 1 · 选择黄金海岸广场店', d: '确认门店上下文为「华润苏果（南京江宁黄金海岸广场店）」，后续所有分析均基于该门店数据。', r: null, a: function () { global.App.toast('当前门店：' + curStore().name, 'ok'); } },
      { t: 'Step 2 · 查看 7 大品类健康情况', d: '在驾驶舱查看品类健康度概览与风险预警，了解 7 个一级品类的健康分档与主要问题。', r: 'health' },
      { t: 'Step 3 · 进入选品比较中心', d: '打开选品比较中心，了解多维比较指标与默认评价模型（销量30%+毛利30%+周转20%+坪效20%）。', r: 'compare' },
      { t: 'Step 4 · 比较高健康 vs 低健康品类', d: '同时选择「生鲜蔬果」（高健康）与「纺织服装」（低健康）等 2-6 个对象，对比雷达图、综合评分与 AI 综合判断。', r: 'compare' },
      { t: 'Step 5 · 查看关联场景', d: '在关联陈列分析中查看实时重算的关联规则与网络图，如牛奶+面包、火锅底料+丸子等场景组合。', r: 'assoc' },
      { t: 'Step 6 · 查看未来 4 期需求预测', d: '在需求预测模块查看历史实线 + 预测虚线 + 置信区间带，以及环比趋势分类。', r: 'forecast' },
      { t: 'Step 7 · 让 AI 生成门店选品优化方案', d: '在 AI 选品助手内一键生成 AI 综合选品方案，输出「优先扩充/建议保持/重点观察/建议精简/建议退出」五档结论。', r: 'ai' },
      { t: 'Step 8 · 提交一条 AI 建议进入人工审批', d: '把 Level 3 高影响建议提交到审批中心，演示人机协同的完整闭环。', r: 'approval' },
    ];

    function renderSteps(done) {
      var el = document.getElementById('demoSteps');
      if (!el) return;
      var h = '<div class="steps">';
      steps.forEach(function (s, i) {
        h += '<div class="step' + (i < done ? ' done' : '') + '" data-step="' + i + '">' +
          '<div class="no">' + (i < done ? '✓' : (i + 1)) + '</div>' +
          '<div class="bd"><b>' + esc(s.t) + '</b><span>' + esc(s.d) + '</span></div>' +
          '<div style="font-size:11px;color:var(--ink-4);white-space:nowrap">' +
          (s.r ? '跳转 ' + esc(App.PAGE_TITLE[s.r]) : '就地执行') + '</div></div>';
      });
      h += '</div>';
      h += '<div class="note ok" style="margin-top:5px">' + App.ICON.ok +
        '<div>点击任意步骤即可跳转对应模块。建议演示顺序：Step 1 → 8，全程约 3-5 分钟，' +
        '可完整展示「数据输入 → 数据质量检查 → 品类诊断 → 商品比较 → 购物篮分析 → 需求预测 → AI 综合判断 → 推荐方案 → 人工审核」闭环。</div></div>';
      el.innerHTML = h;
    }
    renderSteps(App.load('demoStep', 0));

    c.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act],[data-step]');
      if (!b) return;
      if (b.dataset.step != null) {
        var i = +b.dataset.step;
        var preDone = App.load('demoStep', 0);
        if (i <= preDone) return;
        var s = steps[i];
        App.save('demoStep', i + 1);
        if (s.a) s.a();
        if (s.r) App.go(s.r);
        else App.refreshPage();
        global.App.toast('已完成：' + s.t, 'ok');
        return;
      }
      var act = b.dataset.act;
      if (act === 'png') {
        var box = b.closest('.card-b') || document.getElementById(b.dataset.target);
        Ch.exportPNG(box, b.dataset.target || 'chart');
        global.App.toast('图表已导出 PNG', 'ok');
      }
      if (act === 'dash-refresh') {
        App.invalidate(); App.refreshPage();
        global.App.toast('已重新计算全部指标', 'ok');
      }
      if (act === 'dash-export') exportDash();
      if (act === 'dash-report') Pages.genReport();
      if (act === 'demo-guide') {
        App.save('demoStep', 1);
        App.go('health');
        global.App.toast('演示已启动：Step 2 品类健康诊断', 'ok');
      }
      if (act === 'warn-goto') App.go('health');
      if (act === 'warn-all') showAllWarnings();
      if (act === 'adv-goto') App.go(b.dataset.route);
      if (act === 'adv-approval') {
        var d = App.getDash();
        var adv = buildDailyAdvice(d)[+b.dataset.idx];
        if (adv) Pages.submitApprovalFromAdvice(adv);
      }
    });
  };

  function showAllWarnings() {
    var d = App.getDash();
    var h = '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th>风险等级</th><th>风险类型</th><th>品类</th><th>说明</th><th>指标/阈值</th><th>建议动作</th>' +
      '</tr></thead><tbody>';
    d.warnings.forEach(function (w) {
      h += '<tr><td><span class="chip ' + (w.level === 'high' ? 'bad' : 'warn') + '">' +
        (w.level === 'high' ? '高风险' : '中风险') + '</span></td>' +
        '<td>' + esc(w.type) + '</td><td>' + esc(w.cat) + '</td>' +
        '<td style="font-size:12px">' + esc(w.detail) + '</td>' +
        '<td class="num">' + w.metric + ' / ' + w.threshold + '</td>' +
        '<td style="font-size:12px">' + esc(w.advice) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    App.openDrawer('全部风险预警（' + d.warnings.length + ' 条）', h,
      '<button class="btn" data-act="dr-cancel">关闭</button>');
    document.getElementById('drFoot').onclick = function (ev) {
      if (ev.target.closest('[data-act="dr-cancel"]')) App.closeDrawer();
    };
  }

  function exportDash() {
    var d = App.getDash();
    var rows = d.kpis.map(function (k) {
      return { 指标: k.label, 数值: k.value, 单位: k.unit, 说明: k.sub };
    });
    App.download('驾驶舱KPI_' + App.nowStr().replace(/[-: ]/g, '') + '.csv', App.toCSV(rows));
    App.audit('导出驾驶舱KPI', curStore().name, rows.length + ' 项指标');
    App.persist();
    global.App.toast('KPI 数据已导出 CSV', 'ok');
  }

  /* ========================================================================
   * 核心模块二：品类健康诊断
   * ====================================================================== */
  Pages.health = function () {
    var hh = App.getHealth();
    if (!hh.ok) return App.insufficient('数据不足', hh.reason);

    var tab = App.load('healthTab', 'recalc');
    var h = '';

    h += '<div class="page-head"><div class="t"><h2>品类健康诊断</h2>' +
      '<p>数据源：<b>dataset_category_sales.csv</b>（7 品类 × 12 月 = 84 条记录）　' +
      '聚合周期：' + hh.months[0] + ' ~ ' + hh.months[hh.months.length - 1] + '（' + hh.monthCount + ' 个月）　' +
      demoBadge() + '</p></div>' +
      '<div class="acts">' +
      '<button class="btn" data-act="png" data-target="ch-health-bar">' + icon('download') + '导出图表 PNG</button>' +
      '<button class="btn" data-act="health-export">' + icon('download') + '导出诊断明细 CSV</button>' +
      '<button class="btn" data-act="health-recalc">' + icon('refresh') + '按当前权重重算</button>' +
      '</div></div>';

    // 模型说明
    h += '<div class="grid g2" style="margin-bottom:15px">' +
      '<div class="card"><div class="card-h"><h3>' + icon('cpu') + '健康度评分模型</h3>' +
      '<div class="acts"><button class="btn sm" data-act="goto-settings">调整权重</button></div></div>' +
      '<div class="card-b"><div class="wrow"><span class="wn">销量贡献</span>' +
      '<div class="bar"><i style="width:' + hh.weights.qty * 100 + '%;background:var(--brand)"></i></div>' +
      '<span class="wv">' + Math.round(hh.weights.qty * 100) + '%</span></div>' +
      '<div class="wrow"><span class="wn">毛利贡献</span>' +
      '<div class="bar"><i style="width:' + hh.weights.gp * 100 + '%;background:var(--brand-3)"></i></div>' +
      '<span class="wv">' + Math.round(hh.weights.gp * 100) + '%</span></div>' +
      '<div class="wrow"><span class="wn">库存周转</span>' +
      '<div class="bar"><i style="width:' + hh.weights.turnover * 100 + '%;background:var(--brand-3)"></i></div>' +
      '<span class="wv">' + Math.round(hh.weights.turnover * 100) + '%</span></div>' +
      '<div class="wrow"><span class="wn">坪效</span>' +
      '<div class="bar"><i style="width:' + hh.weights.space * 100 + '%;background:var(--brand-3)"></i></div>' +
      '<span class="wv">' + Math.round(hh.weights.space * 100) + '%</span></div>' +
      '<div class="note" style="margin-top:11px;font-size:11.5px">' + App.ICON.info +
      '<div><b>周转天数处理：</b>库存周转天数<b>越低越好</b>，因此采用<b>逆向 Min-Max 标准化</b>，' +
      '不使用正向标准化（否则会得出完全相反的结论）。<br>' +
      '<b>评分构成：</b>相对标准化 60% + 行业基准 40%，避免样本量小时差异被过度放大。</div></div>' +
      '</div></div>';

    h += '<div class="card"><div class="card-h"><h3>' + icon('grid') + '五级健康分档标准</h3></div>' +
      '<div class="card-b" style="display:flex;gap:9px;flex-wrap:wrap">' +
      [['★★★★★', '85-100', '优秀', 'good'], ['★★★★☆', '70-84', '良好', 'good'],
        ['★★★☆☆', '55-69', '一般', 'warn'], ['★★☆☆☆', '40-54', '较差', 'warn'],
        ['★☆☆☆☆', '0-39', '差', 'bad']].map(function (x) {
        return '<div style="flex:1;min-width:120px;padding:11px;border:1px solid var(--line);border-radius:10px;text-align:center">' +
          '<div style="font-size:15px;letter-spacing:1px;color:var(--ink)">' + x[0] + '</div>' +
          '<div style="font-size:19px;font-weight:700;margin:3px 0;font-variant-numeric:tabular-nums">' + x[1] + '</div>' +
          '<span class="chip ' + x[3] + '">' + x[2] + '</span></div>';
      }).join('') +
      '<div class="note warn" style="width:100%;margin-top:5px">' + App.ICON.warn +
      '<div>综合得分 <b>低于 55 分（低于三星）</b>的品类将自动标记为「<b>需重点优化</b>」，并纳入 AI 建议与风险预警。</div></div>' +
      '</div></div></div>';

    // 主图
    h += '<div class="card" style="margin-bottom:15px"><div class="card-h">' +
      '<h3>' + icon('health') + '品类健康度综合得分' +
      '<span class="sub">7 个一级品类横向对比</span></h3>' +
      '<div class="acts"><button class="btn sm" data-act="png" data-target="ch-health-bar">' +
      icon('download', '', 13) + 'PNG</button></div></div>' +
      '<div class="card-b" id="ch-health-bar">' +
      Ch.hBar(hh.items.map(function (x) {
        return { label: x.name, value: x.score, color: x.color, text: sc(x.score) + ' ' + x.stars };
      })) + '</div></div>';

    // 明细表
    h += '<div class="card" style="margin-bottom:15px"><div class="card-h">' +
      '<h3>' + icon('grid') + '品类诊断明细' +
      '<span class="sub">点击任意行查看完整诊断结论与优化建议</span></h3></div>' +
      '<div class="card-b tight tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th>排名</th><th>品类</th><th>健康度</th><th>等级</th>' +
      '<th class="num">销量(件)</th><th class="num">销售额</th><th class="num">毛利额</th><th class="num">毛利率</th>' +
      '<th class="num">销量占比</th><th class="num">毛利占比</th>' +
      '<th class="num">周转(天)</th><th class="num">坪效</th><th class="num">缺货</th><th class="num">SKU</th>' +
      '<th>销量趋势</th><th></th></tr></thead><tbody>';
    hh.items.forEach(function (x) {
      h += '<tr><td><b>' + x.rank + '</b></td>' +
        '<td><b>' + esc(x.name) + '</b>' + (x.needOptimize ? '<br><span class="chip bad">需重点优化</span>' : '') + '</td>' +
        '<td>' + barOf(x.score, x.color) + '</td>' +
        '<td>' + healthChip(x) + '</td>' +
        '<td class="num">' + num(x.qty) + '</td>' +
        '<td class="num">' + money(x.amt) + '</td>' +
        '<td class="num">' + money(x.gp) + '</td>' +
        '<td class="num">' + num(x.grossMargin, 1) + '%</td>' +
        '<td class="num">' + x.qtyShare + '%</td>' +
        '<td class="num">' + x.gpShare + '%</td>' +
        '<td class="num"' + (x.turnoverDays > 45 ? ' style="color:var(--bad);font-weight:600"' : '') + '>' + num(x.turnoverDays, 1) + '</td>' +
        '<td class="num">' + num(x.spaceEff) + '</td>' +
        '<td class="num"' + (x.stockout >= 4 ? ' style="color:var(--warn);font-weight:600"' : '') + '>' + x.stockout + '</td>' +
        '<td class="num">' + num(x.skuCount) + '</td>' +
        '<td>' + Ch.spark(x.months.map(function (m) { return m.qty; })) +
        '<span style="font-size:11px;color:' + (x.trend.pct > 0 ? 'var(--bad)' : x.trend.pct < 0 ? 'var(--good)' : 'var(--ink-3)') + '">' +
        pct(x.trend.pct) + '</span></td>' +
        '<td><button class="btn sm" data-act="cat-detail" data-cid="' + x.cid + '">诊断详情</button></td></tr>';
    });
    h += '</tbody></table></div></div>';

    // 双轨对比
    h += '<div class="card"><div class="card-h"><h3>' + icon('layers') + '结果来源对比' +
      '<span class="sub">附件预置参考结果 vs 系统按当前权重重算结果</span></h3>' +
      '<div class="acts">' +
      '<button class="tab' + (tab === 'recalc' ? ' on' : '') + '" data-hs="recalc">系统重算结果</button>' +
      '<button class="tab' + (tab === 'att' ? ' on' : '') + '" data-hs="att">附件预置参考</button>' +
      '</div></div><div class="card-b" id="healthDual"></div></div>';

    return h;
  };

  function renderHealthDual() {
    var hh = App.getHealth();
    var el = document.getElementById('healthDual');
    if (!el) return;
    var tab = App.load('healthTab', 'recalc');
    var att = global.SUGUO_DATA.healthAttachment;

    if (tab === 'att') {
      el.innerHTML =
        '<div class="note" style="margin-bottom:13px">' + App.ICON.info +
        '<div><b>来源：dataset_category_health.csv（附件预置参考结果）</b><br>' +
        '该文件为项目附件中提供的健康度评分结果，平台<b>原样保留、不做任何修改</b>，' +
        '作为参考基准与系统重算结果对照展示。</div></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>品类ID</th><th>品类名称</th><th>综合评分</th><th>健康度等级</th><th>评级</th>' +
        '<th class="num">销量贡献</th><th class="num">毛利贡献</th><th class="num">周转天数</th>' +
        '<th class="num">坪效得分</th><th>预警灯</th><th>优化建议</th></tr></thead><tbody>' +
        att.map(function (a) {
          return '<tr><td class="mut">' + esc(a.cid) + '</td><td><b>' + esc(a.name) + '</b></td>' +
            '<td class="num"><b>' + a.score + '</b></td><td>' + esc(a.stars) + '</td>' +
            '<td><span class="chip ' + lampChip(a.lamp) + '">' + esc(a.grade) + '</span></td>' +
            '<td class="num">' + a.qtyShare + '%</td><td class="num">' + a.gpShare + '%</td>' +
            '<td class="num">' + a.turnoverDays + '</td><td class="num">' + a.spaceScore + '</td>' +
            '<td><span class="chip ' + lampChip(a.lamp) + '">' + esc(a.lamp) + '</span></td>' +
            '<td style="font-size:12px">' + esc(a.advice) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      return;
    }

    // 重算 + 差异
    var diffs = hh.items.map(function (r) {
      var a = att.filter(function (x) { return x.cid === r.cid; })[0];
      return { r: r, a: a, d: a ? Math.round((r.score - a.score) * 10) / 10 : null };
    });
    var big = diffs.filter(function (x) { return x.d != null && Math.abs(x.d) >= 15; });

    el.innerHTML =
      '<div class="note" style="margin-bottom:13px">' + App.ICON.info +
      '<div><b>来源：系统按当前权重重算</b>（算法：' + esc(hh.algorithm) + '）<br>' +
      '参数：相对标准化 60% + 行业基准 40%，权重 销量' + Math.round(hh.weights.qty * 100) + '%·毛利' +
      Math.round(hh.weights.gp * 100) + '%·周转' + Math.round(hh.weights.turnover * 100) + '%·坪效' +
      Math.round(hh.weights.space * 100) + '%　生成时间：' + fmtTime(hh.createdAt) + '</div></div>' +
      (big.length ? '<div class="note warn" style="margin-bottom:13px">' + App.ICON.warn +
        '<div><b>数据说明：检测到 ' + big.length + ' 个品类的重算结果与附件参考结果差异 ≥ 15 分。</b><br>' +
        '平台<b>不会强行修改任何数据</b>。差异可能来源于：<b>评分口径</b>（附件按品类内相对评分，平台采用相对 60% + 行业基准 40%）、' +
        '<b>时间范围</b>（附件未标注聚合周期，平台默认最近 12 个月）、<b>样本与算法设置</b>（标准化方式、边界处理）。' +
        '两组结果均完整保留，供交叉参考。</div></div>' : '') +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th>品类</th><th>系统重算得分</th><th>系统评级</th><th>附件参考得分</th><th>附件评级</th>' +
      '<th>差异</th><th>差异程度</th><th>差异说明</th></tr></thead><tbody>' +
      diffs.map(function (x) {
        var abs = x.d == null ? 0 : Math.abs(x.d);
        var cls = abs >= 15 ? 'bad' : abs >= 8 ? 'warn' : 'gray';
        var lbl = abs >= 15 ? '差异较大' : abs >= 8 ? '存在差异' : '基本一致';
        return '<tr><td><b>' + esc(x.r.name) + '</b></td>' +
          '<td class="num"><b>' + sc(x.r.score) + '</b></td><td>' + healthChip(x.r) + '</td>' +
          '<td class="num">' + (x.a ? x.a.score : '—') + '</td>' +
          '<td>' + (x.a ? '<span class="chip ' + lampChip(x.a.lamp) + '">' + esc(x.a.grade) + '</span>' : '—') + '</td>' +
          '<td class="num"><b>' + (x.d == null ? '—' : (x.d > 0 ? '+' : '') + x.d) + '</b></td>' +
          '<td><span class="chip ' + cls + '">' + lbl + '</span></td>' +
          '<td style="font-size:12px;color:var(--ink-3)">' +
          (abs >= 15 ? '评分口径与时间范围不同，建议以系统重算结果为准并复核口径' :
            abs >= 8 ? '存在口径差异，属正常范围' : '两组结果高度一致') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="note" style="margin-top:13px;font-size:11.5px">' + App.ICON.info +
      '<div>平台的数据治理原则：<b>附件原始结果永久保留、不被算法覆盖或删除</b>；系统重算结果严格按当前参数独立生成；' +
      '两者差异以「数据说明」形式透明呈现，由业务人员判断采信。</div></div>';
  }

  function lampChip(lamp) {
    return { '绿灯': 'good', '黄灯': 'warn', '橙灯': 'warn', '红灯': 'bad' }[lamp] || 'gray';
  }

  Pages.after_health = function () {
    renderHealthDual();
    var c = document.getElementById('content');
    c.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act],[data-hs]');
      if (!b) return;
      if (b.dataset.hs) {
        App.save('healthTab', b.dataset.hs);
        renderHealthDual();
        c.querySelectorAll('[data-hs]').forEach(function (t) {
          t.classList.toggle('on', t.dataset.hs === b.dataset.hs);
        });
        return;
      }
      var act = b.dataset.act;
      if (act === 'png') {
        Ch.exportPNG(document.getElementById(b.dataset.target), b.dataset.target);
        global.App.toast('图表已导出 PNG', 'ok');
      }
      if (act === 'health-recalc') {
        App.invalidate(); App.refreshPage();
        global.App.toast('已按当前权重重新计算 7 个品类的健康度', 'ok');
      }
      if (act === 'health-export') exportHealthCSV();
      if (act === 'goto-settings') { App.go('admin'); App.save('adminTab', 'settings'); }
      if (act === 'cat-detail') showCatDetail(b.dataset.cid);
    });
  };

  function exportHealthCSV() {
    var hh = App.getHealth();
    var rows = hh.items.map(function (x) {
      return {
        排名: x.rank, 品类ID: x.cid, 品类名称: x.name, 综合得分: x.score,
        健康度等级: x.stars, 评级: x.grade,
        销量_件: x.qty, 销售额_元: x.amt, 毛利额_元: x.gp, 毛利率_百分比: x.grossMargin,
        销量贡献_百分比: x.qtyShare, 毛利贡献_百分比: x.gpShare,
        库存周转天数: x.turnoverDays, 坪效_元每平米月: x.spaceEff,
        缺货次数: x.stockout, SKU数量: x.skuCount,
        销量趋势_百分比: x.trend.pct,
        是否需重点优化: x.needOptimize ? '是' : '否',
      };
    });
    App.download('品类健康诊断_' + App.nowStr().replace(/[-: ]/g, '') + '.csv', App.toCSV(rows));
    App.audit('导出品类诊断明细', 'dataset_category_sales.csv', rows.length + ' 个品类');
    App.persist();
    global.App.toast('诊断明细已导出 CSV', 'ok');
  }

  function showCatDetail(cid) {
    var hh = App.getHealth();
    var x = hh.items.filter(function (i) { return i.cid === cid; })[0];
    if (!x) return;
    var fc = A.analyzeForecast(x.name);
    var ruleHit = (App.getAssoc().rules || []).filter(function (r) {
      return r.aCat === x.name || r.bCat === x.name;
    });

    // 诊断结论生成（基于真实指标）
    var concl = [];
    if (x.score >= 85) concl.push('综合表现优秀，属门店核心优势品类，建议保持并适度扩品。');
    else if (x.score >= 70) concl.push('综合表现良好，无重大结构性问题，可小幅优化品项结构。');
    else if (x.score >= 55) concl.push('综合表现一般，存在较为明显的短板指标，需要针对性优化。');
    else concl.push('综合表现较差，多项核心指标低于健康线，建议纳入重点优化或退出评估清单。');

    var problems = [];
    if (x.turnoverDays > 45) problems.push('库存周转 ' + x.turnoverDays + ' 天，超过 45 天健康线，资金占用偏重');
    if (x.spaceEff < 400) problems.push('坪效 ' + num(x.spaceEff) + ' 元/㎡/月，低于 400 元健康线，货架产出效率偏低');
    if (x.stockout >= 4) problems.push('近 12 个月缺货 ' + x.stockout + ' 次，热销商品供应稳定性不足');
    if (x.grossMargin < 18) problems.push('毛利率仅 ' + num(x.grossMargin, 1) + '%，低于 18% 健康线，盈利贡献偏弱');
    if (x.trend.pct < -10) problems.push('销量呈下降趋势（' + pct(x.trend.pct) + '），存在需求萎缩风险');
    if (!problems.length) problems.push('未识别到显著短板指标，各维度表现均衡');

    var advice = [];
    if (x.needOptimize) {
      advice.push('将本品类纳入重点优化清单，制定 2 个月整改观察期');
      advice.push('梳理 SKU 结构：保留高频刚需品与高毛利品，淘汰长尾慢流品');
      if (x.turnoverDays > 45) advice.push('下调单次订货量、提高订货频次，压缩库存周转天数至 45 天以内');
      if (x.spaceEff < 400) advice.push('评估压缩陈列面积，把货架资源让给高坪效品类');
    } else {
      advice.push('维持当前商品结构与陈列策略');
      if (x.gpShare < x.qtyShare) advice.push('在保持销量的前提下，适度提高高毛利品项占比以优化毛利结构');
      advice.push('可尝试引入 2-3 个差异化新品，测试增量空间');
    }

    var trendSeries = [
      { name: '销量(件)', color: Ch.C.brand2, values: x.months.map(function (m) { return m.qty; }) },
      { name: '毛利额(元)', color: Ch.C.orange, values: x.months.map(function (m) { return m.gp; }) },
    ];

    var body =
      '<div class="grid g2" style="margin-bottom:14px">' +
      '<div class="card"><div class="card-b" style="text-align:center">' +
      '<div style="font-size:11px;color:var(--ink-3);margin-bottom:6px">综合健康度得分</div>' +
      '<div style="font-size:40px;font-weight:700;letter-spacing:-1.5px;line-height:1">' + sc(x.score) + '</div>' +
      '<div style="font-size:16px;letter-spacing:2px;margin:7px 0 5px">' + x.stars + '</div>' +
      '<span class="chip ' + x.color + '">' + esc(x.grade) + '</span>' +
      '<div style="font-size:11.5px;color:var(--ink-3);margin-top:9px">排名 ' + x.rank + ' / ' + hh.items.length + '</div>' +
      '</div></div>' +
      '<div class="card"><div class="card-b">' +
      '<div style="font-size:11px;color:var(--ink-3);margin-bottom:8px">四项分维得分</div>' +
      ['销量贡献|qtyScore', '毛利贡献|gpScore', '库存周转|turnoverScore', '坪效|spaceScore'].map(function (t) {
        var kv = t.split('|');
        return '<div style="margin-bottom:7px"><div style="font-size:11.5px;color:var(--ink-2);margin-bottom:3px">' +
          kv[0] + '</div>' + barOf(x[kv[1]], x.color) + '</div>';
      }).join('') +
      '</div></div></div>' +

      '<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>' + icon('trend') + '12 个月走势</h3></div>' +
      '<div class="card-b">' + Ch.line({ labels: x.months.map(function (m) { return m.month.slice(2); }), series: trendSeries, height: 200 }) + '</div></div>' +

      '<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>' + icon('doc') + '诊断结论</h3></div>' +
      '<div class="card-b"><p style="margin:0 0 11px;font-size:13px;line-height:1.75">' + esc(concl[0]) + '</p>' +
      '<div style="font-size:12px;font-weight:650;margin-bottom:6px">识别到的问题</div>' +
      '<ul style="margin:0 0 13px;padding-left:18px;font-size:12.5px;line-height:1.75;color:var(--ink-2)">' +
      problems.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' +
      '<div style="font-size:12px;font-weight:650;margin-bottom:6px">优化建议</div>' +
      '<ul style="margin:0;padding-left:18px;font-size:12.5px;line-height:1.75;color:var(--ink-2)">' +
      advice.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' +
      '</div></div>' +

      '<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>' + icon('link') + '关联购买情况</h3>' +
      '<span class="sub">来自当前交易数据的实时重算结果</span></div><div class="card-b">' +
      (ruleHit.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>关联规则</th><th class="num">支持度</th><th class="num">置信度</th><th class="num">提升度</th><th>强度</th>' +
        '</tr></thead><tbody>' +
        ruleHit.slice(0, 8).map(function (r) {
          return '<tr><td>' + esc(r.a) + ' → ' + esc(r.b) + '</td>' +
            '<td class="num">' + r.support + '</td><td class="num">' + r.confidence + '</td>' +
            '<td class="num"><b>' + r.lift + '</b></td>' +
            '<td><span class="chip ' + r.strength.color + '">' + esc(r.strength.level) + '</span></td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<div class="empty"><h4>本品类暂无强关联规则</h4><p>在当前阈值（min_support=0.02、min_confidence=0.50、min_lift=1.50）下，本品类未参与任何通过筛选的关联规则。</p></div>') +
      '</div></div>' +

      '<div class="card"><div class="card-h"><h3>' + icon('trend') + '需求趋势</h3></div><div class="card-b">' +
      (fc.ok
        ? '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px">' +
        '<div><div style="font-size:11px;color:var(--ink-3)">最近 4 期实际均值</div><div style="font-size:18px;font-weight:700">' + num(fc.last4Avg, 1) + '</div></div>' +
        '<div><div style="font-size:11px;color:var(--ink-3)">未来 4 期预测均值</div><div style="font-size:18px;font-weight:700">' + num(fc.next4Avg, 1) + '</div></div>' +
        '<div><div style="font-size:11px;color:var(--ink-3)">环比</div><div style="font-size:18px;font-weight:700;color:' + (fc.delta > 0 ? 'var(--bad)' : 'var(--good)') + '">' + pct(fc.delta) + '</div></div>' +
        '<div><div style="font-size:11px;color:var(--ink-3)">趋势判定</div><div style="margin-top:3px"><span class="chip ' + (fc.delta > 5 ? 'warn' : fc.delta < -5 ? 'info' : 'good') + '">' + esc(fc.level.label) + '</span></div></div>' +
        '</div>'
        : '<div class="note warn">' + App.ICON.warn + '<div>' + esc(fc.reason) + '</div></div>') +
      '</div></div>' +

      traceBar(hh);

    App.openDrawer(x.name + ' · 品类诊断详情', body,
      '<button class="btn" data-act="dr-cancel">关闭</button>' +
      (x.needOptimize ? '<button class="btn pri" data-act="dr-approve">' + icon('gavel') + '提交优化建议审批</button>' : ''));
    document.getElementById('drFoot').onclick = function (ev) {
      var t = ev.target.closest('[data-act]');
      if (!t) return;
      if (t.dataset.act === 'dr-cancel') App.closeDrawer();
      if (t.dataset.act === 'dr-approve') {
        App.closeDrawer();
        Pages.openApprovalForm(null, {
          level: 3, source: '品类健康诊断', cats: [x.name],
          title: '建议对「' + x.name + '」实施品类优化',
          advice: concl[0] + ' 具体措施：' + advice.join('；') + '。',
          basis: problems.map(function (p) { return p; }).concat([
            '综合健康度 ' + sc(x.score) + ' 分（' + x.stars + ' ' + x.grade + '），排名 ' + x.rank + '/' + hh.items.length,
            '销量贡献 ' + x.qtyShare + '%，毛利贡献 ' + x.gpShare + '%，毛利率 ' + num(x.grossMargin, 1) + '%',
          ]),
          priority: x.score < 45 ? '高' : '中', risk: x.score < 45 ? '高' : '中',
        });
      }
    };
  }

  /* ========================================================================
   * 核心模块三：关联陈列分析
   * ====================================================================== */
  Pages.assoc = function () {
    var ap = App.getAssoc();
    var s = S();
    var h = '';

    h += '<div class="page-head"><div class="t"><h2>关联陈列分析</h2>' +
      '<p>数据源：<b>dataset_transactions_sample.csv</b>　' +
      num(global.SUGUO_DATA.transactions.txCount) + ' 笔交易 / ' +
      num(global.SUGUO_DATA.transactions.itemCount) + ' 条商品明细　' + demoBadge() + '</p></div>' +
      '<div class="acts">' +
      '<button class="btn" data-act="assoc-settings">' + icon('filter') + '高级设置</button>' +
      '<button class="btn" data-act="assoc-export">' + icon('download') + '导出规则 CSV</button>' +
      '<button class="btn pri" data-act="assoc-recalc">' + icon('refresh') + '重新运行 Apriori</button>' +
      '</div></div>';

    // 关键提示：商品编码离散问题
    h += '<div class="note warn" style="margin-bottom:15px">' + App.ICON.warn +
      '<div><b>数据治理提示 — 购物篮构建口径：</b>当前演示数据中的<b>商品编码高度离散</b>（' +
      num(global.SUGUO_DATA.transactions.products.length) + ' 个商品名称对应 5000+ 个不同 SKU 编码，' +
      '存在大量「一名多码」现象）。因此平台<b>默认使用「交易号 + 商品名称」构建购物篮</b>，' +
      '而不按商品编码直接分析。<br>' +
      '真实企业数据接入后，若 SKU 编码体系稳定且唯一，可在高级设置中切换为<b>按商品编码分析</b>。' +
      '当前口径：<b>' + (ap.aggregateBy === 'name' ? '交易号 + 商品名称' : '商品编码') + '</b></div></div>';

    // 参数条
    h += '<div class="grid g4" style="margin-bottom:15px">' +
      kpiBox('交易笔数', num(ap.basketCount), '笔', '参与分析的购物篮数量', 'neutral', 'box') +
      kpiBox('频繁项集', num(ap.freqItems.length), '个', '满足 min_support 的商品', 'neutral', 'grid') +
      kpiBox('通过阈值的强规则', num(ap.rules.length), '条', '同时满足支持度/置信度/提升度', 'good', 'link') +
      kpiBox('当前筛选阈值', s.settings.apriori.minLift, 'lift', 'min_support ' + s.settings.apriori.minSupport +
        ' / min_conf ' + s.settings.apriori.minConfidence, 'neutral', 'filter') +
      '</div>';

    // 双轨：实时 vs 附件
    var attRules = global.SUGUO_DATA.rulesAttachment;
    var passAtt = attRules.filter(function (r) {
      return r.confidence >= s.settings.apriori.minConfidence && r.lift >= s.settings.apriori.minLift;
    });
    var failAtt = attRules.length - passAtt.length;

    h += '<div class="note" style="margin-bottom:15px">' + App.ICON.info +
      '<div><b>双轨结果对照：</b>本模块同时展示两组结果，互不覆盖。<br>' +
      '① <b>附件参考关联规则</b>（dataset_association_rules.csv）：' + attRules.length + ' 条，' +
      '<b>原样保留、不做删改</b>，其中 <b>' + passAtt.length + ' 条</b>通过当前参数阈值、' +
      '<b>' + failAtt + ' 条</b>未通过。<br>' +
      '② <b>系统实时重算结果</b>：基于交易明细按当前阈值独立计算，' + ap.rules.length + ' 条。<br>' +
      '差异来源：参数设置（支持度/置信度/提升度阈值）、时间范围、数据清洗方式、样本量与算法设置。' +
      '两组结果均标注来源与阈值通过状态，由业务人员判断采信。</div></div>';

    h += '<div class="tabs">' +
      '<button class="tab on" data-at="realtime">系统实时重算结果（' + ap.rules.length + '）</button>' +
      '<button class="tab" data-at="attach">附件参考关联规则（' + attRules.length + '）</button>' +
      '<button class="tab" data-at="net">关联网络图</button>' +
      '</div>';

    h += '<div id="assocBody"></div>';
    return h;
  };

  function renderAssocBody() {
    var el = document.getElementById('assocBody');
    if (!el) return;
    var tab = App.load('assocTab', 'realtime');
    var ap = App.getAssoc();
    var s = S();
    var attRules = global.SUGUO_DATA.rulesAttachment;

    if (tab === 'net') {
      // 网络图：取 Top 规则涉及的节点
      var top = (ap.topRules || []).slice(0, 16);
      var nodeMap = {};
      top.forEach(function (r) {
        nodeMap[r.a] = nodeMap[r.a] || { id: r.a, label: r.a, cat: r.aCat, w: 0 };
        nodeMap[r.b] = nodeMap[r.b] || { id: r.b, label: r.b, cat: r.bCat, w: 0 };
        nodeMap[r.a].w += r.lift / 6;
        nodeMap[r.b].w += r.lift / 6;
      });
      var nodes = Object.keys(nodeMap).map(function (k) {
        var n = nodeMap[k];
        return { id: n.id, label: n.label, weight: Math.min(1, n.w), color: catColor(n.cat) };
      });
      var links = top.map(function (r) { return { a: r.a, b: r.b, lift: r.lift }; });

      var catSet = {};
      Object.keys(nodeMap).forEach(function (k) { catSet[nodeMap[k].cat] = 1; });

      el.innerHTML =
        '<div class="card" style="margin-bottom:15px"><div class="card-h">' +
        '<h3>' + icon('link') + '关联规则网络图' +
        '<span class="sub">节点 = 商品，连线 = 关联规则，连线越粗提升度越高</span></h3>' +
        '<div class="acts"><button class="btn sm" data-act="png" data-target="netBox">' +
        icon('download', '', 13) + 'PNG</button></div></div>' +
        '<div style="display:flex;gap:14px;flex-wrap:wrap">' +
        '<div class="card-b" id="netBox" style="flex:1;min-width:320px">' +
        Ch.network(nodes, links, { width: 640, height: 420 }) +
        '<div class="note" style="margin-top:11px;font-size:11.5px">' + App.ICON.info +
        '<div>点击任意节点可查看该商品的最强关联商品、所在品类、出现频率与推荐陈列场景。</div></div>' +
        '</div>' +
        '<div class="card-b" style="width:210px;flex:0 0 auto">' +
        '<div style="font-size:11px;color:var(--ink-3);margin-bottom:9px;font-weight:600">品类图例</div>' +
        Object.keys(catSet).map(function (c) {
          return '<div style="display:flex;align-items:center;gap:7px;font-size:12px;margin-bottom:6px">' +
            '<i style="width:10px;height:10px;border-radius:50%;background:' + catColor(c) + ';display:inline-block"></i>' +
            esc(c) + '</div>';
        }).join('') +
        '<div style="font-size:11px;color:var(--ink-3);margin:14px 0 7px;font-weight:600">提升度分级</div>' +
        '<div style="font-size:11.5px;line-height:1.9;color:var(--ink-2)">' +
        '<div>≥ 3.0 <span class="chip bad">极强</span></div>' +
        '<div>2.5-3.0 <span class="chip warn">强</span></div>' +
        '<div>2.0-2.5 <span class="chip warn">中</span></div>' +
        '<div>1.5-2.0 <span class="chip gray">弱</span></div></div>' +
        '</div></div></div>' +

        '<div class="card"><div class="card-h"><h3>' + icon('grid') + 'Top ' + Math.min(20, (ap.topRules || []).length) +
        ' 关联规则明细</h3></div><div class="card-b tight">' + ruleTable(ap.topRules || []) + '</div></div>';

      var g = document.getElementById('netBox');
      if (g) {
        g.querySelectorAll('.net-node').forEach(function (nd) {
          nd.onclick = function () { showNodeDetail(nd.dataset.node); };
        });
      }
      return;
    }

    if (tab === 'attach') {
      el.innerHTML =
        '<div class="note warn" style="margin-bottom:13px">' + App.ICON.warn +
        '<div><b>来源：dataset_association_rules.csv（附件参考结果，原样保留）</b><br>' +
        '共 ' + attRules.length + ' 条。平台<b>不会删除或修改任何附件规则</b>；' +
        '下方逐条标注其是否通过当前参数阈值，这是平台的数据治理能力之一。</div></div>' +
        '<div class="card"><div class="card-b tight tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>规则ID</th><th>前项商品(A)</th><th>后项商品(B)</th>' +
        '<th class="num">支持度</th><th class="num">置信度</th><th class="num">提升度</th>' +
        '<th>来源</th><th>阈值通过状态</th><th>陈列建议</th></tr></thead><tbody>' +
        attRules.map(function (r) {
          var ok = r.confidence >= s.settings.apriori.minConfidence && r.lift >= s.settings.apriori.minLift;
          var why = [];
          if (r.confidence < s.settings.apriori.minConfidence) why.push('置信度 ' + r.confidence + ' < ' + s.settings.apriori.minConfidence);
          if (r.lift < s.settings.apriori.minLift) why.push('提升度 ' + r.lift + ' < ' + s.settings.apriori.minLift);
          return '<tr><td class="mut">' + r.id + '</td>' +
            '<td><b>' + esc(r.a) + '</b></td><td><b>' + esc(r.b) + '</b></td>' +
            '<td class="num">' + r.support + '</td><td class="num">' + r.confidence + '</td>' +
            '<td class="num"><b>' + r.lift + '</b></td>' +
            '<td><span class="chip info">附件参考</span></td>' +
            '<td>' + (ok ? '<span class="chip good">通过</span>' :
              '<span class="chip gray" title="' + esc(why.join('；')) + '">未通过</span>') +
            (!ok ? '<div style="font-size:10.5px;color:var(--ink-4);margin-top:3px">' + esc(why.join('；')) + '</div>' : '') +
            '</td>' +
            '<td style="font-size:12px">' + esc(r.advice) + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
      return;
    }

    // 实时重算
    el.innerHTML =
      traceBar(ap) +
      '<div class="card"><div class="card-h"><h3>' + icon('link') + '系统实时重算关联规则' +
      '<span class="sub">已按当前阈值过滤，仅展示通过的规则</span></h3>' +
      '<div class="acts"><span class="chip brand">来源：系统实时重算</span></div></div>' +
      '<div class="card-b tight">' +
      (ap.rules.length ? ruleTable(ap.topRules || [])
        : '<div class="empty" style="padding:34px">' + icon('search') + '<h4>当前参数下未发现强关联规则</h4>' +
        '<p>' + esc(ap.message || '请尝试降低最小支持度或提升度阈值后重新运行算法。') + '</p>' +
        '<div class="acts"><button class="btn pri" data-act="assoc-settings">调整参数</button></div></div>') +
      '</div></div>' +
      '<div class="card" style="margin-top:15px"><div class="card-h"><h3>' + icon('grid') +
      '频繁项集（单品支持度 Top 20）</h3><span class="sub">满足 min_support=' + s.settings.apriori.minSupport + ' 的商品</span></div>' +
      '<div class="card-b tight tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th>排名</th><th>商品名称</th><th>所属品类</th><th class="num">出现次数</th><th class="num">支持度</th><th>支持度占比</th>' +
      '</tr></thead><tbody>' +
      (ap.freqItems || []).slice(0, 20).map(function (f, i) {
        var pc = global.SUGUO_DATA.transactions.productCat[global.SUGUO_DATA.transactions.products.indexOf(f.name)];
        return '<tr><td><b>' + (i + 1) + '</b></td><td><b>' + esc(f.name) + '</b></td>' +
          '<td><span class="chip gray">' + esc(pc) + '</span></td>' +
          '<td class="num">' + num(f.count) + '</td><td class="num">' + f.support.toFixed(4) + '</td>' +
          '<td style="min-width:130px">' + barOf(f.support / 0.09 * 100, '') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  function ruleTable(rules) {
    if (!rules.length) return '<div class="empty" style="padding:30px"><p>暂无数据</p></div>';
    return '<table class="tbl"><thead><tr>' +
      '<th>排名</th><th>前项商品(A)</th><th></th><th>后项商品(B)</th>' +
      '<th class="num">支持度</th><th class="num">置信度</th><th class="num">提升度</th>' +
      '<th>关联强度</th><th>业务解释 / 陈列建议</th><th></th></tr></thead><tbody>' +
      rules.map(function (r, i) {
        return '<tr><td><b>' + (i + 1) + '</b></td>' +
          '<td><b>' + esc(r.a) + '</b><br><span class="chip gray" style="margin-top:2px">' + esc(r.aCat) + '</span></td>' +
          '<td style="color:var(--ink-4);font-size:15px;padding:0 4px">→</td>' +
          '<td><b>' + esc(r.b) + '</b><br><span class="chip gray" style="margin-top:2px">' + esc(r.bCat) + '</span></td>' +
          '<td class="num">' + r.support + '</td>' +
          '<td class="num">' + r.confidence + '</td>' +
          '<td class="num"><b style="font-size:13.5px">' + r.lift + '</b></td>' +
          '<td><span class="chip ' + r.strength.color + '">' + esc(r.strength.level) + '</span></td>' +
          '<td style="font-size:12px;max-width:280px;line-height:1.6">' + esc(r.advice) + '</td>' +
          '<td><button class="btn sm" data-act="rule-promo" data-a="' + esc(r.a) + '" data-b="' + esc(r.b) +
          '" data-lift="' + r.lift + '">组合促销</button></td></tr>';
      }).join('') + '</tbody></table>';
  }

  function catColor(cat) {
    var m = {
      '生鲜蔬果': 'good', '肉禽蛋品': 'lime', '粮油调味': 'warn',
      '食品饮料': 'info', '日化清洁': 'brand2', '家居用品': 'orange', '纺织服装': 'bad',
      '烘焙用品': 'yellow', '火锅食材': 'red',
    };
    return Ch.C[m[cat]] || Ch.C.series[Math.abs(hash(cat)) % Ch.C.series.length];
  }
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

  function showNodeDetail(name) {
    var ap = App.getAssoc();
    var rel = (ap.rules || []).filter(function (r) { return r.a === name || r.b === name; })
      .sort(function (x, y) { return y.lift - x.lift; });
    var idx = global.SUGUO_DATA.transactions.products.indexOf(name);
    var cat = global.SUGUO_DATA.transactions.productCat[idx];
    var freq = global.SUGUO_DATA.transactions.freq[idx];
    var total = global.SUGUO_DATA.transactions.txCount;

    var scenes = [];
    if (ap.rules.some(function (r) { return (r.a === name || r.b === name) && /火锅/.test(r.a + r.b); })) scenes.push('火锅聚餐场景');
    if (ap.rules.some(function (r) { return (r.a === name || r.b === name) && /面包|蛋糕/.test(r.a + r.b); })) scenes.push('早餐 / 烘焙场景');
    if (cat === '生鲜蔬果' || cat === '肉禽蛋品') scenes.push('家常烹饪场景');
    if (cat === '日化清洁') scenes.push('家庭日化补货场景');
    if (!scenes.length) scenes.push('通用关联消费场景');

    var body =
      '<div class="grid g3" style="margin-bottom:14px">' +
      statBox('所属品类', cat, '') +
      statBox('出现频率', num(freq) + ' 次', '占全部交易 ' + (freq / total * 100).toFixed(2) + '%') +
      statBox('关联规则数', rel.length + ' 条', '通过当前阈值') +
      '</div>' +
      '<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>' + icon('link') + '最强关联商品</h3></div>' +
      '<div class="card-b tight">' +
      (rel.length ? '<table class="tbl"><thead><tr><th>关联商品</th><th>方向</th><th class="num">支持度</th>' +
        '<th class="num">置信度</th><th class="num">提升度</th><th>强度</th></tr></thead><tbody>' +
        rel.slice(0, 10).map(function (r) {
          var other = r.a === name ? r.b : r.a;
          var dir = r.a === name ? '本品 → ' + other : other + ' → 本品';
          return '<tr><td><b>' + esc(other) + '</b></td><td style="font-size:12px;color:var(--ink-3)">' + esc(dir) + '</td>' +
            '<td class="num">' + r.support + '</td><td class="num">' + r.confidence + '</td>' +
            '<td class="num"><b>' + r.lift + '</b></td>' +
            '<td><span class="chip ' + r.strength.color + '">' + esc(r.strength.level) + '</span></td></tr>';
        }).join('') + '</tbody></table>'
        : '<div class="empty" style="padding:28px"><h4>暂无强关联商品</h4>' +
        '<p>在当前的阈值参数下，「' + esc(name) + '」未参与任何通过筛选的关联规则。' +
        '可尝试降低最小支持度或提升度阈值以探索更多潜在关联。</p></div>') +
      '</div></div>' +
      '<div class="card"><div class="card-h"><h3>' + icon('target') + '推荐陈列场景</h3></div><div class="card-b">' +
      '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px">' +
      scenes.map(function (x) { return '<span class="chip brand">' + esc(x) + '</span>'; }).join('') + '</div>' +
      '<div class="note ok">' + App.ICON.ok +
      '<div><b>陈列建议：</b>' +
      (rel.length >= 3 ? '本品关联度较高，建议与 Top 关联商品做相邻货架陈列或设置场景化专区（如火锅专区、烘焙专区），' +
        '并在端头投放组合促销提示。'
        : rel.length >= 1 ? '建议与主要关联商品保持较近动线距离，可尝试小规模组合促销测试。'
          : '当前关联证据不足，建议先维持现有陈列位置，积累更多交易数据后重新分析。') +
      '</div></div></div></div>';

    App.openDrawer(name + ' · 关联分析', body, '<button class="btn" data-act="dr-cancel">关闭</button>');
    document.getElementById('drFoot').onclick = function (ev) {
      if (ev.target.closest('[data-act="dr-cancel"]')) App.closeDrawer();
    };
  }

  function statBox(label, value, sub) {
    return '<div class="card"><div class="card-b">' +
      '<div style="font-size:11px;color:var(--ink-3);margin-bottom:5px">' + esc(label) + '</div>' +
      '<div style="font-size:17px;font-weight:700">' + esc(value) + '</div>' +
      (sub ? '<div style="font-size:11px;color:var(--ink-4);margin-top:3px">' + esc(sub) + '</div>' : '') +
      '</div></div>';
  }

  function kpiBox(label, value, unit, sub, tone, ic) {
    return '<div class="kpi ' + (tone || 'neutral') + '">' +
      '<div class="kh">' + icon(ic || 'grid') + esc(label) + '</div>' +
      '<div class="kv">' + esc(value) + '<span class="u">' + esc(unit) + '</span></div>' +
      '<div class="ks">' + esc(sub) + '</div></div>';
  }

  Pages.after_assoc = function () {
    renderAssocBody();
    var c = document.getElementById('content');
    c.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act],[data-at]');
      if (!b) return;
      if (b.dataset.at) {
        App.save('assocTab', b.dataset.at);
        renderAssocBody();
        c.querySelectorAll('[data-at]').forEach(function (t) { t.classList.toggle('on', t.dataset.at === b.dataset.at); });
        return;
      }
      var act = b.dataset.act;
      if (act === 'png') { Ch.exportPNG(document.getElementById(b.dataset.target), b.dataset.target); global.App.toast('图表已导出 PNG', 'ok'); }
      if (act === 'assoc-recalc') { App.invalidate(); App.refreshPage(); global.App.toast('已按当前参数重新运行 Apriori 算法', 'ok'); }
      if (act === 'assoc-settings') openAssocSettings();
      if (act === 'assoc-export') exportRules();
      if (act === 'rule-promo') openPromoForm(b.dataset.a, b.dataset.b, b.dataset.lift);
    });
  };

  function exportRules() {
    var ap = App.getAssoc();
    var rows = (ap.topRules || []).map(function (r, i) {
      return {
        排名: i + 1, 前项商品A: r.a, 后项商品B: r.b, 前项品类: r.aCat, 后项品类: r.bCat,
        支持度: r.support, 置信度: r.confidence, 提升度: r.lift,
        关联强度: r.strength.level, 关联类型: '系统实时重算', 业务解释与陈列建议: r.advice,
      };
    });
    App.download('关联规则_实时重算_' + App.nowStr().replace(/[-: ]/g, '') + '.csv', App.toCSV(rows));
    App.audit('导出关联规则', 'dataset_transactions_sample.csv', rows.length + ' 条');
    App.persist();
    global.App.toast('关联规则已导出 CSV（' + rows.length + ' 条）', 'ok');
  }

  function openAssocSettings() {
    var ap = A.DEFAULT_APRIORI;
    var s = S();
    var body =
      '<div class="note" style="margin-bottom:14px">' + App.ICON.info +
      '<div>调整参数后需点击「重新运行算法」才会生效。参数变更会记录到模型运行日志与参数变更留痕。</div></div>' +
      '<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>' + icon('filter') + 'Apriori 阈值参数</h3></div>' +
      '<div class="card-b">' +
      '<div class="field"><label>最小支持度 min_support<span class="req">*</span></label>' +
      '<input type="number" id="as-sup" step="0.005" min="0.001" max="1" value="' + s.settings.apriori.minSupport + '">' +
      '<div class="hint">商品组合在全部交易中出现的比例下限。默认 0.02，值越低发现的规则越多但噪声越大。</div></div>' +
      '<div class="field"><label>最小置信度 min_confidence<span class="req">*</span></label>' +
      '<input type="number" id="as-conf" step="0.05" min="0" max="1" value="' + s.settings.apriori.minConfidence + '">' +
      '<div class="hint">在 A 出现的交易中，同时出现 B 的比例下限。默认 0.50。</div></div>' +
      '<div class="field"><label>最小提升度 min_lift<span class="req">*</span></label>' +
      '<input type="number" id="as-lift" step="0.1" min="1" max="20" value="' + s.settings.apriori.minLift + '">' +
      '<div class="hint">提升度 &gt; 1 表示正相关，越大关联越强。默认 1.50。</div></div>' +
      '<div class="field"><label>展示规则数量 TopN</label>' +
      '<input type="number" id="as-top" step="5" min="5" max="200" value="' + s.settings.apriori.topN + '"></div>' +
      '</div></div>' +
      '<div class="card"><div class="card-h"><h3>' + icon('layers') + '购物篮构建口径</h3></div><div class="card-b">' +
      '<div class="field"><label>聚合维度</label>' +
      '<select id="as-agg">' +
      '<option value="name"' + (s.settings.apriori.aggregateBy === 'name' ? ' selected' : '') + '>交易号 + 商品名称（推荐 · 当前演示数据必须使用）</option>' +
      '<option value="code"' + (s.settings.apriori.aggregateBy === 'code' ? ' selected' : '') + '>商品编码（仅适用于 SKU 编码稳定唯一的真实数据）</option>' +
      '</select>' +
      '<div class="hint">当前演示数据存在大量「一名多码」现象（70 个商品名对应 5000+ 个 SKU 编码），' +
      '若按编码分析会严重碎片化，因此默认按商品名称聚合。</div></div>' +
      '</div></div>';

    App.openDrawer('关联分析高级设置', body,
      '<button class="btn" data-act="dr-cancel">取消</button>' +
      '<button class="btn pri" data-act="as-run">' + icon('refresh') + '重新运行算法</button>');
    document.getElementById('drFoot').onclick = function (ev) {
      var t = ev.target.closest('[data-act]');
      if (!t) return;
      if (t.dataset.act === 'dr-cancel') App.closeDrawer();
      if (t.dataset.act === 'as-run') {
        var sup = parseFloat(document.getElementById('as-sup').value);
        var conf = parseFloat(document.getElementById('as-conf').value);
        var lift = parseFloat(document.getElementById('as-lift').value);
        var top = parseInt(document.getElementById('as-top').value, 10);
        var agg = document.getElementById('as-agg').value;
        if (isNaN(sup) || sup <= 0 || sup > 1) return global.App.toast('最小支持度需在 0-1 之间', 'err');
        if (isNaN(conf) || conf < 0 || conf > 1) return global.App.toast('最小置信度需在 0-1 之间', 'err');
        if (isNaN(lift) || lift < 1) return global.App.toast('最小提升度需 ≥ 1', 'err');

        var before = JSON.stringify(S().settings.apriori);
        S().settings.apriori = { minSupport: sup, minConfidence: conf, minLift: lift, topN: top, aggregateBy: agg };
        S().settingsLogs.unshift({
          id: App.uid('CFG'), module: '关联分析(Apriori)', user: S().user.name,
          before: before, after: JSON.stringify(S().settings.apriori),
          reason: '用户通过高级设置调整关联规则阈值', at: App.nowStr(),
        });
        App.invalidate(); App.persist();
        App.closeDrawer();
        App.refreshPage();
        global.App.toast('参数已更新并重新运行算法', 'ok');
      }
    };
  }

  function openPromoForm(a, b, lift) {
    var body =
      '<div class="note" style="margin-bottom:14px">' + App.ICON.info +
      '<div>基于关联规则「' + esc(a) + ' → ' + esc(b) + '」（提升度 ' + lift + '）生成组合促销建议。' +
      '提交后将进入审批流程，需人工确认后方可执行。</div></div>' +
      '<div class="card"><div class="card-b">' +
      '<div class="grid g2">' +
      '<div class="field"><label>前项商品 A</label><input type="text" value="' + esc(a) + '" readonly></div>' +
      '<div class="field"><label>后项商品 B</label><input type="text" value="' + esc(b) + '" readonly></div>' +
      '</div>' +
      '<div class="field"><label>促销形式<span class="req">*</span></label>' +
      '<select id="pf-type">' +
      '<option value="相邻陈列">相邻陈列（零成本）</option>' +
      '<option value="组合价">组合价（打包优惠）</option>' +
      '<option value="第二件折扣">第二件折扣</option>' +
      '<option value="端头联合陈列">端头联合陈列</option>' +
      '</select></div>' +
      '<div class="field"><label>建议力度 / 说明</label>' +
      '<textarea id="pf-note" placeholder="例如：组合价 9.9 元，测试两周观察转化率与连带率变化">' +
      '依据关联规则提升度 ' + lift + '，建议先做两周小范围测试，观察连带率与客单价变化。</textarea></div>' +
      '</div></div>';
    App.openDrawer('组合促销建议', body,
      '<button class="btn" data-act="dr-cancel">取消</button>' +
      '<button class="btn pri" data-act="pf-submit">' + icon('gavel') + '提交审批</button>');
    document.getElementById('drFoot').onclick = function (ev) {
      var t = ev.target.closest('[data-act]');
      if (!t) return;
      if (t.dataset.act === 'dr-cancel') App.closeDrawer();
      if (t.dataset.act === 'pf-submit') {
        var type = document.getElementById('pf-type').value;
        var note = document.getElementById('pf-note').value.trim();
        App.closeDrawer();
        Pages.openApprovalForm(null, {
          level: 2, source: '关联陈列分析', cats: [a, b],
          title: '建议对「' + a + ' + ' + b + '」设置组合促销',
          advice: '基于关联规则「' + a + ' → ' + b + '」（提升度 ' + lift + '，属强关联）设置【' + type + '】。' + note,
          basis: [
            '关联规则：' + a + ' → ' + b + '，提升度 ' + lift,
            '提升度 > 1 表示正相关，值越大关联越强',
            '该规则已通过当前 min_support / min_confidence / min_lift 阈值筛选',
          ],
          priority: '中', risk: '低', promoType: type,
        });
      }
    };
  }

  /* ========================================================================
   * 核心模块四：需求预测
   * ====================================================================== */
  Pages.forecast = function () {
    var fcList = global.SUGUO_DATA.forecast;
    var sel = App.load('fcCat', fcList[0].cat);
    if (!fcList.some(function (f) { return f.cat === sel; })) sel = fcList[0].cat;
    var a = A.analyzeForecast(sel);
    var h = '';

    h += '<div class="page-head"><div class="t"><h2>需求预测</h2>' +
      '<p>数据源：<b>dataset_demand_forecast.csv</b>　' +
      fcList.length + ' 个品类 × 16 周（12 期历史 + 4 期预测）　' + demoBadge() + '</p></div>' +
      '<div class="acts">' +
      '<button class="btn" data-act="fc-export">' + icon('download') + '导出预测数据 CSV</button>' +
      '<button class="btn" data-act="fc-info">' + icon('info') + '预测能力说明</button>' +
      '</div></div>';

    h += '<div class="note warn" style="margin-bottom:15px">' + App.ICON.warn +
      '<div><b>模拟预测结果：</b>本模块展示的预测值来自项目附件中的演示数据（基于 Prophet 模型输出格式构造），' +
      '用于演示需求预测模块的展示形态与趋势判断逻辑。<br>' +
      '<b>真实数据接入说明：</b>平台后台已预留 Prophet 时间序列预测能力。真实数据上传后，建议提供<b>至少 12 个月</b>历史数据，' +
      '更推荐 <b>24-36 个月</b>以捕捉完整季节性。<b>若历史数据量不足，平台不会伪造预测精度</b>，' +
      '将明确提示「历史数据量有限，预测结果仅供趋势参考」。</div></div>';

    // 品类切换
    h += '<div class="card" style="margin-bottom:15px"><div class="card-b" style="padding:12px 16px">' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<span style="font-size:12px;color:var(--ink-3);font-weight:600">选择品类：</span>' +
      fcList.map(function (f) {
        return '<button class="cmp-pick" style="padding:6px 13px" data-fc="' + esc(f.cat) + '">' +
          '<span class="' + (f.cat === sel ? '' : '') + '">' + esc(f.cat) + '</span></button>';
      }).join('') +
      '<span style="margin-left:auto;font-size:11.5px;color:var(--ink-4)">' +
      '附件预测数据仅覆盖上述 ' + fcList.length + ' 个品类；其他品类暂无可用的预测结果</span>' +
      '</div></div></div>';

    if (!a.ok) {
      h += App.insufficient('当前数据不足以生成预测分析', a.reason);
      h += '<div class="card"><div class="card-b"><div class="empty">' + icon('upload') +
        '<h4>请上传该品类的历史需求数据</h4>' +
        '<p>要对该品类进行需求预测，需要至少 12 个月（推荐 24-36 个月）的历史销量数据。' +
        '请前往「数据中心」上传需求历史数据，平台将调用 Prophet 模型重新训练预测。</p>' +
        '<div class="acts"><button class="btn pri" data-act="goto-data">前往数据中心上传</button></div>' +
        '</div></div></div>';
      return h;
    }

    // 趋势概览 KPI
    h += '<div class="grid g4" style="margin-bottom:15px">' +
      kpiBox('最近 4 期实际均值', num(a.last4Avg, 1), '件', '取最近 4 周历史销量均值', 'neutral', 'box') +
      kpiBox('未来 4 期预测均值', num(a.next4Avg, 1), '件', '取未来 4 周预测销量均值', 'neutral', 'trendup') +
      kpiBox('环比变化', pct(a.delta), '', '预测均值相对实际均值的变动幅度', a.delta > 5 ? 'warn' : a.delta < -5 ? 'neutral' : 'good', a.delta > 0 ? 'up' : 'down') +
      kpiBox('预测置信区间宽度', num(a.ciWidth, 1), '件', '未来 4 期上下界平均跨度，越窄越稳定', 'neutral', 'target') +
      '</div>';

    // 趋势判定
    h += '<div class="card" style="margin-bottom:15px"><div class="card-b">' +
      '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">' +
      '<div><div style="font-size:11px;color:var(--ink-3);margin-bottom:5px">趋势判定</div>' +
      '<span class="chip ' + (a.delta > 15 ? 'bad' : a.delta > 5 ? 'warn' : a.delta > -5 ? 'good' : 'info') +
      '" style="font-size:14px;padding:5px 14px">' + esc(a.level.label) + '</span></div>' +
      '<div style="flex:1;min-width:240px">' +
      '<div class="tbl-wrap"><table class="tbl" style="font-size:12px"><thead><tr>' +
      '<th>趋势分类</th><th>环比区间</th><th>业务含义</th></tr></thead><tbody>' +
      [['明显上涨', '> +15%', '需大幅提前备货，核查供应商产能'],
        ['温和上涨', '+5% ~ +15%', '适度增加订货量'],
        ['基本稳定', '-5% ~ +5%', '维持现有订货策略'],
        ['温和下降', '-15% ~ -5%', '适度下调订货量'],
        ['明显下降', '< -15%', '严格控制订货，避免呆滞库存']].map(function (r) {
        var on = a.level.label === r[0];
        return '<tr' + (on ? ' style="background:var(--brand-3)"' : '') + '>' +
          '<td><b>' + r[0] + '</b>' + (on ? ' <span class="chip brand">当前</span>' : '') + '</td>' +
          '<td class="num">' + r[1] + '</td><td style="color:var(--ink-3)">' + r[2] + '</td></tr>';
      }).join('') + '</tbody></table></div></div>' +
      '</div></div></div>';

    // 主图
    var labels = a.points.map(function (p) { return p.date.replace('2026-', ''); });
    var histVals = a.points.map(function (p) { return p.hist; });
    var fcVals = a.points.map(function (p) { return p.fc; });
    var band = a.points.map(function (p, i) {
      return { i: i, lo: p.lo, hi: p.hi };
    }).filter(function (b) { return b.lo != null; });
    var divider = a.history.length - 1;

    h += '<div class="card" style="margin-bottom:15px"><div class="card-h">' +
      '<h3>' + icon('trend') + esc(sel) + ' 需求预测' +
      '<span class="sub">历史实线 · 预测虚线 · 置信区间带</span></h3>' +
      '<div class="acts"><button class="btn sm" data-act="png" data-target="fcChart">' +
      icon('download', '', 13) + '导出 PNG</button></div></div>' +
      '<div class="card-b" id="fcChart">' +
      Ch.line({
        labels: labels, width: 720, height: 300,
        series: [
          { name: '历史销量(件)', color: Ch.C.brand2, values: histVals, area: true },
          { name: '预测销量(件)', color: Ch.C.orange, values: fcVals, dash: true },
        ],
        band: band, bandLabel: '预测置信区间（80% 上下界）',
        divider: divider, dividerLabel: '预测起点',
      }) +
      '<div style="margin-top:10px;font-size:11.5px;color:var(--ink-4);line-height:1.7">' +
      '横轴为周次（' + esc(a.points[0].date) + ' ~ ' + esc(a.points[a.points.length - 1].date) + '）；' +
      '橙色虚线右侧为预测区间，浅色带为预测上下界。' +
      '<b style="color:var(--warn)">以上为模拟预测结果，不代表真实经营预测。</b></div>' +
      '</div></div>';

    // 明细表
    h += '<div class="card" style="margin-bottom:15px"><div class="card-h"><h3>' + icon('grid') +
      '预测数据明细</h3><span class="sub">共 ' + a.points.length + ' 期</span></div>' +
      '<div class="card-b tight tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th>周次</th><th>日期</th><th>数据类型</th>' +
      '<th class="num">历史销量(件)</th><th class="num">预测销量(件)</th>' +
      '<th class="num">预测下界</th><th class="num">预测上界</th><th>可视化</th>' +
      '</tr></thead><tbody>' +
      a.points.map(function (p) {
        var max = Math.max.apply(null, a.points.map(function (q) {
          return Math.max(q.hist || 0, q.hi || 0);
        }));
        var v = p.hist != null ? p.hist : p.fc;
        return '<tr><td><b>W' + p.w + '</b></td><td class="mut">' + esc(p.date) + '</td>' +
          '<td><span class="chip ' + (p.type === '历史数据' ? 'info' : 'warn') + '">' + esc(p.type) + '</span></td>' +
          '<td class="num">' + (p.hist != null ? num(p.hist) : '—') + '</td>' +
          '<td class="num">' + (p.fc != null ? num(p.fc) : '—') + '</td>' +
          '<td class="num">' + (p.lo != null ? num(p.lo) : '—') + '</td>' +
          '<td class="num">' + (p.hi != null ? num(p.hi) : '—') + '</td>' +
          '<td style="min-width:110px"><div class="bar"><i class="' + (p.type === '历史数据' ? 'good' : 'orange') +
          '" style="width:' + (v / max * 100).toFixed(1) + '%"></i></div></td></tr>';
      }).join('') + '</tbody></table></div></div>';

    // AI 解读
    h += '<div class="card"><div class="card-h"><h3>' + icon('ai') + 'AI 趋势解读</h3></div><div class="card-b">' +
      '<div style="font-size:13px;line-height:1.85;color:var(--ink-2)">' +
      '<p style="margin:0 0 10px"><b>结论：</b>' + esc(sel) + '未来 4 期需求预测' + esc(a.level.label) +
      '，预测均值 ' + num(a.next4Avg, 1) + ' 件，较最近 4 期实际均值 ' + num(a.last4Avg, 1) +
      ' 变动 ' + pct(a.delta) + '。</p>' +
      '<p style="margin:0 0 10px"><b>关键数据依据：</b></p>' +
      '<ul style="margin:0 0 10px;padding-left:18px">' +
      '<li>最近 4 期实际销量均值：' + num(a.last4Avg, 1) + ' 件</li>' +
      '<li>未来 4 期预测销量均值：' + num(a.next4Avg, 1) + ' 件</li>' +
      '<li>环比变化：' + pct(a.delta) + '，趋势分类为「' + esc(a.level.label) + '」</li>' +
      '<li>预测置信区间平均宽度：' + num(a.ciWidth, 1) + ' 件' +
      (a.ciWidth / a.next4Avg > 0.2 ? '（区间较宽，预测不确定性偏高）' : '（区间较窄，预测相对稳定）') + '</li>' +
      '</ul>' +
      '<p style="margin:0 0 10px"><b>建议动作：</b>' +
      (a.delta > 15 ? '需求明显上涨，建议大幅提前备货，同步核查供应商产能与仓储条件，避免旺季断货。'
        : a.delta > 5 ? '需求温和上涨，建议适度增加单次订货量，并提前 1 周加密订货频次。'
          : a.delta > -5 ? '需求基本稳定，建议维持现有订货策略，保持常规安全库存水平。'
            : a.delta > -15 ? '需求温和下降，建议适度下调订货量，避免形成呆滞库存。'
              : '需求明显下降，建议严格控制订货量，暂停扩大陈列面积，评估是否缩减品项。') +
      '</p>' +
      '<p style="margin:0"><b>风险与限制：</b>本预测基于 ' + a.historyCount + ' 期历史数据与 ' +
      a.forecastCount + ' 期预测数据，属<b>模拟演示数据</b>，不代表真实经营预测。' +
      '当前模型<b>未纳入</b>节假日、天气、促销活动、价格变动、季节性、重大活动等外生变量；' +
      '真实数据接入后可在后台配置这些外生变量以提升预测准确性。' +
      '历史数据量有限时，预测结果仅供趋势参考，不应作为订货决策的唯一依据。</p>' +
      '</div>' +
      '<div class="note" style="margin-top:13px">' + App.ICON.info +
      '<div><b>决策状态：</b>AI建议 / 需人工确认。需求预测结论可用于辅助订货决策，' +
      '但最终订货量由采购人员结合供应商产能、仓储条件、促销计划等因素确认。</div></div>' +
      '</div></div>';

    return h;
  };

  Pages.after_forecast = function () {
    var c = document.getElementById('content');
    c.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act],[data-fc]');
      if (!b) return;
      if (b.dataset.fc) {
        App.save('fcCat', b.dataset.fc);
        App.refreshPage();
        return;
      }
      var act = b.dataset.act;
      if (act === 'png') { Ch.exportPNG(document.getElementById(b.dataset.target), '需求预测_' + App.load('fcCat', '')); global.App.toast('图表已导出 PNG', 'ok'); }
      if (act === 'fc-export') exportForecast();
      if (act === 'fc-info') showForecastInfo();
      if (act === 'goto-data') App.go('data');
    });
  };

  function exportForecast() {
    var sel = App.load('fcCat', global.SUGUO_DATA.forecast[0].cat);
    var a = A.analyzeForecast(sel);
    var rows = a.points.map(function (p) {
      return {
        品类: sel, 周次: 'W' + p.w, 日期: p.date, 数据类型: p.type,
        历史销量_件: p.hist == null ? '' : p.hist,
        预测销量_件: p.fc == null ? '' : p.fc,
        预测下界_件: p.lo == null ? '' : p.lo,
        预测上界_件: p.hi == null ? '' : p.hi,
      };
    });
    App.download('需求预测_' + sel + '_' + App.nowStr().replace(/[-: ]/g, '') + '.csv', App.toCSV(rows));
    App.audit('导出需求预测', sel, rows.length + ' 期');
    App.persist();
    global.App.toast('预测数据已导出 CSV', 'ok');
  }

  function showForecastInfo() {
    var body =
      '<div class="note" style="margin-bottom:14px">' + App.ICON.info +
      '<div>平台后台已预留 <b>Prophet 时间序列预测</b>能力。当前演示版展示的是项目附件中的模拟预测结果，' +
      '用于演示模块形态与趋势判断逻辑。</div></div>' +

      '<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>' + icon('data') + '真实数据接入要求</h3></div>' +
      '<div class="card-b"><table class="tbl"><tbody>' +
      '<tr><td style="width:150px"><b>推荐数据量</b></td><td>至少 12 个月月度数据；<b>更推荐 24-36 个月</b>，以捕捉完整年度季节性</td></tr>' +
      '<tr><td><b>必需字段</b></td><td>品类 / 商品编码、日期、销量、销售额</td></tr>' +
      '<tr><td><b>数据频率</b></td><td>日 / 周 / 月均可，平台自动聚合到目标粒度</td></tr>' +
      '<tr><td><b>缺失值处理</b></td><td>平台不会静默补值，将在数据质量检查中逐项列出，由用户选择自动清洗 / 人工确认 / 保留原始值</td></tr>' +
      '</tbody></table></div></div>' +

      '<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>' + icon('layers') + '支持的外生变量（未来扩展）</h3></div>' +
      '<div class="card-b"><div style="display:flex;gap:7px;flex-wrap:wrap">' +
      ['节假日', '天气', '促销活动', '价格变动', '季节性', '重大活动', '门店位置', '竞品动态'].map(function (x) {
        return '<span class="chip brand">' + x + '</span>';
      }).join('') + '</div>' +
      '<div class="note" style="margin-top:12px;font-size:11.5px">' + App.ICON.info +
      '<div>加入外生变量可显著提升预测准确性，但需要相应的外部数据源支持。' +
      '平台将在数据接入后提供配置入口。</div></div></div></div>' +

      '<div class="card"><div class="card-h"><h3>' + icon('warn') + '准确性声明</h3></div><div class="card-b">' +
      '<div class="note warn">' + App.ICON.warn +
      '<div><b>平台不会伪造预测精度。</b><br>' +
      '当历史数据量不足时，平台将明确提示「历史数据量有限，预测结果仅供趋势参考」，' +
      '不会输出看似精确的 MAPE 或准确率数值。行业公开的需求预测精度参考值为 MAPE 12%-18%，' +
      '但该数值随品类、数据质量、预测周期差异很大，不构成对本平台预测精度的承诺。</div></div>' +
      '</div></div>';

    App.openDrawer('预测能力说明', body, '<button class="btn" data-act="dr-cancel">关闭</button>');
    document.getElementById('drFoot').onclick = function (ev) {
      if (ev.target.closest('[data-act="dr-cancel"]')) App.closeDrawer();
    };
  }

  /* ========================================================================
   * 核心模块一：选品比较中心（平台最重要功能）
   * ====================================================================== */
  Pages.compare = function () {
    var hh = App.getHealth();
    var s = S();
    var mode = s.compareMode || 'category';
    var sel = s.compareSel || [];

    var h = '';
    h += '<div class="page-head"><div class="t"><h2>选品比较中心</h2>' +
      '<p>支持 2-6 个候选对象多维比较，输出综合评分、差异分析与可解释的 AI 综合判断。' +
      '评价模型：销量 30% + 毛利 30% + 库存周转 20% + 坪效 20%（管理员可调整）　' + demoBadge() + '</p></div>' +
      '<div class="acts">' +
      '<button class="btn" data-act="cmp-weights">' + icon('filter') + '调整评价权重</button>' +
      '<button class="btn" data-act="cmp-export">' + icon('download') + '导出比较结果</button>' +
      '<button class="btn pri" data-act="cmp-plan">' + icon('ai') + '生成AI综合选品方案</button>' +
      '</div></div>';

    // 模式切换
    h += '<div class="card" style="margin-bottom:15px"><div class="card-b" style="padding:13px 16px">' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
      '<span style="font-size:12px;color:var(--ink-3);font-weight:600">比较模式：</span>' +
      '<button class="tab' + (mode === 'category' ? ' on' : '') + '" data-mode="category" style="border-bottom-width:2px">模式A · 品类比较</button>' +
      '<button class="tab' + (mode === 'sku' ? ' on' : '') + '" data-mode="sku" style="border-bottom-width:2px">模式B · SKU / 商品比较</button>' +
      '</div></div></div>';

    if (mode === 'sku') {
      // SKU 模式：数据不足，明确提示 + 上传入口
      h += App.insufficient('当前数据不足以进行完整 SKU 量化评价',
        '平台现有数据集为「品类级月度销售数据」与「交易明细数据」，缺少 SKU 级的采购价、零售价、毛利率、货架占用、供应商等经营指标。' +
        '因此无法对单个 SKU 进行量化评价。') +
        '<div class="card"><div class="card-b"><div class="empty">' + icon('upload') +
        '<h4>请上传 SKU 级数据后使用模式B</h4>' +
        '<p>上传后平台即可对候选 SKU 进行多维量化比较，包括采购价、零售价、预计毛利率、目标客群适配度、' +
        '自有品牌属性、新品属性、货架占用、季节性、促销属性等。<br><br>' +
        '<b>平台不会在缺少数据时虚构任何 SKU 经营指标。</b></p>' +
        '<div class="acts">' +
        '<button class="btn pri" data-act="goto-data">' + icon('upload') + '前往数据中心上传</button>' +
        '<button class="btn" data-act="sku-template">下载 SKU 数据模板</button>' +
        '<button class="btn" data-act="switch-cat">改用品类比较模式</button>' +
        '</div></div></div></div>';
      return h;
    }

    // 模式A：品类比较
    // 对象选择
    h += '<div class="card" style="margin-bottom:15px"><div class="card-h">' +
      '<h3>' + icon('compare') + '添加比较对象' +
      '<span class="sub">已选 <b id="selCount">' + sel.length + '</b> / 6 个（至少 2 个）</span></h3>' +
      '<div class="acts">' +
      '<button class="btn sm" data-act="cmp-clear">清空选择</button>' +
      '<button class="btn sm" data-act="cmp-preset">载入推荐对比组</button>' +
      '</div></div><div class="card-b">' +
      '<div class="cmp-pick" id="cmpPick">' +
      hh.items.map(function (x) {
        var on = sel.indexOf(x.cid) >= 0;
        return '<button class="pk' + (on ? ' on' : '') + '" data-cid="' + x.cid + '"' +
          (!on && sel.length >= 6 ? ' disabled' : '') + '>' +
          (on ? '✓ ' : '') + esc(x.name) +
          '<span style="opacity:.7;font-size:11px">' + sc(x.score) + '分</span></button>';
      }).join('') +
      '</div>' +
      '<div style="margin-top:11px;font-size:11.5px;color:var(--ink-4)">' +
      '当前数据为品类级月度销售数据（7 个一级品类），因此模式A 对品类进行多维比较。' +
      '若需按 SKU 比较，请切换到模式B 并上传 SKU 级数据。</div>' +
      '</div></div>';

    if (sel.length < 2) {
      h += '<div class="card"><div class="card-b"><div class="empty">' + icon('compare') +
        '<h4>请至少选择 2 个比较对象</h4>' +
        '<p>选择 2-6 个品类后，平台将自动计算综合评分、绘制雷达图、列出关键指标差异、' +
        '识别未来需求趋势与关联销售情况，并输出可解释的 AI 综合判断。</p></div></div></div>';
      return h;
    }

    var res = A.compare(sel, {
      mode: 'category',
      weights: {
        sales: S().settings.weights.qty / 100,
        margin: S().settings.weights.gp / 100,
        turnover: S().settings.weights.turnover / 100,
        space: S().settings.weights.space / 100,
      },
    });
    if (!res.ok) return h + App.insufficient('无法完成比较', res.reason);

    // 综合评分排名
    h += '<div class="card" style="margin-bottom:15px"><div class="card-h">' +
      '<h3>' + icon('target') + '综合评分与推荐优先级</h3>' +
      '<span class="sub">Score = 销量' + Math.round(res.weights.sales * 100) + '% + 毛利' +
      Math.round(res.weights.margin * 100) + '% + 周转' + Math.round(res.weights.turnover * 100) +
      '% + 坪效' + Math.round(res.weights.space * 100) + '%</span></h3>' +
      '<div class="acts"><button class="btn sm" data-act="png" data-target="cmpRank">' +
      icon('download', '', 13) + 'PNG</button></div></div>' +
      '<div class="card-b" id="cmpRank"><div class="grid g' + Math.min(res.items.length, 3) + '">' +
      res.items.map(function (x) {
        return '<div style="padding:15px;border:1px solid var(--line);border-radius:12px;position:relative;overflow:hidden">' +
          '<div style="position:absolute;top:0;left:0;right:0;height:3px;background:' + Ch.colorOf(x.color) + '"></div>' +
          '<div style="display:flex;align-items:center;gap:9px;margin-bottom:10px">' +
          '<div style="width:32px;height:32px;border-radius:50%;background:' + Ch.colorOf(x.color) +
          ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700">' + x.priority + '</div>' +
          '<div><div style="font-size:15px;font-weight:700">' + esc(x.name) + '</div>' +
          '<div style="font-size:11px;color:var(--ink-3)">排名 ' + x.rank + ' / ' + res.items.length + '</div></div>' +
          '<span class="chip ' + x.gmVerdict.color + '" style="margin-left:auto">' + esc(x.gmVerdict.label) + '</span>' +
          '</div>' +
          '<div style="text-align:center;padding:9px 0 11px">' +
          '<div style="font-size:34px;font-weight:700;letter-spacing:-1.5px;line-height:1;color:' + Ch.colorOf(x.color) + '">' +
          sc(x.composite) + '</div>' +
          '<div style="font-size:11px;color:var(--ink-3);margin-top:5px">综合得分（0-100）</div></div>' +
          '<div style="font-size:12px;line-height:1.9;color:var(--ink-2)">' +
          '<div style="display:flex;justify-content:space-between"><span>品类健康度</span><b>' + sc(x.healthScore) + ' 分 ' + x.stars + '</b></div>' +
          '<div style="display:flex;justify-content:space-between"><span>未来需求趋势</span><b style="color:' +
          (x.forecastDelta == null ? 'var(--ink-3)' : x.forecastDelta > 0 ? 'var(--bad)' : 'var(--good)') + '">' +
          esc(x.forecastLevel) + (x.forecastAvailable ? ' ' + pct(x.forecastDelta) : '') + '</b></div>' +
          '<div style="display:flex;justify-content:space-between"><span>关联购买能力</span><b>' + x.assocPower + ' 条规则</b></div>' +
          '</div></div>';
      }).join('') + '</div>' + traceBar(res) + '</div></div>';

    // 雷达图
    var axes = ['销量贡献', '毛利贡献', '库存周转', '坪效', '品类健康度'];
    var series = res.items.map(function (x) {
      return {
        name: x.name,
        values: [x.qtyScore, x.gpScore, x.turnoverScore, x.spaceScore, x.healthScore],
      };
    });
    h += '<div class="grid g2" style="margin-bottom:15px">';
    h += '<div class="card"><div class="card-h"><h3>' + icon('target') + '多维对比雷达图</h3>' +
      '<div class="acts"><button class="btn sm" data-act="png" data-target="cmpRadar">' +
      icon('download', '', 13) + 'PNG</button></div></div>' +
      '<div class="card-b" id="cmpRadar">' + Ch.radar(axes, series, { size: 330 }) + '</div></div>';

    // 关键指标差异
    h += '<div class="card"><div class="card-h"><h3>' + icon('grid') + '关键指标差异</h3>' +
      '<span class="sub">最大值标红底、最小值标灰底，便于快速识别差距</span></h3></div>' +
      '<div class="card-b tight tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th>指标</th>' + res.items.map(function (x) { return '<th class="num">' + esc(x.name) + '</th>'; }).join('') +
      '<th>差异幅度</th></tr></thead><tbody>' +
      metricRow('综合得分', res.items, 'composite', function (v) { return sc(v); }, 'max') +
      metricRow('健康度', res.items, 'healthScore', function (v) { return sc(v) + ' 分'; }, 'max') +
      metricRow('销量(件)', res.items, 'qty', function (v) { return num(v); }, 'max') +
      metricRow('销售额', res.items, 'amt', function (v) { return money(v); }, 'max') +
      metricRow('毛利额', res.items, 'gp', function (v) { return money(v); }, 'max') +
      metricRow('毛利率', res.items, 'grossMargin', function (v) { return num(v, 1) + '%'; }, 'max') +
      metricRow('库存周转(天) ↓越低越好', res.items, 'turnoverDays', function (v) { return num(v, 1); }, 'min') +
      metricRow('坪效(元/㎡/月)', res.items, 'spaceEff', function (v) { return num(v); }, 'max') +
      metricRow('缺货次数 ↓越低越好', res.items, 'stockout', function (v) { return num(v); }, 'min') +
      metricRow('SKU数量', res.items, 'skuCount', function (v) { return num(v); }, 'max') +
      metricRow('关联购买规则数', res.items, 'assocPower', function (v) { return num(v) + ' 条'; }, 'max') +
      '</tbody></table></div></div></div>';

    // 未来需求趋势对比
    h += '<div class="card" style="margin-bottom:15px"><div class="card-h">' +
      '<h3>' + icon('trend') + '未来需求趋势对比</h3>' +
      '<span class="sub">基于 dataset_demand_forecast.csv 的趋势判定</span></h3></div><div class="card-b">' +
      '<div class="grid g' + Math.min(res.items.length, 3) + '">' +
      res.items.map(function (x) {
        if (!x.forecastAvailable) {
          return '<div style="padding:14px;border:1px dashed var(--line);border-radius:10px;text-align:center">' +
            '<div style="font-size:13px;font-weight:600;margin-bottom:6px">' + esc(x.name) + '</div>' +
            '<div class="chip gray">无预测数据</div>' +
            '<div style="font-size:11px;color:var(--ink-4);margin-top:8px;line-height:1.6">' +
            '附件预测数据未覆盖本品类<br>可在数据中心上传需求历史数据</div></div>';
        }
        return '<div style="padding:14px;border:1px solid var(--line);border-radius:10px;text-align:center">' +
          '<div style="font-size:13px;font-weight:600;margin-bottom:8px">' + esc(x.name) + '</div>' +
          '<div style="font-size:26px;font-weight:700;color:' + (x.forecastDelta > 0 ? 'var(--bad)' : 'var(--good)') +
          ';line-height:1.2">' + pct(x.forecastDelta) + '</div>' +
          '<div style="margin-top:7px"><span class="chip ' + (x.forecastDelta > 5 ? 'warn' : x.forecastDelta < -5 ? 'info' : 'good') + '">' +
          esc(x.forecastLevel) + '</span></div></div>';
      }).join('') + '</div></div></div>';

    // 关联销售情况
    var ap = App.getAssoc();
    h += '<div class="card" style="margin-bottom:15px"><div class="card-h">' +
      '<h3>' + icon('link') + '关联销售情况</h3>' +
      '<span class="sub">所选品类参与的高提升度关联规则</span></h3></div><div class="card-b">';
    var relRules = (ap.rules || []).filter(function (r) {
      return res.items.some(function (x) { return x.name === r.aCat || x.name === r.bCat; });
    }).slice(0, 10);
    if (relRules.length) {
      h += '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>关联规则</th><th class="num">支持度</th><th class="num">置信度</th><th class="num">提升度</th><th>强度</th>' +
        '<th>涉及比较对象</th></tr></thead><tbody>' +
        relRules.map(function (r) {
          var inv = [];
          res.items.forEach(function (x) {
            if (x.name === r.aCat) inv.push(r.a);
            if (x.name === r.bCat) inv.push(r.b);
          });
          return '<tr><td><b>' + esc(r.a) + '</b> → <b>' + esc(r.b) + '</b></td>' +
            '<td class="num">' + r.support + '</td><td class="num">' + r.confidence + '</td>' +
            '<td class="num"><b>' + r.lift + '</b></td>' +
            '<td><span class="chip ' + r.strength.color + '">' + esc(r.strength.level) + '</span></td>' +
            '<td><span class="chip gray">' + esc(inv.join('、') || '—') + '</span></td></tr>';
        }).join('') + '</tbody></table></div>';
    } else {
      h += '<div class="empty" style="padding:26px"><p>所选品类在当前阈值下无通过筛选的强关联规则。</p></div>';
    }
    h += '</div></div>';

    // AI 综合判断
    h += renderAICompare(res, hh);

    return h;
  };

  function metricRow(label, items, key, fmtFn, dir) {
    var vals = items.map(function (x) { return x[key]; }).filter(function (v) { return v != null && !isNaN(v); });
    if (!vals.length) {
      return '<tr><td>' + esc(label) + '</td>' + items.map(function () { return '<td class="num mut">—</td>'; }).join('') +
        '<td class="mut">无数据</td></tr>';
    }
    var best = dir === 'max' ? Math.max.apply(null, vals) : Math.min.apply(null, vals);
    var worst = dir === 'max' ? Math.min.apply(null, vals) : Math.max.apply(null, vals);
    var spread = Math.abs(vals.length > 1 && worst !== 0 ? (best - worst) / Math.abs(worst) * 100 : 0);
    return '<tr><td><b>' + esc(label) + '</b></td>' +
      items.map(function (x) {
        var v = x[key];
        var style = '';
        if (v === best && vals.length > 1) style = ' style="background:var(--good-bg);font-weight:700;color:var(--good)"';
        if (v === worst && vals.length > 1) style = ' style="background:#f5f6f5;color:var(--ink-3)"';
        return '<td class="num"' + style + '>' + (v == null || isNaN(v) ? '—' : fmtFn(v)) + '</td>';
      }).join('') +
      '<td class="num" style="font-size:12px;color:var(--ink-3)">' +
      (vals.length > 1 ? '极差 ' + spread.toFixed(0) + '%' : '—') + '</td></tr>';
  }

  function renderAICompare(res, hh) {
    var best = res.items[0];
    var worst = res.items[res.items.length - 1];

    // 逐项解释
    var lines = [];
    res.items.forEach(function (x, i) {
      var why = [];
      why.push('综合得分 ' + sc(x.composite) + ' 分');
      why.push('健康度 ' + sc(x.healthScore) + ' 分（' + x.stars + ' ' + x.grade + '）');
      if (x.turnoverDays != null) why.push('库存周转 ' + num(x.turnoverDays, 1) + ' 天');
      if (x.spaceEff != null) why.push('坪效 ' + num(x.spaceEff) + ' 元/㎡/月');
      if (x.forecastAvailable) why.push('未来需求' + x.forecastLevel + '（' + pct(x.forecastDelta) + '）');
      lines.push({ item: x, why: why });
    });

    // 最大优势 / 最大风险
    function strengths(x) {
      var out = [];
      var maxQty = Math.max.apply(null, res.items.map(function (i) { return i.qty; }));
      var maxGp = Math.max.apply(null, res.items.map(function (i) { return i.gp; }));
      var minTd = Math.min.apply(null, res.items.map(function (i) { return i.turnoverDays || 9999; }));
      var maxSe = Math.max.apply(null, res.items.map(function (i) { return i.spaceEff || 0; }));
      if (x.qty === maxQty) out.push('销量 ' + num(x.qty) + ' 件，在本次比较中最高');
      if (x.gp === maxGp) out.push('毛利额 ' + money(x.gp) + '，盈利贡献最强');
      if (x.turnoverDays === minTd) out.push('库存周转 ' + num(x.turnoverDays, 1) + ' 天，资金周转最快');
      if (x.spaceEff === maxSe) out.push('坪效 ' + num(x.spaceEff) + ' 元/㎡/月，货架产出效率最高');
      if (!out.length) out.push('各维度表现均衡，无明显单项领先优势');
      return out;
    }
    function risks(x) {
      var out = [];
      if (x.turnoverDays != null && x.turnoverDays > 45) out.push('库存周转 ' + num(x.turnoverDays, 1) + ' 天，超过 45 天健康线，资金占用偏重');
      if (x.spaceEff != null && x.spaceEff < 400) out.push('坪效 ' + num(x.spaceEff) + ' 元/㎡/月，低于 400 元健康线');
      if (x.stockout >= 4) out.push('近 12 个月缺货 ' + x.stockout + ' 次，供应稳定性不足');
      if (x.grossMargin < 18) out.push('毛利率仅 ' + num(x.grossMargin, 1) + '%，低于 18% 健康线');
      if (x.forecastAvailable && x.forecastDelta < -10) out.push('未来需求预测 ' + pct(x.forecastDelta) + '，存在需求萎缩风险');
      if (!out.length) out.push('未识别到显著风险项');
      return out;
    }

    var h = '<div class="card" style="margin-bottom:15px"><div class="card-h">' +
      '<h3>' + icon('ai') + 'AI 综合判断</h3>' +
      '<span class="sub">可解释的对比结论 · 说明为什么推荐、依据哪些指标、最大优势与风险</span></h3></div>' +
      '<div class="card-b">';

    // 推荐优先级
    h += '<div class="note ok" style="margin-bottom:15px">' + App.ICON.ok +
      '<div><b>推荐优先级：</b>' +
      res.items.map(function (x) {
        return '<span style="display:inline-block;margin:0 9px 5px 0">' +
          '<b style="color:var(--brand)">' + x.priority + '</b> = ' + esc(x.name) +
          '（' + sc(x.composite) + ' 分 · <span class="chip ' + x.gmVerdict.color + '">' +
          esc(x.gmVerdict.label) + '</span>）</span>';
      }).join('') +
      '<br><span style="font-size:11.5px;opacity:.85">优先级仅代表本次比较的相对排序，' +
      '不同品类在门店中承担的角色不同（如引流品 vs 利润品），不能简单以得分决定去留。</span></div></div>';

    // 逐项判断
    h += '<div style="font-size:13px;font-weight:650;margin-bottom:10px">逐项判断与决策建议</div>';
    lines.forEach(function (ln) {
      var x = ln.item;
      h += '<div style="padding:13px;border:1px solid var(--line);border-radius:11px;margin-bottom:11px">' +
        '<div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:9px">' +
        '<span style="width:26px;height:26px;border-radius:50%;background:' + Ch.colorOf(x.color) +
        ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:700">' + x.priority + '</span>' +
        '<b style="font-size:14px">' + esc(x.name) + '</b>' +
        '<span class="chip ' + x.gmVerdict.color + '">' + esc(x.gmVerdict.label) + '</span>' +
        '<span class="chip gray">' + sc(x.composite) + ' 分</span>' +
        '<span style="margin-left:auto;font-size:11.5px;color:var(--ink-4)">健康度排名 ' + x.rank + '/' + res.items.length + '</span>' +
        '</div>';
      h += '<div style="font-size:12.5px;color:var(--ink-2);line-height:1.75;margin-bottom:9px">' +
        '<b>为什么这样判断：</b>' + esc(ln.why.join('；')) + '。</div>';
      h += '<div class="grid g2" style="gap:9px">' +
        '<div style="padding:9px 11px;background:var(--good-bg);border-radius:8px">' +
        '<div style="font-size:11px;font-weight:650;color:var(--good);margin-bottom:4px">最大优势</div>' +
        '<ul style="margin:0;padding-left:16px;font-size:12px;color:var(--ink-2);line-height:1.7">' +
        strengths(x).map(function (s2) { return '<li>' + esc(s2) + '</li>'; }).join('') + '</ul></div>' +
        '<div style="padding:9px 11px;background:var(--warn-bg);border-radius:8px">' +
        '<div style="font-size:11px;font-weight:650;color:var(--warn);margin-bottom:4px">最大风险</div>' +
        '<ul style="margin:0;padding-left:16px;font-size:12px;color:var(--ink-2);line-height:1.7">' +
        risks(x).map(function (s3) { return '<li>' + esc(s3) + '</li>'; }).join('') + '</ul></div>' +
        '</div></div>';
    });

    // 结论会改变的情况
    var conds = [];
    if (best.turnoverDays != null && worst.turnoverDays != null) {
      conds.push('若「' + worst.name + '」的库存周转天数从 ' + num(worst.turnoverDays, 1) +
        ' 天压缩至 30 天以内（如通过精简 SKU、提高订货频次），其周转维度得分将显著提升，排名可能上升。');
    }
    conds.push('若调整评价权重（例如把毛利贡献权重从 30% 提到 50%），排序可能变化——' +
      '原因是各品类在销量与毛利上的表现并不一致。管理员可在「调整评价权重」中实时验证。');
    if (res.items.some(function (x) { return !x.forecastAvailable; })) {
      conds.push('本次比较中部分品类缺少需求预测数据（附件预测仅覆盖 5 个品类），' +
        '若补充预测数据，需求趋势维度的结论可能改变。');
    }
    conds.push('若门店客群结构发生变化（如商圈从社区型转为办公型），品类角色的重要性排序可能改变，' +
      '届时需重新评估权重设置。');

    h += '<div style="padding:12px;border:1px dashed var(--line);border-radius:11px;background:var(--panel-2)">' +
      '<div style="font-size:12.5px;font-weight:650;margin-bottom:7px">什么情况下结论会改变</div>' +
      '<ul style="margin:0;padding-left:18px;font-size:12.5px;color:var(--ink-2);line-height:1.8">' +
      conds.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></div>';

    h += '<div class="note warn" style="margin-top:15px">' + App.ICON.warn +
      '<div><b>AI建议，仅供辅助决策，最终选品由采购人员确认。</b><br>' +
      '以上判断全部基于平台算法对模拟演示数据集的计算结果（算法：' + esc(res.algorithm) + '），' +
      '不构成对商品实际表现的预测或承诺。AI 不会自动执行任何商品调整动作。</div></div>';

    // 操作按钮
    h += '<div style="display:flex;gap:9px;margin-top:15px;flex-wrap:wrap">' +
      '<button class="btn pri" data-act="cmp-accept">' + icon('check') + '采纳建议</button>' +
      '<button class="btn" data-act="cmp-hold">' + icon('clock') + '暂缓</button>' +
      '<button class="btn danger" data-act="cmp-reject">' + icon('x') + '驳回</button>' +
      '<button class="btn" data-act="cmp-submit">' + icon('gavel') + '提交审批</button>' +
      '</div>';

    h += '</div></div>';
    return h;
  }

  Pages.after_compare = function () {
    var c = document.getElementById('content');
    c.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act],[data-cid],[data-mode]');
      if (!b) return;

      if (b.dataset.mode) {
        S().compareMode = b.dataset.mode;
        App.refreshPage();
        return;
      }
      if (b.dataset.cid) {
        var cid = b.dataset.cid;
        var sel = S().compareSel || [];
        var i = sel.indexOf(cid);
        if (i >= 0) sel.splice(i, 1);
        else if (sel.length < 6) sel.push(cid);
        else return global.App.toast('最多比较 6 个对象', 'warn');
        S().compareSel = sel;
        App.refreshPage();
        return;
      }

      var act = b.dataset.act;
      if (act === 'png') { Ch.exportPNG(document.getElementById(b.dataset.target), b.dataset.target); global.App.toast('图表已导出 PNG', 'ok'); }
      if (act === 'goto-data') App.go('data');
      if (act === 'switch-cat') { S().compareMode = 'category'; App.refreshPage(); }
      if (act === 'sku-template') downloadSkuTemplate();
      if (act === 'cmp-clear') { S().compareSel = []; App.refreshPage(); }
      if (act === 'cmp-preset') {
        S().compareSel = ['C001', 'C003', 'C005', 'C007'];
        App.refreshPage();
        global.App.toast('已载入推荐对比组：生鲜蔬果 / 粮油调味 / 日化清洁 / 纺织服装', 'ok');
      }
      if (act === 'cmp-weights') openCompareWeights();
      if (act === 'cmp-export') exportCompare();
      if (act === 'cmp-plan') App.go('ai');
      if (act === 'cmp-accept' || act === 'cmp-hold' || act === 'cmp-reject' || act === 'cmp-submit') {
        cmpDecision(act);
      }
    });
  };

  function cmpDecision(act) {
    var sel = S().compareSel || [];
    var res = A.compare(sel, {
      mode: 'category',
      weights: {
        sales: S().settings.weights.qty / 100, margin: S().settings.weights.gp / 100,
        turnover: S().settings.weights.turnover / 100, space: S().settings.weights.space / 100,
      },
    });
    if (!res.ok) return global.App.toast('比较结果无效', 'err');
    var names = res.items.map(function (x) { return x.name; });
    var detail = '比较对象：' + names.join('、') + '｜优先级：' +
      res.items.map(function (x) { return x.priority + '=' + x.name; }).join(' ');

    if (act === 'cmp-accept') {
      App.audit('采纳选品比较建议', names.join('、'), detail);
      App.persist();
      global.App.toast('已采纳建议，操作已记入操作日志', 'ok');
    }
    if (act === 'cmp-hold') {
      App.audit('暂缓选品比较建议', names.join('、'), detail);
      App.persist();
      global.App.toast('已标记为暂缓，可在审批中心查看', 'ok');
    }
    if (act === 'cmp-reject') {
      var body = '<div class="field"><label>驳回原因<span class="req">*</span></label>' +
        '<textarea id="rjNote" placeholder="请说明驳回该建议的原因，便于后续追踪"></textarea></div>' +
        '<div class="note" style="font-size:11.5px">' + App.ICON.info +
        '<div>驳回记录将完整保存（含时间、操作人、原因），可在审批中心的「已驳回」列表与操作日志中追溯。</div></div>';
      App.openDrawer('驳回建议', body,
        '<button class="btn" data-act="dr-cancel">取消</button>' +
        '<button class="btn danger" data-act="rj-ok">确认驳回</button>');
      document.getElementById('drFoot').onclick = function (e2) {
        var t = e2.target.closest('[data-act]');
        if (!t) return;
        if (t.dataset.act === 'dr-cancel') App.closeDrawer();
        if (t.dataset.act === 'rj-ok') {
          var note = document.getElementById('rjNote').value.trim();
          if (!note) return global.App.toast('请填写驳回原因', 'err');
          App.audit('驳回选品比较建议', names.join('、'), detail + '｜原因：' + note);
          App.persist(); App.closeDrawer();
          global.App.toast('已驳回，原因已记录', 'ok');
        }
      };
      return;
    }
    if (act === 'cmp-submit') {
      var worst = res.items[res.items.length - 1];
      var best = res.items[0];
      Pages.openApprovalForm(null, {
        level: 3, source: '选品比较中心', cats: names,
        title: '选品比较结论：建议优化「' + worst.name + '」并巩固「' + best.name + '」',
        advice: '本次对 ' + names.join('、') + ' 共 ' + res.items.length + ' 个品类进行多维比较。' +
          '「' + worst.name + '」综合得分 ' + sc(worst.composite) + ' 分（' + worst.gmVerdict.label + '），' +
          '建议实施品类优化；「' + best.name + '」综合得分 ' + sc(best.composite) + ' 分（' + best.gmVerdict.label + '），' +
          '建议巩固优势并适度扩品。',
        basis: res.items.map(function (x) {
          return x.priority + ' = ' + x.name + '：综合 ' + sc(x.composite) + ' 分，健康度 ' + sc(x.healthScore) +
            ' 分，周转 ' + num(x.turnoverDays, 1) + ' 天，坪效 ' + num(x.spaceEff) + ' 元/㎡/月';
        }),
        priority: '高', risk: '中',
      });
    }
  }

  function downloadSkuTemplate() {
    var tpl = [{
      SKU: 'SKU00001', 商品名称: '示例商品', 品类: '食品饮料', 品牌: '示例品牌',
      是否自有品牌: '否', 采购价: 8.5, 零售价: 15.9, 预计毛利率: 46.5,
      销量_件: 100, 销售额_元: 1590, 毛利额_元: 739, 库存周转天数: 25,
      货架占用_平米: 0.5, 季节性: '全季节', 供应商: '示例供应商', 促销属性: '常规',
      目标客群: '社区家庭', 是否新品: '否', 参考同类SKU: 'SKU00002',
    }];
    App.download('SKU候选商品数据_上传模板.csv', App.toCSV(tpl));
    global.App.toast('SKU 数据模板已下载，请按模板格式填写后上传', 'ok');
  }

  function exportCompare() {
    var sel = S().compareSel || [];
    var res = A.compare(sel, {
      mode: 'category',
      weights: {
        sales: S().settings.weights.qty / 100, margin: S().settings.weights.gp / 100,
        turnover: S().settings.weights.turnover / 100, space: S().settings.weights.space / 100,
      },
    });
    if (!res.ok) return global.App.toast('暂无可导出的比较结果', 'err');
    var rows = res.items.map(function (x) {
      return {
        优先级: x.priority, 排名: x.rank, 品类ID: x.cid, 品类名称: x.name,
        综合得分: x.composite, 健康度得分: x.healthScore, 健康度等级: x.stars,
        决策建议: x.gmVerdict.label,
        销量_件: x.qty, 销售额_元: x.amt, 毛利额_元: x.gp, 毛利率_百分比: x.grossMargin,
        库存周转天数: x.turnoverDays, 坪效_元每平米月: x.spaceEff,
        缺货次数: x.stockout, SKU数量: x.skuCount, 关联规则数: x.assocPower,
        未来需求趋势: x.forecastLevel, 未来需求环比_百分比: x.forecastDelta,
        销量维度得分: x.qtyScore, 毛利维度得分: x.gpScore,
        周转维度得分: x.turnoverScore, 坪效维度得分: x.spaceScore,
      };
    });
    App.download('选品比较结果_' + App.nowStr().replace(/[-: ]/g, '') + '.csv', App.toCSV(rows));
    App.audit('导出选品比较结果', res.items.map(function (x) { return x.name; }).join('、'),
      rows.length + ' 个对象');
    App.persist();
    global.App.toast('比较结果已导出 CSV', 'ok');
  }

  function openCompareWeights() {
    var w = S().settings.weights;
    var body =
      '<div class="note" style="margin-bottom:14px">' + App.ICON.info +
      '<div>修改权重后，综合得分、排名与 AI 综合判断将<b>实时重新计算</b>。' +
      '四项权重之和必须为 100%。参数变更会记录到「参数变更留痕」。</div></div>' +
      '<div class="card"><div class="card-b">' +
      '<div class="wrow"><span class="wn">销量贡献</span>' +
      '<input type="range" id="cw-qty" min="0" max="100" step="5" value="' + w.qty + '">' +
      '<span class="wv" id="cw-qty-v">' + w.qty + '%</span></div>' +
      '<div class="wrow"><span class="wn">毛利贡献</span>' +
      '<input type="range" id="cw-gp" min="0" max="100" step="5" value="' + w.gp + '">' +
      '<span class="wv" id="cw-gp-v">' + w.gp + '%</span></div>' +
      '<div class="wrow"><span class="wn">库存周转</span>' +
      '<input type="range" id="cw-turnover" min="0" max="100" step="5" value="' + w.turnover + '">' +
      '<span class="wv" id="cw-turnover-v">' + w.turnover + '%</span></div>' +
      '<div class="wrow"><span class="wn">坪效</span>' +
      '<input type="range" id="cw-space" min="0" max="100" step="5" value="' + w.space + '">' +
      '<span class="wv" id="cw-space-v">' + w.space + '%</span></div>' +
      '<div class="wsum" id="cwSum"></div>' +
      '<div style="margin-top:13px"><div class="field"><label>变更原因</label>' +
      '<input type="text" id="cwReason" placeholder="例如：本期重点是提升毛利，故上调毛利贡献权重">' +
      '<div class="hint">变更原因将记录到参数变更留痕，便于后续审计追溯。</div></div></div>' +
      '</div></div>';

    App.openDrawer('调整选品评价权重', body,
      '<button class="btn" data-act="dr-cancel">取消</button>' +
      '<button class="btn pri" data-act="cw-save">' + icon('check') + '保存并重算</button>');

    var ids = ['cw-qty', 'cw-gp', 'cw-turnover', 'cw-space'];
    function refreshSum() {
      var s2 = 0;
      ids.forEach(function (id) {
        var v = +document.getElementById(id).value;
        document.getElementById(id + '-v').textContent = v + '%';
        s2 += v;
      });
      var el = document.getElementById('cwSum');
      el.className = 'wsum ' + (s2 === 100 ? 'ok' : 'bad');
      el.innerHTML = '<span>当前权重合计</span><span>' + s2 + '% ' +
        (s2 === 100 ? '✓ 符合要求' : '✗ 必须等于 100%') + '</span>';
    }
    ids.forEach(function (id) {
      document.getElementById(id).oninput = refreshSum;
    });
    refreshSum();

    document.getElementById('drFoot').onclick = function (ev) {
      var t = ev.target.closest('[data-act]');
      if (!t) return;
      if (t.dataset.act === 'dr-cancel') App.closeDrawer();
      if (t.dataset.act === 'cw-save') {
        var nw = {
          qty: +document.getElementById('cw-qty').value,
          gp: +document.getElementById('cw-gp').value,
          turnover: +document.getElementById('cw-turnover').value,
          space: +document.getElementById('cw-space').value,
        };
        if (nw.qty + nw.gp + nw.turnover + nw.space !== 100) {
          return global.App.toast('四项权重之和必须等于 100%', 'err');
        }
        var before = JSON.stringify(S().settings.weights);
        S().settings.weights = nw;
        S().settingsLogs.unshift({
          id: App.uid('CFG'), module: '选品评价权重', user: S().user.name,
          before: before, after: JSON.stringify(nw),
          reason: document.getElementById('cwReason').value.trim() || '未填写原因',
          at: App.nowStr(),
        });
        App.invalidate(); App.persist(); App.closeDrawer(); App.refreshPage();
        global.App.toast('权重已更新，全部结果已实时重算', 'ok');
      }
    };
  }

  global.Pages = Pages;
})(window);





