/*
 * bundle.js —— 单文件交付构建器
 *
 * 把 shell.html 的占位符替换为内联的 CSS 与全部 JS，
 * 输出一个零外链、可直接双击打开的单文件 HTML。
 *
 * 用法：node build/bundle.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUILD = __dirname;
/*
 * 产物目录命名为 docs/ 而非 dist/：
 * GitHub Pages 的 branch 模式只允许发布根目录 `/` 或 `/docs`，
 * 不支持自定义目录。用 docs/ 可以让 Pages 无需 Actions 即可直接上线，
 * 免去额外的 workflow 权限依赖。
 */
const OUT_DIR = path.join(ROOT, 'docs');
/*
 * 双命名输出：
 *   - index.html —— ASCII 文件名，URL 安全，供 GitHub Pages / 静态托管直接访问
 *   - 苏果智选-*.html —— 中文名，本地双击打开时便于识别
 * 两者内容完全一致。
 */
const OUT_NAME_CN = '苏果智选-AI社区商超智能选品与品类优化平台.html';
const OUT_NAME_EN = 'index.html';

/* 注意：顺序即依赖顺序，不可调整 */
const SCRIPTS = [
  'data.js',
  'algos.js',
  'app-core.js',
  'app-charts.js',
  'app-pages.js',
  'app-modules.js',
  'app-ai.js',
  /*
   * app-api.js 为后台 API 适配层，必须放最后：
   * 它需要覆写 App.getAssoc，故须在 app-core.js 定义 App 之后执行。
   * 默认保持离线（内联数据），仅在用户主动连接后台或存在历史连接配置时才接管数据源。
   */
  'app-api.js',
];

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

function bytes(s) {
  return Buffer.byteLength(s, 'utf8');
}

function kb(n) {
  return (n / 1024).toFixed(1) + ' KB';
}

/* ---------------------------------------------------------------
 * 1. 读骨架
 * ------------------------------------------------------------- */
let html = read(path.join(BUILD, 'shell.html'));

/* ---------------------------------------------------------------
 * 2. 内联 CSS：把 shell.html 中已有的 <style>...</style> 提取出来
 *    shell.html 本身就是内联样式，此处仅做完整性校验。
 * ------------------------------------------------------------- */
const styleTags = html.match(/<style[\s\S]*?<\/style>/gi) || [];
if (!styleTags.length) {
  throw new Error('shell.html 中未找到 <style> 块，无法内联 CSS');
}
const cssText = styleTags.join('\n');
console.log('[bundle] 内联 CSS          ' + kb(bytes(cssText)));

/* ---------------------------------------------------------------
 * 3. 构建 JS 大块
 * ------------------------------------------------------------- */
let jsTotal = 0;
const jsParts = SCRIPTS.map(function (f) {
  const p = path.join(BUILD, f);
  if (!fs.existsSync(p)) throw new Error('缺少脚本文件：' + f);
  const code = read(p);
  jsTotal += bytes(code);
  console.log('[bundle] 内联 ' + f.padEnd(16) + ' ' + kb(bytes(code)));
  return '/* ===== ' + f + ' ===== */\n' + code;
});

const bundleJs = [
  '/*',
  ' * 苏果智选 —— AI 社区商超智能选品与品类优化平台',
  ' * 单文件构建产物，由 build/bundle.js 自动生成，请勿直接修改本文件。',
  ' * 全部 CSS / JS / SVG 图标 / SVG 图表均已内联，零外部依赖，可离线运行。',
  ' */',
].join('\n') + '\n' + jsParts.join('\n\n');

/* ---------------------------------------------------------------
 * 4. 替换外链 script 为内联 script
 * ------------------------------------------------------------- */
const scriptRe = /[ \t]*<script src="[^"]+"><\/script>\s*\n?/g;
const matches = html.match(scriptRe) || [];
if (matches.length < SCRIPTS.length) {
  throw new Error('shell.html 中 <script src> 数量（' + matches.length +
    '）少于预期（' + SCRIPTS.length + '）');
}

