"""苏果智选 · 核心算法引擎（后端实现）。

本模块是前端 build/algos.js 的等价实现，遵循同一套设计约定：

  1. **纯函数**：不读数据库、不读全局状态，输入数据全部由调用方通过参数注入。
     这样算法可独立单元测试、结果可复现，也便于与前端逐项比对。
  2. **绝不虚构**：数据不足时返回 {"ok": False, "insufficient": True, "reason": ...}，
     由调用方决定如何向用户展示，不生成任何伪造的量化结果。
  3. **逆向标准化**：库存周转天数越低越好，必须走 norm_desc，
     否则周转越慢得分越高，结论会完全反过来。
  4. **评分构成**：相对标准化 60% + 行业基准 40%。
     纯相对 Min-Max 在 7 个品类的小样本下会把差异过度放大，
     导致重算值与附件参考值出现 30 分级别的偏离，失去可比性。

与前端的一致性由 tests/test_api.py 中的对照用例保证。
"""

from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any, Iterable, Sequence

# ============================ 基础工具 ============================


def rnd(v: float, n: int = 2) -> float:
    """四舍五入到 n 位小数。与前端 round 的实现口径一致。"""
    if v is None:
        return 0.0
    p = 10 ** n
    return math.floor(v * p + 0.5) / p if v >= 0 else -math.floor(-v * p + 0.5) / p


def quantile(sorted_vals: Sequence[float], q: float) -> float:
    """线性插值分位数。传入的必须是已升序排序的序列。"""
    n = len(sorted_vals)
    if n == 0:
        return float("nan")
    if n == 1:
        return sorted_vals[0]
    pos = (n - 1) * q
    base = int(math.floor(pos))
    rest = pos - base
    if base + 1 < n:
        return sorted_vals[base] + rest * (sorted_vals[base + 1] - sorted_vals[base])
    return sorted_vals[base]


def norm_asc(vals: Sequence[float], v: float) -> float:
    """正向 Min-Max 标准化到 0-100（越大越好）。

    采用 5%-95% 分位边界收敛：样本量少时避免首尾被钉死在 0/100 分，
    同时保留 0-100 的可解释区间。
    """
    s = sorted(vals)
    if not s:
        return 50.0
    mn, mx = quantile(s, 0.05), quantile(s, 0.95)
    if not math.isfinite(mn) or not math.isfinite(mx) or mx == mn:
        mn, mx = s[0], s[-1]
    if not math.isfinite(mn) or not math.isfinite(mx) or mx == mn:
        return 50.0
    r = (v - mn) / (mx - mn) * 100
    return max(0.0, min(100.0, r))


def norm_desc(vals: Sequence[float], v: float) -> float:
    """逆向 Min-Max 标准化到 0-100（越小越好）—— 周转天数必须走这条。"""
    s = sorted(vals)
    if not s:
        return 50.0
    mn, mx = quantile(s, 0.05), quantile(s, 0.95)
    if not math.isfinite(mn) or not math.isfinite(mx) or mx == mn:
        mn, mx = s[0], s[-1]
    if not math.isfinite(mn) or not math.isfinite(mx) or mx == mn:
        return 50.0
    r = (mx - v) / (mx - mn) * 100
    return max(0.0, min(100.0, r))


def stars_of(score: float) -> dict[str, str]:
    """健康度分档。五级 + 预警灯色。"""
    if score >= 85:
        return {"stars": "★★★★★", "grade": "优秀", "lamp": "绿灯", "color": "green"}
    if score >= 70:
        return {"stars": "★★★★☆", "grade": "良好", "lamp": "绿灯", "color": "green"}
    if score >= 55:
        return {"stars": "★★★☆☆", "grade": "一般", "lamp": "黄灯", "color": "yellow"}
    if score >= 40:
        return {"stars": "★★☆☆☆", "grade": "较差", "lamp": "橙灯", "color": "orange"}
    return {"stars": "★☆☆☆☆", "grade": "差", "lamp": "红灯", "color": "red"}


def normalize_weights(w: dict[str, float]) -> dict[str, float]:
    """权重归一化。全零时退化为均权，避免除零。"""
    keys = ("qty", "gp", "turnover", "space")
    total = sum(float(w.get(k, 0) or 0) for k in keys)
    if total <= 0:
        return {k: 0.25 for k in keys}
    return {k: (float(w.get(k, 0) or 0)) / total for k in keys}


DEFAULT_WEIGHTS = {"qty": 0.30, "gp": 0.30, "turnover": 0.20, "space": 0.20}

# 行业基准锚点。用于「绝对基准得分」，保证跨数据集可比、可解释。
BASE = {
    # 周转天数：<=15 天优秀(100)，>=90 天极差(0)
    "turnover": lambda d: None if d is None else (
        100.0 if d <= 15 else (0.0 if d >= 90 else (90 - d) / (90 - 15) * 100)
    ),
    # 坪效(元/㎡/月)：>=1200 优秀(100)，<=300 极差(0)
    "space": lambda v: None if v is None else (
        100.0 if v >= 1200 else (0.0 if v <= 300 else (v - 300) / (1200 - 300) * 100)
    ),
    # 销量占比(%)：>=25% 优秀(100)，<=4% 极差(0)
    "qty": lambda p: None if p is None else (
        100.0 if p >= 25 else (0.0 if p <= 4 else (p - 4) / (25 - 4) * 100)
    ),
    # 毛利占比(%)：>=22% 优秀(100)，<=8% 极差(0)
    "gp": lambda p: None if p is None else (
        100.0 if p >= 22 else (0.0 if p <= 8 else (p - 8) / (22 - 8) * 100)
    ),
}

MIX = {"relative": 0.6, "absolute": 0.4}


def _mix(rel: float, absolute: float | None) -> float:
    if absolute is None:
        return rel
    return rel * MIX["relative"] + absolute * MIX["absolute"]


# ==================== 模块 1：品类健康度评分 ====================


def compute_trend(months: list[dict], key: str) -> dict[str, Any]:
    """首 3 期均值 vs 末 3 期均值。用滑动均值降低单月噪声。"""
    if not months or len(months) < 3:
        return {"dir": "stable", "pct": 0.0}
    first = months[:3]
    last = months[-3:]
    f = sum((m.get(key) or 0) for m in first) / len(first)
    l = sum((m.get(key) or 0) for m in last) / len(last)
    if not f:
        return {"dir": "stable", "pct": 0.0}
    pct = (l - f) / abs(f) * 100
    direction = "up" if pct > 5 else ("down" if pct < -5 else "stable")
    return {"dir": direction, "pct": rnd(pct, 1), "first": rnd(f, 1), "last": rnd(l, 1)}


