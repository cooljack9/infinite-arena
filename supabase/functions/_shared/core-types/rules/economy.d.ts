import type { Equipment, PrimaryAttrs, HeroGrowth } from '../types';
import type { RNG } from '../engine/rng';
export declare const EQUIP_SLOTS = 6;
export declare const TEAM_CAP = 7;
export declare const REFRESH_COST = 1;
export declare const FUSE_PER_LAYER = 2;
/** 生成教学初始装备包：2 蓝 + 2 白，全部已开箱（直接可用） */
export declare function rollStarterKit(rng: RNG): Equipment[];
export declare const BREAKTHROUGH_MAIN_CHANCE = 0.6;
export declare const discountOf: (tradeCount: number) => number;
export declare const recruitCostOf: (layer: number, base?: PrimaryAttrs, preset?: PrimaryAttrs) => number;
export declare const goldReward: (layer: number) => number;
export declare const hashStr: (s: string) => number;
export declare function addGrowth(existing: HeroGrowth | undefined, add: HeroGrowth): HeroGrowth;
