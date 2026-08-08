import { ArenaDef, Vec2 } from '../types.d.ts';
/** 我方可部署区：左起第 1..6 列（tile 索引，0 列是外墙） */
export declare const DEPLOY_COL_MIN = 1;
export declare const DEPLOY_COL_MAX = 6;
/** 取 tile 字符；越界一律视作墙 */
export declare function tileAt(arena: ArenaDef, c: number, r: number): string;
/** 该格是否可通行（用于敌方展开与通用寻位） */
export declare function isWalkable(arena: ArenaDef, c: number, r: number): boolean;
/** 该格是否属于我方部署区且可站立 */
export declare function isDeployable(arena: ArenaDef, c: number, r: number): boolean;
/** tile 中心坐标 ↔ 整数格 */
export declare const toCell: (p: Vec2) => {
    c: number;
    r: number;
};
export declare const toPos: (c: number, r: number) => Vec2;
export declare const cellKey: (c: number, r: number) => string;
export declare const posKey: (p: Vec2) => string;
/** 全部可部署格（按行优先，稳定顺序） */
export declare function deployCells(arena: ArenaDef): Vec2[];
export type FormationPreset = 'line' | 'wedge' | 'spread' | 'turtle';
export declare const FORMATION_PRESETS: Record<FormationPreset, {
    cn: string;
    desc: string;
    offsets: [number, number][];
}>;
/** 按预设生成站位（anchor 缺省取部署区中部） */
export declare function presetFormation(arena: ArenaDef, anchor: Vec2 | undefined, count: number, preset?: FormationPreset): Vec2[];
/**
 * 合法化玩家保存的站位：
 * 地图每层会换（A1/A3/A6），旧坐标可能落在掩体或部署区外，
 * 因此每层进战前都要按当前地图重新校验一遍，非法项就近吸附。
 */
export declare function sanitizeFormation(arena: ArenaDef, saved: (Vec2 | undefined)[] | null | undefined, anchor: Vec2 | undefined, count: number): Vec2[];
/**
 * 敌方展开：以锚点做受限 BFS，扩散出 count 个互不重叠的可走格。
 * 限制：不得越过地图中线（否则开场敌人就杵在我方脸上），Boss 台 'B' 例外可占。
 * 邻居顺序固定为 上/下/右/左，保证展开形状确定且偏向敌方半场。
 */
export declare function spreadPositions(arena: ArenaDef, anchors: Vec2[], count: number, opts?: {
    allowBossTile?: boolean;
    minCol?: number;
}): Vec2[];
/**
 * 敌方开场落点（战前预览与实际开战共用同一函数，保证「所见即所战」）。
 * Boss 优先占 'B' 台（A6 有中央高台），其余按 BFS 列阵展开。
 */
export declare function enemyPlacements(arena: ArenaDef, spawnEnemy: Vec2[], bossPos: Vec2 | undefined, defs: {
    isBoss?: boolean;
}[]): Vec2[];
