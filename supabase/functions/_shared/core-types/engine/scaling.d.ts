import { GameMode } from '../types.d.ts';
export interface ScaleCfg {
    knee: number;
    linHp: number;
    linDmg: number;
    expHp: number;
    expDmg: number;
}
/** 运行时覆盖缩放参数（外部 tuning.json 调用，便于 MOD / 二次开发调参） */
export declare function overrideScaling(p: Partial<ScaleCfg>): void;
export declare function enemyScale(n: number): {
    hp: number;
    dmg: number;
};
export declare const isVacuum: (n: number) => boolean;
export declare const isMutation: (n: number) => boolean;
export declare function segmentMult(n: number): number;
export declare function bossTierAt(n: number, mode?: GameMode): 'strong' | 'normal' | undefined;
export declare const DEMO_CAP = 30;
export declare const NOVICE_CAP = 5;
export declare const ENDLESS_CAP = 500;
export declare function capFor(mode: GameMode): number;
