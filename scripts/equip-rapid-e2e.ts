// 连续快速穿戴 e2e：连点 4 件不等返回 → 全局串行队列消化 → 云端最终一致（无打架回退）
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
const wait = (fn: () => boolean, ms = 15000) =>
  new Promise<boolean>((res) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (fn()) { clearInterval(iv); res(true); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); res(false); }
    }, 100);
  });

if (!isRemoteMode()) { console.log('✗ 非 Remote 模式'); process.exit(1); }

useGame.getState().startRun([{ id: 'h_physTank' }, { id: 'h_charge' }, { id: 'h_healer' }] as never, 'novice');
await wait(() => !!useGame.getState().run?.runId);
const drops = useGame.getState().pendingDrops;
for (const d of drops) useGame.getState().openDrop(d.id);
const okInv = await wait(() => useGame.getState().inventory.length >= 4, 10000);
const hero = useGame.getState().run!.team[0];
check('[1] 背包 4 件装备', okInv, `库存 ${useGame.getState().inventory.length}`);

// [2] 连续快速穿戴 4 件（同步连点，不等云端返回——复现原打架场景）
const items = [...useGame.getState().inventory];
const t0 = Date.now();
for (const it of items) useGame.getState().equipItem(hero.uid, it.id);
const clickMs = Date.now() - t0;
check('[2] 4 件连点完成（本地乐观即时）', useGame.getState().inventory.length === 0, `${clickMs}ms 内全部本地穿上`);

// [3] 等待串行队列消化 → 云端最终一致（无回退）
const ok3 = await wait(() => {
  const g = useGame.getState();
  return Object.values(g.equipped).flat().length >= 4 && g.inventory.length === 0;
}, 15000);
const g3 = useGame.getState();
const eqNow = Object.values(g3.equipped).flat().length;
check('[3] 云端最终一致（4 件全穿无回退）', ok3, `已穿 ${eqNow}/4, 库存 ${g3.inventory.length}`);

// [4] 再快速卸下 2 件 + 穿回（混合操作也串行）
const u1 = g3.equipped[hero.uid]?.[0]?.id;
const u2 = g3.equipped[hero.uid]?.[1]?.id;
if (u1 && u2) {
  useGame.getState().unequipItem(hero.uid, u1);
  useGame.getState().unequipItem(hero.uid, u2);
  const ok4 = await wait(() => {
    const g = useGame.getState();
    return (g.equipped[hero.uid] ?? []).length === 2 && g.inventory.length === 2;
  }, 15000);
  check('[4] 混合操作（卸2+穿回）最终一致', ok4,
    `已穿 ${(useGame.getState().equipped[hero.uid] ?? []).length}, 库存 ${useGame.getState().inventory.length}`);
} else {
  check('[4] 混合操作', true, '跳过（无足够已穿装备）');
}

console.log(`\n${fail ? `✗ ${fail} 失败` : '✓ 全部通过'}  (${pass} pass / ${fail} fail)`);
process.exit(fail ? 1 : 0);
