// 竞技场布局原型（需求 4.4.2 / 美术 §3）。20×13 tile 网格
// 符号：#墙 .地 P掩体(防御+15%) S我方 E敌方 B Boss台(王座增益) ~虚空(不可通行) w水域(攻速−12%) M岩浆(灼烧3%/s)
import { ArenaDef, ArenaArchetype, Vec2, MapTheme, ThemeInfo, WeatherDef } from '../types';
import { mulberry32, RNG } from '../engine/rng';
import { dpowi } from '../engine/detmath';

const A1: ArenaDef = {
  id: 'A1', name: '圆形竞技场', width: 20, height: 13,
  tiles: [
    '####################',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..S...........E...#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '####################',
  ],
};

const A3: ArenaDef = {
  id: 'A3', name: '立柱迷宫', width: 20, height: 13,
  tiles: [
    '####################',
    '#..................#',
    '#...P......P.......#',
    '#..................#',
    '#......P.......P...#',
    '#..S...........E...#',
    '#..................#',
    '#...P.......P......#',
    '#..................#',
    '#......P.......P...#',
    '#..................#',
    '#..................#',
    '####################',
  ],
};

const A6: ArenaDef = {
  id: 'A6', name: '对称角斗场', width: 20, height: 13,
  tiles: [
    '####################',
    '#..................#',
    '#..................#',
    '#..S..........E....#',
    '#..................#',
    '#.......BBBB.......#',
    '#.......BBBB.......#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '####################',
  ],
};

// ── v2.9.3 程序化地图生成器（种子确定性：同 kind+seed 必然同图）──
// 4 个新类型：楚河汉界 / 剑阁 / 疯狂龙巢 / 真男人八角笼。
// 每个类型用不同 seed 生成多版变体（河宽/通道/掩体随机），扩充 ARENA_LIST 到 12+ 张。
const W = 20, H = 13;
const setCh = (row: string, c: number, ch: string) => row.slice(0, c) + ch + row.slice(c + 1);
const blankTiles = () => {
  const rows: string[] = [];
  for (let r = 0; r < H; r++) {
    let row = '';
    for (let c = 0; c < W; c++) row += r === 0 || r === H - 1 || c === 0 || c === W - 1 ? '#' : '.';
    rows.push(row);
  }
  return rows;
};
/** 在 '.'/'P' 格子上随机撒掩体（避开指定行 band） */
const scatterProps = (tiles: string[], rng: RNG, count: number, skipRows: number[] = []) => {
  let guard = 0;
  let placed = 0;
  while (placed < count && guard++ < 400) {
    const r = 1 + Math.floor(rng() * (H - 2));
    const c = 1 + Math.floor(rng() * (W - 2));
    if (skipRows.includes(r)) continue;
    if (tiles[r][c] === '.') { tiles[r] = setCh(tiles[r], c, 'P'); placed++; }
  }
};
/** 在 '.' 格子上随机撒指定字符（避开指定行 band），用于特色地块（M 岩浆 / w 水域） */
const scatterChar = (tiles: string[], rng: RNG, ch: string, count: number, skipRows: number[] = []) => {
  let guard = 0;
  let placed = 0;
  while (placed < count && guard++ < 400) {
    const r = 1 + Math.floor(rng() * (H - 2));
    const c = 1 + Math.floor(rng() * (W - 2));
    if (skipRows.includes(r)) continue;
    if (tiles[r][c] === '.') { tiles[r] = setCh(tiles[r], c, ch); placed++; }
  }
};
/** 在指定行找一个 '.' 放出生点 */
const placeSpawn = (tiles: string[], rng: RNG, ch: 'S' | 'E', rowBand: number[]) => {  const r = rowBand[Math.floor(rng() * rowBand.length)];
  const cands: number[] = [];
  for (let c = 1; c < W - 1; c++) if (tiles[r][c] === '.') cands.push(c);
  if (!cands.length) return;
  const c = cands[Math.floor(rng() * cands.length)];
  tiles[r] = setCh(tiles[r], c, ch);
};

