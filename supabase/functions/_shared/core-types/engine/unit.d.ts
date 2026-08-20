import { HeroDef, EnemyDef, Unit, DerivedAttrs, Equipment, BodyType, HeroGrowth, MountKind, MountRarity, Gender } from '../types';
export declare const nextId: () => string;
/**
 * 把单位 id 计数器归零。**仅供"一次战斗构建"的同步作用域调用**（见 backend/rules.runBattle）。
 *
 * 为什么必须有：单位 id 会进入回放校验和。若沿用进程级递增值，同一 seed 在
 * 「刚启动的客户端」和「已经打了 50 场的服务端」会得到不同的 id（u0.. vs u250..），
 * checksum 直接漂移——PoC 实测就是这么翻车的：同种子跨后端实例结果不一致。
 * JS 单线程内"重置 → 构建 → 开打"是一段不可中断的同步代码，故此处安全。
 * （阶段 1 抽 @arena/core 时会改为注入式 IdGen，彻底消灭模块级可变状态。）
 */
export declare const resetUid: (n?: number) => void;
export declare function applyEquipment(base: DerivedAttrs, eqs: Equipment[]): DerivedAttrs;
export declare function applyBody(d: DerivedAttrs, body: BodyType): DerivedAttrs;
export declare function applyGender(d: DerivedAttrs, g?: Gender): DerivedAttrs;
export declare const genderOf: (def?: Gender, key?: string) => Gender;
export interface CombatParams {
    lightAs: number;
    heavyAs: number;
    heavyAt: number;
    heavyBurstCount: number;
}
export declare const combatParamsOf: (key?: string) => CombatParams;
export declare function applyGrowthPct(d: DerivedAttrs, g?: HeroGrowth): DerivedAttrs;
export declare function applyMount(d: DerivedAttrs, kind?: MountKind, rarity?: MountRarity): DerivedAttrs;
/**
 * v3.1 显示名 = 个体姓名。
 *
 * 旧版是「职业称号 + 罗马数字」（铁壁镇守 II / III）。那套编号在部署页与战报里
 * 反复出现，把三个属性、体型、性别都不同的角色写成了同一个人的三份拷贝，
 * 既不好看，也和 variant.ts 的个体化设计互相拆台。
 * 现在每份副本自带姓名（variateHero 生成），职业称号退居为身份标签单独展示。
 * personalName 缺失时（旧存档 / 未个体化的模板）回退到称号，不再追加任何后缀。
 */
export declare const displayName: (hero: {
    name: string;
    personalName?: string;
}) => string;
export interface AllyOpts {
    /** v1.7 §4：爆发药剂生效中——主属性 ×1.5，仅本场 */
    burst?: boolean;
}
export declare function makeAlly(hero: HeroDef, level: number, equipment?: Equipment[], opts?: AllyOpts): Unit;
export declare function makeEnemy(enemy: EnemyDef, level: number, scaleHp: number, scaleDmg: number): Unit;
