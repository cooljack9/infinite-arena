import { ClassCategory, SubClass, DamageType, BodyType } from '../types.d.ts';
export interface SubClassInfo {
    category: ClassCategory;
    name: string;
    cn: string;
    damageType: DamageType;
    attackRange: number;
    color: string;
    color2: string;
    defaultBody: BodyType;
}
export declare const SUBCLASS_INFO: Record<SubClass, SubClassInfo>;
export declare const ALL_SUBCLASSES: SubClass[];
export interface BodyInfo {
    id: BodyType;
    cn: string;
    hpMult: number;
    msMult: number;
    asMult: number;
    sizeMult: number;
    dodgeBonus: number;
    renderPx: number;
    outline: number;
    trailFrames: number;
    shadow: boolean;
    trait: string;
    traitDesc: string;
}
export declare const BASE_BODY_SCALE = 1.3;
export declare const BODY_INFO: Record<BodyType, BodyInfo>;
export declare const ALL_BODY_TYPES: BodyType[];
export declare const hitRadiusOf: (b: BodyType) => number;
export declare const starMult: (star?: number) => number;
export declare const starGrowthBonus: (star?: number) => number;
export declare const skillLevelOf: (star?: number) => number;
export declare const skillPowerMult: (star?: number) => number;
export declare const skillStarCdr: (star?: number) => number;
