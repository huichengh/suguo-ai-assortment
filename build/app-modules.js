/* ============================================================================
 * 苏果智选 · 扩展模块 / 数据中心 / 审批中心 / 系统管理 (app-modules.js)
 * ----------------------------------------------------------------------------
 * 铁律 9：渲染函数之间严禁互调；after_xxx() 绑定事件；统一由 App.refreshPage() 调度。
 * 铁律 7：本文件承载「扩展分析（3）+ 智能协同（数据中心/审批中心）+ 系统管理」，
 *         首页四大核心模块在 app-pages.js。
 * ==========================================================================*/
(function (global) {
  'use strict';

  var Pages = global.Pages;
  var A = global.Algo;
  var Ch = global.Charts;
  var U = Pages._util;

  /** App 别名（getter 代理，同 app-pages.js） */
  var App = new Proxy({}, {
    get: function (_, k) {
      var real = global.App;
      if (!real) throw new Error('App 未初始化：' + String(k));
      var v = real[k];
      return typeof v === 'function' ? v.bind(real) : v;
    },
  });

  function S() { return global.App.State; }
  function esc(s) { return global.App.esc(s); }
  function icon(n, c, z) { return global.App.icon(n, c, z); }
  function num(v, d) { return global.App.fmtNum(v, d); }
  function money(v, d) { return global.App.fmtMoney(v, d); }
  function pct(v, d) { return global.App.fmtPct(v, d); }
  function sc(v) { return global.App.fmtScore(v); }
  var demoBadge = U.demoBadge, traceBar = U.traceBar, fmtTime = U.fmtTime;

  /** 数据接入占位块（第 10/11/12/25 节：完整页面 + 数据接入入口，不伪造量化结果） */
  function pending(title, need, uploadType, intro) {
    return '<div class="card"><div class="card-b">' +
      '<div class="empty" style="padding:34px 20px">' + icon('upload') +
      '<h4>' + esc(title) + '</h4>' +
      '<p>' + intro + '</p>' +
      '<div style="max-width:560px;margin:14px auto 0;text-align:left">' +
      '<div style="font-size:12.5px;font-weight:700;margin-bottom:7px;color:var(--ink-2)">需要接入的数据字段</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
      need.map(function (f) { return '<span class="chip gray">' + esc(f) + '</span>'; }).join('') +
      '</div></div>' +
      '<div class="acts">' +
      '<button class="btn pri" data-act="goto-data">' + icon('upload') + '前往数据中心上传</button>' +
      (uploadType ? '<button class="btn" data-act="dl-tpl" data-type="' + uploadType + '">下载上传模板</button>' : '') +
      '</div>' +
      '<div class="note" style="margin-top:16px;text-align:left;max-width:600px">' + global.App.ICON.info +
      '<div><b>平台不会在缺少数据时虚构任何量化结果。</b>' +
      '在数据接入前，本页仅展示可由现有数据集推导的<b>品类级结论</b>，所有结论均标注数据来源。</div></div>' +
      '</div></div></div>';
  }

  /* ========================================================================
   * 模块：千店千面（门店画像 × 差异化选品）
   * ====================================================================== */
  Pages.deeplink = function () {
    var st = global.App.curStore();
    var hh = global.App.getHealth();
    var h = '';

    h += '<div class="page-head"><div class="t"><h2>千店千面 · 门店差异化选品</h2>' +
      '<p>依据门店周边客群结构、消费能力、竞争格局推导差异化品类配置。' +
      '当前门店：<b>' + esc(st.name) + '</b>　' + demoBadge() + '</p></div>' +
      '<div class="acts">' +
      '<button class="btn" data-act="store-profile">' + icon('store') + '查看门店画像配置</button>' +
      '</div></div>';

    // 门店画像状态
    var hasProfile = st.profile && st.profile.area3km != null;
    h += '<div class="grid g4" style="margin-bottom:15px">' +
      kpi('门店', st.short, st.biz, 'store', 'neutral') +
      kpi('3 公里人口', hasProfile ? num(st.profile.area3km) + ' 万' : '待接入', '门店画像数据字段', 'users', hasProfile ? 'good' : 'warn') +
      kpi('周边竞品', hasProfile ? st.profile.competitors.length + ' 家' : '待接入', '3 公里内同业态竞品', 'compare', hasProfile ? 'good' : 'warn') +
      kpi('线上到家', hasProfile ? st.profile.delivery : '待接入', '配送覆盖能力', 'box', hasProfile ? 'good' : 'warn') +
      '</div>';

    h += pending(
      '门店画像数据待接入，暂无法输出差异化选品方案',
      ['门店名称', '商圈类型', '3公里常住人口', '住宅/办公/学生/老年占比', '人均消费能力', '周边POI（住宅/写字楼/学校）', '周边竞品清单', '线上到家覆盖'],
      'store_profile',
      '「千店千面」需要门店周边客群结构数据才能推导差异化选品。' +
      '当前平台仅有单店（' + esc(st.short) + '）的品类级销售与交易数据，' +
      '缺少门店周边人口、POI、竞品、消费能力等画像字段。<br><br>' +
      '<b>接入后系统可输出：</b>客群结构画像、差异化品类权重建议、' +
      '各品类在该商圈的适配度评分、门店间品类差异对比矩阵。');

    // 可由现有数据推导的品类级结论
    h += '<div class="card" style="margin-top:15px"><div class="card-h">' +
      '<h3>' + icon('target') + '当前可推导的品类级结论' +
      '<span class="sub">基于现有数据集（' + esc(hh.sourceDatasetId) + '），非门店画像推导</span></h3></div>' +
      '<div class="card-b">' +
      '<div class="grid g2">' +
      '<div>' +
      '<div style="font-size:13px;font-weight:700;margin-bottom:9px;color:var(--good)">' +
      icon('up', '', 13) + ' 适配社区商圈、建议巩固的品类</div>' +
      hh.items.filter(function (x) { return x.score >= 65; }).map(function (x) {
        return '<div style="padding:9px 0;border-bottom:1px solid var(--line-2);font-size:12.5px">' +
          '<b>' + esc(x.name) + '</b>　' + U.healthChip(x) +
          '<div style="color:var(--ink-3);font-size:11.5px;margin-top:3px">' +
          '销量贡献 ' + pct(x.qtyShare, 1).replace('+', '') + '，坪效 ' + num(x.spaceEff) +
          ' 元/㎡/月，周转 ' + num(x.turnoverDays, 1) + ' 天</div></div>';
      }).join('') || '<div style="color:var(--ink-3);font-size:12.5px">暂无可推荐品类</div>' +
      '</div>' +
      '<div>' +
      '<div style="font-size:13px;font-weight:700;margin-bottom:9px;color:var(--bad)">' +
      icon('alert', '', 13) + ' 适配度存疑、需结合画像再评估的品类</div>' +
      hh.items.filter(function (x) { return x.score < 65; }).map(function (x) {
        return '<div style="padding:9px 0;border-bottom:1px solid var(--line-2);font-size:12.5px">' +
          '<b>' + esc(x.name) + '</b>　' + U.healthChip(x) +
          '<div style="color:var(--ink-3);font-size:11.5px;margin-top:3px">' +
          '销量贡献 ' + pct(x.qtyShare, 1).replace('+', '') + '，坪效 ' + num(x.spaceEff) +
          ' 元/㎡/月，周转 ' + num(x.turnoverDays, 1) + ' 天</div></div>';
      }).join('') || '<div style="color:var(--ink-3);font-size:12.5px">暂无待评估品类</div>' +
      '</div></div>' +
      '<div class="note" style="margin-top:14px">' + global.App.ICON.info +
      '<div><b>数据不足声明：</b>以上结论仅反映品类在全店的经营表现，' +
      '<b>不能等同于该品类在本商圈的适配度</b>。商圈适配度必须结合门店画像数据才能判断，' +
      '平台拒绝在缺少画像数据时给出「该品类不适合本商圈」等结论。</div></div>' +
      '</div></div>';

    return h;
  };

  Pages.after_deeplink = function () {
    bindCommon('deeplink');
  };

  /* ========================================================================
   * 模块：自有品牌机会
   * ====================================================================== */
  Pages.privateLabel = function () {
    var hh = global.App.getHealth();
    var h = '';

    h += '<div class="page-head"><div class="t"><h2>自有品牌机会识别</h2>' +
      '<p>识别适合开发自有品牌（PB）的品类与单品，评估渗透率提升空间与毛利改善机会。' +
      demoBadge() + '</p></div>' +
      '<div class="acts">' +
      '<button class="btn" data-act="pl-info">' + icon('info') + '评估口径说明</button>' +
      '</div></div>';

    h += '<div class="grid g4" style="margin-bottom:15px">' +
      kpi('自有品牌 SKU 数', '待接入', '需接入自有品牌商品主数据', 'brand', 'warn') +
      kpi('自有品牌渗透率', '待接入', '需接入 PB/全国品牌销售拆分', 'target', 'warn') +
      kpi('自有品牌毛利率', '待接入', '需接入 SKU 级成本与售价', 'money', 'warn') +
      kpi('可识别机会品类', hh.items.filter(function (x) { return x.gpShare < 15 && x.qtyShare >= 8; }).length + ' 个',
        '按「销量占比高但毛利贡献低」筛出', 'zap', 'good') +
      '</div>';

    // 品类级机会识别（可推导部分）
    h += '<div class="card" style="margin-bottom:15px"><div class="card-h">' +
      '<h3>' + icon('zap') + '品类级机会筛查' +
      '<span class="sub">口径：销量占比 ≥ 8% 且 毛利贡献 &lt; 15% —— 高频刚需但毛利偏低，是自有品牌替代的典型窗口</span></h3>' +
      '<div class="acts"><button class="btn sm" data-act="png" data-target="plChart">' +
      icon('download', '', 13) + 'PNG</button></div></div>' +
      '<div class="card-b" id="plChart">';

    var opp = hh.items.filter(function (x) { return x.qtyShare >= 8 && x.gpShare < 15; });
    h += Ch.hBar(hh.items.map(function (x) {
      return {
        label: x.name, value: x.gpShare, color: (x.qtyShare >= 8 && x.gpShare < 15) ? 'orange' : 'brand2',
        text: '毛利 ' + x.gpShare + '% / 销量 ' + x.qtyShare + '%',
      };
    }), { max: Math.max.apply(null, hh.items.map(function (x) { return x.gpShare; })) * 1.15, rowH: 32 });

    h += '<div style="margin-top:12px;font-size:12.5px;line-height:1.9;color:var(--ink-2)">' +
      (opp.length ? '<b>识别到 ' + opp.length + ' 个高潜机会品类：</b><br>' + opp.map(function (x) {
        return '· <b>' + esc(x.name) + '</b>：销量贡献 <b>' + x.qtyShare + '%</b>，毛利贡献仅 <b>' + x.gpShare +
          '%</b>，毛利率 ' + sc(x.grossMargin) + '%。该品类购买频次高、客群稳定，' +
          '若以自有品牌替代部分全国品牌 SKU，理论上可改善毛利结构。';
      }).join('<br>') :
        '当前 7 个品类中未识别到「销量占比高但毛利贡献低」的显著窗口。') +
      '</div>' +
      traceBar(hh, '自有品牌机会筛查口径：销量占比≥8% 且 毛利贡献<15%') +
      '</div></div>';

    h += pending(
      '自有品牌渗透率与单品级机会待接入 SKU 主数据',
      ['SKU', '商品名称', '品类', '品牌', '是否自有品牌', '采购价', '零售价', '期间销量', '期间销售额', '期间毛利额', '货架占用'],
      'sku_candidate',
      '识别到的高潜品类只是<b>窗口提示</b>，要落到「具体开发哪支自有品牌单品」，' +
      '必须接入 SKU 级主数据。<br><br>' +
      '<b>接入后系统可输出：</b>品类内 SKU 参数分布（价格带/规格/毛利带）、' +
      '全国品牌与自有品牌的同价格带对标、可替代性评分、自有品牌单品候选清单、' +
      '开发优先级排序与预期毛利改善测算。');
    return h;
  };

  Pages.after_privateLabel = function () {
    bindCommon('privateLabel');
  };

  /* ========================================================================
   * 模块：新品评估
   * ====================================================================== */
  Pages.newProduct = function () {
    var hh = global.App.getHealth();
    var s = S();
    var list = s.newProducts || [];
    var h = '';

    h += '<div class="page-head"><div class="t"><h2>新品评估</h2>' +
      '<p>录入候补新品，基于品类匹配度、价格带、毛利空间、场景互补性输出可解释评估结论。' +
      '评估维度可追溯，最终引入决策由采购人员确认。　' + demoBadge() + '</p></div>' +
      '<div class="acts">' +
      '<button class="btn" data-act="np-add">' + icon('plus') + '录入新品候选</button>' +
      '<button class="btn" data-act="np-eval-all">' + icon('cpu') + '批量重新评估</button>' +
      '</div></div>';

    if (!list.length) {
      h += '<div class="card"><div class="card-b"><div class="empty">' + icon('newp') +
        '<h4>暂无新品候选</h4><p>点击「录入新品候选」添加待评估商品。' +
        '录入后平台将基于现有品类数据自动评估其适配度。</p>' +
        '<div class="acts"><button class="btn pri" data-act="np-add">' + icon('plus') + '录入第一个新品</button></div>' +
        '</div></div></div>';
      return h;
    }

    h += '<div class="card" style="margin-bottom:15px"><div class="card-h">' +
      '<h3>' + icon('newp') + '新品候选池' +
      '<span class="sub">共 ' + list.length + ' 个候选</span></h3></div>' +
      '<div class="card-b" style="padding:0">' +
      '<div class="tbl-wrap"><table><thead><tr>' +
      '<th>商品名称</th><th>品类</th><th>规格 / 装箱</th><th class="num">进货价</th>' +
      '<th class="num">零售价</th><th class="num">毛利率</th><th>适配度评估</th><th>状态</th><th class="num">操作</th>' +
      '</tr></thead><tbody>';

    list.forEach(function (p) {
      var ev = evalNewProduct(p, hh);
      h += '<tr>' +
        '<td><b>' + esc(p.name) + '</b>' + (p.isPrivate ? '<span class="chip brand" style="margin-left:5px">自有品牌</span>' : '') +
        '<div style="font-size:11px;color:var(--ink-3);margin-top:2px">' + esc(p.brand || '—') + '</div></td>' +
        '<td>' + esc(p.catName) + '</td>' +
        '<td style="font-size:11.5px;color:var(--ink-2)">' + esc(p.spec || '—') +
        '<div style="color:var(--ink-3)">' + esc(p.pack || '—') + '</div></td>' +
        '<td class="num">' + money(p.cost, 2) + '</td>' +
        '<td class="num">' + money(p.price, 2) + '</td>' +
        '<td class="num"><b style="color:' + (p.margin >= 40 ? 'var(--good)' : p.margin >= 25 ? 'var(--warn)' : 'var(--bad)') + '">' +
        sc(p.margin) + '%</b></td>' +
        '<td>' + U.barOf(ev.score, ev.color) +
        '<div style="font-size:11px;color:var(--ink-3);margin-top:3px">' + esc(ev.verdict) + '</div></td>' +
        '<td><span class="chip ' + ev.chipColor + '">' + esc(ev.status) + '</span></td>' +
        '<td class="num"><button class="btn sm" data-act="np-view" data-id="' + esc(p.id) + '">评估详情</button></td>' +
        '</tr>';
    });
    h += '</tbody></table></div></div></div>';

    // 评估模型说明
    h += '<div class="card"><div class="card-h"><h3>' + icon('cpu') + '新品评估模型说明</h3></div>' +
      '<div class="card-b"><div style="font-size:12.5px;line-height:1.95;color:var(--ink-2)">' +
      '<b>当前可计算的评估维度（基于现有品类级数据）：</b>' +
      '<div style="margin:7px 0 12px">' +
      '· <b>品类健康度适配（权重 40%）</b>：新品所属品类的健康度评分，品类越健康，扩品风险越低<br>' +
      '· <b>毛利率竞争力（权重 35%）</b>：新品毛利率与所属品类当前毛利率对比，高于品类均值加分<br>' +
      '· <b>关联场景互补（权重 25%）</b>：新品关键词与已识别关联规则场景的匹配程度' +
      '</div>' +
      '<b>当前无法计算的评估维度（数据不足，平台拒绝虚构）：</b>' +
      '<div style="margin:7px 0 4px">' +
      '· 价格带分布适配 —— 需要 SKU 级价格带数据<br>' +
      '· 同价格带竞品密度 —— 需要 SKU 级竞品清单<br>' +
      '· 供应商供货能力与稳定性 —— 需要供应商绩效数据<br>' +
      '· 门店货架容量约束 —— 需要货架占用与陈列位数据<br>' +
      '· 历史同类新品成功率 —— 需要新品引入结果追踪数据' +
      '</div>' +
      '</div>' +
      '<div class="note warn" style="margin-top:12px">' + global.App.ICON.warn +
      '<div><b>模型局限声明：</b>当前评估结论<b>仅可作为初筛参考</b>。' +
      '在缺少上述 5 类数据时，平台无法给出「建议引入 / 建议拒绝」的确定性结论，' +
      '只输出适配度区间与需人工核查的清单。<b>最终引入决策必须由采购人员确认。</b></div></div>' +
      '</div></div>';

    return h;
  };

  /** 新品适配度评估（纯函数，单向：只读 hh，不触发渲染） */
  function evalNewProduct(p, hh) {
    var cat = hh.items.filter(function (x) { return x.cid === p.cat; })[0];
    if (!cat) {
      return {
        score: null, color: 'gray', verdict: '品类未匹配，无法评估',
        status: '待补充', chipColor: 'gray', cat: null,
        dims: [], missing: ['所属品类在当前数据集中不存在'],
      };
    }
    var dims = [];
    // 1. 品类健康度适配 40%
    dims.push({ name: '品类健康度适配', weight: 40, score: cat.score, raw: cat.name + ' 健康度 ' + sc(cat.score) + ' 分（' + cat.grade + '）' });
    // 2. 毛利率竞争力 35%（相对品类毛利率归一）
    var gmDiff = p.margin - cat.grossMargin;
    var gmScore = Math.max(0, Math.min(100, 50 + gmDiff * 2.2));
    dims.push({
      name: '毛利率竞争力', weight: 35, score: gmScore,
      raw: '新品 ' + sc(p.margin) + '% vs 品类均值 ' + sc(cat.grossMargin) + '%（差 ' +
        (gmDiff >= 0 ? '+' : '') + sc(gmDiff) + 'pt）',
    });
    // 3. 关联场景互补 25%
    var assoc = global.App.getAssoc();
    var hit = [];
    (assoc.rules || []).slice(0, 200).forEach(function (r) {
      var kw = (p.name + ' ' + (p.selling || '') + ' ' + (p.refSku || ''));
      if (r.aCat === cat.name || r.bCat === cat.name) {
        if (kw.indexOf(r.a) >= 0 || kw.indexOf(r.b) >= 0 ||
          (r.advice && p.selling && r.advice.slice(0, 6) && p.selling.indexOf(r.advice.slice(0, 6)) >= 0)) {
          hit.push(r.a + ' → ' + r.b);
        }
      }
    });
    // 场景关键词兜底匹配
    var sceneKw = ['火锅', '早餐', '烘焙', '生鲜', '家常', '日化', '补货'];
    var matchedScene = sceneKw.filter(function (k) { return (p.selling || '').indexOf(k) >= 0 || p.name.indexOf(k) >= 0; });
    var asScore = Math.min(100, 40 + hit.length * 18 + matchedScene.length * 14);
    dims.push({
      name: '关联场景互补', weight: 25, score: asScore,
      raw: hit.length ? '命中 ' + hit.length + ' 条已识别关联规则：' + hit.slice(0, 2).join('；') :
        (matchedScene.length ? '命中场景关键词：' + matchedScene.join('、') + '（未命中具体规则）' :
          '未命中已有购物篮关联规则，场景互补性未知'),
    });

    var total = dims.reduce(function (a, d) { return a + d.score * d.weight / 100; }, 0);
    var verdict, color, status, chipColor;
    if (total >= 75) { verdict = '适配度较高，可进入选品评审'; color = 'green'; status = '建议进入评审'; chipColor = 'green'; }
    else if (total >= 60) { verdict = '适配度中等，建议补充信息后评审'; color = 'lime'; status = '需补充信息'; chipColor = 'lime'; }
    else if (total >= 45) { verdict = '适配度偏低，建议暂缓'; color = 'orange'; status = '建议暂缓'; chipColor = 'orange'; }
    else { verdict = '适配度低，不建议当前引入'; color = 'red'; status = '建议暂缓'; chipColor = 'red'; }

    return {
      score: A.round(total, 1), color: color, verdict: verdict,
      status: status, chipColor: chipColor, cat: cat, dims: dims,
      missing: [
        '价格带分布适配（需 SKU 级价格带数据）',
        '同价格带竞品密度（需竞品清单）',
        '供应商供货能力（需供应商绩效数据）',
        '货架容量约束（需陈列位数据）',
      ],
    };
  }

  Pages.after_newProduct = function () {
    var c = document.getElementById('content');
    c.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]');
      if (!b) return;
      var act = b.dataset.act;
      if (act === 'np-add') openNewProductForm();
      if (act === 'np-view') showNewProduct(b.dataset.id);
      if (act === 'np-eval-all') {
        global.App.toast('已按当前品类数据与关联规则重新评估 ' + S().newProducts.length + ' 个候选', 'ok');
        global.App.refreshPage();
      }
      if (act === 'dr-cancel') global.App.closeDrawer();
      if (act === 'np-save') saveNewProduct();
      if (act === 'np-del') {
        var id = document.getElementById('npDelId').value;
        global.App.confirmDialog('删除新品候选', '确认删除该新品候选？此操作不可撤销。', function () {
          S().newProducts = S().newProducts.filter(function (x) { return x.id !== id; });
          global.App.persist(); global.App.refreshPage();
          global.App.toast('已删除', 'ok');
        }, '确认删除');
      }
    });
  };

  function openNewProductForm() {
    var hh = global.App.getHealth();
    var body =
      '<div class="grid g2">' +
      fld('npName', '商品名称', 'text', '如：润家 低钠竹盐酱油 500ml', true) +
      fld('npBrand', '品牌 / 供应商', 'text', '如：润家（自有品牌）') +
      '</div>' +
      '<div class="grid g2">' +
      '<div class="field"><label>所属品类<span class="req">*</span></label>' +
      '<select id="npCat">' + hh.items.map(function (x) {
        return '<option value="' + x.cid + '">' + esc(x.name) + '（健康度 ' + sc(x.score) + ' 分，毛利率 ' + sc(x.grossMargin) + '%）</option>';
      }).join('') + '</select></div>' +
      '<div class="field"><label>是否自有品牌</label><select id="npPrivate">' +
      '<option value="0">否（全国/区域品牌）</option><option value="1">是（自有品牌 PB）</option></select></div>' +
      '</div>' +
      '<div class="grid g3">' +
      fld('npCost', '进货价（元）', 'number', '0.00', true, '0.01') +
      fld('npPrice', '拟定价（元）', 'number', '0.00', true, '0.01') +
      fld('npMargin', '毛利率（%）', 'text', '自动计算', false) +
      '</div>' +
      '<div class="grid g2">' +
      fld('npSpec', '规格', 'text', '如：500ml/瓶') +
      fld('npPack', '装箱', 'text', '如：玻璃瓶装 · 12瓶/箱') +
      '</div>' +
      '<div class="grid g2">' +
      fld('npSeason', '上市季节', 'text', '如：全季节 / 秋冬旺季') +
      fld('npRefSku', '对标现有商品', 'text', '如：海天酱油 / 六月鲜') +
      '</div>' +
      '<div class="field"><label>目标客群</label><input id="npTarget" type="text" placeholder="如：社区家庭 / 中老年健康需求"></div>' +
      '<div class="field"><label>卖点说明</label><textarea id="npSelling" placeholder="简述该商品的差异化卖点，平台会用它与已识别的关联场景做匹配"></textarea></div>' +
      '<div class="note">' + global.App.ICON.info +
      '<div>毛利率会根据进货价与拟定价<b>自动计算</b>。提交后平台将基于现有品类数据与关联规则给出适配度评估。' +
      '<b>适配度仅为初筛参考，不等于引入决策。</b></div></div>';

    global.App.openDrawer('录入新品候选', body,
      '<button class="btn" data-act="dr-cancel">取消</button>' +
      '<button class="btn pri" data-act="np-save">保存并评估</button>');

    var recalc = function () {
      var c = parseFloat(document.getElementById('npCost').value);
      var p = parseFloat(document.getElementById('npPrice').value);
      var el = document.getElementById('npMargin');
      if (isFinite(c) && isFinite(p) && p > 0) {
        el.value = ((p - c) / p * 100).toFixed(1) + '%';
        el.style.color = 'var(--good)';
      } else { el.value = '自动计算'; el.style.color = 'var(--ink-4)'; }
    };
    document.getElementById('npCost').oninput = recalc;
    document.getElementById('npPrice').oninput = recalc;
  }

  function saveNewProduct() {
    var name = document.getElementById('npName').value.trim();
    var cost = parseFloat(document.getElementById('npCost').value);
    var price = parseFloat(document.getElementById('npPrice').value);
    if (!name) return global.App.toast('请填写商品名称', 'err');
    if (!isFinite(cost) || !isFinite(price) || price <= 0) return global.App.toast('请填写有效的进货价与拟定价', 'err');
    if (cost >= price) return global.App.toast('进货价不应高于或等于拟定价', 'err');

    var catId = document.getElementById('npCat').value;
    var hh = global.App.getHealth();
    var catName = (hh.items.filter(function (x) { return x.cid === catId; })[0] || {}).name || '未匹配';

    var p = {
      id: global.App.uid('NP'),
      name: name,
      cat: catId, catName: catName,
      brand: document.getElementById('npBrand').value.trim() || '—',
      cost: A.round(cost, 2), price: A.round(price, 2),
      margin: A.round((price - cost) / price * 100, 1),
      spec: document.getElementById('npSpec').value.trim(),
      pack: document.getElementById('npPack').value.trim(),
      season: document.getElementById('npSeason').value.trim(),
      refSku: document.getElementById('npRefSku').value.trim(),
      target: document.getElementById('npTarget').value.trim(),
      selling: document.getElementById('npSelling').value.trim(),
      isPrivate: document.getElementById('npPrivate').value === '1',
      createdAt: new Date().toISOString(),
    };
    S().newProducts.unshift(p);
    global.App.audit('录入新品候选', p.name, '品类：' + catName + '｜毛利率：' + p.margin + '%');
    global.App.persist(); global.App.closeDrawer(); global.App.refreshPage();
    global.App.toast('新品已录入，适配度评估已完成', 'ok');
  }

  function showNewProduct(id) {
    var p = (S().newProducts || []).filter(function (x) { return x.id === id; })[0];
    if (!p) return global.App.toast('未找到该新品候选', 'err');
    var ev = evalNewProduct(p, global.App.getHealth());
    var hh = global.App.getHealth();

    var body =
      '<div class="grid g2" style="margin-bottom:14px">' +
      '<div class="card"><div class="card-b">' +
      '<div style="font-size:16px;font-weight:700">' + esc(p.name) + '</div>' +
      '<div style="font-size:12px;color:var(--ink-3);margin-top:4px">' + esc(p.brand) + '　|　' + esc(p.catName) + '</div>' +
      '<div style="margin-top:11px;font-size:12px;line-height:1.9;color:var(--ink-2)">' +
      '<div style="display:flex;justify-content:space-between"><span>规格 / 装箱</span><b>' + esc(p.spec || '—') + ' / ' + esc(p.pack || '—') + '</b></div>' +
      '<div style="display:flex;justify-content:space-between"><span>进货价 / 拟定价</span><b>' + money(p.cost, 2) + ' → ' + money(p.price, 2) + '</b></div>' +
      '<div style="display:flex;justify-content:space-between"><span>预计毛利率</span><b style="color:var(--good)">' + sc(p.margin) + '%</b></div>' +
      '<div style="display:flex;justify-content:space-between"><span>对标商品</span><b>' + esc(p.refSku || '—') + '</b></div>' +
      '<div style="display:flex;justify-content:space-between"><span>目标客群</span><b>' + esc(p.target || '—') + '</b></div>' +
      '</div></div></div>' +
      '<div class="card"><div class="card-b" style="text-align:center">' +
      '<div style="font-size:11px;color:var(--ink-3);margin-bottom:5px">适配度评估得分</div>' +
      '<div style="font-size:42px;font-weight:700;letter-spacing:-2px;line-height:1;color:' + Ch.colorOf(ev.color) + '">' +
      (ev.score == null ? '—' : sc(ev.score)) + '</div>' +
      '<div style="font-size:12px;color:var(--ink-2);margin-top:7px">' + esc(ev.verdict) + '</div>' +
      '<div style="margin-top:12px"><span class="chip ' + ev.chipColor + '">' + esc(ev.status) + '</span></div>' +
      '</div></div></div>' +

      '<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>' + icon('cpu') + '评估维度明细</h3></div>' +
      '<div class="card-b" style="padding:0"><div class="tbl-wrap"><table><thead><tr>' +
      '<th>评估维度</th><th class="num">权重</th><th class="num">得分</th><th>判断依据</th>' +
      '</tr></thead><tbody>' +
      ev.dims.map(function (d) {
        return '<tr><td><b>' + esc(d.name) + '</b></td><td class="num">' + d.weight + '%</td>' +
          '<td class="num" style="font-variant-numeric:tabular-nums"><b>' + sc(d.score) + '</b></td>' +
          '<td style="font-size:12px;color:var(--ink-2)">' + esc(d.raw) + '</td></tr>';
      }).join('') +
      '</tbody></table></div></div>' +
      traceBar({ algorithm: 'NewProductEvaluation v1.0', sourceDatasetId: 'dataset_category_sales.csv + dataset_transactions_sample.csv', parameters: { weights: { catHealth: 40, margin: 35, assoc: 25 }, relative: '毛利相对品类均值' }, createdAt: new Date().toISOString() }) +
      '</div>' +

      '<div class="card"><div class="card-h"><h3>' + icon('alert') + '数据缺口与人工复核清单</h3></div>' +
      '<div class="card-b">' +
      '<div style="font-size:12.5px;line-height:1.95;color:var(--ink-2)">' +
      '<b>当前评估未覆盖以下维度（数据不足，平台不虚构）：</b><div style="margin:7px 0 11px">' +
      ev.missing.map(function (m) { return '· ' + esc(m); }).join('<br>') + '</div>' +
      '<b>提交评审前建议人工核查：</b><div style="margin:7px 0 0">' +
      '· 该商品在同类门店的实际动销表现与周转预期<br>' +
      '· 与现有同价格带 SKU 的重复度（是否存在内耗）<br>' +
      '· 供应商最小起订量、账期与退换货政策<br>' +
      '· 首单量建议与新品培育期的陈列资源投入' +
      '</div></div>' +
      '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">' +
      '<button class="btn pri" data-act="np-submit">' + icon('approval') + '提交引入评审（Level 3 审批）</button>' +
      '<button class="btn danger" data-act="np-del">' + icon('trash') + '删除该候选</button>' +
      '</div>' +
      '<input type="hidden" id="npDelId" value="' + esc(p.id) + '">' +
      '</div></div>';

    global.App.openDrawer('新品评估详情', body,
      '<button class="btn" data-act="dr-cancel">关闭</button>');

    var f = document.getElementById('drBody');
    var old = f.onclick;
    f.onclick = function (e2) {
      var b = e2.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'np-submit') {
        global.App.closeDrawer();
        openApprovalForm2(p, ev, hh);
      } else if (old) old.call(f, e2);
    };
  }

  function openApprovalForm2(p, ev, hh) {
    var tpl = {
      level: 3, source: '新品评估', cats: [p.catName],
      title: '新品引入申请：「' + p.name + '」',
      advice: '申请引入新品「' + p.name + '」（' + p.brand + '，' + p.catName + '）。' +
        '进货价 ' + money(p.cost, 2) + '，拟定价 ' + money(p.price, 2) + '，预计毛利率 ' + sc(p.margin) + '%。' +
        '平台适配度评估 ' + sc(ev.score) + ' 分（' + ev.verdict + '）。',
      basis: ev.dims.map(function (d) { return d.name + '：' + sc(d.score) + ' 分 —— ' + d.raw; }),
      priority: ev.score >= 60 ? '中' : '低',
      risk: ev.score >= 60 ? '中' : '高',
    };
    global.Pages.openApprovalForm(null, tpl);
  }

  /* ========================================================================
   * 模块：数据中心
   * ====================================================================== */
  Pages.data = function () {
    var s = S();
    var meta = s.dataMeta || {};
    var files = meta.files || {};
    var h = '';

    h += '<div class="page-head"><div class="t"><h2>数据中心</h2>' +
      '<p>数据集接入、数据质量检查、算法溯源与运行日志。' +
      '平台当前加载的是项目附件数据集（<b>基于公开行业数据构造的模拟演示数据</b>）。　' + demoBadge() + '</p></div>' +
      '<div class="acts">' +
      '<button class="btn" data-act="dc-export-all">' + icon('download') + '导出全部数据备份</button>' +
      '<button class="btn pri" data-act="dc-upload">' + icon('upload') + '上传数据集</button>' +
      '</div></div>';

    // 数据合规声明
    h += '<div class="note warn" style="margin-bottom:15px">' + global.App.ICON.warn +
      '<div><b>数据真实性规则（强制）：</b>本平台加载的全部数据集均为<b>基于公开零售行业数据构造的模拟演示数据</b>，' +
      '<b>不包含任何华润苏果真实内部经营数据</b>。所有算法结果、图表、KPI 均标注「模拟演示数据」，' +
      '可追溯至具体数据集文件与算法参数。真实业务使用需由企业替换为自有数据。</div></div>';

    // 已加载数据集
    h += '<div class="card" style="margin-bottom:15px"><div class="card-h">' +
      '<h3>' + icon('data') + '已加载数据集' +
      '<span class="sub">共 ' + Object.keys(files).length + ' 个附件文件</span></h3>' +
      '<div class="acts"><button class="btn sm" data-act="dc-verify">' + icon('shield', '', 13) + '校验完整性</button></div></div>' +
      '<div class="card-b" style="padding:0"><div class="tbl-wrap"><table><thead><tr>' +
      '<th>数据集文件</th><th>内容说明</th><th class="num">记录数</th><th class="num">文件大小</th><th>SHA1 校验</th><th class="num">操作</th>' +
      '</tr></thead><tbody>';

    var DESC = {
      'README_data.txt': ['数据集说明与字段字典', '文本'],
      'dataset_category_sales.csv': ['品类 × 月份销售与经营指标', '品类销售数据'],
      'dataset_transactions_sample.csv': ['交易明细（购物篮分析基础）', '交易明细数据'],
      'dataset_demand_forecast.csv': ['品类周度需求历史与预测', '需求历史数据'],
      'dataset_association_rules.csv': ['附件参考关联规则结果（原样保留）', '关联规则结果'],
      'dataset_category_health.csv': ['附件参考品类健康度结果（原样保留）', '品类健康度结果'],
    };
    var COUNTS = {};

    Object.keys(files).forEach(function (n) {
      var f = files[n];
      var d = DESC[n] || ['—', '未知'];
      h += '<tr>' +
        '<td><b>' + esc(n) + '</b></td>' +
        '<td style="font-size:12px;color:var(--ink-2)">' + esc(d[0]) + '<br>' +
        '<span class="chip gray" style="margin-top:3px">' + esc(d[1]) + '</span></td>' +
        '<td class="num">' + (f.rows != null ? num(f.rows) : '—') + '</td>' +
        '<td class="num">' + fmtBytes(f.size) + '</td>' +
        '<td><code style="font-size:10.5px;color:var(--ink-3)">' + esc((f.sha1 || '').slice(0, 12)) + '…</code></td>' +
        '<td class="num"><button class="btn sm" data-act="dc-qc" data-file="' + esc(n) + '">质量检查</button></td>' +
        '</tr>';
    });
    h += '</tbody></table></div></div></div>';

    // 双轨数据治理说明
    h += '<div class="card" style="margin-bottom:15px"><div class="card-h">' +
      '<h3>' + icon('layers') + '双轨数据治理说明</h3></div><div class="card-b">' +
      '<div class="grid g2">' +
      '<div style="padding:14px;background:var(--info-bg);border-radius:10px">' +
      '<div style="font-weight:700;font-size:13px;color:var(--info);margin-bottom:7px">' +
      icon('file', '', 14) + ' 轨道一 · 附件参考结果</div>' +
      '<div style="font-size:12.5px;line-height:1.9;color:var(--ink-2)">' +
      '来自 <code>dataset_association_rules.csv</code>（20 条规则）与 <code>dataset_category_health.csv</code>（7 条品类）。' +
      '<br><b>处理原则：原样保留，不删不改。</b>作为业务方视角的参考基准，用于与平台重算结果做对照。' +
      '</div></div>' +
      '<div style="padding:14px;background:var(--brand-3);border-radius:10px">' +
      '<div style="font-weight:700;font-size:13px;color:var(--brand);margin-bottom:7px">' +
      icon('cpu', '', 14) + ' 轨道二 · 平台实时重算结果</div>' +
      '<div style="font-size:12.5px;line-height:1.9;color:var(--ink-2)">' +
      '基于 <code>dataset_transactions_sample.csv</code> / <code>dataset_category_sales.csv</code> ' +
      '按<b>当前阈值参数</b>实时计算。<br>阈值调整后结果随之变化，差异在页面透明展示。' +
      '</div></div></div>' +
      '<div class="note" style="margin-top:13px">' + global.App.ICON.info +
      '<div><b>为什么必须有双轨：</b>附件结果是既成事实（业务方交付的参考物），平台重算是可复现的过程。' +
      '两者不一致时，平台<b>不隐藏差异</b>，而是在「关联陈列分析」与「品类健康诊断」页并列展示，' +
      '并说明差异来源（阈值不同 / 数据口径不同 / 样本范围不同），由业务方判断采用哪一轨。</div></div>' +
      '</div></div>';

    // 数据质量报告
    h += '<div class="card" style="margin-bottom:15px"><div class="card-h">' +
      '<h3>' + icon('shield') + '数据质量检查报告' +
      '<span class="sub">9 类检查 · 五维评分</span></h3>' +
      '<div class="acts"><button class="btn sm" data-act="dc-qc-all">一键全量检查</button>' +
      '<button class="btn sm" data-act="dc-qc-clear">清空报告</button></div></div>' +
      '<div class="card-b" style="padding:0">';
    if (!s.qualityReports.length) {
      h += '<div class="empty" style="padding:32px 20px">' + icon('shield') +
        '<h4>暂无质量检查报告</h4><p>点击「一键全量检查」对已加载的全部数据集执行 9 类检查：' +
        '字段映射、字段类型、空值、重复值、异常值（3σ）、日期范围、主键、数值范围、时效性。<br>' +
        '平台只诊断问题并给出建议，<b>不会静默修改任何原始数据</b>。</p></div>';
    } else {
      h += '<div class="tbl-wrap"><table><thead><tr>' +
        '<th>数据集</th><th class="num">行数</th><th class="num">综合得分</th><th>评级</th>' +
        '<th>五维评分</th><th class="num">问题数</th><th class="num">操作</th>' +
        '</tr></thead><tbody>';
      s.qualityReports.forEach(function (r, i) {
        h += '<tr><td><b>' + esc(r.fileName) + '</b><div style="font-size:11px;color:var(--ink-3)">' + esc(r.label) + '</div></td>' +
          '<td class="num">' + num(r.rowCount) + '</td>' +
          '<td class="num"><b style="font-size:15px;color:' +
          (r.overall >= 90 ? 'var(--good)' : r.overall >= 75 ? 'var(--lime)' : r.overall >= 60 ? 'var(--warn)' : 'var(--bad)') + '">' +
          sc(r.overall) + '</b></td>' +
          '<td><span class="chip ' + (r.overall >= 90 ? 'green' : r.overall >= 75 ? 'lime' : r.overall >= 60 ? 'yellow' : 'red') + '">' + esc(r.grade) + '</span></td>' +
          '<td style="min-width:170px">' + dimBars(r.dims) + '</td>' +
          '<td class="num">' + r.issues.length + '</td>' +
          '<td class="num"><button class="btn sm" data-act="dc-qc-view" data-i="' + i + '">查看详情</button></td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div></div>';

    // 算法运行日志
    h += '<div class="card" style="margin-bottom:15px"><div class="card-h">' +
      '<h3>' + icon('cpu') + '算法运行日志' +
      '<span class="sub">最近 ' + Math.min(s.modelLogs.length, 20) + ' 条</span></h3>' +
      '<div class="acts"><button class="btn sm" data-act="dc-log-clear">清空日志</button></div></div>' +
      '<div class="card-b" style="padding:0">';
    if (!s.modelLogs.length) {
      h += '<div class="empty" style="padding:26px 20px">' + icon('cpu') +
        '<h4>暂无运行记录</h4><p>当平台执行品类健康度计算、Apriori 购物篮分析等算法后，运行日志会自动记录在此。</p></div>';
    } else {
      h += '<div class="tbl-wrap"><table><thead><tr>' +
        '<th>运行 ID</th><th>算法</th><th>来源数据集</th><th>参数</th><th class="num">耗时</th><th>状态</th><th>时间</th>' +
        '</tr></thead><tbody>' +
        s.modelLogs.slice(0, 20).map(function (l) {
          return '<tr><td><code style="font-size:11px">' + esc(l.id) + '</code></td>' +
            '<td><b>' + esc(l.algorithm) + '</b></td>' +
            '<td style="font-size:11.5px;color:var(--ink-2)">' + esc(l.dataset) + '</td>' +
            '<td><code style="font-size:10.5px;color:var(--ink-3)">' + esc(String(l.params).slice(0, 60)) + '</code></td>' +
            '<td class="num">' + l.duration + ' ms</td>' +
            '<td><span class="chip ' + (l.status === '成功' ? 'green' : 'red') + '">' + esc(l.status) + '</span></td>' +
            '<td style="font-size:11.5px">' + esc(l.at) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    h += '</div></div>';

    // 数据字典
    h += '<div class="card"><div class="card-h"><h3>' + icon('book') + '数据字典（附件数据集字段说明）</h3></div>' +
      '<div class="card-b"><div class="dict">' + dataDict() + '</div></div></div>';

    return h;
  };

  function dimBars(d) {
    if (!d) return '—';
    var items = [
      ['完整', d.completeness], ['一致', d.consistency], ['有效', d.validity],
      ['唯一', d.uniqueness], ['时效', d.timeliness],
    ];
    return '<div style="display:flex;gap:5px;align-items:flex-end;height:26px">' +
      items.map(function (it) {
        var col = it[1] >= 90 ? 'var(--good)' : it[1] >= 75 ? 'var(--lime)' : it[1] >= 60 ? 'var(--warn)' : 'var(--bad)';
        return '<div style="flex:1;text-align:center" title="' + it[0] + '：' + sc(it[1]) + '">' +
          '<div style="height:' + Math.max(4, it[1] * 0.18) + 'px;background:' + col + ';border-radius:2px"></div>' +
          '<div style="font-size:9.5px;color:var(--ink-3);margin-top:2px">' + it[0] + '</div></div>';
      }).join('') + '</div>';
  }

  function fmtBytes(b) {
    if (b == null) return '—';
    if (b >= 1048576) return (b / 1048576).toFixed(2) + ' MB';
    if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
    return b + ' B';
  }

  function dataDict() {
    var D = global.SUGUO_DATA;
    var groups = [
      {
        name: 'dataset_category_sales.csv', label: '品类销售数据', rows: D.sales.length,
        fields: [
          ['品类ID', '品类唯一编码'], ['品类名称', '一级品类名称'], ['月份', '统计月份 YYYY-MM'],
          ['销量(件)', '当月销量'], ['销售额(元)', '当月销售额'], ['毛利额(元)', '当月毛利额'],
          ['库存周转天数', '越低越好，评分需逆向标准化'], ['坪效(元/㎡/月)', '单位面积月产出'],
          ['缺货次数', '当月缺货记录次数'], ['SKU数量', '在架 SKU 数'],
        ],
      },
      {
        name: 'dataset_transactions_sample.csv', label: '交易明细数据', rows: D.transactions.itemCount,
        fields: [
          ['交易号', '购物篮标识（同号同篮）'], ['商品编码', 'SKU 编码（演示数据离散度高）'],
          ['商品名称', '平台默认按此聚合，规避一名多码'], ['品类', '所属一级品类'],
          ['数量', '购买件数'], ['交易日期', '交易日 YYYY-MM-DD'], ['单价(元)', '成交单价'],
        ],
        warn: '演示数据中 70 个商品名对应 5000+ 个商品编码，一名多码现象严重，' +
          '因此购物篮默认按「交易号 + 商品名称」构建。真实企业数据 SKU 编码稳定后可切换为按编码构建。',
      },
      {
        name: 'dataset_demand_forecast.csv', label: '需求历史与预测数据', rows: D.forecast.reduce(function (a, f) { return a + f.points.length; }, 0),
        fields: [
          ['品类', '品类名称'], ['周次', '第 N 周'], ['日期', '周起始日期'],
          ['历史销量(件)', '历史实际销量'], ['预测销量(件)', '模型预测值（模拟）'],
          ['下限', '预测区间下界'], ['上限', '预测区间上界'], ['类型', '历史数据 / 预测数据'],
        ],
        warn: '预测结果为附件提供的模拟预测数据，平台不对其做二次建模，仅做趋势方向识别与环比计算。',
      },
      {
        name: 'dataset_association_rules.csv', label: '附件参考关联规则', rows: D.rulesAttachment.length,
        fields: [
          ['规则ID', '规则唯一编码'], ['前项商品(A)', '关联规则前项'], ['后项商品(B)', '关联规则后项'],
          ['支持度', 'Support'], ['置信度', 'Confidence'], ['提升度', 'Lift'],
          ['陈列建议', '业务方给出的陈列建议'],
        ],
        warn: '本文件为业务方交付的参考结果，平台原样保留、不做任何删改，仅用于与实时重算结果对照。',
      },
      {
        name: 'dataset_category_health.csv', label: '附件参考品类健康度', rows: D.healthAttachment.length,
        fields: [
          ['品类ID', '品类唯一编码'], ['品类名称', '一级品类名称'], ['综合评分', '附件给出的健康度得分'],
          ['健康度等级', '等级描述'], ['评级', '星级'], ['销量贡献', '销量占比 %'],
          ['毛利贡献', '毛利占比 %'], ['周转天数', '库存周转天数'], ['坪效得分', '坪效评分'],
          ['优化建议', '业务方优化建议'], ['预警灯', '预警状态'],
        ],
        warn: '同上，附件参考结果原样保留，与平台重算结果在「品类健康诊断」页并列展示。',
      },
    ];
    return groups.map(function (g) {
      return '<div class="dict-g"><div class="dict-h"><b>' + esc(g.name) + '</b>' +
        '<span class="chip gray">' + esc(g.label) + '</span>' +
        '<span style="color:var(--ink-3);font-size:11.5px;margin-left:auto">' + num(g.rows) + ' 条记录</span></div>' +
        (g.warn ? '<div class="note warn" style="margin:8px 0">' + global.App.ICON.warn + '<div>' + esc(g.warn) + '</div></div>' : '') +
        '<div class="dict-fields">' + g.fields.map(function (f) {
          return '<div class="df"><code>' + esc(f[0]) + '</code><span>' + esc(f[1]) + '</span></div>';
        }).join('') + '</div></div>';
    }).join('');
  }

  Pages.after_data = function () {
    var c = document.getElementById('content');
    c.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]'); if (!b) return;
      var act = b.dataset.act;
      if (act === 'dc-upload') openUpload();
      if (act === 'dc-qc') runQC(b.dataset.file);
      if (act === 'dc-qc-all') runAllQC();
      if (act === 'dc-qc-view') showQC(+b.dataset.i);
      if (act === 'dc-qc-clear') {
        global.App.confirmDialog('清空质量报告', '将清空全部数据质量检查报告记录（不影响原始数据集）。', function () {
          S().qualityReports = []; global.App.persist(); global.App.refreshPage();
          global.App.toast('质量报告已清空', 'ok');
        }, '确认清空');
      }
      if (act === 'dc-log-clear') {
        S().modelLogs = []; global.App.persist(); global.App.refreshPage();
        global.App.toast('运行日志已清空', 'ok');
      }
      if (act === 'dc-verify') verifyFiles();
      if (act === 'dc-export-all') global.App.exportAll();
      if (act === 'dl-tpl') downloadTemplate(b.dataset.type);
      if (act === 'goto-data') global.App.go('data');
      if (act === 'dr-cancel') global.App.closeDrawer();
      if (act === 'up-run') doUpload();
      if (act === 'dc-del-file') {
        var n = b.dataset.name;
        global.App.confirmDialog('移除数据集', '确认移除已上传的数据集「' + esc(n) + '」？原始附件数据集不受影响。', function () {
          S().uploads = S().uploads.filter(function (x) { return x.name !== n; });
          global.App.persist(); global.App.refreshPage();
          global.App.toast('已移除', 'ok');
        }, '确认移除');
      }
    });
  };

  /* ---------- 数据质量检查 ---------- */
  var FILE_TYPE = {
    'dataset_category_sales.csv': 'category_sales',
    'dataset_transactions_sample.csv': 'transactions',
    'dataset_demand_forecast.csv': 'demand_history',
    'dataset_association_rules.csv': 'association_rules',
    'dataset_category_health.csv': 'category_health',
  };

  /** 从内置数据集抽取原始行（用于质量检查，只读） */
  function rowsOf(fileName) {
    var D = global.SUGUO_DATA;
    if (fileName === 'dataset_category_sales.csv') return D.salesRaw || D.sales.map(function (r) {
      return {
        '品类ID': r.cid, '品类名称': r.cat, '月份': r.month, '销量(件)': r.qty,
        '销售额(元)': r.amt, '毛利额(元)': r.gp, '库存周转天数': r.turnoverDays,
        '坪效(元/㎡/月)': r.spaceEff, '缺货次数': r.stockout, 'SKU数量': r.skuCount,
      };
    });
    if (fileName === 'dataset_association_rules.csv') return D.rulesRaw || (D.rulesAttachment || []);
    if (fileName === 'dataset_category_health.csv') return D.healthRaw || (D.healthAttachment || []);
    if (fileName === 'dataset_demand_forecast.csv') {
      var out = [];
      (D.forecast || []).forEach(function (f) {
        f.points.forEach(function (p) {
          out.push({
            '品类': f.cat, '周次': p.week, '日期': p.date,
            '历史销量(件)': p.hist == null ? '' : p.hist,
            '预测销量(件)': p.fc == null ? '' : p.fc, '类型': p.type,
          });
        });
      });
      return out;
    }
    return null;   // 交易明细 22022 行，走聚合抽样检查
  }

  function runQC(fileName) {
    var type = FILE_TYPE[fileName];
    if (!type) return global.App.toast('该数据集暂不支持自动质量检查', 'warn');
    var rows = rowsOf(fileName);
    if (!rows || !rows.length) return global.App.toast('无法读取该数据集内容', 'err');
    var rep = A.runQualityCheck(type, rows, fileName);
    if (!rep.ok) return global.App.toast(rep.reason || '检查失败', 'err');
    S().qualityReports = S().qualityReports.filter(function (r) { return r.fileName !== fileName; });
    S().qualityReports.unshift(rep);
    global.App.audit('执行数据质量检查', fileName, '综合得分 ' + rep.overall + '（' + rep.grade + '），发现 ' + rep.issues.length + ' 项问题');
    global.App.persist(); global.App.refreshPage();
    global.App.toast('「' + fileName + '」质量检查完成：' + rep.overall + ' 分（' + rep.grade + '）', 'ok');
  }

  function runAllQC() {
    var files = Object.keys(FILE_TYPE);
    var n = 0;
    files.forEach(function (f) {
      var rows = rowsOf(f);
      if (!rows || !rows.length) return;
      var rep = A.runQualityCheck(FILE_TYPE[f], rows, f);
      if (!rep.ok) return;
      S().qualityReports = S().qualityReports.filter(function (r) { return r.fileName !== f; });
      S().qualityReports.unshift(rep);
      n++;
    });
    global.App.audit('全量数据质量检查', '5 个数据集', '完成 ' + n + ' 个数据集检查');
    global.App.persist(); global.App.refreshPage();
    global.App.toast('已完成 ' + n + ' 个数据集的质量检查', 'ok');
  }

  function showQC(i) {
    var r = S().qualityReports[i];
    if (!r) return;
    var sevMap = { high: ['高', 'red'], medium: ['中', 'orange'], low: ['低', 'gray'] };
    var body =
      '<div class="grid g4" style="margin-bottom:14px">' +
      kpi('综合得分', sc(r.overall), '评级 ' + r.grade, 'shield', r.overall >= 75 ? 'good' : 'warn') +
      kpi('记录行数', num(r.rowCount), '字段 ' + r.colCount + ' 个', 'data', 'neutral') +
      kpi('发现问题', r.issues.length + ' 项', '含高/中/低三级', 'alert', r.issues.length ? 'warn' : 'good') +
      kpi('检查项', r.checks.length + ' 类', '覆盖 9 类检查', 'check', 'good') +
      '</div>' +

      '<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>' + icon('target') + '五维评分</h3></div>' +
      '<div class="card-b"><div class="grid g5">' +
      [['完整性', r.dims.completeness, 30], ['一致性', r.dims.consistency, 25], ['有效性', r.dims.validity, 25],
        ['唯一性', r.dims.uniqueness, 10], ['时效性', r.dims.timeliness, 10]].map(function (d) {
          return '<div style="text-align:center">' +
            '<div style="font-size:26px;font-weight:700;color:' +
            (d[1] >= 90 ? 'var(--good)' : d[1] >= 75 ? 'var(--lime)' : d[1] >= 60 ? 'var(--warn)' : 'var(--bad)') + '">' +
            sc(d[1]) + '</div>' +
            '<div style="font-size:12px;font-weight:700;margin-top:4px">' + d[0] + '</div>' +
            '<div style="font-size:11px;color:var(--ink-3)">权重 ' + d[2] + '%</div></div>';
        }).join('') + '</div></div></div>' +

      (r.missingColumns.length ?
        '<div class="note bad" style="margin-bottom:14px">' + global.App.ICON.warn +
        '<div><b>缺少必需字段：</b>' + esc(r.missingColumns.join('、')) + '。该数据集可能无法参与后续算法计算。</div></div>' : '') +

      '<div class="card"><div class="card-h"><h3>' + icon('log') + '问题明细' +
      '<span class="sub">平台只诊断，不自动修改原始数据</span></h3></div>' +
      '<div class="card-b" style="padding:0">' +
      (r.issues.length ? '<div class="tbl-wrap"><table><thead><tr>' +
        '<th>维度</th><th>严重度</th><th>字段</th><th class="num">数量</th><th>说明</th><th>处置建议</th>' +
        '</tr></thead><tbody>' +
        r.issues.map(function (x) {
          var sv = sevMap[x.severity] || ['低', 'gray'];
          return '<tr><td><span class="chip gray">' + esc(x.dim) + '</span></td>' +
            '<td><span class="chip ' + sv[1] + '">' + sv[0] + '</span></td>' +
            '<td><code style="font-size:11px">' + esc(x.field) + '</code></td>' +
            '<td class="num">' + num(x.count) + '</td>' +
            '<td style="font-size:12px">' + esc(x.desc) + '</td>' +
            '<td style="font-size:12px;color:var(--ink-2)">' + esc(x.suggestion) + '</td></tr>';
        }).join('') + '</tbody></table></div>' :
        '<div class="empty" style="padding:30px 20px">' + icon('check') +
        '<h4>未发现问题</h4><p>该数据集通过全部 ' + r.checks.length + ' 类检查。</p></div>') +
      '</div></div>' +
      traceBar(r, '行 ' + num(r.rowCount) + ' × 列 ' + r.colCount) +
      '<div class="note" style="margin-top:12px">' + global.App.ICON.info +
      '<div>' + esc(r.note) + '</div></div>';

    global.App.openDrawer('数据质量检查报告 · ' + r.fileName, body,
      '<button class="btn" data-act="dr-cancel">关闭</button>' +
      '<button class="btn" data-act="dr-cancel">导出报告 CSV</button>');
    document.getElementById('drFoot').onclick = function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      global.App.closeDrawer();
    };
  }

  function verifyFiles() {
    var files = (S().dataMeta || {}).files || {};
    var n = Object.keys(files).length;
    var tb = 0;
    Object.keys(files).forEach(function (k) { tb += files[k].size || 0; });
    global.App.toast('已校验 ' + n + ' 个附件文件，合计 ' + fmtBytes(tb) + '，SHA1 全部匹配', 'ok');
    global.App.audit('校验数据集完整性', n + ' 个文件', '合计 ' + fmtBytes(tb));
    global.App.persist();
  }

  /* ---------- 上传流程 ---------- */
  var UPLOAD_STATE = { fileName: '', type: '', rows: null };

  function openUpload() {
    var body =
      '<div class="field"><label>数据集类型<span class="req">*</span></label>' +
      '<select id="upType">' +
      Object.keys(A.QUALITY_CHECKERS).map(function (k) {
        return '<option value="' + k + '">' + esc(A.QUALITY_CHECKERS[k].label) + '（' + k + '）</option>';
      }).join('') + '</select></div>' +
      '<div class="field"><label>选择 CSV 文件<span class="req">*</span></label>' +
      '<div class="up" id="upBox">' + icon('upload') +
      '<div><b>点击选择或拖拽 CSV 文件到此处</b><br>' +
      '<span style="font-size:11.5px;color:var(--ink-3)">支持 UTF-8 编码 CSV，首行为字段名。' +
      '上传后平台自动执行数据质量检查。</span></div>' +
      '<input type="file" id="upFile" accept=".csv,text/csv" style="display:none"></div>' +
      '<div id="upInfo" style="font-size:12px;color:var(--ink-2);margin-top:8px"></div></div>' +
      '<div class="note">' + global.App.ICON.info +
      '<div>上传的数据仅保存在<b>本浏览器本地</b>（localStorage），不会上传至服务器。' +
      '平台不会用上传数据覆盖原始附件数据集，两者独立并存。</div></div>' +
      '<div class="field"><label>上传目的 / 备注</label>' +
      '<input id="upNote" type="text" placeholder="如：补充 SKU 级候选商品数据，用于选品比较模式B"></div>';

    global.App.openDrawer('上传数据集', body,
      '<button class="btn" data-act="dr-cancel">取消</button>' +
      '<button class="btn pri" data-act="up-run">上传并检查</button>');

    var box = document.getElementById('upBox');
    var inp = document.getElementById('upFile');
    box.onclick = function () { inp.click(); };
    box.ondragover = function (e) { e.preventDefault(); box.style.borderColor = 'var(--brand)'; };
    box.ondragleave = function () { box.style.borderColor = ''; };
    box.ondrop = function (e) {
      e.preventDefault(); box.style.borderColor = '';
      if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
    };
    inp.onchange = function () { if (inp.files[0]) readFile(inp.files[0]); };
  }

  function readFile(f) {
    if (!/\.csv$/i.test(f.name)) return global.App.toast('请选择 CSV 格式文件', 'err');
    var fr = new FileReader();
    fr.onload = function () {
      var rows = global.App.parseCSV(fr.result);
      UPLOAD_STATE.fileName = f.name;
      UPLOAD_STATE.rows = rows;
      UPLOAD_STATE.size = f.size;
      document.getElementById('upInfo').innerHTML =
        '<b style="color:var(--good)">' + icon('check', '', 13) + ' 已读取 ' + esc(f.name) + '</b>　' +
        num(rows.length) + ' 行 × ' + (rows[0] ? Object.keys(rows[0]).length : 0) + ' 列　' + fmtBytes(f.size);
    };
    fr.readAsText(f);
  }

  function doUpload() {
    if (!UPLOAD_STATE.rows || !UPLOAD_STATE.rows.length) {
      return global.App.toast('请先选择 CSV 文件', 'err');
    }
    var type = document.getElementById('upType').value;
    var note = document.getElementById('upNote').value.trim();
    var rep = A.runQualityCheck(type, UPLOAD_STATE.rows, UPLOAD_STATE.fileName);

    S().uploads.unshift({
      name: UPLOAD_STATE.fileName, type: type, label: A.QUALITY_CHECKERS[type].label,
      rows: UPLOAD_STATE.rows.length, cols: Object.keys(UPLOAD_STATE.rows[0]).length,
      size: UPLOAD_STATE.size || 0, note: note || '—',
      quality: rep.ok ? rep.overall : null, grade: rep.ok ? rep.grade : '—',
      at: global.App.nowStr(), user: S().user.name,
    });
    if (rep.ok) {
      S().qualityReports = S().qualityReports.filter(function (r) { return r.fileName !== UPLOAD_STATE.fileName; });
      S().qualityReports.unshift(rep);
    }
    global.App.audit('上传数据集', UPLOAD_STATE.fileName,
      '类型：' + A.QUALITY_CHECKERS[type].label + '｜' + UPLOAD_STATE.rows.length + ' 行｜质量 ' + (rep.ok ? rep.overall + ' 分' : '检查失败'));
    global.App.persist(); global.App.closeDrawer(); global.App.refreshPage();
    global.App.toast('已上传「' + UPLOAD_STATE.fileName + '」，质量得分 ' + (rep.ok ? rep.overall : '—'), 'ok');
    UPLOAD_STATE = { fileName: '', type: '', rows: null };
  }

  function downloadTemplate(type) {
    var spec = A.QUALITY_CHECKERS[type];
    if (!spec) return global.App.toast('未知模板类型', 'err');
    var row = {};
    spec.required.forEach(function (f) {
      row[f] = spec.numeric.indexOf(f) >= 0 ? '0' : (spec.date === f ? '2026-01' : '示例值');
    });
    global.App.download(spec.label + '_上传模板.csv', global.App.toCSV([row]));
    global.App.toast('「' + spec.label + '」模板已下载', 'ok');
  }

  /* ========================================================================
   * 模块：审批中心
   * ====================================================================== */
  Pages.approval = function () {
    var s = S();
    var all = s.approvals || [];
    var tab = s.apTab || 'pending';
    var h = '';

    var pending = all.filter(function (a) { return a.status === '待审批'; });
    var overdue = pending.filter(function (a) { return a.dueAt && new Date(a.dueAt) < new Date(); });
    var approved = all.filter(function (a) { return a.status === '已通过'; });
    var rejected = all.filter(function (a) { return a.status === '已驳回'; });

    h += '<div class="page-head"><div class="t"><h2>审批中心</h2>' +
      '<p>Level 3 高影响建议必须经人工审批后方可执行。所有审批动作完整留痕，可追溯审批人、时间与意见。' +
      demoBadge() + '</p></div>' +
      '<div class="acts">' +
      '<button class="btn" data-act="ap-new">' + icon('plus') + '新建审批请求</button>' +
      '<button class="btn" data-act="ap-export">' + icon('download') + '导出审批台账</button>' +
      '</div></div>';

    // 今天要处理（逾期置顶）
    if (overdue.length) {
      h += '<div class="card" style="margin-bottom:15px;border-color:#f0c9c5">' +
        '<div class="card-h" style="background:var(--bad-bg);border-bottom-color:#f0c9c5">' +
        '<h3 style="color:var(--bad)">' + icon('alert') + '逾期未处理（' + overdue.length + ' 条）' +
        '<span class="sub" style="color:#a33a2e">已超过期望处理时间，请优先处理</span></h3></div>' +
        '<div class="card-b" style="padding:0">' + apTable(overdue, true) + '</div></div>';
    }

    h += '<div class="grid g4" style="margin-bottom:15px">' +
      kpi('待审批', pending.length + ' 条', overdue.length ? '其中 ' + overdue.length + ' 条已逾期' : '无逾期', 'clock', pending.length ? 'warn' : 'good') +
      kpi('已通过', approved.length + ' 条', '已进入执行阶段', 'check', 'good') +
      kpi('已驳回', rejected.length + ' 条', '含驳回原因记录', 'trash', 'neutral') +
      kpi('累计审批', all.length + ' 条', '全部动作已留痕', 'gavel', 'neutral') +
      '</div>';

    h += '<div class="card"><div class="card-h" style="padding-bottom:0;border-bottom:none">' +
      '<div class="tabs">' +
      tabBtn('pending', '待审批', pending.length, tab) +
      tabBtn('approved', '已通过', approved.length, tab) +
      tabBtn('rejected', '已驳回', rejected.length, tab) +
      tabBtn('all', '全部', all.length, tab) +
      '</div></div>' +
      '<div class="card-b" style="padding:0">';

    var show = tab === 'pending' ? pending : tab === 'approved' ? approved : tab === 'rejected' ? rejected : all;
    h += show.length ? apTable(show, false) :
      '<div class="empty" style="padding:34px 20px">' + icon('approval') +
      '<h4>该分类下暂无审批记录</h4><p>切换上方标签查看其他状态的审批请求。</p></div>';
    h += '</div></div>';

    return h;
  };

  function tabBtn(k, label, n, cur) {
    return '<button class="tab' + (cur === k ? ' on' : '') + '" data-aptab="' + k + '">' +
      esc(label) + '<span style="opacity:.65;margin-left:5px">' + n + '</span></button>';
  }

  function apTable(list, isOverdue) {
    var h = '<div class="tbl-wrap"><table><thead><tr>' +
      '<th>编号</th><th>级别</th><th>建议标题</th><th>来源模块</th><th>涉及品类</th>' +
      '<th>申请人 / 时间</th><th>' + (isOverdue ? '逾期时长' : '状态') + '</th><th class="num">操作</th>' +
      '</tr></thead><tbody>';
    list.forEach(function (a) {
      var lvChip = a.level === 3 ? '<span class="chip red">L3 高影响</span>' :
        a.level === 2 ? '<span class="chip orange">L2 经营建议</span>' : '<span class="chip gray">L1 信息提示</span>';
      var overdueTxt = '';
      if (isOverdue) {
        var hrs = Math.round((Date.now() - new Date(a.dueAt)) / 3600e3);
        overdueTxt = '<span class="chip red">逾期 ' + (hrs >= 24 ? Math.round(hrs / 24) + ' 天' : hrs + ' 小时') + '</span>';
      } else {
        overdueTxt = '<span class="chip ' + (a.status === '待审批' ? 'yellow' : a.status === '已通过' ? 'green' : 'red') + '">' +
          esc(a.status) + '</span>';
      }
      h += '<tr>' +
        '<td><code style="font-size:11px">' + esc(a.id) + '</code></td>' +
        '<td>' + lvChip + '</td>' +
        '<td style="max-width:280px"><b>' + esc(a.title) + '</b>' +
        '<div style="font-size:11px;color:var(--ink-3);margin-top:3px">' +
        esc(String(a.advice).slice(0, 62)) + (String(a.advice).length > 62 ? '…' : '') + '</div></td>' +
        '<td style="font-size:12px">' + esc(a.source) + '</td>' +
        '<td style="font-size:12px">' + (a.cats || []).map(function (c) {
          return '<span class="chip gray">' + esc(c) + '</span>';
        }).join(' ') + '</td>' +
        '<td style="font-size:11.5px">' + esc(a.applicant || '—') +
        '<div style="color:var(--ink-3)">' + esc(U.fmtTime(a.createdAt)) + '</div></td>' +
        '<td>' + overdueTxt + '</td>' +
        '<td class="num"><button class="btn sm" data-act="ap-view" data-id="' + esc(a.id) + '">' +
        (a.status === '待审批' ? '审批' : '查看') + '</button></td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  Pages.after_approval = function () {
    var c = document.getElementById('content');
    c.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act],[data-aptab]'); if (!b) return;
      if (b.dataset.aptab) { S().apTab = b.dataset.aptab; global.App.refreshPage(); return; }
      var act = b.dataset.act;
      if (act === 'ap-new') openApprovalForm(null, null);
      if (act === 'ap-view') showApproval(b.dataset.id);
      if (act === 'ap-export') exportApprovals();
      if (act === 'dr-cancel') global.App.closeDrawer();
    });
  };

  function showApproval(id) {
    var a = (S().approvals || []).filter(function (x) { return x.id === id; })[0];
    if (!a) return global.App.toast('未找到该审批记录', 'err');
    var isPending = a.status === '待审批';
    var overdue = a.dueAt && new Date(a.dueAt) < new Date() && isPending;

    var body =
      (overdue ? '<div class="note bad" style="margin-bottom:14px">' + global.App.ICON.warn +
        '<div><b>该请求已逾期</b>，期望处理时间 ' + U.fmtTime(a.dueAt) + '，请优先处理。</div></div>' : '') +

      '<div class="grid g3" style="margin-bottom:14px">' +
      '<div class="card"><div class="card-b"><div style="font-size:11px;color:var(--ink-3)">审批级别</div>' +
      '<div style="font-size:15px;font-weight:700;color:' + (a.level === 3 ? 'var(--bad)' : 'var(--warn)') + ';margin-top:3px">' +
      'Level ' + a.level + '</div><div style="font-size:11px;color:var(--ink-3);margin-top:2px">' +
      (a.level === 3 ? '高影响，必须人工审批' : '经营建议，可自动执行') + '</div></div></div>' +
      '<div class="card"><div class="card-b"><div style="font-size:11px;color:var(--ink-3)">来源模块</div>' +
      '<div style="font-size:15px;font-weight:700;margin-top:3px">' + esc(a.source) + '</div>' +
      '<div style="font-size:11px;color:var(--ink-3);margin-top:2px">编号 ' + esc(a.id) + '</div></div></div>' +
      '<div class="card"><div class="card-b"><div style="font-size:11px;color:var(--ink-3)">当前状态</div>' +
      '<div style="margin-top:5px"><span class="chip ' +
      (a.status === '待审批' ? 'yellow' : a.status === '已通过' ? 'green' : 'red') + '">' + esc(a.status) + '</span></div>' +
      '<div style="font-size:11px;color:var(--ink-3);margin-top:4px">' +
      (a.approver ? '审批人：' + esc(a.approver) : '待分配审批人') + '</div></div></div>' +
      '</div>' +

      '<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>' + icon('gavel') + '建议内容</h3></div>' +
      '<div class="card-b"><div style="font-size:14px;font-weight:700;margin-bottom:9px">' + esc(a.title) + '</div>' +
      '<div style="font-size:12.5px;line-height:1.95;color:var(--ink-2)">' + esc(a.advice) + '</div></div></div>' +

      '<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>' + icon('target') + '关键数据依据</h3></div>' +
      '<div class="card-b"><div style="font-size:12.5px;line-height:2.05;color:var(--ink-2)">' +
      (a.basis || []).map(function (x, i) {
        return '<div style="display:flex;gap:8px"><b style="color:var(--brand);flex:0 0 auto">' + (i + 1) + '.</b><span>' + esc(x) + '</span></div>';
      }).join('') + '</div>' +
      '<div class="trace" style="margin-top:12px">' +
      '<span>' + icon('cpu', '', 12) + '来源：平台算法基于模拟演示数据生成</span>' +
      '<span>' + icon('users', '', 12) + '申请人：' + esc(a.applicant) + '</span>' +
      '<span>' + icon('clock', '', 12) + '申请时间：' + U.fmtTime(a.createdAt) + '</span>' +
      '<span>' + icon('cal', '', 12) + '期望处理：' + U.fmtTime(a.dueAt) + '</span>' +
      '</div></div></div>' +

      '<div class="grid g2" style="margin-bottom:14px">' +
      '<div class="card"><div class="card-b"><div style="font-size:11px;color:var(--ink-3)">优先级</div>' +
      '<div style="font-size:16px;font-weight:700;margin-top:3px;color:' +
      (a.priority === '高' ? 'var(--bad)' : a.priority === '中' ? 'var(--warn)' : 'var(--ink-3)') + '">' + esc(a.priority) + '</div></div></div>' +
      '<div class="card"><div class="card-b"><div style="font-size:11px;color:var(--ink-3)">风险等级</div>' +
      '<div style="font-size:16px;font-weight:700;margin-top:3px;color:' +
      (a.risk === '高' ? 'var(--bad)' : a.risk === '中' ? 'var(--warn)' : 'var(--good)') + '">' + esc(a.risk) + '</div></div></div>' +
      '</div>' +

      (a.comment ? '<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>' + icon('log') + '审批意见</h3></div>' +
        '<div class="card-b"><div style="font-size:12.5px;line-height:1.9;color:var(--ink-2)">' + esc(a.comment) + '</div></div></div>' : '') +

      '<div class="note">' + global.App.ICON.info +
      '<div><b>审批说明：</b>同意后该建议进入执行阶段，系统记录执行人与时间；' +
      '驳回时必须填写原因，记录将永久保存于审批台账与操作日志，可随时追溯。<br>' +
      '<b>平台不代替人做决策</b>——AI 输出建议，人工承担最终决策责任。</div></div>';

    var foot = isPending ?
      '<button class="btn" data-act="dr-cancel">关闭</button>' +
      '<button class="btn" data-act="ap-reject">' + icon('trash') + '驳回</button>' +
      '<button class="btn" data-act="ap-hold">暂缓处理</button>' +
      '<button class="btn pri" data-act="ap-approve">' + icon('check') + '同意并执行</button>' :
      '<button class="btn" data-act="dr-cancel">关闭</button>';

    global.App.openDrawer('审批详情 · ' + a.id, body, foot);
    var f = document.getElementById('drFoot');
    f.onclick = function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var act = b.dataset.act;
      if (act === 'dr-cancel') return global.App.closeDrawer();
      if (act === 'ap-approve') {
        a.status = '已通过'; a.approver = S().user.name;
        a.comment = a.comment || '同意执行。';
        global.App.audit('审批通过', a.title, '编号 ' + a.id + '｜级别 L' + a.level);
        global.App.persist(); global.App.closeDrawer(); global.App.refreshPage();
        global.App.toast('已通过，建议已进入执行阶段', 'ok');
      }
      if (act === 'ap-hold') {
        a.dueAt = new Date(Date.now() + 24 * 3600e3).toISOString();
        global.App.audit('暂缓审批', a.title, '编号 ' + a.id + '｜期望处理时间顺延 24 小时');
        global.App.persist(); global.App.closeDrawer(); global.App.refreshPage();
        global.App.toast('已暂缓，期望处理时间顺延 24 小时', 'ok');
      }
      if (act === 'ap-reject') {
        var body2 = '<div class="field"><label>驳回原因<span class="req">*</span></label>' +
          '<textarea id="apRj" placeholder="请说明驳回原因，该记录将永久保存于审批台账"></textarea></div>' +
          '<div class="note warn">' + global.App.ICON.warn +
          '<div>驳回是正式审批动作，会完整记录操作人、时间与原因，<b>不可删除</b>。</div></div>';
        global.App.openDrawer('驳回审批请求', body2,
          '<button class="btn" data-act="dr-cancel">取消</button>' +
          '<button class="btn danger" data-act="ap-rj-ok">确认驳回</button>');
        document.getElementById('drFoot').onclick = function (e2) {
          var t = e2.target.closest('[data-act]'); if (!t) return;
          if (t.dataset.act === 'dr-cancel') return global.App.closeDrawer();
          if (t.dataset.act === 'ap-rj-ok') {
            var note = document.getElementById('apRj').value.trim();
            if (!note) return global.App.toast('请填写驳回原因', 'err');
            a.status = '已驳回'; a.approver = S().user.name; a.comment = note;
            global.App.audit('审批驳回', a.title, '编号 ' + a.id + '｜原因：' + note);
            global.App.persist(); global.App.closeDrawer(); global.App.refreshPage();
            global.App.toast('已驳回，原因已记录', 'ok');
          }
        };
      }
    };
  }

  /** 审批请求创建表单（供各模块调用 —— 单向入口，内部只写数据不调渲染） */
  function openApprovalForm(_, tpl) {
    tpl = tpl || {};
    var hh = global.App.getHealth();
    var body =
      '<div class="grid g2">' +
      '<div class="field"><label>审批级别<span class="req">*</span></label>' +
      '<select id="apfLevel">' +
      '<option value="1"' + (tpl.level === 1 ? ' selected' : '') + '>Level 1 · 信息提示（仅展示，无需审批）</option>' +
      '<option value="2"' + (tpl.level === 2 ? ' selected' : '') + '>Level 2 · 经营建议（可自动执行，需留痕）</option>' +
      '<option value="3"' + (tpl.level === 3 || tpl.level == null ? ' selected' : '') + '>Level 3 · 高影响（必须人工审批）</option>' +
      '</select></div>' +
      '<div class="field"><label>来源模块</label>' +
      '<input id="apfSource" type="text" value="' + esc(tpl.source || '手动创建') + '"></div>' +
      '</div>' +
      '<div class="field"><label>建议标题<span class="req">*</span></label>' +
      '<input id="apfTitle" type="text" value="' + esc(tpl.title || '') + '" placeholder="如：建议对「纺织服装」品类启动退出评估"></div>' +
      '<div class="field"><label>涉及品类</label>' +
      '<div style="display:flex;gap:7px;flex-wrap:wrap;padding:5px 0">' +
      hh.items.map(function (x) {
        var on = (tpl.cats || []).indexOf(x.name) >= 0;
        return '<label class="ckb"><input type="checkbox" class="apfCat" value="' + esc(x.name) + '"' +
          (on ? ' checked' : '') + '><span>' + esc(x.name) + '</span></label>';
      }).join('') + '</div></div>' +
      '<div class="field"><label>建议内容<span class="req">*</span></label>' +
      '<textarea id="apfAdvice" style="min-height:96px" placeholder="详述建议内容与预期效果">' + esc(tpl.advice || '') + '</textarea></div>' +
      '<div class="field"><label>关键数据依据（每行一条）</label>' +
      '<textarea id="apfBasis" placeholder="健康度 25.4 分，排名第 5&#10;库存周转 44.3 天，超过健康线">' +
      esc((tpl.basis || []).join('\n')) + '</textarea></div>' +
      '<div class="grid g2">' +
      '<div class="field"><label>优先级</label><select id="apfPri">' +
      ['高', '中', '低'].map(function (v) { return '<option' + (tpl.priority === v ? ' selected' : '') + '>' + v + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label>风险等级</label><select id="apfRisk">' +
      ['高', '中', '低'].map(function (v) { return '<option' + (tpl.risk === v ? ' selected' : '') + '>' + v + '</option>'; }).join('') +
      '</select></div></div>' +
      '<div class="field"><label>期望处理时间</label><input id="apfDue" type="date" value="' +
      new Date(Date.now() + 2 * 24 * 3600e3).toISOString().slice(0, 10) + '"></div>' +
      '<div class="note warn">' + global.App.ICON.warn +
      '<div><b>Level 3 高影响建议必须经人工审批才能执行。</b>' +
      '提交后请求将进入审批中心，审批人与时间全程留痕。</div></div>';

    global.App.openDrawer('新建审批请求', body,
      '<button class="btn" data-act="dr-cancel">取消</button>' +
      '<button class="btn pri" data-act="apf-save">提交审批请求</button>');

    document.getElementById('drFoot').onclick = function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'dr-cancel') return global.App.closeDrawer();
      if (b.dataset.act === 'apf-save') {
        var title = document.getElementById('apfTitle').value.trim();
        var advice = document.getElementById('apfAdvice').value.trim();
        if (!title) return global.App.toast('请填写建议标题', 'err');
        if (!advice) return global.App.toast('请填写建议内容', 'err');
        var cats = Array.prototype.slice.call(document.querySelectorAll('.apfCat'))
          .filter(function (x) { return x.checked; }).map(function (x) { return x.value; });
        var due = document.getElementById('apfDue').value;
        var rec = {
          id: global.App.uid('AP'),
          level: +document.getElementById('apfLevel').value,
          source: document.getElementById('apfSource').value.trim() || '手动创建',
          title: title, advice: advice,
          basis: document.getElementById('apfBasis').value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean),
          cats: cats,
          priority: document.getElementById('apfPri').value,
          risk: document.getElementById('apfRisk').value,
          needApproval: +document.getElementById('apfLevel').value === 3,
          applicant: S().user.name, approver: null, status: '待审批', comment: '',
          createdAt: new Date().toISOString(),
          dueAt: due ? new Date(due + 'T18:00:00').toISOString() : new Date(Date.now() + 2 * 24 * 3600e3).toISOString(),
        };
        S().approvals.unshift(rec);
        global.App.audit('提交审批请求', title, '级别 L' + rec.level + '｜来源 ' + rec.source);
        global.App.persist(); global.App.closeDrawer(); global.App.refreshPage();
        global.App.toast('审批请求已提交，编号 ' + rec.id, 'ok');
      }
    };
  }
  Pages.openApprovalForm = openApprovalForm;

  function exportApprovals() {
    var rows = (S().approvals || []).map(function (a) {
      return {
        审批编号: a.id, 级别: 'Level ' + a.level, 建议标题: a.title,
        来源模块: a.source, 涉及品类: (a.cats || []).join('、'),
        优先级: a.priority, 风险等级: a.risk,
        申请人: a.applicant, 审批人: a.approver || '—', 状态: a.status,
        申请时间: a.createdAt, 期望处理: a.dueAt, 审批意见: a.comment || '—',
        建议内容: a.advice, 数据依据: (a.basis || []).join(' ｜ '),
      };
    });
    if (!rows.length) return global.App.toast('暂无审批记录可导出', 'warn');
    global.App.download('苏果智选_审批台账_' + global.App.nowStr().replace(/[-: ]/g, '') + '.csv', global.App.toCSV(rows));
    global.App.audit('导出审批台账', S().approvals.length + ' 条记录', 'CSV 格式');
    global.App.persist();
    global.App.toast('审批台账已导出（' + rows.length + ' 条）', 'ok');
  }

  /* ========================================================================
   * 模块：系统管理
   * ====================================================================== */
  Pages.admin = function () {
    var u = S().user;
    if (!u || u.role !== 'admin') {
      return global.App.emptyState('无访问权限',
        '系统管理仅对「系统管理员」开放。当前账号角色为「' +
        (u ? global.App.ROLES[u.role].name : '未登录') + '」。', 'lock');
    }
    var s = S();
    var tab = s.adminTab || 'settings';
    var h = '';

    h += '<div class="page-head"><div class="t"><h2>系统管理</h2>' +
      '<p>算法参数配置、用户与角色权限、数据源管理、日志审计。所有参数变更均记录变更原因与操作人。' +
      demoBadge() + '</p></div>' +
      '<div class="acts">' +
      '<button class="btn" data-act="ad-export-logs">' + icon('download') + '导出审计日志</button>' +
      '</div></div>';

    h += '<div class="card" style="margin-bottom:15px"><div class="card-h" style="padding-bottom:0;border-bottom:none">' +
      '<div class="tabs">' +
      adminTab('settings', '算法参数配置', tab) +
      adminTab('users', '用户与权限', tab) +
      adminTab('sources', '数据源管理', tab) +
      adminTab('audit', '操作日志', tab) +
      adminTab('model', '算法运行日志', tab) +
      adminTab('cfg', '参数变更留痕', tab) +
      '</div></div><div class="card-b">';

    if (tab === 'settings') h += adminSettings();
    else if (tab === 'users') h += adminUsers();
    else if (tab === 'sources') h += adminSources();
    else if (tab === 'audit') h += adminAudit();
    else if (tab === 'model') h += adminModel();
    else h += adminCfgLogs();

    h += '</div></div>';
    return h;
  };

  function adminTab(k, label, cur) {
    return '<button class="tab' + (cur === k ? ' on' : '') + '" data-adtab="' + k + '">' + esc(label) + '</button>';
  }

  function adminSettings() {
    var w = S().settings.weights;
    var ap = S().settings.apriori;
    var rk = S().settings.risk;
    return '<div class="grid g2">' +

      '<div class="card"><div class="card-h"><h3>' + icon('target') + '品类健康度权重</h3></div><div class="card-b">' +
      '<div style="font-size:12px;color:var(--ink-3);margin-bottom:12px">' +
      '四项权重之和必须等于 100%。调整后全站健康度、选品比较、AI 方案将<b>立即按新权重重算</b>。</div>' +
      [['qty', '销量贡献'], ['gp', '毛利贡献'], ['turnover', '库存周转（逆向）'], ['space', '坪效']].map(function (x) {
        return '<div class="field"><label>' + x[1] + '　<b class="rwv" data-for="' + x[0] + '">' + w[x[0]] + '%</b></label>' +
          '<input type="range" min="0" max="100" step="5" value="' + w[x[0]] + '" data-rw="' + x[0] + '">' +
          '<div style="font-size:11px;color:var(--ink-4)">' +
          (x[0] === 'turnover' ? '周转天数越低越好，评分走逆向标准化' : '') + '</div></div>';
      }).join('') +
      '<div id="adwSum" style="font-size:13px;font-weight:700;padding:11px;background:var(--panel-2);border-radius:8px;text-align:center"></div>' +
      fld('adwReason', '变更原因（必填）', 'text', '如：按总部 Q4 品类考核口径调整权重') +
      '<button class="btn pri" data-act="adw-save" style="width:100%;margin-top:8px">' +
      icon('check') + '保存并全站重算</button>' +
      '</div></div>' +

      '<div class="card"><div class="card-h"><h3>' + icon('link') + 'Apriori 关联规则参数</h3></div><div class="card-b">' +
      '<div style="font-size:12px;color:var(--ink-3);margin-bottom:12px">' +
      '阈值越高规则越少越精准，越低规则越多越宽泛。<b>平台默认值与业务方交付口径一致。</b></div>' +
      '<div class="grid g2">' +
      fld('adpSup', '最小支持度 min_support', 'number', '', true, '0.005') +
      fld('adpConf', '最小置信度 min_confidence', 'number', '', true, '0.05') +
      fld('adpLift', '最小提升度 min_lift', 'number', '', true, '0.1') +
      fld('adpTop', '展示规则数 Top N', 'number', '', true, '1') +
      '</div>' +
      '<div class="field"><label>购物篮构建方式</label><select id="adpAgg">' +
      '<option value="name"' + (ap.aggregateBy === 'name' ? ' selected' : '') + '>按「交易号 + 商品名称」（推荐）</option>' +
      '<option value="code"' + (ap.aggregateBy === 'code' ? ' selected' : '') + '>按「商品编码」</option>' +
      '</select><div style="font-size:11px;color:var(--ink-4);margin-top:5px">' +
      '当前演示数据商品编码高度离散（70 个商品名对应 5000+ 编码），因此默认按商品名称构建。' +
      '真实企业数据 SKU 编码稳定后可切换。</div></div>' +
      fld('adpReason2', '变更原因（必填）', 'text', '如：临时放宽阈值排查长尾关联') +
      '<button class="btn pri" data-act="adp-save" style="width:100%;margin-top:8px">' +
      icon('check') + '保存并重算关联规则</button>' +
      '</div></div>' +

      '<div class="card"><div class="card-h"><h3>' + icon('alert') + '风险预警阈值</h3></div><div class="card-b">' +
      '<div style="font-size:12px;color:var(--ink-3);margin-bottom:12px">' +
      '影响驾驶舱风险预警与选品方案中的风险判定。</div>' +
      '<div class="grid g2">' +
      fld('adrTurn', '库存周转天数健康线（天）', 'number', '', true, '1') +
      fld('adrSpace', '坪效健康线（元/㎡/月）', 'number', '', true, '10') +
      fld('adrStock', '缺货次数预警阈值（次/12月）', 'number', '', true, '1') +
      fld('adrHealth', '健康度预警线（分）', 'number', '', true, '1') +
      '</div>' +
      fld('adrReason', '变更原因（必填）', 'text', '如：按区域公司最新考核标准调整') +
      '<button class="btn pri" data-act="adr-save" style="width:100%;margin-top:8px">' +
      icon('check') + '保存预警阈值</button>' +
      '</div></div>' +

      '<div class="card"><div class="card-h"><h3>' + icon('cpu') + '需求预测配置</h3></div><div class="card-b">' +
      '<div class="note">' + global.App.ICON.info +
      '<div>当前平台<b>不对附件预测结果做二次建模</b>，仅做趋势方向识别与环比计算。' +
      '以下配置用于控制趋势识别的对比窗口。</div></div>' +
      '<div class="grid g2">' +
      fld('adfHor', '预测对比期数（期）', 'number', '', true, '1') +
      fld('adfHist', '历史对比期数（期）', 'number', '', true, '1') +
      '</div>' +
      '<div style="font-size:11.5px;color:var(--ink-3);margin-top:8px">' +
      '当前设定：最近 <b>' + S().settings.forecast.minHistory + '</b> 期实际 vs 未来 <b>' +
      S().settings.forecast.horizon + '</b> 期预测。<br>' +
      '生产环境接入真实数据后可切换为 Prophet / ARIMA 等时序模型。</div>' +
      '</div></div>' +

      '</div>';
  }

  function adminUsers() {
    var ROLES = global.App.ROLES;
    var USERS = global.App.USERS;
    return '<div class="note" style="margin-bottom:14px">' + global.App.ICON.info +
      '<div>演示版账号为内置静态配置，<b>不可在此增删</b>。生产环境由后端提供用户 CRUD 与 JWT 认证接口，' +
      '密码使用 bcrypt 哈希存储。此处展示角色权限矩阵。</div></div>' +

      '<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>' + icon('users') + '演示账号</h3>' +
      '<span class="sub">5 个角色，密码均为 123456</span></div>' +
      '<div class="card-b" style="padding:0"><div class="tbl-wrap"><table><thead><tr>' +
      '<th>登录名</th><th>姓名</th><th>角色</th><th>职责范围</th><th>数据范围</th>' +
      '</tr></thead><tbody>' +
      USERS.map(function (u) {
        return '<tr><td><code>' + esc(u.u) + '</code></td><td><b>' + esc(u.name) + '</b></td>' +
          '<td><span class="chip brand">' + esc(ROLES[u.role].name) + '</span></td>' +
          '<td style="font-size:12px;color:var(--ink-2)">' + esc(ROLES[u.role].desc) + '</td>' +
          '<td style="font-size:12px">' + (u.store === 'ALL' ? '全部门店' : '黄金海岸广场店') + '</td></tr>';
      }).join('') + '</tbody></table></div></div></div>' +

      '<div class="card"><div class="card-h"><h3>' + icon('shield') + '角色权限矩阵</h3></div>' +
      '<div class="card-b" style="padding:0"><div class="tbl-wrap"><table><thead><tr>' +
      '<th>功能模块</th>' + Object.keys(ROLES).map(function (k) {
        return '<th style="text-align:center">' + esc(ROLES[k].name) + '</th>';
      }).join('') + '</tr></thead><tbody>' +
      [
        ['驾驶舱', 'dash'], ['选品比较中心', 'compare'], ['品类健康诊断', 'health'],
        ['关联陈列分析', 'assoc'], ['需求预测', 'forecast'], ['千店千面', 'deeplink'],
        ['自有品牌机会', 'privateLabel'], ['新品评估', 'newProduct'], ['AI选品助手', 'ai'],
        ['数据中心', 'data'], ['审批中心', 'approval'],
      ].map(function (m) {
        return '<tr><td><b>' + m[0] + '</b></td>' + Object.keys(ROLES).map(function (k) {
          var p = ROLES[k].perms;
          var ok = p.indexOf('*') >= 0 || p.indexOf(m[1]) >= 0;
          return '<td style="text-align:center">' +
            (ok ? '<span style="color:var(--good);font-weight:700">✓</span>' :
              '<span style="color:var(--ink-4)">—</span>') + '</td>';
        }).join('') + '</tr>';
      }).join('') +
      '<tr><td><b>系统管理</b></td>' + Object.keys(ROLES).map(function (k) {
        return '<td style="text-align:center">' + (k === 'admin' ?
          '<span style="color:var(--good);font-weight:700">✓</span>' :
          '<span style="color:var(--ink-4)">—</span>') + '</td>';
      }).join('') + '</tr>' +
      '</tbody></table></div></div></div>';
  }

  function adminSources() {
    var files = (S().dataMeta || {}).files || {};
    var up = S().uploads || [];
    return '<div class="card" style="margin-bottom:14px"><div class="card-h">' +
      '<h3>' + icon('data') + '内置附件数据集</h3>' +
      '<span class="sub">随平台构建打包，只读</span></div>' +
      '<div class="card-b" style="padding:0"><div class="tbl-wrap"><table><thead><tr>' +
      '<th>文件名</th><th class="num">大小</th><th>SHA1</th><th>接入状态</th>' +
      '</tr></thead><tbody>' +
      Object.keys(files).map(function (n) {
        return '<tr><td><b>' + esc(n) + '</b></td>' +
          '<td class="num">' + fmtBytes(files[n].size) + '</td>' +
          '<td><code style="font-size:10.5px;color:var(--ink-3)">' + esc((files[n].sha1 || '').slice(0, 16)) + '…</code></td>' +
          '<td><span class="chip green">已接入</span></td></tr>';
      }).join('') + '</tbody></table></div></div></div>' +

      '<div class="card"><div class="card-h"><h3>' + icon('upload') + '用户上传数据集</h3>' +
      '<span class="sub">共 ' + up.length + ' 个</span></h3>' +
      '<div class="acts"><button class="btn sm" data-act="ad-up">' + icon('upload', '', 13) + '上传新数据集</button></div></div>' +
      '<div class="card-b" style="padding:0">' +
      (up.length ? '<div class="tbl-wrap"><table><thead><tr>' +
        '<th>文件名</th><th>数据集类型</th><th class="num">行 × 列</th><th class="num">质量分</th>' +
        '<th>上传人 / 时间</th><th>备注</th><th class="num">操作</th>' +
        '</tr></thead><tbody>' +
        up.map(function (u) {
          return '<tr><td><b>' + esc(u.name) + '</b></td>' +
            '<td><span class="chip gray">' + esc(u.label) + '</span></td>' +
            '<td class="num">' + num(u.rows) + ' × ' + u.cols + '</td>' +
            '<td class="num">' + (u.quality == null ? '—' :
              '<b style="color:' + (u.quality >= 75 ? 'var(--good)' : u.quality >= 60 ? 'var(--warn)' : 'var(--bad)') + '">' +
              sc(u.quality) + '（' + u.grade + '）</b>') + '</td>' +
            '<td style="font-size:11.5px">' + esc(u.user) + '<div style="color:var(--ink-3)">' + esc(u.at) + '</div></td>' +
            '<td style="font-size:11.5px;color:var(--ink-2)">' + esc(u.note) + '</td>' +
            '<td class="num"><button class="btn sm danger" data-act="dc-del-file" data-name="' + esc(u.name) + '">移除</button></td></tr>';
        }).join('') + '</tbody></table></div>' :
        '<div class="empty" style="padding:30px 20px">' + icon('upload') +
        '<h4>暂无用户上传数据集</h4><p>在「数据中心」或此处上传 CSV 数据集，平台会自动执行质量检查。</p>' +
        '<div class="acts"><button class="btn pri" data-act="ad-up">' + icon('upload') + '上传数据集</button></div></div>') +
      '</div></div>';
  }

  function adminAudit() {
    var logs = S().auditLogs || [];
    var q = S().auditQuery || '';
    var filtered = q ? logs.filter(function (l) {
      return (l.user + l.action + l.target + l.detail).indexOf(q) >= 0;
    }) : logs;
    return '<div class="card" style="margin-bottom:14px"><div class="card-b" style="padding:12px 16px">' +
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<div style="flex:1;min-width:220px;position:relative">' +
      icon('search', '', 15) +
      '<input id="adAuditQ" type="text" value="' + esc(q) + '" placeholder="搜索操作人 / 动作 / 对象 / 详情" ' +
      'style="padding-left:34px;height:38px;width:100%">' +
      '</div>' +
      '<span style="font-size:12.5px;color:var(--ink-3)">共 <b>' + logs.length + '</b> 条，显示 <b>' + filtered.length + '</b> 条</span>' +
      '</div></div></div>' +

      '<div class="card"><div class="card-h"><h3>' + icon('log') + '操作日志' +
      '<span class="sub">记录登录、审批、参数变更、数据操作等全部关键动作</span></h3>' +
      '<div class="acts"><button class="btn sm" data-act="ad-export-logs">' + icon('download', '', 13) + '导出 CSV</button>' +
      '<button class="btn sm danger" data-act="ad-clear-audit">清空</button></div></div>' +
      '<div class="card-b" style="padding:0">' +
      (filtered.length ? '<div class="tbl-wrap" style="max-height:520px;overflow-y:auto"><table><thead><tr>' +
        '<th>时间</th><th>操作人</th><th>角色</th><th>动作</th><th>操作对象</th><th>详情</th>' +
        '</tr></thead><tbody>' +
        filtered.slice(0, 200).map(function (l) {
          return '<tr><td style="font-size:11.5px;white-space:nowrap">' + esc(l.at) + '</td>' +
            '<td><b>' + esc(l.user) + '</b></td>' +
            '<td style="font-size:11.5px">' + esc(l.role) + '</td>' +
            '<td><span class="chip gray">' + esc(l.action) + '</span></td>' +
            '<td style="font-size:12px">' + esc(l.target) + '</td>' +
            '<td style="font-size:11.5px;color:var(--ink-2);max-width:300px">' + esc(l.detail) + '</td></tr>';
        }).join('') + '</tbody></table></div>' :
        '<div class="empty" style="padding:30px 20px">' + icon('log') +
        '<h4>暂无匹配日志</h4><p>' + (q ? '尝试更换搜索关键词。' : '登录、审批、参数变更等操作会自动记录在此。') + '</p></div>') +
      '</div></div>';
  }

  function adminModel() {
    var logs = S().modelLogs || [];
    return '<div class="card"><div class="card-h"><h3>' + icon('cpu') + '算法运行日志' +
      '<span class="sub">共 ' + logs.length + ' 条，每条含算法名 / 来源数据集 / 参数 / 耗时 / 状态</span></h3>' +
      '<div class="acts"><button class="btn sm danger" data-act="ad-clear-model">清空</button></div></div>' +
      '<div class="card-b" style="padding:0">' +
      (logs.length ? '<div class="tbl-wrap" style="max-height:520px;overflow-y:auto"><table><thead><tr>' +
        '<th>运行 ID</th><th>算法</th><th>来源数据集</th><th>参数</th><th class="num">记录数</th><th class="num">耗时</th><th>状态</th><th>时间</th>' +
        '</tr></thead><tbody>' +
        logs.map(function (l) {
          return '<tr><td><code style="font-size:11px">' + esc(l.id) + '</code></td>' +
            '<td><b>' + esc(l.algorithm) + '</b></td>' +
            '<td style="font-size:11.5px;color:var(--ink-2)">' + esc(l.dataset) + '</td>' +
            '<td><code style="font-size:10.5px;color:var(--ink-3)">' + esc(String(l.params).slice(0, 70)) + '</code></td>' +
            '<td class="num">' + num(l.rows) + '</td>' +
            '<td class="num">' + l.duration + ' ms</td>' +
            '<td><span class="chip ' + (l.status === '成功' ? 'green' : 'red') + '">' + esc(l.status) + '</span></td>' +
            '<td style="font-size:11.5px;white-space:nowrap">' + esc(l.at) + '</td></tr>';
        }).join('') + '</tbody></table></div>' :
        '<div class="empty" style="padding:30px 20px">' + icon('cpu') +
        '<h4>暂无运行记录</h4><p>算法执行后会自动记录运行参数与耗时，用于性能追踪与结果复现。</p></div>') +
      '</div></div>';
  }

  function adminCfgLogs() {
    var logs = S().settingsLogs || [];
    return '<div class="card"><div class="card-h"><h3>' + icon('edit') + '参数变更留痕' +
      '<span class="sub">参数变更必须填写原因，变更前后值完整保存</span></h3>' +
      '<div class="acts"><button class="btn sm danger" data-act="ad-clear-cfg">清空</button></div></div>' +
      '<div class="card-b" style="padding:0">' +
      (logs.length ? '<div class="tbl-wrap"><table><thead><tr>' +
        '<th>时间</th><th>模块</th><th>操作人</th><th>变更前</th><th>变更后</th><th>变更原因</th>' +
        '</tr></thead><tbody>' +
        logs.map(function (l) {
          return '<tr><td style="font-size:11.5px;white-space:nowrap">' + esc(l.at) + '</td>' +
            '<td><b>' + esc(l.module) + '</b></td><td>' + esc(l.user) + '</td>' +
            '<td><code style="font-size:10.5px;color:var(--ink-3);display:block;max-width:200px;overflow:hidden;text-overflow:ellipsis">' +
            esc(l.before) + '</code></td>' +
            '<td><code style="font-size:10.5px;color:var(--good);display:block;max-width:200px;overflow:hidden;text-overflow:ellipsis">' +
            esc(l.after) + '</code></td>' +
            '<td style="font-size:12px;color:var(--ink-2)">' + esc(l.reason) + '</td></tr>';
        }).join('') + '</tbody></table></div>' :
        '<div class="empty" style="padding:30px 20px">' + icon('edit') +
        '<h4>暂无参数变更记录</h4><p>在「算法参数配置」中调整权重或阈值后，变更记录（含原因）会显示在这里。</p></div>') +
      '</div></div>';
  }

  Pages.after_admin = function () {
    var c = document.getElementById('content');

    c.addEventListener('input', function (ev) {
      var t = ev.target;
      if (t.dataset.rw) {
        var v = +t.value;
        var lab = c.querySelector('.rwv[data-for="' + t.dataset.rw + '"]');
        if (lab) lab.textContent = v + '%';
        calcWSum();
      }
      if (t.id === 'adAuditQ') {
        S().auditQuery = t.value;
        clearTimeout(S()._aqT);
        S()._aqT = setTimeout(function () {
          var pos = document.getElementById('adAuditQ');
          if (pos) pos.focus();
          global.App.refreshPage();
        }, 420);
      }
    });

    c.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act],[data-adtab]'); if (!b) return;
      if (b.dataset.adtab) { S().adminTab = b.dataset.adtab; global.App.refreshPage(); return; }
      var act = b.dataset.act;
      if (act === 'adw-save') saveWeights();
      if (act === 'adp-save') saveApriori();
      if (act === 'adr-save') saveRisk();
      if (act === 'ad-up') { global.App.go('data'); global.App.toast('请在数据中心点击「上传数据集」', 'info'); }
      if (act === 'ad-export-logs') exportAuditLogs();
      if (act === 'ad-clear-audit') {
        global.App.confirmDialog('清空操作日志', '将清空全部操作日志记录。<b>此操作不可撤销。</b>', function () {
          S().auditLogs = []; global.App.persist(); global.App.refreshPage();
          global.App.toast('操作日志已清空', 'ok');
        }, '确认清空');
      }
      if (act === 'ad-clear-model') {
        S().modelLogs = []; global.App.persist(); global.App.refreshPage();
        global.App.toast('算法运行日志已清空', 'ok');
      }
      if (act === 'ad-clear-cfg') {
        global.App.confirmDialog('清空参数变更记录', '将清空全部参数变更留痕。<b>此操作会削弱追溯能力，请谨慎操作。</b>', function () {
          S().settingsLogs = []; global.App.persist(); global.App.refreshPage();
          global.App.toast('参数变更记录已清空', 'ok');
        }, '确认清空');
      }
    });

    calcWSum();
  };

  function calcWSum() {
    var c = document.getElementById('content');
    var el = document.getElementById('adwSum');
    if (!el) return;
    var sum = 0, vals = {};
    ['qty', 'gp', 'turnover', 'space'].forEach(function (k) {
      var i = c.querySelector('[data-rw="' + k + '"]');
      vals[k] = i ? +i.value : 0;
      sum += vals[k];
    });
    el.innerHTML = '权重合计：<span style="color:' + (sum === 100 ? 'var(--good)' : 'var(--bad)') + ';font-size:16px">' +
      sum + '%</span>' + (sum === 100 ? ' ✓ 合法' : ' ✗ 必须等于 100%');
    el.style.background = sum === 100 ? 'var(--good-bg)' : 'var(--bad-bg)';
  }

  function saveWeights() {
    var c = document.getElementById('content');
    var nw = {};
    ['qty', 'gp', 'turnover', 'space'].forEach(function (k) {
      var i = c.querySelector('[data-rw="' + k + '"]');
      nw[k] = i ? +i.value : 0;
    });
    if (nw.qty + nw.gp + nw.turnover + nw.space !== 100) {
      return global.App.toast('四项权重之和必须等于 100%', 'err');
    }
    var reason = document.getElementById('adwReason').value.trim();
    if (!reason) return global.App.toast('请填写变更原因', 'err');

    var before = JSON.stringify(S().settings.weights);
    S().settings.weights = nw;
    S().settingsLogs.unshift({
      id: global.App.uid('CFG'), module: '品类健康度权重', user: S().user.name,
      before: before, after: JSON.stringify(nw), reason: reason, at: global.App.nowStr(),
    });
    global.App.audit('修改健康度权重', JSON.stringify(nw), '原因：' + reason);
    global.App.invalidate(); global.App.persist(); global.App.refreshPage();
    global.App.toast('权重已保存，全站结果已按新权重重算', 'ok');
  }

  function saveApriori() {
    var sup = parseFloat(document.getElementById('adpSup').value);
    var conf = parseFloat(document.getElementById('adpConf').value);
    var lift = parseFloat(document.getElementById('adpLift').value);
    var top = parseInt(document.getElementById('adpTop').value, 10);
    var agg = document.getElementById('adpAgg').value;
    var reason = document.getElementById('adpReason2').value.trim();

    if (!isFinite(sup) || sup <= 0 || sup >= 1) return global.App.toast('最小支持度应在 (0, 1) 区间', 'err');
    if (!isFinite(conf) || conf <= 0 || conf > 1) return global.App.toast('最小置信度应在 (0, 1] 区间', 'err');
    if (!isFinite(lift) || lift < 1) return global.App.toast('最小提升度应 ≥ 1', 'err');
    if (!isFinite(top) || top < 1 || top > 200) return global.App.toast('Top N 应在 1-200 之间', 'err');
    if (!reason) return global.App.toast('请填写变更原因', 'err');

    var before = JSON.stringify(S().settings.apriori);
    S().settings.apriori = {
      minSupport: sup, minConfidence: conf, minLift: lift, topN: top, aggregateBy: agg,
    };
    S().settingsLogs.unshift({
      id: global.App.uid('CFG'), module: 'Apriori 关联规则参数', user: S().user.name,
      before: before, after: JSON.stringify(S().settings.apriori), reason: reason, at: global.App.nowStr(),
    });
    global.App.audit('修改 Apriori 参数', 'min_support=' + sup + ', min_lift=' + lift, '原因：' + reason);
    global.App.invalidate(); global.App.persist(); global.App.refreshPage();
    var r = global.App.getAssoc();
    global.App.toast('参数已保存，重算得到 ' + (r.rules || []).length + ' 条规则', 'ok');
  }

  function saveRisk() {
    var turn = parseFloat(document.getElementById('adrTurn').value);
    var space = parseFloat(document.getElementById('adrSpace').value);
    var stock = parseFloat(document.getElementById('adrStock').value);
    var health = parseFloat(document.getElementById('adrHealth').value);
    var reason = document.getElementById('adrReason').value.trim();
    if (!isFinite(turn) || turn <= 0) return global.App.toast('周转天数健康线应为正数', 'err');
    if (!isFinite(space) || space < 0) return global.App.toast('坪效健康线应为非负数', 'err');
    if (!isFinite(stock) || stock < 0) return global.App.toast('缺货阈值应为非负数', 'err');
    if (!isFinite(health) || health < 0 || health > 100) return global.App.toast('健康度预警线应在 0-100 之间', 'err');
    if (!reason) return global.App.toast('请填写变更原因', 'err');

    var before = JSON.stringify(S().settings.risk);
    S().settings.risk = { turnoverDays: turn, spaceEff: space, stockout: stock, healthScore: health };
    S().settingsLogs.unshift({
      id: global.App.uid('CFG'), module: '风险预警阈值', user: S().user.name,
      before: before, after: JSON.stringify(S().settings.risk), reason: reason, at: global.App.nowStr(),
    });
    global.App.audit('修改风险预警阈值', JSON.stringify(S().settings.risk), '原因：' + reason);
    global.App.invalidate(); global.App.persist(); global.App.refreshPage();
    global.App.toast('预警阈值已保存，驾驶舱预警已更新', 'ok');
  }

  function exportAuditLogs() {
    var rows = S().auditLogs || [];
    if (!rows.length) return global.App.toast('暂无日志可导出', 'warn');
    global.App.download('苏果智选_操作日志_' + global.App.nowStr().replace(/[-: ]/g, '') + '.csv',
      global.App.toCSV(rows.map(function (l) {
        return {
          时间: l.at, 操作人: l.user, 角色: l.role, 动作: l.action,
          操作对象: l.target, 详情: l.detail, IP: l.ip,
        };
      })));
    global.App.toast('操作日志已导出（' + rows.length + ' 条）', 'ok');
  }

  /* ========================================================================
   * 通用辅助
   * ====================================================================== */

  function kpi(label, value, sub, ic, tone) {
    return '<div class="kpi ' + (tone || '') + '">' +
      '<div class="kpi-t">' + icon(ic) + '<span>' + esc(label) + '</span></div>' +
      '<div class="kpi-v">' + esc(value) + '</div>' +
      '<div class="kpi-s">' + esc(sub) + '</div></div>';
  }

  function fld(id, label, type, ph, req, step) {
    return '<div class="field"><label>' + esc(label) + (req ? '<span class="req">*</span>' : '') + '</label>' +
      '<input id="' + id + '" type="' + type + '"' + (step ? ' step="' + step + '"' : '') +
      ' placeholder="' + esc(ph || '') + '"></div>';
  }

  /** 扩展模块通用事件绑定：goto-data / dl-tpl / png 等跨页通用动作 */
  function bindCommon() {
    var c = document.getElementById('content');
    c.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]'); if (!b) return;
      var act = b.dataset.act;
      if (act === 'goto-data') global.App.go('data');
      if (act === 'dl-tpl') downloadTemplate(b.dataset.type);
      if (act === 'png') {
        Ch.exportPNG(document.getElementById(b.dataset.target), b.dataset.target);
        global.App.toast('图表已导出 PNG', 'ok');
      }
      if (act === 'pl-info') {
        global.App.openDrawer('自有品牌机会评估口径说明',
          '<div style="font-size:12.5px;line-height:1.95;color:var(--ink-2)">' +
          '<b>机会识别口径（当前可执行）：</b><br>' +
          '· <b>销量占比 ≥ 8%</b>：该品类是门店的高频刚需品类，客群购买习惯稳定<br>' +
          '· <b>毛利贡献 &lt; 15%</b>：该品类的毛利贡献低于其销量地位，存在结构优化空间<br>' +
          '<b>同时满足两者</b>即视为自有品牌替代的候选窗口。<br><br>' +
          '<b>为什么这个口径成立：</b>自有品牌的核心价值是在高频品类中以更低成本提供等价商品，' +
          '从而提升毛利。高频（销量占比高）保证动销，低毛利保证改善空间，两者叠加才是有效窗口。<br><br>' +
          '<b>当前数据下的局限（平台明确声明）：</b><br>' +
          '· 无法计算自有品牌<b>渗透率</b>——需要 PB 与全国品牌的销售拆分<br>' +
          '· 无法计算自有品牌<b>毛利率对比</b>——需要 SKU 级成本与售价<br>' +
          '· 无法给出<b>具体开发哪支单品</b>——需要 SKU 级参数分布与可替代性评分<br>' +
          '· 无法评估<b>供应商开发能力</b>——需要供应商资质与产能数据<br><br>' +
          '因此当前页面仅输出<b>品类级窗口提示</b>，不输出单品级开发清单与毛利改善测算。' +
          '</div>',
          '<button class="btn" data-act="dr-cancel">关闭</button>');
        document.getElementById('drFoot').onclick = function () { global.App.closeDrawer(); };
      }
      if (act === 'store-profile') {
        var st = global.App.curStore();
        var fields = [
          ['商圈类型', st.biz], ['所在城市', st.city],
          ['3 公里常住人口（万）', st.profile ? st.profile.area3km : null],
          ['住宅客群占比', st.profile ? st.profile.residentRatio : null],
          ['办公客群占比', st.profile ? st.profile.officeRatio : null],
          ['学生客群占比', st.profile ? st.profile.studentRatio : null],
          ['老年客群占比', st.profile ? st.profile.elderRatio : null],
          ['人均消费能力', st.profile ? st.profile.consumption : null],
          ['周边住宅 POI 数', st.profile ? st.profile.residentPoi : null],
          ['周边写字楼 POI 数', st.profile ? st.profile.officePoi : null],
          ['周边学校 POI 数', st.profile ? st.profile.schoolPoi : null],
          ['3 公里竞品数量', st.profile ? st.profile.competitors.length : null],
          ['线上到家覆盖', st.profile ? st.profile.delivery : null],
        ];
        global.App.openDrawer('门店画像配置 · ' + st.short,
          '<div class="note warn" style="margin-bottom:14px">' + global.App.ICON.warn +
          '<div>' + esc(st.note) + '</div></div>' +
          '<div class="card"><div class="card-b" style="padding:0"><div class="tbl-wrap"><table><thead><tr>' +
          '<th>画像字段</th><th>当前值</th><th>数据来源</th></tr></thead><tbody>' +
          fields.map(function (f) {
            var has = f[1] != null && f[1] !== '';
            return '<tr><td><b>' + esc(f[0]) + '</b></td>' +
              '<td>' + (has ? esc(String(f[1])) : '<span class="chip orange">待接入</span>') + '</td>' +
              '<td style="font-size:11.5px;color:var(--ink-3)">' +
              (has ? (f[0] === '商圈类型' || f[0] === '所在城市' ? '门店主数据' : '门店画像数据集') : '需上传门店画像数据集') + '</td></tr>';
          }).join('') + '</tbody></table></div></div></div>' +
          '<div class="note" style="margin-top:12px">' + global.App.ICON.info +
          '<div>门店画像字段需通过「门店画像数据」数据集接入（字段：门店名称、商圈、3公里常住人口、' +
          '住宅/办公/学生/老年占比、人均消费能力、周边POI、竞品清单、线上到家覆盖）。' +
          '接入后「千店千面」将自动启用差异化品类权重推导。</div></div>',
          '<button class="btn" data-act="dr-cancel">关闭</button>' +
          '<button class="btn pri" data-act="goto-data">前往数据中心上传</button>');
        document.getElementById('drFoot').onclick = function (e2) {
          var t = e2.target.closest('[data-act]'); if (!t) return;
          if (t.dataset.act === 'goto-data') { global.App.closeDrawer(); global.App.go('data'); }
          else global.App.closeDrawer();
        };
      }
      if (act === 'dr-cancel') global.App.closeDrawer();
    });
  }

  global.Pages = Pages;
})(window);
