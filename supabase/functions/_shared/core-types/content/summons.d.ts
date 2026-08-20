import { SummonKind, SummonTemplate, Unit } from '../types';
export declare const SUMMON_TEMPLATES: Record<SummonKind, SummonTemplate>;
export declare const MAX_SUMMONS = 2;
/**
 * 召唤选型（需求 §5.2.2）。
 * 三条判定的价值不在于最优，而在于**可播报**——日志打一行字，
 * 玩家立刻建立「原来它会看场上情况」的心智模型。
 * lastKind 用于保底轮换：连出三个同类型，玩家只会觉得系统坏了。
 */
export declare function pickSummonKind(allies: Unit[], enemies: Unit[], lastKind?: SummonKind): {
    kind: SummonKind;
    reason: string;
};
