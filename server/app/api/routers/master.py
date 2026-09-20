"""苏果智选 · 主数据接口。

用户与角色管理（admin）、门店、品类、商品、供应商。
读接口对已登录用户开放；写接口按角色限制。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.core.security import hash_password
from app.db.base import get_db
from app.db.models import Category, CategorySale, Product, Role, Store, Supplier, User
from app.schemas import (
    CategoryOut,
    CategorySaleOut,
    Page,
    ProductCreate,
    ProductOut,
    RoleOut,
    StoreOut,
    SupplierOut,
    UserCreate,
    UserDetail,
    UserOut,
    UserUpdate,
)

router = APIRouter(tags=["主数据"])


def _paginate(query, page: int, size: int) -> tuple[int, list]:
    total = query.count()
    items = query.offset((page - 1) * size).limit(size).all()
    return total, items


def _resolve_role(db: Session, role_code: str) -> Role:
    role = db.query(Role).filter(Role.code == role_code).first()
    if role is None:
        valid = [r.code for r in db.query(Role).all()]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"角色不存在：{role_code}。可选角色：{'、'.join(valid)}",
        )
    return role


# ============================ 角色 ============================


@router.get("/roles", response_model=list[RoleOut], summary="角色列表")
def list_roles(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.query(Role).order_by(Role.rank).all()


# ============================ 用户 ============================


@router.get("/users", response_model=Page[UserOut], summary="用户列表（仅管理员）")
def list_users(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    total, items = _paginate(db.query(User).order_by(User.id), page, size)
    return Page[UserOut](total=total, page=page, size=size, items=items)


@router.get("/users/{user_id}", response_model=UserDetail, summary="用户详情（仅管理员）")
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在。")
    detail = UserDetail.model_validate(user)
    detail.role = RoleOut.model_validate(db.get(Role, user.role_id))
    return detail


@router.post("/users", response_model=UserDetail, status_code=status.HTTP_201_CREATED,
             summary="新建用户（仅管理员）")
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"用户名已存在：{payload.username}")
    role = _resolve_role(db, payload.role_code)
    if payload.store_id is not None and db.get(Store, payload.store_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"门店不存在：{payload.store_id}")

    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name,
        role_id=role.id,
        store_id=payload.store_id,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    detail = UserDetail.model_validate(user)
    detail.role = RoleOut.model_validate(role)
    return detail


@router.patch("/users/{user_id}", response_model=UserDetail, summary="修改用户（仅管理员）")
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    operator: User = Depends(require_roles("admin")),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在。")

    # 防止管理员把自己降级或停用后无人可管
    if user.id == operator.id:
        if payload.is_active is False:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail="不能停用当前登录账号。")
        if payload.role_code is not None and payload.role_code != "admin":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail="不能修改当前登录账号的角色，避免失去管理员权限。")

    if payload.display_name is not None:
        user.display_name = payload.display_name
    if payload.role_code is not None:
        user.role_id = _resolve_role(db, payload.role_code).id
    if payload.store_id is not None:
        if db.get(Store, payload.store_id) is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail=f"门店不存在：{payload.store_id}")
        user.store_id = payload.store_id
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.password:
        user.password_hash = hash_password(payload.password)

    db.commit()
    db.refresh(user)

    detail = UserDetail.model_validate(user)
    detail.role = RoleOut.model_validate(db.get(Role, user.role_id))
    return detail


@router.delete("/users/{user_id}", summary="删除用户（仅管理员）")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    operator: User = Depends(require_roles("admin")),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在。")
    if user.id == operator.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="不能删除当前登录账号。")

    admin_role = db.query(Role).filter(Role.code == "admin").first()
    if admin_role and user.role_id == admin_role.id:
        remaining = db.query(User).filter(
            User.role_id == admin_role.id, User.id != user.id, User.is_active.is_(True)
        ).count()
        if remaining == 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail="系统至少需保留一名启用状态的管理员。")

    db.delete(user)
    db.commit()
    return {"ok": True, "deleted": user_id}


# ============================ 门店 ============================


@router.get("/stores", response_model=list[StoreOut], summary="门店列表")
def list_stores(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.query(Store).order_by(Store.id).all()


@router.get("/stores/{store_id}", response_model=StoreOut, summary="门店详情")
def get_store(store_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    store = db.get(Store, store_id)
    if store is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="门店不存在。")
    return store


# ============================ 品类 ============================


@router.get("/categories", response_model=list[CategoryOut], summary="品类列表")
def list_categories(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.query(Category).order_by(Category.sort_order).all()


@router.get("/categories/{category_id}", response_model=CategoryOut, summary="品类详情")
def get_category(category_id: int, db: Session = Depends(get_db),
                 _: User = Depends(get_current_user)):
    cat = db.get(Category, category_id)
    if cat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="品类不存在。")
    return cat


@router.get("/categories/{category_id}/sales", response_model=list[CategorySaleOut],
            summary="品类月度销售明细")
def get_category_sales(
    category_id: int,
    store_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    if db.get(Category, category_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="品类不存在。")
    q = db.query(CategorySale).filter(CategorySale.category_id == category_id)
    if store_id is not None:
        q = q.filter(CategorySale.store_id == store_id)
    return q.order_by(CategorySale.month).all()


# ============================ 商品 ============================


@router.get("/products", response_model=Page[ProductOut], summary="商品列表")
def list_products(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    category: str | None = Query(None, description="按品类名称过滤"),
    keyword: str | None = Query(None, description="按商品名模糊匹配"),
    private_label: bool | None = Query(None, description="仅看自有品牌"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(Product)
    if category:
        q = q.filter(Product.category_name == category)
    if keyword:
        q = q.filter(or_(Product.name.contains(keyword), Product.brand.contains(keyword)))
    if private_label is not None:
        q = q.filter(Product.is_private_label.is_(private_label))
    total, items = _paginate(q.order_by(Product.id), page, size)
    return Page[ProductOut](total=total, page=page, size=size, items=items)


@router.get("/products/{product_id}", response_model=ProductOut, summary="商品详情")
def get_product(product_id: int, db: Session = Depends(get_db),
                _: User = Depends(get_current_user)):
    p = db.get(Product, product_id)
    if p is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="商品不存在。")
    return p


@router.post("/products", response_model=ProductOut, status_code=status.HTTP_201_CREATED,
             summary="新建商品（采购及以上）")
def create_product(
    payload: ProductCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "purchase", "category")),
):
    p = Product(**payload.model_dump(), status="在售")
    db.add(p)
    db.commit()
    db.refresh(p)
    # 商品集合变化会影响购物篮装配结果，必须让缓存失效
    from app.services.dataset import invalidate_cache
    invalidate_cache()
    return p


@router.patch("/products/{product_id}", response_model=ProductOut,
              summary="修改商品（采购及以上）")
def update_product(
    product_id: int,
    payload: ProductCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "purchase", "category")),
):
    p = db.get(Product, product_id)
    if p is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="商品不存在。")
    for k, v in payload.model_dump().items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    from app.services.dataset import invalidate_cache
    invalidate_cache()
    return p


# ============================ 供应商 ============================


@router.get("/suppliers", response_model=list[SupplierOut], summary="供应商列表")
def list_suppliers(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.query(Supplier).order_by(Supplier.id).all()


@router.get("/suppliers/{supplier_id}", response_model=SupplierOut, summary="供应商详情")
def get_supplier(supplier_id: int, db: Session = Depends(get_db),
                 _: User = Depends(get_current_user)):
    s = db.get(Supplier, supplier_id)
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="供应商不存在。")
    return s
