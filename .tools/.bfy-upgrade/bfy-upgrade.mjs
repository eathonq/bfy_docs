#!/usr/bin/env node
// =============================================================================
// BFY GameFrame 升级同步工具 CLI v2.0
//
// 用法: 在本脚本同级目录下执行
//   node bfy-upgrade.mjs --dry-run
//   node bfy-upgrade.mjs -y
//   node bfy-upgrade.mjs --config config-hwapk.json --dry-run   # 使用其他配置
//
// 默认读取同级 config-hwrpk.json，可用 --config <file> 指定其他配置文件。
// =============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { fileURLToPath } from 'node:url';

// =========================== 加载配置 =========================================
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// --config <file> 可指定其他配置文件（相对本脚本目录解析），
// 便于在同一工具目录下维护多份框架配置（如 config-hwrpk.json / config-hwapk.json）
const RAW_ARGS = process.argv.slice(2);
const CONFIG_ARG_INDEX = RAW_ARGS.indexOf('--config');
const CONFIG_ARG = CONFIG_ARG_INDEX >= 0 ? RAW_ARGS[CONFIG_ARG_INDEX + 1] : null;
const CONFIG_PATH = CONFIG_ARG
  ? path.resolve(SCRIPT_DIR, CONFIG_ARG)
  : path.join(SCRIPT_DIR, 'config-hwrpk.json');

let CFG = {};
try {
  CFG = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
} catch (e) {
  console.error(`\x1b[31m❌ 无法读取配置: ${CONFIG_PATH}\x1b[0m\n   ${e.message}`);
  process.exit(1);
}

// 相对路径基于配置文件所在目录 (SCRIPT_DIR) 解析
const SOURCE_ROOT = path.resolve(SCRIPT_DIR, CFG.source || '');
const TARGET_ROOT = path.resolve(SCRIPT_DIR, CFG.target || '');

if (!SOURCE_ROOT) { console.error(`\x1b[31m❌ ${path.basename(CONFIG_PATH)} 中未配置 source\x1b[0m`); process.exit(1); }
if (!TARGET_ROOT) { console.error(`\x1b[31m❌ ${path.basename(CONFIG_PATH)} 中未配置 target\x1b[0m`); process.exit(1); }
if (!CFG.rules)    { console.error(`\x1b[31m❌ ${path.basename(CONFIG_PATH)} 中未配置 rules\x1b[0m`); process.exit(1); }

// =========================== TERMINAL COLORS ===================================
const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m',
  cyan: '\x1b[36m', gray: '\x1b[90m' };

// =========================== HELPERS ===========================================

function globMatch(name, patterns) {
  if (!patterns || !patterns.length) return false;
  return patterns.some(p => {
    if (p === name) return true;
    if (p.startsWith('**/')) {
      const suffix = p.slice(3);
      if (name === suffix || name.endsWith('/' + suffix)) return true;
    }
    if (p.endsWith('*') && p.indexOf('*') === p.length - 1) {
      if (name.startsWith(p.slice(0, -1))) return true;
    }
    if (p.startsWith('*.')) {
      if (name.endsWith(p.slice(1))) return true;
    }
    return false;
  });
}

function countFiles(dir, excludePatterns) {
  let count = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return 0; }
  for (const e of entries) {
    if (globMatch(e.name, excludePatterns)) continue;
    if (e.isFile()) { count++; }
    else if (e.isDirectory()) { count += countFiles(path.join(dir, e.name), excludePatterns); }
  }
  return count;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

// =========================== 规则标准化 =========================================

function normalizeRule(rule, index) {
  return {
    id:        rule.id || String(index + 1),
    name:      rule.name || `规则 ${index + 1}`,
    source:    rule.source,
    target:    rule.target,
    cleanTarget: rule.cleanTarget ?? false,
    enabled:   rule.enabled !== false,
    exclude:   rule.exclude || [],
    preserveExisting: rule.preserveExisting || [],
    linePreserve: rule.linePreserve || null,
  };
}

// =========================== 版本检测 ===========================================

