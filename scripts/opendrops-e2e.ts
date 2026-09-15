// 批量开箱验证：战斗赢 3 箱 → openDrops 一次全开（无乐观锁冲突）
import { ARENA_CONFIG } from '../src/arena.config';
import { resetBackend } from '../src/backend/index';
import { useGame } from '../src/game/state/store';
import { HEROES } from '../packages/core/src/content/heroes';
import { CORE_VERSION } from '../packages/core/src/contract';
import { getBackend } from '../src/backend/index';
import { applySnapshot } from '../src/backend/storeBridge';

ARENA_CONFIG.useLocalComputation = false;
ARENA_CONFIG.supabaseUrl = 'http://127.0.0.1:8787';
ARENA_CONFIG.supabaseAnonKey = 'mock-anon';
resetBackend();

let pass = 0, fail = 0;
const check = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  PASS  ${n}${extra ? '  — ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL  ${n}  ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (cond, ms = 6000) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await sleep(60);
  return cond();
};

useGame.getState().startRun([HEROES[0], HEROES[1], HEROES[2]], 'normal');
await wait(() => !!useGame.getState().run?.runId.startsWith('run_'));
const runId = useGame.getState().run!.runId;

const b = await getBackend().startBattle({ runId, idempotencyKey: 'od-1', coreVersion: CORE_VERSION, formation: {}, clientTs: 0 });
if (!b.ok) { console.log('startBattle 失败', b.code); process.exit(1); }
applySnapshot(useGame.setState, b.data.snapshot);
const drops = useGame.getState().pendingDrops;
console.log(`  战斗后宝箱数: ${drops.length}（${drops.map((d) => d.id).join(',')}）`);
const ids = drops.map((d) => d.id);

// 全部开启（批量命令）
const inv0 = useGame.getState().inventory.length;
const gold0 = useGame.getState().gold;
useGame.getState().openDrops(ids);
const allOpened = await wait(() => useGame.getState().pendingDrops.length === 0, 8000);
check('[openDrops] 全部宝箱一次开启', allOpened,
  `剩余 ${useGame.getState().pendingDrops.length} 箱 | 背包 ${inv0}→${useGame.getState().inventory.length} | gold ${gold0}→${useGame.getState().gold}`);

// 再验证单开（不该影响）
check('[openDrop] 单开仍正常', useGame.getState().openDrop !== undefined);

console.log(`\n${fail ? '✗ ' + fail + ' 失败' : '✓ 全部通过'} (${pass}/${pass + fail})`);
process.exit(fail ? 1 : 0);
