import { SkillDef, SubClass, RangeTier, SkillStyle, VfxMotion } from '../types';
export declare const VFX_SCALE = 1.85;
export interface SkillVfx {
    color: string;
    sizeMul: number;
    motion: VfxMotion;
}
export declare const SKILL_VFX: Record<SkillStyle, SkillVfx>;
export declare const BOSS_VFX_OVERRIDE: Record<string, {
    color: string;
    sizeMul: number;
}>;
/** 取某技能的签名视觉（含 Boss 覆盖）。仅对真实技能调用（'none' 已被 short-circuit）。 */
export declare function vfxOf(skill: SkillDef, isBoss?: boolean): SkillVfx;
export declare const SKILLS: Record<string, SkillDef>;
export declare const SUBCLASS_SKILL: Record<SubClass, string>;
export declare function rangeTier(castRange?: number): RangeTier;
export declare const TIER_TTL: Record<RangeTier, number>;
export declare const LONG_WARN_TIME = 0.22;
export declare const midFlightTime: (castRange: number) => number;
export declare const beamThickness: (castRange: number) => number;
