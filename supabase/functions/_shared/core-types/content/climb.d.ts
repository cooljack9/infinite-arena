import type { Unit } from '../types';
export type ClimbStrategy = 'raidRear' | 'steadyPush' | 'breakThrough';
export interface ClimbStrategyDef {
    id: ClimbStrategy;
    name: string;
    /** 一句话效果描述（UI 卡片直接展示） */
    desc: string;
    /** 前排（普攻距离<4）专属 buff */
    frontRow?: {
        moveSpeed?: number;
        hpMult?: number;
    };
    /** 全队 buff */
    all?: {
        moveSpeed?: number;
        atkSpeed?: number;
        dmgMult?: number;
        hpMult?: number;
    };
}
export declare const CLIMB_STRATEGIES: Record<ClimbStrategy, ClimbStrategyDef>;
export declare const CLIMB_STRATEGY_IDS: ClimbStrategy[];
/** 普攻距离 < 4 判定为前排（与引擎 attackRange > 3 = 远程的口径互补） */
export declare function isFrontRowUnit(u: Unit): boolean;
/**
 * 把战略 buff 应用到友方单位（排除召唤物）。
 * 乘法乘区（hp/dmg）与加减百分点（移速/攻速）与 applyRelics 语义一致，逐 bit 可复现。
 */
export declare function applyClimbStrategy(units: Unit[], strategy: ClimbStrategy): void;
