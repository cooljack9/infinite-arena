// 补充迁移：slices 层引用（../../engine、../../content、../../gen 无 game/ 前缀）
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'src/game/state/slices';
const rules = [
  ["from '../../engine/", "from '@arena/core/engine/"],
  ["from '../../content/", "from '@arena/core/content/"],
  ["from '../../gen/", "from '@arena/core/gen/"],
];
for (const f of readdirSync(dir)) {
  if (!/\.tsx?$/.test(f)) continue;
  const p = join(dir, f);
  const src = readFileSync(p, 'utf8');
  let next = src;
  for (const [a, b] of rules) next = next.split(a).join(b);
  if (next !== src) {
    writeFileSync(p, next);
    console.log('~', p);
  }
}
console.log('slices 补充完成');
