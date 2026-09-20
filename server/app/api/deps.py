"""苏果智选 · 接口依赖。

提供两类依赖：
  - get_current_user：解析 Bearer 令牌，取回当前用户
  - require_roles(...)：按角色放行，权限不足返回 403

角色权限矩阵（rank 越大权限越高）：
  viewer(10) < manager(20) < category(30) < purchase(40) < admin(90)
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.base import get_db
from app.db.models import Role, User

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少访问令牌，请先登录。",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="访问令牌无效或已过期，请重新登录。",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(User).filter(User.username == payload.get("sub")).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在。")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账号已停用。")
    return user


def get_user_role(user: User, db: Session) -> Role | None:
    return db.query(Role).filter(Role.id == user.role_id).first()


def require_roles(*role_codes: str):
    """生成一个校验角色白名单的依赖。

    用法：Depends(require_roles("admin", "purchase"))
    """

    def _checker(
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        role = get_user_role(user, db)
        if role is None or role.code not in role_codes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"当前角色无权执行该操作。需要角色：{'、'.join(role_codes)}。",
            )
        return user

    return _checker


def require_min_rank(min_rank: int):
    """生成一个按最低权限等级放行的依赖。

    用法：Depends(require_min_rank(40))  # purchase 及以上
    """

    def _checker(
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        role = get_user_role(user, db)
        if role is None or role.rank < min_rank:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"当前角色权限不足，需要权限等级 ≥ {min_rank}。",
            )
        return user

    return _checker
