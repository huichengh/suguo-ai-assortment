"""苏果智选 · 认证接口。

POST /auth/login    用户名密码换取 JWT
POST /auth/refresh  用现有有效令牌换新令牌
GET  /auth/me       当前登录用户信息
POST /auth/logout   登出（无状态令牌，仅记录意图并提示前端清本地令牌）
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_user_role
from app.core.config import settings
from app.core.security import create_access_token, verify_password
from app.db.base import get_db
from app.db.models import Role, User
from app.schemas import LoginRequest, RoleOut, TokenResponse, UserDetail

router = APIRouter(prefix="/auth", tags=["认证"])


def _build_user_detail(user: User, role: Role | None) -> UserDetail:
    detail = UserDetail.model_validate(user)
    detail.role = RoleOut.model_validate(role) if role else None
    return detail


@router.post("/login", response_model=TokenResponse, summary="登录并获取访问令牌")
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.query(User).filter(User.username == payload.username).first()
    # 用户不存在与密码错误返回同一提示，避免暴露账号是否存在
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码不正确。",
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账号已停用。")

    role = get_user_role(user, db)
    token = create_access_token(
        subject=user.username,
        extra={"uid": user.id, "role": role.code if role else None},
    )

    user.last_login_at = datetime.now()
    db.commit()
    db.refresh(user)

    return TokenResponse(
        access_token=token,
        expires_in=settings.access_token_expire_minutes * 60,
        user=_build_user_detail(user, role),
    )


@router.post("/refresh", response_model=TokenResponse, summary="刷新访问令牌")
def refresh(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TokenResponse:
    role = get_user_role(user, db)
    token = create_access_token(
        subject=user.username,
        extra={"uid": user.id, "role": role.code if role else None},
    )
    return TokenResponse(
        access_token=token,
        expires_in=settings.access_token_expire_minutes * 60,
        user=_build_user_detail(user, role),
    )


@router.get("/me", response_model=UserDetail, summary="获取当前登录用户")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> UserDetail:
    return _build_user_detail(user, get_user_role(user, db))


@router.post("/logout", summary="登出")
def logout(user: User = Depends(get_current_user)) -> dict:
    # JWT 为无状态令牌，服务端不维护会话表，登出由前端清除本地令牌完成。
    # 这里返回明确说明，避免被误认为服务端已吊销令牌。
    return {
        "ok": True,
        "message": "已登出。请同时清除客户端保存的访问令牌。",
        "note": "服务端不维护会话表，令牌在到期前仍然有效；如需强制失效请更换 JWT 密钥。",
        "username": user.username,
    }
