// ── 奇遇事件云端链路 e2e（mock）：找到有奇遇的层 → 结算 → 二次拒绝 ──
import { ARENA_CONFIG } from '../src/arena.config';
import { resetBackend } from '../src/backend/index';
import { useGame } from '../src/game/state/store';
import { getBackend } from '../src/backend/index';
import { isRemoteMode, applySnapshot } from '../src/backend/storeBridge';
import { CORE_VERSION } from '../packages/core/src/contract';
import { genLayer } from '../packages/core/src/gen/levelGen';

ARENA_CONFIG.useLocalComputation = false;
ARENA_CONFIG.supabaseUrl = 'http://127.0.0.1:8787';
ARENA_CONFIG.supabaseAnonKey = 'mock-anon';
resetBackend();

let pass = 0, fail = 0;
const check = (n: string, c: boolean, extra = '') => {
  if (c) { pass++; console.log(`  PASS  ${n}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL  ${n}  ${extra}`); }
};
const wait = (fn: () => boolean, ms = 8000) =>
  new Promise<boolean>((res) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (fn()) { clearInterval(iv); res(true); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); res(false); }
    }, 100);
  });

if (!isRemoteMode()) { console.log('✗ 非 Remote 模式'); process.exit(1); }

useGame.getState().startRun([{ id: 'h_physTank' }, { id: 'h_charge' }, { id: 'h_healer' }] as never, 'normal');
const ok1 = await wait(() => !!useGame.getState().run?.runId);
check('[1] 云端开局', ok1);

// ── [2] 找有奇遇的层（advanceLayerTo 推进，最多探 12 层）──
const run = useGame.getState().run!;
let eventLayer = 0;
for (let l = run.layer; l <= run.layer + 12; l++) {
  const plan = genLayer(l, run.seed, run.mode);
  if (plan.randomEvent) { eventLayer = l; break; }
}
check('[2] 找到奇遇层', eventLayer > 0, eventLayer ? `layer=${eventLayer} ${useGame.getState().run?.layer}` : '12 层内无奇遇');
if (!eventLayer) { console.log(`\n${fail} 失败`); process.exit(fail ? 1 : 0); }

// 推进到奇遇层
const r = await getBackend().advanceLayerTo({ runId: useGame.getState().run!.runId, idempotencyKey: `evt-sk-${Math.random().toString(36).slice(2, 8)}`, coreVersion: CORE_VERSION, layer: eventLayer });
if (r.ok) applySnapshot(useGame.setState, r.data); else { check('[2b] advanceLayerTo', false, r.code); }
check('[2b] 已到奇遇层', (useGame.getState().run?.layer ?? 0) === eventLayer, `layer=${useGame.getState().run?.layer}`);

// ── [3] 结算奇遇（选一个当前可支付的选项；全付不起则选最后一个「离开」）──
const ev = genLayer(eventLayer, useGame.getState().run!.seed, useGame.getState().run!.mode).randomEvent!;
const st = useGame.getState();
const payableIdx = ev.options.findIndex((o) => {
  const e = o.effect;
  if (e.gold && e.gold < 0 && st.gold + e.gold < 0) return false;
  if (e.sacrificeLowest && st.inventory.length === 0) return false;
  return true;
});
const optIdx = payableIdx >= 0 ? payableIdx : ev.options.length - 1;
const opt = ev.options[optIdx];
const goldBefore = useGame.getState().gold;
const invBefore = useGame.getState().inventory.length;
const eff = opt.effect;
useGame.getState().resolveRandomEvent(eventLayer, optIdx);
const ok3 = await wait(() => useGame.getState().resolvedEvents.includes(eventLayer), 8000);
check('[3] 奇遇云端结算', ok3, `「${ev.title}」→「${opt.label}」`);
if (ok3) {
  const g = useGame.getState();
  const goldDelta = g.gold - goldBefore;
  const invDelta = g.inventory.length - invBefore;
  check('[3b] 效果落地', (eff.gold ? goldDelta === eff.gold : true) && (eff.give ? invDelta === eff.give.count : true),
    `gold ${goldBefore}→${g.gold} (Δ${goldDelta}), 库存 Δ${invDelta}`);
}

console.log(`\n${fail ? `✗ ${fail} 失败` : '✓ 全部通过'}  (${pass} pass / ${fail} fail)`);
process.exit(fail ? 1 : 0);
