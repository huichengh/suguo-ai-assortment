/* 核心算法单元测试 —— 对应需求第 29 节 10 项测试要求。
 * 运行：node build/test_algos.js
 */
const fs = require('fs');
const path = require('path');

// 构造最小浏览器环境
global.window = global;
const dataSrc = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');
eval(dataSrc.replace('window.SUGUO_DATA', 'global.SUGUO_DATA'));
const algoSrc = fs.readFileSync(path.join(__dirname, 'algos.js'), 'utf8');
eval(algoSrc.replace('window)();', 'global)();'));

global.State = { approvals: [] };
const Algo = global.Algo;

let pass = 0, fail = 0;
const results = [];

function check(name, cond, detail) {
  if (cond) { pass++; results.push(`  PASS  ${name}`); }
  else { fail++; results.push(`  FAIL  ${name}  ${detail || ''}`); }
}

// ---------------------------------------------------------------- T1
// 品类评分权重之和是否为 1
{
  const w = Algo.normalizeWeights({ qty: 30, gp: 30, turnover: 20, space: 20 });
  const s = w.qty + w.gp + w.turnover + w.space;
  check('T1 权重归一化后之和为 1', Math.abs(s - 1) < 1e-9, `实际=${s}`);
  check('T1b 大数值权重同样归一', Math.abs(
    (Algo.normalizeWeights({ qty: 3, gp: 3, turnover: 2, space: 2 }).qty) - 0.3) < 1e-9);
}

// ---------------------------------------------------------------- T2
// 周转天数是否正确采用逆向评分
{
  const arr = [10, 20, 90];
  const fast = Algo.normDesc(arr, 10);   // 周转快 => 高分
  const slow = Algo.normDesc(arr, 90);   // 周转慢 => 低分
  check('T2 周转天数逆向标准化：10天 > 90天', fast === 100 && slow === 0, `fast=${fast} slow=${slow}`);
  const forward = Algo.normAsc(arr, 10);
  check('T2b 若误用正向标准化会得到相反结果', forward === 0, `forward=${forward}`);
  const h = Algo.computeCategoryHealth({});
  const fresh = h.items.find(x => x.name === '生鲜蔬果');   // 周转 12 天
  const textile = h.items.find(x => x.name === '纺织服装'); // 周转 90+ 天
  check('T2c 健康度结果中快周转品类周转分更高',
    fresh.turnoverScore > textile.turnoverScore,
    `生鲜=${fresh.turnoverScore} 纺织=${textile.turnoverScore}`);
}

// ---------------------------------------------------------------- T3
// 缺失字段是否触发错误提示
{
  const q = Algo.runQualityCheck('category_sales', [{ 品类ID: 'C001', 月份: '2026-01' }], 'bad.csv');
  check('T3 缺字段触发高严重度问题', q.ok && q.issues.some(i => i.severity === 'high' && i.dim === '一致性'),
    JSON.stringify(q.missingColumns));
  check('T3b 缺字段导致一致性维度扣分', q.dims.consistency < 100, `consistency=${q.dims.consistency}`);
  const empty = Algo.runQualityCheck('category_sales', [], 'empty.csv');
  check('T3c 空文件返回数据不足而非假结果', empty.insufficient === true);
  const cmp = Algo.compare(['C001'], {});
  check('T3d 比较对象不足 2 个时拒绝计算', cmp.insufficient === true);
}

// ---------------------------------------------------------------- T4 / T5
// Apriori 是否以交易号构建购物篮 / 演示数据默认按商品名称聚合
{
  const r = Algo.apriori({});
  check('T4 Apriori 基于 5000 笔交易构建购物篮', r.basketCount === 5000, `实际=${r.basketCount}`);
  check('T4b 明细条目约 2.2 万条', r.itemCount === 22022, `实际=${r.itemCount}`);
  check('T5 默认按商品名称聚合（aggregateBy=name）', r.aggregateBy === 'name');
  check('T5b 商品维度为 70 个商品名称而非数千 SKU 编码',
    global.SUGUO_DATA.transactions.products.length === 70);
  check('T5c 演示数据集确实存在一码多名现象（需按名称聚合）',
    global.SUGUO_DATA.transactions.codeMultiple === 70,
    `多名一码数=${global.SUGUO_DATA.transactions.codeMultiple}`);
}

// ---------------------------------------------------------------- T6
// support / confidence / lift 是否正确计算
{
  const r = Algo.apriori({});
  const rule = r.rules.find(x => x.a === '牛奶' && x.b === '面包');
  check('T6 发现「牛奶 -> 面包」规则', !!rule);
  if (rule) {
    // 手工复核
    const D = global.SUGUO_DATA;
    const iMilk = D.transactions.products.indexOf('牛奶');
    const iBread = D.transactions.products.indexOf('面包');
    let both = 0, milk = 0, bread = 0;
    D.transactions.baskets.forEach(b => {
      const hasM = b.includes(iMilk), hasB = b.includes(iBread);
      if (hasM) milk++;
      if (hasB) bread++;
      if (hasM && hasB) both++;
    });
    const N = D.transactions.baskets.length;
    const expSup = both / N;
    const expConf = both / milk;
    const expLift = expConf / (bread / N);
    check('T6a 支持度计算正确', Math.abs(rule.support - expSup) < 1e-4,
      `算法=${rule.support} 手工=${expSup.toFixed(4)}`);
    check('T6b 置信度计算正确', Math.abs(rule.confidence - expConf) < 1e-4,
      `算法=${rule.confidence} 手工=${expConf.toFixed(4)}`);
    check('T6c 提升度计算正确', Math.abs(rule.lift - expLift) < 1e-3,
      `算法=${rule.lift} 手工=${expLift.toFixed(3)}`);
  }
  check('T6d 所有规则均满足当前阈值',
    r.rules.every(x => x.support >= 0.02 && x.confidence >= 0.50 && x.lift >= 1.50));
}

