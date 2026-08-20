import { createRun, planBattle, runBattle, applySettlement } from '../packages/core/src/rules/index';
import type { RunSecret } from '../packages/core/src/rules/index';

const secret: RunSecret = { seed: 20260809 };
const cr = createRun({ runId: 'dbg2', seed: 20260809, heroIds: ['h_physTank','h_sniper','h_healer'], mode: 'normal', endlessUnlocked: true });
console.log('createRun ok=', cr.ok, 'status=', cr.data?.status, 'layer=', cr.data?.layer);
if (!cr.ok) { console.log('ERR', JSON.stringify((cr as any).error)); process.exit(0); }
const snap = cr.data!;

const pb = planBattle(snap, secret);
console.log('planBattle ok=', pb.ok, 'enemyPreview?', !!pb.data?.enemyPreview, 'randomEvent?', !!pb.data?.randomEvent);
if (!pb.ok) console.log('PB ERR', JSON.stringify((pb as any).error));

const rb = runBattle(snap, secret, {});
console.log('runBattle ok=', rb.ok, 'result=', rb.data?.result, 'ticks=', rb.data?.totalTicks);
if (!rb.ok) console.log('RB ERR', JSON.stringify((rb as any).error));
else {
  const st = applySettlement(snap, secret, rb.data!);
  console.log('applySettlement ok, new layer=', st.layer, 'status=', st.status, 'pendingDrops=', st.pendingDrops.length, 'gold=', st.gold);
}
