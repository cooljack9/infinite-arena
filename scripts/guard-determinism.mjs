#!/usr/bin/env node
/**
 * 确定性闸门：禁止在「前后端共跑」的代码层里使用跨引擎不确定的 Math 函数。
 *
 * 背景见 docs/backend/07_跨引擎浮点一致性.md。一句话版本：
 * ECMA-262 把 sin/cos/tan/atan2/hypot/exp/log/pow/cbrt 列为 implementation-approximated，
 * 允许各引擎给出不同结果；而本项目的架构假设是「后端算的过程，前端能在任意浏览器上逐 bit 复现」。
 * 演算路径上出现任何一个，Safari 玩家看到的战斗就会和服务端结算对不上。
 *
 * 允许：+ - * /、Math.sqrt / round / floor / ceil / abs / min / max / sign / trunc
 *       —— 这些由 IEEE 754 或规范正文精确定义，跨引擎必然相同。
 * 替代：src/game/engine/detmath.ts 的 dsin / dcos / dpow / dpowi / drot
 * 例外：确实需要时在该行加 `det-ok` 注释，并写明理由。
 *
 * 渲染层（src/render、src/ui）不在管辖范围——那里的抖动只影响像素，不影响结算。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** 需要逐 bit 确定的代码层 */
const GUARDED = [
  // Pure Core：前后端共跑的代码层，禁止任何跨引擎不确定运算
  'packages/core/src/engine',
  'packages/core/src/content',
  'packages/core/src/gen',
  'packages/core/src/rules',
  'packages/core/src/contract',
];

const BANNED = [
  'hypot', 'atan2', 'atan', 'acos', 'asin', 'acosh', 'asinh', 'atanh',
  'cos', 'sin', 'tan', 'cosh', 'sinh', 'tanh',
  'exp', 'expm1', 'log', 'log1p', 'log2', 'log10',
  'cbrt', 'pow', 'random',
];
const MATH_RE = new RegExp(`\\bMath\\.(${BANNED.join('|')})\\s*\\(`, 'g');
const EXP_RE = /\*\*(?!\/)/g; // ** 幂运算符 == Math.pow，同样不确定（排除块注释结尾 **/）

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * 去掉注释，避免文档里提到 `Math.hypot`、或中文注释里的 Markdown `**加粗**` 被误报。
 *
 * 坑：本仓库是 CRLF 换行，而 JS 正则里 `\r` 属于「行终止符」，`.` 不匹配它。
 * 于是 `/\/\/.*$/` 的 `$` 锚点永远落不到 `\r` 前面，**整行注释一个字都剥不掉**
 * ——第一版闸门因此刷了 20 条假警报。所以这里先统一换行、且不用 `$` 锚点。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')) // 块注释：保留换行以对齐行号
    .split('\n')
    .map((l) => l.replace(/\/\/[^\n]*/, ''))
    .join('\n');
}

const normalize = (s) => s.replace(/\r\n?/g, '\n');

/** 命中行本身、或紧贴其上的连续注释行中出现 `det-ok` 即视为已豁免 */
function hasExemption(lines, idx) {
  if (/det-ok/.test(lines[idx])) return true;
  for (let j = idx - 1; j >= 0; j--) {
    const t = lines[j].trim();
    if (!t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')) return false;
    if (/det-ok/.test(t)) return true;
  }
  return false;
}

const violations = [];
for (const dir of GUARDED) {
  let files;
  try { files = walk(join(ROOT, dir)); } catch { continue; }
  for (const file of files) {
    const raw = normalize(readFileSync(file, 'utf8'));
    const rawLines = raw.split('\n');
    const lines = stripComments(raw).split('\n');
    lines.forEach((line, i) => {
      // 显式豁免：`det-ok` 写在同行、或紧贴其上的**整个注释块**里都算
      // （理由通常要写好几句中文，硬塞同行会把代码撑得没法读）
      if (hasExemption(rawLines, i)) return;
      for (const re of [MATH_RE, EXP_RE]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line))) {
          violations.push({
            file: relative(ROOT, file),
            line: i + 1,
            what: m[0],
            src: rawLines[i].trim(),
          });
        }
      }
    });
  }
}

if (violations.length) {
  console.error('\n✗ 确定性闸门：发现跨引擎不确定的运算\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.what}`);
    console.error(`      ${v.src}`);
  }
  console.error(`
  这些函数在 ECMA-262 里是 implementation-approximated，各引擎结果可以不同。
  请改用 src/game/engine/detmath.ts：
      Math.sin/cos  → dsin / dcos
      Math.pow      → dpow（整数指数用 dpowi）
      Math.hypot    → len2d / dist（battle/common.ts）
      Math.atan2    → drot（把向量转一个角度，通常压根不需要求角）
  确有必要保留的，在该行加 \`det-ok\` 注释并写明理由。
  背景：docs/backend/07_跨引擎浮点一致性.md
`);
  process.exit(1);
}

console.log(`✓ 确定性闸门：${GUARDED.join(' / ')} 全部干净`);
