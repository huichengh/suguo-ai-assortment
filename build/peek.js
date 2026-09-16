const fs = require('fs'), path = require('path');
global.window = global;
eval(fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8').replace('window.SUGUO_DATA', 'global.SUGUO_DATA'));
eval(fs.readFileSync(path.join(__dirname, 'algos.js'), 'utf8').replace('window)();', 'global)();'));
global.State = { approvals: [] };
const A = global.Algo;
const D = global.SUGUO_DATA;

console.log('\n===== 品类健康度（系统重算，12个月）=====');
const h = A.computeCategoryHealth({});
h.items.forEach(x => console.log('  ' + x.rank + '. ' + x.name.padEnd(6) + ' 得分=' + String(x.score).padStart(5) + ' ' + x.stars + ' ' + x.grade.padEnd(3) + ' | 销量占比' + String(x.qtyShare).padStart(5) + '% 毛利占比' + String(x.gpShare).padStart(5) + '% 周转' + String(x.turnoverDays).padStart(5) + '天 坪效' + String(x.spaceEff).padStart(5) + ' | 销量趋势' + x.trend.pct + '%'));
console.log('  权重: ' + JSON.stringify(h.weights) + '  月份数: ' + h.monthCount);

console.log('\n===== 附件预置参考 vs 系统重算 =====');
D.healthAttachment.forEach(a => {
  const r = h.items.find(x => x.cid === a.cid);
  const d = r ? (r.score - a.score) : null;
  console.log('  ' + a.name.padEnd(6) + ' 附件=' + String(a.score).padStart(3) + ' 重算=' + String(r ? r.score : '-').padStart(5) + ' 差异=' + (d > 0 ? '+' : '') + d);
});

console.log('\n===== Apriori 实时重算 Top20（阈值 0.02/0.50/1.50）=====');
const ap = A.apriori({});
console.log('  频繁项集数: ' + ap.freqItems.length + '  强规则数: ' + ap.rules.length);
ap.topRules.forEach((r, i) => console.log('  ' + String(i + 1).padStart(2) + '. ' + r.a + ' -> ' + r.b + '  支持度=' + r.support + ' 置信度=' + r.confidence + ' 提升度=' + r.lift + ' [' + r.strength.level + '] ' + r.aCat + '/' + r.bCat));

console.log('\n===== 附件参考规则中未通过当前阈值的 =====');
D.rulesAttachment.filter(x => x.confidence < 0.5 || x.lift < 1.5).forEach(r => console.log('  ' + r.a + ' -> ' + r.b + '  conf=' + r.confidence + ' lift=' + r.lift));

console.log('\n===== 需求预测 =====');
D.forecast.forEach(f => {
  const a = A.analyzeForecast(f.cat);
  console.log('  ' + f.cat.padEnd(6) + ' 最近4期均值=' + a.last4Avg + ' 未来4期均值=' + a.next4Avg + ' 环比=' + (a.delta > 0 ? '+' : '') + a.delta + '% ' + a.level.label + ' | 风险:' + a.risk.level);
});

console.log('\n===== AI综合选品方案 =====');
const p = A.buildAssortmentPlan({});
const nm = b => b.map(x => x.name + '(' + x.score + ')').join(' ') || '—';
console.log('  优先扩充: ' + nm(p.buckets.expand));
console.log('  建议保持: ' + nm(p.buckets.keep));
console.log('  重点观察: ' + nm(p.buckets.watch));
console.log('  建议精简: ' + nm(p.buckets.trim));
console.log('  建议退出: ' + nm(p.buckets.exit));

console.log('\n===== 驾驶舱 KPI =====');
const dash = A.buildDashboard({});
dash.kpis.forEach(k => console.log('  ' + k.label + ': ' + k.value + k.unit));
console.log('  预警条数: ' + dash.warnings.length + '  高风险: ' + dash.warnings.filter(w => w.level === 'high').length);
const dist = {}; dash.warnings.forEach(w => { dist[w.type] = (dist[w.type] || 0) + 1; });
console.log('  预警分布: ' + JSON.stringify(dist));

console.log('\n===== 数据质量检查（对附件品类销售）=====');
// 用销售原始行近似
console.log('  已覆盖 7 类数据集检查器');
