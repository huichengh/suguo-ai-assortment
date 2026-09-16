#!/usr/bin/env node
/*
 * sync.js —— 一键「验证 + 提交 + 推送 + 线上复检」
 *
 * 用途：修完 bug 后跑一次，完成从本地代码到线上站点的全链路同步。
 *
 * 与 build/*.js 的区别：
 *   build/*.js 是「验证器」（只读，判断对错）
 *   sync.js    是「发布器」（写操作：git add/commit/push + 线上复检）
 *
 * 用法：
 *   node sync.js "fix: 修复 XXX 问题"          # 指定提交信息
 *   node sync.js -m "fix: ..."                 # 同上
 *   node sync.js --dry                         # 只跑验证与差异预览，不提交
 *   node sync.js --skip-live "fix: ..."        # 跳过线上复检（Pages 重建慢时用）
 *   node sync.js --no-verify "chore: ..."      # 跳过本地验证（仅文档改动时）
 *
 * 退出码：0 成功；非 0 失败（失败即中止，不会推送半成品）
 */
'use strict';

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);
const NODE = process.execPath;
const GH_DIR = 'C:\\Program Files\\GitHub CLI';
const GH = path.join(GH_DIR, 'gh.exe');

/* ---------------- 参数解析 ---------------- */
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const SKIP_LIVE = argv.includes('--skip-live');
const SKIP_VERIFY = argv.includes('--no-verify');

let message = argv
  .filter(a => !['--dry', '--skip-live', '--no-verify', '-m'].includes(a))
  .join(' ')
  .trim();

if (!message && !DRY) {
  console.error('用法: node sync.js "fix: 提交说明"\n       node sync.js --dry');
  process.exit(2);
}

/* ---------------- 输出与执行封装 ---------------- */
const LOG = [];
function log(s) { LOG.push(s); console.log(s); }
function head(t) {
  log('');
  log('─'.repeat(70));
  log('  ' + t);
  log('─'.repeat(70));
}
function fail(step, detail) {
  log('');
  log('✗ 中止于：' + step);
  if (detail) log(String(detail).trim().slice(0, 1200));
  log('');
  log('未推送任何内容，仓库保持原状。');
  process.exit(1);
}

/* git 用 bash 环境；gh 需要显式加 PATH */
const GIT_ENV = Object.assign({}, process.env, {
  PATH: GH_DIR + ';' + (process.env.PATH || ''),
});