function detectVersion() {
  const vd = CFG.versionDetection;
  if (!vd) return null;
  if (vd.type === 'fixed') return vd.value;

  if (vd.type === 'cocosPackageJson') {
    const field = vd.field || 'version';
    // Cocos 3.x: package.json，读配置的字段（默认 version）
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(TARGET_ROOT, 'package.json'), 'utf-8'));
      const parts = field.split('.');
      let val = pkg;
      for (const p of parts) { val = val && val[p]; }
      // 配置字段不存在时兜底 creator.version（Cocos 3.x 引擎版本字段）
      if (!val && pkg.creator) val = pkg.creator.version;
      if (val) return String(val).startsWith('3.') ? '3.x' : '2.x';
    } catch { /* package.json 不存在或无效，继续尝试 project.json */ }
    // Cocos 2.x: 没有 package.json，回退读取 project.json 的 version 字段
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(TARGET_ROOT, 'project.json'), 'utf-8'));
      if (pj && pj.version) return String(pj.version).startsWith('3.') ? '3.x' : '2.x';
    } catch { /* ignore */ }
    return null;
  }
  return null;
}

// =========================== CORE OPERATIONS ===================================

function copyFileWithTransform(srcFile, dstFile, linePreserve) {
  let needsTransform = false;
  if (linePreserve && linePreserve.patterns && linePreserve.patterns.length) {
    if (linePreserve.fileTypes && linePreserve.fileTypes.length) {
      needsTransform = linePreserve.fileTypes.some(ext => srcFile.endsWith(ext));
    } else {
      needsTransform = true;
    }
  }

  if (!needsTransform) {
    ensureDir(path.dirname(dstFile));
    fs.copyFileSync(srcFile, dstFile);
    return;
  }

  let srcContent = fs.readFileSync(srcFile, 'utf-8');
  if (fs.existsSync(dstFile)) {
    const dstContent = fs.readFileSync(dstFile, 'utf-8');
    for (const pattern of linePreserve.patterns) {
      try {
        const regex = new RegExp(pattern);
        const srcLines = srcContent.split('\n');
        const dstLines = dstContent.split('\n');
        for (let i = 0; i < srcLines.length; i++) {
          if (regex.test(srcLines[i])) {
            for (let j = 0; j < dstLines.length; j++) {
              if (regex.test(dstLines[j])) { srcLines[i] = dstLines[j]; break; }
            }
          }
        }
        srcContent = srcLines.join('\n');
      } catch { /* skip invalid regex */ }
    }
  }
  ensureDir(path.dirname(dstFile));
  fs.writeFileSync(dstFile, srcContent, 'utf-8');
}

