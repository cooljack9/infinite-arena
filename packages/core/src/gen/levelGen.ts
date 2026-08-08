// 程序化关卡生成（需求 4.4.6 / 开发 §7）。生成文法：锚点层 + 原型抽取 + 遭遇预算
import { LayerPlan, ArenaArchetype, ArenaDef, GameMode, BuildingPlacement, Vec2 } from '../types';
import { ARENA_LIST, parseSpawns, withTheme } from '../content/arenas';
import { mulberry32, RNG, pick } from '../engine/rng';
import { enemyScale, isVacuum, isMutation, segmentMult, DEMO_CAP, bossTierAt } from '../engine/scaling';
import { buildWaves } from './encounter';
import { availableBuildings, buildingCountFor } from '../content/buildings';
import { rollRandomEvent } from '../content/events';

const MUTATIONS = [
  '禁用射手大招3层', '全场持续掉血', '敌人窃取护盾', '敌方移速翻倍', '仅魔法伤害',
];

// 确保 Boss 层有 Boss 台（B）：若抽到的布局没有 B，则在中部偏后注入 2×2 的 B 块，
// 不覆盖 S/E/P/~，保证 bossPos 有落点（parseSpawns 读最后一个 B）。
function ensureBossPlatform(arena: ArenaDef): ArenaDef {
  if (arena.tiles.some((row) => row.includes('B'))) return arena;
  const tiles = arena.tiles.map((r) => r.split(''));
  const r0 = 5, c0 = 9;
  for (let dr = 0; dr < 2; dr++) {
    for (let dc = 0; dc < 2; dc++) {
      const r = r0 + dr, c = c0 + dc;
      if (tiles[r] && tiles[r][c] === '.') tiles[r][c] = 'B';
    }
  }
  return { ...arena, tiles: tiles.map((r) => r.join('')) };
}

/**
 * v2.6 §3 敌方补给建筑布点（需求 #3「要合理的站位拆除，要不风险大」）
 *
 * 「合理站位」这四个字全部落在这个函数里。三条约束定义了什么叫合理：
 *
 *  ① **远离我方出生点**（>= 5.5 格）。建筑贴脸生成时玩家没有决策空间——
 *     开局就在射程里，拆不拆已经由地图替他决定了。留出 5.5 格 = 至少一次接敌前的调整窗口。
 *  ② **偏向敌方半场**（x 权重向敌方出生点倾斜）。建筑是「敌方补给」，
 *     它长在敌人后方才符合直觉，也才构成「深入 vs 苟住」的取舍：
 *     想拆楼就得离开安全区，这是风险的来源。
 *  ③ **彼此拉开 >= 4 格**。两座楼挤在一起时，一次 AoE 顺手全拆，
 *     多建筑就退化成单建筑；拉开距离才逼出「先拆哪个」的排序问题。
 *
 * 全程只用传入的种子 RNG，落点写进 LayerPlan —— 同一 seed 的同一层必然同图，
 * 否则回放、战报与「重开同一层」会对不上。
 */
