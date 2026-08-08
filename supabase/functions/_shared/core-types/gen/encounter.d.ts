import { EnemyDef } from '../types.d.ts';
import { RNG } from '../engine/rng.d.ts';
export declare function buildWaves(rng: RNG, n: number, bossTier?: 'strong' | 'normal'): EnemyDef[][];
