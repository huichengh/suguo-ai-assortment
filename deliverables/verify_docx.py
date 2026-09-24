"""转换后校验：核对 docx 结构是否符合预期，并检查页眉页脚与分节。

校验项：
  1. 节数 / 段数 / 表数
  2. 标题是否映射为 Word Heading（进导航窗格）
  3. 是否存在异常长标题（<blockquote> 吞并上一段或嵌套 section 降级的典型症状）
  4. 目录书签数 与 w:hyperlink 数
  5. 封面节不得带 header/footer 引用；正文节须带，且含 pgNumType start=1
  6. footer 含 PAGE/NUMPAGES，header 含 STYLEREF
"""
import sys
import zipfile
import re
from docx import Document
from docx.oxml.ns import qn

FAIL = []


def check(path, label, expect):
    print("=" * 72)
    print(f"[{label}] {path.split('/')[-1]}")
    print("-" * 72)
    d = Document(path)
    nsec, npar, ntab = len(d.sections), len(d.paragraphs), len(d.tables)
    print(f"节数 = {nsec}   段数 = {npar}   表数 = {ntab}")

    heads = [(p.style.name, p.text.strip()) for p in d.paragraphs
             if p.style.name.startswith("Heading")]
    h1 = [t for s, t in heads if s in ("Heading 1", "Heading 1 ")or s == "Heading 1"]
    print(f"Heading 段落数 = {len(heads)}")
    print(f"  一级标题 {sum(1 for s, _ in heads if s == 'Heading 1')} 个："
          f" {[t for s, t in heads if s == 'Heading 1']}")

    # 3. 异常长标题
    bad = [t[:70] for s, t in heads if len(t) > 45]
    print(f"异常长标题（疑似段落被吞）= {len(bad)}")
    for b in bad:
        print("   !", b)
    if bad:
        FAIL.append(f"{label}: 存在异常长标题 {len(bad)} 条")

    # 4. 书签与超链接
    with zipfile.ZipFile(path) as z:
        doc = z.read("word/document.xml").decode("utf-8")
        nbm = len(re.findall(r"<w:bookmarkStart", doc))
        nhl = len(re.findall(r"<w:hyperlink", doc))
        print(f"w:bookmarkStart = {nbm}   w:hyperlink = {nhl}")

        names = z.namelist()
        hdrs = sorted(n for n in names if re.match(r"word/header\d+\.xml$", n))
        ftrs = sorted(n for n in names if re.match(r"word/footer\d+\.xml$", n))
        print(f"页眉文件 {hdrs}   页脚文件 {ftrs}")
        hdr_txt = " ".join(z.read(h).decode("utf-8") for h in hdrs)
        ftr_txt = " ".join(z.read(f).decode("utf-8") for f in ftrs)
        print(f"  header 含 STYLEREF = {'STYLEREF' in hdr_txt}")
        print(f"  footer 含 PAGE     = {'PAGE' in ftr_txt}")
        print(f"  footer 含 NUMPAGES = {'NUMPAGES' in ftr_txt}")

        # 5. 分节检查
        sects = re.findall(r"<w:sectPr[\s\S]*?</w:sectPr>", doc)
        print(f"sectPr 数 = {len(sects)}")
        for i, s in enumerate(sects):
            has = "headerReference" in s or "footerReference" in s
            haspn = 'w:pgNumType' in s
            print(f"  第{i+1}节: header/footer引用={has}  pgNumType={haspn}"
                  + (f"  start={re.search(r'w:start=.(\d+).', s).group(1)}" if haspn else ""))

    # 6. 规模下限（阈值按“内容大量落在表格里”的实际情况设定：
    #    正文段落数天然低于表格单元格总数，故段落下限不宜设得过高）
    if expect.get("min_tables") and ntab < expect["min_tables"]:
        FAIL.append(f"{label}: 表数 {ntab} < 预期 {expect['min_tables']}")
    if expect.get("min_par") and npar < expect["min_par"]:
        FAIL.append(f"{label}: 段数 {npar} < 预期 {expect['min_par']}")
    if expect.get("min_heading") and len(heads) < expect["min_heading"]:
        FAIL.append(f"{label}: Heading 段落数 {len(heads)} < 预期 {expect['min_heading']}")
    if expect.get("expect_hyperlink") is not None:
        with zipfile.ZipFile(path) as z:
            nhl = len(re.findall(r"<w:hyperlink",
                                 z.read("word/document.xml").decode("utf-8")))
        if nhl != expect["expect_hyperlink"]:
            FAIL.append(f"{label}: 目录超链接 {nhl} ≠ 预期 {expect['expect_hyperlink']}")

    # 7. 关键词抽查：确认关键内容真的进了文档
    allt = "\n".join(p.text for p in d.paragraphs)
    for t in d.tables:
        for r in t.rows:
            for c in r.cells:
                allt += "\n" + c.text
    for kw in expect.get("keywords", []):
        hit = kw in allt
        print(f"  关键词「{kw}」= {'命中' if hit else '未命中'}")
        if not hit:
            FAIL.append(f"{label}: 关键词「{kw}」未出现在 docx 中")
    print(f"正文字符总数（含表格）≈ {len(allt)}")

    # 8. 区段禁用词：第三章 3.1／3.2 为纯理论部分，不得混入平台实现内容
    #    （3.3「痛点到AI解法的映射」按设计保留平台内容，故扫描止于 3.3 标题）
    if expect.get("forbidden_ch3"):
        seg = _section_text(d, "第三章", "3.3", end_level=2)
        print(f"  第三章 3.1—3.2 区段字符数 = {len(seg)}")
        hits = [p for p in expect["forbidden_ch3"] if p in seg]
        for p in hits:
            FAIL.append(f"{label}: 第三章 3.1／3.2 出现实现内容「{p}」（该部分应为纯理论）")
            print(f"    ✗ 禁词命中：「{p}」")
        print(f"    3.1／3.2 禁词扫描：{len(hits)} 处命中 / 共 {len(expect['forbidden_ch3'])} 项")

    # 9. 区段禁用词：全正文（第三章 至 附录 C 之前）不得出现技术标识
    #    （2026-09-24 去代码化：表名／字段名／接口路径／测试名全部改为中文业务表述；
    #      附录 C 是平台配置方案，按设计保留工具名与接口路径，不在此范围内）
    if expect.get("forbidden_body"):
        seg = _section_text(d, "第三章", "附录", end_level=1)
        print(f"  正文（第三章至附录C前）字符数 = {len(seg)}")
        hits = [p for p in expect["forbidden_body"] if p in seg]
        for p in hits:
            FAIL.append(f"{label}: 正文出现技术标识「{p}」（应已改写为中文业务表述）")
            print(f"    ✗ 正文技术标识命中：「{p}」")
        print(f"    正文技术标识扫描：{len(hits)} 处命中 / 共 {len(expect['forbidden_body'])} 项")

    # 10. 正向断言：正文不得残留等宽代码样式
    #     HTML 的 <code> 在 docx 中渲染为 Courier 等宽字体；正文改写后应为 0，
    #     附录 C 保留代码，故扫描区间止于附录 C 标题之前。
    if expect.get("no_mono_in_body"):
        fonts = _range_fonts(d, "第三章", "附录")
        mono = sorted(f for f in fonts if "Courier" in f or "Consolas" in f or "Mono" in f)
        print(f"  正文用到的西文字体 = {sorted(fonts)}")
        if mono:
            FAIL.append(f"{label}: 正文仍残留等宽代码字体 {mono}")
            print(f"    ✗ 等宽代码字体：「{mono}」")
        else:
            print("    ✓ 正文无等宽代码字体")


