// 正文去代码化：把等宽代码片段、表名、字段名、函数名、测试名、接口路径、状态值
// 统一改写为中文业务表述。附录 C 不在此脚本处理范围内。
// 用法：node plainify_body.js <in.html> <out.html>   （可原地覆写：in.html == out.html）
const fs = require("fs");
const [inF, outF] = process.argv.slice(2);
let s = fs.readFileSync(inF, "utf8");
const before = (s.match(/<code>/g) || []).length;

/* ---------- 0. 结构性精确替换（整串唯一，用 split/join 避免正则转义） ---------- */
const exact = [
  // 4.2.1 角色权限表：去掉英文角色代号行，只留中文岗位名
  ["<td>admin<br>系统管理员</td>", "<td>系统管理员</td>"],
  ["<td>purchasing_manager<br>采购经理</td>", "<td>采购经理</td>"],
  ["<td>category_manager<br>品类经理</td>", "<td>品类经理</td>"],
  ["<td>store_manager<br>门店店长</td>", "<td>门店店长</td>"],
  ["<td>viewer<br>普通查看</td>", "<td>普通查看</td>"],
  // 4.2.1 权限列：避免“全部权限 全部权限”“只读查看全部 只读”这类重复
  ['<code>["*"]</code> 全部权限', "全部权限"],
  ['<code>["view_all"]</code> 只读', "只读"],
  // 4.4.2 数据字典表：所属表列改中文表名
  ["<td>category_sales</td>", "<td>品类月度销售表</td>"],
  ["<td>transactions</td>", "<td>交易表</td>"],
  ["<td>transaction_items</td>", "<td>交易明细表</td>"],
  ["<td>demand_history / demand_forecasts</td>", "<td>需求历史表／需求预测表</td>"],
  ["<td>approval_requests</td>", "<td>审批单表</td>"],
  ["<td>association_rules</td>", "<td>关联规则表</td>"],
];
for (const [a, b] of exact) s = s.split(a).join(b);

/* ---------- 1. 短语级规则（先于词级替换执行） ---------- */
const phr = [
  // 轨别标记的动宾结构
  [/标记\s*<code>is_reference=true<\/code>/g, "标记为附件参考轨"],
  [/标记\s*<code>is_reference=false<\/code>/g, "标记为系统重算轨"],
  // “XX接口 <code>路径</code>” → 截去路径，保留中文接口名
  [/[\u4e00-\u9fa5]{2,12}接口\s*<code>[^<]*<\/code>/g, (m) => m.replace(/\s*<code>[^<]*<\/code>/, "")],
  // “接口 <code>路径</code>” → 中文接口名
  [/接口\s*<code>([^<]+)<\/code>/g, (m, p) => api[p.trim()] || api["/" + p.split("/api/")[1]] || p],
  // 权限数组
  [/<code>\["\*"\]<\/code>/g, "全部权限"],
  [/<code>\["compare","new_products","create_approval","view_all"\]<\/code>/g, "候选比较、新品评估、发起审批、查看全部"],
  [/<code>\["category_health","association","forecast","view_all"\]<\/code>/g, "品类诊断、关联陈列、需求预测、查看全部"],
  [/<code>\["view_own_store","view_suggestions","submit_feedback"\]<\/code>/g, "查看本门店分析、查看建议、提交反馈"],
  [/<code>\["view_all"\]<\/code>/g, "只读查看全部"],
  // 三个算法模块并列（先处理前面已带“算法模块”字样的，避免“算法模块…三个算法模块”重复）
  [/算法模块\s*<code>health_score\.py<\/code>／<code>apriori\.py<\/code>／<code>forecast\.py<\/code>/g, "三个算法模块（健康度评分、关联规则、需求预测）"],
  [/<code>health_score\.py<\/code>／<code>apriori\.py<\/code>／<code>forecast\.py<\/code>/g, "健康度评分、关联规则、需求预测三个算法模块"],
  // 单独成括注的测试用例名：整体删除（4.3.5 用这种方式）
  [/（<code>test_[a-z_]+<\/code>）/g, ""],
  // 测试用例名统一加引号
  [/<code>(test_[a-z_]+)<\/code>/g, (m, p) => "“" + (term[p] || "回归测试") + "”"],
  // random.seed
  [/<code>random\.seed\([^)]*\)<\/code>/g, "固定随机种子"],
  // 算法名标记
  [/<code>algorithm<\/code> 字段标记为 <code>reference_file<\/code>/g, "算法名标记为“附件参考”"],
  [/<code>algorithm<\/code> 字段标记为 <code>default_health_score<\/code>／<code>apriori<\/code>/g, "算法名标记为“默认健康度评分”或“Apriori”"],
  // 5.4.3 缺陷一的成因叙述（整段）
  [/保存逻辑的 <code>else<\/code> 分支才给局部变量 <code>result<\/code> 赋值，而函数结尾无条件 <code>return result<\/code>；当记录已存在时走 <code>if<\/code> 分支，<code>result<\/code> 从未被赋值，触发 <code>UnboundLocalError<\/code>/g,
    "保存逻辑只在“记录为新”的分支中给结果变量赋值，而函数结尾无条件返回该变量；当记录已存在时走“记录已存在”的分支，结果变量从未被赋值，触发变量未赋值错误"],
  // 5.4.3 修复方案列
  [/在 <code>if<\/code> 分支中显式令 <code>result = existing<\/code>；/g,
    "在“记录已存在”的分支中显式把结果变量指向既有记录；"],
  // 6.x 改动表：接口路径口径
  [/接口路径写作 <code>\/api\/v1\/\.\.\.<\/code>/g, "接口路径带版本段"],
  [/接口路径为 <code>\/api\/&lt;模块&gt;<\/code>（无 <code>\/v1<\/code>）/g, "接口路径为统一接口前缀（无版本段）"],
  // 析构数组 / True
  [/<code>use_product_name=True<\/code>/g, "按商品名称聚合的开关（默认开启）"],
];

