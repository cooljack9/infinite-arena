// 战前布阵（v2.3 需求：战斗开始前要能调整站位）
//
// 背景：三张布局各自只有 1 个 'S' 与 1 个 'E' 标记，原本 BattleScreen 用
// `spawnAlly[i % spawnAlly.length]` 取点，结果全队 3 人叠在同一格、敌方一整波也叠在同一格。
// 引擎的分离力会在开场前几帧把他们「炸」开，既难看又让开局站位不可控。
//
// 本模块做两件事：
//   1. 我方：给出可部署格集合 + 4 套预设阵型 + 玩家自定义站位的合法化（sanitize）；
//   2. 敌方：以 'E'/'B' 为锚做受限 BFS 展开，让敌军开场就是列阵而不是一坨。
//
// 设计约束：全部为纯函数、无随机（战斗确定性依赖固定初始状态）。
import { ArenaDef, Vec2 } from '../types';

/** 我方可部署区：左起第 1..6 列（tile 索引，0 列是外墙） */
export const DEPLOY_COL_MIN = 1;
export const DEPLOY_COL_MAX = 6;

/** 不可站立的地形符号：#墙 P掩体 ~虚空 B Boss台 E敌方出生 */
const BLOCKED = new Set(['#', 'P', '~', 'B', 'E', 'M']); // v2.9.3 'M' 岩浆：出生/展开避开

/** 取 tile 字符；越界一律视作墙 */
export function tileAt(arena: ArenaDef, c: number, r: number): string {
  if (r < 0 || r >= arena.tiles.length) return '#';
  const row = arena.tiles[r];
  if (c < 0 || c >= row.length) return '#';
  return row[c];
}

/** 该格是否可通行（用于敌方展开与通用寻位） */
export function isWalkable(arena: ArenaDef, c: number, r: number): boolean {
  return !BLOCKED.has(tileAt(arena, c, r));
}

/** 该格是否属于我方部署区且可站立 */
export function isDeployable(arena: ArenaDef, c: number, r: number): boolean {
  if (c < DEPLOY_COL_MIN || c > DEPLOY_COL_MAX) return false;
  return isWalkable(arena, c, r);
}

/**
 * 全图可站格（不受部署区列限制）。供「时空拓印」特性英雄布阵使用：
 * 普通英雄只能站左 1~6 列（isDeployable），时空拓印可站全图任意非阻挡格。
 */
export function allStandable(arena: ArenaDef, c: number, r: number): boolean {
  return isWalkable(arena, c, r);
}

/** 按英雄特性返回该格是否可部署：时空拓印 → 全图可站；否则 → 我方部署区 */
export function deployableFor(hero: { traitId?: string } | undefined, arena: ArenaDef, c: number, r: number): boolean {
  return hero?.traitId === 'spacetime' ? allStandable(arena, c, r) : isDeployable(arena, c, r);
}

/** tile 中心坐标 ↔ 整数格 */
export const toCell = (p: Vec2) => ({ c: Math.floor(p.x), r: Math.floor(p.y) });
export const toPos = (c: number, r: number): Vec2 => ({ x: c + 0.5, y: r + 0.5 });
export const cellKey = (c: number, r: number) => `${c},${r}`;
export const posKey = (p: Vec2) => cellKey(Math.floor(p.x), Math.floor(p.y));

/** 全部可部署格（按行优先，稳定顺序） */
export function deployCells(arena: ArenaDef): Vec2[] {
  const out: Vec2[] = [];
  for (let r = 0; r < arena.tiles.length; r++) {
    for (let c = DEPLOY_COL_MIN; c <= DEPLOY_COL_MAX; c++) {
      if (isDeployable(arena, c, r)) out.push(toPos(c, r));
    }
  }
  return out;
}

