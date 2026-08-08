// ── 重铸链路 e2e（mock：白装 → 彩色，每层一次，二次拒绝）──
import { ARENA_CONFIG } from '../src/arena.config';
import { resetBackend } from '../src/backend/index';
import { useGame } from '../src/game/state/store';
import { getBackend } from '../src/backend/index';
import { isRemoteMode, applySnapshot } from '../src/backend/storeBridge';
import { CORE_VERSION } from '../packages/core/src/contract';

// 强制云端模式（连 mock）
ARENA_CONFIG.useLocalComputation = false;
ARENA_CONFIG.supabaseUrl = 'http://127.0.0.1:8787';
ARENA_CONFIG.supabaseAnonKey = 'mock-anon';
resetBackend();

let pass = 0, fail = 0;
function check(name: string, ok: boolean, info = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}  ${info}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${info}`); }
}
const wait = (fn: () => boolean, ms = 8000) =>
  new Promise<boolean>((res) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (fn()) { clearInterval(iv); res(true); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); res(false); }
    }, 100);
  });

if (!isRemoteMode()) {
  console.log('✗ 非 Remote 模式（mock 未接）');
  process.exit(1);
}

// ── [1] 新手开局（starter kit = 2 蓝 2 白，含白装）──
useGame.getState().startRun([{ id: 'h_physTank' }, { id: 'h_charge' }, { id: 'h_healer' }] as never, 'novice');
const ok1 = await wait(() => !!useGame.getState().run?.runId);
check('[1] 云端开局', ok1, `runId=${useGame.getState().run?.runId}`);
const white = useGame.getState().inventory.find((e) => e.rarity === 'normal');
check('[1b] 开局含白装', !!white, white ? `id=${white.id}` : '无白装');
if (!white) { console.log(`\n${fail} 失败`); process.exit(1); }

// ── [2] 重铸 → 彩色 ──
const invBefore = useGame.getState().inventory.length;
useGame.getState().reforgeItem(white.id);
const ok2 = await wait(() => useGame.getState().reforgedThisLayer === true, 8000);
const after = useGame.getState().inventory.find((e) => e.id === white.id);
check('[2] 重铸后彩色', ok2 && !!after && after.rarity !== 'normal',
  after ? `rarity=${after.rarity} name=${after.name}` : '装备消失');
check('[2b] 库存数不变（替换非新增）', useGame.getState().inventory.length === invBefore);
check('[2c] 回执展示', !!useGame.getState().lastReforge,
  useGame.getState().lastReforge ? `→${useGame.getState().lastReforge.to}` : '无');

// ── [3] 每层一次：再点拒绝（云端 REFORGE_LIMIT，状态不变）──
const g3 = useGame.getState();
const colorBefore = JSON.stringify(after?.affixes);
g3.reforgeItem(white.id);
await new Promise((r) => setTimeout(r, 1500)); // 等云端返回（应被拒，快照不变）
const colorAfter = JSON.stringify(useGame.getState().inventory.find((e) => e.id === white.id)?.affixes);
check('[3] 已重铸再点被拒且状态不变', colorBefore === colorAfter, `ref forged=${useGame.getState().reforgedThisLayer}`);

// ── [4] 跨层重置：skipLayer 推进层后 reforgedThisLayer 回 false ──
const run = useGame.getState().run!;
const adv = await getBackend().skipLayer({ runId: run.runId, idempotencyKey: 'ref-adv-1', coreVersion: CORE_VERSION, bestLayer: 999 });
if (adv.ok) {
  applySnapshot(useGame.setState, adv.data);
  check('[4] 层推进后重铸次数重置', useGame.getState().reforgedThisLayer === false,
    `layer=${useGame.getState().run?.layer}`);
} else {
  check('[4] skipLayer', false, adv.code + '/' + adv.message);
}

console.log(`\n${fail ? `✗ ${fail} 失败` : '✓ 全部通过'}  (${pass} pass / ${fail} fail)`);
process.exit(fail ? 1 : 0);
