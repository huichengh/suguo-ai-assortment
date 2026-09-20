/* ============================================================================
 * 合并脚本：把第三～六章与附录 C 的 HTML 片段合并为一份带封面与目录的完整文档
 * ----------------------------------------------------------------------------
 * 输入：deliverables/chapter3.html（含 <head> + 封面 + 正文节）
 *       deliverables/chapter4.html / chapter5.html / chapter6.html / appendixC.html（纯正文片段）
 * 输出：deliverables/report-ch3-6.html
 *
 * 合并规则（遵循 html-to-docx 引擎的 HTML 有界子集）：
 *   · <body> 下只保留三个顶层 section：封面 / 目录 / 正文
 *   · 正文内部一律用普通块，绝不嵌套 section（嵌套会降级并产生 warning）
 *   · 目录用 nav.doc-toc + 两级 ol，锚点指向正文中同名 id 的标题
 *   · 不使用 <blockquote>（已实测会吞并上一段）
 * ==========================================================================*/
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');

/* ---------- 1. 从 chapter3.html 抽出 style / 封面 / 正文节 ---------- */
const c3 = read('chapter3.html');

const styleM = c3.match(/<style>([\s\S]*?)<\/style>/);
if (!styleM) throw new Error('chapter3.html 中未找到 <style>');
let style = styleM[1];

const coverM = c3.match(/<section role="cover">([\s\S]*?)<\/section>/);
if (!coverM) throw new Error('chapter3.html 中未找到封面节');
let cover = coverM[1].trim();

const bodyM = c3.match(/<section role="body"[^>]*>([\s\S]*?)<\/section>/);
if (!bodyM) throw new Error('chapter3.html 中未找到正文节');
const c3body = bodyM[1].trim();

/* 封面补一行附录 C */
cover = cover.replace(
  /(<p class="cover-line">第六章[^<]*<\/p>)/,
  '$1\n  <p class="cover-line">附录 C　讯飞星辰 Agent 平台配置方案</p>'
);
if (!/附录 C/.test(cover)) throw new Error('封面补写附录 C 失败');

/* ---------- 2. 拼正文 ----------
 * chapter6.html 末尾带一段「附：本文件使用说明与联动修改清单」，
 * 性质是合并到原 docx 时的操作说明（工作件），不属于比赛报告正文。
 * 故在此处按 <h1>附： 边界拆开：正文进报告，说明单独成文。 */
const c6raw = read('chapter6.html').trim();
const splitIdx = c6raw.search(/<h1\s+id="[^"]*"[^>]*>附[：:]/);
if (splitIdx < 0) throw new Error('chapter6.html 中未找到「附：」分界标题');
const c6main = c6raw.slice(0, splitIdx).trim();
let guide = c6raw.slice(splitIdx).trim();
guide = guide.replace(/<h1\s+id="([^"]*)"[^>]*>[\s\S]*?<\/h1>/,
  '<h1 id="$1">第三至六章改写稿　使用说明与联动修改清单</h1>');

const frags = ['chapter4.html', 'chapter5.html'];
const parts = [c3body];
for (const f of frags) {
  const t = read(f).trim();
  if (!/^<h1 /.test(t)) throw new Error(`${f} 应以 <h1> 开头，实际开头为：${t.slice(0, 60)}`);
  parts.push(t);
}
parts.push(c6main);
parts.push(read('appendixC.html').trim());
const body = parts.join('\n\n');

/* 校验：正文中不得出现嵌套 section */
if (/<section/.test(body)) throw new Error('正文片段中存在 <section>，会导致嵌套降级，请改为普通块');
/* 校验：不得使用 blockquote */
if (/<blockquote/.test(body)) throw new Error('正文中存在 <blockquote>，会吞并上一段，请改用单元格表格');

/* ---------- 3. 自动生成两级目录 ---------- */
const headings = [];
const re = /<(h1|h2)\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g;
let m;
while ((m = re.exec(body)) !== null) {
  const text = m[3].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  headings.push({ level: Number(m[1][1]), id: m[2], text });
}
if (!headings.length) throw new Error('未解析到任何带 id 的 h1/h2 标题');

