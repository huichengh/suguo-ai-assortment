"""苏果智选 · 种子数据。

从 attachments/ 的 5 个原始 CSV 原样导入，**不修改任何原始数值**。
首次启动（库为空）时自动执行，也可手动运行：

    python -m app.seed
    python -m app.seed --force     # 清空业务表后重灌

导入顺序：角色 → 门店 → 品类 → 销售 → 商品与别名 → 交易 → 算法结果 →
供应商 → 用户 → 数据质量报告 → 选品候选 → 示例审批单
"""

from __future__ import annotations

import csv
import sys
from datetime import date, timedelta
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import ATTACHMENTS_DIR
from app.core.security import hash_password
from app.db.base import SessionLocal, engine, init_db
from app.db.models import (
    AnalysisRun,
    ApprovalLog,
    ApprovalRequest,
    AssociationRule,
    AssortmentCandidate,
    CandidateScore,
    Category,
    CategoryHealth,
    CategorySale,
    DataQualityReport,
    DemandForecast,
    Product,
    ProductAlias,
    ProductSupplier,
    Role,
    Store,
    Supplier,
    Transaction,
    TransactionItem,
    User,
)
from app.services import algorithms as algo

# 演示账号。密码统一为 123456，仅用于验证角色权限矩阵。
DEMO_USERS = [
    ("admin", "系统管理员·张明", "admin"),
    ("purchase", "采购专员·李蕾", "purchase"),
    ("category", "品类经理·王涛", "category"),
    ("manager", "门店店长·陈静", "manager"),
    ("viewer", "只读用户·赵敏", "viewer"),
]

ROLES = [
    ("admin", "系统管理员", "全部菜单与系统管理权限", 90),
    ("purchase", "采购专员", "选品比较、审批中心、商品维护", 40),
    ("category", "品类经理", "品类诊断、关联分析、需求预测", 30),
    ("manager", "门店店长", "门店经营视角与补货建议", 20),
    ("viewer", "只读用户", "仅浏览，无写操作权限", 10),
]

# 演示数据中交易明细的「品类」字段粒度比 7 个一级品类更细，
# 这里单独维护一张映射，用于给商品打上一级品类。
CATEGORY_ROLE = {
    "生鲜蔬果": "目标性品类",
    "肉禽蛋品": "目标性品类",
    "粮油调味": "常规性品类",
    "食品饮料": "常规性品类",
    "日化清洁": "常规性品类",
    "家居用品": "便利性品类",
    "纺织服装": "季节性品类",
}


def _read_csv(name: str) -> list[dict]:
    path: Path = ATTACHMENTS_DIR / name
    if not path.exists():
        raise FileNotFoundError(f"缺少数据集文件：{path}")
    # 文件带 BOM，必须用 utf-8-sig 读取，否则首列名会带不可见字符
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def _f(v) -> float:
    try:
        return float(str(v).strip())
    except (TypeError, ValueError):
        return 0.0


def _i(v) -> int:
    try:
        return int(float(str(v).strip()))
    except (TypeError, ValueError):
        return 0


def _opt_i(v):
    s = str(v or "").strip()
    if s == "":
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def _opt_f(v):
    s = str(v or "").strip()
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def clear_business_tables(db: Session) -> None:
    """清空业务表。顺序按外键依赖从叶到根。"""
    for model in (
        ApprovalLog, ApprovalRequest, CandidateScore, AssortmentCandidate,
        DataQualityReport, AnalysisRun, CategoryHealth, AssociationRule,
        DemandForecast, TransactionItem, Transaction, CategorySale,
        ProductAlias, ProductSupplier, Product, Supplier, Category, User,
        Role, Store,
    ):
        db.query(model).delete()
    db.commit()


