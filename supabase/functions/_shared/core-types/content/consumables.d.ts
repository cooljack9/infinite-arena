import { ConsumableItem, ConsumableKind, GrowthRoll, PrimaryAttrs } from '../types.d.ts';
import { RNG } from '../engine/rng.d.ts';
/** 商店每个货位产出一次性物品的概率（需求 v1.7 §4：20%） */
export declare const CONSUMABLE_CHANCE = 0.2;
interface ConsumableCfg {
    name: string;
    desc: string;
    basePrice: number;
    color: string;
    icon: string;
}
export declare const CONSUMABLE_CFG: Record<ConsumableKind, ConsumableCfg>;
/** 成长药剂的二级属性成长区间（百分点） */
export declare const GROWTH_POTION_PCT: {
    min: number;
    max: number;
};
/** 成长药剂的核心属性固定增幅 */
export declare const GROWTH_POTION_PRIMARY = 0.5;
/** 爆发药剂：主属性乘子 */
export declare const BURST_MULT = 1.5;
export declare function makeConsumable(kind: ConsumableKind): ConsumableItem;
/** 随机一种一次性物品（两种等概率） */
export declare function rollConsumable(rng: RNG): ConsumableItem;
/**
 * 掷一次成长药剂的结果。
 * 与击杀成长共用 GrowthRoll 结构，好处是 store 只需要一个 applyGrowth 入口，
 * 两个来源永远不会算出不一致的结果。
 */
export declare function rollGrowthPotion(rng: RNG): GrowthRoll;
/** 主属性 = 基础核心属性中的最高项（决定爆发药剂增强谁） */
export declare function dominantPrimary(p: PrimaryAttrs): keyof PrimaryAttrs;
export {};
