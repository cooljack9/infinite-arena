import { HeroDef } from '../types';
/**
 * 把一份英雄模板/副本，按种子派生为「个体差异化」的副本。
 * @param base  模板或既有副本（只读，不被修改）
 * @param seed  决定本次差异的确定性种子（由调用方用 run.seed 混盐得到）
 * @returns     新的 HeroDef：basePrimary 与 bodyType 已个体化，其余字段原样保留
 */
export declare function variateHero(base: HeroDef, seed: number, takenNames?: Iterable<string>): HeroDef;
