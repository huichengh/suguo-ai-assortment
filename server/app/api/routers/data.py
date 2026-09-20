"""苏果智选 · 事实数据查询接口。

只做读取与分页，不含任何计算 —— 计算一律走 /analysis/*。
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.base import get_db
from app.db.models import (
    Category,
    CategorySale,
    DemandForecast,
    Transaction,
    TransactionItem,
    User,
)
from app.schemas import (
    CategorySaleOut,
    DemandForecastOut,
    Page,
    TransactionItemOut,
    TransactionOut,
)
from app.services import dataset as ds

router = APIRouter(prefix="/data", tags=["事实数据"])


@router.get("/category-sales", response_model=Page[CategorySaleOut],
            summary="品类月度销售（分页）")
def category_sales(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=500),
    category_id: int | None = Query(None),
    month: str | None = Query(None, description="YYYY-MM"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(CategorySale)
    if category_id is not None:
        q = q.filter(CategorySale.category_id == category_id)
    if month:
        q = q.filter(CategorySale.month == month)
    total = q.count()
    items = q.order_by(CategorySale.category_id, CategorySale.month) \
        .offset((page - 1) * size).limit(size).all()
    return Page[CategorySaleOut](total=total, page=page, size=size, items=items)


@router.get("/transactions", response_model=Page[TransactionOut],
            summary="交易列表（分页）")
def transactions(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(Transaction)
    total = q.count()
    items = q.order_by(Transaction.txn_no).offset((page - 1) * size).limit(size).all()
    return Page[TransactionOut](total=total, page=page, size=size, items=items)


@router.get("/transactions/{txn_no}/items", response_model=list[TransactionItemOut],
            summary="单笔交易明细（购物篮构成）")
def transaction_items(
    txn_no: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    txn = db.query(Transaction).filter(Transaction.txn_no == txn_no).first()
    if txn is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"交易不存在：{txn_no}")
    return db.query(TransactionItem).filter(TransactionItem.txn_id == txn.id) \
        .order_by(TransactionItem.id).all()


@router.get("/forecast", response_model=Page[DemandForecastOut],
            summary="需求预测数据（分页）")
def forecast(
    page: int = Query(1, ge=1),
    size: int = Query(40, ge=1, le=500),
    category_id: int | None = Query(None),
    data_type: str | None = Query(None, description="历史数据 / 预测数据"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(DemandForecast)
    if category_id is not None:
        q = q.filter(DemandForecast.category_id == category_id)
    if data_type:
        q = q.filter(DemandForecast.data_type == data_type)
    total = q.count()
    items = q.order_by(DemandForecast.category_id, DemandForecast.week_no) \
        .offset((page - 1) * size).limit(size).all()
    return Page[DemandForecastOut](total=total, page=page, size=size, items=items)


@router.get("/basket-stats", summary="购物篮规模统计（一名多码问题的现场证据）")
def basket_stats(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    baskets, products, _ = ds.load_baskets(db)

    item_rows = (
        db.query(TransactionItem.product_name, TransactionItem.sku_code).all()
    )
    name_to_skus: dict[str, set] = {}
    for name, sku in item_rows:
        name_to_skus.setdefault(name, set()).add(sku)

    multi = {k: len(v) for k, v in name_to_skus.items() if len(v) > 1}
    sizes = sorted((len(b) for b in baskets), reverse=True)

    return {
        "ok": True,
        "basketCount": len(baskets),
        "distinctProductNames": len(products),
        "distinctSkuCodes": len({sku for _, sku in item_rows}),
        "avgBasketSize": round(sum(len(b) for b in baskets) / len(baskets), 2) if baskets else 0,
        "maxBasketSize": sizes[0] if sizes else 0,
        "minBasketSize": sizes[-1] if sizes else 0,
        "oneNameManyCodes": {
            "affectedProductNames": len(multi),
            "maxCodesPerName": max(multi.values()) if multi else 0,
            "note": "演示数据中同一商品名对应多个 SKU 编码，故购物篮默认按「交易号+商品名称」聚合。",
            "samples": sorted(multi.items(), key=lambda x: -x[1])[:5],
        },
        "sourceDatasetId": "dataset_transactions_sample.csv",
        "dataNature": "模拟演示数据",
        "createdAt": datetime.now().isoformat(),
    }


@router.get("/categories-meta", summary="品类与编码映射")
def categories_meta(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    rows = db.query(Category).order_by(Category.sort_order).all()
    return {
        "items": [{"id": c.id, "code": c.code, "name": c.name, "role": c.role} for c in rows],
        "count": len(rows),
    }


@router.get("/algo-dataset", summary="算法层数据集（前端 API 适配层的单一接入点）")
def algo_dataset(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """一次调用返回算法层所需的全部输入数据。

    专为前端 API 适配层设计：前端拿到后可直接替换内联数据集，
    再在客户端用等价算法重算，无需多次请求拼装。

    注意 forecast 的结构为 [{cat, points:[...]}]，与算法层约定一致。
    """
    sales = ds.load_sales(db)
    categories = ds.load_categories(db)
    forecast = ds.load_forecast(db)
    return {
        "ok": True,
        "source": "FastAPI 后台",
        "sourceDatasetId": "dataset_category_sales.csv + dataset_demand_forecast.csv",
        "dataNature": "基于公开行业数据构造的模拟演示数据",
        "createdAt": datetime.now().isoformat(),
        "categories": categories,
        "sales": sales,
        "forecast": forecast,
        "rowCounts": {"sales": len(sales), "categories": len(categories), "forecast": len(forecast)},
    }