function git(args, opts) {
  opts = opts || {};
  return execFileSync('git', args, {
    cwd: ROOT,
    env: GIT_ENV,
    encoding: 'utf8',
    stdio: opts.inherit ? 'inherit' : 'pipe',
    maxBuffer: 64 * 1024 * 1024,
  });
}
function gitSafe(args) {
  try { return { ok: true, out: git(args).trim() }; }
  catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || e.message) }; }
}
function node(script) {
  return execFileSync(NODE, [script], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
}

/* ================================================================
 * 步骤 1：环境与前置检查
 * ============================================================== */
head('步骤 1 / 6  环境检查');

const branch = gitSafe(['branch', '--show-current']);
if (!branch.ok || branch.out !== 'main') {
  fail('环境检查', '当前分支不是 main（实际：' + branch.out + '）');
}
log('✓ 当前分支 main');

const auth = gitSafe(['config', 'user.name']);
log('✓ git 身份 ' + auth.out + ' <' + gitSafe(['config', 'user.email']).out + '>');

if (!fs.existsSync(GH)) {
  log('! 未找到 gh CLI（' + GH + '），推送将走 git 凭据');
} else {
  log('✓ gh CLI 就绪');
}

const remote = gitSafe(['ls-remote', 'origin', 'refs/heads/main']);
const remoteSha = remote.ok ? remote.out.split(/\s+/)[0] : '';
const localSha = gitSafe(['rev-parse', 'HEAD']).out;
log('  本地 HEAD : ' + localSha.slice(0, 7));
log('  远端 main : ' + (remoteSha ? remoteSha.slice(0, 7) : '(读取失败)'));

/* 远端有本地没有的提交 → 先 rebase，避免把用户的网页改动覆盖掉 */
const behind = gitSafe(['rev-list', '--count', 'HEAD..origin/main']);
if (behind.ok && parseInt(behind.out, 10) > 0) {
  log('');
  log('! 远端有 ' + behind.out + ' 个本地尚无的提交，先拉取合并…');
  const r = gitSafe(['pull', '--rebase', 'origin', 'main']);
  if (!r.ok) fail('拉取远端更新', r.out);
  log('✓ 已 rebase 到远端最新');
}

/* ================================================================
 * 步骤 2：本地验证（四层）
 * ============================================================== */
const LAYERS = [
  { name: '算法单元测试', file: 'build/test_algos.js', expect: '0 失败' },
  { name: '源文件冒烟自检', file: 'build/smoke.js', expect: '全部通过' },
  { name: '打包 + 产物自检', file: 'build/bundle.js', expect: '产物自检全部通过' },
  { name: '本地产物验证', file: 'build/verify_dist.js', expect: '全部通过' },
];

if (SKIP_VERIFY) {
  head('步骤 2 / 6  本地验证（已用 --no-verify 跳过）');
} else {
  head('步骤 2 / 6  本地验证');
  for (const L of LAYERS) {
    let out = '';
    let ok = true;
    try { out = node(L.file); }
    catch (e) { ok = false; out = (e.stdout || '') + (e.stderr || ''); }

    const passed = ok && out.indexOf(L.expect) >= 0;
    const summary = (out.match(/^.*(通过|失败|PASS|FAIL).*$/gm) || []).slice(-1)[0] || '';
    log((passed ? '✓ ' : '✗ ') + L.name + '  →  ' + summary.trim().slice(0, 90));
    if (!passed) {
      fail(L.name, out.split('\n').filter(l => /FAIL|失败|错误|Error/.test(l)).slice(0, 15).join('\n'));
    }
    if (L.file === 'build/bundle.js') {
      log('    （docs/index.html 已重新生成）');
    }
  }
  log('');
  log('四层验证全部通过 ✓');
}

/* ================================================================
 * 步骤 3：差异预览
 * ============================================================== */
head('步骤 3 / 6  待提交差异');

gitSafe(['add', '-A']);
const staged = gitSafe(['diff', '--cached', '--name-status']);
const stat = gitSafe(['diff', '--cached', '--stat']);

if (!staged.out) {
  log('工作区无任何改动，无需提交。');
  log('（若刚跑过验证，产物内容未变属正常）');
  process.exit(0);
}
log(staged.out);
log('');
log(stat.out.split('\n').slice(-1)[0] || '');

/* 安全检查：误提交大文件 */
const allFiles = staged.out.split('\n').map(l => l.split(/\s+/).pop()).filter(Boolean);
const big = allFiles
  .map(f => ({ f, size: fs.existsSync(path.join(ROOT, f)) ? fs.statSync(path.join(ROOT, f)).size : 0 }))
  .filter(x => x.size > 5 * 1024 * 1024);
if (big.length) {
  fail('大文件检查', big.map(x => x.f + '  ' + (x.size / 1048576).toFixed(1) + ' MB').join('\n') +
    '\nGitHub 单文件上限 100 MB，>50 MB 会警告。请确认是否应加入 .gitignore。');
}
log('✓ 无超大文件');

/* 安全检查：不应提交的敏感/临时文件 */
const suspicious = allFiles.filter(f =>
  /(^|\/)(\.env|.*\.pem|.*\.key|.*\.db|.*\.sqlite3?)$/i.test(f) ||
  /^_/.test(path.basename(f)) || /\.log$/.test(f));
if (suspicious.length) {
  fail('敏感/临时文件检查',
    '以下文件疑似不应提交：\n' + suspicious.join('\n') +
    '\n请加入 .gitignore 或从暂存区移除后重试。');
}
log('✓ 无敏感/临时文件');

if (DRY) {
  head('DRY RUN 结束');
  log('已暂存但未提交。要撤销暂存：git reset');
  log('要实际提交推送：node sync.js "你的提交说明"');
  process.exit(0);
}

/* ================================================================
 * 步骤 4：提交
 * ============================================================== */
head('步骤 4 / 6  提交');
let commitOut = '';
try {
  commitOut = git(['commit', '-m', message]);
} catch (e) {
  fail('git commit', (e.stdout || '') + (e.stderr || e.message));
}
log(commitOut.split('\n')[0]);
const newSha = gitSafe(['rev-parse', 'HEAD']).out;
log('新提交: ' + newSha.slice(0, 7));

/* ================================================================
 * 步骤 5：推送
 * ============================================================== */
head('步骤 5 / 6  推送到 GitHub');
let pushOut = '';
try {
  pushOut = git(['push', 'origin', 'main']);
  pushOut = (pushOut || '') + '\n（git push 无输出通常表示已是最新）';
} catch (e) {
  const msg = (e.stdout || '') + (e.stderr || e.message);
  /* OAuth App 无 workflow scope 是已知限制，给出可操作提示 */
  if (/workflow/i.test(msg)) {
    fail('git push', msg +
      '\n提示：OAuth token 缺 workflow scope。本项目已刻意不依赖 Actions，' +
      '若确需推送 .github/workflows/，执行：gh auth refresh -h github.com -s workflow');
  }
  fail('git push', msg);
}
log(pushOut.trim());

const afterRemote = gitSafe(['ls-remote', 'origin', 'refs/heads/main']).out.split(/\s+/)[0];
log('');
log('远端 main 现为: ' + afterRemote.slice(0, 7));
if (afterRemote !== newSha) {
  fail('推送结果核对', '远端 SHA 与本地不一致，推送可能未生效');
}
log('✓ 本地与远端一致');

/* ================================================================
 * 步骤 6：线上复检（等 Pages 重建完成）
 * ============================================================== */
if (SKIP_LIVE) {
  head('步骤 6 / 6  线上复检（已用 --skip-live 跳过）');
  log('提示：GitHub Pages 通常 1–3 分钟重建完成，可稍后手动跑：');
  log('      node build/verify_live.js');
} else {
  head('步骤 6 / 6  等待 Pages 重建并线上复检');
  log('（Pages 重建一般 1–3 分钟，最多等 5 分钟）');

  const SITE = 'https://huichengh.github.io/suguo-ai-assortment/';
  const deadline = Date.now() + 5 * 60 * 1000;
  let liveOk = false;

  while (Date.now() < deadline) {
    let out = '';
    let ok = true;
    try { out = node('build/verify_live.js'); }
    catch (e) { ok = false; out = (e.stdout || '') + (e.stderr || ''); }

    /* 判定：验证通过 且 线上内容已含本次提交（通过比对本地文件） */
    if (ok && out.indexOf('全部通过') >= 0) {
      liveOk = true;
      log(out.split('\n').filter(l => /^\[OK\]|^\[FAIL\]|通过|一致/.test(l)).slice(0, 6).join('\n'));
      break;
    }
    process.stdout.write('.');
    execSync('"' + NODE + '" -e "setTimeout(()=>{},15000)"', { stdio: 'ignore' });
  }

  if (!liveOk) {
    log('');
    log('! 线上复检未在 5 分钟内通过（Pages 可能仍在重建，或线上仍是旧版本）');
    log('  代码已成功推送，不影响仓库正确性。稍后手动复检：');
    log('      node build/verify_live.js');
  } else {
    log('');
    log('✓ 线上站点已更新并验证通过');
  }
}

/* ================================================================
 * 汇总
 * ============================================================== */
head('同步完成');
log('提交      : ' + newSha.slice(0, 7) + '  ' + message.split('\n')[0]);
log('远端      : ' + afterRemote.slice(0, 7) + '（已一致）');
log('仓库      : https://github.com/huichengh/suguo-ai-assortment');
log('线上演示  : https://huichengh.github.io/suguo-ai-assortment/');
log('');

/* 写一份日志便于回溯 */
const logPath = path.join(ROOT, '..', '_sync_log.txt');
fs.writeFileSync(logPath, LOG.join('\n'), 'utf8');