/** 程序化生成竞技场布局（20×13） */
export function genArena(kind: ArenaArchetype, seed: number): ArenaDef {
  const rng = mulberry32(((seed + 7) * 2654435761) >>> 0);
  let tiles = blankTiles();
  let name = '';
  let dragonNests: number | undefined;

  switch (kind) {
    case 'RIVER': { // 楚河汉界：中间 2~4 格横向大河（水蓝、不可通行），两岸随机掩体，
      // S/E 分列两岸，河上留 2 座桥（近战过河唯一通道——"抢桥"战术）
      name = '楚河汉界';
      const riverRows = 2 + Math.floor(rng() * 3);   // 2~4
      const riverTop = 5 + Math.floor(rng() * 2);    // 5~6 行起
      for (let r = riverTop; r < Math.min(H - 1, riverTop + riverRows); r++) {
        for (let c = 1; c < W - 1; c++) tiles[r] = setCh(tiles[r], c, '~');
      }
      // 两座桥（可行走格）：河段随机两列设为 '.'
      const bridges = rng() < 0.5 ? [5, 14] : [6, 13];
      for (const bc of bridges) {
        for (let r = riverTop; r < Math.min(H - 1, riverTop + riverRows); r++) tiles[r] = setCh(tiles[r], bc, '.');
      }
      scatterProps(tiles, rng, 8, [riverTop - 1, riverTop, riverTop + 1, riverTop + 2]);
      scatterChar(tiles, rng, 'w', 5, [riverTop - 1, riverTop, riverTop + 1, riverTop + 2]); // v2.4.4 浅水(w)：攻速 −12%
      placeSpawn(tiles, rng, 'S', [2, 3]);
      placeSpawn(tiles, rng, 'E', [H - 3, H - 4]);
      break;
    }
    case 'JIANGE': { // 剑阁：中间五列（7~11），单通道（中行）或双通道（上下行）
      name = '剑阁';
      const mode = rng() < 0.5 ? 'single' : 'double';
      const cols = [7, 8, 9, 10, 11];
      for (let r = 1; r < H - 1; r++) for (const c of cols) tiles[r] = setCh(tiles[r], c, '#');
      if (mode === 'single') {
        for (const c of cols) tiles[6] = setCh(tiles[6], c, '.');
      } else {
        for (const c of cols) { tiles[2] = setCh(tiles[2], c, '.'); tiles[10] = setCh(tiles[10], c, '.'); }
      }
      scatterProps(tiles, rng, 4, [6]);
      placeSpawn(tiles, rng, 'S', [6]);
      placeSpawn(tiles, rng, 'E', [6]);
      break;
    }
    case 'DRAGON': { // 疯狂龙巢：普通布局 + 必然 3+ 个龙巢（levelGen 布点）
      name = '疯狂龙巢';
      scatterProps(tiles, rng, 10);
      scatterChar(tiles, rng, 'M', 3); // v2.4.4 岩浆池（M）：站在上面每秒灼烧 3% 最大生命
      placeSpawn(tiles, rng, 'S', [2, 3]);
      placeSpawn(tiles, rng, 'E', [H - 3, H - 4]);
      dragonNests = 3 + Math.floor(rng() * 3); // 3~5
      break;
    }
    case 'CAGE': { // 真男人八角笼：全部岩浆（红），仅中央平台可战
      name = '真男人八角笼';
      tiles = [];
      for (let r = 0; r < H; r++) {
        let row = '';
        for (let c = 0; c < W; c++) {
          const border = r === 0 || r === H - 1 || c === 0 || c === W - 1;
          // v2.9.5 平台从 3×3 扩到 5×6：原尺寸下敌我全挤在 9 格内被瞬秒（"蒸发太快"），
          // 扩大后留出走位空间，战斗更耐打、更贴合"真男人"的硬仗定位
          const cage = r >= 4 && r <= 8 && c >= 7 && c <= 12;
          row += border ? '#' : cage ? '.' : '~';
        }
        tiles.push(row);
      }
      tiles[4] = setCh(tiles[4], 7, 'S');
      tiles[8] = setCh(tiles[8], 12, 'E');
      break;
    }
    case 'VAN': { // v2.9.x 面包车特殊关（cosplay 五菱宏光）：开阔停车场，车队从敌方边冲入
      name = '面包车停车场';
      scatterProps(tiles, rng, 6);
      scatterChar(tiles, rng, 'w', 4); // v2.4.4 积水(w)：攻速 −12%
      placeSpawn(tiles, rng, 'S', [2, 3]);
      placeSpawn(tiles, rng, 'E', [H - 3, H - 4]);
      break;
    }
    default:
      name = '竞技场';
  }

  const arena: ArenaDef = { id: kind, name, width: W, height: H, tiles };
  if (dragonNests !== undefined) arena.dragonNests = dragonNests;
  // v2.9.3 '~' 危险地形配色：楚河汉界水蓝 / 八角笼岩浆红（默认虚空黑由渲染层兜底）
  if (kind === 'RIVER') { arena.hazardBase = '#0d3a6e'; arena.hazardWave = 'rgba(120,200,255,0.38)'; }
  if (kind === 'CAGE') { arena.hazardBase = '#3a0d05'; arena.hazardWave = 'rgba(255,120,40,0.45)'; }
  return arena;
}

