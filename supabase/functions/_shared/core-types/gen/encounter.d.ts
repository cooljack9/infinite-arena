import { EnemyDef } from '../types';
import { RNG } from '../engine/rng';
export declare function buildWaves(rng: RNG, n: number, bossTier?: 'strong' | 'normal'): EnemyDef[][];
