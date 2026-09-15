/**
 * 战斗引擎构造参数（纯函数，零 store / 零后端依赖）。
 *
 * 把「构造 BattleSim 所需的全部 makeSim 入参」抽成纯函数，使主线程（DirectSim 默认路径）
 * 与 Web Worker（SimClient）能共用同一份装配逻辑 → 两条路径 parity 逐 bit 一致。
 *
 * 刻意不 import 任何 store / backend（连 isRemoteMode 都不用，仅用 `battleRemote?.replay`
 * 判定远程回放分支，二者数据等价），这样 Worker 线程也能安全 import 本文件而不必拉起整个
 * 前端 store / 后端依赖图。
 */
import { makeAlly, makeEnemy } from '@arena/core/engine/unit';
import { enemyScale } from '@arena/core/engine/scaling';
import { enemyPlacements, sanitizeFormation } from '@arena/core/gen/formation';
import { applyRelics } from '@arena/core/engine/battle';
import { applyClimbStrategy, type ClimbStrategy } from '@arena/core/content/climb';
import type { RunState, Equipment, Vec2 } from '@arena/core/types';
import type { RunSlice } from './state/slices/types';

export type BattlePlan = ReturnType<typeof import('@arena/core/gen/levelGen').genLayer>;

export interface BattleMods {
  effLayer?: number;
  enemyHpMult?: number;
  enemyDmgMult?: number;
  strategy?: ClimbStrategy;
  battleSeed?: number;
}

/** 与 BattleScreen 原构造逻辑逐行一致；产出 makeSim 所需的纯数据入参（Worker 内据此独立构造同款引擎）。 */
export function buildBattleSimArgs(
  run: RunState,
  plan: BattlePlan,
  equipped: Record<string, Equipment[]>,
  formation: Record<string, Vec2>,
  battleRemote: RunSlice['battleRemote'],
  mods?: BattleMods,
): import('@arena/core/rules').SimInput {
  // 远程回放：直接用服务端算好的单位 + 种子（与 BattleScreen 原远程分支逐行一致）
  if (battleRemote?.replay) {
    const rp = battleRemote.replay;
    return {
      allies: rp.allies as any, enemies: rp.enemies as any,
      arena: rp.arena, buildings: rp.buildings,
      layer: rp.layer, battleSeed: rp.battleSeed,
      buildingScale: rp.buildingScale,
      vanEncounter: rp.vanEncounter,
    };
  }
  // v2.3：站位来自战前布阵；地图每层可能换布局，故仍需按当前地图合法化一次。
  const effLayer = mods?.effLayer ?? run.layer;
  const spots = sanitizeFormation(
    plan.arena,
    run.team.map((h) => formation[h.uid]),
    plan.spawnAlly[0],
    run.team.length,
  );
  const allies = run.team.map((h, i) => {
    const eqs = equipped[h.uid] ?? [];
    const u = makeAlly(h, 1 + Math.floor((effLayer - 1) / 2), eqs, { burst: !!h.pendingBurst });
    const p = spots[i];
    u.x = p.x; u.y = p.y;
    return u;
  });
  applyRelics(allies, run.relics);
  // v1.8 自动爬塔战略 buff（普攻距离 <4 = 前排，效果见 content/climb）
  if (mods?.strategy) applyClimbStrategy(allies, mods.strategy);

  const scale = enemyScale(effLayer);
  const eLevel = 1 + Math.floor(effLayer / 4);
  const hpMult = mods?.enemyHpMult ?? 1;
  const dmgMult = mods?.enemyDmgMult ?? 1;
  const defs = plan.waves.flat();
  const eSpots = enemyPlacements(plan.arena, plan.spawnEnemy, plan.bossPos, defs);
  const enemies = defs.map((e, i) => {
    const u = makeEnemy(e, eLevel, scale.hp * hpMult, scale.dmg * dmgMult);
    const p = eSpots[i];
    u.x = p.x; u.y = p.y;
    return u;
  });

  return {
    allies, enemies,
    arena: plan.arena, buildings: plan.buildings,
    layer: effLayer,
    battleSeed: mods?.battleSeed ?? ((run.seed + effLayer) >>> 0),
    buildingScale: { hp: scale.hp * hpMult, dmg: scale.dmg * dmgMult },
    vanEncounter: plan.vanEncounter,
  };
}
