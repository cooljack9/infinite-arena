// equipAll 串行确认验证：多件装备全穿，云端最终一致（无乐观锁互踩）
import { ARENA_CONFIG } from '../src/arena.config';
import { resetBackend } from '../src/backend/index';
import { useGame } from '../src/game/state/store';
import { isRemoteMode } from '../src/backend/storeBridge';

ARENA_CONFIG.useLocalComputation = false;
ARENA_CONFIG.supabaseUrl = 'http://127.0.0.1:8787';
ARENA_CONFIG.supabaseAnonKey = 'mock-anon';
resetBackend();

let pass = 0, fail = 0;
const check = (n: string, c: boolean, extra = '') => {
  if (c) { pass++; console.log(`  PASS  ${n}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL  ${n}  ${extra}`); }
};
const wait = (fn: () => boolean, ms = 10000) =>
  new Promise<boolean>((res) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (fn()) { clearInterval(iv); res(true); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); res(false); }
    }, 100);
  });

if (!isRemoteMode()) { console.log('✗ 非 Remote 模式'); process.exit(1); }

// 新手开局（starter kit = 2 蓝 2 白，全开箱进背包）
useGame.getState().startRun([{ id: 'h_physTank' }, { id: 'h_charge' }, { id: 'h_healer' }] as never, 'novice');
await wait(() => !!useGame.getState().run?.runId);
const drops = useGame.getState().pendingDrops;
for (const d of drops) useGame.getState().openDrop(d.id);
const okInv = await wait(() => useGame.getState().inventory.length > 0, 8000);
check('[1] 背包有装备', okInv, `库存 ${useGame.getState().inventory.length}`);
const invCount = useGame.getState().inventory.length;
if (!invCount) { console.log(`\n${fail} 失败`); process.exit(1); }

// [2] 一键装备全队
const done = useGame.getState().equipAll();
check('[2] 一键装备触发', done === invCount, `done=${done}/${invCount}`);
const equippedNow = Object.values(useGame.getState().equipped).flat().length;
check('[2b] 本地全部穿上', equippedNow === invCount, `已穿 ${equippedNow}/${invCount}`);

// [3] 等待云端串行确认完成（快照回写后仍全穿）
const ok3 = await wait(() => {
  const g = useGame.getState();
  const eq = Object.values(g.equipped).flat().length;
  return eq === invCount && g.inventory.length === 0;
}, 12000);
const g3 = useGame.getState();
check('[3] 云端最终一致（全穿无回退）', ok3,
  `已穿 ${Object.values(g3.equipped).flat().length}/${invCount}, 库存 ${g3.inventory.length}`);

console.log(`\n${fail ? `✗ ${fail} 失败` : '✓ 全部通过'}  (${pass} pass / ${fail} fail)`);
process.exit(fail ? 1 : 0);
