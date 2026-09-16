# -*- coding: utf-8 -*-
"""把附件 CSV 编译成单文件版内嵌的 data.js 数据包。

设计原则：
- 只做格式转换与聚合，不修改任何原始数值（保留原始附件用于双轨对比）。
- 交易数据以「篮子」形式压缩存储（交易号 + 商品名列表），
  因为演示数据的商品编码高度离散，一名多码，购物篮分析必须按商品名聚合。
"""
import csv, json, os, sys, collections, hashlib
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ATT = os.path.join(ROOT, "attachments")
OUT = os.path.join(ROOT, "build", "data.js")


def rd(fn):
    with open(os.path.join(ATT, fn), encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def i(v, d=0):
    try:
        return int(str(v).strip())
    except Exception:
        return d


def fl(v, d=None):
    try:
        s = str(v).strip()
        return float(s) if s else d
    except Exception:
        return d


def sha1(path):
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


# ---------------------------------------------------------------- 品类销售
sales_rows = rd("dataset_category_sales.csv")
categories = []
cat_seen = {}
sales = []
for r in sales_rows:
    cid, cname = r["品类ID"], r["品类名称"]
    if cid not in cat_seen:
        cat_seen[cid] = {"id": cid, "name": cname}
        categories.append(cat_seen[cid])
    sales.append({
        "cid": cid, "month": r["月份"],
        "qty": i(r["销量(件)"]),
        "amt": fl(r["销售额(元)"], 0.0),
        "gp": fl(r["毛利额(元)"], 0.0),
        "turnoverDays": fl(r["库存周转天数"]),
        "spaceEff": fl(r["坪效(元/㎡/月)"]),
        "stockout": i(r["缺货次数"]),
        "skuCount": i(r["SKU数量"]),
    })

# ---------------------------------------------------------------- 健康度（附件预置参考）
health_att = [{
    "cid": r["品类ID"], "name": r["品类名称"],
    "score": i(r["综合评分"]),
    "stars": r["健康度等级"], "grade": r["评级"],
    "qtyShare": fl(r["销量贡献(%)"]),
    "gpShare": fl(r["毛利贡献(%)"]),
    "turnoverDays": fl(r["周转天数"]),
    "spaceScore": fl(r["坪效得分"]),
    "advice": r["优化建议"], "lamp": r["预警灯"],
} for r in rd("dataset_category_health.csv")]

# ---------------------------------------------------------------- 关联规则（附件预置参考）
rules_att = [{
    "id": i(r["规则ID"]),
    "a": r["前项商品(A)"], "b": r["后项商品(B)"],
    "support": fl(r["支持度"]), "confidence": fl(r["置信度"]),
    "lift": fl(r["提升度"]),
    "advice": r["陈列建议"],
} for r in rd("dataset_association_rules.csv")]

# ---------------------------------------------------------------- 需求预测
fc_rows = rd("dataset_demand_forecast.csv")
forecast = {}
for r in fc_rows:
    c = r["品类"]
    forecast.setdefault(c, {"cat": c, "points": []})
    forecast[c]["points"].append({
        "w": i(r["周次"]), "date": r["日期"],
        "hist": fl(r["历史销量(件)"]),
        "fc": fl(r["预测销量(件)"]),
        "lo": fl(r["预测下界(件)"]),
        "hi": fl(r["预测上界(件)"]),
        "type": r["数据类型"],
    })
forecast = list(forecast.values())

# ---------------------------------------------------------------- 交易篮子
tx_rows = rd("dataset_transactions_sample.csv")
basket_map = collections.OrderedDict()
prod_cat = {}
prod_codes = collections.defaultdict(set)
tx_date = {}
for r in tx_rows:
    no, nm = r["交易号"], r["商品名称"]
    basket_map.setdefault(no, [])
    if nm not in basket_map[no]:
        basket_map[no].append(nm)
    prod_cat[nm] = r["品类"]
    prod_codes[nm].add(r["商品编码"])
    tx_date[no] = r["交易日期"]

products = sorted(prod_cat.keys())
pidx = {p: k for k, p in enumerate(products)}
baskets = [[pidx[n] for n in items] for items in basket_map.values()]
code_multi = sum(1 for p in products if len(prod_codes[p]) > 1)

# 商品频次
freq = collections.Counter()
for b in baskets:
    for x in b:
        freq[x] += 1

tx_dates = sorted(set(tx_date.values()))

# ---------------------------------------------------------------- 组装
data = {
    "meta": {
        "platform": "苏果智选 Suguo AI Assortment Intelligence",
        "store": "华润苏果（南京江宁黄金海岸广场店）",
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        # 三重声明：原型性质 / 参赛用途 / 数据来源。三者缺一不可，
        # 避免被误读为已上线的商业系统或真实企业经营数据。
        "nature": "软件原型 Prototype（参赛作品）",
        "purpose": "用于参加比赛，展示 AI 选品辅助决策的技术构想；未接入任何企业生产系统，未做商业部署。",
        "disclaimer": "本平台全部经营数据为基于公开行业数据构造的模拟演示数据，不代表华润苏果或任何企业真实经营数据。",
        "files": {},
    },
    "categories": categories,
    "sales": sales,
    "healthAttachment": health_att,
    "rulesAttachment": rules_att,
    "forecast": forecast,
    "transactions": {
        "products": products,
        "productCat": [prod_cat[p] for p in products],
        "baskets": baskets,
        "freq": [freq[k] for k in range(len(products))],
        "txCount": len(baskets),
        "itemCount": len(tx_rows),
        "codeMultiple": code_multi,
        "dates": tx_dates,
    },
}

for fn in ["README_data.txt", "dataset_category_sales.csv",
           "dataset_transactions_sample.csv", "dataset_demand_forecast.csv",
           "dataset_association_rules.csv", "dataset_category_health.csv"]:
    p = os.path.join(ATT, fn)
    if os.path.exists(p):
        data["meta"]["files"][fn] = {
            "size": os.path.getsize(p),
            "sha1": sha1(p),
        }

os.makedirs(os.path.dirname(OUT), exist_ok=True)
payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
with open(OUT, "w", encoding="utf-8") as f:
    f.write("// 苏果智选 演示数据集（由附件 CSV 编译，未修改任何原始数值）\n")
    f.write("window.SUGUO_DATA = ")
    f.write(payload)
    f.write(";\n")

print(f"data.js 生成完成: {len(payload)/1024:.1f} KB")
print(f"  品类 {len(categories)} / 销售记录 {len(sales)} / 篮子 {len(baskets)} / 商品 {len(products)}")
print(f"  预测品类 {len(forecast)} / 附件规则 {len(rules_att)} / 附件健康度 {len(health_att)}")
