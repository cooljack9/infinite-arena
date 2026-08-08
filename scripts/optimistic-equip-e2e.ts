// 乐观穿戴验证：equip/unequip 本地立即生效 + 云端最终一致
import { ARENA_CONFIG } from '../src/arena.config';
import { resetBackend } from '../src/backend/index';
import { useGame } from '../src/game/state/store';
import { isRemoteMode } from '../src/backend/storeBridge';
import { HEROES } from '../packages/core/src/content/heroes';
import { CORE_VERSION } from '../packages/core/src/contract';
import { getBackend } from '../src/backend/index';

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

check('Remote 模式生效', isRemoteMode());

// 开局 + 打一场赢装备
useGame.getState().startRun([HEROES[0], HEROES[1], HEROES[2]], 'normal');
await wait(() => !!useGame.getState().run?.runId.startsWith('run_'));
const runId = useGame.getState().run!.runId;
const battle = await getBackend().startBattle({ runId, idempotencyKey: 'opt-b', coreVersion: CORE_VERSION, formation: {}, clientTs: 0 });
useGame.getState().setBattleRemote({ outcome: battle.data.outcome, snapshot: battle.data.snapshot, replay: battle.data.replay });
const { applySnapshot } = await import('../src/backend/storeBridge');
applySnapshot(useGame.setState, battle.data.snapshot);
const st = useGame.getState();
console.log('  战斗后: gold=' + st.gold + ' pendingDrops=' + st.pendingDrops.length + ' shopEq=' + st.shopStock.equipment.length + ' inv=' + st.inventory.length);
console.log('  掉落箱:', st.pendingDrops.map((d) => d.id + ':' + d.reward).join(', '));
// 开所有箱 + 商店买一件，确保 inventory 有装备
const drops = useGame.getState().pendingDrops;
for (const d of drops) useGame.getState().openDrop(d.id);
await sleep(1200);
if (useGame.getState().inventory.length === 0) {
  const gold = useGame.getState().gold;
  const item = [...useGame.getState().shopStock.equipment, ...useGame.getState().shopStock.consumables]
    .find((x) => x.basePrice <= gold && 'kind' in x && x.kind === 'equip');
  const anyEq = [...useGame.getState().shopStock.equipment].find((x) => x.basePrice <= gold);
  if (anyEq) {
    useGame.getState().buyItem(anyEq.id);
    await sleep(1200);
  }
}
const item = useGame.getState().inventory[0];
const hero = useGame.getState().run!.team[0];
console.log(`  准备: 装备=${item?.id ?? '无'} (库存 ${useGame.getState().inventory.length}) 英雄=${hero.uid}`);

if (item) {
  // 乐观穿戴：调用后立即检查本地（不等云端）
  useGame.getState().equipItem(hero.uid, item.id);
  const worn = (useGame.getState().equipped[hero.uid] ?? []).some((e) => e.id === item.id);
  const invShrunk = !useGame.getState().inventory.some((e) => e.id === item.id);
  check('[equip] 本地立即生效（乐观）', worn && invShrunk, `equipped=${worn} inv移除=${invShrunk}`);

  // 等云端确认（快照覆盖后仍穿着 = 云端一致）
  await wait(() => useGame.getState().equipped[hero.uid]?.some((e) => e.id === item.id), 4000);
  check('[equip] 云端最终一致', (useGame.getState().equipped[hero.uid] ?? []).some((e) => e.id === item.id));

  // 乐观卸装
  useGame.getState().unequipItem(hero.uid, item.id);
  const off = !(useGame.getState().equipped[hero.uid] ?? []).some((e) => e.id === item.id);
  const back = useGame.getState().inventory.some((e) => e.id === item.id);
  check('[unequip] 本地立即生效（乐观）', off && back, `卸下=${off} 回包=${back}`);
  await wait(() => !(useGame.getState().equipped[hero.uid] ?? []).some((e) => e.id === item.id), 4000);
  check('[unequip] 云端最终一致', !(useGame.getState().equipped[hero.uid] ?? []).some((e) => e.id === item.id));
}

console.log(`\n${fail ? '✗ ' + fail + ' 失败' : '✓ 全部通过'} (${pass}/${pass + fail})`);
process.exit(fail ? 1 : 0);
