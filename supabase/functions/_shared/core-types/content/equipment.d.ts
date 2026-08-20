import { Rarity, AffixKey, Affix, AffixMode, Equipment, Chest, ChestReward, ConsumableItem } from '../types';
import { RNG } from '../engine/rng';
export declare const AFFIX_POOL: Record<AffixKey, {
    name: string;
    min: number;
    max: number;
}>;
interface RarityCfg {
    mult: number;
    affixMin: number;
    affixMax: number;
    weight: number;
    basePrice: number;
    prefix: string;
}
export declare const RARITY_CFG: Record<Rarity, RarityCfg>;
export declare const rarityName: (r: Rarity) => string;
export declare const PCT_CHANCE: Record<Rarity, number>;
export declare const PCT_RANGE: Record<Rarity, {
    min: number;
    max: number;
}>;
export declare const QUALITY_LEVEL: Record<Rarity, number>;
export declare const eqStarMult: (eq: Equipment) => number;
/** 装备显示名：红装带星级前缀（附录 A.5.2） */
export declare const equipDisplayName: (eq: Equipment) => string;
export declare function equipScore(eq: Equipment): number;
export declare function generateEquipment(rng: RNG, rarity?: Rarity): Equipment;
/** 箱子数量：Boss 关 8~12，小关卡 3~6（需求 v1.7 §3） */
export declare const chestCount: (rng: RNG, boss: boolean) => number;
/** 掉落表：40% 普通装备 / 20% 少量金钱 / 20% 高级装备 / 10% 稀有装备 / 10% 大量金钱 */
export declare const CHEST_TABLE: {
    reward: ChestReward;
    p: number;
}[];
/**
 * v1.8 下五层挑战的「高奖 +10%」掉落表：高装 0.20→0.25、稀装 0.10→0.15
 * （高奖档合计 0.30→0.40，+10 个百分点），其余档按比例归一（普通/小钱/大钱 ×0.85714）。
 */
export declare const CHEST_TABLE_HIGH: {
    reward: ChestReward;
    p: number;
}[];
/** 金钱档面额随层数线性走高，保证中后期的箱子不会变成「捡几块钱」 */
export declare const chestGold: (rng: RNG, layer: number, big: boolean) => number;
/** 开一个箱：按掉落表决定是装备还是金钱（v1.8 highBonus = 下五层高奖 +10% 表） */
export declare function rollChest(rng: RNG, layer: number, highBonus?: boolean): Chest;
/** 一场战斗的全部掉落箱（v1.8 highBonus = 下五层高奖 +10% 表） */
export declare function rollDrops(rng: RNG, layer: number, boss: boolean, highBonus?: boolean): Chest[];
export interface ShopStock {
    equipment: Equipment[];
    consumables: ConsumableItem[];
}
export declare function rollShopStock(rng: RNG, count?: number): ShopStock;
export declare const NEGATIVE_AFFIXES: Affix[];
export declare const forgeSuccessRate: (consumeN: number) => number;
export declare function forgeEquipment(eq: Equipment, consumeN: number, rng: RNG): Equipment;
export interface TransferLog {
    key: AffixKey;
    keyName: string;
    mode: AffixMode;
    value: number;
    ok: boolean;
    note: string;
}
/** 单条词条转移成功率：P = 0.35 + 0.10 × 素材品质等级（35% / 45% / 55% / 65%） */
export declare const transferRate: (materialRarity: Rarity) => number;
export declare function transferAffixes(target: Equipment, materials: Equipment[], rng: RNG): {
    result: Equipment;
    logs: TransferLog[];
};
export type FuseKind = 'upgrade' | 'ascend';
/** 判断两件装备能否合成，返回合成类型；不可合成返回 null */
export declare function fuseKindOf(a: Equipment, b: Equipment): FuseKind | null;
/**
 * 执行合成。
 * - upgrade：2 件同阶（蓝/橙）→ 1 件随机高阶，词条全新生成
 * - ascend：红 + 红 → 目标 star + 1（封顶 5），词条不变、由 eqStarMult 统一放大
 */
export declare function fuseEquipment(a: Equipment, b: Equipment, rng: RNG): Equipment | null;
export {};
