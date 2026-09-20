"""苏果智选 · 数据模型（恰好 21 张表）。

表分组：
  主数据 6 张   roles / users / stores / categories / products / suppliers
  关系   3 张   product_suppliers / store_categories / product_aliases
  事实   4 张   category_sales / transactions / transaction_items / demand_forecast
  结果   5 张   association_rules / category_health / assortment_candidates / candidate_scores / analysis_runs
  治理   3 张   approval_requests / approval_logs / data_quality_reports

设计说明：
- `frozen_data` 标记用于区分「附件参考结果」与「系统实时重算结果」，
  与前端双轨数据治理策略一致，保证两套口径可对照而不互相覆盖。
- `product_aliases` 专门承载演示数据中「一个商品名对应多个 SKU 编码」
  的现实问题，是购物篮聚合口径选择的直接依据。
"""

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Role(Base):
    """角色。等级 rank 用于权限比较：数值越大权限越高。"""

    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str | None] = mapped_column(String(255), default=None)
    rank: Mapped[int] = mapped_column(Integer, default=0)


class User(Base):
    """用户。密码仅存 bcrypt 哈希，不存明文。"""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(128))
    display_name: Mapped[str] = mapped_column(String(64))
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"))
    store_id: Mapped[int | None] = mapped_column(ForeignKey("stores.id"), default=None)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class Store(Base):
    """门店。"""

    __tablename__ = "stores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    city: Mapped[str | None] = mapped_column(String(64), default=None)
    district: Mapped[str | None] = mapped_column(String(64), default=None)
    address: Mapped[str | None] = mapped_column(String(255), default=None)
    business_hours: Mapped[str | None] = mapped_column(String(128), default=None)
    area_sqm: Mapped[float | None] = mapped_column(Float, default=None)
    opened_on: Mapped[date | None] = mapped_column(Date, default=None)


class Category(Base):
    """品类。role 为品类角色（目标性/常规性/便利性等）。"""

    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(64), index=True)
    role: Mapped[str | None] = mapped_column(String(32), default=None)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Product(Base):
    """商品。以「商品名称」为主体——演示数据中一名多码极严重，编码放别名表。"""

    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    category_name: Mapped[str | None] = mapped_column(String(64), index=True, default=None)
    brand: Mapped[str | None] = mapped_column(String(64), default=None)
    is_private_label: Mapped[bool] = mapped_column(Boolean, default=False)
    unit: Mapped[str | None] = mapped_column(String(16), default=None)
    ref_price: Mapped[float | None] = mapped_column(Float, default=None)
    status: Mapped[str] = mapped_column(String(16), default="在售")


class Supplier(Base):
    """供应商。"""

    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    contact: Mapped[str | None] = mapped_column(String(64), default=None)
    level: Mapped[str | None] = mapped_column(String(16), default=None)
    cooperation_since: Mapped[date | None] = mapped_column(Date, default=None)


class ProductSupplier(Base):
    """商品-供应商关系。is_primary 标记主供。"""

    __tablename__ = "product_suppliers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), index=True)
    supply_price: Mapped[float | None] = mapped_column(Float, default=None)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)


class StoreCategory(Base):
    """门店-品类经营配置。承载千店千面的差异化基础。"""

    __tablename__ = "store_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id"), index=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"), index=True)
    shelf_area_sqm: Mapped[float | None] = mapped_column(Float, default=None)
    is_carried: Mapped[bool] = mapped_column(Boolean, default=True)
    rent_per_sqm: Mapped[float | None] = mapped_column(Float, default=None)


class ProductAlias(Base):
    """商品别名（编码）。一个商品名可对应多个 SKU 编码。"""

    __tablename__ = "product_aliases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    sku_code: Mapped[str] = mapped_column(String(32), index=True)
    source: Mapped[str | None] = mapped_column(String(32), default=None)


class CategorySale(Base):
    """品类月度销售事实表。字段与附件 dataset_category_sales.csv 一一对应。"""

    __tablename__ = "category_sales"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id"), index=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"), index=True)
    month: Mapped[str] = mapped_column(String(7), index=True)          # YYYY-MM
    qty: Mapped[int] = mapped_column(Integer, default=0)
    sales_amount: Mapped[float] = mapped_column(Float, default=0.0)
    gross_profit: Mapped[float] = mapped_column(Float, default=0.0)
    turnover_days: Mapped[float] = mapped_column(Float, default=0.0)
    space_efficiency: Mapped[float] = mapped_column(Float, default=0.0)  # 坪效
    stockout_count: Mapped[int] = mapped_column(Integer, default=0)
    sku_count: Mapped[int] = mapped_column(Integer, default=0)


class Transaction(Base):
    """交易头。"""

    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    txn_no: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    store_id: Mapped[int | None] = mapped_column(ForeignKey("stores.id"), default=None)
    txn_date: Mapped[date | None] = mapped_column(Date, index=True, default=None)
    item_count: Mapped[int] = mapped_column(Integer, default=0)
    amount: Mapped[float] = mapped_column(Float, default=0.0)


class TransactionItem(Base):
    """交易明细。"""

    __tablename__ = "transaction_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    txn_id: Mapped[int] = mapped_column(ForeignKey("transactions.id"), index=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), index=True, default=None)
    sku_code: Mapped[str] = mapped_column(String(32), index=True)
    product_name: Mapped[str] = mapped_column(String(128), index=True)
    category_name: Mapped[str | None] = mapped_column(String(64), default=None)
    qty: Mapped[int] = mapped_column(Integer, default=0)
    unit_price: Mapped[float] = mapped_column(Float, default=0.0)
    amount: Mapped[float] = mapped_column(Float, default=0.0)


