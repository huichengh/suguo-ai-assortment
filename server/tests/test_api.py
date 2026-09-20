"""苏果智选 · 后台接口测试（共 10 项）。

覆盖三类风险：
  ① 认证与权限：登录、令牌、角色拦截
  ② 算法正确性：与前端 algos.js 结果对照、逆向标准化、阈值约束
  ③ 产品原则：数据不足必须明确拒答，不得伪造；L3 高影响必须留审批理由

运行：  pytest -q
"""

from __future__ import annotations

import bcrypt
import pytest

# ==================== ① 认证与权限 ====================


def test_01_login_success(client):
    """登录成功应返回令牌、有效期与用户信息，并带出角色。"""
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "123456"})
    assert r.status_code == 200
    body = r.json()
    assert body["access_token"]
    assert body["token_type"] == "bearer"
    assert body["expires_in"] > 0
    assert body["user"]["username"] == "admin"
    assert body["user"]["role"]["code"] == "admin"


def test_02_login_wrong_password_rejected(client):
    """密码错误返回 401，且提示不区分「用户不存在」与「密码错误」。"""
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "wrong-pwd"})
    assert r.status_code == 401
    assert "不正确" in r.json()["detail"]

    r2 = client.post("/api/v1/auth/login",
                     json={"username": "no-such-user", "password": "123456"})
    assert r2.status_code == 401
    # 两种失败必须给出同一条提示，避免被用来枚举账号
    assert r2.json()["detail"] == r.json()["detail"]


def test_03_protected_endpoint_requires_token(client):
    """受保护接口无令牌返回 401，伪令牌同样被拒。"""
    assert client.get("/api/v1/analysis/dashboard").status_code == 401
    bad = client.get("/api/v1/analysis/dashboard",
                     headers={"Authorization": "Bearer not-a-real-token"})
    assert bad.status_code == 401


def test_04_password_stored_as_bcrypt_hash(db_session):
    """密码必须以 bcrypt 哈希存储，库内不得出现明文。"""
    from app.db.models import User

    user = db_session.query(User).filter(User.username == "admin").first()
    assert user is not None
    assert user.password_hash != "123456"
    assert user.password_hash.startswith("$2")           # bcrypt 标识
    assert len(user.password_hash) == 60
    assert bcrypt.checkpw(b"123456", user.password_hash.encode()) is True
    assert bcrypt.checkpw(b"654321", user.password_hash.encode()) is False


# ==================== ② 算法正确性 ====================


