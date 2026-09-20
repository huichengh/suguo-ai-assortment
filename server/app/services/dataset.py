"""苏果智选 · 数据集装配层。

职责单一：把数据库里的 ORM 行转成算法层要求的纯数据结构。
算法层不接触 Session，装配层不做任何计算 —— 两边职责彻底分离。

购物篮构建结果带进程内缓存：演示数据有 22022 条明细，
每次请求重算会明显拖慢接口；数据变更时调用 invalidate_cache() 失效。
"""

from __future__ import annotations

import threading
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import (
    Category,
    CategorySale,
    DemandForecast,
    Transaction,
    TransactionItem,
)
from app.services.algorithms import build_baskets

_cache_lock = threading.Lock()
_basket_cache: dict[str, Any] = {}


def invalidate_cache() -> None:
    """数据变更后调用，强制下次重新装配。"""
    with _cache_lock:
        _basket_cache.clear()


def load_categories(db: Session) -> list[dict]:
    rows = db.query(Category).order_by(Category.sort_order).all()
    return [{"id": c.id, "code": c.code, "name": c.name, "role": c.role} for c in rows]


def load_sales(db: Session, store_id: int | None = None) -> list[dict]:
    """品类月度销售。字段名转成算法层约定，原始数值不做任何加工。"""
    q = db.query(CategorySale)
    if store_id is not None:
        q = q.filter(CategorySale.store_id == store_id)
    cat_map = {c["id"]: c["name"] for c in load_categories(db)}

    out = []
    for r in q.order_by(CategorySale.category_id, CategorySale.month).all():
        out.append({
            "cid": r.category_id,
            "name": cat_map.get(r.category_id, str(r.category_id)),
            "month": r.month,
            "qty": r.qty,
            "amt": r.sales_amount,
            "gp": r.gross_profit,
            "turnover_days": r.turnover_days,
            "space_eff": r.space_efficiency,
            "stockout": r.stockout_count,
            "sku_count": r.sku_count,
        })
    return out


def load_baskets(db: Session, aggregate_by: str | None = None) -> tuple[list[list[int]], list[str], list[str]]:
    """装配购物篮。首次调用后缓存，后续请求直接复用。"""
    agg = aggregate_by or settings.basket_aggregate_by
    key = f"baskets::{agg}"

    with _cache_lock:
        cached = _basket_cache.get(key)
    if cached is not None:
        return cached

    items = (
        db.query(
            Transaction.txn_no,
            TransactionItem.sku_code,
            TransactionItem.product_name,
            TransactionItem.category_name,
        )
        .join(TransactionItem, TransactionItem.txn_id == Transaction.id)
        .all()
    )

    payload = [
        {
            "txn_no": r[0],
            "sku_code": r[1],
            "product_name": r[2],
            "category_name": r[3],
        }
        for r in items
    ]

    result = build_baskets(payload, aggregate_by=agg)

    with _cache_lock:
        _basket_cache[key] = result
    return result


def load_forecast(db: Session) -> list[dict]:
    """按品类分组的需求预测序列。"""
    cat_map = {c["id"]: c["name"] for c in load_categories(db)}
    rows = (
        db.query(DemandForecast)
        .order_by(DemandForecast.category_id, DemandForecast.week_no)
        .all()
    )

    grouped: dict[str, list[dict]] = {}
    for r in rows:
        cat_name = cat_map.get(r.category_id, str(r.category_id))
        grouped.setdefault(cat_name, []).append({
            "week": r.week_no,
            "label": r.week_label,
            "hist": r.history_qty,
            "fc": r.forecast_qty,
            "lo": r.lower_qty,
            "hi": r.upper_qty,
            "type": r.data_type,
        })
    return [{"cat": k, "points": v} for k, v in grouped.items()]


def dataset_summary(db: Session) -> dict[str, int]:
    """数据集规模概览。用于驾驶舱与数据中心的溯源展示。"""
    baskets, products, _ = load_baskets(db)
    return {
        "categorySalesRows": db.query(CategorySale).count(),
        "categories": db.query(Category).count(),
        "transactions": db.query(Transaction).count(),
        "transactionItems": db.query(TransactionItem).count(),
        "baskets": len(baskets),
        "distinctProducts": len(products),
        "forecastRows": db.query(DemandForecast).count(),
    }