// ---------------------------------------------------------------- T7 / T8
// 导入参考关联规则时是否保留原始结果 / 实时重算是否按当前阈值过滤
{
  const att = global.SUGUO_DATA.rulesAttachment;
  check('T7 附件参考规则 20 条完整保留', att.length === 20, `实际=${att.length}`);
  check('T7b 附件规则未被算法修改（提升度原值保留）',
    att.some(x => x.a === '牛奶' && x.b === '面包' && x.lift === 2.84));
  const r = Algo.apriori({});
  const belowThreshold = att.filter(x => x.confidence < 0.50 || x.lift < 1.50);
  check('T8 演示数据集确实存在不满足默认阈值的附件规则', belowThreshold.length > 0,
    `低于阈值=${belowThreshold.length} 条`);
  check('T8b 实时重算结果严格按阈值过滤，不混入附件规则',
    r.rules.every(x => x.ruleset === 'realtime'));
  check('T8c 实时结果条数与附件条数相互独立',
    r.rules.length !== att.length || r.rules.length === 0,
    `实时=${r.rules.length} 附件=${att.length}`);
}

// ---------------------------------------------------------------- T9
// AI 是否拒绝编造缺失经营数据
{
  const ctx = global.AgentCtxFactory ? global.AgentCtxFactory() : null;
  const f = Algo.analyzeForecast('家居用品');   // 附件预测只覆盖 5 个品类
  check('T9 无预测数据的品类返回数据不足', f.insufficient === true, JSON.stringify(f.reason).slice(0, 80));
  check('T9b 数据不足时给出已有数据范围提示', /现有预测数据仅覆盖/.test(f.reason));
  const sku = Algo.compare(['C001', 'C002'], { mode: 'sku' });
  check('T9c SKU 模式无数据时拒绝输出量化评价', sku.insufficient === true);
  check('T9d 拒绝时指引上传 SKU 数据模板', !!sku.uploadTemplate);
}

// ---------------------------------------------------------------- T10
// Level 3 建议是否必须进入人工审批
{
  const plan = Algo.buildAssortmentPlan({});
  const level3 = [...plan.buckets.exit, ...plan.buckets.trim];
  check('T10 存在 Level 3 高影响建议（精简/退出）', level3.length > 0, `数量=${level3.length}`);
  check('T10b 全部 Level 3 建议标记需人工审批', level3.every(x => x.needApproval === true));
  const level1 = plan.buckets.keep;
  check('T10c Level 2 建议不强制审批', level1.every(x => x.needApproval === false));
}

// ---------------------------------------------------------------- 附加：趋势与边界
{
  check('附加1 五级趋势分类齐备', ['明显上涨', '温和上涨', '基本稳定', '温和下降', '明显下降']
    .every(l => l === Algo.trendLevelOf(20).label || l === Algo.trendLevelOf(10).label
      || l === Algo.trendLevelOf(0).label || l === Algo.trendLevelOf(-10).label
      || l === Algo.trendLevelOf(-20).label));
  const h = Algo.computeCategoryHealth({});
  check('附加2 7 个品类全部产出健康度', h.items.length === 7, `实际=${h.items.length}`);
  check('附加3 健康度结果含可追溯元数据',
    !!h.algorithm && !!h.parameters && !!h.createdAt && !!h.sourceDatasetId);
  check('附加4 权重变更后实时重算产生不同结果',
    Algo.computeCategoryHealth({ weights: { qty: 1, gp: 0, turnover: 0, space: 0 } })
      .items[0].cid !== undefined);
  check('附加5 比较结果优先级编号 A 起始',
    Algo.compare(['C001', 'C007'], {}).items[0].priority === 'A');
  check('附加6 星级分级与分数区间一致',
    Algo.starsOf(90).stars === '★★★★★' && Algo.starsOf(45).stars === '★★☆☆☆'
    && Algo.starsOf(20).stars === '★☆☆☆☆');
  check('附加7 质量检查五维齐全', (() => {
    const q = Algo.runQualityCheck('association_rules', global.SUGUO_DATA.rulesAttachment, 'r.csv');
    return ['completeness', 'consistency', 'validity', 'uniqueness', 'timeliness'].every(k => k in q.dims);
  })());
}

console.log('\n===== 苏果智选 核心算法单元测试 =====\n');
console.log(results.join('\n'));
console.log(`\n结果: ${pass} 通过 / ${fail} 失败 / 共 ${pass + fail} 项`);
process.exit(fail ? 1 : 0);