def _health_input(sales_rows: list[dict], cat_id_map: dict[str, int]) -> list[dict]:
    """把附件 CSV 行转成算法层输入。原始数值不做任何加工。"""
    return [
        {
            "cid": cat_id_map[r["品类ID"]],
            "name": r["品类名称"].strip(),
            "month": r["月份"].strip(),
            "qty": _i(r["销量(件)"]),
            "amt": _f(r["销售额(元)"]),
            "gp": _f(r["毛利额(元)"]),
            "turnover_days": _f(r["库存周转天数"]),
            "space_eff": _f(r["坪效(元/㎡/月)"]),
            "stockout": _i(r["缺货次数"]),
            "sku_count": _i(r["SKU数量"]),
        }
        for r in sales_rows
    ]


def seed_all(verbose: bool = False, force: bool = False) -> dict:
    def log(msg: str) -> None:
        if verbose:
            print(f"  {msg}", flush=True)

    init_db()
    db = SessionLocal()
    stats: dict[str, int] = {}
    try:
        if force:
            log("清空既有业务数据 …")
            clear_business_tables(db)

        if db.query(Role).count() > 0:
            log("已存在数据，跳过灌数（如需重灌请加 --force）")
            return {}

        # ---- 角色 ----
        for code, name, desc, rank in ROLES:
            db.add(Role(code=code, name=name, description=desc, rank=rank))
        db.commit()
        role_map = {r.code: r.id for r in db.query(Role).all()}
        stats["roles"] = len(role_map)
        log(f"角色 {len(role_map)} 个")

        # ---- 门店 ----
        store = Store(
            code="SG-HJHA",
            name="华润苏果（南京江宁黄金海岸广场店）",
            city="南京市",
            district="江宁区",
            address="江宁区东山镇金箔路999号黄金海岸广场B1-2层",
            business_hours="周一至周五 07:00-21:30；周六至周日 07:00-22:00",
            area_sqm=4200.0,
            opened_on=date(2015, 9, 18),
        )
        db.add(store)
        db.commit()
        db.refresh(store)
        stats["stores"] = 1
        log(f"门店：{store.name}")

        # ---- 品类 ----
        sales_rows = _read_csv("dataset_category_sales.csv")
        cat_codes: dict[str, str] = {}
        for r in sales_rows:
            cat_codes[r["品类ID"]] = r["品类名称"]
        cat_id_map: dict[str, int] = {}
        for order, (code, name) in enumerate(sorted(cat_codes.items()), start=1):
            c = Category(code=code, name=name, role=CATEGORY_ROLE.get(name, "常规性品类"),
                         sort_order=order)
            db.add(c)
            db.flush()
            cat_id_map[code] = c.id
        db.commit()
        stats["categories"] = len(cat_id_map)
        log(f"品类 {len(cat_id_map)} 个")

        # ---- 品类月度销售（原始数值原样入库）----
        sale_objs = [
            CategorySale(
                store_id=store.id,
                category_id=cat_id_map[r["品类ID"]],
                month=r["月份"].strip(),
                qty=_i(r["销量(件)"]),
                sales_amount=_f(r["销售额(元)"]),
                gross_profit=_f(r["毛利额(元)"]),
                turnover_days=_f(r["库存周转天数"]),
                space_efficiency=_f(r["坪效(元/㎡/月)"]),
                stockout_count=_i(r["缺货次数"]),
                sku_count=_i(r["SKU数量"]),
            )
            for r in sales_rows
        ]
        db.bulk_save_objects(sale_objs)
        db.commit()
        stats["categorySales"] = len(sale_objs)
        log(f"品类月度销售 {len(sale_objs)} 条")

        # ---- 商品与别名（体现「一名多码」）----
        tx_rows = _read_csv("dataset_transactions_sample.csv")
        name_meta: dict[str, dict] = {}
        alias_pairs: set[tuple[str, str]] = set()
        for r in tx_rows:
            name = r["商品名称"].strip()
            sku = r["商品编码"].strip()
            meta = name_meta.setdefault(name, {"cat": r["品类"].strip(), "prices": []})
            meta["prices"].append(_f(r["单价(元)"]))
            alias_pairs.add((name, sku))

        name_to_pid: dict[str, int] = {}
        for name, meta in name_meta.items():
            prices = [p for p in meta["prices"] if p > 0]
            p = Product(
                name=name,
                category_name=meta["cat"],
                is_private_label=False,
                unit="件",
                ref_price=round(sum(prices) / len(prices), 2) if prices else None,
                status="在售",
            )
            db.add(p)
            db.flush()
            name_to_pid[name] = p.id
        db.commit()

        db.bulk_save_objects([
            ProductAlias(product_id=name_to_pid[n], sku_code=s, source="交易明细")
            for n, s in alias_pairs
        ])
        db.commit()
        stats["products"] = len(name_to_pid)
        stats["productAliases"] = len(alias_pairs)
        log(f"商品 {len(name_to_pid)} 个 / 别名编码 {len(alias_pairs)} 条")

        # ---- 交易与明细 ----
        baskets: dict[str, list[dict]] = {}
        for r in tx_rows:
            baskets.setdefault(r["交易号"].strip(), []).append(r)

        txn_objs = []
        for txn_no, items in baskets.items():
            amount = sum(_f(i["数量"]) * _f(i["单价(元)"]) for i in items)
            d = items[0]["交易日期"].strip()
            txn_objs.append({
                "txn_no": txn_no,
                "store_id": store.id,
                "txn_date": date.fromisoformat(d) if d else None,
                "item_count": len(items),
                "amount": round(amount, 2),
            })
        db.bulk_insert_mappings(Transaction, txn_objs)
        db.commit()
        txn_id_map = {t: i for t, i in db.query(Transaction.txn_no, Transaction.id).all()}
        stats["transactions"] = len(txn_objs)

        item_objs = []
        for txn_no, items in baskets.items():
            tid = txn_id_map[txn_no]
            for it in items:
                qty = _i(it["数量"])
                price = _f(it["单价(元)"])
                item_objs.append({
                    "txn_id": tid,
                    "product_id": name_to_pid.get(it["商品名称"].strip()),
                    "sku_code": it["商品编码"].strip(),
                    "product_name": it["商品名称"].strip(),
                    "category_name": it["品类"].strip(),
                    "qty": qty,
                    "unit_price": price,
                    "amount": round(qty * price, 2),
                })
        db.bulk_insert_mappings(TransactionItem, item_objs)
        db.commit()
        stats["transactionItems"] = len(item_objs)
        log(f"交易 {len(txn_objs)} 笔 / 明细 {len(item_objs)} 条")

        # ---- 关联规则（附件参考结果，原样保留）----
        rule_rows = _read_csv("dataset_association_rules.csv")
        db.bulk_save_objects([
            AssociationRule(
                rule_no=_i(r["规则ID"]),
                antecedent=r["前项商品(A)"].strip(),
                consequent=r["后项商品(B)"].strip(),
                support=_f(r["支持度"]),
                confidence=_f(r["置信度"]),
                lift=_f(r["提升度"]),
                display_advice=r["陈列建议"].strip(),
                source="附件参考",
            )
            for r in rule_rows
        ])
        db.commit()
        stats["associationRules"] = len(rule_rows)
        log(f"关联规则 {len(rule_rows)} 条（附件参考）")

        # ---- 品类健康度（附件参考结果，原样保留）----
        health_rows = _read_csv("dataset_category_health.csv")
        db.bulk_save_objects([
            CategoryHealth(
                category_id=cat_id_map[r["品类ID"]],
                score=_f(r["综合评分"]),
                star_level=r["健康度等级"].strip(),
                rating=r["评级"].strip(),
                qty_share=_f(r["销量贡献(%)"]),
                gp_share=_f(r["毛利贡献(%)"]),
                turnover_days=_f(r["周转天数"]),
                space_score=_f(r["坪效得分"]),
                advice=r["优化建议"].strip(),
                alert_light=r["预警灯"].strip(),
                source="附件参考",
            )
            for r in health_rows
        ])
        db.commit()
        stats["categoryHealth"] = len(health_rows)
        log(f"品类健康度 {len(health_rows)} 条（附件参考）")

        # ---- 需求预测 ----
        fc_rows = _read_csv("dataset_demand_forecast.csv")
        fc_objs = []
        for r in fc_rows:
            cat_name = r["品类"].strip()
            code = next((k for k, v in cat_codes.items() if v == cat_name), None)
            if code is None:
                continue
            fc_objs.append(DemandForecast(
                category_id=cat_id_map[code],
                week_no=_i(r["周次"]),
                week_label=r["日期"].strip(),
                history_qty=_opt_i(r["历史销量(件)"]),
                forecast_qty=_opt_i(r["预测销量(件)"]),
                lower_qty=_opt_i(r["预测下界(件)"]),
                upper_qty=_opt_i(r["预测上界(件)"]),
                data_type=r["数据类型"].strip(),
            ))
        db.bulk_save_objects(fc_objs)
        db.commit()
        stats["demandForecast"] = len(fc_objs)
        log(f"需求预测 {len(fc_objs)} 条")

        # ---- 供应商（演示数据，不指向任何真实企业）----
        supplier_specs = [
            ("SUP-001", "生鲜直采基地（演示）", "华东区", "A"),
            ("SUP-002", "肉禽蛋品供应中心（演示）", "苏皖区", "A"),
            ("SUP-003", "粮油调味集采中心（演示）", "华东区", "A"),
            ("SUP-004", "食品饮料经销商（演示）", "南京市", "B"),
            ("SUP-005", "日化清洁供应商（演示）", "苏皖区", "B"),
            ("SUP-006", "家居纺织供应商（演示）", "浙沪区", "C"),
        ]
        sup_ids = []
        for code, name, contact, level in supplier_specs:
            s = Supplier(code=code, name=name, contact=contact, level=level,
                         cooperation_since=date(2020, 1, 1))
            db.add(s)
            db.flush()
            sup_ids.append(s.id)
        db.commit()

        # 按商品的一级品类挂主供
        cat_to_sup = {
            "生鲜蔬果": sup_ids[0], "肉禽蛋品": sup_ids[1], "粮油调味": sup_ids[2],
            "食品饮料": sup_ids[3], "日化清洁": sup_ids[4], "家居用品": sup_ids[5],
            "纺织服装": sup_ids[5],
        }
        links = []
        for name, pid in name_to_pid.items():
            sup = cat_to_sup.get(name_meta[name]["cat"], sup_ids[3])
            links.append({"product_id": pid, "supplier_id": sup,
                          "supply_price": None, "is_primary": True})
        db.bulk_insert_mappings(ProductSupplier, links)
        db.commit()
        # 补齐供货价：按参考零售价七折，仅用于演示
        for row in db.query(ProductSupplier).all():
            prod = db.get(Product, row.product_id)
            if prod and prod.ref_price:
                row.supply_price = round(prod.ref_price * 0.7, 2)
        db.commit()
        stats["suppliers"] = len(sup_ids)
        log(f"供应商 {len(sup_ids)} 个 / 商品供应关系 {len(links)} 条")

        # ---- 演示账号 ----
        for username, display, role_code in DEMO_USERS:
            db.add(User(
                username=username,
                password_hash=hash_password("123456"),
                display_name=display,
                role_id=role_map[role_code],
                store_id=store.id,
                is_active=True,
            ))
        db.commit()
        stats["users"] = len(DEMO_USERS)
        log(f"演示账号 {len(DEMO_USERS)} 个（密码均为 123456）")

        # ---- 数据质量报告（真实运行九类检查生成）----
        quality_specs = [
            ("category_sales", "dataset_category_sales.csv", sales_rows),
            ("transactions", "dataset_transactions_sample.csv", tx_rows),
            ("association_rules", "dataset_association_rules.csv", rule_rows),
            ("category_health", "dataset_category_health.csv", health_rows),
            ("demand_history", "dataset_demand_forecast.csv", fc_rows),
        ]
        report_count = 0
        for dtype, fname, rows in quality_specs:
            res = algo.run_quality_check(dtype, rows)
            if not res.get("ok"):
                continue
            db.add(DataQualityReport(
                check_code=dtype,
                check_name=f"{res['label']}（{fname}）",
                dimension="综合",
                status=res["grade"],
                detail=f"{res['rowCount']} 行 × {res['colCount']} 列；"
                       f"发现问题 {len(res['issues'])} 项；五维评分 {res['overall']}",
                score=res["overall"],
            ))
            report_count += 1
            log(f"数据质量：{res['label']} → {res['overall']} 分（{res['grade']}）")
        db.commit()
        stats["dataQualityReports"] = report_count

        # ---- 选品候选与维度得分（用实时算法结果填充，非硬编码）----
        health = algo.compute_category_health(
            _health_input(sales_rows, cat_id_map),
            [{"id": cat_id_map[c], "name": n} for c, n in sorted(cat_codes.items())],
        )

        cand_count = 0
        if health.get("ok"):
            for h in health["items"]:
                cand = AssortmentCandidate(
                    store_id=store.id,
                    candidate_type="品类互比",
                    name=h["name"],
                    category_id=h["cid"],
                    reason=f"综合健康度 {h['score']} 分，排名第 {h['rank']}/{len(health['items'])}",
                    status="待评估",
                )
                db.add(cand)
                db.flush()
                dims = [
                    ("销量贡献", h["qty"], h["qtyScore"], health["weights"]["qty"], "近12个月累计销量"),
                    ("毛利贡献", h["gp"], h["gpScore"], health["weights"]["gp"], "近12个月累计毛利额"),
                    ("库存周转", h["turnoverDays"] or 0, h["turnoverScore"],
                     health["weights"]["turnover"], "逆向标准化：周转天数越低越好"),
                    ("坪效", h["spaceEff"] or 0, h["spaceScore"], health["weights"]["space"],
                     "元/㎡/月"),
                ]
                for dim, raw, score, weight, basis in dims:
                    db.add(CandidateScore(
                        candidate_id=cand.id, dimension=dim, raw_value=float(raw),
                        score=float(score), weight=float(weight), basis=basis,
                    ))
                cand_count += 1
            db.commit()
        stats["candidates"] = cand_count
        log(f"选品候选 {cand_count} 个（含四维得分）")

        # ---- 示例审批单（含 1 条逾期，保证首屏「今天要处理」非空）----
        samples = [
            ("L3", "纺织服装品类退出方案审批",
             "健康度 0.6 分，坪效与周转双低，建议按 SKU 分批退出并释放货架面积。",
             "品类诊断", "涉及商品下架，属高影响决策，需采购负责人复核。",
             date.today() - timedelta(days=3)),
            ("L2", "日化清洁品类 SKU 精简建议",
             "健康度 25.4 分，建议优先精简长尾 SKU，聚焦高频刚需单品。",
             "品类诊断", "可能影响部分会员复购，建议小步验证。",
             date.today() + timedelta(days=2)),
            ("L1", "生鲜蔬果关联陈列优化提示",
             "西红柿→鸡蛋 提升度 2.45，建议生鲜区设置家常菜组合陈列位。",
             "关联分析", "仅提示，无需审批。",
             date.today() + timedelta(days=5)),
        ]
        for i, (level, title, content, module, risk, due) in enumerate(samples, start=1):
            req = ApprovalRequest(
                code=f"AP{date.today().strftime('%Y%m%d')}{i:03d}",
                level=level, title=title, content=content, source_module=module,
                risk_note=risk, status="待审批", created_by="admin", due_at=due,
            )
            db.add(req)
            db.flush()
            db.add(ApprovalLog(request_id=req.id, action="创建", operator="admin",
                               comment=f"由{module}模块生成"))
        db.commit()
        stats["approvalRequests"] = len(samples)
        log(f"示例审批单 {len(samples)} 条（含 1 条逾期）")

        return stats
    finally:
        db.close()


def main() -> None:
    force = "--force" in sys.argv
    print("=" * 74)
    print("  苏果智选 · 种子数据导入")
    print("=" * 74)
    stats = seed_all(verbose=True, force=force)
    print("-" * 74)
    if stats:
        print("  导入完成：")
        for k, v in stats.items():
            print(f"    {k:<22}{v}")
    else:
        print("  未执行导入。")
    print("=" * 74)


if __name__ == "__main__":
    main()
