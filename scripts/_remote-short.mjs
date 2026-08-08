// 给 run.ts / economy.ts 的指定 action 在函数体首行加 Remote 短路
import { readFileSync, writeFileSync } from 'node:fs';

const files = {
  'src/game/state/slices/run.ts': [
    'collectLoot', 'setLayer', 'addScore', 'setFailures', 'addRelic',
    'removeDeadAllies', 'commitGrowth', 'consumeBurst', 'useConsumable', 'resolveRandomEvent',
  ],
  'src/game/state/slices/economy.ts': [
    'forge', 'transferForge', 'transferForgeAll', 'fuse', 'canFuse',
    'rerollMount', 'sellHero',
  ],
};

const GUARD = '    if (isRemoteMode()) return;\n';

for (const [file, fns] of Object.entries(files)) {
  let src = readFileSync(file, 'utf8');
  for (const fn of fns) {
    // 匹配 `name: (...) => {` 或 `name: (...) => {` 的函数体首行插入
    const re = new RegExp(`(${fn}:\\s*\\([^)]*\\)\\s*=>\\s*\\{)`, 'g');
    const next = src.replace(re, `$1\n${GUARD}`);
    if (next === src) console.log('! 未命中:', fn);
    else src = next;
  }
  writeFileSync(file, src);
  console.log('~ 处理完成:', file);
}
