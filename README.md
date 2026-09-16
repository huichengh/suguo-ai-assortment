# 苏果智选 · AI 社区商超智能选品与品类优化平台

> Suguo AI Assortment Intelligence —— 面向社区商超采购人员、品类经理与门店店长的 AI 智能选品决策平台。
> 核心价值：**AI 辅助决策 + 数据驱动选品 + 人工最终确认**。

演示场景：华润苏果南京江宁黄金海岸广场店。

### 🔗 在线演示

**https://huichengh.github.io/suguo-ai-assortment/**

> 由 GitHub Pages 托管，多设备可直接打开。演示账号见下方「快速开始」。

---

## ⚠️ 数据声明（请先阅读）

**本项目全部经营数据均为「基于公开行业数据构造的模拟数据」，不代表华润苏果或任何企业的真实经营数据。**

数据构造依据已在 `attachments/README_data.txt` 中逐项列明，主要包括：

- 国家统计局零售行业公开数据（2024 年限额以上零售企业存货周转天数 20.1 天）
- 永辉超市 2026 年半年报公开数据（综合毛利率 22.52%、自有品牌占比 10.07%）
- UCI Machine Learning Repository *Online Retail Dataset* 的**数据结构**（CC BY 4.0）
- 行业公开的商超品类销售占比与坪效数据

数据集仅用于算法验证与功能演示。**实际应用于企业时必须使用企业真实数据并获得正式授权。**

平台在 UI 层强制标注了数据性质：顶栏常驻「模拟演示数据」角标、底部常驻免责声明栏、数据中心页首屏强制声明。

---

## 核心能力

| 模块 | 说明 |
|---|---|
| **AI 经营驾驶舱** | 8 个 KPI 全部实时计算（非硬编码）、品类健康度分布、风险预警、AI 今日建议 |
| **选品比较中心** | 两类候选对象（同店品类互比 / 候选 SKU 引入），六维综合评分排名、关键指标差异表、需求趋势对比、关联销售分析 |
| **品类健康诊断** | 销量 30% + 毛利 30% + 库存周转 20% + 坪效 20% 四维评分，五级分档，双轨对比（附件参考值 ↔ 系统实时重算） |
| **关联陈列分析** | Apriori 购物篮挖掘，按「交易号 + 商品名称」构建篮子，输出支持度/置信度/提升度与陈列调整建议 |
| **需求预测** | 14 周历史 + 预测区间，环比与五级趋势分级（高增/温和上涨/平稳/温和下滑/高降） |
| **AI 选品助手** | 14 个后台工具 + 规则引擎意图路由 + **六段式回答模板**（结论 / 关键数据依据 / 分析 / 建议 / 风险与限制 / 决策状态） |
| **审批中心** | 建议三级分级（L1 信息提示 / L2 经营建议 / L3 高影响必须人工审批），逾期未处理置顶 |
| **数据中心** | 数据质量 9 类检查 + 五维评分、算法运行日志、数据字典、文件上传接入 |

---

## 快速开始

### 方式一：直接打开（零依赖）

```bash
git clone https://github.com/huichengh/suguo-ai-assortment.git
cd suguo-ai-assortment
# 直接双击打开 docs/index.html 即可
```

产物是**单文件 HTML，全部 CSS / JS / SVG 图标 / SVG 图表均已内联，零外部依赖，可完全离线运行**。

### 方式二：本地起服务

```bash
cd docs
python -m http.server 8899
# 浏览器打开 http://127.0.0.1:8899/
```

### 方式三：在线访问

直接打开 **https://huichengh.github.io/suguo-ai-assortment/**，无需安装任何东西。

### 演示账号

密码均为 `123456`，用于验证角色权限矩阵：

| 账号 | 角色 | 可访问范围 |
|---|---|---|
| `admin` | 系统管理员 | 全部 12 个菜单，含系统管理 |
| `purchase` | 采购专员 | 选品比较、审批中心等 |
| `category` | 品类经理 | 品类诊断、关联分析、需求预测 |
| `manager` | 门店店长 | 门店经营视角 |
| `viewer` | 只读用户 | 仅浏览，无写操作权限 |

