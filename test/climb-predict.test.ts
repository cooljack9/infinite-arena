// v1.8.1 自动爬塔胜率估算提速 —— **等价性**回归。
//
// 这次优化的全部价值建立在一句承诺上：「更快，但一个 bit 都不改」。
// 所以这里不测性能，只测等价：把优化前的实现原样抄成参考实现（refPredictWinRate），
// 在 seed × layer × strategy 的矩阵上逐点比对。任何一点不等，优化就必须回滚——
// 因为 predictWinRate 是 autoClimb 的**权威闸门**（决定 stopReason='winrate'），
// 它变一点，玩家的爬塔结果就变了，而且前后端还得同时变，否则 parity 直接裂开。
import { describe, it, expect } from 'vitest';
import {
  createRun, advanceLayer, buildUnits, makeSim,
  predictWinRate, predictWinRateAtLeast, makeWinRatePredictor, climbMult,
} from '../packages/core/src/rules';
import { applyClimbStrategy, CLIMB_STRATEGY_IDS, type ClimbStrategy } from '../packages/core/src/content/climb';
import type { RunSnapshot } from '../packages/core/src/contract';

const TICK = 1 / 20;

/** 参考实现：v1.8.0 的原始 predictWinRate，逐行照抄（每样本重跑 buildUnits，无早停） */
function refPredictWinRate(
  snap: RunSnapshot, secret: { seed: number }, formation: Record<string, { x: number; y: number }>,
  layer: number, mods: { enemyHpMult?: number; enemyDmgMult?: number; strategy?: ClimbStrategy },
  count = 20,
): number {
  let wins = 0;
  for (let k = 0; k < count; k++) {
    const { plan, allies, enemies, scale } = buildUnits(snap, secret, formation, {
      layer, enemyHpMult: mods.enemyHpMult, enemyDmgMult: mods.enemyDmgMult,
    });
    if (mods.strategy) applyClimbStrategy(allies, mods.strategy);
    const seed = (secret.seed ^ (layer * 2654435761) ^ (k * 0x9e3779b1)) >>> 0;
    const sim = makeSim({
      allies, enemies, arena: plan.arena, buildings: plan.buildings,
      layer, battleSeed: seed,
      buildingScale: { hp: scale.hp * (mods.enemyHpMult ?? 1), dmg: scale.dmg * (mods.enemyDmgMult ?? 1) },
    });
    let steps = 0;
    while (!sim.over && steps < 20 * 180) { sim.tick(TICK); steps++; }
    if (sim.result === 'win') wins++;
  }
  return wins / count;
}

/** 造一个推到指定层的对局快照 */
function runAt(seed: number, layer: number): RunSnapshot {
  const r = createRun({
    runId: `t_${seed}_${layer}`, seed,
    heroIds: ['h_physTank', 'h_charge', 'h_healer'],
    mode: 'normal', endlessUnlocked: true,
  });
  if (!r.ok) throw new Error('createRun 失败');
  let snap = r.data;
  for (let i = 1; i < layer; i++) {
    const adv = advanceLayer(snap);
    if (!adv.ok) break;
    snap = adv.data;
  }
  return snap;
}

const SEEDS = [1, 20250601, 0xdeadbeef];
const LAYERS = [1, 5, 12];

describe('predictWinRate：优化后与 v1.8.0 参考实现逐点相等', () => {
  for (const seed of SEEDS) {
    for (const layer of LAYERS) {
      it(`seed=${seed} layer=${layer}（含三种战略 + 无战略）`, () => {
        const snap = runAt(seed, layer);
        const secret = { seed };
        const target = layer + 1;
        const mult = climbMult(Math.max(1, target - snap.layer));
        const strategies: (ClimbStrategy | undefined)[] = [undefined, ...CLIMB_STRATEGY_IDS];
        for (const strategy of strategies) {
          const mods = { enemyHpMult: mult, enemyDmgMult: mult, strategy };
          const ref = refPredictWinRate(snap, secret, {}, target, mods);
          const got = predictWinRate(snap, secret, {}, target, mods);
          expect(got, `strategy=${strategy ?? 'none'}`).toBe(ref);
        }
      });
    }
  }
});

describe('predictWinRateAtLeast：早停闸门与「跑满后比较」判定完全一致', () => {
  for (const seed of SEEDS) {
    it(`seed=${seed}：0~100% 全阈值扫描`, () => {
      for (const layer of LAYERS) {
        const snap = runAt(seed, layer);
        const secret = { seed };
        const target = layer + 1;
        const mult = climbMult(Math.max(1, target - snap.layer));
        const mods = { enemyHpMult: mult, enemyDmgMult: mult, strategy: CLIMB_STRATEGY_IDS[0] };
        const full = predictWinRate(snap, secret, {}, target, mods);
        // 覆盖 UI 滑条实际取值域（51~100）与两端极值
        for (const pct of [0, 1, 25, 50, 51, 55, 60, 70, 75, 80, 90, 95, 99, 100, 101]) {
          const t = pct / 100;
          expect(
            predictWinRateAtLeast(snap, secret, {}, target, mods, t),
            `layer=${target} target=${pct}% full=${full}`,
          ).toBe(full >= t);
        }
      }
    });
  }
});

describe('makeWinRatePredictor：分片推进与一次跑满结果相同', () => {
  it('每次 1/3/7 个样本分片，最终 finalRate 一致', () => {
    const snap = runAt(20250601, 8);
    const secret = { seed: 20250601 };
    const mods = { enemyHpMult: 1.1, enemyDmgMult: 1.1, strategy: CLIMB_STRATEGY_IDS[1] };
    const oneShot = predictWinRate(snap, secret, {}, 9, mods);
    for (const chunk of [1, 3, 7]) {
      const p = makeWinRatePredictor(snap, secret, {}, 9, mods, 20);
      let guard = 0;
      while (!p.step(chunk) && guard++ < 100) { /* 分片推进 */ }
      expect(p.done).toBe(true);
      expect(p.ran).toBe(20);
      expect(p.finalRate, `chunk=${chunk}`).toBe(oneShot);
    }
  });

  it('count=0 与负 target 的边界不炸', () => {
    const snap = runAt(1, 3);
    expect(predictWinRate(snap, { seed: 1 }, {}, 4, {}, 0)).toBe(0);
    expect(predictWinRateAtLeast(snap, { seed: 1 }, {}, 4, {}, -1)).toBe(true);
    expect(predictWinRateAtLeast(snap, { seed: 1 }, {}, 4, {}, 1.5)).toBe(false);
  });
});
