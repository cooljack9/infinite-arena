import { RandomEvent } from '../types';
import { RNG } from '../engine/rng';
/**
 * 按层种子确定性抽取一个随机事件（或 undefined 表示本层无事件）。
 * 触发节奏：每层基础概率 35%，且避开第 1 层（留给教学）与 Boss 层（避免信息过载）。
 */
export declare function rollRandomEvent(rng: RNG, layer: number, isBoss: boolean): RandomEvent | undefined;