---

## 项目结构

```
suguo-ai-assortment/
├── attachments/                  原始数据集（只读，不改动原始数值）
│   ├── README_data.txt           数据集说明与构造依据
│   ├── dataset_category_sales.csv        品类月度销售（7 品类 × 12 月 = 84 条）
│   ├── dataset_transactions_sample.csv   购物篮交易（5000 笔 / 22022 条明细 / 70 商品名）
│   ├── dataset_demand_forecast.csv       需求预测（5 品类 × 16 周 = 80 条）
│   ├── dataset_association_rules.csv     关联规则参考结果（Top 20）
│   └── dataset_category_health.csv       品类健康度参考结果（7 品类）
│
├── build/                        源码（分层架构，IIFE + 纯函数）
│   ├── gen_data.py               附件 CSV → data.js（不修改原始数值）
│   ├── data.js                   window.SUGUO_DATA（生成物）
│   ├── algos.js                  算法层：健康度 / Apriori / 趋势 / 比较 / 方案 / 质量检查
│   ├── app-core.js               运行时：登录、角色、路由、状态持久化、SVG 图标库
│   ├── app-charts.js             内联 SVG 图表引擎：柱状 / 雷达 / 折线 / 迷你图 / 环形 / 网络
│   ├── app-pages.js              核心 5 页：驾驶舱 / 诊断 / 关联 / 预测 / 比较
│   ├── app-modules.js            扩展 3 + 智能协同 3 + 系统管理 1 页
│   ├── app-ai.js                 AI 助手：14 工具 + 意图路由 + 六段式装配
│   ├── shell.html                页面骨架 + 设计系统 CSS
│   ├── bundle.js                 打包为单文件 HTML
│   ├── test_algos.js             算法单元测试（38 项）
│   ├── smoke.js                  源文件冒烟自检（48 项）
│   └── verify_dist.js            交付产物验证（26 项）
│
└── docs/                         GitHub Pages 发布目录
    ├── index.html                单文件交付产物（ASCII 名，在线访问用）
    └── 苏果智选-*.html            同内容，中文名便于本地识别
```

> **为什么产物放在 `docs/`**：GitHub Pages 的 branch 模式只允许发布根目录 `/` 或 `/docs`，
> 不支持自定义目录。放在 `docs/` 可让 Pages 直接生效，无需依赖 GitHub Actions 与额外的
> `workflow` 权限。

---

## 构建与自检

需要 Node.js 18+；`gen_data.py` 需要 Python 3.9+。

```bash
node build/test_algos.js      # 算法单元测试 —— 38 项
node build/smoke.js           # 源文件冒烟自检 —— 48 项
node build/bundle.js          # 打包单文件 + 产物自检 —— 8 项
node build/verify_dist.js     # 交付产物验证 —— 26 项
```

四层验证全部通过后才视为可交付。`verify_dist.js` 会直接从 `docs` 产物中抽出内联脚本整体执行，
验证的是**用户真正拿到的那一个文件**，而非源文件拼装。

---

## 关键设计决策

### 1. 算法层为纯函数，应用层状态由调用方注入

算法层不读取任何外部可变状态，依赖通过 `opts` 显式注入。这样算法可独立测试、结果可复现。

```javascript
// app-core.js —— 应用层状态在此注入
State.dashCache = A.buildDashboard({
  weights: { qty: 0.30, gp: 0.30, turnover: 0.20, space: 0.20 },
  pendingApprovalCount: State.approvals.filter(a => a.status === '待审批').length,
});
```

### 2. 渲染层单向调度，杜绝函数调用环

分层为 `数据层 → 计算层 → 渲染层`，只允许上层调下层。**渲染函数之间严禁互调**，
统一由 `App.refreshPage()` 按固定顺序调度，从架构上杜绝无限递归。

### 3. 健康度评分：分位收敛 + 混合基准

7 个品类的小样本下，纯 Min-Max 标准化会把首尾钉死在 0 分和 100 分，区分度失真。
因此采用 **5%–95% 分位边界收敛** + **相对标准化 60% + 行业基准 40%** 混合构成：