class DemandForecast(Base):
    """需求预测。历史行与预测行同表，用 data_type 区分。"""

    __tablename__ = "demand_forecast"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"), index=True)
    week_no: Mapped[int] = mapped_column(Integer)
    week_label: Mapped[str] = mapped_column(String(16))                # 2026-W01
    history_qty: Mapped[int | None] = mapped_column(Integer, default=None)
    forecast_qty: Mapped[int | None] = mapped_column(Integer, default=None)
    lower_qty: Mapped[int | None] = mapped_column(Integer, default=None)
    upper_qty: Mapped[int | None] = mapped_column(Integer, default=None)
    data_type: Mapped[str] = mapped_column(String(16), default="历史数据")


class AssociationRule(Base):
    """关联规则。source 区分附件参考值与系统重算值。"""

    __tablename__ = "association_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rule_no: Mapped[int | None] = mapped_column(Integer, default=None)
    antecedent: Mapped[str] = mapped_column(String(128), index=True)
    consequent: Mapped[str] = mapped_column(String(128), index=True)
    support: Mapped[float] = mapped_column(Float, default=0.0)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    lift: Mapped[float] = mapped_column(Float, default=0.0)
    display_advice: Mapped[str | None] = mapped_column(String(255), default=None)
    source: Mapped[str] = mapped_column(String(16), default="附件参考")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class CategoryHealth(Base):
    """品类健康度评分结果。"""

    __tablename__ = "category_health"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"), index=True)
    score: Mapped[float] = mapped_column(Float, default=0.0)
    star_level: Mapped[str | None] = mapped_column(String(16), default=None)
    rating: Mapped[str | None] = mapped_column(String(16), default=None)
    qty_share: Mapped[float] = mapped_column(Float, default=0.0)
    gp_share: Mapped[float] = mapped_column(Float, default=0.0)
    turnover_days: Mapped[float] = mapped_column(Float, default=0.0)
    space_score: Mapped[float] = mapped_column(Float, default=0.0)
    advice: Mapped[str | None] = mapped_column(String(255), default=None)
    alert_light: Mapped[str | None] = mapped_column(String(16), default=None)
    source: Mapped[str] = mapped_column(String(16), default="附件参考")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class AssortmentCandidate(Base):
    """选品候选对象。candidate_type 区分同店品类互比与候选 SKU 引入。"""

    __tablename__ = "assortment_candidates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    store_id: Mapped[int | None] = mapped_column(ForeignKey("stores.id"), default=None)
    candidate_type: Mapped[str] = mapped_column(String(32), default="品类互比")
    name: Mapped[str] = mapped_column(String(128))
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), default=None)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), default=None)
    reason: Mapped[str | None] = mapped_column(String(255), default=None)
    status: Mapped[str] = mapped_column(String(16), default="待评估")


class CandidateScore(Base):
    """候选对象的维度得分。存储各维度原值与权重，便于复核。"""

    __tablename__ = "candidate_scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    candidate_id: Mapped[int] = mapped_column(ForeignKey("assortment_candidates.id"), index=True)
    dimension: Mapped[str] = mapped_column(String(32))
    raw_value: Mapped[float] = mapped_column(Float, default=0.0)
    score: Mapped[float] = mapped_column(Float, default=0.0)
    weight: Mapped[float] = mapped_column(Float, default=0.0)
    basis: Mapped[str | None] = mapped_column(String(255), default=None)


class AnalysisRun(Base):
    """算法运行日志。可追溯是需求硬约束。"""

    __tablename__ = "analysis_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_type: Mapped[str] = mapped_column(String(32), index=True)
    params_json: Mapped[str | None] = mapped_column(Text, default=None)
    input_rows: Mapped[int] = mapped_column(Integer, default=0)
    output_rows: Mapped[int] = mapped_column(Integer, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="成功")
    message: Mapped[str | None] = mapped_column(String(255), default=None)
    created_by: Mapped[str | None] = mapped_column(String(64), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class ApprovalRequest(Base):
    """审批请求。level 三级：L1 信息提示 / L2 经营建议 / L3 高影响必须人工审批。"""

    __tablename__ = "approval_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    level: Mapped[str] = mapped_column(String(8), default="L2")
    title: Mapped[str] = mapped_column(String(255))
    content: Mapped[str | None] = mapped_column(Text, default=None)
    source_module: Mapped[str | None] = mapped_column(String(64), default=None)
    risk_note: Mapped[str | None] = mapped_column(String(255), default=None)
    status: Mapped[str] = mapped_column(String(16), default="待审批", index=True)
    created_by: Mapped[str | None] = mapped_column(String(64), default=None)
    due_at: Mapped[date | None] = mapped_column(Date, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class ApprovalLog(Base):
    """审批流水。记录每一次通过/驳回与理由。"""

    __tablename__ = "approval_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("approval_requests.id"), index=True)
    action: Mapped[str] = mapped_column(String(16))
    operator: Mapped[str | None] = mapped_column(String(64), default=None)
    comment: Mapped[str | None] = mapped_column(String(255), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class DataQualityReport(Base):
    """数据质量检查报告。"""

    __tablename__ = "data_quality_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    check_code: Mapped[str] = mapped_column(String(32), index=True)
    check_name: Mapped[str] = mapped_column(String(128))
    dimension: Mapped[str | None] = mapped_column(String(32), default=None)
    status: Mapped[str] = mapped_column(String(16), default="通过")
    detail: Mapped[str | None] = mapped_column(String(255), default=None)
    score: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
