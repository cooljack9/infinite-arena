// 程序化关卡生成（需求 4.4.6 / 开发 §7）。生成文法：锚点层 + 原型抽取 + 遭遇预算
import {
  LayerPlan, ArenaArchetype, ArenaDef, GameMode, BuildingPlacement, Vec2, EnemyDef, VanEncounter,
} from '../types';
import { ARENA_LIST, parseSpawns, withTheme } from '../content/arenas';
import { mulberry32, RNG, pick } from '../engine/rng';
import { enemyScale, isVacuum, isMutation, segmentMult, DEMO_CAP, bossTierAt } from '../engine/scaling';
import { buildWaves } from './encounter';
import { availableBuildings, buildingCountFor } from '../content/buildings';
import { rollRandomEvent } from '../content/events';
import { VAN_CFG, VAN_ENEMY } from '../content/enemies';

const MUTATIONS = [
  '禁用射手大招3层', '全场持续掉血', '敌人窃取护盾', '敌方移速翻倍', '仅魔法伤害',
];

// ══════════════════════════════════════════════════════════════════════════
// v2.9.x 特殊关显式加权抽取（用户需求 #1）
//
// 旧做法哪里不对：特殊图只是混在 ARENA_LIST 里等概率抽。14 张图里 DRAGON 2 张、CAGE 2 张，
// 于是出现率 = 2/14 —— 被"数组长度"这个跟设计毫无关系的数字绑死。
// 以后谁随手加一张普通图，特殊关就悄悄变稀，而没有任何测试会报警。
// 出现率是设计参数，不该是数组长度的副产品。
//
// 现在写成显式权重表（需求原文）：疯狂龙巢 7 / 八角笼 7 / 面包车 7 / 普通 79。
// 之后普通图加到 50 张，这四个数一格不动。
// ══════════════════════════════════════════════════════════════════════════
const SPECIAL_ARENAS: Array<[ArenaArchetype, number]> = [
  ['DRAGON', 7], // 疯狂龙巢：3+ 龙巢持续产龙
  ['CAGE', 7],   // 八角笼：岩浆环绕的 5×6 死斗平台
  ['VAN', 7],    // 面包车：车队冲锋击退阵型 → 开门逐人下落
];
const NORMAL_WEIGHT = 79;
const SPECIAL_IDS = new Set<string>(SPECIAL_ARENAS.map(([id]) => id));

/**
 * 特殊关最低层数：前 2 层只出普通关。
 *
 * 这条约束不是为了难度曲线，是为了**归因**。玩家在第 1~2 层还没建立
 * "我的阵型/装备到底在做什么"的认知；此刻撞上龙潮或车队，他学到的唯一一件事是
 * "这游戏随机"。第 3 层起他已经打完一轮完整战斗、有了基线手感，
 * 特殊关才读作惊喜而不是劝退。
 */
const SPECIAL_MIN_LAYER = 3;

/**
 * 疯狂龙巢是否仍限 Boss 层。
 *
 * v2.9.3 的规则是"龙潮只在 Boss 层"（龙潮是 Boss 关的加码而非随机惩罚）。
 * 但需求把三种特殊关并列写成各 7%，若保留 Boss 限制，龙巢实际出现率
 * = 7% × Boss 层占比(≈46.7%) ≈ 3.3%，拿不到需求要的 7%。
 * 这里按需求原文取 false（任意 ≥3 层平铺 7%）。
 * 想回到 Boss 专属就把这一个常量改回 true —— 权重会自动回流普通关。
 */
const DRAGON_BOSS_ONLY = false;

function rollArenaArchetype(
  rng: RNG, layer: number, mode: GameMode | undefined, bossTier: 'strong' | 'normal' | undefined,
): ArenaDef {
  // v3.4e 新手模式不出任何特殊地形图：教学层要把注意力留给"装备/合成/升星"三件事，
  // 岩浆灼烧 / 龙潮 / 车队冲锋都是在教学之外抢注意力。
  const allowSpecial = mode !== 'novice' && layer >= SPECIAL_MIN_LAYER;
  const table: Array<[ArenaArchetype | 'NORMAL', number]> = [['NORMAL', NORMAL_WEIGHT]];
  if (allowSpecial) {
    for (const [id, w] of SPECIAL_ARENAS) {
      if (id === 'DRAGON' && DRAGON_BOSS_ONLY && !bossTier) continue; // 权重回流普通关
      table.push([id, w]);
    }
  }
  // 加权抽取：总权重现算，被排除的档位自动把概率让回普通关（不需要手工补数）
  const total = table.reduce((s, [, w]) => s + w, 0);
  let t = rng() * total;
  let chosen: ArenaArchetype | 'NORMAL' = 'NORMAL';
  for (const [id, w] of table) { t -= w; if (t <= 0) { chosen = id; break; } }
  const pool = chosen === 'NORMAL'
    ? ARENA_LIST.filter((a) => !SPECIAL_IDS.has(a.id))
    : ARENA_LIST.filter((a) => a.id === chosen);
  return pick(rng, pool.length ? pool : ARENA_LIST);
}

