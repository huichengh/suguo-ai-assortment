"""苏果智选 · 算法分析接口。

所有接口都做三件事：
  1. 从数据库装配数据集（services.dataset）
  2. 调用纯函数算法层（services.algorithms）
  3. 把「来源数据集 / 算法名称 / 参数 / 生成时间」写进 analysis_runs 并可随响应返回

数据不足时算法层返回 insufficient，接口原样透传（HTTP 200 + ok=false），
由前端渲染为明确提示 —— 不抛假结果，也不伪装成服务错误。
"""

from __future__ import annotations

import json
import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.db.base import get_db
from app.db.models import (
    AnalysisRun,
    ApprovalRequest,
    Category,
    CategoryHealth,
    Store,
    User,
)
from app.schemas import (
    AnalysisRunOut,
    AprioriRequest,
    CompareRequest,
    HealthComputeRequest,
    QualityCheckRequest,
)
from app.services import dataset as ds
from app.services import algorithms as algo

router = APIRouter(prefix="/analysis", tags=["算法分析"])


def _record_run(
    db: Session,
    run_type: str,
    params: dict,
    input_rows: int,
    output_rows: int,
    duration_ms: int,
    status_text: str,
    message: str | None,
    operator: str | None,
) -> None:
    """把每次算法调用落库，保证结论可追溯。"""
    db.add(AnalysisRun(
        run_type=run_type,
        params_json=json.dumps(params, ensure_ascii=False),
        input_rows=input_rows,
        output_rows=output_rows,
        duration_ms=duration_ms,
        status=status_text,
        message=message,
        created_by=operator,
    ))
    db.commit()


def _resolve_weights(payload_weights: dict | None) -> dict | None:
    """校验权重：必须是 qty/gp/turnover/space 四项且非负。"""
    if payload_weights is None:
        return None
    allowed = {"qty", "gp", "turnover", "space"}
    unknown = set(payload_weights) - allowed
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"权重字段不被识别：{'、'.join(sorted(unknown))}。"
                   f"可用字段：{'、'.join(sorted(allowed))}",
        )
    if any(float(v) < 0 for v in payload_weights.values()):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="权重不能为负数。")
    return payload_weights


# ============================ 驾驶舱 ============================


