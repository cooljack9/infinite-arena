// 脚本层 import 改相对路径：@arena/core → ../packages/core/src/...
// （scripts/test 用 esbuild 直编，不需要 npm 链接；前端 src/ 继续用 @arena/core + vite alias）
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(p)) out.push(p);
  }
  return out;
}

const RULES = [
  ["from '@arena/core/engine/", "from '../packages/core/src/engine/"],
  ["from '@arena/core/content/", "from '../packages/core/src/content/"],
  ["from '@arena/core/gen/", "from '../packages/core/src/gen/"],
  ["from '@arena/core/contract'", "from '../packages/core/src/contract'"],
  ["from '@arena/core/rules'", "from '../packages/core/src/rules'"],
  ["from '@arena/core/types'", "from '../packages/core/src/types'"],
  ["from '@arena/core'", "from '../packages/core/src/index'"],
];

for (const dir of ['scripts', 'test']) {
  for (const f of walk(join(ROOT, dir))) {
    const src = readFileSync(f, 'utf8');
    let next = src;
    for (const [a, b] of RULES) next = next.split(a).join(b);
    if (next !== src) {
      try {
        writeFileSync(f, next);
        console.log('~', f.replace(ROOT + '\\', ''));
      } catch (e) {
        console.log('! 跳过（被锁）:', f.replace(ROOT + '\\', ''), e.code);
      }
    }
  }
}
console.log('scripts/test 相对路径化完成');