/**
 * 车队编成（v2.9.x）：先抽车数，再让每车人数向"总人数区间"收敛。
 *
 * 需求给的是两个独立范围：4~8 辆车、每车 4~10 人。直接各自均匀抽，
 * 总人数落在 16~80 —— **同一层难度 5 倍方差**。这不叫随机性，叫抽奖：
 * 玩家会把失败归因于运气而不是决策，这条反馈链一断，之后所有数值调整都收不到有效信号。
 *
 * 做法：车数照需求 4~8 均匀抽；每车人数由总数目标反推，再夹回 4~10（需求原文一格没动）。
 * 结果总人数 28~48（1.7 倍方差），且"车少人挤满"与"车多铺开"两种观感都保留。
 */
function rollVanEncounter(rng: RNG): VanEncounter {
  const [vMin, vMax] = VAN_CFG.vanCountRange;
  const [pMin, pMax] = VAN_CFG.peopleRange;
  const [tMin, tMax] = VAN_CFG.peopleTotalBand;
  const vanCount = vMin + Math.floor(rng() * (vMax - vMin + 1));
  const target = tMin + Math.floor(rng() * (tMax - tMin + 1));
  // 除法与 Math.round 均由 ES 规范/IEEE 754 定死舍入，跨引擎一致（对比 Math.hypot 的坑见 docs/backend/07）
  const peoplePerVan = Math.max(pMin, Math.min(pMax, Math.round(target / vanCount)));
  return {
    vanCount,
    peoplePerVan,
    vanBasePrimary: VAN_CFG.vanBasePrimary,
    personPrimaryMul: VAN_CFG.personPrimaryMul,
    personMoveSpeedAdd: VAN_CFG.personMoveSpeedAdd,
    personAtkSpeedAdd: VAN_CFG.personAtkSpeedAdd,
    openingBuffSec: VAN_CFG.openingBuffSec,
    dropInterval: VAN_CFG.dropInterval,
    concurrentPeopleCap: VAN_CFG.concurrentPeopleCap,
  };
}

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
  // v2.9.x 特殊关按显式权重抽（7/7/7/79，见 rollArenaArchetype），主题按层深确定
  // （需求 §4.4.8：主题与布局正交）
  let arena = withTheme(rollArenaArchetype(rng, clamped, mode, bossTier), n);
  // v2.9.x 面包车关：抽出车队编成，写进 LayerPlan 供引擎脚本消费（前后端同读一份）
  const vanEncounter = arena.id === 'VAN' ? rollVanEncounter(rng) : undefined;
  // v2.9.3 随机岩浆：45% 概率出现在无危险地形的图上（3~6 格，灼烧 3%/s）
  if (rng() < 0.45 && !arena.tiles.some((row) => row.includes('~'))) {
    sprinkleLava(arena, rng);
  }
  if (bossTier) arena = ensureBossPlatform(arena);
  // buildWaves 无条件调用：一旦按条件跳过，RNG 流就在这里分叉，同 seed 的后续内容全变。
  const rolledWaves = buildWaves(rng, clamped, bossTier);
  // v2.9.x 面包车关的敌方兵力 = 车队本身：wave 0 放全部面包车，面包人由引擎
  // VanConvoyScript 在撞击后逐个投放（不占波次）。Boss 波保留——Boss 是本层既定高峰，
  // 车队冲锋是它的开场，两者不打架；常规小怪波则去掉，否则"人海"与"波次"两套增兵
  // 同时开，玩家分不清是哪一套在杀他。
  const waves: EnemyDef[][] = vanEncounter
    ? [
      Array.from({ length: vanEncounter.vanCount }, () => VAN_ENEMY),
      ...(bossTier ? rolledWaves.slice(-1) : []),
    ]
    : rolledWaves;
  const scale = enemyScale(clamped);
  const budget = Math.round(100 * scale.hp * segmentMult(clamped));
  const spawns = parseSpawns(arena);
  // v2.6 §3：新手模式不放建筑——教学层要把注意力留给「装备/合成/升星」三件事，
  // 再塞一个产兵器只会让新玩家什么都学不会。
  // v2.9.x 面包车关同样不放建筑：本层压力全部来自「人海 + 撞击」，
  // 再叠营房/箭塔就是两套增兵系统并行，玩家读不出威胁来源，调参也定位不到病灶。
  const buildings = (mode === 'novice' || vanEncounter)
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
    vanEncounter,
  };
}

export type { ArenaArchetype };
