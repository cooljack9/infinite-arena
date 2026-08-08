import { genLayer } from '../gen/levelGen.d.ts';
import { BattleSim } from '../engine/battle.d.ts';
import type { GameMode, Unit, Vec2, PrimaryAttrs, HeroGrowth, BattleStatRow } from '../types.d.ts';
import { type Result, type RunSnapshot, type UnitSnapshot, type BattlePlanDTO } from '../contract/index.d.ts';
export interface CreateRunInput {
    runId: string;
    /** 根熵源。一旦给定，后续所有掉落/Boss/商店/成长全部由它确定性派生 */
    seed: number;
    heroIds: string[];
    mode: GameMode;
    /** 安全护栏：未解锁无尽时强制回退新手（防脏存档越权） */
    endlessUnlocked: boolean;
}
export declare function createRun(input: CreateRunInput): Result<RunSnapshot>;
export declare function skipLayer(s: RunSnapshot, bestLayer: number): Result<RunSnapshot>;
/** 无操作推进：版本号 +1（用于远程通路的层间同步/重放） */
export declare function advanceLayer(s: RunSnapshot): Result<RunSnapshot>;
export declare function upgradeHero(s: RunSnapshot, _uid: string): Result<RunSnapshot>;
export interface IdGen {
    next(prefix: string): string;
}
export declare class SeqIdGen implements IdGen {
    private n;
    constructor(n?: number);
    next(p: string): string;
    get cursor(): number;
}
export declare const seeds: {
    layer: (s: number, layer: number) => number;
    drops: (s: number, layer: number) => number;
    shop: (s: number, layer: number, rc: number) => number;
    recruit: (s: number, layer: number, rc: number) => number;
    battle: (s: number, layer: number) => number;
    /** 修复 run.ts:180 的 Math.random —— MVP 奖励属性改为确定性派生 */
    mvp: (s: number, layer: number, uid: string) => number;
    breakthrough: (s: number, uid: string, acc: number) => number;
};
/** 32 位状态指纹哈希（用于战斗 trace 校验和） */
export declare function hashTrace(s: string): string;
/** 战斗内部状态：run 的权威种子（绝不下发给客户端） */
export interface RunSecret {
    seed: number;
}
export declare function planBattle(snap: RunSnapshot, secret: RunSecret): Result<BattlePlanDTO>;
/** 构建双方单位。前后端调用同一函数 → 同输入必同输出 */
export declare function buildUnits(snap: RunSnapshot, secret: RunSecret, formation: Record<string, Vec2>): {
    plan: import("../index.d.ts").LayerPlan;
    allies: Unit[];
    enemies: Unit[];
    scale: {
        hp: number;
        dmg: number;
    };
};
export interface SettleResult {
    battleSeed: number;
    checksum: string;
    result: 'win' | 'lose';
    totalTicks: number;
    durationSec: number;
    stats: BattleStatRow[];
    killGains: Record<string, HeroGrowth>;
    deadAllyUids: string[];
    mvpUid: string | null;
    mvpStat: keyof PrimaryAttrs | null;
    mvpAdd: number;
    allies: UnitSnapshot[];
    enemies: UnitSnapshot[];
    arena: ReturnType<typeof genLayer>['arena'];
    buildings: ReturnType<typeof genLayer>['buildings'];
    buildingScale: {
        hp: number;
        dmg: number;
    };
}
/** 一场战斗的全部输入。后端从 RunSnapshot 推导它，前端从 replay 包直接拿到。 */
export interface SimInput {
    allies: Unit[];
    enemies: Unit[];
    arena: ReturnType<typeof genLayer>['arena'];
    buildings: ReturnType<typeof genLayer>['buildings'];
    layer: number;
    battleSeed: number;
    buildingScale: {
        hp: number;
        dmg: number;
    };
}
/**
 * 由输入装配 BattleSim。**前后端必须走这一个函数**。
 *
 * 装配顺序本身就是协议的一部分：建筑 id 计数器要在 spawnBuildings 之前归零，
 * 而单位构建（buildUnits）会消耗单位 id 计数器。任何一边自己手写这段顺序，
 * 都会在某次重构后悄悄错位——而错位的表现是"胜负一样、过程不同"，肉眼不可见。
 */
export declare function makeSim(i: SimInput): BattleSim;
/** 单 tick 指纹。只抓位置/血量/存活，足以侦测任何演算分歧且 trace 不会爆。 */
export declare function traceLine(sim: BattleSim, step: number): string;
/**
 * 前端复现：只吃 replay 包，跑出与服务端逐 bit 相同的过程。
 *
 * 注意前端**不重建** Unit——快照就是完整 Unit，深拷贝即可用。
 * 任何"补默认值 / 推导字段"的聪明逻辑都是分歧来源（PoC 实测：
 * 误把 skillCd 填成 skill.cd，144 tick 漂成 168 tick，而胜负还一样）。
 */
export declare function replayBattle(replay: {
    allies: UnitSnapshot[];
    enemies: UnitSnapshot[];
    arena: SimInput['arena'];
    buildings: SimInput['buildings'];
    layer: number;
    battleSeed: number;
    buildingScale: {
        hp: number;
        dmg: number;
    };
}, onTick?: (sim: BattleSim, step: number) => void): {
    sim: BattleSim;
    totalTicks: number;
    result: "win" | "lose";
    checksum: string;
};
/**
 * 跑一场权威战斗。**这是后端的核心**——胜负在这里定，客户端只是回放。
 *
 * 实测耗时随 tick 数近似线性，报数必须带上样本，否则会被误读：
 *   新手短局（均值 ~70 tick）    3.3 ms/场
 *   无尽深层（均值 307 tick）   15.2 ms/场   ← Node 22，容器内单核
 * 其中 detmath（确定性三角/幂函数）占 0.01%——每场只调用约 40 次，
 * 都在 Boss 分裂 / 守卫铺位 / 龙息锥形这类低频事件上，不在 per-tick 热路径。
 */
export declare function runBattle(snap: RunSnapshot, secret: RunSecret, formation: Record<string, Vec2>): Result<SettleResult>;
/** 战后把结算写回状态（发奖 / 推层 / 成长 / 铁人移除） */
export declare function applySettlement(snap: RunSnapshot, secret: RunSecret, r: SettleResult): RunSnapshot;
export declare function buyItem(s: RunSnapshot, itemId: string): Result<RunSnapshot>;
export declare function sellItem(s: RunSnapshot, equipmentId: string): Result<RunSnapshot>;
export declare function refreshShop(s: RunSnapshot, secret: RunSecret): Result<RunSnapshot>;
export declare function refreshRecruit(s: RunSnapshot, secret: RunSecret): Result<RunSnapshot>;
export declare function openDrop(s: RunSnapshot, chestId: string): Result<RunSnapshot>;
export declare function equipItem(s: RunSnapshot, uid: string, equipmentId: string): Result<RunSnapshot>;
export declare function unequipItem(s: RunSnapshot, uid: string, equipmentId: string): Result<RunSnapshot>;
export declare function recruit(s: RunSnapshot, secret: RunSecret, heroId: string): Result<RunSnapshot>;
/** 一键装备：按评分从高到低塞满空槽（纯整理操作，无随机、无消耗 → 前端应即时执行） */
export declare function equipAll(s: RunSnapshot, uid?: string): Result<{
    snapshot: RunSnapshot;
    equippedCount: number;
}>;