let toc = '';
let openL2 = false;
for (const h of headings) {
  if (h.level === 1) {
    if (openL2) { toc += '      </ol>\n    </li>\n'; openL2 = false; }
    toc += `    <li><a href="#${h.id}">${h.text}</a>\n`;
    // 预开二级容器；若下一个就是 h1 或结束，会在收尾处被清理
    toc += '      <ol>\n';
    openL2 = true;
  } else {
    if (!openL2) { toc += '    <li>\n      <ol>\n'; openL2 = true; }
    toc += `        <li><a href="#${h.id}">${h.text}</a></li>\n`;
  }
}
if (openL2) toc += '      </ol>\n    </li>\n';
// 清理空的二级 <ol>（某章若只有 h1 没有 h2）
toc = toc.replace(/<ol>\s*<\/ol>\s*/g, '');

const tocNav = `<nav class="doc-toc">
  <p class="toc-title">目　　录</p>
  <ol>
${toc}  </ol>
</nav>`;

/* ---------- 4. 目录相关补充样式 ---------- */
style += `
.doc-toc { margin-top: 6pt; }
.doc-toc .toc-title { font-size: 16pt; color: #1f4e79; text-align: center; margin-top: 24pt; margin-bottom: 14pt; letter-spacing: 4pt; }
.doc-toc ol { font-size: 10.5pt; line-height: 1.9; color: #1a1a1a; margin-left: 0; padding-left: 16pt; }
.doc-toc a { color: #1a1a1a; text-decoration: none; }
`;

/* ---------- 5. 组装 ---------- */
function page(opts) {
  const { title, coverHtml, sections } = opts;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>${style}</style>
</head>
<body>

${coverHtml}

${sections}

</body>
</html>
`;
}

const out = page({
  title: 'AI驱动的社区商超智能选品与品类优化研究 · 第三至六章及附录C（改写稿）',
  coverHtml: `<section role="cover">
${cover}
</section>`,
  sections: `<section role="body" data-page-restart="1">
${tocNav}
</section>

<section role="body">
${body}
</section>`,
});

fs.writeFileSync(path.join(DIR, 'report-ch3-6.html'), out, 'utf8');

/* ---------- 5b. 工作说明单独成文（不含目录，篇幅短，直接用正文节） ---------- */
if (/<section/.test(guide)) throw new Error('工作说明片段中存在 <section>，会导致嵌套降级');
const guideOut = page({
  title: '第三至六章改写稿 · 使用说明与联动修改清单',
  coverHtml: `<section role="cover">
  <p class="cover-title">第三至六章改写稿</p>
  <p class="cover-sub">使用说明与联动修改清单</p>
  <p class="cover-meta">供把改写稿合并回原《AI超市选品_场景分析报告.docx》时使用</p>
  <p class="cover-meta">2026年江苏省研究生“人工智能赋能企业管理场景应用设计”大赛</p>
</section>`,
  sections: `<section role="body" data-page-restart="1">
${guide}
</section>`,
});
fs.writeFileSync(path.join(DIR, 'report-merge-guide.html'), guideOut, 'utf8');

/* ---------- 6. 报告 ---------- */
const stat = {
  report: { file: 'deliverables/report-ch3-6.html', bytes: out.length },
  guide: { file: 'deliverables/report-merge-guide.html', bytes: guideOut.length },
  headings: headings.length,
  h1: headings.filter((h) => h.level === 1).length,
  h2: headings.filter((h) => h.level === 2).length,
  tables: (out.match(/<table/g) || []).length,
  tocEntries: (toc.match(/<li>/g) || []).length,
  sections: (out.match(/<section/g) || []).length,
};
console.log(JSON.stringify(stat, null, 2));
console.log('--- 标题清单 ---');
console.log(headings.map((h) => '  '.repeat(h.level - 1) + h.text).join('\n'));
