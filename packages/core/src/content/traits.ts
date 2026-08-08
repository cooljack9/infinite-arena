// v1.6 角色特性系统（开发文档附录 A.1）
//
// 设计动机：v1.5 之前 HeroDef.trait 只是一段展示字符串，战斗引擎从不读取它，
// 结果 9 个角色除了数值高低之外玩法完全同质——玩家没有「选谁」的理由。
// v1.6 把特性变成引擎可读的枚举 + 一组明确的触发钩子，让每个角色在战斗日志里
// 都能被观测到「他确实在做只有他会做的事」。
//
// 约束：所有特性必须是确定性的（只依赖 sim 内部状态与种子 RNG），
// 否则会破坏回放一致性。故此处不含任何 Math.random。

import { TraitId, DerivedAttrs } from '../types';

export interface TraitDef {
  id: TraitId;
  name: string;
  desc: string;
  /** 开局静态加成（百分点，直接加到派生属性上）。动态部分在 battle.ts 钩子里处理。 */
  staticMod?: Partial<Record<keyof DerivedAttrs, number>>;
}

export const TRAITS: Record<TraitId, TraitDef> = {
  bulwark: {
    id: 'bulwark',
    name: '坚壁',
    desc: '每受到 5 次伤害，获得相当于 12% 最大生命的护盾。',
    staticMod: { pResist: 6 },
  },
  spellbreak: {
    id: 'spellbreak',
    name: '法障',
    desc: '受到魔法伤害时，反弹 20% 给伤害来源。',
    staticMod: { mResist: 10 },
  },
  momentum: {
    id: 'momentum',
    name: '势能',
    desc: '每次普攻叠加 1 层攻速 +4%（无衰减、受击不清空，上限 8 层）；并叠加 1 层技能吸血（每层 +6% 技能回血，上限 8 层）；脱战（1 秒未普攻）后每秒下降 1 层吸血。',
  },
  bloodedge: {
    id: 'bloodedge',
    name: '魔刃',
    desc: '击杀目标时回复 15% 最大生命，并使技能冷却立即减少 2 秒。',
  },
  volley: {
    id: 'volley',
    name: '速射',
    desc: '连续攻击同一目标时每层伤害 +6%（上限 5 层），更换目标后清零。',
    staticMod: { atkSpeed: 8 },
  },
  lethal: {
    id: 'lethal',
    name: '致命',
    desc: '对生命值低于 40% 的目标造成的伤害提高 35%。',
    staticMod: { critDmg: 20 },
  },
  shackle: {
    id: 'shackle',
    name: '禁锢',
    desc: '技能附带 1.5 秒 30% 减速；对被控制或减速的目标伤害提高 25%。',
  },
  legion: {
    id: 'legion',
    name: '军团',
    desc: '召唤物数量 +1，且所有召唤物额外继承主人 25% 攻击力。',
  },
  grace: {
    id: 'grace',
    name: '恩泽',
    desc: '治疗溢出的部分，60% 转化为目标的护盾。',
    staticMod: { heal: 15 },
  },
};

/** 把特性的静态加成并入派生属性（在装备与体型之后调用） */
export function applyTraitStatic(d: DerivedAttrs, traitId?: TraitId): DerivedAttrs {
  if (!traitId) return d;
  const mod = TRAITS[traitId]?.staticMod;
  if (!mod) return d;
  const out: DerivedAttrs = { ...d };
  for (const [k, v] of Object.entries(mod) as [keyof DerivedAttrs, number][]) {
    const cur = out[k];
    if (typeof cur === 'number' && typeof v === 'number') {
      (out[k] as number) = cur + v;
    }
  }
  return out;
}

// ── 特性数值常量（集中管理，便于平衡调参）──
export const TRAIT_CFG = {
  bulwarkHitsPerShield: 5,
  bulwarkShieldPct: 0.12,
  spellbreakReflect: 0.20,
  momentumPerStack: 4,      // 攻速百分点
  momentumMaxStacks: 8,
  momentumLifestealPerStack: 0.06, // v3.0 每层技能吸血比例（冲锋等大招回血）
  momentumLifestealMax: 8,         // v3.0 技能吸血层数上限
  bloodedgeHealPct: 0.15,
  bloodedgeCdCut: 2.0,      // 秒
  volleyPerStack: 0.06,
  volleyMaxStacks: 5,
  lethalThreshold: 0.40,
  lethalBonus: 0.35,
  shackleSlowPct: 30,
  shackleSlowDur: 1.5,
  shackleBonus: 0.25,
  legionExtraSummon: 1,
  legionAtkInherit: 0.25,
  graceOverhealToShield: 0.60,
} as const;

/** 技能二段机制说明（附录 A.1.4）——供面板展示，实现在 battle.ts castSkill 中 */
export const SKILL_STAGE2: Record<string, string> = {
  taunt:     '生命高于 70% 时，追加一圈 50% 物伤的震荡波。',
  ward:      '护盾量按已缺失生命加权，越残血护盾越厚（最高 +60%）。',
  charge:    '自身生命低于 50% 时，本次冲锋伤害 ×1.6。',
  hexburst:  '每命中一个目标，回复自身 3% 最大生命。',
  barrage:   '连射命中的第 2 发起，每发伤害递增 +20%。',
  deadshot:  '目标生命高于 50% 时，本次射击必定暴击（伤害倍率不变）。',
  timelock:  '同时定身 3 个及以上目标时，返还 40% 冷却。',
  summon:    '召唤位已满时，改为强化现有召唤物（攻击/生命 +30%，最多 3 层）并延长存续。',
  groupheal: '治疗量按缺失生命比例加权，越残血治得越多。',
};

// 二段机制数值常量
export const STAGE2_CFG = {
  tauntHpGate: 0.70,
  tauntWaveRatio: 0.50,
  wardMissingBonusMax: 0.60,
  chargeHpGate: 0.50,
  chargeBurstMult: 1.60,
  hexburstLifestealPct: 0.03,
  barrageRampPerShot: 0.20,
  // 贯日神射「必暴」血线。注意这是暴击门槛，不是伤害倍率门槛——
  // 伤害恒为 400%，过线只改变「是否必定暴击」
  deadshotCritHpGate: 0.50,
  timelockRootGate: 3,
  timelockCdRefund: 0.40,
  summonEmpowerPct: 0.30,
  // 强化层数上限：不设上限的话「召唤位满 → 每轮CD强化」会指数膨胀，
  // 深层召唤流会直接压过其他所有流派。3 层 = 攻击约 ×2.2，是明确收益但不失控。
  summonEmpowerCap: 3,
  summonEmpowerExtendSec: 3,
  grouphealMissingWeight: 1.20,
} as const;