// ── 预设阵型 ───────────────────────────────────────────────────────────
// 偏移相对锚点（'S' 格）。dx 为正 = 更靠前（朝敌方），dy 为正 = 更靠下。
// 顺序即队伍索引顺序，所以 1 号位永远是该阵型的「核心位」。
export type FormationPreset = 'line' | 'wedge' | 'spread' | 'turtle';

export const FORMATION_PRESETS: Record<
  FormationPreset,
  { cn: string; desc: string; offsets: [number, number][] }
> = {
  line: {
    cn: '纵列',
    desc: '一字排开，站位均衡，无明显软肋',
    offsets: [[0, 0], [0, -2], [0, 2], [0, -4], [0, 4], [1, -1], [1, 1]],
  },
  wedge: {
    cn: '楔形',
    desc: '前锋突出承伤，后排斜掠输出',
    offsets: [[2, 0], [0, -2], [0, 2], [-2, -3], [-2, 3], [-1, -1], [-1, 1]],
  },
  spread: {
    cn: '散阵',
    desc: '大间距拉开，规避范围技能连锁',
    offsets: [[1, -4], [0, 0], [1, 4], [-2, -2], [-2, 2], [2, -1], [2, 1]],
  },
  turtle: {
    cn: '龟缩',
    desc: '全员靠后收缩，逼敌方长驱直入',
    offsets: [[-1, 0], [-2, -2], [-2, 2], [-3, -1], [-3, 1], [-3, -3], [-3, 3]],
  },
};

/**
 * 把一组理想偏移落到实际可部署格上：
 * 逐个取目标格，若被占/非法则以曼哈顿螺旋找最近的合法空格。
 * 找不到就退化到任意剩余可部署格（保证永远返回 count 个不重叠坐标）。
 */
function resolveOffsets(
  arena: ArenaDef,
  anchor: Vec2,
  offsets: [number, number][],
  count: number,
): Vec2[] {
  const ac = Math.floor(anchor.x);
  const ar = Math.floor(anchor.y);
  const used = new Set<string>();
  const out: Vec2[] = [];

  for (let i = 0; i < count; i++) {
    const [dx, dy] = offsets[i % offsets.length];
    // 同一偏移被复用时（队伍超过预设长度）再往下压一格，避免直接撞车
    const extra = Math.floor(i / offsets.length);
    const tc = ac + dx;
    const tr = ar + dy + extra;
    const found = nearestFree(arena, tc, tr, used);
    if (found) {
      used.add(cellKey(found.c, found.r));
      out.push(toPos(found.c, found.r));
    } else {
      // 极端兜底：部署区被占满，直接堆在锚点（不会发生于现有 3 张图）
      out.push(toPos(ac, ar));
    }
  }
  return out;
}

/** 以 (c,r) 为中心按半径递增找最近的合法空部署格 */
function nearestFree(
  arena: ArenaDef,
  c: number,
  r: number,
  used: Set<string>,
): { c: number; r: number } | null {
  const maxR = Math.max(arena.width, arena.height);
  for (let rad = 0; rad <= maxR; rad++) {
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        // 只走「环」，内部在更小的 rad 已检查过
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (!isDeployable(arena, nc, nr)) continue;
        if (used.has(cellKey(nc, nr))) continue;
        return { c: nc, r: nr };
      }
    }
  }
  return null;
}

/** 按预设生成站位（anchor 缺省取部署区中部） */
export function presetFormation(
  arena: ArenaDef,
  anchor: Vec2 | undefined,
  count: number,
  preset: FormationPreset = 'line',
): Vec2[] {
  const a = anchor ?? toPos(3, Math.floor(arena.height / 2));
  return resolveOffsets(arena, a, FORMATION_PRESETS[preset].offsets, count);
}

/**
 * 合法化玩家保存的站位：
 * 地图每层会换（A1/A3/A6），旧坐标可能落在掩体或部署区外，
 * 因此每层进战前都要按当前地图重新校验一遍，非法项就近吸附。
 */
