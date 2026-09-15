import { ArenaDef, ArenaArchetype, Vec2, MapTheme, ThemeInfo, WeatherDef } from '../types';
/** 程序化生成竞技场布局（20×13） */
export declare function genArena(kind: ArenaArchetype, seed: number): ArenaDef;
export declare const ARENAS: Record<ArenaArchetype, ArenaDef>;
export declare const ARENA_LIST: ArenaDef[];
export declare const MAP_THEMES: Record<MapTheme, ThemeInfo>;
export declare const WEATHER_BY_THEME: Record<MapTheme, WeatherDef>;
export declare const MAX_FADE_CYCLE = 4;
/** 按层深取主题（美术 §3.4） */
export declare function themeForDepth(depth: number): MapTheme;
/** 循环褪色级数：无限模式必须能无限跑，滤镜叠加把「循环」变成「越走越荒芜」的叙事 */
export declare function fadeCycleForDepth(depth: number): number;
/** 应用褪色滤镜：色相 −8°/轮、饱和 ×0.90/轮、亮度 ×0.96/轮（美术 §3.4.3） */
export declare function fadeColor(hex: string, cycle: number): string;
/** 给布局注入主题（布局与主题正交，故是一次浅拷贝而非改 tilemap） */
export declare function withTheme(arena: ArenaDef, depth: number): ArenaDef;
/** 天气增益文案（HUD 横幅 / 小标签共用）。统一「双方共享」语义。 */
export declare function weatherSummary(w: WeatherDef): string;
export declare function parseSpawns(arena: ArenaDef): {
    ally: Vec2[];
    enemy: Vec2[];
    boss?: Vec2;
};