@router.get("/dashboard", summary="AI 经营驾驶舱（8 个 KPI + 风险预警）")
def dashboard(
    store_id: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    t0 = time.perf_counter()
    sales = ds.load_sales(db, store_id)
    categories = ds.load_categories(db)
    forecast = ds.load_forecast(db)
    baskets, products, product_cat = ds.load_baskets(db)
    store = db.get(Store, store_id) if store_id else db.query(Store).first()

    # 待审批数量属于应用层状态，注入给算法层，保证算法层仍是纯函数
    pending = db.query(ApprovalRequest).filter(ApprovalRequest.status == "待审批").count()

    result = algo.build_dashboard(
        sales, categories, forecast, baskets, products, product_cat,
        store_name=store.name if store else "",
        pending_approval_count=pending,
    )
    duration = int((time.perf_counter() - t0) * 1000)
    _record_run(db, "dashboard", {"store_id": store_id}, len(sales),
                len(result.get("kpis", [])), duration,
                "成功" if result.get("ok") else "数据不足",
                result.get("reason"), user.username)
    return result


# ============================ 品类健康度 ============================


@router.post("/health", summary="品类健康度评分（四维加权）")
def health(
    payload: HealthComputeRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    t0 = time.perf_counter()
    weights = _resolve_weights(payload.weights)
    sales = ds.load_sales(db, payload.store_id)
    categories = ds.load_categories(db)

    result = algo.compute_category_health(
        sales, categories, weights=weights, months=payload.months)
    duration = int((time.perf_counter() - t0) * 1000)
    _record_run(db, "category_health", {"weights": weights, "months": payload.months},
                len(sales), len(result.get("items", [])), duration,
                "成功" if result.get("ok") else "数据不足",
                result.get("reason"), user.username)

    # 补上品类编码与名称，便于前端直接渲染
    if result.get("ok"):
        code_map = {c["id"]: c["code"] for c in categories}
        for item in result["items"]:
            item["code"] = code_map.get(item["cid"])
        result["missingFields"] = result.get("missingFields", [])
    return result


@router.get("/health/reference", summary="品类健康度附件参考结果（双轨对照用）")
def health_reference(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """附件参考结果原样保留，作为算法正确性的对照基准，不参与重算。"""
    rows = db.query(CategoryHealth).filter(CategoryHealth.source == "附件参考") \
        .order_by(CategoryHealth.score.desc()).all()
    cat_map = {c.id: c for c in db.query(Category).all()}
    return {
        "ok": True,
        "source": "dataset_category_health.csv",
        "note": "附件参考结果原样保留，不随参数调整而变化；与实时重算结果的差异在诊断页透明展示。",
        "items": [
            {
                "categoryId": r.category_id,
                "code": cat_map[r.category_id].code if r.category_id in cat_map else None,
                "name": cat_map[r.category_id].name if r.category_id in cat_map else None,
                "score": r.score,
                "stars": r.star_level,
                "rating": r.rating,
                "qtyShare": r.qty_share,
                "gpShare": r.gp_share,
                "turnoverDays": r.turnover_days,
                "spaceScore": r.space_score,
                "advice": r.advice,
                "alertLight": r.alert_light,
            }
            for r in rows
        ],
    }


# ============================ 关联分析 ============================


@router.post("/apriori", summary="Apriori 购物篮关联规则挖掘")
def apriori(
    payload: AprioriRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    t0 = time.perf_counter()
    baskets, products, product_cat = ds.load_baskets(db, aggregate_by=payload.aggregate_by)

    result = algo.apriori(baskets, products, product_cat, {
        "min_support": payload.min_support,
        "min_confidence": payload.min_confidence,
        "min_lift": payload.min_lift,
        "top_n": payload.top_n,
        "aggregate_by": payload.aggregate_by,
    })
    duration = int((time.perf_counter() - t0) * 1000)
    _record_run(db, "apriori", payload.model_dump(), len(baskets),
                len(result.get("rules", [])), duration,
                "成功" if result.get("ok") else "数据不足",
                result.get("message") or result.get("reason"), user.username)
    return result


# ============================ 需求趋势 ============================


@router.get("/trend/{category_id}", summary="品类需求趋势分析（最近4期 vs 未来4期）")
def trend(
    category_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    t0 = time.perf_counter()
    cat = db.get(Category, category_id)
    if cat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="品类不存在。")

    forecast = ds.load_forecast(db)
    result = algo.analyze_forecast(forecast, cat.name)
    duration = int((time.perf_counter() - t0) * 1000)
    _record_run(db, "trend", {"category_id": category_id}, len(forecast), 1, duration,
                "成功" if result.get("ok") else "数据不足",
                result.get("reason"), user.username)
    result["categoryCode"] = cat.code
    return result


@router.get("/trend", summary="全部品类需求趋势对比")
def trend_all(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    forecast = ds.load_forecast(db)
    items = []
    for f in forecast:
        a = algo.analyze_forecast(forecast, f["cat"])
        items.append({
            "category": f["cat"],
            "ok": a["ok"],
            "delta": a.get("delta"),
            "level": a.get("level"),
            "last4Avg": a.get("last4Avg"),
            "next4Avg": a.get("next4Avg"),
            "risk": a.get("risk"),
            "reason": a.get("reason"),
        })
    items.sort(key=lambda x: -(x["delta"] if x["delta"] is not None else -999))
    return {
        "ok": True,
        "algorithm": "TrendAnalysis v1.0",
        "sourceDatasetId": "dataset_demand_forecast.csv",
        "createdAt": datetime.now().isoformat(),
        "items": items,
    }


# ============================ 选品比较 ============================


@router.post("/compare", summary="选品比较综合评分")
def compare(
    payload: CompareRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    t0 = time.perf_counter()
    weights = _resolve_weights(payload.weights)

    # 校验候选对象存在，避免把「不存在」误报成「数据不足」
    missing = [cid for cid in payload.candidate_ids if db.get(Category, cid) is None]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"品类不存在：{'、'.join(str(x) for x in missing)}",
        )

    sales = ds.load_sales(db)
    categories = ds.load_categories(db)
    forecast = ds.load_forecast(db)
    baskets, products, product_cat = ds.load_baskets(db)

    result = algo.compare_candidates(
        payload.candidate_ids, sales, categories, forecast,
        baskets, products, product_cat, weights=weights, mode=payload.mode,
    )
    duration = int((time.perf_counter() - t0) * 1000)
    _record_run(db, "compare", payload.model_dump(), len(sales),
                len(result.get("items", [])), duration,
                "成功" if result.get("ok") else "数据不足",
                result.get("reason"), user.username)
    return result


# ============================ 综合方案 ============================


@router.get("/plan", summary="AI 综合选品方案（五级处置分桶）")
def plan(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    t0 = time.perf_counter()
    sales = ds.load_sales(db)
    categories = ds.load_categories(db)
    forecast = ds.load_forecast(db)
    baskets, products, product_cat = ds.load_baskets(db)

    result = algo.build_assortment_plan(sales, categories, forecast, baskets, products, product_cat)
    duration = int((time.perf_counter() - t0) * 1000)
    _record_run(db, "assortment_plan", {}, len(sales),
                sum(result.get("counts", {}).values()) if result.get("ok") else 0,
                duration, "成功" if result.get("ok") else "数据不足",
                result.get("reason"), user.username)
    return result


# ============================ 缺货风险 ============================


@router.get("/stockout-risk", summary="缺货风险清单（按缺货次数降序）")
def stockout_risk(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    sales = ds.load_sales(db)
    categories = ds.load_categories(db)
    health = algo.compute_category_health(sales, categories)
    if not health["ok"]:
        return health

    items = []
    for h in health["items"]:
        items.append({
            "categoryId": h["cid"],
            "name": h["name"],
            "stockoutCount": h["stockout"],
            "monthCount": health["monthCount"],
            "perMonth": round(h["stockout"] / health["monthCount"], 1) if health["monthCount"] else 0,
            "turnoverDays": h["turnoverDays"],
            "score": h["score"],
            "riskLevel": ("高" if h["stockout"] >= 6 else "中" if h["stockout"] >= 4 else "低"),
            "advice": ("核查补货周期与安全库存设置" if h["stockout"] >= 4
                       else "维持现有补货策略"),
        })
    items.sort(key=lambda x: -x["stockoutCount"])

    return {
        "ok": True,
        "algorithm": "StockoutRisk v1.0",
        "sourceDatasetId": "dataset_category_sales.csv",
        "monthCount": health["monthCount"],
        "totalStockout": sum(x["stockoutCount"] for x in items),
        "createdAt": datetime.now().isoformat(),
        "items": items,
    }


# ============================ 数据质量 ============================


@router.post("/quality-check", summary="数据质量九类检查（五维评分）")
def quality_check(
    payload: QualityCheckRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    t0 = time.perf_counter()
    result = algo.run_quality_check(payload.dataset_type, payload.rows)
    duration = int((time.perf_counter() - t0) * 1000)
    _record_run(db, "quality_check", {"dataset_type": payload.dataset_type},
                len(payload.rows), len(result.get("issues", [])), duration,
                "成功" if result.get("ok") else "数据不足",
                result.get("reason"), user.username)
    return result


@router.get("/dictionary", summary="数据字典与数据集规模概览")
def dictionary(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return {
        "ok": True,
        "dataNature": "基于公开行业数据构造的模拟演示数据，不代表任何企业真实经营数据",
        "summary": ds.dataset_summary(db),
        "supportedDatasets": {
            k: {"label": v["label"], "requiredColumns": v["required"]}
            for k, v in algo.QUALITY_CHECKERS.items()
        },
        "algorithmBaselines": {
            "healthScore": "相对标准化60% + 行业基准40%，5%-95% 分位收敛",
            "turnoverNormalization": "reverse-minmax（周转天数越低越好）",
            "apriori": "最大项集长度 2，按交易号+商品名称构建购物篮",
        },
    }


@router.get("/runs", response_model=list[AnalysisRunOut], summary="算法运行日志")
def list_runs(
    limit: int = Query(50, ge=1, le=500),
    run_type: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(AnalysisRun)
    if run_type:
        q = q.filter(AnalysisRun.run_type == run_type)
    return q.order_by(AnalysisRun.id.desc()).limit(limit).all()


# ============================ 门店画像 ============================


@router.get("/store-profile", summary="门店画像（商圈/时序/品类结构）")
def store_profile(
    store_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    store = db.get(Store, store_id) if store_id else db.query(Store).first()
    if store is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="门店不存在。")

    sales = ds.load_sales(db, store.id)
    categories = ds.load_categories(db)
    health = algo.compute_category_health(sales, categories)

    monthly = {}
    for r in sales:
        m = monthly.setdefault(r["month"], {"month": r["month"], "qty": 0, "amt": 0.0, "gp": 0.0})
        m["qty"] += r["qty"]
        m["amt"] += r["amt"]
        m["gp"] += r["gp"]
    series = sorted(monthly.values(), key=lambda x: x["month"])

    return {
        "ok": True,
        "store": {
            "id": store.id, "code": store.code, "name": store.name,
            "city": store.city, "district": store.district, "address": store.address,
            "businessHours": store.business_hours, "areaSqm": store.area_sqm,
            "openedOn": store.opened_on.isoformat() if store.opened_on else None,
        },
        "monthlySeries": series,
        "categoryStructure": [
            {"name": h["name"], "qty": h["qty"], "amt": h["amt"],
             "qtyShare": h["qtyShare"], "gpShare": h["gpShare"]}
            for h in (health["items"] if health["ok"] else [])
        ],
        "sourceDatasetId": "dataset_category_sales.csv",
        "dataNature": "模拟演示数据",
        "createdAt": datetime.now().isoformat(),
    }
