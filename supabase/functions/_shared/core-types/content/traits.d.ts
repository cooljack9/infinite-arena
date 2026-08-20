import { TraitId, DerivedAttrs } from '../types';
export interface TraitDef {
    id: TraitId;
    name: string;
    desc: string;
    /** 开局静态加成（百分点，直接加到派生属性上）。动态部分在 battle.ts 钩子里处理。 */
    staticMod?: Partial<Record<keyof DerivedAttrs, number>>;
}
export declare const TRAITS: Record<TraitId, TraitDef>;
/** 把特性的静态加成并入派生属性（在装备与体型之后调用） */
export declare function applyTraitStatic(d: DerivedAttrs, traitId?: TraitId): DerivedAttrs;
export declare const TRAIT_CFG: {
    readonly bulwarkHitsPerShield: 5;
    readonly bulwarkShieldPct: 0.12;
    readonly spellbreakReflect: 0.2;
    readonly momentumPerStack: 4;
    readonly momentumMaxStacks: 8;
    readonly momentumLifestealPerStack: 0.06;
    readonly momentumLifestealMax: 8;
    readonly bloodedgeHealPct: 0.2;
    readonly bloodedgeCdCut: 2;
    readonly bloodedgePdmgPerKill: 0.1;
    readonly bloodedgeMdmgPerKill: 0.2;
    readonly volleyPerStack: 0.06;
    readonly volleyMaxStacks: 5;
    readonly lethalThreshold: 0.4;
    readonly lethalBonus: 0.35;
    readonly shackleSlowPct: 30;
    readonly shackleSlowDur: 1.5;
    readonly shackleBonus: 0.25;
    readonly legionExtraSummon: 1;
    readonly legionAtkInherit: 0.25;
    readonly graceOverhealToShield: 0.6;
};
/** 技能二段机制说明（附录 A.1.4）——供面板展示，实现在 battle.ts castSkill 中 */
export declare const SKILL_STAGE2: Record<string, string>;
export declare const STAGE2_CFG: {
    readonly tauntHpGate: 0.7;
    readonly tauntWaveRatio: 0.5;
    readonly wardMissingBonusMax: 0.6;
    readonly chargeHpGate: 0.5;
    readonly chargeBurstMult: 1.6;
    readonly hexburstLifestealPct: 0.03;
    readonly barrageRampPerShot: 0.2;
    readonly deadshotCritHpGate: 0.5;
    readonly timelockRootGate: 3;
    readonly timelockCdRefund: 0.4;
    readonly summonEmpowerPct: 0.3;
    readonly summonEmpowerCap: 3;
    readonly summonEmpowerExtendSec: 3;
    readonly grouphealMissingWeight: 1.2;
};