/* ---------- 2. 词条映射表 ---------- */
const api = {
  "POST /api/compare": "选品比较接口",
  "GET /api/dashboard/summary": "仪表盘汇总接口",
  "GET /api/categories/health/all": "品类健康度查询接口",
  "POST /api/categories/recalculate": "品类健康度重算接口",
  "GET /api/association-rules?include_reference=true": "关联规则查询接口",
  "GET /api/association-rules/network": "关联网络接口",
  "GET /api/association-rules": "关联规则查询接口",
  "POST /api/association-rules/recalculate": "关联规则重算接口",
  "GET /api/forecast/{category_id}": "单品类预测接口",
  "GET /api/forecast": "需求预测查询接口",
  "POST /api/forecast/run": "预测运行接口",
  "GET /api/stores/{id}": "门店画像接口",
  "GET /api/stores": "门店列表接口",
  "GET /api/private-label/opportunities": "自有品牌机会接口",
  "GET /api/new-products/candidates": "候选新品接口",
  "POST /api/new-products/evaluate": "新品评估接口",
  "POST /api/agent/chat": "助手对话接口",
  "GET /api/agent/system-prompt": "系统提示词接口",
  "POST /api/agent/generate-report": "报告生成接口",
  "GET /api/data/datasets": "数据集清单接口",
  "POST /api/data/upload": "数据上传接口",
  "GET /api/data/quality": "数据质量接口",
  "GET /api/approvals/pending": "待审批查询接口",
  "PATCH /api/approvals/{id}": "审批复核接口",
  "GET /api/approvals": "审批查询接口",
  "POST /api/approvals": "审批创建接口",
  "GET/PUT /api/admin/model-settings": "模型参数管理接口",
  "GET /api/admin/users": "用户管理接口",
  "GET /api/admin/roles": "角色管理接口",
  "/api": "接口前缀",
  "/v1": "版本段",
};

