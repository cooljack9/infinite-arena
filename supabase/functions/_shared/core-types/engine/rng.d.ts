export declare function mulberry32(seed: number): () => number;
export type RNG = () => number;
export declare function randInt(rng: RNG, min: number, max: number): number;
export declare function pick<T>(rng: RNG, arr: T[]): T;
export declare function shuffle<T>(rng: RNG, arr: T[]): T[];
