/* ============================================================================
 * 苏果智选 · AI 选品助手 (app-ai.js)
 * ----------------------------------------------------------------------------
 * 定位：规则引擎 + 真实数据装配（离线可用、绝不编造数字）。
 * 铁律 9：工具函数（只读数据/只调数据层）与渲染函数严格分离；
 *         渲染函数之间不互调，统一由 App.refreshPage() 调度。
 *
 * 设计要点（对应需求第 13/14 节）：
 *   · 14 个后台工具，每个工具返回 {ok, data|insufficient, trace}
 *   · 标准回答模板六段式：【结论】【关键数据依据】【分析】【建议】【风险与限制】【决策状态】
 *   · 数据不足时返回 insufficient，由渲染层展示「当前数据不足以支持该结论」，绝不虚构
 *   · 建议三级分级：Level 1 信息提示 / Level 2 经营建议 / Level 3 高影响必须人工审批
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
  function user() { return global.App.State.user || { name: '系统', role: 'admin' }; }
  function esc(s) { return global.App.esc(s); }
  function icon(n, c, z) { return global.App.icon(n, c, z); }
  function num(v, d) { return global.App.fmtNum(v, d); }
  function money(v, d) { return global.App.fmtMoney(v, d); }
  function pct(v, d) { return global.App.fmtPct(v, d); }
  function sc(v) { return global.App.fmtScore(v); }
  var demoBadge = U.demoBadge, traceBar = U.traceBar, fmtTime = U.fmtTime;

  /* ========================================================================
   * 一、14 个后台工具（只读计算层，不触发任何渲染）
   *     每个工具签名统一：function(args) -> {ok, ...payload, tool, trace}
   * ====================================================================== */

  function wrap(tool, payload) {
    if (!payload || payload.ok === false) {
      return {
        ok: false, insufficient: true, tool: tool,
        reason: (payload && payload.reason) || '当前数据不足以支持该结论。',
        trace: { tool: tool, algorithm: (payload && payload.algorithm) || '—', at: new Date().toISOString() },
      };
    }
    return {
      ok: true, insufficient: false, tool: tool, data: payload,
      trace: {
        tool: tool, algorithm: payload.algorithm || '—',
        source: payload.sourceDatasetId || '—',
        parameters: payload.parameters || null,
        at: payload.createdAt || new Date().toISOString(),
      },
    };
  }

  var TOOLS = {

    /* ---- 1. 驾驶舱摘要 ---- */
    get_dashboard_summary: function () {
      return wrap('get_dashboard_summary', global.App.getDash());
    },

    /* ---- 2. 品类健康度 ---- */
    get_category_health: function (a) {
      var h = global.App.getHealth();
      if (!h.ok) return wrap('get_category_health', h);
      var out = Object.assign({}, h);
      if (a && a.category) {
        var one = h.items.filter(function (x) {
          return x.name === a.category || x.cid === a.category;
        })[0];
        if (!one) {
          return wrap('get_category_health', {
            ok: false,
            reason: '未找到品类「' + a.category + '」。当前数据集覆盖的品类为：' +
              h.items.map(function (x) { return x.name; }).join('、') + '。',
          });
        }
        out.items = [one];
        out.focus = one.cid;
      }
      return wrap('get_category_health', out);
    },

    /* ---- 3. 候选比较 ---- */
    compare_candidates: function (a) {
      var mode = (a && a.mode) || S().compareMode || 'category';
      var sel = (a && a.candidates) || S().compareSel || [];
      if (mode === 'sku') return wrap('compare_candidates', A.compare([], { mode: 'sku' }));
      if (!sel.length) {
        // 未指定时用健康度最高的 2 个 + 最低的 1 个作为自动对比组
        var h = global.App.getHealth();
        if (!h.ok) return wrap('compare_candidates', h);
        sel = [h.items[0].cid, h.items[1].cid, h.items[h.items.length - 1].cid];
      }
      return wrap('compare_candidates', A.compare(sel, {
        mode: mode,
        weights: {
          sales: S().settings.weights.qty / 100,
          margin: S().settings.weights.gp / 100,
          turnover: S().settings.weights.turnover / 100,
          space: S().settings.weights.space / 100,
        },
      }));
    },

    /* ---- 4. 品类趋势 ---- */
    get_category_trend: function (a) {
      var h = global.App.getHealth();
      if (!h.ok) return wrap('get_category_trend', h);
      var name = (a && a.category) || null;
      if (!name) {
        return wrap('get_category_trend', {
          ok: true,
          algorithm: 'TrendAnalysis v1.0',
          sourceDatasetId: 'dataset_category_sales.csv',
          createdAt: new Date().toISOString(),
          items: h.items.map(function (x) {
            return {
              name: x.name, cid: x.cid,
              qtyTrend: x.trend, gpTrend: x.gpTrend,
              turnoverTrend: x.turnoverTrend, spaceTrend: x.spaceTrend,
            };
          }),
        });
      }
      var one = h.items.filter(function (x) { return x.name === name || x.cid === name; })[0];
      if (!one) {
        return wrap('get_category_trend', {
          ok: false,
          reason: '未找到品类「' + name + '」。可选品类：' + h.items.map(function (x) { return x.name; }).join('、') + '。',
        });
      }
      return wrap('get_category_trend', {
        ok: true, algorithm: 'TrendAnalysis v1.0 (首 3 月 vs 末 3 月滑动均值)',
        sourceDatasetId: 'dataset_category_sales.csv',
        parameters: { months: h.monthCount, window: 3 },
        createdAt: new Date().toISOString(),
        items: [{
          name: one.name, cid: one.cid,
          qtyTrend: one.trend, gpTrend: one.gpTrend,
          turnoverTrend: one.turnoverTrend, spaceTrend: one.spaceTrend,
          months: one.months,
        }],
      });
    },

    /* ---- 5. 关联规则（双轨合并视图） ---- */
    get_association_rules: function (a) {
      var r = global.App.getAssoc();
      if (!r.ok) return wrap('get_association_rules', r);
      var src = (a && a.source) || 'realtime';
      var rules = src === 'attach' ? (global.SUGUO_DATA.rulesAttachment || [])
        : src === 'both' ? (r.rules || []).concat(global.SUGUO_DATA.rulesAttachment || [])
          : (r.rules || []);
      var out = Object.assign({}, r, { rules: rules, rulesetFilter: src });
      if (a && a.minLift != null) {
        out.rules = out.rules.filter(function (x) { return (x.lift || 0) >= a.minLift; });
      }
      if (a && a.topN) out.rules = out.rules.slice(0, a.topN);
      return wrap('get_association_rules', out);
    },

    /* ---- 6. 运行 Apriori（按指定参数重算） ---- */
    run_apriori: function (a) {
      a = a || {};
      var p = {
        minSupport: a.minSupport != null ? a.minSupport : S().settings.apriori.minSupport,
        minConfidence: a.minConfidence != null ? a.minConfidence : S().settings.apriori.minConfidence,
        minLift: a.minLift != null ? a.minLift : S().settings.apriori.minLift,
        topN: a.topN != null ? a.topN : S().settings.apriori.topN,
        aggregateBy: a.aggregateBy || S().settings.apriori.aggregateBy,
      };
      var t0 = performance.now();
      var r = A.apriori(p);
      var ms = Math.round(performance.now() - t0);
      global.App.modelRun('Apriori (AI工具调用)', 'dataset_transactions_sample.csv', p, ms, r.ok);
      return wrap('run_apriori', Object.assign({}, r, {
        algorithm: 'Apriori v1.0 (按' + (p.aggregateBy === 'name' ? '交易号+商品名称' : '商品编码') + '构建购物篮)',
        parameters: p, createdAt: new Date().toISOString(),
        runMs: ms,
      }));
    },

    /* ---- 7. 需求预测 ---- */
    get_demand_forecast: function (a) {
      var name = (a && a.category) || null;
      var avail = (global.SUGUO_DATA.forecast || []).map(function (f) { return f.cat; });
      if (!name) {
        var all = avail.map(function (c) { return A.analyzeForecast(c); });
        var ok = all.filter(function (x) { return x.ok; });
        if (!ok.length) {
          return wrap('get_demand_forecast', {
            ok: false,
            reason: '当前数据集中缺少可用的需求预测数据。已加载的预测品类为：' + avail.join('、') + '。',
          });
        }
        return wrap('get_demand_forecast', {
          ok: true, algorithm: 'TrendAnalysis v1.0', sourceDatasetId: 'dataset_demand_forecast.csv',
          createdAt: new Date().toISOString(),
          items: ok.map(function (x) {
            return {
              cat: x.cat, last4Avg: x.last4Avg, next4Avg: x.next4Avg,
              delta: x.delta, level: x.level, risk: x.risk,
            };
          }),
          coverage: avail,
        });
      }
      var r = A.analyzeForecast(name);
      if (!r.ok) {
        return wrap('get_demand_forecast', {
          ok: false,
          reason: '需求预测数据不包含品类「' + name + '」。现有预测数据仅覆盖：' + avail.join('、') +
            '。其余品类因缺少预测模型输出，平台无法给出预测结论。',
        });
      }
      return wrap('get_demand_forecast', r);
    },

    /* ---- 8. 缺货风险 ---- */
    get_stockout_risk: function (a) {
      var h = global.App.getHealth();
      if (!h.ok) return wrap('get_stockout_risk', h);
      var th = S().settings.risk.stockout;
      var items = h.items.map(function (x) {
        var lvl = x.stockout >= th * 1.5 ? 'high' : x.stockout >= th ? 'medium' : 'low';
        return {
          name: x.name, cid: x.cid, stockout: x.stockout,
          perMonth: A.round(x.stockout / h.monthCount, 2),
          level: lvl, threshold: th,
          turnoverDays: x.turnoverDays, qtyShare: x.qtyShare,
        };
      }).sort(function (x, y) { return y.stockout - x.stockout; });

      if (a && a.category) {
        var one = items.filter(function (x) { return x.name === a.category || x.cid === a.category; })[0];
        if (!one) return wrap('get_stockout_risk', { ok: false, reason: '未找到品类「' + a.category + '」。' });
        items = [one];
      }

      var total = items.reduce(function (acc, x) { return acc + x.stockout; }, 0);
      return wrap('get_stockout_risk', {
        ok: true, items: items, threshold: th, monthCount: h.monthCount,
        totalStockout: total,
        highCount: items.filter(function (x) { return x.level === 'high'; }).length,
        algorithm: 'StockoutRisk v1.0 (基于 12 个月缺货次数与销量占比)',
        sourceDatasetId: 'dataset_category_sales.csv',
        parameters: { threshold: th, months: h.monthCount },
        createdAt: new Date().toISOString(),
        limitation: '缺货风险仅由「品类级缺货次数」推断，缺少 SKU 级的安全库存、' +
          '订货提前期、日均销量数据，因此无法给出具体补货点与安全库存建议。',
      });
    },

    /* ---- 9. 数据质量 ---- */
    get_data_quality: function (a) {
      var reps = S().qualityReports || [];
      if (a && a.fileName) {
        var one = reps.filter(function (x) { return x.fileName === a.fileName; })[0];
        if (!one) {
          return wrap('get_data_quality', {
            ok: false,
            reason: '尚未对「' + a.fileName + '」执行数据质量检查。请先在「数据中心」点击该文件行的「质量检查」按钮。',
          });
        }
        return wrap('get_data_quality', one);
      }
      if (!reps.length) {
        return wrap('get_data_quality', {
          ok: false,
          reason: '当前还没有任何数据质量检查报告。请先在「数据中心」点击「一键全量检查」，' +
            '平台将对 5 个内置数据集执行 9 类检查并输出五维评分。',
        });
      }
      return wrap('get_data_quality', {
        ok: true, reports: reps,
        avgScore: A.round(reps.reduce(function (acc, x) { return acc + x.overall; }, 0) / reps.length, 1),
        algorithm: 'DataQualityCheck v1.0',
        sourceDatasetId: '全部已加载数据集',
        createdAt: new Date().toISOString(),
      });
    },

    /* ---- 10. 门店画像 ---- */
    get_store_profile: function () {
      var st = global.App.curStore();
      var hasProfile = st.profile && st.profile.area3km != null;
      if (!hasProfile) {
        return wrap('get_store_profile', {
          ok: false,
          reason: '当前门店「' + st.short + '」的门店画像数据尚未接入。' +
            '「千店千面」模块需要门店周边人口结构、POI、竞品、消费能力等字段才能推导差异化选品方案。' +
            '请在「数据中心」上传「门店画像数据」数据集后重试。',
          store: { id: st.id, name: st.name, biz: st.biz, city: st.city },
          requiredFields: ['门店名称', '商圈', '3公里常住人口', '住宅/办公/学生/老年占比',
            '人均消费能力', '周边POI', '竞品清单', '线上到家覆盖'],
        });
      }
      return wrap('get_store_profile', {
        ok: true, store: st, algorithm: 'StoreProfile v1.0',
        sourceDatasetId: 'store_profile 数据集', createdAt: new Date().toISOString(),
      });
    },

    /* ---- 11. 自有品牌机会 ---- */
    get_private_label_opportunity: function () {
      var h = global.App.getHealth();
      if (!h.ok) return wrap('get_private_label_opportunity', h);
      var opp = h.items.filter(function (x) { return x.qtyShare >= 8 && x.gpShare < 15; });
      return wrap('get_private_label_opportunity', {
        ok: true,
        opportunities: opp.map(function (x) {
          return {
            cid: x.cid, name: x.name, qtyShare: x.qtyShare, gpShare: x.gpShare,
            grossMargin: A.round(x.grossMargin, 2), spaceEff: x.spaceEff,
            turnoverDays: x.turnoverDays, score: x.score,
          };
        }),
        scanAll: h.items.map(function (x) {
          return { name: x.name, qtyShare: x.qtyShare, gpShare: x.gpShare, grossMargin: A.round(x.grossMargin, 2) };
        }),
        criteria: '销量占比 ≥ 8% 且 毛利贡献 < 15%（高频刚需但毛利偏低 = 自有品牌替代窗口）',
        algorithm: 'PrivateLabelOpportunity v1.0', sourceDatasetId: 'dataset_category_sales.csv',
        createdAt: new Date().toISOString(),
        limitation: '本工具只能输出【品类级机会窗口】，无法输出单品级开发清单。' +
          '原因：缺少 SKU 级的品牌属性（是否自有品牌）、采购价、零售价、货架占用、供应商信息。' +
          '平台拒绝在缺少这些字段时虚构「建议开发 XX 单品」的结论。',
      });
    },

    /* ---- 12. 新品评估 ---- */
    get_new_product_evaluation: function (a) {
      var list = S().newProducts || [];
      if (a && a.id) {
        var one = list.filter(function (x) { return x.id === a.id || x.name === a.id; })[0];
        if (!one) {
          return wrap('get_new_product_evaluation', {
            ok: false,
            reason: '未找到新品候选「' + a.id + '」。当前候选池：' +
              (list.length ? list.map(function (x) { return x.name; }).join('、') : '（空）') + '。',
          });
        }
        list = [one];
      }
      if (!list.length) {
        return wrap('get_new_product_evaluation', {
          ok: false,
          reason: '新品候选池为空。请先在「新品评估」页录入候选商品，' +
            '或在「AI 选品助手」中提供商品名称、所属品类、进货价、拟定价后再评估。',
        });
      }
      var h = global.App.getHealth();
      if (!h.ok) return wrap('get_new_product_evaluation', h);
      var items = list.map(function (p) {
        var cat = h.items.filter(function (x) { return x.cid === p.cat; })[0];
        if (!cat) return { name: p.name, ok: false, reason: '所属品类未匹配' };
        var gmDiff = p.margin - cat.grossMargin;
        var gmScore = Math.max(0, Math.min(100, 50 + gmDiff * 2.2));
        var catScore = cat.score;
        var assoc = global.App.getAssoc();
        var hit = (assoc.rules || []).filter(function (r) {
          return (r.aCat === cat.name || r.bCat === cat.name) &&
            ((p.selling || '').indexOf(r.a) >= 0 || (p.selling || '').indexOf(r.b) >= 0 ||
              (p.name + p.selling).indexOf(r.a) >= 0 || (p.name + p.selling).indexOf(r.b) >= 0);
        });
        var asScore = Math.min(100, 40 + hit.length * 18);
        var total = catScore * 0.4 + gmScore * 0.35 + asScore * 0.25;
        return {
          name: p.name, catName: p.catName, margin: p.margin,
          catScore: A.round(catScore, 1), gmScore: A.round(gmScore, 1), asScore: A.round(asScore, 1),
          total: A.round(total, 1),
          gmDiff: A.round(gmDiff, 1), assocHits: hit.length,
          verdict: total >= 75 ? '适配度较高' : total >= 60 ? '适配度中等' : total >= 45 ? '适配度偏低' : '适配度低',
        };
      });
      return wrap('get_new_product_evaluation', {
        ok: true, items: items,
        algorithm: 'NewProductEvaluation v1.0 (品类健康度40% + 毛利率竞争力35% + 关联场景互补25%)',
        sourceDatasetId: 'dataset_category_sales.csv + dataset_transactions_sample.csv',
        parameters: { weights: { categoryHealth: 40, marginCompetitiveness: 35, assocComplement: 25 } },
        createdAt: new Date().toISOString(),
        limitation: '评估未覆盖价格带分布、同价带竞品密度、供应商供货能力、货架容量约束、' +
          '历史同类新品成功率五个维度（均需 SKU 级 / 供应商级数据）。' +
          '因此结论仅作初筛参考，<b>不能作为引入决策依据</b>。',
      });
    },

    /* ---- 13. 创建审批请求（唯一的写操作工具） ---- */
    create_approval_request: function (a) {
      a = a || {};
      if (!a.title || !a.advice) {
        return wrap('create_approval_request', {
          ok: false,
          reason: '创建审批请求需要至少提供『建议标题』与『建议内容』。',
        });
      }
      var lv = a.level || 3;
      var rec = {
        id: global.App.uid('AP'),
        level: lv,
        source: a.source || 'AI选品助手',
        title: a.title,
        advice: a.advice,
        basis: a.basis || [],
        cats: a.cats || [],
        priority: a.priority || (lv === 3 ? '高' : '中'),
        risk: a.risk || (lv === 3 ? '高' : '中'),
        needApproval: lv === 3,
        applicant: user().name, approver: null,
        status: lv === 3 ? '待审批' : '待审批',
        comment: '', createdAt: new Date().toISOString(),
        dueAt: new Date(Date.now() + (lv === 3 ? 2 : 5) * 24 * 3600e3).toISOString(),
      };
      S().approvals.unshift(rec);
      global.App.audit('AI创建审批请求', rec.title, '编号 ' + rec.id + '｜级别 L' + lv);
      global.App.persist();
      return wrap('create_approval_request', {
        ok: true, record: rec, algorithm: 'ApprovalWorkflow v1.0',
        sourceDatasetId: '—', createdAt: new Date().toISOString(),
      });
    },

    /* ---- 14. 分析历史 ---- */
    get_analysis_history: function (a) {
      var l = S().analyses || [];
      if (!l.length) {
        return wrap('get_analysis_history', {
          ok: false,
          reason: '当前还没有 AI 分析历史记录。完成一次对话分析后，记录会自动存档于此。',
        });
      }
      return wrap('get_analysis_history', {
        ok: true, items: (a && a.limit ? l.slice(0, a.limit) : l),
        total: l.length, algorithm: '—', sourceDatasetId: '—',
        createdAt: new Date().toISOString(),
      });
    },
  };

  var TOOL_META = [
    { name: 'get_dashboard_summary', label: '驾驶舱摘要', desc: '获取 8 个核心 KPI、风险预警与需求涨跌品类', cat: '总览' },
    { name: 'get_category_health', label: '品类健康度', desc: '查询全部或指定品类的综合健康度与四维得分', cat: '诊断' },
    { name: 'compare_candidates', label: '候选比较', desc: '对 2-6 个候选对象输出综合评分与排名', cat: '选品' },
    { name: 'get_category_trend', label: '品类趋势', desc: '查询品类销量/毛利/周转/坪效的环比趋势', cat: '诊断' },
    { name: 'get_association_rules', label: '关联规则', desc: '查询实时重算或附件参考的关联规则（双轨）', cat: '陈列' },
    { name: 'run_apriori', label: '运行 Apriori', desc: '按指定阈值参数实时重算关联规则', cat: '陈列' },
    { name: 'get_demand_forecast', label: '需求预测', desc: '查询品类未来需求预测与趋势方向', cat: '预测' },
    { name: 'get_stockout_risk', label: '缺货风险', desc: '识别缺货频繁品类与风险等级', cat: '预警' },
    { name: 'get_data_quality', label: '数据质量', desc: '查询数据集质量检查报告与五维评分', cat: '治理' },
    { name: 'get_store_profile', label: '门店画像', desc: '查询门店周边客群结构等画像字段', cat: '总览' },
    { name: 'get_private_label_opportunity', label: '自有品牌机会', desc: '筛查适合自有品牌替代的品类窗口', cat: '选品' },
    { name: 'get_new_product_evaluation', label: '新品评估', desc: '评估新品候选的三维适配度', cat: '选品' },
    { name: 'create_approval_request', label: '创建审批请求', desc: '把高影响建议提交人工审批（唯一写操作）', cat: '协同' },
    { name: 'get_analysis_history', label: '分析历史', desc: '查询历史 AI 分析记录', cat: '协同' },
  ];

  /* ========================================================================
   * 二、意图识别与工具编排（规则引擎）
   * ====================================================================== */

  var CATS = null;
  function catNames() {
    if (!CATS) CATS = (global.App.getHealth().items || []).map(function (x) { return x.name; });
    return CATS;
  }

  /** 从问题中抽取品类名 */
  function pickCategory(q) {
    var names = catNames();
    var hit = names.filter(function (n) { return q.indexOf(n) >= 0; });
    if (hit.length) return hit;
    // 别名映射
    var alias = {
      '生鲜蔬果': ['生鲜', '蔬果', '水果', '蔬菜'],
      '食品饮料': ['食品', '饮料', '零食'],
      '粮油调味': ['粮油', '调味', '酱油', '食用油'],
      '日化清洁': ['日化', '清洁', '洗护', '洗衣'],
      '肉禽蛋品': ['肉禽', '蛋品', '肉类'],
      '家居用品': ['家居', '家用品'],
      '纺织服装': ['纺织', '服装', '服饰'],
    };
    var out = [];
    Object.keys(alias).forEach(function (key) {
      if (names.indexOf(key) < 0) return;
      alias[key].forEach(function (al) {
        if (q.indexOf(al) >= 0 && out.indexOf(key) < 0) out.push(key);
      });
    });
    return out;
  }

  /**
   * 意图路由：返回 {tools:[...], intent, args, plan:[]}
   * 纯函数，不触发渲染。
   */
  function route(q) {
    var s = q.toLowerCase();
    var cats = pickCategory(q);
    var plan = [];
    var tools = [];
    var intent = 'general';

    function add(t, args, why) { tools.push({ name: t, args: args || {} }); plan.push({ tool: t, why: why }); }

    var isHealth = /健康|评分|诊断|好不好|表现|排名|多少分|星级/.test(q);
    var isAssoc = /关联|组合|搭售|陈列|一起买|购物篮|提升度|支持度|置信度|交叉/.test(q);
    var isForecast = /预测|趋势|未来|下周|下月|需求|销量会|上涨|下降|备货/.test(q);
    var isCompare = /比较|对比|哪个更好|选哪个|取舍|优先|排序/.test(q);
    var isStock = /缺货|断货|补货|库存/.test(q);
    var isPrivate = /自有品牌|PB|贴牌|自有/.test(q);
    var isNew = /新品|新商品|引入|上市|上架/.test(q);
    var isStore = /门店|商圈|客群|画像|千店|周边|社区/.test(q);
    var isQuality = /质量|数据.*问题|完整|空值|重复|异常|脏数据/.test(q);
    var isPlan = /方案|规划|建议清单|怎么办|如何优化|优化建议|行动计划|整体/.test(q);

    if (/概览|整体情况|全店|驾驶舱|经营情况|总览/.test(q) && !cats.length) {
      intent = 'overview';
      add('get_dashboard_summary', {}, '获取全店 8 个核心 KPI 与风险预警');
      add('get_category_health', {}, '获取各品类健康度作为整体判断基础');
    } else if (isQuality) {
      intent = 'quality';
      add('get_data_quality', {}, '查询数据集质量检查报告');
    } else if (isStore) {
      intent = 'store';
      add('get_store_profile', {}, '查询门店画像数据可用性');
      add('get_category_health', {}, '补充门店当前品类表现（可推导部分）');
    } else if (isPrivate) {
      intent = 'privateLabel';
      add('get_private_label_opportunity', {}, '筛查适合自有品牌替代的品类窗口');
    } else if (isNew) {
      intent = 'newProduct';
      add('get_new_product_evaluation', cats.length ? { id: cats[0] } : {}, '评估新品候选适配度');
    } else if (isAssoc) {
      intent = 'assoc';
      add('get_association_rules', { source: /附件|参考|原始/.test(q) ? 'attach' : 'realtime' }, '获取购物篮关联规则');
    } else if (isForecast) {
      intent = 'forecast';
      add('get_demand_forecast', cats.length ? { category: cats[0] } : {}, '获取需求预测与趋势方向');
      add('get_category_trend', cats.length ? { category: cats[0] } : {}, '补充分品类销售趋势');
    } else if (isCompare) {
      intent = 'compare';
      add('compare_candidates', {}, '对候选对象做多维综合比较');
    } else if (isStock) {
      intent = 'stockout';
      add('get_stockout_risk', cats.length ? { category: cats[0] } : {}, '识别缺货风险等级');
    } else if (isHealth) {
      intent = 'health';
      add('get_category_health', cats.length ? { category: cats[0] } : {}, '查询品类健康度');
      if (cats.length) add('get_category_trend', { category: cats[0] }, '补充该品类趋势');
    } else if (isPlan) {
      intent = 'plan';
      add('get_dashboard_summary', {}, '获取全局指标与风险预警');
      add('get_category_health', {}, '获取各品类健康度分档');
      add('get_association_rules', {}, '获取关联陈列机会');
      add('get_demand_forecast', {}, '获取需求趋势');
    } else if (cats.length) {
      intent = 'health';
      add('get_category_health', { category: cats[0] }, '按品类名定点查询健康度');
      add('get_category_trend', { category: cats[0] }, '补充趋势');
    } else {
      intent = 'general';
      add('get_dashboard_summary', {}, '无明确意图，返回全店概览作为兜底');
      add('get_category_health', {}, '补充品类健康度');
      add('get_association_rules', {}, '补充关联陈列机会');
    }
    return { intent: intent, cats: cats, tools: tools, plan: plan };
  }

  /* ========================================================================
   * 三、六段式回答装配（规则引擎 + 真实数据）
   * ====================================================================== */

  /**
   * 装配回答。返回 {ok, intent, plan, results, sections, level, needApproval, cards}
   * sections: [{key, title, icon, html}] 六段式
   */
  function answer(q) {
    var r = route(q);
    var results = r.tools.map(function (t) {
      var fn = TOOLS[t.name];
      if (!fn) return { ok: false, insufficient: true, tool: t.name, reason: '工具未实现。' };
      try { return fn(t.args); }
      catch (e) { return { ok: false, insufficient: true, tool: t.name, reason: '工具执行异常：' + e.message }; }
    });

    var okOnes = results.filter(function (x) { return x.ok; });
    var badOnes = results.filter(function (x) { return !x.ok; });

    var out = {
      ok: okOnes.length > 0,
      question: q, intent: r.intent, cats: r.cats,
      plan: r.plan, results: results,
      toolCount: results.length,
      okCount: okOnes.length, badCount: badOnes.length,
      at: new Date().toISOString(),
    };

    // 全部工具都失败 → 明确拒答
    if (!okOnes.length) {
      out.sections = [{
        key: 'insufficient', title: '当前数据不足以支持该结论', icon: 'warn',
        html: '<div style="font-size:12.5px;line-height:1.9">' +
          '平台调用了 ' + results.length + ' 个后台工具，均未能取得可用数据：<br>' +
          badOnes.map(function (x, i) {
            return '<b>' + (i + 1) + '. ' + esc(toolLabel(x.tool)) + '</b>：' + esc(x.reason);
          }).join('<br>') +
          '<br><br><b>平台不会在缺少数据时编造答案。</b>' +
          '请先补充相应数据，或换一个平台有数据支撑的问题。</div>',
      }];
      out.level = 1;
      out.needApproval = false;
      return out;
    }

    var sec = [];
    sec.push(secConclusion(out, okOnes, badOnes));
    sec.push(secEvidence(out, okOnes));
    var analysis = secAnalysis(out, okOnes);
    if (analysis) sec.push(analysis);
    var advice = secAdvice(out, okOnes);
    if (advice) sec.push(advice);
    sec.push(secRisk(out, okOnes, badOnes));
    sec.push(secDecision(out, okOnes));

    out.sections = sec.filter(Boolean);
    out.level = out.needApproval ? 3 : (advice ? 2 : 1);
    return out;
  }

  function toolLabel(n) {
    var m = TOOL_META.filter(function (x) { return x.name === n; })[0];
    return m ? m.label : n;
  }

  function h(title, body, tone) {
    return '<div class="ai-sec' + (tone ? ' ' + tone : '') + '">' +
      '<div class="ai-sec-h">' + title + '</div>' +
      '<div class="ai-sec-b">' + body + '</div></div>';
  }

  /* ---- 段 1：结论 ---- */
  function secConclusion(out, okOnes, badOnes) {
    var d = null, hh = null;
    okOnes.forEach(function (x) {
      if (x.tool === 'get_dashboard_summary') d = x.data;
      if (x.tool === 'get_category_health') hh = x.data;
    });

    var lines = [];

    if (out.intent === 'overview' && d) {
      var k = {};
      d.kpis.forEach(function (x) { k[x.key] = x; });
      lines.push('全店共 <b>' + d.health.items.length + '</b> 个一级品类，其中健康品类 <b>' +
        (k.categoryHealthy ? k.categoryHealthy.value : '—') + '</b> 个，风险品类 <b>' +
        (k.categoryRisk ? k.categoryRisk.value : '—') + '</b> 个。');
      lines.push('平均库存周转 <b>' + num(d.avgTurnover, 1) + ' 天</b>，' +
        d.latestMonth + ' 缺货 <b>' + (k.stockout ? k.stockout.value : '—') + ' 次</b>，' +
        '识别高价值关联组合 <b>' + (k.assoc ? k.assoc.value : '—') + ' 组</b>。');
      if (d.warnings.length) {
        lines.push('共识别 <b>' + d.warnings.length + ' 条风险预警</b>，其中高等级 <b>' +
          d.warnings.filter(function (w) { return w.level === 'high'; }).length + ' 条</b>。');
      }
    } else if (out.intent === 'forecast') {
      var f = okOnes.filter(function (x) { return x.tool === 'get_demand_forecast'; })[0];
      if (f && f.data.items && f.data.items.length) {
        var up = f.data.items.filter(function (x) { return x.delta > 5; });
        var down = f.data.items.filter(function (x) { return x.delta < -5; });
        lines.push('需求预测覆盖 <b>' + f.data.coverage.length + '</b> 个品类：' +
          f.data.coverage.join('、') + '。');
        if (up.length) lines.push('需求<b>上涨</b>品类：' + up.map(function (x) {
          return '<b>' + esc(x.cat) + '</b>（' + x.level.label + ' ' + pct(x.delta) + '）';
        }).join('、') + '。');
        if (down.length) lines.push('需求<b>下跌</b>品类：' + down.map(function (x) {
          return '<b>' + esc(x.cat) + '</b>（' + x.level.label + ' ' + pct(x.delta) + '）';
        }).join('、') + '。');
        if (!up.length && !down.length) lines.push('全部品类需求变化幅度在 ±5% 以内，趋势<b>基本稳定</b>。');
      } else if (f && f.data.cat) {
        lines.push('「<b>' + esc(f.data.cat) + '</b>」未来 ' + f.data.forecastCount +
          ' 期预测均值 <b>' + num(f.data.next4Avg, 1) + '</b> 件，最近 4 期实际均值 <b>' +
          num(f.data.last4Avg, 1) + '</b> 件，环比 <b>' + pct(f.data.delta) + '</b>，趋势判定：<b>' +
          f.data.level.label + '</b>。');
      }
    } else if (out.intent === 'assoc') {
      var a = okOnes.filter(function (x) { return x.tool === 'get_association_rules'; })[0];
      if (a) {
        var rs = a.data.rules || [];
        lines.push('在 ' + a.data.basketCount + ' 个购物篮中，按当前阈值（min_support=' +
          a.data.parameters.minSupport + '、min_confidence=' + a.data.parameters.minConfidence +
          '、min_lift=' + a.data.parameters.minLift + '）共识别 <b>' + rs.length + '</b> 条关联规则。');
        if (rs.length) {
          lines.push('最强关联：<b>' + esc(rs[0].a) + ' → ' + esc(rs[0].b) + '</b>，提升度 <b>' +
            num(rs[0].lift, 3) + '</b>（' + rs[0].strength.level + '）。');
          var scenes = {};
          rs.forEach(function (x) {
            var sn = (x.advice || '').split('：')[0];
            scenes[sn] = (scenes[sn] || 0) + 1;
          });
          var top = Object.keys(scenes).sort(function (x, y) { return scenes[y] - scenes[x]; }).slice(0, 3);
          if (top.length) lines.push('主要场景分布：' + top.map(function (t) {
            return '<b>' + esc(t) + '</b>（' + scenes[t] + ' 条）';
          }).join('、') + '。');
        }
      }
    } else if (out.intent === 'compare') {
      var c = okOnes.filter(function (x) { return x.tool === 'compare_candidates'; })[0];
      if (c && c.data.items) {
        lines.push('本次比较 <b>' + c.data.items.length + '</b> 个对象，推荐优先级排序：' +
          c.data.items.map(function (x) {
            return '<b>' + x.priority + ' = ' + esc(x.name) + '</b>（' + sc(x.composite) + ' 分）';
          }).join(' > ') + '。');
        lines.push('首位与末位分差 <b>' + sc(c.data.items[0].composite - c.data.items[c.data.items.length - 1].composite) +
          '</b> 分，' + (c.data.items[0].composite - c.data.items[c.data.items.length - 1].composite > 25 ?
            '差距显著，优先级判断较为明确。' : '差距有限，建议结合品类战略再判断。'));
      }
    } else if (out.intent === 'stockout') {
      var sk = okOnes.filter(function (x) { return x.tool === 'get_stockout_risk'; })[0];
      if (sk) {
        var hi = sk.data.items.filter(function (x) { return x.level === 'high'; });
        lines.push('近 ' + sk.data.monthCount + ' 个月累计缺货 <b>' + sk.data.totalStockout +
          '</b> 次，其中高风险品类 <b>' + sk.data.highCount + '</b> 个（阈值 ' + sk.data.threshold + ' 次）。');
        if (hi.length) lines.push('高风险品类：' + hi.map(function (x) {
          return '<b>' + esc(x.name) + '</b>（' + x.stockout + ' 次）';
        }).join('、') + '。');
      }
    } else if (out.intent === 'privateLabel') {
      var pl = okOnes.filter(function (x) { return x.tool === 'get_private_label_opportunity'; })[0];
      if (pl) {
        lines.push('按口径「销量占比 ≥ 8% 且 毛利贡献 < 15%」筛查，识别到 <b>' +
          pl.data.opportunities.length + '</b> 个高潜品类窗口。');
        if (pl.data.opportunities.length) lines.push('候选品类：' + pl.data.opportunities.map(function (x) {
          return '<b>' + esc(x.name) + '</b>（销量 ' + x.qtyShare + '%、毛利 ' + x.gpShare + '%）';
        }).join('、') + '。');
      }
    } else if (out.intent === 'newProduct') {
      var np = okOnes.filter(function (x) { return x.tool === 'get_new_product_evaluation'; })[0];
      if (np) {
        lines.push('评估 <b>' + np.data.items.length + '</b> 个新品候选，' +
          np.data.items.map(function (x) {
            return '<b>' + esc(x.name) + '</b> ' + sc(x.total) + ' 分（' + x.verdict + '）';
          }).join('；') + '。');
      }
    } else if (out.intent === 'quality') {
      var qq = okOnes.filter(function (x) { return x.tool === 'get_data_quality'; })[0];
      if (qq && qq.data.reports) {
        lines.push('已检查 <b>' + qq.data.reports.length + '</b> 个数据集，平均质量得分 <b>' +
          sc(qq.data.avgScore) + '</b> 分。');
        var bad = qq.data.reports.filter(function (x) { return x.overall < 75; });
        if (bad.length) lines.push('质量偏低数据集：' + bad.map(function (x) {
          return '<b>' + esc(x.fileName) + '</b>（' + sc(x.overall) + ' 分 / ' + x.grade + '）';
        }).join('、') + '。');
      }
    } else if (hh) {
      var target = out.cats.length ? hh.items[0] : null;
      if (target) {
        lines.push('「<b>' + esc(target.name) + '</b>」综合健康度 <b>' + sc(target.score) + ' 分</b>（' +
          target.stars + ' ' + target.grade + '），在 ' + (hh.months ? catNames().length : '全部') +
          ' 个品类中排名第 <b>' + target.rank + '</b>。');
        lines.push('销量贡献 <b>' + target.qtyShare + '%</b>，毛利贡献 <b>' + target.gpShare +
          '%</b>，毛利率 <b>' + sc(target.grossMargin) + '%</b>，库存周转 <b>' + num(target.turnoverDays, 1) +
          ' 天</b>，坪效 <b>' + num(target.spaceEff) + ' 元/㎡/月</b>。');
        if (target.trend) {
          lines.push('销量趋势：<b>' + trendText(target.trend.dir) + '</b>（环比 ' + pct(target.trend.pct) + '）。');
        }
      } else if (hh.items) {
        var best = hh.items[0], worst = hh.items[hh.items.length - 1];
        lines.push('表现最优品类为 <b>' + esc(best.name) + '</b>（' + sc(best.score) + ' 分，' +
          best.stars + '），最弱为 <b>' + esc(worst.name) + '</b>（' + sc(worst.score) + ' 分，' + worst.stars + '）。');
      }
    }

    if (!lines.length) lines.push('已调用 ' + okOnes.length + ' 个后台工具取得数据，详见下方分析。');

    var warn = badOnes.length ?
      '<div style="margin-top:9px;font-size:11.5px;color:var(--bad)">' +
      icon('warn', '', 12) + ' 另有 ' + badOnes.length + ' 个工具因数据不足未能返回结果，已在「风险与限制」段说明。</div>' : '';

    return { key: 'conclusion', title: '结论', icon: 'target', html: h(icon('target') + '结论', lines.join('<br>') + warn) };
  }

  function trendText(dir) {
    return dir === 'up' ? '上涨' : dir === 'down' ? '下降' : '基本稳定';
  }

  /* ---- 段 2：关键数据依据 ---- */
  function secEvidence(out, okOnes) {
    var rows = [];
    okOnes.forEach(function (x) {
      var d = x.data;
      var m = TOOL_META.filter(function (y) { return y.name === x.tool; })[0];

      if (x.tool === 'get_dashboard_summary') {
        d.kpis.slice(0, 8).forEach(function (k) {
          rows.push(['KPI · ' + k.label, esc(String(k.value)) + (k.unit || ''), k.sub, 'dashboard']);
        });
      } else if (x.tool === 'get_category_health') {
        d.items.forEach(function (it) {
          rows.push([
            '品类健康度 · ' + it.name,
            sc(it.score) + ' 分 ' + it.stars,
            '销量' + it.qtyScore + '/毛利' + it.gpScore + '/周转' + it.turnoverScore + '/坪效' + it.spaceScore +
            '；销量贡献 ' + it.qtyShare + '%、毛利贡献 ' + it.gpShare + '%',
            'health',
          ]);
        });
      } else if (x.tool === 'get_association_rules' || x.tool === 'run_apriori') {
        (d.rules || []).slice(0, 6).forEach(function (r) {
          rows.push([
            '关联规则 · ' + r.a + ' → ' + r.b,
            'Lift ' + num(r.lift, 3),
            '支持度 ' + num(r.support, 4) + '　置信度 ' + num(r.confidence, 4) +
            '　共现 ' + r.count + ' 篮　' + (r.ruleset === 'attachment' ? '（附件参考）' : '（实时重算）'),
            'assoc',
          ]);
        });
      } else if (x.tool === 'get_demand_forecast') {
        (d.items || []).forEach(function (f) {
          rows.push([
            '需求预测 · ' + f.cat,
            pct(f.delta),
            '最近 4 期均值 ' + num(f.last4Avg, 1) + ' → 未来 4 期预测 ' + num(f.next4Avg, 1) +
            '　趋势：' + f.level.label,
            'forecast',
          ]);
        });
      } else if (x.tool === 'compare_candidates') {
        (d.items || []).forEach(function (it) {
          rows.push([
            '比较 · ' + it.priority + ' ' + it.name,
            sc(it.composite) + ' 分',
            '健康度 ' + sc(it.healthScore) + '　周转 ' + num(it.turnoverDays, 1) + ' 天　坪效 ' +
            num(it.spaceEff) + '　需求趋势 ' + it.forecastLevel,
            'compare',
          ]);
        });
      } else if (x.tool === 'get_stockout_risk') {
        (d.items || []).slice(0, 7).forEach(function (it) {
          rows.push([
            '缺货风险 · ' + it.name,
            it.stockout + ' 次',
            '月均 ' + it.perMonth + ' 次，等级 ' + ({ high: '高', medium: '中', low: '低' }[it.level]) +
            '（阈值 ' + it.threshold + ' 次）',
            'stockout',
          ]);
        });
      } else if (x.tool === 'get_private_label_opportunity') {
        (d.opportunities || []).forEach(function (it) {
          rows.push([
            '自有品牌窗口 · ' + it.name,
            '销量 ' + it.qtyShare + '%',
            '毛利贡献 ' + it.gpShare + '%，毛利率 ' + sc(it.grossMargin) + '%，健康度 ' + sc(it.score) + ' 分',
            'brand',
          ]);
        });
      } else if (x.tool === 'get_new_product_evaluation') {
        (d.items || []).forEach(function (it) {
          rows.push([
            '新品评估 · ' + it.name,
            sc(it.total) + ' 分',
            '品类健康 ' + it.catScore + '／毛利竞争力 ' + it.gmScore + '（差 ' +
            (it.gmDiff >= 0 ? '+' : '') + it.gmDiff + 'pt）／场景互补 ' + it.asScore,
            'newp',
          ]);
        });
      } else if (x.tool === 'get_data_quality') {
        var list = d.reports || [d];
        list.forEach(function (r) {
          rows.push([
            '数据质量 · ' + r.fileName,
            sc(r.overall) + ' 分',
            r.rowCount + ' 行　评级 ' + r.grade + '　问题 ' + r.issues.length + ' 项，' +
            '五维：完整' + sc(r.dims.completeness) + '/一致' + sc(r.dims.consistency) + '/有效' +
            sc(r.dims.validity) + '/唯一' + sc(r.dims.uniqueness) + '/时效' + sc(r.dims.timeliness),
            'shield',
          ]);
        });
      } else if (x.tool === 'get_category_trend') {
        (d.items || []).forEach(function (it) {
          rows.push([
            '销售趋势 · ' + it.name,
            trendText(it.qtyTrend.dir),
            '销量环比 ' + pct(it.qtyTrend.pct) + '（首 3 月 ' + num(it.qtyTrend.first, 1) +
            ' → 末 3 月 ' + num(it.qtyTrend.last, 1) + '）',
            'trend',
          ]);
        });
      } else if (x.tool === 'get_store_profile') {
        rows.push(['门店画像 · ' + d.store.short, '已接入', d.store.biz + ' · ' + d.store.city, 'store']);
      } else if (x.tool === 'get_analysis_history') {
        rows.push(['分析历史', (d.items || []).length + ' 条', '最近：' + ((d.items || [])[0] || {}).question, 'log']);
      }
    });

    var body = rows.length ?
      '<div class="ai-ev">' + rows.map(function (r) {
        return '<div class="ai-ev-r">' +
          '<div class="ai-ev-a">' + esc(r[0]) + '</div>' +
          '<div class="ai-ev-b">' + r[1] + '</div>' +
          '<div class="ai-ev-c">' + r[2] + '</div></div>';
      }).join('') + '</div>' :
      '<div style="color:var(--ink-3);font-size:12.5px">本次未取得可用于列举的量化依据。</div>';

    return { key: 'evidence', title: '关键数据依据', icon: 'data', html: h(icon('data') + '关键数据依据', body) };
  }

  /* ---- 段 3：分析 ---- */
  function secAnalysis(out, okOnes) {
    var lines = [];
    var hh = null, d = null, as = null, fc = null, cp = null;
    okOnes.forEach(function (x) {
      if (x.tool === 'get_category_health') hh = x.data;
      if (x.tool === 'get_dashboard_summary') d = x.data;
      if (x.tool === 'get_association_rules' || x.tool === 'run_apriori') as = x.data;
      if (x.tool === 'get_demand_forecast') fc = x.data;
      if (x.tool === 'compare_candidates') cp = x.data;
    });

    if (hh && hh.items.length) {
      var items = hh.items;
      var avg = A.round(items.reduce(function (a, x) { return a + x.score; }, 0) / items.length, 1);
      lines.push('<b>健康度结构：</b>7 个品类平均 ' + avg + ' 分。分档分布 —— ' +
        ['优秀', '良好', '中等', '偏弱', '差'].map(function (g) {
          var n = items.filter(function (x) { return x.grade === g; }).length;
          return n ? g + ' ' + n + ' 个' : null;
        }).filter(Boolean).join('、') + '。');

      var slowTurn = items.filter(function (x) { return x.turnoverDays > 45; });
      if (slowTurn.length) {
        lines.push('<b>周转压力：</b>' + slowTurn.length + ' 个品类周转超过 45 天健康线（' +
          slowTurn.map(function (x) { return x.name + ' ' + num(x.turnoverDays, 1) + ' 天'; }).join('、') +
          '），资金占用较重，是流动性改善的主要抓手。');
      }
      var lowSpace = items.filter(function (x) { return x.spaceEff < 400; });
      if (lowSpace.length) {
        lines.push('<b>坪效短板：</b>' + lowSpace.length + ' 个品类坪效低于 400 元/㎡/月（' +
          lowSpace.map(function (x) { return x.name + ' ' + num(x.spaceEff); }).join('、') +
          '），陈列资源产出效率不高，可考虑缩减货架面积或调整位置。');
      }
      var hiMargin = items.slice().sort(function (a, b) { return b.grossMargin - a.grossMargin; })[0];
      var loMargin = items.slice().sort(function (a, b) { return a.grossMargin - b.grossMargin; })[0];
      lines.push('<b>毛利结构：</b>毛利率最高为 ' + hiMargin.name + '（' + sc(hiMargin.grossMargin) +
        '%），最低为 ' + loMargin.name + '（' + sc(loMargin.grossMargin) + '%），两者相差 ' +
        sc(hiMargin.grossMargin - loMargin.grossMargin) + ' 个百分点，品类间盈利能力分化明显。');
    }

    if (as && (as.rules || []).length) {
      var rs = as.rules;
      var strong = rs.filter(function (x) { return x.lift >= 2.0; });
      lines.push('<b>关联结构：</b>共 ' + rs.length + ' 条规则，其中提升度 ≥ 2.0 的强关联 ' +
        strong.length + ' 条。' +
        (strong.length ? '强关联集中在「' + (strong[0].advice || '').split('：')[0] + '」等场景，' +
          '说明顾客在这些场景下存在稳定的组合购买习惯，具备场景化陈列与组合促销的基础。' : ''));
    }

    if (fc && (fc.items || []).length) {
      var up = fc.items.filter(function (x) { return x.delta > 5; });
      var dn = fc.items.filter(function (x) { return x.delta < -5; });
      lines.push('<b>需求结构：</b>' + (up.length ? up.length + ' 个品类需求上行' : '无品类需求显著上行') +
        '，' + (dn.length ? dn.length + ' 个品类需求下行' : '无品类需求显著下行') + '。' +
        (up.length && up[0].delta > 10 ? '「' + up[0].cat + '」涨幅达 ' + pct(up[0].delta) +
          '，需提前核查备货与供应商产能，避免旺季断货。' : ''));
    }

    if (cp && cp.items && cp.items.length >= 2) {
      var first = cp.items[0], last = cp.items[cp.items.length - 1];
      lines.push('<b>比较结构：</b>' + first.name + ' 与 ' + last.name + ' 综合分差 ' +
        sc(first.composite - last.composite) + ' 分。' +
        '差距主要来自' + (function () {
          var diffs = [
            ['销量', first.qtyScore - last.qtyScore],
            ['毛利', first.gpScore - last.gpScore],
            ['周转', first.turnoverScore - last.turnoverScore],
            ['坪效', first.spaceScore - last.spaceScore],
          ].sort(function (a, b) { return Math.abs(b[1]) - Math.abs(a[1]); });
          return diffs[0][0] + '维度（分差 ' + sc(diffs[0][1]) + '）';
        })() + '。');
    }

    if (!lines.length) {
      if (okOnes.length) {
        lines.push('本次调用工具以查询型为主（如数据质量、门店画像可用性），' +
          '未涉及需要多维度交叉分析的经营指标。如需深度分析，可询问品类健康度、关联陈列或需求预测相关问题。');
      }
    }
    if (!lines.length) return null;

    return { key: 'analysis', title: '分析', icon: 'cpu', html: h(icon('cpu') + '分析', lines.join('<br><br>')) };
  }

  /* ---- 段 4：建议 ---- */
  function secAdvice(out, okOnes) {
    var advice = [];
    var hh = null, d = null, fc = null, pl = null, sk = null;
    okOnes.forEach(function (x) {
      if (x.tool === 'get_category_health') hh = x.data;
      if (x.tool === 'get_dashboard_summary') d = x.data;
      if (x.tool === 'get_demand_forecast') fc = x.data;
      if (x.tool === 'get_private_label_opportunity') pl = x.data;
      if (x.tool === 'get_stockout_risk') sk = x.data;
    });

    if (hh && hh.items.length) {
      var plan = A.buildAssortmentPlan({
        weights: {
          qty: S().settings.weights.qty / 100, gp: S().settings.weights.gp / 100,
          turnover: S().settings.weights.turnover / 100, space: S().settings.weights.space / 100,
        },
      });
      if (plan.ok) {
        if (plan.buckets.exit.length) {
          plan.buckets.exit.forEach(function (x) {
            advice.push({
              level: 3, title: '启动「' + x.name + '」品类退出评估',
              body: '健康度 ' + sc(x.score) + ' 分（' + x.grade + '）。' + x.reasons[0] + '。' +
                '建议先压缩货架面积 50%、暂停引入新 SKU，观察 2 个月动销数据后决定是否全面退出。',
              why: '退出属高影响决策，涉及货架重排、库存清理与供应商关系，必须人工审批。',
              route: 'health',
            });
          });
        }
        if (plan.buckets.trim.length) {
          plan.buckets.trim.forEach(function (x) {
            advice.push({
              level: 3, title: '精简「' + x.name + '」SKU 结构',
              body: '健康度 ' + sc(x.score) + ' 分（' + x.grade + '）。建议按「高频刚需保留、低频长尾退出」原则' +
                '精简 SKU 约 30%，优先淘汰月动销低于品类均值的尾部单品。',
              why: 'SKU 精简会影响顾客选择面与供应商合约，属高影响决策。',
              route: 'health',
            });
          });
        }
        if (plan.buckets.expand.length) {
          plan.buckets.expand.forEach(function (x) {
            advice.push({
              level: 2, title: '巩固并适度扩充「' + x.name + '」',
              body: '健康度 ' + sc(x.score) + ' 分（' + x.grade + '），' + x.reasons[1] + '。' +
                '建议扩大产地直采 / 加深核心 SKU 库存深度，强化该品类的引流作用。',
              why: '属经营建议，可在品类经理权限内执行，但需留痕。',
              route: 'health',
            });
          });
        }
        if (plan.buckets.watch.length) {
          plan.buckets.watch.forEach(function (x) {
            advice.push({
              level: 2, title: '对「' + x.name + '」建立观察机制',
              body: '健康度 ' + sc(x.score) + ' 分，处于中等区间（' + x.grade + '）。' +
                '建议列入月度观察清单，重点跟踪周转天数与缺货次数的变化。',
              why: '暂不调整结构，仅建立监测。',
              route: 'health',
            });
          });
        }
      }
    }

    if (fc && (fc.items || []).length) {
      fc.items.forEach(function (f) {
        if (f.delta > 8) {
          advice.push({
            level: 2, title: '为「' + f.cat + '」提前备货',
            body: '未来需求预测环比 ' + pct(f.delta) + '（' + f.level.label + '）。' +
              '建议提前 1 周加密订货频次，并核查主要供应商在需求高峰期的供货能力。',
            why: '备货动作影响资金占用，但属常规经营决策，可由采购经理执行并留痕。',
            route: 'forecast',
          });
        } else if (f.delta < -8) {
          advice.push({
            level: 2, title: '控制「' + f.cat + '」订货量',
            body: '未来需求预测环比 ' + pct(f.delta) + '（' + f.level.label + '）。' +
              '建议下调订货量，避免形成呆滞库存与更高的周转压力。',
            why: '属常规经营决策。',
            route: 'forecast',
          });
        }
      });
    }

    if (pl && pl.opportunities.length) {
      advice.push({
        level: 1, title: '关注「' + pl.opportunities.map(function (x) { return x.name; }).join('、') + '」的自有品牌机会',
        body: '这些品类销量占比高但毛利贡献低，是自有品牌替代的典型窗口。' +
          '但当前缺少 SKU 级品牌属性与成本数据，<b>平台无法给出具体开发哪支单品的结论</b>。' +
          '建议先接入 SKU 主数据后再做开发决策。',
        why: '信息提示，不需审批。',
        route: 'privateLabel',
      });
    }

    if (sk && sk.data && sk.data.highCount) {
      advice.push({
        level: 2, title: '排查高风险品类的缺货原因',
        body: sk.data.items.filter(function (x) { return x.level === 'high'; }).map(function (x) {
          return x.name + '（' + x.stockout + ' 次）';
        }).join('、') + ' 缺货频次偏高，建议核查补货周期、安全库存设置与供应商到货准时率。',
        why: '补货参数调整属门店/采购日常运营权限。',
        route: 'assoc',
      });
    }

    // 限制建议数量，按 level 降序（高影响优先展示）
    advice.sort(function (a, b) { return b.level - a.level; });
    advice = advice.slice(0, 5);

    if (!advice.length) return null;

    out.advice = advice;
    out.needApproval = advice.some(function (a) { return a.level === 3; });

    var body = advice.map(function (a, i) {
      var lv = a.level === 3 ? ['L3 高影响', 'red'] : a.level === 2 ? ['L2 经营建议', 'orange'] : ['L1 信息提示', 'gray'];
      return '<div class="ai-adv l' + a.level + '">' +
        '<div class="ai-adv-h"><span class="chip ' + lv[1] + '">' + lv[0] + '</span>' +
        '<b>' + esc(a.title) + '</b>' +
        (a.route ? '<button class="btn sm" style="margin-left:auto" data-ai-go="' + a.route + '">前往模块</button>' : '') +
        '</div>' +
        '<div class="ai-adv-b">' + a.body + '</div>' +
        '<div class="ai-adv-w">' + icon('info', '', 12) + '<span><b>分级理由：</b>' + esc(a.why) + '</span></div>' +
        '</div>';
    }).join('');

    return {
      key: 'advice', title: '建议', icon: 'zap',
      html: h(icon('zap') + '建议（按影响分级）', body +
        (out.needApproval ? '<div style="margin-top:10px"><button class="btn pri" data-ai-act="submit">' +
          icon('approval') + '将 L3 高影响建议提交审批</button></div>' : '')),
    };
  }

  /* ---- 段 5：风险与限制 ---- */
  function secRisk(out, okOnes, badOnes) {
    var items = [];

    badOnes.forEach(function (x) {
      items.push(['数据不足 · ' + toolLabel(x.tool), esc(x.reason), 'bad']);
    });

    okOnes.forEach(function (x) {
      if (x.data && x.data.limitation) {
        items.push(['模型局限 · ' + toolLabel(x.tool), x.data.limitation, 'warn']);
      }
    });

    if (out.intent === 'assoc') {
      items.push(['数据口径', '当前演示数据商品编码高度离散（70 个商品名对应 5000+ 编码），' +
        '购物篮按「交易号 + 商品名称」构建。真实企业数据 SKU 编码稳定后可切换为按编码构建，' +
        '规则结果会随之变化。', 'warn']);
    }
    if (out.intent === 'forecast') {
      items.push(['预测性质', '需求预测结果为附件数据集提供的模拟预测值，' +
        '平台不对其做二次建模，仅做趋势方向识别与环比计算，因此不含模型置信度指标。', 'warn']);
    }
    if (out.intent === 'compare') {
      items.push(['比较层级', '当前比较基于品类级月度聚合数据，' +
        '<b>不能等同于 SKU 级选品结论</b>。若要按单品比较，需接入 SKU 级采购价、零售价、毛利率、货架占用数据。', 'warn']);
    }

    items.push(['数据来源', '<b>本次分析全部基于「基于公开零售行业数据构造的模拟演示数据」，' +
      '不包含任何华润苏果真实内部经营数据。</b>真实业务使用需替换为企业自有数据源。', 'info']);

    if (!badOnes.length && items.length <= 2) {
      items.push(['未识别到其他显著风险', '本次调用的工具均正常返回数据，风险提示以指标本身的风险项为准。', 'info']);
    }

    var body = '<div class="ai-risk">' + items.map(function (r) {
      return '<div class="ai-risk-r ' + r[2] + '">' +
        '<div class="ai-risk-t">' + esc(r[0]) + '</div>' +
        '<div class="ai-risk-d">' + r[1] + '</div></div>';
    }).join('') + '</div>';

    return { key: 'risk', title: '风险与限制', icon: 'alert', html: h(icon('alert') + '风险与限制', body, 'warn') };
  }

  /* ---- 段 6：决策状态 ---- */
  function secDecision(out, okOnes) {
    var lv = out.needApproval ? 3 : (out.advice ? 2 : 1);
    var map = {
      1: ['Level 1 · 信息提示', 'gray', '本次输出为信息参考，不涉及决策动作，无需审批。'],
      2: ['Level 2 · 经营建议', 'orange', '本次输出含经营建议，可在对应角色的权限范围内执行，平台会记录操作留痕。'],
      3: ['Level 3 · 高影响', 'red', '本次输出含高影响建议，<b>必须经人工审批后方可执行</b>。请前往审批中心处理，或直接在下方提交审批请求。'],
    };
    var m = map[lv];

    var body =
      '<div style="display:flex;align-items:center;gap:11px;flex-wrap:wrap;margin-bottom:11px">' +
      '<span class="chip ' + m[1] + '" style="font-size:12.5px;padding:5px 12px">' + esc(m[0]) + '</span>' +
      '<span style="font-size:12.5px;color:var(--ink-2)">' + m[2] + '</span></div>' +

      '<div class="ai-dec">' +
      '<div class="ai-dec-i"><span>工具调用</span><b>' + out.okCount + ' / ' + out.toolCount + ' 成功</b></div>' +
      '<div class="ai-dec-i"><span>分析时间</span><b>' + fmtTime(out.at) + '</b></div>' +
      '<div class="ai-dec-i"><span>执行人</span><b>' + esc(user().name) + '</b></div>' +
      '<div class="ai-dec-i"><span>决策责任</span><b>人工确认</b></div>' +
      '</div>' +

      '<div class="note" style="margin-top:12px">' + global.App.ICON.info +
      '<div><b>AI 建议仅供辅助决策，最终选品由采购人员确认。</b>' +
      '平台输出的所有结论均可追溯至来源数据集、算法名称、参数与生成时间。' +
      '若需执行高影响建议，请提交审批请求，审批人与时间将完整留痕。</div></div>' +

      '<div style="display:flex;gap:8px;margin-top:13px;flex-wrap:wrap">' +
      '<button class="btn" data-ai-act="copy">' + icon('doc') + '复制分析结论</button>' +
      '<button class="btn" data-ai-act="export">' + icon('download') + '导出分析报告</button>' +
      (lv === 3 ? '' : '<button class="btn pri" data-ai-act="submit">' + icon('approval') + '提交审批请求</button>') +
      '</div>';

    return { key: 'decision', title: '决策状态', icon: 'gavel', html: h(icon('gavel') + '决策状态', body) };
  }

  /* ========================================================================
   * 四、页面渲染
   * ====================================================================== */

  var QUICK = [
    { q: '给我一份全店经营概览', icon: 'dash' },
    { q: '哪些品类健康度最低？该怎么优化？', icon: 'health' },
    { q: '有哪些强关联组合值得调整陈列？', icon: 'link' },
    { q: '未来哪些品类需求会上涨？', icon: 'trend' },
    { q: '哪个品类库存周转最慢？', icon: 'refresh' },
    { q: '有哪些自有品牌的机会？', icon: 'brand' },
    { q: '哪些品类缺货最频繁？', icon: 'box' },
    { q: '给我一份整体选品优化方案', icon: 'zap' },
    { q: '数据质量怎么样？', icon: 'shield' },
    { q: '这家店适合做什么差异化选品？', icon: 'store' },
    { q: '帮我比较生鲜蔬果和日化清洁', icon: 'compare' },
    { q: '预测一下食品饮料的需求趋势', icon: 'forecast' },
  ];

  Pages.ai = function () {
    var s = S();
    var msgs = s.chat || [];
    var h = '';

    h += '<div class="page-head"><div class="t"><h2>AI 选品助手</h2>' +
      '<p>「苏果智选AI」可调用 <b>14 个后台工具</b>访问平台真实数据。所有回答遵循六段式模板，' +
      '数据不足时明确说明「当前数据不足以支持该结论」，绝不编造数字。　' + demoBadge() + '</p></div>' +
      '<div class="acts">' +
      '<button class="btn" data-act="ai-tools">' + icon('grid') + '查看 14 个工具' +
      '</button>' +
      '<button class="btn" data-act="ai-history">' + icon('clock') + '分析历史' +
      (s.analyses.length ? '（' + s.analyses.length + '）' : '') + '</button>' +
      '<button class="btn" data-act="ai-clear">' + icon('trash') + '清空对话</button>' +
      '</div></div>';

    h += '<div class="note" style="margin-bottom:15px">' + global.App.ICON.info +
      '<div><b>离线规则引擎架构：</b>平台不依赖任何外部大模型 API。' +
      '助手通过<b>意图识别 → 工具编排 → 真实数据装配 → 六段式模板渲染</b>四步生成回答，' +
      '所有数字均来自平台算法实时计算结果，可逐条溯源。' +
      '数据不足时返回明确拒答，<b>不做任何推测性补充</b>。</div></div>';

    // 对话区
    h += '<div class="card" style="margin-bottom:15px"><div class="card-b" style="padding:0">' +
      '<div id="aiThread" class="ai-thread">';

    if (!msgs.length) {
      h += '<div class="ai-welcome">' +
        '<div class="ai-wm">' + icon('ai') + '</div>' +
        '<h3>你好，我是「苏果智选AI」</h3>' +
        '<p>一个专业的社区商超智能选品决策助手。<br>' +
        '我可以调用平台 14 个后台工具，基于<b>当前已加载的真实数据集</b>回答你的问题 —— ' +
        '包括品类诊断、选品比较、关联陈列、需求预测、缺货风险、数据质量等。</p>' +
        '<div class="ai-warn">' + icon('warn') +
        '<div>我<b>不会编造数字</b>。当数据不足以支持结论时，我会明确告诉你缺什么数据、' +
        '需要接入哪些字段，而不是给你一个看起来合理的假结果。</div></div>' +
        '</div>';
    } else {
      h += msgs.map(renderMsg).join('');
    }

    h += '<div id="aiThink" class="ai-think" style="display:none">' +
      '<div class="ai-think-h">' + icon('cpu') + '<span>正在调用后台工具并装配数据…</span></div>' +
      '<div id="aiThinkSteps" class="ai-think-s"></div></div>';

    h += '</div>';

    // 输入区
    h += '<div class="ai-input">' +
      '<textarea id="aiQ" rows="1" placeholder="输入你的问题，例如：哪些品类健康度最低？该怎么优化？"></textarea>' +
      '<button class="btn pri" id="aiSend">' + icon('send') + '发送</button>' +
      '</div>' +
      '<div style="padding:0 16px 14px;font-size:11.5px;color:var(--ink-4)">' +
      'Enter 发送 / Shift+Enter 换行　·　回答基于模拟演示数据，AI 建议仅供辅助决策' +
      '</div>' +
      '</div></div>';

    // 快捷问题
    h += '<div class="card"><div class="card-h"><h3>' + icon('zap') + '快捷提问' +
      '<span class="sub">点击直接提问，覆盖全部核心分析场景</span></h3></div>' +
      '<div class="card-b"><div class="ai-quick">' +
      QUICK.map(function (q) {
        return '<button class="ai-q" data-ai-q="' + esc(q.q) + '">' + icon(q.icon, '', 14) +
          '<span>' + esc(q.q) + '</span></button>';
      }).join('') + '</div></div></div>';

    return h;
  };

  function renderMsg(m) {
    if (m.role === 'user') {
      return '<div class="ai-m user"><div class="ai-m-b">' + esc(m.text) + '</div>' +
        '<div class="ai-m-av">' + esc(user().name.slice(-2, -1)) + '</div></div>';
    }
    if (m.role === 'error') {
      return '<div class="ai-m bot"><div class="ai-m-av">' + icon('ai') + '</div>' +
        '<div class="ai-m-b"><div class="note bad">' + global.App.ICON.warn +
        '<div>' + esc(m.text) + '</div></div></div></div>';
    }
    var a = m.answer;
    var body = '<div class="ai-meta">' +
      '<span class="chip brand">意图：' + esc(intentLabel(a.intent)) + '</span>' +
      '<span class="chip gray">工具 ' + a.okCount + '/' + a.toolCount + '</span>' +
      (a.needApproval ? '<span class="chip red">L3 需审批</span>' : '') +
      '<span style="color:var(--ink-4);font-size:11px;margin-left:auto">' + fmtTime(a.at) + '</span>' +
      '</div>' +
      a.sections.map(function (x) { return x.html; }).join('') +
      '<div class="ai-trace">' +
      a.results.map(function (r) {
        return '<div class="ai-tr ' + (r.ok ? 'ok' : 'bad') + '">' +
          '<code>' + esc(r.tool) + '</code>' +
          '<span>' + (r.ok ? esc(r.trace.algorithm || '—') : '数据不足') + '</span>' +
          (r.ok && r.trace.source ? '<span style="color:var(--ink-4)">' + esc(String(r.trace.source).slice(0, 46)) + '</span>' : '') +
          '</div>';
      }).join('') +
      '</div>';
    return '<div class="ai-m bot"><div class="ai-m-av">' + icon('ai') + '</div>' +
      '<div class="ai-m-b">' + body + '</div></div>';
  }

  function intentLabel(k) {
    return {
      overview: '全店概览', health: '品类诊断', assoc: '关联陈列', forecast: '需求预测',
      compare: '选品比较', stockout: '缺货风险', privateLabel: '自有品牌', newProduct: '新品评估',
      store: '门店画像', quality: '数据质量', plan: '综合方案', general: '综合问答',
    }[k] || k;
  }

  Pages.after_ai = function () {
    var c = document.getElementById('content');

    // 发送
    var ta = document.getElementById('aiQ');
    var send = document.getElementById('aiSend');
    if (send) send.onclick = function () { ask(ta.value); };
    if (ta) {
      ta.onkeydown = function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(ta.value); }
      };
      ta.oninput = function () {
        ta.style.height = 'auto';
        ta.style.height = Math.min(140, ta.scrollHeight) + 'px';
      };
      setTimeout(function () { ta.focus(); }, 60);
    }

    c.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act],[data-ai-q],[data-ai-go],[data-ai-act]');
      if (!b) return;

      if (b.dataset.aiQ) { ask(b.dataset.aiQ); return; }
      if (b.dataset.aiGo) { global.App.go(b.dataset.aiGo); return; }

      var act = b.dataset.act || b.dataset.aiAct;
      if (act === 'ai-tools') showTools();
      if (act === 'ai-history') showHistory();
      if (act === 'ai-clear') {
        global.App.confirmDialog('清空对话', '将清空当前对话记录（分析历史仍保留）。', function () {
          S().chat = []; global.App.refreshPage();
          global.App.toast('对话已清空', 'ok');
        }, '确认清空');
      }
      if (act === 'ai-copy') { /* 占位，实际由 copy 处理 */ }
      if (act === 'copy') copyLast();
      if (act === 'export') exportLast();
      if (act === 'submit') submitLast();
      if (act === 'dr-cancel') global.App.closeDrawer();
      if (act === 'ai-reask') { global.App.closeDrawer(); S().chat = []; global.App.refreshPage(); }
    });
  };

  /** 提问主流程：只写状态 + 触发刷新，不直接操作其他渲染函数 */
  function ask(q) {
    q = String(q || '').trim();
    if (!q) return global.App.toast('请输入问题', 'warn');
    if (q.length > 300) return global.App.toast('问题过长，请精简到 300 字以内', 'warn');

    if (!S().chat) S().chat = [];
    S().chat.push({ role: 'user', text: q });

    // 展示思考过程
    var t = document.getElementById('aiThread');
    var think = document.getElementById('aiThink');
    var ta = document.getElementById('aiQ');
    if (ta) ta.value = '';

    // 先把用户消息追加到 DOM（避免整页重绘导致输入焦点丢失）
    if (t) {
      var div = document.createElement('div');
      div.className = 'ai-m user';
      div.innerHTML = '<div class="ai-m-b">' + esc(q) + '</div>' +
        '<div class="ai-m-av">' + esc(user().name.slice(-2, -1)) + '</div>';
      t.appendChild(div);
      t.scrollTop = t.scrollHeight;
    }
    if (think) {
      think.style.display = 'block';
      var r = route(q);
      document.getElementById('aiThinkSteps').innerHTML = r.plan.map(function (p, i) {
        var m = TOOL_META.filter(function (x) { return x.name === p.tool; })[0];
        return '<div class="ai-step"><span class="ai-step-n">' + (i + 1) + '</span>' +
          '<code>' + esc(p.tool) + '</code>' +
          '<span style="color:var(--ink-3)">' + esc(m ? m.label : '') + '</span>' +
          '<span class="ai-step-w">' + esc(p.why) + '</span></div>';
      }).join('');
    }

    setTimeout(function () {
      var out;
      try { out = answer(q); }
      catch (e) { out = null; }

      if (!out) {
        S().chat.push({ role: 'error', text: '分析过程发生异常，请重试或换一个问法。' });
      } else {
        S().chat.push({ role: 'bot', answer: out });
        S().analyses.unshift({
          id: global.App.uid('ANA'), question: q, intent: out.intent,
          tools: out.results.map(function (x) { return x.tool; }),
          okCount: out.okCount, toolCount: out.toolCount,
          level: out.level, needApproval: out.needApproval,
          at: global.App.nowStr(), user: user().name,
          summary: (out.sections[0] ? out.sections[0].html.replace(/<[^>]+>/g, '').slice(0, 160) : ''),
        });
        if (S().analyses.length > 60) S().analyses.length = 60;
        global.App.audit('AI 分析', q.slice(0, 40), '意图 ' + intentLabel(out.intent) +
          '｜工具 ' + out.okCount + '/' + out.toolCount + '｜决策级别 L' + out.level);
      }
      global.App.persist();

      // 就地追加，不整页重绘（保持输入焦点与滚动位置）
      var tt = document.getElementById('aiThread');
      if (tt) {
        var m = S().chat[S().chat.length - 1];
        var wrap = document.createElement('div');
        wrap.innerHTML = renderMsg(m);
        tt.appendChild(wrap.firstChild);
        tt.scrollTop = tt.scrollHeight;
      }
      var th = document.getElementById('aiThink');
      if (th) th.style.display = 'none';
      var box = document.getElementById('aiQ');
      if (box) box.focus();
    }, 320);
  }

  /* ---- 工具清单抽屉 ---- */
  function showTools() {
    var groups = {};
    TOOL_META.forEach(function (t) {
      (groups[t.cat] = groups[t.cat] || []).push(t);
    });
    var body = '<div class="note" style="margin-bottom:14px">' + global.App.ICON.info +
      '<div>助手可调用以下 <b>14 个后台工具</b>访问平台真实数据。' +
      '每个工具的输出都带算法溯源信息（算法名 / 来源数据集 / 参数 / 生成时间）。<br>' +
      '其中 <b>create_approval_request</b> 是<b>唯一的写操作工具</b>，用于把高影响建议提交人工审批。</div></div>' +
      Object.keys(groups).map(function (g) {
        return '<div class="card" style="margin-bottom:12px"><div class="card-h">' +
          '<h3>' + icon('grid') + esc(g) + '<span class="sub">' + groups[g].length + ' 个工具</span></h3></div>' +
          '<div class="card-b" style="padding:0"><div class="tbl-wrap"><table><thead><tr>' +
          '<th style="width:230px">工具名</th><th>功能说明</th><th style="width:110px">写操作</th>' +
          '</tr></thead><tbody>' +
          groups[g].map(function (t) {
            var w = t.name === 'create_approval_request';
            return '<tr><td><code style="font-size:11.5px;color:var(--brand)">' + esc(t.name) + '</code>' +
              '<div style="font-size:11px;color:var(--ink-3);margin-top:2px">' + esc(t.label) + '</div></td>' +
              '<td style="font-size:12px;color:var(--ink-2)">' + esc(t.desc) + '</td>' +
              '<td>' + (w ? '<span class="chip orange">写操作</span>' : '<span class="chip gray">只读</span>') + '</td></tr>';
          }).join('') + '</tbody></table></div></div></div>';
      }).join('') +
      '<div class="card"><div class="card-h"><h3>' + icon('lock') + '数据安全边界</h3></div><div class="card-b">' +
      '<div style="font-size:12.5px;line-height:1.95;color:var(--ink-2)">' +
      '· 助手<b>不直接访问数据库</b>，全部通过上述工具间接取数，工具层做统一的数据范围与权限控制<br>' +
      '· 所有写操作只有 <code>create_approval_request</code> 一个，且写入的是<b>审批请求</b>而非经营数据<br>' +
      '· 助手<b>不会修改任何原始数据集</b>，也不会调整算法参数（参数调整只能在「系统管理」由管理员操作并留痕）<br>' +
      '· 每次调用均记录操作日志，包含调用人、工具名、参数与时间<br>' +
      '· 回答中<b>不输出原始交易明细的个人可识别信息</b>，仅输出聚合统计结果' +
      '</div></div></div>';

    global.App.openDrawer('AI 助手后台工具清单', body,
      '<button class="btn" data-act="dr-cancel">关闭</button>');
    document.getElementById('drFoot').onclick = function () { global.App.closeDrawer(); };
  }

  /* ---- 分析历史 ---- */
  function showHistory() {
    var l = S().analyses || [];
    var body = l.length ?
      '<div class="card"><div class="card-b" style="padding:0"><div class="tbl-wrap"><table><thead><tr>' +
      '<th>时间</th><th>问题</th><th>意图</th><th class="num">工具</th><th>决策级别</th><th class="num">操作</th>' +
      '</tr></thead><tbody>' +
      l.map(function (x, i) {
        return '<tr><td style="font-size:11.5px;white-space:nowrap">' + esc(x.at) + '</td>' +
          '<td style="max-width:280px"><b style="font-size:12.5px">' + esc(x.question) + '</b>' +
          '<div style="font-size:11px;color:var(--ink-3);margin-top:2px">' +
          esc(String(x.summary || '').slice(0, 70)) + '…</div></td>' +
          '<td><span class="chip brand">' + esc(intentLabel(x.intent)) + '</span></td>' +
          '<td class="num">' + x.okCount + '/' + x.toolCount + '</td>' +
          '<td><span class="chip ' + (x.level === 3 ? 'red' : x.level === 2 ? 'orange' : 'gray') + '">L' + x.level + '</span></td>' +
          '<td class="num"><button class="btn sm" data-ai-act="ai-reask" data-q="' + esc(x.question) + '">重新分析</button></td></tr>';
      }).join('') + '</tbody></table></div></div></div>' +
      '<div class="note" style="margin-top:12px">' + global.App.ICON.info +
      '<div>分析历史保存在浏览器本地，最多保留 60 条。关闭此抽屉后可在对话区继续追问。</div></div>' :
      '<div class="empty" style="padding:34px 20px">' + icon('clock') +
      '<h4>暂无分析历史</h4><p>完成一次对话分析后，记录会自动存档于此，包含问题、意图、调用工具与决策级别。</p></div>';

    global.App.openDrawer('AI 分析历史（' + l.length + ' 条）', body,
      '<button class="btn" data-act="dr-cancel">关闭</button>');
    var f = document.getElementById('drFoot');
    f.onclick = function () { global.App.closeDrawer(); };
    document.getElementById('drBody').onclick = function (e) {
      var b = e.target.closest('[data-ai-act]'); if (!b) return;
      if (b.dataset.aiAct === 'ai-reask') {
        var q = b.dataset.q;
        global.App.closeDrawer();
        setTimeout(function () { ask(q); }, 120);
      }
    };
  }

  /* ---- 操作：复制 / 导出 / 提交审批 ---- */
  function lastAnswer() {
    for (var i = S().chat.length - 1; i >= 0; i--) {
      if (S().chat[i].role === 'bot') return S().chat[i].answer;
    }
    return null;
  }

  function plainText(a) {
    var out = ['【AI 选品助手分析报告】', '问题：' + a.question, '生成时间：' + fmtTime(a.at), ''];
    a.sections.forEach(function (s) {
      var txt = s.html
        .replace(/<div class="ai-sec-h">/g, '\n## ')
        .replace(/<div[^>]*>/g, '\n').replace(/<\/div>/g, '')
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+\n/g, '\n')
        .trim();
      out.push(txt, '');
    });
    out.push('— 数据来源：基于公开零售行业数据构造的模拟演示数据，非华润苏果真实内部经营数据 —');
    out.push('— AI 建议仅供辅助决策，最终选品由采购人员确认 —');
    return out.join('\n');
  }

  function copyLast() {
    var a = lastAnswer();
    if (!a) return global.App.toast('暂无可复制的内容', 'warn');
    var txt = plainText(a);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () {
        global.App.toast('分析结论已复制到剪贴板', 'ok');
      }, function () { fallbackCopy(txt); });
    } else fallbackCopy(txt);
  }
  function fallbackCopy(txt) {
    var t = document.createElement('textarea');
    t.value = txt; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); global.App.toast('分析结论已复制到剪贴板', 'ok'); }
    catch (e) { global.App.toast('复制失败，请手动选择文本复制', 'warn'); }
    document.body.removeChild(t);
  }

  function exportLast() {
    var a = lastAnswer();
    if (!a) return global.App.toast('暂无可导出的分析', 'warn');
    global.App.download('苏果智选_AI分析报告_' + global.App.nowStr().replace(/[-: ]/g, '') + '.txt',
      plainText(a), 'text/plain');
    global.App.audit('导出AI分析报告', a.question.slice(0, 40), '意图 ' + intentLabel(a.intent));
    global.App.persist();
    global.App.toast('分析报告已导出', 'ok');
  }

  function submitLast() {
    var a = lastAnswer();
    if (!a) return global.App.toast('暂无可提交的分析', 'warn');
    var adv = (a.advice || []).filter(function (x) { return x.level === 3; });
    if (!adv.length) {
      adv = (a.advice || []).slice(0, 3);
    }
    if (!adv.length) {
      return global.App.toast('本次分析未产出可提交的建议', 'warn');
    }

    var body = '<div class="note" style="margin-bottom:13px">' + global.App.ICON.info +
      '<div>将把本次分析中的 <b>' + adv.length + ' 条建议</b>合并为一个 Level 3 审批请求提交到审批中心。' +
      '提交后可在「审批中心」查看与处理。</div></div>' +
      '<div class="card" style="margin-bottom:13px"><div class="card-h"><h3>' + icon('zap') + '将提交的建议</h3></div>' +
      '<div class="card-b">' + adv.map(function (x, i) {
        var lv = x.level === 3 ? 'red' : x.level === 2 ? 'orange' : 'gray';
        return '<div style="padding:9px 0;border-bottom:1px solid var(--line-2)">' +
          '<span class="chip ' + lv + '">L' + x.level + '</span> <b>' + esc(x.title) + '</b>' +
          '<div style="font-size:12px;color:var(--ink-2);margin-top:5px">' + x.body + '</div></div>';
      }).join('') + '</div></div>' +
      '<div class="grid g2">' +
      '<div class="field"><label>优先级</label><select id="aiPri"><option>高</option><option>中</option><option>低</option></select></div>' +
      '<div class="field"><label>风险等级</label><select id="aiRisk"><option>高</option><option>中</option><option>低</option></select></div>' +
      '</div>' +
      '<div class="field"><label>期望处理时间</label><input id="aiDue" type="date" value="' +
      new Date(Date.now() + 2 * 24 * 3600e3).toISOString().slice(0, 10) + '"></div>';

    global.App.openDrawer('提交审批请求', body,
      '<button class="btn" data-act="dr-cancel">取消</button>' +
      '<button class="btn pri" data-act="ai-do-submit">确认提交</button>');

    document.getElementById('drFoot').onclick = function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'dr-cancel') return global.App.closeDrawer();
      if (b.dataset.act === 'ai-do-submit') {
        var due = document.getElementById('aiDue').value;
        var r = TOOLS.create_approval_request({
          level: 3, source: 'AI选品助手',
          title: '基于 AI 分析的选品优化建议（' + adv.length + ' 项）',
          advice: '本请求由 AI 选品助手在回答「' + a.question + '」时生成，' +
            '包含 ' + adv.length + ' 条建议：' + adv.map(function (x) { return x.title; }).join('；') + '。',
          basis: adv.map(function (x) {
            return x.title + ' —— ' + String(x.body).replace(/<[^>]+>/g, '');
          }),
          cats: a.cats || [],
          priority: document.getElementById('aiPri').value,
          risk: document.getElementById('aiRisk').value,
        });
        if (!r.ok) return global.App.toast(r.reason, 'err');
        if (due) {
          var rec = (S().approvals || []).filter(function (x) { return x.id === r.data.record.id; })[0];
          if (rec) rec.dueAt = new Date(due + 'T18:00:00').toISOString();
        }
        global.App.persist(); global.App.closeDrawer();
        global.App.toast('已提交审批请求，编号 ' + r.data.record.id, 'ok');
        setTimeout(function () { global.App.go('approval'); }, 420);
      }
    };
  }

  global.AITools = TOOLS;
  global.AIRoute = route;
  global.AIAnswer = answer;
})(window);
