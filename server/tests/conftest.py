"""pytest 公共夹具。

关键点：必须在导入 app.core.config 之前设置 SUGUO_DATABASE_URL，
否则配置会在导入时就被固化成默认的 sugno.db，测试会污染开发库。
因此环境变量的赋值放在模块顶层、所有 app.* 导入之前。
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

_TMP_DIR = Path(tempfile.mkdtemp(prefix="suguo_test_"))
os.environ["SUGUO_DATABASE_URL"] = f"sqlite:///{(_TMP_DIR / 'test.db').as_posix()}"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="session")
def client():
    """启动应用（触发 lifespan：建表 + 首次自动灌种子数据）。"""
    from app.main import app

    with TestClient(app) as c:
        yield c

    shutil.rmtree(_TMP_DIR, ignore_errors=True)


@pytest.fixture(scope="session")
def db_session(client):
    """直连数据库的会话，用于校验落库内容（如密码哈希）。"""
    from app.db.base import SessionLocal

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _login(client: TestClient, username: str, password: str = "123456") -> str:
    r = client.post("/api/v1/auth/login",
                    json={"username": username, "password": password})
    assert r.status_code == 200, f"{username} 登录失败：{r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_headers(client):
    return {"Authorization": f"Bearer {_login(client, 'admin')}"}


@pytest.fixture(scope="session")
def viewer_headers(client):
    return {"Authorization": f"Bearer {_login(client, 'viewer')}"}


@pytest.fixture(scope="session")
def purchase_headers(client):
    return {"Authorization": f"Bearer {_login(client, 'purchase')}"}