function placeBuildings(
  rng: RNG, arena: ArenaDef, layer: number, ally: Vec2[], enemy: Vec2[], boss?: Vec2,
): BuildingPlacement[] {
  const count = buildingCountFor(layer);
  if (count <= 0) return [];
  const pool = availableBuildings(layer);
  if (!pool.length) return [];

  // 候选格：可站人的地面。'P' 掩体不排除——楼盖在掩体旁边反而是好站位，
  // 玩家可以借掩体接近，这正是我们想奖励的走位。
  const cands: Vec2[] = [];
  // v2.9.5 边缘留白：建筑（尤其 20×20 的恶龙巢穴）不贴墙生成，避免巢内单位卡在边界反复寻路
  const MARGIN = 2;
  for (let r = MARGIN; r < arena.tiles.length - MARGIN; r++) {
    for (let c = MARGIN; c < arena.tiles[r].length - MARGIN; c++) {
      const ch = arena.tiles[r][c];
      if (ch === '#' || ch === '~' || ch === 'S' || ch === 'E' || ch === 'B' || ch === 'M') continue;
      cands.push({ x: c + 0.5, y: r + 0.5 });
    }
  }
  if (!cands.length) return [];

  // 禁用 Math.hypot：跨引擎不确定，见 docs/backend/07。sqrt 由 IEEE 754 保证正确舍入。
  const d = (a: Vec2, b: Vec2) => { const dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); };
  const MIN_FROM_ALLY = 5.5;
  const MIN_BETWEEN = 4.0;
  // 敌方半场锚点：取敌方出生点均值，没有就退到 Boss 台，再没有就用地图右侧
  const anchor: Vec2 = enemy.length
    ? { x: enemy.reduce((s, p) => s + p.x, 0) / enemy.length, y: enemy.reduce((s, p) => s + p.y, 0) / enemy.length }
    : boss ?? { x: arena.width * 0.75, y: arena.height / 2 };

  // 先按「离我方远 / 离敌方锚点近」打分排序，再在前 40% 里随机取，
  // 兼顾「站位合理」与「每局不一样」。纯取最优会让每局建筑落点完全相同。
  const scored = cands
    .filter((p) => ally.every((a) => d(p, a) >= MIN_FROM_ALLY))
    .map((p) => ({ p, s: d(p, anchor) - Math.min(...ally.map((a) => d(p, a))) * 0.35 }))
    .sort((a, b) => a.s - b.s);
  if (!scored.length) return [];
  const head: Vec2[] = scored
    .slice(0, Math.max(count * 4, Math.ceil(scored.length * 0.4)))
    .map((e) => e.p);

  // 加权抽建筑类型：weight 越大越常见（营房/木塔是常客，巢穴是稀客）
  const pickKind = () => {
    const total = pool.reduce((s, b) => s + b.weight, 0);
    let t = rng() * total;
    for (const b of pool) { t -= b.weight; if (t <= 0) return b.kind; }
    return pool[pool.length - 1].kind;
  };

  const out: BuildingPlacement[] = [];
  const used: Vec2[] = [];
  let guard = 0;
  while (out.length < count && guard++ < 200) {
    const spot = pick(rng, head);
    if (!spot) break;
    if (used.some((u) => d(u, spot) < MIN_BETWEEN)) continue;
    const kind = pickKind();
    // 同一层不出现两座恶龙巢穴：5 条龙 ×2 是纯粹的处刑，不是难度
    if (kind === 'dragon_lair' && out.some((o) => o.kind === 'dragon_lair')) continue;
    used.push(spot);
    out.push({ kind, pos: { x: spot.x, y: spot.y } });
  }
  return out;
}

// v2.9.3 疯狂龙巢：地图必然出现 3+ 个恶龙巢/巢穴（dragonNests 字段由 genArena 写入）。
// 落点复用 placeBuildings 的「离我方远 + 彼此拉开」约束，最后一座用 dragon_lair 压轴。
function forceDragonNests(
  rng: RNG, arena: ArenaDef, out: BuildingPlacement[], count: number, ally: Vec2[],
) {
  // 禁用 Math.hypot：跨引擎不确定，见 docs/backend/07。sqrt 由 IEEE 754 保证正确舍入。
  const d = (a: Vec2, b: Vec2) => { const dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); };
  const cands: Vec2[] = [];
  // v2.9.5 边缘留白：恶龙巢穴体量最大，留 3 格边距，确保巢内巨龙不在地图外缘反复寻路卡顿
  const MARGIN = 3;
  for (let r = MARGIN; r < arena.tiles.length - MARGIN; r++) {
    for (let c = MARGIN; c < arena.tiles[r].length - MARGIN; c++) {
      const ch = arena.tiles[r][c];
      if (ch === '#' || ch === '~' || ch === 'S' || ch === 'E' || ch === 'B' || ch === 'M') continue;
      cands.push({ x: c + 0.5, y: r + 0.5 });
    }
  }
  const scored = cands
    .filter((p) => ally.every((a) => d(p, a) >= 4.5))
    .sort((a, b) => d(b, { x: arena.width * 0.75, y: arena.height / 2 }) - d(a, { x: arena.width * 0.75, y: arena.height / 2 }));
  let placed = 0, guard = 0;
  while (placed < count && guard++ < 400 && scored.length) {
    const spot = scored[Math.floor(rng() * Math.min(scored.length, Math.max(count * 5, 8)))];
    if (out.some((o) => d(o.pos, spot) < 4)) { scored.splice(scored.indexOf(spot), 1); continue; }
    // 最后一座用恶龙巢穴（成年龙 + 幼龙），其余恶龙巢（幼龙）；
    // 若普通布点已产出 lair，则本图全部用 dragon_nest 避免双巢穴 10 龙处刑
    const wantLair = placed === count - 1 && !out.some((o) => o.kind === 'dragon_lair');
    const kind = wantLair ? 'dragon_lair' : 'dragon_nest';
    out.push({ kind, pos: { x: spot.x, y: spot.y } });
    placed++;
  }
}

