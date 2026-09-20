"""苏果智选 · 数据库基础装配。

默认使用 SQLite 单文件，克隆即跑；接入生产库只需改 SUGUO_DATABASE_URL
环境变量，业务代码无需改动。
"""

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    """全部 ORM 模型的公共基类。"""


def _engine_kwargs() -> dict:
    # SQLite 在 FastAPI 的多线程请求下需要关闭同线程校验
    if settings.database_url.startswith("sqlite"):
        return {"connect_args": {"check_same_thread": False}}
    return {}


engine = create_engine(settings.database_url, echo=False, future=True, **_engine_kwargs())
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """FastAPI 依赖：按请求提供会话，请求结束自动关闭。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """建表。幂等，可重复调用。"""
    from app.db import models  # noqa: F401  触发模型注册到 Base.metadata

    Base.metadata.create_all(bind=engine)