// 用单个内联块替换第一处外链脚本，其余外链脚本删除
let replaced = false;
html = html.replace(scriptRe, function () {
  if (replaced) return '';
  replaced = true;
  return '<script>\n' + bundleJs + '\n</script>\n';
});

/* ---------------------------------------------------------------
 * 5. 去掉残留的独立 </script><script> 空对（若有）
 * ------------------------------------------------------------- */
html = html.replace(/<\/script>\s*<script>\s*App\.boot\(\);/g, '</script>\n<script>App.boot();');

/* ---------------------------------------------------------------
 * 6. 注入构建信息注释
 * ------------------------------------------------------------- */
const buildTime = new Date().toLocaleString('zh-CN', { hour12: false });
html = html.replace(
  /^<!DOCTYPE html>/i,
  '<!DOCTYPE html>\n<!--\n  苏果智选 · 单文件构建产物\n  构建时间：' + buildTime + '\n' +
  '  构建方式：node build/bundle.js（源文件见 build/ 目录）\n' +
  '  数据说明：内置数据集为「基于公开行业数据构造的模拟数据」，非苏果真实经营数据。\n-->'
);

/* ---------------------------------------------------------------
 * 7. 写出（双命名）
 * ------------------------------------------------------------- */
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const outCn = path.join(OUT_DIR, OUT_NAME_CN);
const outEn = path.join(OUT_DIR, OUT_NAME_EN);
fs.writeFileSync(outCn, html, 'utf8');
fs.writeFileSync(outEn, html, 'utf8');

function rel(p) { return path.relative(ROOT, p).replace(/\\/g, '/'); }

const total = bytes(html);
console.log('[bundle] JS 合计           ' + kb(jsTotal));
console.log('[bundle] 产物              ' + rel(outEn) + '（URL 安全，供静态托管）');
console.log('[bundle] 产物              ' + rel(outCn) + '（本地便于识别）');
console.log('[bundle] 产物体积          ' + kb(total));

/* ---------------------------------------------------------------
 * 8. 产物自检：确认零外链
 * ------------------------------------------------------------- */
/*
 * emoji 判定：只拦截「表情类」码位（Pictographic），放行排版符号
 * （★☆ 评分星、✓✗ 状态勾叉、·— 等）。铁律 3 的禁 emoji 是为了禁止
 * 用 emoji 充当功能图标，这些排版符号属于正常文本排版。
 */
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{1F000}-\u{1F2FF}\u{1FA70}-\u{1FAFF}]\u{FE0F}?/u;
const emojiHit = html.match(EMOJI_RE);

const checks = [
  ['无 http(s) 外部引用', !/(src|href)\s*=\s*["']https?:\/\//i.test(html.replace(/<a\s[^>]*href=["']https?:\/\/[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, ''))],
  ['无 <script src>', !/<script\s+src=/i.test(html)],
  ['无 <link rel="stylesheet">', !/<link[^>]+rel=["']stylesheet["']/i.test(html)],
  ['无 emoji 充当图标（★☆✓✗ 等排版符号除外）', !emojiHit],
  ['内联 style 块存在', /<style[\s\S]*?<\/style>/i.test(html)],
  ['内联 script 块存在', /<script>[\s\S]*?<\/script>/i.test(html)],
  ['App.boot() 调用存在', /App\.boot\(\)/.test(html)],
  ['数据真实性声明存在', html.indexOf('模拟数据') >= 0],
];

if (emojiHit) {
  const i = html.indexOf(emojiHit[0]);
  console.log('[bundle] 命中 emoji：' + JSON.stringify(emojiHit[0]) +
    ' 上下文 …' + html.slice(Math.max(0, i - 60), i + 40).replace(/\n/g, ' ') + '…');
}

let fail = 0;
checks.forEach(function (c) {
  if (!c[1]) fail++;
  console.log('[check]  ' + (c[1] ? 'OK  ' : 'FAIL') + ' ' + c[0]);
});

if (fail) {
  console.log('\n[bundle] 产物自检未通过：' + fail + ' 项');
  process.exit(1);
}
console.log('\n[bundle] 产物自检全部通过 ✓');
