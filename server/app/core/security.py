"""苏果智选 · 认证与密码安全。

- 密码哈希：bcrypt（自带盐值，工作因子 12）
- 令牌：JWT（HS256），载荷含 user_id / username / role / exp
"""

from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from app.core.config import settings

# bcrypt 对超过 72 字节的输入会静默截断，先做长度保护再交给库处理
_BCRYPT_MAX_BYTES = 72


def hash_password(plain: str) -> str:
    """生成密码哈希。每次调用盐值不同，同一明文两次结果不一致属正常。"""
    raw = plain.encode("utf-8")[:_BCRYPT_MAX_BYTES]
    return bcrypt.hashpw(raw, bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """校验明文与哈希是否匹配。哈希格式非法时返回 False，不抛异常。"""
    try:
        raw = plain.encode("utf-8")[:_BCRYPT_MAX_BYTES]
        return bcrypt.checkpw(raw, hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(subject: str, extra: dict[str, Any] | None = None) -> str:
    """签发访问令牌。subject 放用户名，extra 用于携带 user_id / role。"""
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any] | None:
    """解码并校验令牌。过期或签名不符返回 None，由调用方决定如何响应。"""
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        return None