// 扩充到 12+ 张：手写 3 张 + 新类型多 seed 变体（同类型不同 seed → 河宽/通道/掩体不同）。
// ARENAS record（含新类型默认实例）放此处：genArena 依赖的 const 辅助函数已初始化。
export const ARENAS: Record<ArenaArchetype, ArenaDef> = {
  A1, A3, A6,
  RIVER: genArena('RIVER', 1),
  JIANGE: genArena('JIANGE', 1),
  DRAGON: genArena('DRAGON', 1),
  CAGE: genArena('CAGE', 1),
  VAN: genArena('VAN', 1),
};

export const ARENA_LIST: ArenaDef[] = [
  A1, A3, A6,
  genArena('RIVER', 1), genArena('RIVER', 2), genArena('RIVER', 3),
  genArena('JIANGE', 1), genArena('JIANGE', 2),
  genArena('DRAGON', 1), genArena('DRAGON', 2),
  genArena('CAGE', 1), genArena('CAGE', 2),
  genArena('VAN', 1), genArena('VAN', 2),
];

// ── 地图主题皮（需求 v1.4 §4.4.8；美术 §3.4）──
// 主题与布局正交：布局管战术（tilemap 一个字节没变），主题管世界。
// 每 10 层换一次而不是随机——随机会毁掉「我打到冰区了」这种空间记忆，
// 而层数只是数字。10 层 ≈ 一个赛段，与赛制节奏对齐。
export const MAP_THEMES: Record<MapTheme, ThemeInfo> = {
  sandstone: { id: 'sandstone', cn: '沙岩竞技场', floorA: '#c8a86a', floorB: '#b8985a', wall: '#7a5f33', prop: '#9b7d4a', accent: '#e8d9a8', particle: 'sand' },
  frost:     { id: 'frost',     cn: '冰霜厅堂',   floorA: '#cfe4f2', floorB: '#b9d4e8', wall: '#6e8fa8', prop: '#8fc4de', accent: '#ffffff', particle: 'mist' },
  magma:     { id: 'magma',     cn: '熔火坑',     floorA: '#4a2118', floorB: '#5a2a1c', wall: '#2a1410', prop: '#ff6b2a', accent: '#ffb347', particle: 'ember' },
  void:      { id: 'void',      cn: '虚空回廊',   floorA: '#1a1428', floorB: '#221a33', wall: '#0e0a18', prop: '#5a3f8a', accent: '#b98cff', particle: 'star', outlineUnits: true },
  verdant:   { id: 'verdant',   cn: '腐殖丛林',   floorA: '#2f4a2a', floorB: '#395a33', wall: '#1d3018', prop: '#5a4326', accent: '#8fd96a', particle: 'leaf' },
  sanctum:   { id: 'sanctum',   cn: '圣殿废墟',   floorA: '#d8d2c0', floorB: '#c8c2b0', wall: '#8a8478', prop: '#a8a294', accent: '#fff4d0', particle: 'dust' },
};

// v1.5 环境天气增益（美术 §3.4.5）：每个主题一套，双方共享（环境中性，不偏袒任一方）。
// 强度（v1.1.0 本地版翻倍后）上限 ±24%（原 ±15%，上表最大 24%）：天气从「微风味」升级为有存在感的变量，但仍非第三个养成系统（不写回任何成长）。
export const WEATHER_BY_THEME: Record<MapTheme, WeatherDef> = {
  sandstone: { kind: 'sandstone', cn: '风沙',     icon: '🌪', moveSpeedAdd: 20 },   // 移速 +20%（v1.1.0 原 +10%）
  frost:     { kind: 'frost',     cn: '霜寒',     icon: '❄', atkSpeedAdd: -24 },   // 攻击间隔 +24%（atkSpeed -24，v1.1.0 原 -12）
  magma:     { kind: 'magma',     cn: '熔火',     icon: '🔥', dmgMul: 1.24 },        // 伤害 +24%（v1.1.0 原 +12%）
  void:      { kind: 'void',      cn: '虚空侵蚀', icon: '🌌', critAdd: 16 },         // 暴击 +16%（v1.1.0 原 +8%）
  verdant:   { kind: 'verdant',   cn: '丰茂',     icon: '🌿', regenPct: 0.024 },     // 每秒回复 2.4% 最大生命（v1.1.0 原 1.2%）
  sanctum:   { kind: 'sanctum',   cn: '圣光',     icon: '✨', dmgTakenMul: 0.76 },   // 受到伤害 -24%（v1.1.0 原 -12%）
};