const term = {
  // —— 数据表 ——
  "backend/data/suguo_ai.db": "演示数据库",
  "backend/app/tests/test_core.py": "后端自动化测试套件",
  transactions: "交易表",
  "transactions.tx_number": "交易表的交易流水号",
  transaction_items: "交易明细表",
  category_sales: "品类月度销售表",
  demand_history: "需求历史表",
  demand_forecasts: "需求预测表",
  category_health_results: "品类健康度结果表",
  association_rules: "关联规则表",
  categories: "品类表",
  stores: "门店表",
  candidate_products: "候选商品表",
  model_settings: "模型参数表",
  users: "用户表",
  roles: "角色表",
  "roles.permissions": "角色权限集合",
  approval_requests: "审批单表",
  ai_recommendations: "AI 建议表",
  sku_products: "商品主数据表",
  data_uploads: "数据上传表",
  audit_logs: "审计日志表",
  analysis_jobs: "分析任务表",
  data_quality_reports: "数据质量报告表",
  // —— 字段 ——
  tx_number: "交易流水号",
  product_name: "商品名称",
  product_code: "商品编码",
  is_reference: "轨别标识",
  "is_reference=true": "附件参考轨",
  "is_reference=false": "系统重算轨",
  sales_volume: "销售数量",
  sales_amount: "销售额",
  gross_profit: "毛利额",
  inventory_turnover_days: "库存周转天数",
  space_efficiency: "坪效",
  stockout_count: "缺货次数",
  sku_count: "在架 SKU 数",
  period: "期序号",
  approval_level: "审批等级",
  "approval_level&gt;=3": "审批等级不低于 3 级",
  "approval_level >= 3": "审批等级不低于 3 级",
  "approval_level ≥ 3": "审批等级不低于 3 级",
  passes_threshold: "是否达标",
  algorithm: "算法名",
  parameters: "参数快照",
  note: "提示",
  status: "状态",
  items: "结果列表",
  include_reference: "是否包含参考轨",
  only_reference: "是否仅取参考轨",
  use_product_name: "是否按商品名称聚合",
  "use_product_name=True": "是否按商品名称聚合（默认开启）",
  is_demo_data: "演示数据",
  confidence_note: "免责说明",
  "demo-badge": "演示数据角标",
  DATABASE_URL: "数据库连接地址",
  DataFrame: "结构化数据表",
  has_sku_data: "SKU 数据可用标记",
  "has_sku_data=false": "数据不足标记",
  system_recalculated: "系统重算轨",
  reference: "附件参考轨",
  // —— 状态值与枚举 ——
  None: "空值",
  pending: "待审批",
  true: "是",
  false: "否",
  True: "开启",
  reference_file: "“附件参考”",
  default_health_score: "“默认健康度评分”",
  apriori: "“Apriori”",
  UnboundLocalError: "变量未赋值错误",
  "algorithm=default_health_score": "算法名为“默认健康度评分”",
  "algorithm=reference_file": "算法名为“附件参考”",
  "algorithm=apriori": "算法名为“Apriori”",
  // —— 源码与模块 ——
  "health_score.py": "健康度评分模块",
  "apriori.py": "关联规则模块",
  "forecast.py": "需求预测模块",
  "agent.py": "助手编排模块",
  "app/algorithms/": "算法层",
  "models.py": "数据模型定义",
  "init_data.py": "演示数据生成脚本",
  "services/api.ts": "接口封装层",
  "src/services/api.ts": "接口封装层",
  "src/": "前端源码",
  "api/": "接口代码",
  statistics: "标准库",
  collections: "标准库",
  itertools: "标准库",
  // —— 函数 ——
  "get_business_explanation()": "管理层话术生成函数",
  "get_display_suggestion()": "门店执行话术生成函数",
  "calculate_category_health()": "健康度计算函数",
  calculate_category_health: "健康度计算函数",
  "run_apriori()": "关联规则挖掘函数",
  run_apriori: "关联规则挖掘函数",
  "get_forecast_trend()": "趋势判定函数",
  get_forecast_trend: "趋势判定函数",
  "generate_forecast()": "预测生成函数",
  generate_forecast: "预测生成函数",
  "get_model_weights()": "权重读取函数",
  "get_risk_threshold()": "阈值读取函数",
  "getCategoryHealth()": "语义化取数函数",
  // —— 智能体工具（4.2.5 表）——
  get_dashboard_summary: "仪表盘汇总",
  get_category_health: "品类健康度查询",
  get_association_rules: "关联规则查询",
  get_forecast: "需求预测查询",
  get_stockout_risk: "缺货风险查询",
  get_data_quality: "数据质量查询",
  get_store_profile: "门店画像查询",
  get_private_label_opportunity: "自有品牌机会查询",
  get_new_product_evaluation: "新品评估查询",
  create_approval_request: "审批请求创建",
  // —— 测试用例 ——
  test_weights_sum_to_one: "权重之和为 1",
  test_minmax_forward: "Min-Max 正向标准化的边界行为",
  test_score_range_invariant: "标准化输出值域不变式",
  test_category_health_within_range: "健康度子分与综合分的值域",
  test_turnover_inverse_scoring: "周转天数逆向评分",
  test_grade_from_score: "等级映射",
  test_default_use_product_name: "购物篮默认按名称构建",
  test_apriori_basket_construction: "购物篮结构",
  test_missing_category_sales: "无销售品类返回空值",
  test_level3_approval_required: "三级审批的入口保护",
  test_rule_calculation: "规则计算公式",
  test_recalculate_is_idempotent: "重算与预测幂等",
  test_strength_from_lift: "强度分级阈值",
  test_business_explanation: "业务解释文案",
  // —— 公式 ——
  "预测值 × 0.85": "预测值的 85%",
  "预测值 × 1.15": "预测值的 115%",
};

for (const [re, rep] of phr) s = s.replace(re, rep);

