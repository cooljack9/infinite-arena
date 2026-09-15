// 奇遇 rules 单测：确定性结算 + 二次拒绝 + 越层拒绝（直接 import core 源码）
import { genLayer } from '../packages/core/src/gen/levelGen';
import { resolveRandomEvent } from '../packages/core/src/rules/index';
import type { RunSnapshot } from '../packages/core/src/contract';

let evLayer = 0;
for (let l = 1; l <= 30; l++) {
  if (genLayer(l, 42, 'normal').randomEvent) { evLayer = l; break; }
}
console.log('奇遇层:', evLayer);
if (!evLayer) process.exit(1);

function mkSnap(layer = evLayer, resolved: number[] = []): RunSnapshot {
  return {
    runId: 'run_evt1', version: 5, layer, mode: 'normal', score: 100, failures: 0, cap: 500,
    team: [], relics: [], resolvedEvents: resolved, status: 'active',
    gold: 500, inventory: [], pendingDrops: [], equipped: {}, consumables: [],
    shopStock: { equipment: [], consumables: [] }, recruitPool: [],
    tradeCount: 0, refreshCount: 0, forgedThisLayer: [], fusedThisLayer: 0, reforgedThisLayer: false,
    opSeq: 0, renderSeed: 42, receipts: {},
  };
}

const ev = genLayer(evLayer, 42, 'normal').randomEvent!;
const opt0 = ev.options[0];
const r1 = resolveRandomEvent(mkSnap(), evLayer, 0);
console.log(`[1] 结算选项0「${opt0.label}」: ${r1.ok ? '✓' : '✗ ' + r1.code + '/' + r1.message}`);
if (r1.ok) {
  const d = r1.data as RunSnapshot;
  console.log(`[2] resolvedEvents 记录: ${d.resolvedEvents.includes(evLayer) ? '✓' : '✗'} | version+1: ${d.version === 6 ? '✓' : '✗'}`);
  const goldDelta = d.gold - 500;
  const eff = opt0.effect;
  console.log(`[3] 金币效果: ${!eff.gold || goldDelta === eff.gold ? '✓' : '✗'} (Δ${goldDelta})`);
  const r2 = resolveRandomEvent(mkSnap(evLayer, [evLayer]), evLayer, 0);
  console.log(`[4] 二次结算拒绝: ${!r2.ok && r2.code === 'EVENT_DONE' ? '✓' : '✗ ' + (r2.code || 'ok')}`);
  const r3 = resolveRandomEvent(mkSnap(evLayer + 1), evLayer, 0);
  console.log(`[5] 越层结算拒绝: ${!r3.ok && r3.code === 'LAYER_MISMATCH' ? '✓' : '✗ ' + (r3.code || 'ok')}`);
  const a = resolveRandomEvent(mkSnap(), evLayer, 0).data as RunSnapshot;
  const b = resolveRandomEvent(mkSnap(), evLayer, 0).data as RunSnapshot;
  console.log(`[6] 确定性: ${a.gold === b.gold && a.score === b.score && a.inventory.length === b.inventory.length ? '✓' : '✗'}`);
}
