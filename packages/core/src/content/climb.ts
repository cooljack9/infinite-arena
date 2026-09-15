// v1.8 自动爬塔 · 战略定义与 buff 应用
//
// c1 三选一战略，选定后**本次自动爬塔全程生效**（用户确认「爬塔全程」）。
// 效果挂到 DerivedAttrs 既有乘区（与 applyRelics / 天气同语义）：
//   · moveSpeed / atkSpeed 为百分点加减（DerivedAttrs 以 % 计）
//   · hpMult / dmgMult 为乘区
// 「前排」= 普攻距离 < 4 的英雄（坦克 1.1 / 突袭 2.5 / 剑客 3.0）；
// 「后排」= 普攻距离 ≥ 4（弓 5.0~6.5 / 法 5.0~6.0 / 牧 5.0）。
// 与引擎判定口径一致：battle.ts attackRangeOf = skill.castRange ?? SUBCLASS_INFO.attackRange。
import type { Unit } from '../types';
import { SUBCLASS_INFO } from './classes';

export type ClimbStrategy = 'raidRear' | 'steadyPush' | 'breakThrough';

export interface ClimbStrategyDef {
  id: ClimbStrategy;
  name: string;
  /** 一句话效果描述（UI 卡片直接展示） */
  desc: string;
  /** 前排（普攻距离<4）专属 buff */
  frontRow?: { moveSpeed?: number; hpMult?: number };
  /** 全队 buff */
  all?: { moveSpeed?: number; atkSpeed?: number; dmgMult?: number; hpMult?: number };
}

export const CLIMB_STRATEGIES: Record<ClimbStrategy, ClimbStrategyDef> = {
  raidRear: {
    id: 'raidRear',
    name: '突袭后排',
    desc: '前排移速 +10%，全队生命 −8%',
    frontRow: { moveSpeed: 10 },
    all: { hpMult: 0.92 },
  },
  steadyPush: {
    id: 'steadyPush',
    name: '平稳推进',
    desc: '前排生命 +15%，全队移速 −10%',
    frontRow: { hpMult: 1.15 },
    all: { moveSpeed: -10 },
  },
  breakThrough: {
    id: 'breakThrough',
    name: '集中突破',
    desc: '全队伤害 +15%，攻速 −8%',
    all: { dmgMult: 1.15, atkSpeed: -8 },
  },
};

export const CLIMB_STRATEGY_IDS: ClimbStrategy[] = ['raidRear', 'steadyPush', 'breakThrough'];

/** 普攻距离 < 4 判定为前排（与引擎 attackRange > 3 = 远程的口径互补） */
export function isFrontRowUnit(u: Unit): boolean {
  const r = u.skill?.castRange ?? SUBCLASS_INFO[u.subclass]?.attackRange ?? 5;
  return r < 4;
}

/**
 * 把战略 buff 应用到友方单位（排除召唤物）。
 * 乘法乘区（hp/dmg）与加减百分点（移速/攻速）与 applyRelics 语义一致，逐 bit 可复现。
 */
export function applyClimbStrategy(units: Unit[], strategy: ClimbStrategy): void {
  const def = CLIMB_STRATEGIES[strategy];
  if (!def) return;
  for (const u of units) {
    if (u.side !== 'ally' || u.isSummon) continue;
    const front = isFrontRowUnit(u);
    const apply = (mod?: { moveSpeed?: number; hpMult?: number; atkSpeed?: number; dmgMult?: number }) => {
      if (!mod) return;
      if (mod.hpMult) {
        u.derived.hp = Math.round(u.derived.hp * mod.hpMult);
        u.maxHp = u.derived.hp;
        u.hp = u.derived.hp;
      }
      if (mod.dmgMult) u.dmgMult *= mod.dmgMult;
      if (mod.moveSpeed !== undefined) u.derived.moveSpeed += mod.moveSpeed;
      if (mod.atkSpeed !== undefined) u.derived.atkSpeed += mod.atkSpeed;
    };
    if (front) apply(def.frontRow);
    apply(def.all);
  }
}
