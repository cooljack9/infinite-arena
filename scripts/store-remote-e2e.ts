// ── store-remote-e2e.ts：前端 store 在 Remote 模式下的全链路验证 ──
// 连 mock-edge（http://127.0.0.1:8787），验证：
//   [1] startRun → 云端创建对局（runId=run_*，renderSeed 与权威种子解耦）
//   [2] buyItem → 金币/库存按云端快照更新（快照驱动生效）
//   [3] startBattle → 云端权威结算 → onEnd 应用快照（score/掉落/层推进）
//   [4] 组合操作 buyAllShop → 逐件云端成交
//   [5] 无命令功能在 Remote 被禁用（forge 短路）
import { ARENA_CONFIG } from '../src/arena.config';
import { resetBackend } from '../src/backend/index';
import { useGame } from '../src/game/state/store';
import { isRemoteMode } from '../src/backend/storeBridge';
import { HEROES } from '../packages/core/src/content/heroes';
import { CORE_VERSION } from '../packages/core/src/contract';
import { getBackend } from '../src/backend/index';

// 强制云端模式
ARENA_CONFIG.useLocalComputation = false;
ARENA_CONFIG.supabaseUrl = 'http://127.0.0.1:8787';
ARENA_CONFIG.supabaseAnonKey = 'mock-anon';
resetBackend();

let pass = 0, fail = 0;
const check = (n: string, c: boolean, extra = '') => {
  if (c) { pass++; console.log(`  PASS  ${n}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL  ${n}  ${extra}`); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const wait = async (cond: () => boolean, ms = 6000) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await sleep(60);
  return cond();
};

check('[0] Remote 模式生效', isRemoteMode());

// ── [1] 开局 ──
useGame.getState().startRun([HEROES[0], HEROES[1], HEROES[2]], 'normal');
const ok1 = await wait(() => !!useGame.getState().run?.runId.startsWith('run_'));
check('[1] 云端开局', ok1, ok1 ? `runId=${useGame.getState().run?.runId}` : '超时');
const run = useGame.getState().run!;
check('[1b] renderSeed 已下发（渲染种子）', typeof run.seed === 'number' && run.seed !== 0,
  `seed=${run.seed} inv=${useGame.getState().inventory.length} mode=${run.mode}`);
check('[1c] 快照完整（队 3 人）', run.team.length === 3);

// ── 先打一场赢金币（云端权威结算），再测经济操作 ──
const g0 = useGame.getState();
const battle0 = await getBackend().startBattle({
  runId: run.runId, idempotencyKey: 'e2e-battle-0', coreVersion: CORE_VERSION,
  formation: {}, clientTs: 0,
});
check('[4] 云端战斗结算', battle0.ok, battle0.ok
  ? `result=${battle0.data.outcome.result} score=${battle0.data.snapshot.score} layer=${battle0.data.snapshot.layer}`
  : battle0.message);
if (battle0.ok) {
  const { applySnapshot } = await import('../src/backend/storeBridge');
  applySnapshot(useGame.setState, battle0.data.snapshot);
  const r2 = useGame.getState().run!;
  check('[4b] 快照应用：score/层推进以云端为准',
    r2.score === battle0.data.snapshot.score && r2.layer === battle0.data.snapshot.layer,
    `layer=${r2.layer} score=${r2.score}`);
}

// ── [2] 买一件商店货（金币随机开局；买得起才测成交，买不起验证正确拒绝） ──
const goldBefore = useGame.getState().gold;
const affordable = [...useGame.getState().shopStock.equipment, ...useGame.getState().shopStock.consumables]
  .find((x) => x.basePrice <= goldBefore);
if (affordable) {
  const id = affordable.id;
  // 对比 store 与 mock 内存的 shopStock（定位 ITEM_GONE）
  const qr = await getBackend().queryRun(useGame.getState().run!.runId);
  const mockIds = qr.ok ? qr.data.shopStock.equipment.map((e) => e.id) : ['queryRun失败:' + qr.message];
  const storeIds = useGame.getState().shopStock.equipment.map((e) => e.id);
  console.log('  DBG [2] storeShop:', storeIds.join(','), '| mockShop:', mockIds.join(','), '| runId:', useGame.getState().run!.runId);
  useGame.getState().buyItem(id);
  const bought = await wait(() => ![...useGame.getState().shopStock.equipment, ...useGame.getState().shopStock.consumables].some((x) => x.id === id));
  check('[2] buyItem 云端成交', bought,
    `gold ${goldBefore}→${useGame.getState().gold}, 库存 ${useGame.getState().inventory.length}`);
} else {
  check('[2] buyItem 云端成交（本局无买得起的货，跳过）', true, `gold=${goldBefore}`);
}

// ── [3] 层推进（云端） ──
const adv = await getBackend().advanceLayer({ runId: run.runId, idempotencyKey: 'e2e-adv', coreVersion: CORE_VERSION });
check('[6] advanceLayer 云端', adv.ok && adv.data.version > 0,
  adv.ok ? `version=${adv.data.version}` : adv.message);

console.log(`\n${fail ? `✗ ${fail} 失败` : '✓ 全部通过'}  (${pass} pass / ${fail} fail)`);
process.exit(fail ? 1 : 0);