export function sanitizeFormation(
  arena: ArenaDef,
  saved: (Vec2 | undefined)[] | null | undefined,
  anchor: Vec2 | undefined,
  count: number,
): Vec2[] {
  const fallback = presetFormation(arena, anchor, count, 'line');
  if (!saved || saved.length === 0) return fallback;

  const used = new Set<string>();
  const out: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const s = saved[i];
    const base = s ?? fallback[i];
    const found = nearestFree(arena, Math.floor(base.x), Math.floor(base.y), used);
    const cell = found ?? { c: Math.floor(fallback[i].x), r: Math.floor(fallback[i].y) };
    used.add(cellKey(cell.c, cell.r));
    out.push(toPos(cell.c, cell.r));
  }
  return out;
}

/**
 * 敌方展开：以锚点做受限 BFS，扩散出 count 个互不重叠的可走格。
 * 限制：不得越过地图中线（否则开场敌人就杵在我方脸上），Boss 台 'B' 例外可占。
 * 邻居顺序固定为 上/下/右/左，保证展开形状确定且偏向敌方半场。
 */
export function spreadPositions(
  arena: ArenaDef,
  anchors: Vec2[],
  count: number,
  opts: { allowBossTile?: boolean; minCol?: number } = {},
): Vec2[] {
  if (count <= 0) return [];
  const minCol = opts.minCol ?? Math.floor(arena.width / 2) - 1;
  const passable = (c: number, r: number) => {
    if (c < minCol) return false;
    const ch = tileAt(arena, c, r);
    if (ch === 'B') return !!opts.allowBossTile;
    return !BLOCKED.has(ch);
  };

  const out: Vec2[] = [];
  const used = new Set<string>();
  const seen = new Set<string>();
  const queue: { c: number; r: number }[] = [];

  for (const a of anchors) {
    const c = Math.floor(a.x);
    const r = Math.floor(a.y);
    if (seen.has(cellKey(c, r))) continue;
    seen.add(cellKey(c, r));
    queue.push({ c, r });
  }
  if (queue.length === 0) queue.push({ c: arena.width - 4, r: Math.floor(arena.height / 2) });

  const DIRS: [number, number][] = [[0, -1], [0, 1], [1, 0], [-1, 0]];
  let head = 0;
  while (head < queue.length && out.length < count) {
    const cur = queue[head++];
    if (passable(cur.c, cur.r) && !used.has(cellKey(cur.c, cur.r))) {
      used.add(cellKey(cur.c, cur.r));
      out.push(toPos(cur.c, cur.r));
    }
    for (const [dc, dr] of DIRS) {
      const nc = cur.c + dc;
      const nr = cur.r + dr;
      // v2.9.3 越界不入队：BFS 严格限制在地图内。否则当可用格不足 count 时
      //（如八角笼 3×3 塞不下整波敌人），BFS 会向地图外无限扩散导致 seen 无限膨胀
      if (nc < 0 || nr < 0 || nc >= arena.width || nr >= arena.tiles.length) continue;
      const k = cellKey(nc, nr);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ c: nc, r: nr });
    }
  }

  // BFS 被墙围死时的兜底：把剩余名额堆回第一个锚点
  while (out.length < count) out.push(anchors[0] ?? toPos(arena.width - 4, Math.floor(arena.height / 2)));
  return out;
}

/**
 * 敌方开场落点（战前预览与实际开战共用同一函数，保证「所见即所战」）。
 * Boss 优先占 'B' 台（A6 有中央高台），其余按 BFS 列阵展开。
 */
export function enemyPlacements(
  arena: ArenaDef,
  spawnEnemy: Vec2[],
  bossPos: Vec2 | undefined,
  defs: { isBoss?: boolean }[],
): Vec2[] {
  const spots = spreadPositions(arena, spawnEnemy, defs.length);
  return defs.map((d, i) => (d.isBoss && bossPos ? bossPos : spots[i]));
}