// 词级替换：剩余的 <code>X</code>
s = s.replace(/<code>([^<]*)<\/code>/g, (m, p) => {
  const t = p.trim();
  if (api[t]) return api[t];
  if (term[t]) return term[t];
  if (/^test_[a-z_]+$/.test(t)) return "“回归测试”";
  if (/^[a-z_]+\(\)$/.test(t)) return "对应函数";
  // 兜底：仍在的纯英文标识，按形态给中文泛称（正常不应触发）
  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(t)) {
    if (/\.(py|ts|js|json|db)$/.test(t)) return "相关模块";
    if (t.includes("/")) return "相关接口";
    if (t.includes("_")) return "相关字段";
    return "相关标识";
  }
  return t;
});

/* ---------- 3. 裸文本（未被 code 包裹）的技术标识 ---------- */
const bare = [
  [/\bLevel 1\b/g, "一级"],
  [/\bLevel 2\b/g, "二级"],
  [/\bLevel 3\b/g, "三级"],
  [/\bL3\b/g, "三级"],
  [/\bNone\b/g, "空值"],
  [/\bpending\b/g, "待审批"],
  [/token 消耗/g, "模型调用量"],
  [/\bDataFrame\b/g, "结构化数据表"],
  // 层级序号统一为中文
  [/第1层/g, "第一层"],
  [/第2层/g, "第二层"],
];
for (const [re, rep] of bare) s = s.replace(re, rep);

/* ---------- 4. 收尾清理（跑两遍，先清空格再去重） ---------- */
const clean = [
  [/（\s*）/g, ""],
  [/（\s*、/g, "（"],
  [/、\s*）/g, "）"],
  // 中文字符之间的多余空格
  [/([\u4e00-\u9fa5，。、；：“”（）《》])[ \t]+(?=[\u4e00-\u9fa5，。、；：“”（）《》])/g, "$1"],
  [/[ \t]+。/g, "。"],
  [/\s+，/g, "，"],
  // 空格清理后才做去重，否则匹配不到（“表 表”需先并成“表表”）
  [/接口统一前缀\s*前缀/g, "统一接口前缀"],
  [/演示数据标记\s*标记/g, "演示数据标记"],
  [/提示\s*字段/g, "提示字段"],
  [/状态\s*字段/g, "状态字段"],
  [/轨别标识\s*布尔字段/g, "轨别标识字段"],
  [/(免责说明)\s*\1/g, "$1"],
  [/固定随机种子（固定随机种子）/g, "固定随机种子"],
  [/下限\s*预测值的 85%、上限\s*预测值的 115%/g, "下限为预测值的 85%、上限为 115%"],
  // “统一接口前缀 前缀”“接口前缀 前缀” → 去重
  [/([\u4e00-\u9fa5]{2,8})前缀\s*前缀/g, "$1前缀"],
  // 相邻重复的中文接口名 / “接口 接口”
  [/([\u4e00-\u9fa5]{2,12}接口)\s*\1/g, "$1"],
  // 只用 \s+（至少一个空白），否则会把“接口路径为统一接口前缀”误吃成“路径为…”
  [/接口\s+([\u4e00-\u9fa5]{2,12}接口)/g, "$1"],
  // “平台实测（系统重算轨，亦称系统重算轨）” → “平台实测（亦称系统重算轨）”
  [/([\u4e00-\u9fa5]{3,8})，亦称\1/g, "亦称$1"],
  // “系统重算轨的记录（亦称系统重算轨）” → “系统重算轨的记录”
  [/(系统重算轨|附件参考轨)(的[^（]{0,8})?（亦称\1）/g, "$1$2"],
  // 相邻重复的 3 字以上中文短语（“系统重算轨系统重算轨”之类）
  [/([\u4e00-\u9fa5]{3,10})\s*\1/g, "$1"],
  // 括注内的重复轨名：“7 条系统重算轨（系统重算轨，算法名…” → 去重
  [/(系统重算轨|附件参考轨)（\1，/g, "$1（"],
  // 表名后原带“表”字造成的双表：“关联规则表表时” → “关联规则表时”
  [/表表/g, "表"],
  // L3 已改为“三级”，原“一条 L3 级建议”会成“三级级”
  [/三级级/g, "三级"],
  // 词后多余空格（“提示 字段”“状态 字段”等）
  [/([\u4e00-\u9fa5]{2,12}(?:接口|表|字段|标记|说明|参数|模块|函数|值|轨))[ \t]+(?=[\u4e00-\u9fa5，。、；：（）“”])/g, "$1"],
];
for (let pass = 0; pass < 2; pass++) {
  for (const [re, rep] of clean) s = s.replace(re, rep);
}

fs.writeFileSync(outF, s);
const after = (s.match(/<code>/g) || []).length;
console.log(`${outF}  原 <code> ${before} → 现 ${after}`);