def compute_category_health(
    sales: list[dict],
    categories: list[dict],
    weights: dict[str, float] | None = None,
    months: int | None = 12,
    source_dataset_id: str = "dataset_category_sales.csv",
) -> dict[str, Any]:
    """计算品类健康度。

    sales 每行字段：cid, name, month, qty, amt, gp, turnover_days, space_eff,
    stockout, sku_count
    """
    w = normalize_weights(weights or DEFAULT_WEIGHTS)

    all_months = sorted({r["month"] for r in sales})
    n_months = 12 if months is None else months
    use_months = all_months[-n_months:]
    use_set = set(use_months)
    filtered = [r for r in sales if r["month"] in use_set]

    agg: dict[str, dict] = {}
    for c in categories:
        agg[c["id"]] = {
            "cid": c["id"], "name": c["name"],
            "qty": 0, "amt": 0.0, "gp": 0.0, "stockout": 0,
            "turnover_sum": 0.0, "turnover_w": 0,
            "space_sum": 0.0, "space_w": 0,
            "sku_sum": 0.0, "sku_n": 0,
            "months": [],
        }

    for r in filtered:
        a = agg.get(r["cid"])
        if a is None:
            continue
        a["qty"] += r["qty"]
        a["amt"] += r["amt"]
        a["gp"] += r["gp"]
        a["stockout"] += r.get("stockout", 0)
        if r.get("turnover_days") is not None:
            a["turnover_sum"] += r["turnover_days"]
            a["turnover_w"] += 1
        if r.get("space_eff") is not None:
            a["space_sum"] += r["space_eff"]
            a["space_w"] += 1
        if r.get("sku_count") is not None:
            a["sku_sum"] += r["sku_count"]
            a["sku_n"] += 1
        a["months"].append({
            "month": r["month"], "qty": r["qty"], "amt": r["amt"], "gp": r["gp"],
            "turnoverDays": r.get("turnover_days"),
            "spaceEff": r.get("space_eff"),
            "stockout": r.get("stockout", 0),
        })

    items: list[dict] = []
    for a in agg.values():
        # 顺序必须与前端一致：毛利率先用未取整的 amt/gp 计算，再对 amt/gp 取整
        a["grossMargin"] = rnd(a["gp"] / a["amt"] * 100, 2) if a["amt"] > 0 else 0
        a["turnoverDays"] = rnd(a["turnover_sum"] / a["turnover_w"], 1) if a["turnover_w"] else None
        a["spaceEff"] = rnd(a["space_sum"] / a["space_w"], 0) if a["space_w"] else None
        a["skuCount"] = round(a["sku_sum"] / a["sku_n"]) if a["sku_n"] else None
        a["amt"] = rnd(a["amt"], 0)
        a["gp"] = rnd(a["gp"], 0)
        if a["months"]:
            items.append(a)

    # 缺字段检测：绝不静默补值
    missing: list[str] = []
    for a in items:
        if a["turnoverDays"] is None:
            missing.append(f"{a['name']} 缺少「库存周转天数」")
        if a["spaceEff"] is None:
            missing.append(f"{a['name']} 缺少「坪效」")

    if not items:
        return {
            "ok": False, "insufficient": True,
            "reason": "当前数据不足以计算品类健康度：未找到任何品类销售记录。",
            "items": [],
        }

    qty_arr = [a["qty"] for a in items]
    gp_arr = [a["gp"] for a in items]
    td_arr = [a["turnoverDays"] if a["turnoverDays"] is not None else 0 for a in items]
    se_arr = [a["spaceEff"] if a["spaceEff"] is not None else 0 for a in items]

    total_qty = sum(qty_arr)
    total_gp = sum(gp_arr)

    for a in items:
        a["qtyShare"] = rnd(a["qty"] / total_qty * 100, 1) if total_qty else 0
        a["gpShare"] = rnd(a["gp"] / total_gp * 100, 1) if total_gp else 0

        a["qtyScore"] = rnd(_mix(norm_asc(qty_arr, a["qty"]), BASE["qty"](a["qtyShare"])), 1)
        a["gpScore"] = rnd(_mix(norm_asc(gp_arr, a["gp"]), BASE["gp"](a["gpShare"])), 1)
        a["turnoverScore"] = rnd(_mix(
            norm_desc(td_arr, a["turnoverDays"] if a["turnoverDays"] is not None else 0),
            BASE["turnover"](a["turnoverDays"]),
        ), 1)
        a["spaceScore"] = rnd(_mix(
            norm_asc(se_arr, a["spaceEff"] if a["spaceEff"] is not None else 0),
            BASE["space"](a["spaceEff"]),
        ), 1)

        a["score"] = rnd(
            a["qtyScore"] * w["qty"] + a["gpScore"] * w["gp"]
            + a["turnoverScore"] * w["turnover"] + a["spaceScore"] * w["space"], 1
        )

        s = stars_of(a["score"])
        a["stars"], a["grade"], a["lamp"], a["color"] = s["stars"], s["grade"], s["lamp"], s["color"]
        a["needOptimize"] = a["score"] < 55

        a["trend"] = compute_trend(a["months"], "qty")
        a["gpTrend"] = compute_trend(a["months"], "gp")
        a["turnoverTrend"] = compute_trend(a["months"], "turnoverDays")
        a["spaceTrend"] = compute_trend(a["months"], "spaceEff")

    items.sort(key=lambda x: -x["score"])
    for idx, a in enumerate(items):
        a["rank"] = idx + 1

    return {
        "ok": True,
        "insufficient": False,
        "weights": w,
        "weightsRaw": weights or DEFAULT_WEIGHTS,
        "months": use_months,
        "monthCount": len(use_months),
        "missingFields": missing,
        "sourceDatasetId": source_dataset_id,
        "algorithm": "CategoryHealthScore v1.1 (销量30%+毛利30%+周转20%+坪效20%)",
        "parameters": {
            "weights": w,
            "months": len(use_months),
            "turnoverNormalization": "reverse-minmax",
            "scoreComposition": "相对标准化60% + 行业基准40%",
            "industryBaseline": {
                "turnoverDays": "≤15天=100分, ≥90天=0分",
                "spaceEfficiency": "≥1200元/㎡/月=100分, ≤300元/㎡/月=0分",
                "qtyShare": "≥25%=100分, ≤4%=0分",
                "gpShare": "≥22%=100分, ≤8%=0分",
            },
        },
        "createdAt": datetime.now().isoformat(),
        "totalQty": total_qty,
        "totalAmt": rnd(sum(a["amt"] for a in items), 0),
        "totalGp": rnd(total_gp, 0),
        "items": items,
    }


