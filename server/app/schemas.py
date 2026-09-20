"""苏果智选 · 接口数据契约（Pydantic v2）。

作用：
  - 出参：用 from_attributes 直接从 ORM 对象序列化，避免手写字典
  - 入参：把校验前移到框架层，非法请求不进入业务逻辑
  - OpenAPI：自动生成可交互文档，评审时可直接在 /docs 试用
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    """统一分页结构。"""

    total: int
    page: int
    size: int
    items: list[T]


# ============================ 认证 ============================


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class RoleOut(ORMModel):
    id: int
    code: str
    name: str
    description: str | None = None
    rank: int


class UserOut(ORMModel):
    id: int
    username: str
    display_name: str
    role_id: int
    store_id: int | None = None
    is_active: bool
    created_at: datetime | None = None


class UserDetail(UserOut):
    role: RoleOut | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserDetail


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    display_name: str = Field(min_length=1, max_length=64)
    role_code: str = Field(default="viewer")
    store_id: int | None = None


class UserUpdate(BaseModel):
    display_name: str | None = None
    role_code: str | None = None
    store_id: int | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=6, max_length=128)


# ============================ 主数据 ============================


class StoreOut(ORMModel):
    id: int
    code: str
    name: str
    city: str | None = None
    district: str | None = None
    address: str | None = None
    business_hours: str | None = None
    area_sqm: float | None = None
    opened_on: date | None = None


class CategoryOut(ORMModel):
    id: int
    code: str
    name: str
    role: str | None = None
    sort_order: int


class ProductOut(ORMModel):
    id: int
    name: str
    category_name: str | None = None
    brand: str | None = None
    is_private_label: bool
    unit: str | None = None
    ref_price: float | None = None
    status: str


class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    category_name: str | None = None
    brand: str | None = None
    is_private_label: bool = False
    unit: str | None = None
    ref_price: float | None = None


class SupplierOut(ORMModel):
    id: int
    code: str
    name: str
    contact: str | None = None
    level: str | None = None
    cooperation_since: date | None = None


# ============================ 事实数据 ============================


class CategorySaleOut(ORMModel):
    id: int
    store_id: int
    category_id: int
    month: str
    qty: int
    sales_amount: float
    gross_profit: float
    turnover_days: float
    space_efficiency: float
    stockout_count: int
    sku_count: int


class TransactionOut(ORMModel):
    id: int
    txn_no: str
    txn_date: date | None = None
    item_count: int
    amount: float


class TransactionItemOut(ORMModel):
    id: int
    txn_id: int
    sku_code: str
    product_name: str
    category_name: str | None = None
    qty: int
    unit_price: float
    amount: float


class DemandForecastOut(ORMModel):
    id: int
    category_id: int
    week_no: int
    week_label: str
    history_qty: int | None = None
    forecast_qty: int | None = None
    lower_qty: int | None = None
    upper_qty: int | None = None
    data_type: str


# ============================ 算法结果 ============================


class AssociationRuleOut(ORMModel):
    id: int
    rule_no: int | None = None
    antecedent: str
    consequent: str
    support: float
    confidence: float
    lift: float
    display_advice: str | None = None
    source: str
    created_at: datetime | None = None


class CategoryHealthOut(ORMModel):
    id: int
    category_id: int
    score: float
    star_level: str | None = None
    rating: str | None = None
    qty_share: float
    gp_share: float
    turnover_days: float
    space_score: float
    advice: str | None = None
    alert_light: str | None = None
    source: str
    created_at: datetime | None = None


class AnalysisRunOut(ORMModel):
    id: int
    run_type: str
    params_json: str | None = None
    input_rows: int
    output_rows: int
    duration_ms: int
    status: str
    message: str | None = None
    created_by: str | None = None
    created_at: datetime | None = None


class DataQualityReportOut(ORMModel):
    id: int
    check_code: str
    check_name: str
    dimension: str | None = None
    status: str
    detail: str | None = None
    score: float
    created_at: datetime | None = None


# ============================ 审批流转 ============================


class ApprovalCreate(BaseModel):
    """创建审批请求。刻意不含「直接执行」字段 —— AI 无法绕过人工确认。"""

    title: str = Field(min_length=1, max_length=255)
    level: str = Field(default="L2", pattern="^L[123]$")
    content: str | None = None
    source_module: str | None = None
    risk_note: str | None = None
    due_at: date | None = None


class ApprovalOut(ORMModel):
    id: int
    code: str
    level: str
    title: str
    content: str | None = None
    source_module: str | None = None
    risk_note: str | None = None
    status: str
    created_by: str | None = None
    due_at: date | None = None
    created_at: datetime | None = None


class ApprovalDecision(BaseModel):
    action: str = Field(pattern="^(通过|驳回)$")
    comment: str | None = Field(default=None, max_length=255)


class ApprovalLogOut(ORMModel):
    id: int
    request_id: int
    action: str
    operator: str | None = None
    comment: str | None = None
    created_at: datetime | None = None


class ApprovalDetail(ApprovalOut):
    logs: list[ApprovalLogOut] = []


# ============================ 算法调用入参 ============================


class HealthComputeRequest(BaseModel):
    weights: dict[str, float] | None = None
    months: int = Field(default=12, ge=1, le=60)
    store_id: int | None = None


class AprioriRequest(BaseModel):
    min_support: float = Field(default=0.02, gt=0, le=1)
    min_confidence: float = Field(default=0.50, gt=0, le=1)
    min_lift: float = Field(default=1.50, gt=0)
    top_n: int = Field(default=20, ge=1, le=200)
    aggregate_by: str = Field(default="name", pattern="^(name|sku)$")


class CompareRequest(BaseModel):
    candidate_ids: list[int] = Field(min_length=2, max_length=6,
                                     description="品类 ID 列表，2-6 个")
    mode: str = Field(default="category", pattern="^(category|sku)$")
    weights: dict[str, float] | None = None


class QualityCheckRequest(BaseModel):
    dataset_type: str = Field(description="数据集类型键，见数据字典")
    rows: list[dict[str, Any]] = Field(min_length=1)


class Envelope(BaseModel):
    """需要携带算法溯源信息时的通用信封。"""

    ok: bool
    insufficient: bool = False
    reason: str | None = None
    data: Any = None
