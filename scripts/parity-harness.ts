// ── verify-parity 的 TS 侧测试床 ────────────────────────────
// 用 LocalBackend（debugSeed 确定性开局）造一局并结算，返回 checksum。
// 云端 __parityBattle 用同一套逻辑，两者可比。
import { LocalBackend, MemoryStore } from '../src/backend/LocalBackend';
import { CORE_VERSION } from '../packages/core/src/contract';

export { CORE_VERSION };

const TEAM = ['h_physTank', 'h_charge', 'h_healer'];

export async function localBattle(seed: number, layer: number, mode: 'novice' | 'normal' | 'endless') {
  const be = new LocalBackend(new MemoryStore());
  const started = await be.startRun({
    heroIds: TEAM, mode, idempotencyKey: `parity-${seed}-${layer}`, coreVersion: CORE_VERSION, debugSeed: seed,
  });
  if (!started.ok) return { ok: false as const, code: started.code, message: started.message };

  // 用 planBattle 拿战前情报（层级推进到目标层再打）
  let snap = started.data;
  let guard = 0;
  while (snap.layer < layer && guard++ < 100) {
    const adv = await be.advanceLayer({
      runId: snap.runId, idempotencyKey: `adv-${seed}-${guard}`, coreVersion: CORE_VERSION,
    });
    if (!adv.ok) break;
    snap = adv.data;
  }

  const b = await be.startBattle({
    runId: snap.runId, idempotencyKey: `battle-${seed}-${layer}`, coreVersion: CORE_VERSION,
    formation: {}, clientTs: 0,
  });
  if (!b.ok) return { ok: false as const, code: b.code, message: b.message };
  return {
    ok: true as const,
    checksum: b.data.replay.checksum,
    ticks: b.data.outcome.totalTicks,
    outcome: b.data.outcome.result,
  };
}
