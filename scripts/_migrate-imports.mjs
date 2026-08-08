// ── 一次性迁移脚本：M1 后批量修正 import 路径 ─────────────────
// 运行：node scripts/_migrate-imports.mjs
// 跑完即删。三类文件分别处理：
//   A. packages/core/src/**     —— 内部相对路径（去掉 game/ 层、types 少一层）
//   B. src/**                   —— 前端改为 @arena/core 命名空间
//   C. scripts/*.ts, test/*.ts  —— 测试脚本改为 @arena/core
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.cwd();

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

function apply(file, rules) {
  const src = readFileSync(file, 'utf8');
  let next = src;
  for (const [from, to] of rules) next = next.split(from).join(to);
  if (next !== src) {
    writeFileSync(file, next);
    console.log(`  ~ ${file.replace(ROOT + '\\', '')}`);
  }
}

// A. core 内部
console.log('[A] core 内部相对路径');
const coreRules = [
  ["from '../game/state/slices/helpers'", "from './economy'"],
  ["from '../game/state/slices/types'", "from '../types'"],
  ["from '../game/engine", "from '../engine"],
  ["from '../game/content", "from '../content"],
  ["from '../game/gen", "from '../gen"],
  ["from '../../types'", "from '../types'"],
  ["from '../../../types'", "from '../../types'"],
  ["from './GameBackend'", "from '../contract'"],
];
for (const f of walk(join(ROOT, 'packages/core/src'))) apply(f, coreRules);

// B. 前端 src
console.log('[B] 前端 → @arena/core');
const appRules = [
  ["from '../types'", "from '@arena/core/types'"],
  ["from '../../types'", "from '@arena/core/types'"],
  ["from '../../../types'", "from '@arena/core/types'"],
  ["from '../../game/engine/", "from '@arena/core/engine/"],
  ["from '../../game/content/", "from '@arena/core/content/"],
  ["from '../../game/gen/", "from '@arena/core/gen/"],
  ["from '../game/engine/", "from '@arena/core/engine/"],
  ["from '../game/content/", "from '@arena/core/content/"],
  ["from '../game/gen/", "from '@arena/core/gen/"],
  ["from './rules'", "from '@arena/core/rules'"],
  ["from './GameBackend'", "from '@arena/core/contract'"],
];
for (const f of walk(join(ROOT, 'src'))) apply(f, appRules);

// C. scripts / test
console.log('[C] scripts/test → @arena/core');
const scriptRules = [
  ["from '../src/game/engine/", "from '@arena/core/engine/"],
  ["from '../src/game/content/", "from '@arena/core/content/"],
  ["from '../src/game/gen/", "from '@arena/core/gen/"],
  ["from '../src/types'", "from '@arena/core/types'"],
  ["from '../src/backend/rules'", "from '@arena/core/rules'"],
  ["from '../src/backend/GameBackend'", "from '@arena/core/contract'"],
];
for (const dir of ['scripts', 'test']) {
  if (!statSync(join(ROOT, dir)).isDirectory()) continue;
  for (const f of walk(join(ROOT, dir))) {
    if (f.endsWith('_migrate-imports.mjs')) continue;
    apply(f, scriptRules);
  }
}

console.log('done');
