import { BuildingDef, BuildingKind, BuildingSpawnKind, PrimaryAttrs, SubClass, BodyType, MonsterKind, SkillDef } from '../types';
export declare const BUILDINGS: Record<BuildingKind, BuildingDef>;
export declare const BUILDING_KINDS: BuildingKind[];
export declare const buildingOf: (k: BuildingKind) => BuildingDef;
/** 是否为塔类（有攻击的建筑）——渲染与战报都要区分「会打人的楼」和「会生崽的楼」 */
export declare const isTower: (k: BuildingKind) => boolean;
export interface SpawnTemplate {
    name: string;
    subclass: SubClass;
    basePrimary: PrimaryAttrs;
    bodyType: BodyType;
    monsterKind?: MonsterKind;
    skill?: SkillDef;
    /** 相对波次怪的强度折算：小兵偏弱，龙类偏强 */
    hpMult: number;
    dmgMult: number;
}
export declare const SPAWN_TEMPLATES: Record<BuildingSpawnKind, SpawnTemplate>;
export declare function buildingCountFor(layer: number): number;
/** 该层可用的建筑池（按 minLayer 过滤） */
export declare function availableBuildings(layer: number): BuildingDef[];
