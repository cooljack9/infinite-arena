// v1.6 战斗引擎冒烟测试（Vitest 版，对应 scripts/smoke.ts）
// 验证三件事：
//   1) 不崩、能分出胜负
//   2) 同 seed 完全可复现（确定性没被特性钩子破坏）
//   3) 特性确实在跑（日志里能观测到）
// v2.9.8：追加女娲开局造化 / 奶妈普攻转治疗 / 色盲双通道持久化的专项覆盖。
// 原 esbuild + node 脚本（scripts/smoke.ts）仍作为 verify 主门禁保留，本文件提供
// watch / 覆盖率友好的 Vitest 入口。
import { describe, it, expect } from 'vitest';
import { BattleSim } from '../packages/core/src/engine/battle';
import { makeAlly, makeEnemy } from '../packages/core/src/engine/unit';
import { HEROES } from '../packages/core/src/content/heroes';
import { ARENAS, parseSpawns } from '../packages/core/src/content/arenas';
import { buildWaves } from '../packages/core/src/gen/encounter';
import { mulberry32 } from '../packages/core/src/engine/rng';
import { enemyScale } from '../packages/core/src/engine/scaling';
import { variateHero } from '../packages/core/src/content/variant';
import { ALL_TRAIT_IDS, TRAIT_CFG } from '../packages/core/src/content/traits';
import { TraitId, HeroDef } from '../packages/core/src/types';
import { loadColorblind, saveColorblind } from '../src/game/state/slices/helpers';

const TICK = 1 / 20;

function runOnce(seed: number, heroIdx: number[], layer: number) {
  return runTeam(heroIdx.map((i) => HEROES[i]), seed, layer);
}

// vX：runOnce 直接吃 HEROES 模板（不再绑固定特性）。需要钉死特性的受控探针用 runTeam。
function runTeam(heroes: HeroDef[], seed: number, layer: number) {
  const arena = ARENAS.A1;
  const spawns = parseSpawns(arena);
  const rng = mulberry32(seed);
  const sc = enemyScale(layer);

  const allies = heroes.map((h, k) => {
    const u = makeAlly(h, 5 + layer, []);
    const p = spawns.ally[k % spawns.ally.length];
    u.x = p.x; u.y = p.y;
    return u;
  });
  const waves = buildWaves(rng, layer, false);
  const enemies = waves[0].map((e, k) => {
    const u = makeEnemy(e, 5 + layer, sc.hp, sc.dmg);
    const p = spawns.enemy[k % spawns.enemy.length];
    u.x = p.x; u.y = p.y;
    return u;
  });

  const sim = new BattleSim([...allies, ...enemies], arena, seed);
  let steps = 0;
  let summonAtFirstTick = 0;
  let minAllyPct = 1;
  while (!sim.over && steps < 20 * 120) {
    sim.tick(TICK);
    steps++;
    if (steps === 1) summonAtFirstTick = sim.units.filter((u) => u.alive && u.isSummon && u.side === 'ally').length;
    for (const a of sim.units) {
      if (a.side !== 'ally' || a.isSummon || a.isBuilding || !a.alive) continue;
      minAllyPct = Math.min(minAllyPct, a.hp / a.maxHp);
    }
  }
  return {
    result: sim.result,
    steps,
    log: sim.log.slice(),
    hp: sim.units.map((u) => `${u.name}:${Math.round(u.hp)}`).join('|'),
    summonAtFirstTick,
    minAllyPct,
    heal: sim.units.filter((u) => u.side === 'ally').reduce((a, u) => a + (u.healDone ?? 0), 0),
    // 字段名是 dmgDealt（types.ts:387）。v2.9.8 这里误写成 dmgDone，
    // 恒为 undefined→0，使「零伤害」断言成为永远为真的假阳性。
    healerDmg: sim.units
      .filter((u) => u.side === 'ally' && u.subclass === 'healer')
      .reduce((a, u) => a + (u.dmgDealt ?? 0), 0),
    allyDmg: sim.units
      .filter((u) => u.side === 'ally')
      .reduce((a, u) => a + (u.dmgDealt ?? 0), 0),
  };
}

