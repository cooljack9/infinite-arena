import { HeroDef } from '../types.d.ts';
import { RNG } from '../engine/rng.d.ts';
export declare const HEROES: HeroDef[];
export declare const HERO_BY_ID: Record<string, HeroDef>;
export declare function rollRecruitPool(rng: RNG, team: HeroDef[], count?: number): HeroDef[];
