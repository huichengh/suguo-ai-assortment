"""苏果智选 · 业务流与治理接口。

选品候选、审批流转、日志查询。

审批设计的核心约束：AI 只能「创建待审批请求」，不能直接改动业务数据。
三级分级：
  L1 信息提示  —— 无需审批，仅告知
  L2 经营建议  —— 需业务人员复核
  L3 高影响    —— 必须人工审批，涉及采购金额/供应商准入/商品下架/价格调整
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.db.base import get_db
from app.db.models import (
    AnalysisRun,
    ApprovalLog,
    ApprovalRequest,
    AssortmentCandidate,
    Category,
    CandidateScore,
    User,
)
from app.schemas import (
    AnalysisRunOut,
    ApprovalCreate,
    ApprovalDecision,
    ApprovalDetail,
    ApprovalLogOut,
    ApprovalOut,
    Page,
)
from app.services import algorithms as algo
from app.services import dataset as ds

router = APIRouter(tags=["业务流与治理"])


def _gen_code(db: Session) -> str:
    today = datetime.now().strftime("%Y%m%d")
    seq = db.query(ApprovalRequest).filter(
        ApprovalRequest.code.like(f"AP{today}%")).count() + 1
    return f"AP{today}{seq:03d}"


def _to_detail(db: Session, req: ApprovalRequest) -> ApprovalDetail:
    detail = ApprovalDetail.model_validate(req)
    detail.logs = [
        ApprovalLogOut.model_validate(x)
        for x in db.query(ApprovalLog).filter(ApprovalLog.request_id == req.id)
        .order_by(ApprovalLog.id).all()
    ]
    return detail


# ============================ 选品候选 ============================


@router.get("/candidates", response_model=Page, summary="选品候选对象列表")
def list_candidates(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    candidate_type: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(AssortmentCandidate)
    if candidate_type:
        q = q.filter(AssortmentCandidate.candidate_type == candidate_type)
    total = q.count()
    rows = q.order_by(AssortmentCandidate.id).offset((page - 1) * size).limit(size).all()

    cat_map = {c.id: c for c in db.query(Category).all()}
    items = []
    for r in rows:
        cat = cat_map.get(r.category_id) if r.category_id else None
        items.append({
            "id": r.id,
            "candidateType": r.candidate_type,
            "name": r.name,
            "categoryId": r.category_id,
            "categoryCode": cat.code if cat else None,
            "reason": r.reason,
            "status": r.status,
        })
    return {"total": total, "page": page, "size": size, "items": items}


@router.get("/candidates/{candidate_id}", summary="候选对象详情（含维度得分）")
def get_candidate(
    candidate_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    c = db.get(AssortmentCandidate, candidate_id)
    if c is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="候选对象不存在。")

    scores = db.query(CandidateScore).filter(CandidateScore.candidate_id == candidate_id) \
        .order_by(CandidateScore.id).all()
    cat = db.get(Category, c.category_id) if c.category_id else None

    return {
        "ok": True,
        "id": c.id,
        "candidateType": c.candidate_type,
        "name": c.name,
        "categoryId": c.category_id,
        "categoryCode": cat.code if cat else None,
        "reason": c.reason,
        "status": c.status,
        "scores": [
            {"dimension": s.dimension, "rawValue": s.raw_value, "score": s.score,
             "weight": s.weight, "basis": s.basis}
            for s in scores
        ],
    }


@router.post("/candidates/compare", summary="候选对象综合比较（按品类 ID 列表）")
def compare_candidates(
    candidate_ids: list[int],
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if len(candidate_ids) < 2 or len(candidate_ids) > 6:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="请提供 2-6 个品类 ID。")

    sales = ds.load_sales(db)
    categories = ds.load_categories(db)
    forecast = ds.load_forecast(db)
    baskets, products, product_cat = ds.load_baskets(db)

    return algo.compare_candidates(
        candidate_ids, sales, categories, forecast, baskets, products, product_cat)


# ============================ 审批流转 ============================


@router.get("/approvals", response_model=Page[ApprovalOut], summary="审批请求列表")
def list_approvals(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    status_filter: str | None = Query(None, alias="status"),
    level: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(ApprovalRequest)
    if status_filter:
        q = q.filter(ApprovalRequest.status == status_filter)
    if level:
        q = q.filter(ApprovalRequest.level == level)
    total = q.count()
    # 待审批优先、逾期未处理置顶
    items = q.order_by(ApprovalRequest.status.asc(), ApprovalRequest.due_at.asc(),
                       ApprovalRequest.id.desc()) \
        .offset((page - 1) * size).limit(size).all()
    return Page[ApprovalOut](total=total, page=page, size=size, items=items)


@router.get("/approvals/{request_id}", response_model=ApprovalDetail, summary="审批请求详情")
def get_approval(
    request_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    req = db.get(ApprovalRequest, request_id)
    if req is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="审批请求不存在。")
    return _to_detail(db, req)


@router.post("/approvals", response_model=ApprovalDetail, status_code=status.HTTP_201_CREATED,
             summary="创建审批请求（AI 助手的唯一写操作）")
def create_approval(
    payload: ApprovalCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    req = ApprovalRequest(
        code=_gen_code(db),
        level=payload.level,
        title=payload.title,
        content=payload.content,
        source_module=payload.source_module,
        risk_note=payload.risk_note,
        status="待审批",
        created_by=user.username,
        due_at=payload.due_at or (date.today() + timedelta(days=7)),
    )
    db.add(req)
    db.commit()
    db.refresh(req)

    db.add(ApprovalLog(request_id=req.id, action="创建", operator=user.username,
                       comment=f"由 {payload.source_module or '人工'} 发起"))
    db.commit()
    db.refresh(req)
    return _to_detail(db, req)


@router.post("/approvals/{request_id}/decide", response_model=ApprovalDetail,
             summary="审批决策（采购及以上）")
def decide_approval(
    request_id: int,
    payload: ApprovalDecision,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "purchase")),
):
    req = db.get(ApprovalRequest, request_id)
    if req is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="审批请求不存在。")
    if req.status != "待审批":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"该请求当前状态为「{req.status}」，不可重复审批。",
        )

    # L3 高影响建议必须填写审批理由 —— 保证决策可追溯
    if req.level == "L3" and not (payload.comment or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="L3 高影响建议必须填写审批理由。")

    req.status = "已通过" if payload.action == "通过" else "已驳回"
    db.add(ApprovalLog(request_id=req.id, action=payload.action,
                       operator=user.username, comment=payload.comment))
    db.commit()
    db.refresh(req)
    return _to_detail(db, req)


@router.delete("/approvals/{request_id}", summary="撤回审批请求（仅创建人或管理员）")
def delete_approval(
    request_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin", "purchase")),
):
    req = db.get(ApprovalRequest, request_id)
    if req is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="审批请求不存在。")
    if req.status != "待审批":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="仅「待审批」状态的请求可以撤回。")
    db.query(ApprovalLog).filter(ApprovalLog.request_id == request_id).delete()
    db.delete(req)
    db.commit()
    return {"ok": True, "deleted": request_id}


@router.get("/approvals/logs/all", response_model=list[ApprovalLogOut],
            summary="审批流水分页查询")
def all_approval_logs(
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return db.query(ApprovalLog).order_by(ApprovalLog.id.desc()).limit(limit).all()


# ============================ 系统日志 ============================


@router.get("/system/runs", response_model=list[AnalysisRunOut], summary="系统算法运行日志")
def system_runs(
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return db.query(AnalysisRun).order_by(AnalysisRun.id.desc()).limit(limit).all()
