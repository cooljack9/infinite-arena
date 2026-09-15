import { MountDef, MountKind, MountRarity } from '../types';
import { RNG } from '../engine/rng';
export declare const MOUNT_RARITY: Record<MountRarity, {
    cn: string;
    mult: number;
    weight: number;
    color: string;
}>;
export declare const MOUNT_RARITY_KEYS: MountRarity[];
/** 按权重抽品质：蓝 55% / 橙 33% / 紫 12% */
export declare function rollMountRarity(rng: RNG): MountRarity;
export declare const MOUNTS: Record<MountKind, MountDef>;
export declare const MOUNT_KINDS: MountKind[];
/**
 * 随机抽一只坐骑。
 * 五只等权——刻意不做稀有度分层：坐骑之间是「定位不同」而非「强弱不同」，
 * 一旦分了稀有度，玩家就会开始 SL 刷坐骑，而这局游戏的 seed 是锁定的，
 * 那只会变成「重开一局」的挫败感来源。
 */
export declare function rollMount(rng: RNG): MountKind;
export declare const mountOf: (k: MountKind) => MountDef;
/** 骑乘加成的可读摘要（角色面板用）——v2.9.3 按品质乘子缩放后展示 */
export declare function rideSummary(kind: MountKind, rarity?: MountRarity): string;