# ==================== 模块 2：Apriori 购物篮分析 ====================

DEFAULT_APRIORI = {
    "min_support": 0.02,
    "min_confidence": 0.50,
    "min_lift": 1.50,
    "top_n": 20,
    "aggregate_by": "name",
}


def _strength_of(lift: float) -> dict[str, str]:
    if lift >= 3.0:
        return {"level": "极强", "color": "red"}
    if lift >= 2.5:
        return {"level": "强", "color": "orange"}
    if lift >= 2.0:
        return {"level": "中", "color": "yellow"}
    return {"level": "弱", "color": "gray"}


def _advice_of(name_a: str, name_b: str, cat_a: str, cat_b: str) -> str:
    """把关联规则翻译成人能读懂的陈列建议。"""
    s = name_a + name_b
    if re.search(r"牛奶|面包|鸡蛋|大米|食用油|酱油", s):
        scene = "早餐/家常烹饪场景"
    elif re.search(r"火锅|丸子|肥牛|底料|可乐", s):
        scene = "火锅聚餐场景"
    elif re.search(r"蛋糕|黄油|奶油|香草", s):
        scene = "烘焙场景"
    elif re.search(r"苹果|香蕉|橙子|黄瓜|土豆|胡萝卜", s):
        scene = "生鲜果蔬组合"
    elif re.search(r"洗发水|沐浴露|纸巾|洗衣", s):
        scene = "家庭日化补货场景"
    else:
        scene = "关联消费场景"
    if cat_a == cat_b:
        scene = f"{cat_a}品类内关联"
    tactic = "相邻货架纵向陈列" if cat_a == cat_b else "跨区就近陈列或端头联合促销"
    return f"{scene}：建议{tactic}。"


def _intersect_count(x: list[int], y: list[int]) -> int:
    """双指针求有序数组交集大小。比建集合更快且无哈希开销。"""
    i = j = c = 0
    while i < len(x) and j < len(y):
        if x[i] == y[j]:
            c += 1
            i += 1
            j += 1
        elif x[i] < y[j]:
            i += 1
        else:
            j += 1
    return c