def _range_fonts(doc, start_kw, end_kw):
    """取 docx 中从含 start_kw 的一级标题到含 end_kw 的一级标题之间的
    所有 run 级西文字体名集合，用于检测正文是否残留 <code> 的等宽字体。"""
    fonts, inside = set(), False
    for ch in doc.element.body.iterchildren():
        if ch.tag == qn("w:p"):
            ppr = ch.find(qn("w:pPr"))
            st = ""
            if ppr is not None:
                ps = ppr.find(qn("w:pStyle"))
                if ps is not None:
                    st = (ps.get(qn("w:val")) or "").replace(" ", "")
            txt = "".join(n.text or "" for n in ch.iter(qn("w:t")))
            if st == "Heading1":
                if not inside and start_kw in txt:
                    inside = True
                    continue
                if inside and end_kw in txt:
                    break
            if inside:
                for rf in ch.iter(qn("w:rFonts")):
                    a = rf.get(qn("w:ascii")) or ""
                    if a:
                        fonts.add(a)
        elif ch.tag == qn("w:tbl") and inside:
            for rf in ch.iter(qn("w:rFonts")):
                a = rf.get(qn("w:ascii")) or ""
                if a:
                    fonts.add(a)
    return fonts


def _section_text(doc, start_kw, end_kw, end_level=1):
    """取 docx 中从含 start_kw 的一级标题，到含 end_kw 的第 end_level 级标题之间的
    全部文字（段落与表格单元格合并，按 body 顺序），用于区段级禁词扫描。"""
    from docx.oxml.ns import qn
    buf, inside, done = [], False, False
    for ch in doc.element.body.iterchildren():
        if ch.tag == qn("w:p"):
            ppr = ch.find(qn("w:pPr"))
            st = ""
            if ppr is not None:
                ps = ppr.find(qn("w:pStyle"))
                if ps is not None:
                    st = (ps.get(qn("w:val")) or "").replace(" ", "")
            txt = "".join(n.text or "" for n in ch.iter(qn("w:t")))
            if st == "Heading1" and not inside and start_kw in txt:
                inside = True
                continue
            if inside and st == f"Heading{end_level}" and end_kw in txt:
                done = True
                break
            if inside:
                buf.append(txt)
        elif ch.tag == qn("w:tbl") and inside and not done:
            for t in ch.iter(qn("w:t")):
                buf.append(t.text or "")
    return "\n".join(buf)


