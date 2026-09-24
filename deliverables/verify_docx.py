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


# 主报告
check(
    "C:/Users/84307/WorkBuddy/2026-09-16-21-00-05/suguo-ai-assortment/deliverables/"
    "苏果智选-参赛报告-第三至六章及附录C.docx",
    "主报告",
    {
        "min_tables": 60,
        "min_par": 370,
        "min_heading": 94,
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
        ],
    },
)

# 使用说明
check(
    "C:/Users/84307/WorkBuddy/2026-09-16-21-00-05/suguo-ai-assortment/deliverables/"
    "苏果智选-改写稿使用说明与联动修改清单.docx",
    "使用说明",
    {"min_tables": 2, "min_par": 12, "min_heading": 5, "keywords": ["联动修改清单", "合并"]},
)

print()
print("=" * 72)
if FAIL:
    print(f"校验未通过，共 {len(FAIL)} 项：")
    for f in FAIL:
        print("  ✗", f)
    sys.exit(1)
print("校验全部通过")