def apriori(
    baskets: list[list[int]],
    products: list[str],
    product_cat: list[str],
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Apriori 关联规则挖掘，最大项集长度为 2。

    baskets 为交易列表，每个元素是该交易所含商品的下标数组；
    products 为商品名数组；product_cat 为对应的品类数组。
    """
    p = {**DEFAULT_APRIORI, **(params or {})}
    n = len(baskets)

    if not n:
        return {
            "ok": False, "insufficient": True,
            "reason": "当前数据不足以进行购物篮分析：交易明细为空。",
            "rules": [],
        }

    support_cnt = [0] * len(products)
    for b in baskets:
        for idx in b:
            support_cnt[idx] += 1

    min_cnt = math.ceil(p["min_support"] * n)

    freq1 = [k for k in range(len(products)) if support_cnt[k] >= min_cnt]
    if not freq1:
        return {
            "ok": True, "insufficient": False, "rules": [], "freqItems": [],
            "parameters": p, "basketCount": n,
            "message": f"在当前最小支持度 {p['min_support']} 下未发现频繁项集，请降低阈值后重算。",
            "algorithm": "Apriori v1.0", "createdAt": datetime.now().isoformat(),
        }

    # 为每个商品建交易索引，用双指针交集替代逐笔扫描
    idx_list: list[list[int]] = [[] for _ in products]
    for t, b in enumerate(baskets):
        for idx in b:
            idx_list[idx].append(t)

    pair_rules: list[dict] = []
    for a_i in range(len(freq1)):
        for b_i in range(a_i + 1, len(freq1)):
            A, B = freq1[a_i], freq1[b_i]
            cnt = _intersect_count(idx_list[A], idx_list[B])
            if cnt < min_cnt:
                continue
            sup = cnt / n

            conf_ab = cnt / support_cnt[A]
            conf_ba = cnt / support_cnt[B]
            sup_b = support_cnt[B] / n
            sup_a = support_cnt[A] / n
            lift_ab = conf_ab / sup_b if sup_b > 0 else 0.0
            lift_ba = conf_ba / sup_a if sup_a > 0 else 0.0

            if conf_ab >= p["min_confidence"] and lift_ab >= p["min_lift"]:
                pair_rules.append(_make_rule(
                    A, B, sup, conf_ab, lift_ab, cnt, products, product_cat))
            if conf_ba >= p["min_confidence"] and lift_ba >= p["min_lift"]:
                pair_rules.append(_make_rule(
                    B, A, sup, conf_ba, lift_ba, cnt, products, product_cat))

    pair_rules.sort(key=lambda r: (-r["lift"], -r["confidence"]))

    freq_items = sorted(
        ({"name": products[i], "support": rnd(support_cnt[i] / n, 4), "count": support_cnt[i]}
         for i in freq1),
        key=lambda x: -x["support"],
    )

    return {
        "ok": True,
        "insufficient": False,
        "rules": pair_rules,
        "topRules": pair_rules[: p["top_n"]],
        "freqItems": freq_items,
        "basketCount": n,
        "aggregateBy": p["aggregate_by"],
        "parameters": p,
        "algorithm": "Apriori v1.0 (按{}构建购物篮)".format(
            "交易号+商品名称" if p["aggregate_by"] == "name" else "商品编码"),
        "sourceDatasetId": "dataset_transactions_sample.csv",
        "createdAt": datetime.now().isoformat(),
    }


def _make_rule(A: int, B: int, support: float, confidence: float, lift: float,
               cnt: int, products: list[str], product_cat: list[str]) -> dict[str, Any]:
    return {
        "a": products[A],
        "b": products[B],
        "aCat": product_cat[A] if A < len(product_cat) else "",
        "bCat": product_cat[B] if B < len(product_cat) else "",
        "support": rnd(support, 4),
        "confidence": rnd(confidence, 4),
        "lift": rnd(lift, 3),
        "count": cnt,
        "strength": _strength_of(lift),
        "advice": _advice_of(
            products[A], products[B],
            product_cat[A] if A < len(product_cat) else "",
            product_cat[B] if B < len(product_cat) else "",
        ),
        "ruleset": "realtime",
    }


# ==================== 模块 3：需求趋势分析 ====================


def trend_level_of(delta: float) -> dict[str, str]:
    """趋势五级分级。"""
    if delta > 15:
        return {"label": "明显上涨", "color": "red", "icon": "up2"}
    if delta > 5:
        return {"label": "温和上涨", "color": "orange", "icon": "up"}
    if delta > -5:
        return {"label": "基本稳定", "color": "green", "icon": "flat"}
    if delta > -15:
        return {"label": "温和下降", "color": "lime", "icon": "down"}
    return {"label": "明显下降", "color": "teal", "icon": "down2"}


def analyze_forecast(forecast_list: list[dict], cat_name: str) -> dict[str, Any]:
    """比较「最近 4 期实际」与「未来 4 期预测」，给出环比与趋势分级。

    forecast_list 每项：{"cat": 品类名, "points": [{"week","label","hist","fc","lo","hi","type"}]}
    """
    f = next((x for x in forecast_list if x["cat"] == cat_name), None)
    if f is None:
        avail = [x["cat"] for x in forecast_list]
        return {
            "ok": False, "insufficient": True,
            "reason": f"当前数据不包含品类「{cat_name}」的需求预测结果。"
                      f"现有预测数据仅覆盖：{'、'.join(avail)}。",
        }

    points = f["points"]
    hist = [p for p in points if p["type"] == "历史数据"]
    fcst = [p for p in points if p["type"] == "预测数据"]
    last4 = hist[-4:]
    next4 = fcst[:4]

    if not last4 or not next4:
        return {
            "ok": False, "insufficient": True,
            "reason": f"历史数据量有限（该品类仅 {len(hist)} 期历史、{len(fcst)} 期预测），"
                      f"预测结果仅供趋势参考，无法计算环比。",
            "points": points, "historyCount": len(hist), "forecastCount": len(fcst),
        }

    hist_avg = sum((p["hist"] or 0) for p in last4) / len(last4)
    fc_avg = sum((p["fc"] or 0) for p in next4) / len(next4)
    delta = (fc_avg - hist_avg) / hist_avg * 100 if hist_avg else 0.0
    level = trend_level_of(delta)

    if delta > 10:
        risk = {"level": "补货压力上升", "color": "orange"}
    elif delta < -10:
        risk = {"level": "库存积压风险", "color": "orange"}
    else:
        risk = {"level": "需求平稳", "color": "green"}

    return {
        "ok": True, "insufficient": False, "cat": cat_name,
        "points": points, "history": hist, "forecast": fcst,
        "historyCount": len(hist), "forecastCount": len(fcst),
        "last4Avg": rnd(hist_avg, 1), "next4Avg": rnd(fc_avg, 1),
        "delta": rnd(delta, 1),
        "level": level,
        "risk": risk,
        "ciWidth": rnd(sum(((p["hi"] or 0) - (p["lo"] or 0)) for p in next4) / len(next4), 1),
        "sourceDatasetId": "dataset_demand_forecast.csv",
        "algorithm": "TrendAnalysis v1.0 (最近4期实际 vs 未来4期预测)",
        "createdAt": datetime.now().isoformat(),
        "dataNature": "模拟预测结果",
    }


# ==================== 模块 4：选品比较综合评分 ====================

DEFAULT_COMPARE_WEIGHTS = {"sales": 0.30, "margin": 0.30, "turnover": 0.20, "space": 0.20}


def verdict_of(score: float) -> dict[str, str]:
    if score >= 80:
        return {"key": "expand", "label": "建议扩充", "color": "green"}
    if score >= 65:
        return {"key": "keep", "label": "推荐保留", "color": "lime"}
    if score >= 50:
        return {"key": "watch", "label": "建议观察", "color": "yellow"}
    if score >= 35:
        return {"key": "trim", "label": "建议精简", "color": "orange"}
    return {"key": "exit", "label": "建议退出", "color": "red"}


def compare_candidates(
    candidates: Sequence[str],
    sales: list[dict],
    categories: list[dict],
    forecast_list: list[dict],
    baskets: list[list[int]],
    products: list[str],
    product_cat: list[str],
    weights: dict[str, float] | None = None,
    health_weights: dict[str, float] | None = None,
    mode: str = "category",
) -> dict[str, Any]:
    """比较若干候选对象，输出六维综合评分与排名。

    mode='sku' 时明确拒答：现有数据集为品类级，缺少 SKU 级经营指标，
    不伪造量化结果。
    """
    w = normalize_weights(weights or DEFAULT_COMPARE_WEIGHTS)

    if mode == "sku":
        return {
            "ok": False, "insufficient": True,
            "reason": "当前数据不足以进行完整 SKU 量化评价。平台现有数据集为品类级月度销售"
                      "与交易明细，缺少 SKU 级的采购价、零售价、毛利率、货架占用等经营指标。"
                      "请在「数据中心」上传 SKU 候选商品数据后重试。",
            "uploadTemplate": "sku_candidate_template.csv",
        }

    if not candidates or len(candidates) < 2:
        return {"ok": False, "insufficient": True,
                "reason": "请至少选择 2 个比较对象（最多 6 个）。"}
    if len(candidates) > 6:
        return {"ok": False, "insufficient": True, "reason": "一次最多比较 6 个对象。"}

    health = compute_category_health(sales, categories, weights=health_weights)
    if not health["ok"]:
        return health

    by_id = {h["cid"]: h for h in health["items"]}
    items: list[dict] = []
    missing: list[str] = []

    for cid in candidates:
        h = by_id.get(cid)
        if h is None:
            missing.append(cid)
            continue
        fc = analyze_forecast(forecast_list, h["name"])
        items.append({
            "cid": h["cid"], "name": h["name"],
            "score": h["score"], "stars": h["stars"], "grade": h["grade"], "color": h["color"],
            "qty": h["qty"], "amt": h["amt"], "gp": h["gp"],
            "grossMargin": rnd(h["grossMargin"], 2),
            "turnoverDays": h["turnoverDays"], "spaceEff": h["spaceEff"],
            "stockout": h["stockout"], "skuCount": h["skuCount"],
            "qtyScore": rnd(h["qtyScore"], 1), "gpScore": rnd(h["gpScore"], 1),
            "turnoverScore": rnd(h["turnoverScore"], 1), "spaceScore": rnd(h["spaceScore"], 1),
            "healthScore": h["score"],
            "forecastLevel": fc["level"]["label"] if fc["ok"] else "无预测数据",
            "forecastDelta": fc["delta"] if fc["ok"] else None,
            "forecastAvailable": fc["ok"],
        })

    if len(items) < 2:
        return {"ok": False, "insufficient": True,
                "reason": f"有效比较对象不足 2 个。未找到：{'、'.join(missing)}"}

    qty_arr = [x["qty"] for x in items]
    gp_arr = [x["gp"] for x in items]
    td_arr = [x["turnoverDays"] or 0 for x in items]
    se_arr = [x["spaceEff"] or 0 for x in items]

    for x in items:
        s = (norm_asc(qty_arr, x["qty"]) * w["sales"]
             + norm_asc(gp_arr, x["gp"]) * w["margin"]
             + norm_desc(td_arr, x["turnoverDays"] or 0) * w["turnover"]
             + norm_asc(se_arr, x["spaceEff"] or 0) * w["space"])
        x["composite"] = rnd(s, 1)
        x["gmVerdict"] = verdict_of(s)

    # 关联购买能力：统计该品类商品在规则中出现次数
    assoc = apriori(baskets, products, product_cat, {})
    assoc_count: dict[str, int] = {}
    for r in assoc.get("rules", []):
        for c in (r["aCat"], r["bCat"]):
            assoc_count[c] = assoc_count.get(c, 0) + 1
    for x in items:
        x["assocPower"] = assoc_count.get(x["name"], 0)

    items.sort(key=lambda x: -x["composite"])
    for i, x in enumerate(items):
        x["rank"] = i + 1
        x["priority"] = ["A", "B", "C", "D", "E", "F"][i]

    return {
        "ok": True, "insufficient": False, "mode": mode, "items": items,
        "weights": w, "weightsRaw": weights or DEFAULT_COMPARE_WEIGHTS,
        "monthCount": health["monthCount"],
        "sourceDatasetId": health["sourceDatasetId"],
        "algorithm": "AssortmentCompare v1.0 (销量30%+毛利30%+周转20%+坪效20%)",
        "parameters": {"weights": w, "months": health["monthCount"]},
        "createdAt": datetime.now().isoformat(),
    }


# ==================== 模块 5：AI 综合选品方案 ====================


def build_assortment_plan(
    sales: list[dict],
    categories: list[dict],
    forecast_list: list[dict],
    baskets: list[list[int]],
    products: list[str],
    product_cat: list[str],
    weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    """按健康度 + 趋势 + 关联能力，把品类分入五个处置桶。"""
    health = compute_category_health(sales, categories, weights=weights)
    if not health["ok"]:
        return health

    assoc = apriori(baskets, products, product_cat, {})
    assoc_count: dict[str, int] = {}
    for r in assoc.get("rules", []):
        for c in (r["aCat"], r["bCat"]):
            assoc_count[c] = assoc_count.get(c, 0) + 1

    buckets: dict[str, list] = {"expand": [], "keep": [], "watch": [], "trim": [], "exit": []}

    for h in health["items"]:
        fc = analyze_forecast(forecast_list, h["name"])
        delta = fc["delta"] if fc["ok"] else None
        v = verdict_of(h["score"])

        reasons = [
            f"健康度 {h['score']} 分（{h['grade']}，{h['stars']}），"
            f"排名第 {h['rank']}/{len(health['items'])}",
            f"销量贡献 {h['qtyShare']}%，毛利贡献 {h['gpShare']}%，"
            f"毛利率 {rnd(h['grossMargin'], 1)}%",
            f"库存周转 {h['turnoverDays']} 天，坪效 {h['spaceEff']} 元/㎡/月，"
            f"缺货 {h['stockout']} 次/12月",
        ]
        if delta is not None:
            reasons.append(f"未来 4 期需求预测{fc['level']['label']}"
                           f"（环比 {'+' if delta > 0 else ''}{delta}%）")
        if assoc_count.get(h["name"]):
            reasons.append(f"参与 {assoc_count[h['name']]} 条强关联规则，具备场景化陈列价值")

        risks = []
        if h["turnoverDays"] is not None and h["turnoverDays"] > 45:
            risks.append(f"周转天数偏高（{h['turnoverDays']} 天），存在资金占用压力")
        if h["stockout"] >= 4:
            risks.append(f"近 12 个月缺货 {h['stockout']} 次，热销商品缺货风险")
        if h["grossMargin"] < 18:
            risks.append(f"毛利率仅 {rnd(h['grossMargin'], 1)}%，低于品类健康线")
        if delta is not None and delta < -10:
            risks.append(f"需求呈下降趋势（{delta}%），存在积压风险")
        if not risks:
            risks.append("未识别到显著风险项")

        buckets[v["key"]].append({
            "cid": h["cid"], "name": h["name"], "score": h["score"],
            "grade": h["grade"], "stars": h["stars"],
            "verdict": v["label"], "color": v["color"],
            "reasons": reasons, "risks": risks,
            "delta": delta,
            "assocPower": assoc_count.get(h["name"], 0),
            "turnoverDays": h["turnoverDays"],
            "grossMargin": rnd(h["grossMargin"], 2),
            "qtyShare": h["qtyShare"], "gpShare": h["gpShare"],
            "needApproval": v["key"] in ("exit", "trim"),
        })

    return {
        "ok": True, "insufficient": False,
        "buckets": buckets,
        "counts": {k: len(v) for k, v in buckets.items()},
        "algorithm": "AIAssortmentPlan v1.0",
        "parameters": {"weights": health["weights"], "sourceMonths": health["monthCount"]},
        "sourceDatasetId": "dataset_category_sales.csv + dataset_transactions_sample.csv "
                           "+ dataset_demand_forecast.csv",
        "createdAt": datetime.now().isoformat(),
        "disclaimer": "本方案由平台算法基于模拟演示数据综合生成，AI 建议仅供辅助决策，"
                      "最终选品由采购人员确认。",
    }


# ==================== 模块 6：驾驶舱 KPI 与风险预警 ====================


def build_dashboard(
    sales: list[dict],
    categories: list[dict],
    forecast_list: list[dict],
    baskets: list[list[int]],
    products: list[str],
    product_cat: list[str],
    store_name: str = "",
    weights: dict[str, float] | None = None,
    pending_approval_count: int = 0,
) -> dict[str, Any]:
    """驾驶舱 KPI 与风险预警。

    pending_approval_count 属于应用层状态，不在算法层可访问范围内，
    由调用方注入 —— 保证算法层是纯函数，不读取任何外部可变状态。
    """
    health = compute_category_health(sales, categories, weights=weights)
    if not health["ok"]:
        return health
    assoc = apriori(baskets, products, product_cat, {})

    latest_month = health["months"][-1]
    month_stockout = sum(r.get("stockout", 0) for r in sales if r["month"] == latest_month)

    # 平均库存周转天数：按销售额加权
    t_num = t_den = 0.0
    for h in health["items"]:
        if h["turnoverDays"] is not None:
            t_num += h["turnoverDays"] * h["amt"]
            t_den += h["amt"]
    avg_turnover = t_num / t_den if t_den else None

    high_value_rules = [r for r in assoc.get("rules", []) if r["lift"] >= 2.0]

    up_cats, down_cats = [], []
    for f in forecast_list:
        a = analyze_forecast(forecast_list, f["cat"])
        if a["ok"]:
            if a["delta"] > 5:
                up_cats.append({"cat": f["cat"], "delta": a["delta"], "level": a["level"]["label"]})
            if a["delta"] < -5:
                down_cats.append({"cat": f["cat"], "delta": a["delta"], "level": a["level"]["label"]})

    healthy_cats = [h for h in health["items"] if h["score"] >= 70]
    risk_cats = [h for h in health["items"] if h["score"] < 55]

    kpis = [
        {"key": "categoryTotal", "label": "品类总数", "value": len(health["items"]), "unit": "个",
         "tone": "neutral",
         "sub": f"覆盖生鲜/食品/日化/家居等 {len(health['items'])} 个一级品类"},
        {"key": "categoryHealthy", "label": "健康品类数量", "value": len(healthy_cats), "unit": "个",
         "tone": "good", "sub": "健康度 ≥ 70 分（四星及以上）"},
        {"key": "categoryRisk", "label": "风险品类数量", "value": len(risk_cats), "unit": "个",
         "tone": "bad",
         "sub": ("、".join(h["name"] for h in risk_cats) + " 低于 55 分") if risk_cats else "暂无风险品类"},
        {"key": "stockout", "label": "本月缺货次数", "value": month_stockout, "unit": "次",
         "tone": "warn" if month_stockout > 10 else "neutral",
         "sub": f"统计月份 {latest_month}（模拟演示数据）"},
        {"key": "turnover", "label": "平均库存周转天数",
         "value": "—" if avg_turnover is None else rnd(avg_turnover, 1), "unit": "天",
         "tone": "warn" if (avg_turnover or 0) > 30 else "good", "sub": "按销售额加权平均"},
        {"key": "assoc", "label": "高价值关联组合数量", "value": len(high_value_rules), "unit": "组",
         "tone": "neutral", "sub": "提升度 ≥ 2.0 的关联规则"},
        {"key": "demandUp", "label": "未来需求上涨品类数", "value": len(up_cats), "unit": "个",
         "tone": "good" if up_cats else "neutral",
         "sub": "、".join(f"{c['cat']}(+{c['delta']}%)" for c in up_cats) if up_cats else "暂无上涨品类"},
        {"key": "pendingApproval", "label": "待人工审批建议数量", "value": pending_approval_count,
         "unit": "条", "tone": "warn" if pending_approval_count > 0 else "good",
         "sub": "Level 3 高影响建议需人工审批"},
    ]

    warnings: list[dict] = []
    for h in health["items"]:
        if h["turnoverDays"] is not None and h["turnoverDays"] > 45:
            warnings.append({
                "level": "high" if h["turnoverDays"] > 60 else "medium",
                "type": "高库存周转天数", "cat": h["name"],
                "detail": f"库存周转 {h['turnoverDays']} 天，高于健康线 45 天，资金占用压力大",
                "metric": h["turnoverDays"], "threshold": 45,
                "advice": "压缩 SKU 宽度，聚焦高频核心品",
            })
        if h["spaceEff"] is not None and h["spaceEff"] < 400:
            warnings.append({
                "level": "high" if h["spaceEff"] < 300 else "medium",
                "type": "低坪效", "cat": h["name"],
                "detail": f"坪效 {h['spaceEff']} 元/㎡/月，低于全店加权均值",
                "metric": h["spaceEff"], "threshold": 400,
                "advice": "缩减陈列面积或调整货架位置",
            })
        if h["stockout"] >= 4:
            warnings.append({
                "level": "high" if h["stockout"] >= 6 else "medium",
                "type": "缺货频繁", "cat": h["name"],
                "detail": f"近 {health['monthCount']} 个月累计缺货 {h['stockout']} 次",
                "metric": h["stockout"], "threshold": 4,
                "advice": "核查补货周期与安全库存设置",
            })
        if h["score"] < 55:
            warnings.append({
                "level": "high" if h["score"] < 45 else "medium",
                "type": "健康度低于三星", "cat": h["name"],
                "detail": f"综合健康度 {h['score']} 分（{h['grade']}），低于三星阈值 55 分",
                "metric": h["score"], "threshold": 55,
                "advice": "纳入重点优化清单，制定退出或整改方案",
            })

    for c in up_cats:
        if c["delta"] > 10:
            warnings.append({
                "level": "medium", "type": "预测需求快速上涨", "cat": c["cat"],
                "detail": f"未来 4 期需求预测环比 +{c['delta']}%（{c['level']}）",
                "metric": c["delta"], "threshold": 10, "advice": "提前备货并核查供应商产能",
            })
    for c in down_cats:
        if c["delta"] < -10:
            warnings.append({
                "level": "medium", "type": "预测需求快速下跌", "cat": c["cat"],
                "detail": f"未来 4 期需求预测环比 {c['delta']}%（{c['level']}）",
                "metric": c["delta"], "threshold": -10, "advice": "控制订货量，避免形成呆滞库存",
            })

    order = {"high": 0, "medium": 1, "low": 2}
    warnings.sort(key=lambda x: order.get(x["level"], 3))

    return {
        "ok": True, "insufficient": False,
        "store": store_name,
        "health": health, "assoc": assoc,
        "kpis": kpis, "warnings": warnings,
        "upCats": up_cats, "downCats": down_cats,
        "latestMonth": latest_month,
        "avgTurnover": None if avg_turnover is None else rnd(avg_turnover, 1),
        "generatedAt": datetime.now().isoformat(),
    }


# ==================== 模块 7：数据质量检查 ====================

QUALITY_CHECKERS: dict[str, dict] = {
    "category_sales": {
        "label": "品类销售数据",
        "required": ["品类ID", "品类名称", "月份", "销量(件)", "销售额(元)", "毛利额(元)",
                     "库存周转天数", "坪效(元/㎡/月)", "缺货次数", "SKU数量"],
        "key": ["品类ID", "月份"],
        "numeric": ["销量(件)", "销售额(元)", "毛利额(元)", "库存周转天数",
                    "坪效(元/㎡/月)", "缺货次数", "SKU数量"],
        "date": "月份",
    },
    "transactions": {
        "label": "交易明细数据",
        "required": ["交易号", "商品编码", "商品名称", "品类", "数量", "交易日期", "单价(元)"],
        "key": ["交易号", "商品编码"],
        "numeric": ["数量", "单价(元)"],
        "date": "交易日期",
    },
    "demand_history": {
        "label": "需求历史数据",
        "required": ["品类", "周次", "日期", "历史销量(件)"],
        "key": ["品类", "周次"],
        "numeric": ["历史销量(件)"],
        "date": "日期",
    },
    "association_rules": {
        "label": "关联规则结果",
        "required": ["规则ID", "前项商品(A)", "后项商品(B)", "支持度", "置信度", "提升度"],
        "key": ["规则ID"],
        "numeric": ["支持度", "置信度", "提升度"],
    },
    "category_health": {
        "label": "品类健康度结果",
        "required": ["品类ID", "品类名称", "综合评分", "健康度等级", "评级"],
        "key": ["品类ID"],
        "numeric": ["综合评分"],
    },
    "sku_candidate": {
        "label": "SKU 候选商品数据",
        "required": ["SKU", "商品名称", "品类", "采购价", "零售价"],
        "key": ["SKU"],
        "numeric": ["采购价", "零售价"],
    },
    "store_profile": {
        "label": "门店画像数据",
        "required": ["门店名称", "商圈"],
        "key": ["门店名称"],
        "numeric": [],
    },
}

_RANGE_RULES = {
    "支持度": (0, 1), "置信度": (0, 1),
    "综合评分": (0, 100), "销量(件)": (0, float("inf")), "销售额(元)": (0, float("inf")),
    "库存周转天数": (0, 3650), "缺货次数": (0, 10000),
}


def run_quality_check(dataset_type: str, rows: list[dict]) -> dict[str, Any]:
    """对内存中的数据集执行 9 类检查，输出五维评分。

    平台只诊断问题并给出建议，不会静默修改任何原始数据。
    """
    spec = QUALITY_CHECKERS.get(dataset_type)
    if spec is None:
        return {"ok": False, "insufficient": True,
                "reason": f"未知数据集类型：{dataset_type}。"
                          f"支持的类型：{'、'.join(QUALITY_CHECKERS.keys())}"}
    if not rows:
        return {"ok": False, "insufficient": True,
                "reason": "文件内容为空，无法执行数据质量检查。"}

    headers = list(rows[0].keys())
    issues: list[dict] = []
    n = len(rows)

    # 1. 必填字段检查
    missing_cols = [c for c in spec["required"] if c not in headers]
    if missing_cols:
        # 必需字段缺失时，该文件无法用于其声明的用途。按「可信优先」原则直接拒答，
        # 不输出五维评分与等级 —— 否则会出现「一个必填字段都没有、却评 90+ 分」的
        # 误导性结论，与平台自身的可信性原则冲突（详见报告 4.4.5 节）。
        return {
            "ok": False, "insufficient": True,
            "type": dataset_type, "label": spec["label"],
            "fileName": f"{dataset_type}.csv",
            "rowCount": n, "colCount": len(headers), "headers": headers,
            "missingColumns": missing_cols,
            "issues": [{
                "dim": "一致性", "severity": "high", "field": "、".join(missing_cols),
                "count": len(missing_cols),
                "desc": f"缺少必需字段：{'、'.join(missing_cols)}",
                "suggestion": "请补全字段后重新上传，或调整列名与模板一致",
            }],
            "reason": (f"缺少必需字段：{'、'.join(missing_cols)}。"
                       f"「{spec['label']}」需要这些字段才能完成质量评估，"
                       f"当前文件有 {len(headers)} 列、{n} 行，但列名与模板不符，"
                       f"故不给出评分。请从数据中心下载模板核对列名后重新上传。"),
            "checks": ["字段映射", "字段类型检查", "空值检查", "重复值检查", "异常值检查",
                       "日期范围检查", "主键检查", "数值范围检查", "时效性评估"],
            "algorithm": "DataQualityCheck v1.0",
            "createdAt": datetime.now().isoformat(),
            "note": "平台仅诊断问题并给出建议，不会静默修改任何原始数据。",
        }

    # 2. 空值检查
    null_fields: dict[str, int] = {}
    for r in rows:
        for h in headers:
            v = r.get(h)
            if v is None or str(v).strip() == "":
                null_fields[h] = null_fields.get(h, 0) + 1
    for h, c in null_fields.items():
        if c > 0:
            is_req = h in spec["required"]
            issues.append({
                "dim": "完整性", "severity": "high" if is_req else "low",
                "field": h, "count": c,
                "desc": f"字段「{h}」存在 {c} 个空值（占 {rnd(c / n * 100, 1)}%）",
                "suggestion": ("必需字段不允许为空，建议人工确认后补充或剔除该行"
                               if is_req else "非必需字段，可选择保留空值或按业务规则填充"),
            })

    # 3. 字段类型检查
    for h in spec["numeric"]:
        if h not in headers:
            continue
        bad = 0
        for r in rows:
            v = str(r.get(h) if r.get(h) is not None else "").strip()
            if v != "":
                try:
                    float(v)
                except ValueError:
                    bad += 1
        if bad:
            issues.append({
                "dim": "有效性", "severity": "high", "field": h, "count": bad,
                "desc": f"数值字段「{h}」存在 {bad} 个非数值内容",
                "suggestion": "请清理单位符号或全角字符后重新上传",
            })

    # 4. 主键重复检查
    if spec.get("key"):
        seen: set[str] = set()
        dup_count = 0
        dup_samples: list[str] = []
        for r in rows:
            k = "|".join(str(r.get(c)) for c in spec["key"])
            if k in seen:
                dup_count += 1
                if len(dup_samples) < 3:
                    dup_samples.append(k)
            seen.add(k)
        if dup_count:
            issues.append({
                "dim": "唯一性", "severity": "medium", "field": " + ".join(spec["key"]),
                "count": dup_count,
                "desc": f"主键组合存在 {dup_count} 条重复记录（示例：{'；'.join(dup_samples)}）",
                "suggestion": "请确认是否为正常业务重复；如需去重可选择「自动清洗」",
            })

    # 5. 异常值检查（3σ）
    for h in spec["numeric"]:
        if h not in headers:
            continue
        vals = []
        for r in rows:
            try:
                vals.append(float(r.get(h)))
            except (TypeError, ValueError):
                pass
        if len(vals) < 5:
            continue
        mean = sum(vals) / len(vals)
        sd = math.sqrt(sum((v - mean) ** 2 for v in vals) / len(vals))
        if sd == 0:
            continue
        outliers = [v for v in vals if abs(v - mean) > 3 * sd]
        if outliers:
            issues.append({
                "dim": "有效性", "severity": "medium", "field": h, "count": len(outliers),
                "desc": f"字段「{h}」检测到 {len(outliers)} 个离群值（3σ 法，"
                        f"均值 {rnd(mean, 1)}，标准差 {rnd(sd, 1)}）",
                "suggestion": "请核实是否为录入错误；平台不会自动修改原始值",
            })

    # 6. 数值范围检查
    for h in spec["numeric"]:
        rule = _RANGE_RULES.get(h)
        if not rule or h not in headers:
            continue
        bad = 0
        for r in rows:
            try:
                v = float(r.get(h))
            except (TypeError, ValueError):
                continue
            if v < rule[0] or v > rule[1]:
                bad += 1
        if bad:
            hi = "∞" if rule[1] == float("inf") else rule[1]
            issues.append({
                "dim": "有效性", "severity": "high", "field": h, "count": bad,
                "desc": f"字段「{h}」存在 {bad} 个超出合理范围 [{rule[0]}, {hi}] 的值",
                "suggestion": "请核实数据口径，单位是否与模板一致",
            })

    # 7. 日期格式与时效性
    date_col = spec.get("date")
    if date_col and date_col in headers:
        dvals = [str(r.get(date_col) or "").strip() for r in rows]
        dvals = [v for v in dvals if v]
        if dvals:
            # 接受 年 / 年-月 / 年-月-日 / ISO 周「2026-W01」/ 简写周「2026W01」
            invalid = sum(
                1 for v in dvals
                if not re.match(r"^\d{4}(-\d{2}-\d{2}|-\d{2}|-W\d{2}|W\d{2})?$", v)
            )
            if invalid:
                issues.append({
                    "dim": "有效性", "severity": "medium", "field": date_col, "count": invalid,
                    "desc": f"日期字段「{date_col}」存在 {invalid} 个无法识别的格式",
                    "suggestion": "建议统一为 YYYY-MM、YYYY-MM-DD 或 ISO 周格式 YYYY-Www",
                })
            s = sorted(dvals)
            issues.append({
                "dim": "时效性", "severity": "low", "field": date_col, "count": len(dvals),
                "desc": f"日期范围：{s[0]} ~ {s[-1]}，共 {len(dvals)} 个时间点",
                "suggestion": "供时效性评估参考",
            })

    # ---- 五维评分 ----
    penalty_map = {"high": 20, "medium": 8, "low": 2}

    def dim_score(dim: str) -> float:
        penalty = sum(penalty_map.get(x["severity"], 2) for x in issues if x["dim"] == dim)
        return max(0.0, min(100.0, 100 - penalty))

    dims = {
        "completeness": dim_score("完整性"),
        "consistency": dim_score("一致性"),
        "validity": dim_score("有效性"),
        "uniqueness": dim_score("唯一性"),
        "timeliness": dim_score("时效性"),
    }
    overall = rnd(
        dims["completeness"] * 0.3 + dims["consistency"] * 0.25 + dims["validity"] * 0.25
        + dims["uniqueness"] * 0.1 + dims["timeliness"] * 0.1, 1)

    return {
        "ok": True, "insufficient": False,
        "type": dataset_type, "label": spec["label"], "fileName": f"{dataset_type}.csv",
        "rowCount": n, "colCount": len(headers),
        "headers": headers, "missingColumns": missing_cols,
        "issues": issues, "dims": dims, "overall": overall,
        "grade": "优" if overall >= 90 else "良" if overall >= 75 else "中" if overall >= 60 else "差",
        "checks": ["字段映射", "字段类型检查", "空值检查", "重复值检查", "异常值检查",
                   "日期范围检查", "主键检查", "数值范围检查", "时效性评估"],
        "algorithm": "DataQualityCheck v1.0",
        "createdAt": datetime.now().isoformat(),
        "note": "平台仅诊断问题并给出建议，不会静默修改任何原始数据。",
    }


def build_baskets(
    items: Iterable[dict], aggregate_by: str = "name"
) -> tuple[list[list[int]], list[str], list[str]]:
    """把交易明细聚合成购物篮。

    items 每项：{"txn_no", "sku_code", "product_name", "category_name"}

    aggregate_by='name'（默认）按「交易号 + 商品名称」建篮。
    原因：演示数据中 70 个商品名对应 5000+ 个 SKU 编码，一名多码极严重；
    按编码聚合会把同一商品拆成数百个稀疏项，支持度被稀释到产不出任何规则。
    """
    baskets: dict[str, set] = {}
    name_to_idx: dict[str, int] = {}
    products: list[str] = []
    product_cat: list[str] = []

    for it in items:
        key = it["product_name"] if aggregate_by == "name" else it["sku_code"]
        if key not in name_to_idx:
            name_to_idx[key] = len(products)
            products.append(it["product_name"] if aggregate_by == "name" else it["sku_code"])
            product_cat.append(it.get("category_name") or "")
        baskets.setdefault(it["txn_no"], set()).add(name_to_idx[key])

    ordered = [sorted(v) for v in baskets.values()]
    return ordered, products, product_cat