# 主报告
check(
    "C:/Users/84307/WorkBuddy/2026-09-16-21-00-05/suguo-ai-assortment/deliverables/"
    "苏果智选-参赛报告-第三至六章及附录C.docx",
    "主报告",
    {
        # 2026-09-24 第五轮（去代码化）：正文 299 处 <code>（ch3 17 / ch4 174 /
        # ch5 87 / ch6 21）全部改写为中文业务表述，附录 C 的 140 处按设计保留。
        # 结构量不变：3 节 / 398 段 / 60 表 / 96 Heading / 30 超链接。
        # 新增 forbidden_body（全正文技术标识）与 no_mono_in_body（正文等宽字体）两项断言。
        "min_tables": 60,
        "min_par": 395,
        "min_heading": 95,
        "expect_hyperlink": 30,
        "keywords": [
            "第三章", "第四章", "第五章", "第六章", "附录 C",
            "双轨", "拒答", "Apriori", "健康度",
            "五条硬性约束", "系统提示词", "工作流节点", "知识库",
            "当前数据不足以支持该结论",
            "基于公开行业数据构造的模拟演示数据",
            # 附录 C 按新工程口径对齐后的关键锚点（防止回退到旧原型口径）
            "11 个工具", "/api/dashboard/summary", "需补齐统一鉴权中间件",
            "20 张数据表", "同口径 Min-Max",
            # 场景分析报告体裁规范化后的锚点（2026-09-24 改写轮新增）
            "数据性质与来源说明",      # 正文前置的数据说明节
            "平台实测", "附件参考", "行业公开",   # 全文统一的三档数据标注口径
            "评分口径的校准过程",      # 原“一处算法缺陷的完整披露”改题
            "预测精度的说明",          # 原“局限说明：本稿为何不报告预测精度”改题
            "8 项经营指标",            # 原“8 项经营 KPI”，且已列出 8 项明细
            # 3.2 核心理论详述“表格改文字”后的独有表述（2026-09-24 第二轮）
            "影响可逆程度",           # 3.2.7 三级权限模型的划分依据（原表格改为行文）
            "字段级判定",             # 3.2.6 数据不足拒答的三层判定（原“三层机制”改题）
            "粒度级判定",
            "决策级判定",
            # 第三章分工调整后的锚点（第四轮：3.3 恢复平台映射并补全）
            "本章只讨论理论层面",      # 第三章开篇的定位声明（3.1／3.2 纯理论）
            "平台功能模块与输出",      # 3.3 映射表列头（恢复）
            "支撑模块（路由）",        # 3.3 新增的支撑类模块表表头
        ],
        # 第三章 3.1／3.2 须为纯理论：下列实现类字串不得出现在该区段内
        # （3.3 节按设计保留平台内容，不在此扫描范围内）
        "forbidden_ch3": [
            "/api/", "model_settings", "pytest", "is_reference",
            "/category-health", "/association", "/forecast", "/store-profile",
            "POST ", "GET ", "PATCH ", "数据来源：",
        ],
        # 全正文不得残留技术标识（附录 C 不在此范围）
        # 注意：技术栈名（FastAPI／Pydantic／pytest／React／SKU 等）属“技术选型”
        # 的必要内容，须保留，故不列入本表。
        "forbidden_body": [
            "category_sales", "transaction_items", "demand_history", "demand_forecasts",
            "association_rules", "category_health_results", "approval_requests",
            "model_settings", "is_reference", "has_sku_data", "UnboundLocalError",
            "test_", "DataFrame",
            "POST /api", "GET /api", "PATCH /api",
        ],
        # 正文不得残留等宽代码字体（附录 C 保留代码，不在扫描区间）
        "no_mono_in_body": True,
    },
)

# 使用说明
check(
    "C:/Users/84307/WorkBuddy/2026-09-16-21-00-05/suguo-ai-assortment/deliverables/"
    "苏果智选-改写稿使用说明与联动修改清单.docx",
    "使用说明",
    {"min_tables": 2, "min_par": 12, "min_heading": 5,
     "keywords": ["联动修改清单", "合并", "以文字叙述代替表格"]},
)

print()
print("=" * 72)
if FAIL:
    print(f"校验未通过，共 {len(FAIL)} 项：")
    for f in FAIL:
        print("  ✗", f)
    sys.exit(1)
print("校验全部通过")