const THEME_ORDER: MapTheme[] = ['sandstone', 'frost', 'magma', 'void', 'verdant', 'sanctum'];
const THEME_SPAN = 10;                                // 每 10 层一个主题
const CYCLE_LEN = THEME_ORDER.length * THEME_SPAN;    // 60 层一轮
export const MAX_FADE_CYCLE = 4;                      // 褪色上限，再深就地面和单位分不开了

/** 按层深取主题（美术 §3.4） */
export function themeForDepth(depth: number): MapTheme {
  const idx = Math.floor(((depth - 1) % CYCLE_LEN) / THEME_SPAN);
  return THEME_ORDER[Math.max(0, Math.min(THEME_ORDER.length - 1, idx))];
}

/** 循环褪色级数：无限模式必须能无限跑，滤镜叠加把「循环」变成「越走越荒芜」的叙事 */
export function fadeCycleForDepth(depth: number): number {
  return Math.min(MAX_FADE_CYCLE, Math.floor((depth - 1) / CYCLE_LEN));
}

/** 应用褪色滤镜：色相 −8°/轮、饱和 ×0.90/轮、亮度 ×0.96/轮（美术 §3.4.3） */
export function fadeColor(hex: string, cycle: number): string {
  if (cycle <= 0) return hex;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  // RGB → HSL
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0; const l = (max + min) / 2;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  h = (h + (-8 / 360) * cycle + 1) % 1;
  // 禁用 Math.pow：cycle 是整数，dpowi 用平方求幂（只有乘法，天然确定）。
  // 这里虽是颜色、不进战斗校验和，但末尾 to2() 会把结果四舍五入到 0–255，
  // 1 个 ULP 的差异足以让某个通道在不同浏览器上差 1，主题色于是对不上。
  s = s * dpowi(0.90, cycle);
  const l2 = l * dpowi(0.96, cycle);
  // HSL → RGB
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t; if (tt < 0) tt += 1; if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  if (s === 0) { r = g = b = l2; } else {
    const q = l2 < 0.5 ? l2 * (1 + s) : l2 + s - l2 * s;
    const p = 2 * l2 - q;
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
  }
  const to2 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

/** 给布局注入主题（布局与主题正交，故是一次浅拷贝而非改 tilemap） */
export function withTheme(arena: ArenaDef, depth: number): ArenaDef {
  const theme = themeForDepth(depth);
  return {
    ...arena,
    theme,
    fade: fadeCycleForDepth(depth),
    weather: WEATHER_BY_THEME[theme], // v1.5：天气由主题推导，随层深循环确定性生成
    layer: depth,                     // 反"堆一人"：敌方针对最强被动按层调度（battle.ts 读取）
  };
}

/** 天气增益文案（HUD 横幅 / 小标签共用）。统一「双方共享」语义。 */
export function weatherSummary(w: WeatherDef): string {
  if (w.moveSpeedAdd !== undefined) return `全员移速 ${w.moveSpeedAdd > 0 ? '+' : ''}${w.moveSpeedAdd}%`;
  if (w.atkSpeedAdd !== undefined) return `攻击间隔 ${w.atkSpeedAdd > 0 ? '+' : ''}${w.atkSpeedAdd}%`;
  if (w.dmgMul !== undefined) return `伤害 +${Math.round((w.dmgMul - 1) * 100)}%`;
  if (w.critAdd !== undefined) return `暴击 +${w.critAdd}%`;
  if (w.regenPct !== undefined) return `每秒回复 ${Math.round(w.regenPct * 100)}% 最大生命`;
  if (w.dmgTakenMul !== undefined) return `受到伤害 ${Math.round((w.dmgTakenMul - 1) * 100)}%`;
  return '';
}

// 解析出生点与 Boss 台（tile 坐标中心）
export function parseSpawns(arena: ArenaDef): { ally: Vec2[]; enemy: Vec2[]; boss?: Vec2 } {
  const ally: Vec2[] = [];
  const enemy: Vec2[] = [];
  let boss: Vec2 | undefined;
  for (let r = 0; r < arena.tiles.length; r++) {
    for (let c = 0; c < arena.tiles[r].length; c++) {
      const ch = arena.tiles[r][c];
      const p = { x: c + 0.5, y: r + 0.5 };
      if (ch === 'S') ally.push(p);
      else if (ch === 'E') enemy.push(p);
      else if (ch === 'B') boss = p;
    }
  }
  return { ally, enemy, boss };
}
