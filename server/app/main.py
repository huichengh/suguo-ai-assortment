"""苏果智选 · FastAPI 应用装配。

启动流程：
  1. 建表（幂等）
  2. 若库为空则自动灌入种子数据（首次启动即得到可演示的完整数据）
  3. 挂载四组路由：认证 / 主数据 / 事实数据 / 算法分析 / 业务流与治理

    uvicorn app.main:app --reload
    交互文档：http://127.0.0.1:8000/docs
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.api.routers import analysis, auth, data, master, workflow
from app.core.config import settings
from app.db.base import SessionLocal, init_db

DISCLAIMER = (
    "本平台为参加比赛而开发的软件原型（Prototype），用于展示 AI 选品辅助决策的技术构想。"
    "全部经营数据为基于公开行业数据构造的模拟演示数据，不代表华润苏果或任何企业的真实经营数据。"
    "AI 建议仅供辅助决策，最终选品由采购人员确认。"
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()

    # 库为空时自动灌种子数据，保证「克隆即跑」
    from app.db.models import Role
    from app.seed import seed_all

    db = SessionLocal()
    try:
        need_seed = db.query(Role).count() == 0
    finally:
        db.close()

    if need_seed:
        seed_all(verbose=True)

    yield


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description=(
        "AI 社区商超智能选品与品类优化平台 · 后台服务。\n\n"
        "**数据声明**：全部经营数据为基于公开行业数据构造的模拟演示数据。\n\n"
        "**设计原则**：数据不足时返回 `ok=false, insufficient=true`，"
        "不生成任何伪造的量化结果。"
    ),
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    """把校验错误转成统一结构，便于前端提示。"""
    return JSONResponse(
        status_code=422,
        content={
            "ok": False,
            "error": "PARAM_INVALID",
            "message": "请求参数校验未通过。",
            "details": exc.errors(),
        },
    )


@app.exception_handler(SQLAlchemyError)
async def db_handler(request: Request, exc: SQLAlchemyError):
    return JSONResponse(
        status_code=500,
        content={"ok": False, "error": "DB_ERROR", "message": "数据库操作失败，请查看服务端日志。"},
    )


for r in (auth.router, master.router, data.router, analysis.router, workflow.router):
    app.include_router(r, prefix=settings.api_prefix)


@app.get("/", tags=["元信息"], summary="服务说明")
def root():
    return {
        "ok": True,
        "name": settings.app_name,
        "version": "1.0.0",
        "apiPrefix": settings.api_prefix,
        "docs": "/docs",
        "dataNature": "软件原型 · 模拟演示数据",
        "disclaimer": DISCLAIMER,
    }


@app.get(f"{settings.api_prefix}/health", tags=["元信息"], summary="健康检查")
def health():
    return {"ok": True, "status": "up", "debug": settings.debug}


@app.get(f"{settings.api_prefix}/meta", tags=["元信息"], summary="平台元信息与数据声明")
def meta():
    return {
        "ok": True,
        "platform": "苏果智选 Suguo AI Assortment Intelligence",
        "nature": "软件原型 Prototype（参赛作品）",
        "purpose": "用于参加比赛，展示 AI 选品辅助决策的技术构想；未接入任何企业生产系统，未做商业部署。",
        "store": "华润苏果（南京江宁黄金海岸广场店）",
        "disclaimer": DISCLAIMER,
        "modules": [
            "AI 经营驾驶舱", "选品比较中心", "品类健康诊断", "关联陈列分析",
            "需求预测", "缺货风险", "审批中心", "数据中心",
        ],
    }