// v2.9.3 随机岩浆：部分地图撒 3~6 格 'M'（可通行但每秒灼烧 3% 最大生命——抄近路 vs 掉血的取舍）。
// 已有危险地形（'~'：楚河汉界/八角笼）的图不撒；只撒在 '.' 格（避开出生点/掩体/Boss台/墙）。
function sprinkleLava(arena: ArenaDef, rng: RNG) {
  const cells: Vec2[] = [];
  for (let r = 1; r < arena.tiles.length - 1; r++) {
    for (let c = 1; c < arena.tiles[r].length - 1; c++) {
      if (arena.tiles[r][c] === '.') cells.push({ x: c, y: r });
    }
  }
  if (!cells.length) return;
  const tiles = arena.tiles.map((row) => row.split(''));
  const n = 3 + Math.floor(rng() * 4); // 3~6 格
  for (let i = 0; i < n && cells.length; i++) {
    const p = cells.splice(Math.floor(rng() * cells.length), 1)[0];
    tiles[p.y][p.x] = 'M';
  }
  arena.tiles = tiles.map((row) => row.join(''));
}

export function genLayer(n: number, seed: number, mode?: GameMode): LayerPlan {
  const clamped = Math.min(n, DEMO_CAP);
  const rng: RNG = mulberry32((seed + n * 7919) >>> 0);
  // v2.4 Boss 密度：普通 Boss 每 3 关、强力 Boss 每 5 关（新手仅封顶层一个普通 Boss）
  const bossTier = bossTierAt(clamped, mode);
  // v2.9.3 疯狂龙巢只出现在 Boss 关卡：有 Boss 时从全池（含 DRAGON）抽，否则从普通池抽
  // v3.4e 新手模式不出特殊地形图（八角笼 CAGE / 疯狂龙巢 DRAGON），避免岩浆灼烧/龙潮劝退新手
  const base = bossTier ? ARENA_LIST : ARENA_LIST.filter((a) => a.id !== 'DRAGON');
  const pool = mode === 'novice' ? base.filter((a) => a.id !== 'CAGE' && a.id !== 'DRAGON') : base;
  // 布局随机抽取，主题按层深确定（需求 §4.4.8：主题与布局正交）
  let arena = withTheme(pick(rng, pool), n);
  // v2.9.3 随机岩浆：45% 概率出现在无危险地形的图上（3~6 格，灼烧 3%/s）
  if (rng() < 0.45 && !arena.tiles.some((row) => row.includes('~'))) {
    sprinkleLava(arena, rng);
  }
  if (bossTier) arena = ensureBossPlatform(arena);
  const waves = buildWaves(rng, clamped, bossTier);
  const scale = enemyScale(clamped);
  const budget = Math.round(100 * scale.hp * segmentMult(clamped));
  const spawns = parseSpawns(arena);
  // v2.6 §3：新手模式不放建筑——教学层要把注意力留给「装备/合成/升星」三件事，
  // 再塞一个产兵器只会让新玩家什么都学不会。
  const buildings = mode === 'novice'
    ? []
    : placeBuildings(rng, arena, clamped, spawns.ally, spawns.enemy, spawns.boss);
  // v2.9.3 疯狂龙巢：必然 3+ 个龙巢（新手模式除外——教学层不产兵）
  if (arena.dragonNests && mode !== 'novice') {
    forceDragonNests(rng, arena, buildings, arena.dragonNests, spawns.ally);
  }
  // 精英 Boss 层：每 10 层（与强力 Boss 重合）的强化变体，需醒目提示
  const eliteBoss = !!bossTier && clamped % 10 === 0;
  // 随机奇遇事件：确定性抽取（避开第 1 层与 Boss 层，留给教学/头目节奏）
  const randomEvent = rollRandomEvent(rng, clamped, !!bossTier);
  return {
    layer: n,
    arena,
    waves,
    buildings,
    isVacuum: isVacuum(clamped),
    isMutation: isMutation(clamped),
    mutationRule: isMutation(clamped) ? pick(rng, MUTATIONS) : undefined,
    encounterBudget: budget,
    spawnAlly: spawns.ally,
    spawnEnemy: spawns.enemy,
    bossPos: spawns.boss,
    bossTier,
    eliteBoss,
    randomEvent,
  };
}

export type { ArenaArchetype };