| 维度 | 权重 | 行业基准（锚点） |
|---|---|---|
| 销量占比 | 30% | ≥25% = 100 分，≤4% = 0 分 |
| 毛利贡献 | 30% | ≥22% = 100 分，≤8% = 0 分 |
| 库存周转 | 20% | **越低越好（逆向标准化）**：≤15 天 = 100 分，≥90 天 = 0 分 |
| 坪效 | 20% | ≥1200 元/㎡/月 = 100 分，≤300 = 0 分 |

> 库存周转是典型的「负向指标」，必须逆向标准化，否则周转越慢得分越高，结论会完全反过来。

### 4. 购物篮按「交易号 + 商品名称」构建

演示数据的 70 个商品名对应 5000+ 个 SKU 编码，**一名多码极度严重**。
若按商品编码聚合，同一商品会被拆成数百个稀疏项，支持度被稀释到无法产出任何规则。
因此默认按商品名称聚合（`aggregateBy: 'name'`）；接入真实数据且 SKU 编码稳定后可切回 `'sku'`。

### 5. 双轨数据治理

- **附件参考结果**：原样保留，不删改、不覆盖，作为算法正确性的对照基准
- **系统实时重算结果**：按当前阈值重新计算，随参数调整而变化
- 两者差异在「品类诊断」页透明展示，差异原因明确标注

### 6. 数据不足时明确拒答，绝不编造

当数据无法支撑结论时，返回 `{ ok: false, insufficient: true, reason: '…' }`，
前端渲染为明确的「当前数据不足以支持该结论」提示，**不生成任何伪造的量化结果**。

这也意味着 AI 助手存在两条合法终态：**六段式完整回答**，或**单段明确拒答**。
后者是设计预期行为，不是缺陷。

---

## AI 助手的 14 个后台工具

| 工具 | 类别 | 读写 |
|---|---|---|
| `get_dashboard_summary` | 经营概览 | 只读 |
| `get_category_health` | 品类诊断 | 只读 |
| `compare_candidates` | 选品比较 | 只读 |
| `get_category_trend` | 趋势分析 | 只读 |
| `get_association_rules` | 关联分析 | 只读 |
| `run_apriori` | 关联分析 | 只读 |
| `get_demand_forecast` | 需求预测 | 只读 |
| `get_stockout_risk` | 缺货风险 | 只读 |
| `get_data_quality` | 数据质量 | 只读 |
| `get_store_profile` | 门店画像 | 只读 |
| `get_private_label_opportunity` | 自有品牌 | 只读 |
| `get_new_product_evaluation` | 新品评估 | 只读 |
| `get_analysis_history` | 历史记录 | 只读 |
| `create_approval_request` | 审批流转 | **唯一写操作** |

设计上刻意只保留一个写操作，且该操作不直接改动任何业务数据，仅创建待人工审批的请求 —— 确保 AI 无法绕过人工确认。

---

## 技术栈

**当前版本（阶段一）**：原生 JavaScript（ES5 语法，IIFE 模块化）+ 内联 SVG 图表，零构建、零依赖。

**后续版本（阶段二，规划中）**：

- 后端：Python 3.11+ / FastAPI / SQLAlchemy / Pydantic / pandas / numpy / mlxtend / Prophet / scikit-learn / SQLite（可切 PostgreSQL），21 张表，30+ REST 接口，JWT 认证
- 前端：React + TypeScript + Vite + Tailwind CSS + React Router + Axios + ECharts + TanStack Table

阶段一的算法层（`algos.js`）采用纯函数设计，可直接平移到后端 `services/algorithms/`，无需重写。

---

## 许可

本项目为个人研究与作品演示用途。数据集构造依据中引用的第三方数据（国家统计局、永辉超市半年报、UCI Online Retail Dataset）版权归各自权利人所有，本项目仅参考其公开的结构与量级特征构造模拟数据，**未直接使用其原始数据**。

---

## 免责声明

本项目所有数据、算法结果与经营建议均为演示性质，**不构成任何实际经营决策依据**。
实际应用于企业场景时，必须使用企业真实数据、获得正式授权，并由业务人员对 AI 建议进行人工审核确认。