describe('battle smoke', () => {
  it('[1] 战斗可完成性（9 职业轮转 12 组，>=11 组分胜负）', () => {
    let decided = 0;
    for (let s = 0; s < 12; s++) {
      const idx = [s % 9, (s + 3) % 9, (s + 6) % 9];
      const r = runOnce(1000 + s, idx, 1 + (s % 5));
      if (r.result) decided++;
    }
    expect(decided).toBeGreaterThanOrEqual(11);
  });

  it('[2] 确定性回放（同 seed 逐字节一致）', () => {
    for (const s of [7, 42, 99]) {
      const a = runOnce(s, [0, 4, 8], 3);
      const b = runOnce(s, [0, 4, 8], 3);
      expect(a.result).toBe(b.result);
      expect(a.steps).toBe(b.steps);
      expect(a.hp).toBe(b.hp);
    }
  });

  it('[3] 特性运行时可观测（variateHero 随机分配 + 嘲讽震荡被触发）', () => {
    // vX：模板不再绑固定特性，特性在 variateHero 时从全池随机分配（用户需求「所有角色都随机产生」）
    const variated = HEROES.map((h, i) => variateHero(h, (20260808 ^ (i * 0x9e3779b1)) >>> 0));
    expect(variated.every((h) => h.traitId != null && ALL_TRAIT_IDS.includes(h.traitId))).toBe(true);
    const uniq = new Set(variated.map((h) => h.traitId));
    expect(uniq.size).toBeGreaterThanOrEqual(2);

    // 特性在派生数值上真实生效（确定性单元校验，比"日志关键词"更硬）
    const base = makeAlly({ ...HEROES[0] }, 1, []);
    const sl = makeAlly({ ...HEROES[0], traitId: 'slowburn' }, 1, []);
    expect(sl.derived.atkSpeed / base.derived.atkSpeed).toBeCloseTo(0.7, 6);
    expect(sl.derived.pDmg / base.derived.pDmg).toBeCloseTo(0.6, 6);
    const gr = makeAlly({ ...HEROES[0], traitId: 'grower' }, 1, []);
    expect(gr.derived.pDmg / base.derived.pDmg).toBeCloseTo(0.85, 6);
    expect(gr.sizeScale ?? 1).toBeCloseTo(1 - TRAIT_CFG.growerBodyPct, 9);
    const rt = makeAlly({ ...HEROES[0], traitId: 'returner' }, 1, []);
    expect(rt.derived.pResist).toBe(0);
    expect(rt.derived.mResist).toBe(0);

    // 嘲讽震荡：v2.9.8 起用无奶阵容压测——华佗改为持续治疗后会把血线托在 85% 以上，
    // 而嘲讽二段的施放门槛是「有队友低于 60% 血」，带奶阵容里该门槛几乎永不成立。
    let shake = 0;
    for (let s = 0; s < 20; s++) {
      const r = runOnce(800 + s, [0, 1, 4], 2 + (s % 6));
      for (const line of r.log) if (line.includes('震荡')) shake++;
    }
    expect(shake).toBeGreaterThan(0);
  });

  it('[4] v2.9.8 女娲开局立即造化（首 tick 已有召唤物）', () => {
    let opening = 0;
    for (let s = 0; s < 20; s++) {
      const r = runOnce(900 + s, [7, 2, 6], 2 + (s % 6));
      if (r.summonAtFirstTick > 0) opening++;
    }
    expect(opening).toBe(20);
  });

  it('[4] v2.9.8 女娲/召唤物击杀敌人后自动重铸大招', () => {
    let recast = 0;
    for (let s = 0; s < 20; s++) {
      const r = runOnce(900 + s, [7, 2, 6], 2 + (s % 6));
      for (const line of r.log) if (line.includes('造化重铸')) recast++;
    }
    expect(recast).toBeGreaterThan(0);
  });

  it('[4] v2.9.9 治疗职业：重击转群疗稳定触发，且掉血局产出实际回血', () => {
    let damagedRuns = 0;
    let healedRuns = 0;
    let burstRuns = 0;
    let lowHpRuns = 0;
    for (let s = 0; s < 20; s++) {
      const r = runOnce(800 + s, [0, 1, 8], 2 + (s % 6));
      if (r.minAllyPct < 0.999) {
        damagedRuns++;
        if (r.heal > 0) healedRuns++;
      }
      if (r.minAllyPct < 0.6) lowHpRuns++;
      if (r.log.some((l) => l.includes('回春重击'))) burstRuns++;
    }
    // 群疗事件每局可观测：机制不是"看运气才出现"
    expect(burstRuns).toBeGreaterThanOrEqual(18);
    expect(damagedRuns).toBeGreaterThan(0);
    // healDone 不计溢疗转盾，故允许少量掉血局显示 0 实际回血
    expect(healedRuns).toBeGreaterThanOrEqual(Math.ceil(damagedRuns * 0.85));
    // v2.9.8 回归防线：治疗不得再把血线钉在高位，否则嘲讽二段等低血触发机制全废
    expect(lowHpRuns).toBeGreaterThan(0);
  });

  it('[4] v2.9.9 治疗职业弱普攻：仍打敌人，但输出占比 < 15%', () => {
    let healerDmgTotal = 0;
    let allyDmgTotal = 0;
    // 用「武圣+炮手+治疗」这套有真实 DPS 的标准阵容量；
    // 双坦阵容里坦克本身没输出，占比会被抬到 ~19%，那是阵容伪影不是平衡问题。
    // vX：钉死三人原特性（momentum / volley / grace）还原标定基线——
    // 随机化后模板不再绑特性，放任随机特性会使队伍 DPS 与奶量漂移，占比阈值失去参照。
    for (let s = 0; s < 20; s++) {
      const r = runTeam(
        [
          { ...HEROES[2], traitId: 'momentum' as TraitId },
          { ...HEROES[4], traitId: 'volley' as TraitId },
          { ...HEROES[8], traitId: 'grace' as TraitId },
        ],
        800 + s, 2 + (s % 6),
      );
      healerDmgTotal += r.healerDmg;
      allyDmgTotal += r.allyDmg;
    }
    expect(healerDmgTotal).toBeGreaterThan(0);
    expect(healerDmgTotal / allyDmgTotal).toBeLessThan(0.15);
  });

  it('[4] v2.9.8 色盲双通道设置持久化（ia_colorblind）', () => {
    // node 环境无 localStorage，注入内存 stub 验证读写闭合
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    };
    expect(loadColorblind()).toBe(false);
    saveColorblind(true);
    expect(loadColorblind()).toBe(true);
    saveColorblind(false);
    expect(loadColorblind()).toBe(false);
  });
});