function copyDirRecursive(srcDir, dstDir, excludePatterns, linePreserve, preserveExistingPatterns, dstStart) {
  ensureDir(dstDir);
  let entries;
  try { entries = fs.readdirSync(srcDir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (globMatch(e.name, excludePatterns)) continue;
    const src = path.join(srcDir, e.name);
    const dst = path.join(dstDir, e.name);
    if (e.isFile()) {
      if (preserveExistingPatterns && preserveExistingPatterns.length) {
        const rel = path.relative(dstStart, dst).replace(/\\/g, '/');
        if (globMatch(rel, preserveExistingPatterns) && fs.existsSync(dst)) continue;
      }
      copyFileWithTransform(src, dst, linePreserve);
    } else if (e.isDirectory()) {
      copyDirRecursive(src, dst, excludePatterns, linePreserve, preserveExistingPatterns, dstStart);
    }
  }
}

// =========================== RULE EXECUTION ====================================

function executeRule(rule, dryRun) {
  const srcPath = path.join(SOURCE_ROOT, ...rule.source.split('/'));
  const dstPath = path.join(TARGET_ROOT, ...rule.target.split('/'));
  const result = { ruleName: rule.name, deleted: 0, copied: 0, errors: [] };

  if (!fs.existsSync(srcPath)) {
    result.errors.push(`源路径不存在: ${srcPath}`);
    return result;
  }

  result.copied = countFiles(srcPath, rule.exclude);

  if (dryRun) {
    if (rule.cleanTarget && fs.existsSync(dstPath)) result.deleted = countFiles(dstPath);
    return result;
  }

  if (rule.cleanTarget && fs.existsSync(dstPath)) {
    try { fs.rmSync(dstPath, { recursive: true, force: true }); result.deleted = 1; }
    catch (e) { result.errors.push(`无法删除目标: ${e.message}`); }
  }

  try {
    copyDirRecursive(srcPath, dstPath, rule.exclude, rule.linePreserve || null, rule.preserveExisting || [], dstPath);
  } catch (e) {
    result.errors.push(`复制失败: ${e.message}`);
    result.copied = 0;
  }

  return result;
}

// =========================== CLI ===============================================

function showHelp() {
  console.log(`
${C.bold}BFY GameFrame 升级同步工具 CLI v2.0${C.reset}

${C.cyan}配置文件:${C.reset} ${CONFIG_PATH}
  source  → ${SOURCE_ROOT}
  target  → ${TARGET_ROOT}
  name    → ${CFG.name || '-'}
  rules   → ${Object.keys(CFG.rules || {}).map(v => `${v}: ${CFG.rules[v].length}条`).join(', ')}

${C.cyan}用法:${C.reset}
  node bfy-upgrade.mjs [选项]

${C.cyan}选项:${C.reset}
  --dry-run           预览变更，不实际执行
  -y, --yes           跳过确认，直接执行
  --cocos <ver>       手动指定版本 (默认自动检测)
  --config <file>     指定配置文件 (默认 config-hwrpk.json)
  -h, --help          显示此帮助
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--cocos':    opts.cocos = args[i + 1]; i++; break;
      case '--config':   opts.config = args[i + 1]; i++; break;
      case '--dry-run':  opts.dryRun = true; break;
      case '-y': case '--yes': opts.yes = true; break;
      case '-h': case '--help': opts.help = true; break;
    }
  }
  return opts;
}

function printRuleDetail(rule) {
  let d = '';
  if (rule.exclude.length) d += `\n  ${C.gray}排除: ${rule.exclude.join(', ')}${C.reset}`;
  if (rule.preserveExisting?.length) d += `\n  ${C.cyan}🛡 已存在则保留: ${rule.preserveExisting.join(', ')}${C.reset}`;
  if (rule.linePreserve?.patterns?.length) {
    const t = rule.linePreserve.fileTypes?.length ? ` (${rule.linePreserve.fileTypes.join(', ')})` : '';
    d += `\n  ${C.cyan}🔒 行保留${t}: ${rule.linePreserve.patterns.length} 条规则${C.reset}`;
  }
  return d;
}

// =========================== MAIN ==============================================

async function main() {
  const opts = parseArgs();
  if (opts.help) { showHelp(); process.exit(0); }

  // 校验路径
  if (!fs.existsSync(SOURCE_ROOT)) {
    console.error(`${C.red}❌ 框架源目录不存在: ${SOURCE_ROOT}${C.reset}`); process.exit(1);
  }
  if (!fs.existsSync(TARGET_ROOT)) {
    console.error(`${C.red}❌ 目标项目不存在: ${TARGET_ROOT}${C.reset}`); process.exit(1);
  }

  // 版本检测
  const cocosExplicit = !!opts.cocos;
  let version;
  if (opts.cocos) {
    version = opts.cocos;
  } else {
    const detected = detectVersion();
    if (detected) {
      version = detected;
      console.log(`${C.dim}🔍 自动检测到 Cocos 版本 ${detected}${C.reset}`);
    } else {
      version = CFG.defaultVersion;
      console.log(`${C.yellow}⚠ 无法检测版本，使用默认值 ${version}${C.reset}`);
    }
  }

  // 加载规则
  const rules = (CFG.rules[version] || []).map((r, i) => normalizeRule(r, i));
  const enabledRules = rules.filter(r => r.enabled);

  if (!enabledRules.length) {
    console.error(`${C.red}❌ 版本 ${version} 下无可用规则${C.reset}`);
    process.exit(1);
  }

  // 头部
  const detectNote = cocosExplicit ? '' : `  ${C.dim}(自动检测)${C.reset}`;

  console.log(`\n${C.bold}${'═'.repeat(60)}${C.reset}`);
  console.log(`${C.bold}  ${CFG.name || 'BFY Upgrade'}  ·  ${version}${detectNote}${C.reset}`);
  console.log(`${C.bold}${'═'.repeat(60)}${C.reset}\n`);
  console.log(`${C.cyan}源:${C.reset}   ${SOURCE_ROOT}`);
  console.log(`${C.cyan}目标:${C.reset} ${TARGET_ROOT}`);
  console.log(`${C.cyan}规则:${C.reset} ${enabledRules.length} 条\n`);

  if (CFG.description) console.log(`${C.dim}${CFG.description}${C.reset}\n`);

  // Dry-run
  if (opts.dryRun) {
    console.log(`\n${C.bold}${C.yellow}🔍 预览模式 (DRY RUN) — 不会实际修改文件${C.reset}\n`);
    let totalDel = 0, totalCopy = 0;

    for (const rule of enabledRules) {
      console.log(`${C.bold}── ${rule.name}${C.reset}`);
      const result = executeRule(rule, true);
      if (result.errors.length) {
        result.errors.forEach(e => console.log(`  ${C.red}❌ ${e}${C.reset}`));
        continue;
      }
      if (rule.cleanTarget && result.deleted) {
        console.log(`  ${C.yellow}🗑 将删除 ${result.deleted} 个文件 (${rule.target})${C.reset}`);
      }
      console.log(`  ${C.green}📋 将复制 ${result.copied} 个文件 → ${rule.target}${C.reset}`);
      console.log(printRuleDetail(rule));
      totalDel += result.deleted;
      totalCopy += result.copied;
    }

    console.log(`\n${C.bold}${'─'.repeat(60)}${C.reset}`);
    console.log(`${C.bold}合计: 删除 ${totalDel} 文件, 新增 ${totalCopy} 文件${C.reset}\n`);
    return;
  }

  // 项目识别
  console.log(`${C.dim}🔍 项目识别:${C.reset}`);
  const markers = [...new Set(enabledRules.map(r => r.target))];
  for (const m of markers) {
    const exists = fs.existsSync(path.join(TARGET_ROOT, ...m.split('/')));
    console.log(`  ${exists ? C.green + '✅' : C.yellow + '❌'}${C.reset} ${m}`);
  }
  const found = markers.filter(m => fs.existsSync(path.join(TARGET_ROOT, ...m.split('/')))).length;
  const threshold = Math.max(Math.min(4, markers.length), Math.floor(markers.length * 0.5));
  const sourceLabel = CFG.name || path.basename(SOURCE_ROOT);
  if (found >= threshold) {
    console.log(`  ${C.green}识别为 ${sourceLabel} 项目 (${found}/${markers.length})${C.reset}\n`);
  } else if (found > 0) {
    console.log(`  ${C.yellow}部分匹配 (${found}/${markers.length})${C.reset}\n`);
  } else {
    console.log(`  ${C.yellow}未识别到框架特征（目标项目尚未安装过该框架，首次同步属正常）${C.reset}\n`);
  }

  // 确认
  if (!opts.yes) {
    const cleanCount = enabledRules.filter(r => r.cleanTarget).length;
    console.log(`${C.bold}${C.yellow}⚠ 即将执行同步:${C.reset}`);
    console.log(`   ${cleanCount} 条规则将${C.red}先删除目标再复制${C.reset}`);
    console.log(`   ${enabledRules.length - cleanCount} 条规则为${C.green}覆盖合并${C.reset}`);
    console.log(`\n  ${C.red}此操作不可撤销！${C.reset}`);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => {
      rl.question(`\n  确认继续？(y/N): `, a => { rl.close(); resolve(a.trim().toLowerCase()); });
    });
    if (answer !== 'y' && answer !== 'yes') {
      console.log(`${C.gray}已取消${C.reset}\n`);
      process.exit(0);
    }
  }

  // 执行
  console.log(`\n${C.bold}${'═'.repeat(60)}${C.reset}`);
  console.log(`${C.bold}  开始同步${C.reset}`);
  console.log(`${C.bold}${'═'.repeat(60)}${C.reset}\n`);

  const t0 = performance.now();
  let success = 0, fail = 0, totalFiles = 0;

  for (let i = 0; i < enabledRules.length; i++) {
    const rule = enabledRules[i];
    process.stdout.write(`${C.cyan}[${i + 1}/${enabledRules.length}] ${rule.name}${C.reset} ... `);

    const result = executeRule(rule, false);

    if (result.errors.length) {
      console.log(`${C.red}❌ 失败${C.reset}`);
      result.errors.forEach(e => console.log(`    ${C.red}${e}${C.reset}`));
      fail++;
    } else {
      console.log(`${C.green}${rule.cleanTarget ? '🗑+📋' : '📋'} ${result.copied} 文件${C.reset}`);
      totalFiles += result.copied;
      success++;
    }
  }

  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`\n${C.bold}${'═'.repeat(60)}${C.reset}`);
  console.log(`${C.bold}  同步完成: ${success} 成功, ${fail} 失败, ${totalFiles} 文件, 耗时 ${elapsed}s${C.reset}`);
  console.log(`${C.bold}${'═'.repeat(60)}${C.reset}\n`);
}

main().catch(e => {
  console.error(`${C.red}未捕获错误:${C.reset}`, e);
  process.exit(1);
});