def test_05_category_health_matches_frontend(client, admin_headers):
    """后端健康度评分必须与前端 algos.js 的实测值一致。

    期望值取自前端线上产物 verify_live.js 的实际输出。前后端是两套独立实现，
    能对上说明算法口径（分位收敛 / 逆向标准化 / 60%-40% 混合基准）被正确平移。
    """
    expected = {
        "生鲜蔬果": 100.0, "肉禽蛋品": 77.7, "食品饮料": 70.6, "粮油调味": 50.3,
        "日化清洁": 25.4, "家居用品": 13.5, "纺织服装": 0.6,
    }
    r = client.post("/api/v1/analysis/health", json={"months": 12}, headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["monthCount"] == 12
    assert len(body["items"]) == 7

    actual = {it["name"]: it["score"] for it in body["items"]}
    assert set(actual) == set(expected)
    for name, exp in expected.items():
        assert abs(actual[name] - exp) < 0.15, \
            f"{name} 后端 {actual[name]} 与前端期望 {exp} 不一致"

    # 排序与排名必须单调
    scores = [it["score"] for it in body["items"]]
    assert scores == sorted(scores, reverse=True)
    assert [it["rank"] for it in body["items"]] == list(range(1, 8))


def test_06_turnover_uses_reverse_normalization(client, admin_headers):
    """周转天数越低，得分必须越高 —— 这是逆向标准化的核心断言。

    如果误用正向标准化，周转最慢的纺织服装会拿到最高分，结论会完全反过来。
    """
    r = client.post("/api/v1/analysis/health", json={"months": 12}, headers=admin_headers)
    items = {it["name"]: it for it in r.json()["items"]}

    fresh, textile = items["生鲜蔬果"], items["纺织服装"]
    assert fresh["turnoverDays"] < textile["turnoverDays"], "前置条件：生鲜周转应快于纺织"
    assert fresh["turnoverScore"] > textile["turnoverScore"], \
        "逆向标准化失效：周转更慢的品类反而得分更高"

    # 五级分档必须与分数一致
    for it in items.values():
        s = it["score"]
        if s >= 85:
            assert it["grade"] == "优秀"
        elif s >= 70:
            assert it["grade"] == "良好"
        elif s >= 55:
            assert it["grade"] == "一般"
        elif s >= 40:
            assert it["grade"] == "较差"
        else:
            assert it["grade"] == "差"


def test_07_apriori_rules_respect_thresholds(client, admin_headers):
    """Apriori 产出的每条规则都必须满足支持度/置信度/提升度阈值。"""
    payload = {"min_support": 0.02, "min_confidence": 0.50, "min_lift": 1.5,
               "top_n": 30, "aggregate_by": "name"}
    r = client.post("/api/v1/analysis/apriori", json=payload, headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["basketCount"] == 5000
    assert len(body["rules"]) > 0, "演示数据集应能挖出关联规则"

    for rule in body["rules"]:
        assert rule["support"] >= 0.02
        assert rule["confidence"] >= 0.50
        assert rule["lift"] >= 1.5
        # 提升度按降序输出
    lifts = [r_["lift"] for r_ in body["rules"]]
    assert lifts == sorted(lifts, reverse=True)
    assert len(body["topRules"]) <= 30


def test_08_viewer_role_forbidden_on_user_admin(client, viewer_headers):
    """只读用户访问用户管理必须被拦截为 403，而不是 401 或 200。"""
    r = client.get("/api/v1/users", headers=viewer_headers)
    assert r.status_code == 403
    assert "角色" in r.json()["detail"]

    # 同一账号读驾驶舱应放行，说明不是令牌本身失效
    ok = client.get("/api/v1/analysis/dashboard", headers=viewer_headers)
    assert ok.status_code == 200


# ==================== ③ 产品原则 ====================


def test_09_approval_workflow_and_l3_guard(client, admin_headers, purchase_headers):
    """审批闭环：创建 → L3 无理由必须被拒 → 补理由后通过 → 不可重复审批。"""
    created = client.post(
        "/api/v1/approvals",
        json={
            "title": "pytest 自动化用例：纺织服装品类退出方案",
            "level": "L3",
            "content": "健康度 0.6 分，建议分批退出。",
            "source_module": "自动化测试",
            "risk_note": "涉及商品下架，属高影响决策。",
        },
        headers=admin_headers,
    )
    assert created.status_code == 201
    req = created.json()
    assert req["status"] == "待审批"
    assert req["code"].startswith("AP")
    assert len(req["logs"]) == 1          # 创建即写入一条流水

    # L3 高影响建议缺失审批理由时必须驳回
    no_reason = client.post(f"/api/v1/approvals/{req['id']}/decide",
                            json={"action": "通过"}, headers=purchase_headers)
    assert no_reason.status_code == 400
    assert "审批理由" in no_reason.json()["detail"]

    # 补上理由后通过
    ok = client.post(f"/api/v1/approvals/{req['id']}/decide",
                     json={"action": "通过", "comment": "已核对坪效与周转数据，同意分批退出。"},
                     headers=purchase_headers)
    assert ok.status_code == 200
    assert ok.json()["status"] == "已通过"

    # 重复审批必须被拒，避免状态被反复改写
    again = client.post(f"/api/v1/approvals/{req['id']}/decide",
                        json={"action": "驳回", "comment": "重复操作"},
                        headers=purchase_headers)
    assert again.status_code == 409


def test_10_insufficient_data_is_refused_not_fabricated(client, admin_headers):
    """数据不足时必须明确拒答，绝不返回伪造结果。

    场景一：家居用品没有需求预测数据（附件仅覆盖 5 个品类）。
    场景二：SKU 级比较缺少 SKU 级经营指标。
    两者都必须返回 ok=false + insufficient=true + 可读原因，而非 200 带假数字。
    """
    from app.db.models import Category
    from app.db.base import SessionLocal

    db = SessionLocal()
    try:
        home = db.query(Category).filter(Category.name == "家居用品").first()
        assert home is not None, "前置条件：应存在「家居用品」品类"
        home_id = home.id
    finally:
        db.close()

    # 场景一：无预测数据的品类
    r = client.get(f"/api/v1/analysis/trend/{home_id}", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert body["insufficient"] is True
    assert "家居用品" in body["reason"]
    assert "delta" not in body or body.get("delta") is None, "拒答时不得给出环比数字"

    # 场景二：SKU 级比较
    cats = client.get("/api/v1/categories", headers=admin_headers).json()
    two_ids = [c["id"] for c in cats[:2]]
    r2 = client.post("/api/v1/analysis/compare",
                     json={"candidate_ids": two_ids, "mode": "sku"},
                     headers=admin_headers)
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["ok"] is False
    assert body2["insufficient"] is True
    assert "SKU" in body2["reason"]
    assert "items" not in body2 or not body2.get("items"), "拒答时不得返回评分列表"


def test_11_missing_required_columns_refused_not_scored(client, admin_headers):
    """缺少必需字段时必须拒答，不得给出评分与等级。

    回归用例：此前实现只把缺字段记为一条 high 级问题（扣 20 分），
    导致「一个必填字段都没有」的文件仍能拿到 90+ 分、评级「优」，
    与平台「可信优先」原则及数据字典规范直接冲突。
    正确行为：ok=false + insufficient=true + 列出缺失字段，且不含 overall/grade/dims。
    """
    # 用「品类销售数据」的列去冒充「SKU 候选商品数据」——五个必填字段全部缺失
    wrong_rows = [
        {"品类ID": "C001", "品类名称": "生鲜蔬果", "月份": "2026-01",
         "销量(件)": "100", "销售额(元)": "1000"},
    ]
    r = client.post("/api/v1/analysis/quality-check",
                    json={"dataset_type": "sku_candidate", "rows": wrong_rows},
                    headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert body["insufficient"] is True
    # 缺字段不得被静默地「扣点分就算了」
    assert "overall" not in body, "拒答时不得给出综合评分"
    assert "grade" not in body, "拒答时不得给出等级"
    assert "dims" not in body, "拒答时不得给出五维评分"
    # 缺失字段必须被完整列出
    for col in ("SKU", "商品名称", "品类", "采购价", "零售价"):
        assert col in body["missingColumns"]
    assert "缺少必需字段" in body["reason"]
    assert body["issues"][0]["severity"] == "high"

    # 对照：字段齐备时正常给出评分，确认拒答只由缺字段触发
    ok_rows = [
        {"SKU": "S1", "商品名称": "牛奶", "品类": "食品饮料",
         "采购价": "3.5", "零售价": "5.9"},
        {"SKU": "S2", "商品名称": "面包", "品类": "食品饮料",
         "采购价": "4.2", "零售价": "7.5"},
    ]
    r2 = client.post("/api/v1/analysis/quality-check",
                     json={"dataset_type": "sku_candidate", "rows": ok_rows},
                     headers=admin_headers)
    body2 = r2.json()
    assert body2["ok"] is True
    assert "overall" in body2 and "grade" in body2
    assert body2["missingColumns"] == []
