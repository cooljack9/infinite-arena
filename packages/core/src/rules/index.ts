// ── 纯规则层：(state, input) => Result<state> ──
// 这一层是**唯一真理来源**：LocalBackend 与 Supabase Edge Function 调用的是同一份函数。
// 纪律：不碰 IO、不碰 zustand、不碰 Date.now()、不碰 Math.random。
// 只要输入相同，在浏览器 / Deno / Node 单测里必然得到完全一致的结果。
import { HeroDef } from '../types';
import { mulberry32 } from '../engine/rng';
import { genLayer } from '../gen/levelGen';
import { enemyScale, capFor, bossTierAt } from '../engine/scaling';
import { makeAlly, makeEnemy, resetUid } from '../engine/unit';
import { BattleSim, applyRelics } from '../engine/battle';
import { resetBuildingId } from '../engine/battle/common';
import { enemyPlacements, sanitizeFormation } from '../gen/formation';
import { rollDrops, rollShopStock, equipScore, generateEquipment } from '../content/equipment';
import { TRAIT_CFG } from '../content/traits';
import { rollRecruitPool, HERO_BY_ID } from '../content/heroes';
import { DB } from '../content/registry';
import { variateHero } from '../content/variant';
import { applyClimbStrategy, type ClimbStrategy } from '../content/climb';
import { rollStarterKit, discountOf, recruitCostOf, goldReward, hashStr, addGrowth, EQUIP_SLOTS, BREAKTHROUGH_MAIN_CHANCE } from './economy';
import { rollMount, rollMountRarity } from '../content/mounts';
import { dominantPrimary } from '../content/consumables';
import { PRIMARY_KEYS } from '../types';
import type { GameMode, Unit, Vec2, PrimaryAttrs, HeroGrowth, BattleStatRow, BreakthroughResult, Chest } from '../types';
import { ok, err, type Result, type RunSnapshot, type UnitSnapshot, type BattlePlanDTO,
  type BattleOptsDTO as BattleOpts, type ClimbOptsDTO as ClimbOpts,
  type AutoClimbResultDTO as AutoClimbResult, type ClimbLayerResultDTO as ClimbLayerResult } from '../contract';

const TICK = 1 / 20;
const REFRESH_COST = 1;

// ── 开局组装：createRun ────────────────────────────────────
// 从 LocalBackend.startRun 提升而来：初始状态怎么搭是**规则**，两个宿主必须一致。
// 宿主只负责两件事：生成 runId、生成根熵 seed（本地 Math.random / 远程 crypto）。
export interface CreateRunInput {
  runId: string;
  /** 根熵源。一旦给定，后续所有掉落/Boss/商店/成长全部由它确定性派生 */
  seed: number;
  heroIds: string[];
  mode: GameMode;
  /** 安全护栏：未解锁无尽时强制回退新手（防脏存档越权） */
  endlessUnlocked: boolean;
}

export function createRun(input: CreateRunInput): Result<RunSnapshot> {
  const { runId, seed, heroIds, mode, endlessUnlocked } = input;

  // 安全护栏：未解锁无尽时强制回退新手（防脏存档越权）
  const safeMode = (mode === 'normal' || mode === 'ironman') && !endlessUnlocked ? 'novice' : mode;
  if (heroIds.length !== 3) return err<RunSnapshot>('TEAM_INVALID', '开局必须恰好 3 人');

  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const taken: string[] = [];
  const team = heroIds.map((id, i) => {
    const base = DB.get('heroes', id) as HeroDef | undefined;
    if (!base) return null;
    const v = variateHero(base, (seed ^ ((i + 1) * 0x9e3779b1)) >>> 0, taken);
    if (v.personalName) taken.push(v.personalName);
    return { ...v, uid: `H${i + 1}`, star: 1, dupIndex: 1 };
  });
  if (team.some((t) => t === null)) {
    return err<RunSnapshot>('TEAM_INVALID', '队伍包含未知英雄');
  }
  const teamOk = team as NonNullable<typeof team[number]>[];

  const snapshot: RunSnapshot = {
    runId, version: 0,
    layer: 1, mode: safeMode, score: 0, failures: 0, cap: capFor(safeMode),
    team: teamOk, relics: [], resolvedEvents: [], status: 'active',
    gold: 0,
    inventory: safeMode === 'novice' ? rollStarterKit(rng) : [],
    pendingDrops: [], equipped: {}, consumables: [],
    shopStock: rollShopStock(rng, 8),
    // v1.7 招募池生成时即个体化（同角色不同副本基础值/体型/姓名各异），价格据此浮动
    recruitPool: rollRecruitPool(mulberry32((seed ^ 104729) >>> 0), teamOk).map((h, i) =>
      variateHero(h, (seed ^ (104729 + i * 0x9e3779b1)) >>> 0, teamOk.map((t) => t.personalName ?? t.name))),
    tradeCount: 0, refreshCount: 0, forgedThisLayer: [], fusedThisLayer: 0,
    reforgedThisLayer: false,
    opSeq: 3,   // 开局 3 人；opSeq 单调递增、不受背包状态影响
    // 渲染种子：确定性派生（本地/测试用）；云端宿主会覆写为独立随机，与权威种子解耦
    renderSeed: (seed ^ 0x85ebca6b) >>> 0,
    receipts: {},
  };
  return ok(snapshot);
}

// ── 层推进：advanceLayer / advanceLayerTo ─────────────────
// 从 LocalBackend 提升而来：层推进规则前后端必须一致。
// v1.8：移除 skipLayer（跳过本层与游戏根本相悖，玩家必须真打真赢）；
//       原 skipLayer 兼作 e2e 脚本的推进驱动，职责独立为 advanceLayerTo（仅供测试，不对玩家暴露）。

/** 无操作推进：版本号 +1（用于远程通路的层间同步/重放） */
export function advanceLayer(s: RunSnapshot): Result<RunSnapshot> {
  return ok({ ...s, version: s.version + 1 });
}

/**
 * 测试/开发专用：把层直接设到 n 并重置每层旗标（无校验、无奖励、不改 status）。
 * 仅用于 e2e 脚本推进层数，玩家侧没有任何入口调用它。
 */
export function advanceLayerTo(s: RunSnapshot, n: number): Result<RunSnapshot> {
  return ok({
    ...s, version: s.version + 1,
    layer: Math.max(1, Math.min(n, capFor(s.mode))),
    forgedThisLayer: [], fusedThisLayer: 0,
    reforgedThisLayer: false,
  });
}

// ── 升星：upgradeHero ──────────────────────────────────────
// 星级 +1（封顶 5★），属性按规则成长（累积进 bonusPct，与突破同一容器）：
//   主属性 +10%；随机 2 属性 +5%；随机 2 属性 +3%（随机可含主属性）。
// 确定性种子 hash(runId:uid:star)：跨局不可复现（不同 runId），纯增益无作弊价值，
// 故不需要服务端 secret——Local / mock / Edge 三端同输入必同结果。
export function upgradeHero(s: RunSnapshot, uid: string): Result<RunSnapshot> {
  const h = s.team.find((x) => x.uid === uid);
  if (!h) return err('TEAM_INVALID', '英雄不存在');
  // v3.4 金币校验与扣款（此前云端缺失导致免费升星；Local 一直有此逻辑，双端统一）
  const cost = recruitCostOf(s.layer);
  if (s.gold < cost) return err('INSUFFICIENT_GOLD', `升星需 ${cost} 金币`);
  const star = h.star ?? 1;
  const nextStar = Math.min(star + 1, 5);
  const main = dominantPrimary(h.basePrimary);
  const bonusPct: Partial<PrimaryAttrs> = { ...(h.bonusPct ?? {}) };
  const add = (k: keyof PrimaryAttrs, v: number) => {
    bonusPct[k] = Math.round(((bonusPct[k] ?? 0) + v) * 10) / 10;
  };
  let lastBreakthrough: BreakthroughResult;
  let mount = h.mount;
  let mountRarity = h.mountRarity;

  if (star < 5) {
    // ── 升星：星级+1，主属性+10%、随机 2×5%、随机 2×3%（可含主属性）──
    const rng = mulberry32(hashStr(`${s.runId}:${uid}:${star}`));
    const pick = (): keyof PrimaryAttrs => PRIMARY_KEYS[Math.floor(rng() * PRIMARY_KEYS.length)];
    const p5 = [pick(), pick()];
    const p3 = [pick(), pick()];
    add(main, 10);
    for (const k of p5) add(k, 5);
    for (const k of p3) add(k, 3);
    // v3.4 5★ 解锁坐骑（此前云端缺失；种子与 Local 同源 renderSeed^hash(uid)^layer）
    if (nextStar >= 5 && !mount) {
      const mSeed = ((s.renderSeed ?? 0) ^ hashStr(uid) ^ ((s.layer * 0x85ebca6b) >>> 0)) >>> 0;
      mount = rollMount(mulberry32(mSeed));
      mountRarity = rollMountRarity(mulberry32((mSeed ^ 0x9e3779b9) >>> 0));
    }
    lastBreakthrough = { heroId: h.id, heroUid: uid, key: main, add: 10, main: true, p5, p3 };
  } else {
    // ── 5★ 后突破：单属性 +3.0~5.0%（60% 主属性），无上限——金币的长期出口（与 Local 同规则）──
    const accum = Math.round(Object.values(bonusPct).reduce<number>((sum, v) => sum + (v ?? 0), 0) * 10);
    const seed = (
      (s.renderSeed ?? 0) ^ ((s.layer * 0x6a09e667) >>> 0) ^ ((s.tradeCount * 0xbb67ae85) >>> 0)
      ^ ((s.score * 13) >>> 0) ^ hashStr(uid) ^ Math.imul(accum + 1, 0x27d4eb2d)
    ) >>> 0;
    const rng = mulberry32(seed);
    const hitMain = rng() < BREAKTHROUGH_MAIN_CHANCE;
    const others = PRIMARY_KEYS.filter((k) => k !== main);
    const key = hitMain ? main : (others[Math.floor(rng() * others.length)] ?? main);
    const value = Math.round((3 + rng() * 2) * 10) / 10; // 3.0 ~ 5.0，保留 1 位小数
    add(key, value);
    lastBreakthrough = { heroId: h.id, heroUid: uid, key, add: value, main: hitMain };
  }

  const team = s.team.map((x) =>
    x.uid === uid ? { ...x, bonusPct, star: nextStar, mount, mountRarity } : x,
  );
  return ok({
    ...s,
    version: s.version + 1,
    gold: s.gold - cost,
    team,
    receipts: {
      ...s.receipts,
      lastBreakthrough,
      lastMount: mount && mount !== h.mount ? { heroUid: uid, kind: mount } : s.receipts.lastMount,
    },
  });
}

// ── 确定性 id 生成器（P0-1 改造：取代模块级 let uid = 0）──
// 每场战斗新建一个实例，同 seed 同输入必得同 id 序列。
export interface IdGen { next(prefix: string): string }
export class SeqIdGen implements IdGen {
  constructor(private n = 0) {}
  next(p: string) { return `${p}${this.n++}`; }
  get cursor() { return this.n; }
}

// ── 种子派生（照抄现有公式，但输入一律取自权威状态）──
export const seeds = {
  layer:   (s: number, layer: number) => (s + layer * 7919) >>> 0,
  drops:   (s: number, layer: number) => (s ^ (layer * 7919)) >>> 0,
  shop:    (s: number, layer: number, rc: number) => (s ^ (layer * 7919) ^ (rc * 0x9e3779b1)) >>> 0,
  recruit: (s: number, layer: number, rc: number) => (s ^ (layer * 104729) ^ (rc * 0x85ebca77)) >>> 0,
  battle:  (s: number, layer: number) => (s + layer) >>> 0,
  /** 修复 run.ts:180 的 Math.random —— MVP 奖励属性改为确定性派生 */
  mvp:     (s: number, layer: number, uid: string) => (s ^ (layer * 0x1b873593) ^ hashStr(uid)) >>> 0,
  breakthrough: (s: number, uid: string, acc: number) =>
    (s ^ hashStr(uid) ^ Math.imul(acc + 1, 0x27d4eb2d)) >>> 0,
};

/** 32 位状态指纹哈希（用于战斗 trace 校验和） */
export function hashTrace(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/** 战斗内部状态：run 的权威种子（绝不下发给客户端） */
export interface RunSecret { seed: number }

// ── 战前计划 ──────────────────────────────────────────────

export function planBattle(snap: RunSnapshot, secret: RunSecret): Result<BattlePlanDTO> {
  if (snap.status !== 'active') return err('RUN_ENDED');
  const plan = genLayer(snap.layer, secret.seed, snap.mode);
  return ok({
    layer: snap.layer,
    arena: plan.arena,
    enemyPreview: {
      defs: plan.waves.flat(),
      bossTier: plan.bossTier,
      eliteBoss: !!plan.eliteBoss,
      isVacuum: plan.isVacuum,
      isMutation: plan.isMutation,
      mutationRule: plan.mutationRule,
    },
    buildings: plan.buildings,
    spawnAlly: plan.spawnAlly,
    spawnEnemy: plan.spawnEnemy,
    bossPos: plan.bossPos,
    randomEvent: plan.randomEvent,
  });
}

// ── 构建单位（后端权威，前端不再重算）────────────────────────

/**
 * 抓单位开局快照 = 全量深拷贝。
 *
 * 用 JSON round-trip 而非 structuredClone，是**刻意的**：
 *   - 深拷贝：切断 primary/derived/skill 的引用共享。实测 5/5 单位的 `derived`
 *     会被 BattleSim 就地改写——若只做浅拷贝，"tick 前抓的快照"在序列化时
 *     早已是战斗结束态，前端拿到的是被污染的开局值。
 *   - JSON 语义：远程通路必然经过 JSON 序列化（undefined 字段会消失）。
 *     本地通路若用 structuredClone 保留 undefined，就会出现"本地测全过、
 *     上线就漂"的经典事故。这里主动把传输损耗前置到本地，让两条通路同构。
 */
function toSnapshot(u: Unit): UnitSnapshot {
  return JSON.parse(JSON.stringify(u)) as UnitSnapshot;
}

/** 构建双方单位。前后端调用同一函数 → 同输入必同输出 */
// ── 战斗单位组装 ──────────────────────────────────────────
// v1.8：增加可选 opts —— layer（生效层，下五层 = snap.layer+5）、
//       enemyHpMult / enemyDmgMult（敌方强度额外倍率）。不传时行为与旧版逐 bit 相同。
export function buildUnits(
  snap: RunSnapshot, secret: RunSecret, formation: Record<string, Vec2>,
  opts?: { layer?: number; enemyHpMult?: number; enemyDmgMult?: number },
) {
  resetUid(0); // id 进入校验和，必须从固定起点开始（见 unit.ts:resetUid）
  const layer = opts?.layer ?? snap.layer;
  const plan = genLayer(layer, secret.seed, snap.mode);
  const spots = sanitizeFormation(
    plan.arena,
    snap.team.map((h) => formation[h.uid]),
    plan.spawnAlly[0],
    snap.team.length,
  );
  const allies: Unit[] = snap.team.map((h, i) => {
    const eqs = snap.equipped[h.uid] ?? [];
    const u = makeAlly(h, 1 + Math.floor((layer - 1) / 2), eqs, { burst: !!h.pendingBurst });
    u.x = spots[i].x; u.y = spots[i].y;
    return u;
  });
  applyRelics(allies, snap.relics);

  const scale = enemyScale(layer);
  const eLevel = 1 + Math.floor(layer / 4);
  const defs = plan.waves.flat();
  const eSpots = enemyPlacements(plan.arena, plan.spawnEnemy, plan.bossPos, defs);
  const hpMult = opts?.enemyHpMult ?? 1;
  const dmgMult = opts?.enemyDmgMult ?? 1;
  const enemies: Unit[] = defs.map((e, i) => {
    const u = makeEnemy(e, eLevel, scale.hp * hpMult, scale.dmg * dmgMult);
    u.x = eSpots[i].x; u.y = eSpots[i].y;
    return u;
  });
  return { plan, allies, enemies, scale };
}

// ── 权威战斗结算 ──────────────────────────────────────────

export interface SettleResult {
  battleSeed: number;
  checksum: string;
  result: 'win' | 'lose';
  totalTicks: number;
  durationSec: number;
  stats: BattleStatRow[];
  killGains: Record<string, HeroGrowth>;
  deadAllyUids: string[];
  mvpUid: string | null;
  mvpStat: keyof PrimaryAttrs | null;
  mvpAdd: number;
  allies: UnitSnapshot[];
  enemies: UnitSnapshot[];
  arena: ReturnType<typeof genLayer>['arena'];
  buildings: ReturnType<typeof genLayer>['buildings'];
  buildingScale: { hp: number; dmg: number };
  /**
   * v2.9.x 面包车关车队配置。**必须进 replay 包**：
   * 车队的撞击/开门/卸人全由它驱动，漏传的后果是前端回放出一堆静止的面包车，
   * 而胜负甚至可能一样——正是 1.9.0 那类"肉眼查不出"的引擎漂移。
   */
  vanEncounter?: ReturnType<typeof genLayer>['vanEncounter'];
}

/** 一场战斗的全部输入。后端从 RunSnapshot 推导它，前端从 replay 包直接拿到。 */
export interface SimInput {
  allies: Unit[];
  enemies: Unit[];
  arena: ReturnType<typeof genLayer>['arena'];
  buildings: ReturnType<typeof genLayer>['buildings'];
  layer: number;
  battleSeed: number;
  buildingScale: { hp: number; dmg: number };
  /** v2.9.x 面包车关车队配置（缺省 = 非车队关） */
  vanEncounter?: ReturnType<typeof genLayer>['vanEncounter'];
}

/**
 * 由输入装配 BattleSim。**前后端必须走这一个函数**。
 *
 * 装配顺序本身就是协议的一部分：建筑 id 计数器要在 spawnBuildings 之前归零，
 * 而单位构建（buildUnits）会消耗单位 id 计数器。任何一边自己手写这段顺序，
 * 都会在某次重构后悄悄错位——而错位的表现是"胜负一样、过程不同"，肉眼不可见。
 */
export function makeSim(i: SimInput): BattleSim {
  const sim = new BattleSim([...i.allies, ...i.enemies], i.arena, i.battleSeed);
  sim.setBuildingScale(i.buildingScale.hp, i.buildingScale.dmg);
  // ⚠️ 归零**必须无条件**。这行原来被关在 `if (buildings.length)` 里，理由看起来很充分：
  // "没有建筑就没人消费 b* id"。但 `nextBuildingId` 是**模块级全局**，凡是"建筑产出物"
  // 都在吃它——v2.9.x 的面包人也是。车队关恰好一栋建筑都不放，于是：
  //   服务端 isolate 里跑到第 N 场    → 面包人拿到 b137、b138…
  //   客户端刚打开页面 replay 同一场  → 面包人拿到 b0、b1…
  // id 进 traceLine → 进 checksum → 前后端逐 bit 校验直接分叉，而**胜负和过程完全一样**，
  // 肉眼永远看不出来，只有 parity 会红。这就是本次 parity 抓到的真 bug（seed=20250601 layer=5）。
  // 结论：id 计数器的归零点必须绑在"装配一个新 sim"这件事上，不能绑在"这场有没有建筑"上。
  resetBuildingId(0);
  if (i.buildings.length) {
    sim.spawnBuildings(i.buildings, i.layer, i.buildingScale.hp, i.buildingScale.dmg);
  }
  // v2.9.x 车队关装配。顺序有讲究：必须在 spawnBuildings 之后——
  // 面包人和建筑产兵共用 nextBuildingId 计数器，装配顺序换了 id 就错位，
  // 而错位的表现是"胜负一样、过程不同"，只有 parity 校验和抓得到。
  // 车队关本身不放建筑（levelGen 保证），所以实际上两者不会同时触发，
  // 但顺序仍然写死在这里，免得哪天放开了才发现。
  if (i.vanEncounter) sim.setVanEncounter(i.vanEncounter, i.buildingScale.hp);
  return sim;
}

/** 单 tick 指纹。只抓位置/血量/存活，足以侦测任何演算分歧且 trace 不会爆。 */
export function traceLine(sim: BattleSim, step: number): string {
  let line = `${step}`;
  for (const u of sim.units) {
    line += `|${u.id},${u.x.toFixed(6)},${u.y.toFixed(6)},${u.hp.toFixed(6)},${u.alive ? 1 : 0}`;
  }
  return line;
}

/**
 * 前端复现：只吃 replay 包，跑出与服务端逐 bit 相同的过程。
 *
 * 注意前端**不重建** Unit——快照就是完整 Unit，深拷贝即可用。
 * 任何"补默认值 / 推导字段"的聪明逻辑都是分歧来源（PoC 实测：
 * 误把 skillCd 填成 skill.cd，144 tick 漂成 168 tick，而胜负还一样）。
 */
export function replayBattle(replay: {
  allies: UnitSnapshot[]; enemies: UnitSnapshot[];
  arena: SimInput['arena']; buildings: SimInput['buildings'];
  layer: number; battleSeed: number; buildingScale: { hp: number; dmg: number };
  vanEncounter?: SimInput['vanEncounter'];
}, onTick?: (sim: BattleSim, step: number) => void) {
  const clone = (u: UnitSnapshot): Unit => JSON.parse(JSON.stringify(u)) as Unit;
  const sim = makeSim({
    allies: replay.allies.map(clone),
    enemies: replay.enemies.map(clone),
    arena: replay.arena, buildings: replay.buildings,
    layer: replay.layer, battleSeed: replay.battleSeed,
    buildingScale: replay.buildingScale,
    vanEncounter: replay.vanEncounter,
  });
  const parts: string[] = [];
  let steps = 0;
  const MAX = 20 * 180;
  while (!sim.over && steps < MAX) {
    sim.tick(TICK);
    parts.push(traceLine(sim, steps));
    onTick?.(sim, steps);
    steps++;
  }
  return {
    sim, totalTicks: steps,
    result: (sim.result ?? 'lose') as 'win' | 'lose',
    checksum: hashTrace(parts.join('\n')),
  };
}

/**
 * 跑一场权威战斗。**这是后端的核心**——胜负在这里定，客户端只是回放。
 *
 * 实测耗时随 tick 数近似线性，报数必须带上样本，否则会被误读：
 *   新手短局（均值 ~70 tick）    3.3 ms/场
 *   无尽深层（均值 307 tick）   15.2 ms/场   ← Node 22，容器内单核
 * 其中 detmath（确定性三角/幂函数）占 0.01%——每场只调用约 40 次，
 * 都在 Boss 分裂 / 守卫铺位 / 龙息锥形这类低频事件上，不在 per-tick 热路径。
 */
// v1.8：下五层挑战的结算参数（BattleOptsDTO 见 contract；仅 startBattle 通路使用）
// 不传 = 普通战斗，行为与旧版一致。
export function runBattle(
  snap: RunSnapshot, secret: RunSecret, formation: Record<string, Vec2>,
  opts?: BattleOpts,
): Result<SettleResult> {
  if (snap.status !== 'active') return err('RUN_ENDED');

  const effLayer = opts?.effLayer ?? snap.layer;
  const hpMult = opts?.enemyHpMult ?? 1;
  const dmgMult = opts?.enemyDmgMult ?? 1;
  const { plan, allies, enemies, scale } = buildUnits(snap, secret, formation, {
    layer: effLayer,
    enemyHpMult: opts?.enemyHpMult,
    enemyDmgMult: opts?.enemyDmgMult,
  });
  // 初始快照必须在 tick 之前抓（此时是"开局状态"，前端据此重建）
  const allySnap = allies.map(toSnapshot);
  const enemySnap = enemies.map(toSnapshot);

  const battleSeed = seeds.battle(secret.seed, effLayer);
  const sim = makeSim({
    allies, enemies, arena: plan.arena, buildings: plan.buildings,
    layer: effLayer, battleSeed,
    buildingScale: { hp: scale.hp * hpMult, dmg: scale.dmg * dmgMult },
    vanEncounter: plan.vanEncounter,
  });

  // 逐 tick 演算并累积 trace 指纹（校验和锚点）
  const parts: string[] = [];
  let steps = 0;
  const MAX = 20 * 180; // 180s 硬上限
  while (!sim.over && steps < MAX) {
    sim.tick(TICK);
    parts.push(traceLine(sim, steps));
    steps++;
  }

  const stats = sim.getBattleStats();
  const killGains = sim.getKillGains();

  // MVP（确定性：不用 Math.random）
  // v1.1.0（本地版）：改为「伤害 + 治疗 + 承伤」多维加权，让前排坦克与治疗者也能竞争 MVP。
  // 旧公式只看 dmgDealt + healDone，输出位一边倒（实测 498/500 场 MVP 归 DPS，治疗者 0 次）。
  // 权重为可调常量：伤害/治疗等值计贡献，承伤按 0.7 计（避免纯坦过度挤占，仍给前排实质认可）。
  const MVP_HEAL_W = 1;    // 治疗权重
  const MVP_TANK_W = 0.7;  // 承伤权重
  let mvpUid: string | null = null;
  let best = -1;
  for (const r of stats) {
    if (r.side !== 'ally' || !r.heroUid) continue;
    const sc = r.dmgDealt + MVP_HEAL_W * r.healDone + MVP_TANK_W * r.dmgTaken;
    if (sc > best) { best = sc; mvpUid = r.heroUid; }
  }
  let mvpStat: keyof PrimaryAttrs | null = null;
  let mvpAdd = 0;
  if (sim.result === 'win' && mvpUid) {
    const rng = mulberry32(seeds.mvp(secret.seed, snap.layer, mvpUid));
    mvpStat = PRIMARY_KEYS[Math.floor(rng() * PRIMARY_KEYS.length)] as keyof PrimaryAttrs;
    mvpAdd = 1;
  }

  return ok({
    battleSeed,
    checksum: hashTrace(parts.join('\n')),
    result: (sim.result ?? 'lose') as 'win' | 'lose',
    totalTicks: steps,
    durationSec: Math.round(sim.time * 100) / 100,
    stats,
    killGains,
    deadAllyUids: sim.getDeadAllyUids(),
    mvpUid, mvpStat, mvpAdd,
    allies: allySnap, enemies: enemySnap,
    arena: plan.arena,
    buildings: plan.buildings,
    buildingScale: { hp: scale.hp * hpMult, dmg: scale.dmg * dmgMult },
    vanEncounter: plan.vanEncounter,
  });
}

/** 战后把结算写回状态（发奖 / 推层 / 成长 / 铁人移除） */
// v1.8：新增 opts —— rewardLayers（下五层按多层层数逐层发奖）、highBonus（高奖 +10% 表）、
//       loseFailures（下五层失败扣 2 次容错）、effLayer（结算后的落层基准）。不传 = 旧行为。
export function applySettlement(
  snap: RunSnapshot, secret: RunSecret, r: SettleResult,
  opts?: { rewardLayers?: number[]; highBonus?: boolean; loseFailures?: number; effLayer?: number },
): RunSnapshot {
  let next: RunSnapshot = { ...snap, version: snap.version + 1 };

  // 成长写回
  let team = next.team.map((h) => {
    const g = r.killGains[h.uid];
    return g ? { ...h, growthBonus: addGrowth(h.growthBonus, g) } : h;
  });
  // MVP 奖励
  if (r.result === 'win' && r.mvpUid && r.mvpStat) {
    team = team.map((h) =>
      h.uid === r.mvpUid
        ? { ...h, growthBonus: addGrowth(h.growthBonus, { primary: { [r.mvpStat!]: r.mvpAdd } }) }
        : h);
  }
  // 爆发药剂消耗
  team = team.map((h) => (h.pendingBurst ? { ...h, pendingBurst: false } : h));

  // 铁人：永久移除阵亡副本（保底 ≥1 人）
  if (next.mode === 'ironman' && r.deadAllyUids.length) {
    const survivors = team.filter((h) => !r.deadAllyUids.includes(h.uid));
    if (survivors.length >= 1) {
      const equipped = { ...next.equipped };
      const returned: typeof next.inventory = [];
      for (const uid of r.deadAllyUids) {
        returned.push(...(equipped[uid] ?? []));
        delete equipped[uid];
      }
      team = survivors;
      next = { ...next, equipped, inventory: [...next.inventory, ...returned] };
    }
  }
  next = { ...next, team, receipts: { ...next.receipts, lastKillGains: r.killGains } };

  if (r.result === 'win') {
    const cap = capFor(next.mode);
    // v1.8：下五层按 rewardLayers 逐层发奖（奖励基础 = 五层之和）；缺省 = 当前层（旧行为）
    const layers = opts?.rewardLayers && opts.rewardLayers.length ? opts.rewardLayers : [next.layer];
    let goldGain = 0;
    let drops: Chest[] = [];
    for (const L of layers) {
      goldGain += goldReward(L);
      drops = [...drops, ...rollDrops(mulberry32(seeds.drops(secret.seed, L)), L, !!bossTierAt(L, next.mode), !!opts?.highBonus)];
    }
    const effLayer = opts?.effLayer ?? next.layer;
    // 落层：普通战斗 = 当前层+1；下五层 = 生效层+1（即清完 N+1..N+5 后下一战打 N+6）
    const nextLayer = effLayer + 1;
    next = {
      ...next,
      gold: next.gold + goldGain,
      pendingDrops: [...next.pendingDrops, ...drops],
      score: next.score + effLayer * 10,
      layer: Math.min(nextLayer, cap),
      status: nextLayer > cap ? 'won' : 'active',
      // 跨层重置的局内计数
      forgedThisLayer: [],
      fusedThisLayer: 0,
      reforgedThisLayer: false,
    };
  } else {
    const loseFailures = opts?.loseFailures ?? 1; // v1.8：下五层失败扣 2 次容错
    const failures = next.failures + loseFailures;
    next = { ...next, failures, status: failures >= 3 ? 'lost' : 'active' };
  }
  return next;
}

// ── v1.8 自动爬塔 ─────────────────────────────────────────
// 逐层确定性演算（与 runBattle 同一套引擎/种子体系）：
//   · 每层难度 = 正常 × climbMult（第 1 层 +10%，线性到第 10 层 +15%），收益不变；
//   · 打每层前先算「预计胜率」（蒙特卡洛 quick-sim，种子派生自 run.seed，双端可复现），
//     跌破 c2 目标阈值 → 停在该层之前（stopReason=winrate）；
//   · 某层实际失败 → 停在该层（stopReason=fail），前端演示到失败场后扣一次容错；
//   · 到达封顶层 → stopReason=cap；打完 maxLayers 层 → stopReason=done。
// 返回的 AutoClimbResult 由前端一次性入账（pendingDrops/gold）并跳层。

/** 爬塔难度倍率：第 1 层 +10%，线性到第 10 层 +15%（i 从 1 起） */
export const climbMult = (i: number): number => 1.10 + (0.05 * (Math.min(i, 10) - 1)) / 9;

// ── 预计胜率：蒙特卡洛 quick-sim（v1.8.1 提速，输出逐 bit 不变）─────
//
// 优化前：每个样本都重跑一次 buildUnits（genLayer + makeAlly/makeEnemy + applyRelics），
// 实测占单次 predictWinRate 的 13%（9.7ms / 76.7ms，20 样本）。而 buildUnits 是
// (snap, secret, formation, opts) 的纯函数——20 次调用产出完全相同的对象图。
//
// 优化后：装配一次，每个样本深拷贝一份"开局状态"。安全性依据（缺一不可）：
//   1. sim 只**读** plan.arena / plan.buildings（spawnBuildings 只读 kind/pos），可安全共享；
//   2. 全局 uid 计数器只被 makeAlly/makeEnemy 消耗（nextId 仅此两处调用），
//      战斗过程中不再取号 —— 所以少调 19 次 resetUid(0) 不会改变任何 id；
//   3. Unit 是纯数据（replayBattle 早就用 JSON 深拷贝复原它），可安全克隆。
// 结论：同输入下每个样本的 (allies, enemies, arena, buildings, seed) 与优化前逐字段相同。
export type ClimbMods = { enemyHpMult?: number; enemyDmgMult?: number; strategy?: ClimbStrategy };

/** 纯数据单位的深拷贝。structuredClone 保真度更高（Infinity/undefined），JSON 为老 WebView 兜底 */
function cloneUnits(us: Unit[]): Unit[] {
  return typeof structuredClone === 'function'
    ? (structuredClone(us) as Unit[])
    : (JSON.parse(JSON.stringify(us)) as Unit[]);
}

/**
 * 可增量推进的胜率估算器：装配一次，按需跑样本。
 * 前端可以分片调用 step()（每片让出主线程），避免一次性阻塞 UI；
 * 后端可以配合早停提前收敛。两者跑满 count 时结果与 predictWinRate 完全一致。
 */
export function makeWinRatePredictor(
  snap: RunSnapshot, secret: RunSecret, formation: Record<string, Vec2>,
  layer: number, mods: ClimbMods, count = 20,
) {
  const hpMult = mods.enemyHpMult ?? 1;
  const dmgMult = mods.enemyDmgMult ?? 1;
  // 一次装配，后续样本克隆复用（见上方等价性论证）
  const built = buildUnits(snap, secret, formation, {
    layer, enemyHpMult: mods.enemyHpMult, enemyDmgMult: mods.enemyDmgMult,
  });
  const buildingScale = { hp: built.scale.hp * hpMult, dmg: built.scale.dmg * dmgMult };
  let k = 0;
  let wins = 0;

  /** 跑第 k 个样本（种子派生与优化前逐字段相同） */
  const sample = (): boolean => {
    const allies = cloneUnits(built.allies);
    const enemies = cloneUnits(built.enemies);
    if (mods.strategy) applyClimbStrategy(allies, mods.strategy);
    const seed = (secret.seed ^ (layer * 2654435761) ^ (k * 0x9e3779b1)) >>> 0;
    const sim = makeSim({
      allies, enemies, arena: built.plan.arena, buildings: built.plan.buildings,
      layer, battleSeed: seed, buildingScale,
      vanEncounter: built.plan.vanEncounter,
    });
    let steps = 0;
    while (!sim.over && steps < 20 * 180) { sim.tick(TICK); steps++; }
    return sim.result === 'win';
  };

  return {
    get count() { return count; },
    get ran() { return k; },
    get wins() { return wins; },
    get done() { return k >= count; },
    /** 当前估算值（跑满前为部分样本比例，仅供进度展示） */
    get rate() { return k === 0 ? 0 : wins / k; },
    /** 跑满 count 后的最终值（未跑满时按已跑样本折算，语义同 predictWinRate 的 wins/count） */
    get finalRate() { return count === 0 ? 0 : wins / count; },
    /** 推进 n 个样本，返回是否已跑完 */
    step(n = 1): boolean {
      for (let i = 0; i < n && k < count; i++) {
        if (sample()) wins++;
        k++;
      }
      return k >= count;
    },
  };
}

/** 预计胜率（0~1）：对该层做 count 次蒙特卡洛 quick-sim，种子 = (secret.seed ^ layer*k) 派生 */
export function predictWinRate(
  snap: RunSnapshot, secret: RunSecret, formation: Record<string, Vec2>,
  layer: number, mods: ClimbMods,
  count = 20,
): number {
  if (count <= 0) return 0;
  const p = makeWinRatePredictor(snap, secret, formation, layer, mods, count);
  p.step(count);
  return p.finalRate;
}

/**
 * 胜率闸门：判定 `predictWinRate(...) >= target`，但**一旦胜负已分立即停跑**。
 *
 * 判定与 predictWinRate 完全等价（不是近似）：设 need = 满足 w/count >= target 的最小整数 w，
 * 因为除以正数在 IEEE754 下严格单调，`wins/count >= target ⟺ wins >= need`。于是
 *   · 已赢 wins >= need            → 后续样本无论输赢都达标，可停；
 *   · 剩余全赢也够不到 need        → 必不达标，可停。
 * 实测：胜率一边倒的层（绝大多数）2~4 个样本就能收敛，而不是雷打不动跑满 20 个。
 */
export function predictWinRateAtLeast(
  snap: RunSnapshot, secret: RunSecret, formation: Record<string, Vec2>,
  layer: number, mods: ClimbMods, target: number, count = 20,
): boolean {
  if (count <= 0) return 0 >= target;
  let need = 0;
  while (need <= count && need / count < target) need++;
  if (need > count) return false; // 目标高于 100%：恒不达标（不必装配任何单位）
  if (need === 0) return true;    // 目标 ≤ 0：恒达标
  const p = makeWinRatePredictor(snap, secret, formation, layer, mods, count);
  while (!p.done) {
    p.step(1);
    if (p.wins >= need) return true;                       // 已锁定达标
    if (p.wins + (count - p.ran) < need) return false;     // 已锁定不达标
  }
  return p.wins >= need;
}

/** 自动爬塔：逐层演算 ≤ maxLayers 层，返回结果（纯函数，Local/Remote 同一份） */
export function autoClimb(
  snap: RunSnapshot, secret: RunSecret, formation: Record<string, Vec2>, opts: ClimbOpts,
): Result<AutoClimbResult> {
  if (snap.status !== 'active') return err('RUN_ENDED');
  const cap = capFor(snap.mode);
  const max = Math.max(1, Math.min(opts.maxLayers ?? 10, 10));
  const layers: ClimbLayerResult[] = [];
  const totalDrops: Chest[] = [];
  let totalGold = 0;
  let finalLayer = snap.layer;
  let stopReason: AutoClimbResult['stopReason'] = 'done';
  let failLayer: number | null = null;

  for (let i = 1; i <= max; i++) {
    const layer = snap.layer + i;
    if (layer > cap) { stopReason = 'cap'; break; }
    const mult = climbMult(i);
    const mods = { enemyHpMult: mult, enemyDmgMult: mult, strategy: opts.strategy };
    // 开打前阈值检查：预计胜率跌破目标 → 停在该层之前（不打）
    // v1.8.1：改用早停闸门。判定结果与 `predictWinRate(...) >= target` 完全等价，
    // 但胜负一旦锁定就不再空跑剩余样本（这是自动爬塔单请求耗时的最大头）。
    if (opts.winRateTarget !== undefined && opts.winRateTarget > 0) {
      if (!predictWinRateAtLeast(snap, secret, formation, layer, mods, opts.winRateTarget)) {
        stopReason = 'winrate'; break;
      }
    }
    // 实际打这一层（爬塔专属战斗种子，与普通战斗 / 预测种子均不同源）
    const { plan, allies, enemies, scale } = buildUnits(snap, secret, formation, mods);
    applyClimbStrategy(allies, opts.strategy);
    const battleSeed = (secret.seed ^ (layer * 0x85ebca77) ^ 0x5f356495) >>> 0;
    const sim = makeSim({
      allies, enemies, arena: plan.arena, buildings: plan.buildings,
      layer, battleSeed,
      buildingScale: { hp: scale.hp * mult, dmg: scale.dmg * mult },
      vanEncounter: plan.vanEncounter,
    });
    let steps = 0;
    while (!sim.over && steps < 20 * 180) { sim.tick(TICK); steps++; }
    if (sim.result === 'win') {
      const gold = goldReward(layer);
      const drops = rollDrops(mulberry32(seeds.drops(secret.seed, layer)), layer, !!bossTierAt(layer, snap.mode));
      totalGold += gold;
      totalDrops.push(...drops);
      finalLayer = layer;
      layers.push({ layer, win: true, gold, drops });
    } else {
      failLayer = layer;
      finalLayer = snap.layer; // 失败停在本层之前（未推进）
      layers.push({ layer, win: false, gold: 0, drops: [] });
      stopReason = 'fail';
      break;
    }
  }
  return ok({ layers, finalLayer, stopReason, failLayer, totalGold, totalDrops });
}

/**
 * 把自动爬塔结果写回快照（后端权威路径用；本地模式由前端按同语义直写 store）：
 *   · 发奖：gold += totalGold，pendingDrops += totalDrops
 *   · 失败：停在本层之前，failures +1（「扣一次挑战机会」），第 3 次失败对局结束
 *   · 推进：仅当实际清过层（finalLayer > snap.layer）时，落层 = finalLayer + 1
 *     （下一条出发层；与 applySettlement 的落层语义一致）；胜率未达目标一关未打则原地不动
 */
export function applyAutoClimb(
  snap: RunSnapshot, _secret: RunSecret, r: AutoClimbResult,
): RunSnapshot {
  let next: RunSnapshot = {
    ...snap, version: snap.version + 1,
    gold: snap.gold + r.totalGold,
    pendingDrops: [...snap.pendingDrops, ...r.totalDrops],
  };
  if (r.stopReason === 'fail') {
    const failures = next.failures + 1;
    next = { ...next, failures, status: failures >= 3 ? 'lost' : 'active' };
  } else if (r.finalLayer > snap.layer) {
    const cap = capFor(next.mode);
    const layer = Math.min(r.finalLayer + 1, cap);
    next = {
      ...next,
      layer,
      status: r.finalLayer + 1 > cap ? 'won' : 'active',
      forgedThisLayer: [], fusedThisLayer: 0, reforgedThisLayer: false,
    };
  }
  return next;
}

// ── 经济规则（纯函数，前后端共用）────────────────────────────

export function buyItem(s: RunSnapshot, itemId: string): Result<RunSnapshot> {
  if (s.status !== 'active') return err('RUN_ENDED');
  const eq = s.shopStock.equipment.find((e) => e.id === itemId);
  const con = s.shopStock.consumables.find((c) => c.id === itemId);
  const item = eq ?? con;
  if (!item) return err('ITEM_GONE');
  const price = Math.round(item.basePrice * (1 - discountOf(s.tradeCount)));
  if (s.gold < price) return err('INSUFFICIENT_GOLD');
  return ok({
    ...s,
    version: s.version + 1,
    gold: s.gold - price,
    tradeCount: s.tradeCount + 1,
    opSeq: s.opSeq + 1,
    inventory: eq ? [...s.inventory, { ...eq, opened: true }] : s.inventory,
    consumables: con ? [...s.consumables, con] : s.consumables,
    shopStock: {
      equipment: s.shopStock.equipment.filter((e) => e.id !== itemId),
      consumables: s.shopStock.consumables.filter((c) => c.id !== itemId),
    },
  });
}

export function sellItem(s: RunSnapshot, equipmentId: string): Result<RunSnapshot> {
  if (s.status !== 'active') return err('RUN_ENDED');
  const eq = s.inventory.find((e) => e.id === equipmentId);
  if (!eq) return err('ITEM_GONE');
  const d = discountOf(s.tradeCount);
  const price = Math.round(eq.basePrice * 0.5 * (1 - d * 0.5));
  return ok({
    ...s,
    version: s.version + 1,
    gold: s.gold + price,
    tradeCount: s.tradeCount + 1,
    opSeq: s.opSeq + 1,
    inventory: s.inventory.filter((e) => e.id !== equipmentId),
  });
}

export function refreshShop(s: RunSnapshot, secret: RunSecret): Result<RunSnapshot> {
  if (s.status !== 'active') return err('RUN_ENDED');
  if (s.gold < REFRESH_COST) return err('INSUFFICIENT_GOLD');
  const rc = s.refreshCount + 1;
  return ok({
    ...s,
    version: s.version + 1,
    gold: s.gold - REFRESH_COST,
    refreshCount: rc,
    opSeq: s.opSeq + 1,
    shopStock: rollShopStock(mulberry32(seeds.shop(secret.seed, s.layer, rc)), 8),
  });
}

export function refreshRecruit(s: RunSnapshot, secret: RunSecret): Result<RunSnapshot> {
  if (s.status !== 'active') return err('RUN_ENDED');
  if (s.gold < REFRESH_COST) return err('INSUFFICIENT_GOLD');
  const rc = s.refreshCount + 1;
  return ok({
    ...s,
    version: s.version + 1,
    gold: s.gold - REFRESH_COST,
    refreshCount: rc,
    opSeq: s.opSeq + 1,
    // v1.7 招募池刷新时即个体化（与 startRun 同源逻辑），价格据此浮动
    recruitPool: rollRecruitPool(mulberry32(seeds.recruit(secret.seed, s.layer, rc)), s.team).map((h, i) =>
      variateHero(h, (seeds.recruit(secret.seed, s.layer, rc) ^ (i * 0x9e3779b1)) >>> 0, s.team.map((t) => t.personalName ?? t.name))),
  });
}

export function openDrop(s: RunSnapshot, chestId: string): Result<RunSnapshot> {
  const d = s.pendingDrops.find((x) => x.id === chestId);
  if (!d) return err('ITEM_GONE');
  const rest = s.pendingDrops.filter((x) => x.id !== chestId);
  if (d.reward.startsWith('gold')) {
    return ok({ ...s, version: s.version + 1, pendingDrops: rest, gold: s.gold + (d.gold ?? 0) });
  }
  return ok({
    ...s, version: s.version + 1, pendingDrops: rest,
    inventory: [...s.inventory, { ...d.equipment!, opened: true }],
  });
}

// ── 批量开箱：一次开全部（单次写、单次 version+1）──
// 逐箱并发开会在乐观锁上互相踩（都基于同一 version 期望 → 只成 1 个），
// 「全部开启」必须走这里。已不存在的箱子静默跳过（并发/重复点击安全）。
export function openDrops(s: RunSnapshot, chestIds: string[]): Result<RunSnapshot> {
  const idSet = new Set(chestIds);
  const targets = s.pendingDrops.filter((x) => idSet.has(x.id));
  if (targets.length === 0) return err('ITEM_GONE', '没有可开启的宝箱');
  const openedIds = new Set(targets.map((x) => x.id));
  let gold = s.gold;
  const inventory = [...s.inventory];
  for (const d of targets) {
    if (d.reward.startsWith('gold')) gold += d.gold ?? 0;
    else inventory.push({ ...d.equipment!, opened: true });
  }
  return ok({
    ...s,
    version: s.version + 1,
    pendingDrops: s.pendingDrops.filter((x) => !openedIds.has(x.id)),
    gold,
    inventory,
    opSeq: s.opSeq + targets.length,
  });
}

// ── 重铸：reforgeItem（白色 → 随机彩色，每层一次）──────────
// v3.3：白色装备重铸不再赌词条，而是直接升为彩色（蓝/橙/红 1/3 均匀）。
// 每层限一次（reforgedThisLayer 标记，层推进时重置）；结果写入 receipts.lastReforge 供 UI 展示。
export function reforgeItem(s: RunSnapshot, equipmentId: string): Result<RunSnapshot> {
  if (s.reforgedThisLayer) return err('REFORGE_LIMIT', '本层已重铸过，请推进下一层再试');
  const eq = s.inventory.find((e) => e.id === equipmentId);
  if (!eq) return err('ITEM_GONE', '装备不存在');
  if (eq.rarity !== 'normal') return err('NOT_REFORGEABLE', '仅白色装备可重铸');

  // 确定性种子：runId:equipmentId:layer（跨局不可复现，同局重放一致）
  const rng = mulberry32(hashStr(`${s.runId}:${equipmentId}:${s.layer}`) >>> 0);
  const rarity = (['blue', 'orange', 'red'] as const)[Math.floor(rng() * 3)];
  // 保留原装备 id：玩家视角是「同一件装备变成彩色」，不是凭空换新装
  const forged = { ...generateEquipment(rng, rarity), id: eq.id, opened: true };

  return ok({
    ...s,
    version: s.version + 1,
    reforgedThisLayer: true,
    inventory: s.inventory.map((e) => (e.id === equipmentId ? forged : e)),
    receipts: {
      ...s.receipts,
      lastReforge: { from: eq.rarity, to: rarity, itemId: forged.id, name: forged.name },
    },
  });
}

// ── 随机奇遇：resolveRandomEvent（战前抉择，确定性结算）──
// v3.4 从 store 提升：云端模式可正常操作（此前 Remote 短路导致点了没反应）。
// plan 用 renderSeed 重建（Remote 下前端 run.seed = renderSeed，玩家看到的选项 = 云端结算的选项，绝不分叉）。
export function resolveRandomEvent(s: RunSnapshot, layer: number, optionIndex: number): Result<RunSnapshot> {
  if (layer !== s.layer) return err('LAYER_MISMATCH', '只能结算当前层奇遇');
  if (s.resolvedEvents.includes(layer)) return err('EVENT_DONE', '该层奇遇已结算');
  const plan = genLayer(layer, s.renderSeed ?? 0, s.mode);
  const ev = plan.randomEvent;
  if (!ev) return err('EVENT_NONE', '本层无奇遇');
  const opt = ev.options[optionIndex];
  if (!opt) return err('EVENT_OPTION', '选项不存在');
  const e = opt.effect;
  // 献祭类选项必须真的付出一件装备才给钱；付费类买不起不成交（金币不允许为负）。
  if (e.sacrificeLowest && s.inventory.length === 0) return err('NO_MATERIAL', '背包为空，无法献祭');
  if (e.gold && e.gold < 0 && s.gold + e.gold < 0) return err('INSUFFICIENT_GOLD', '金币不足');

  let gold = s.gold;
  let inventory = [...s.inventory];
  let score = s.score;
  if (e.gold) gold += e.gold;
  if (e.give) {
    // 与 Local 同种子公式（run.seed=renderSeed），产出可复现
    const rng = mulberry32(((s.renderSeed ?? 0) ^ (layer * 2654435761) ^ (optionIndex * 40503)) >>> 0);
    for (let i = 0; i < e.give.count; i++) {
      inventory.push(generateEquipment(rng, e.give.rarity));
    }
  }
  if (e.sacrificeLowest && inventory.length > 0) {
    const worst = inventory.slice().sort((a, b) => equipScore(a) - equipScore(b))[0];
    inventory = inventory.filter((x) => x.id !== worst.id);
  }
  if (e.score) score += e.score;

  return ok({
    ...s,
    version: s.version + 1,
    gold,
    inventory,
    score,
    resolvedEvents: [...s.resolvedEvents, layer],
    opSeq: s.opSeq + (e.give?.count ?? 0),
  });
}

/** 每名勇者的装备槽上限：成长者仅 3 件（详见 traits.ts），其余 6 件。 */
function equipCapFor(h: HeroDef): number {
  return h.traitId === 'grower' ? TRAIT_CFG.growerEquipCap : EQUIP_SLOTS;
}

export function equipItem(s: RunSnapshot, uid: string, equipmentId: string): Result<RunSnapshot> {
  const eq = s.inventory.find((e) => e.id === equipmentId);
  if (!eq) return err('ITEM_GONE');
  const hero = s.team.find((h) => h.uid === uid);
  if (!hero) return err('TEAM_INVALID');
  const cur = s.equipped[uid] ?? [];
  if (cur.length >= equipCapFor(hero)) return err('SLOT_FULL');
  if (!s.team.some((h) => h.uid === uid)) return err('TEAM_INVALID');
  return ok({
    ...s,
    version: s.version + 1,
    inventory: s.inventory.filter((e) => e.id !== equipmentId),
    equipped: { ...s.equipped, [uid]: [...cur, eq] },
  });
}


export function unequipItem(s: RunSnapshot, uid: string, equipmentId: string): Result<RunSnapshot> {
  const cur = s.equipped[uid] ?? [];
  const eq = cur.find((e) => e.id === equipmentId);
  if (!eq) return err('ITEM_GONE');
  return ok({
    ...s,
    version: s.version + 1,
    equipped: { ...s.equipped, [uid]: cur.filter((e) => e.id !== equipmentId) },
    inventory: [...s.inventory, eq],
  });
}

export function recruit(s: RunSnapshot, _secret: RunSecret, heroId: string): Result<RunSnapshot> {
  if (s.status !== 'active') return err('RUN_ENDED');
  if (s.team.length >= 7) return err('CAP_REACHED');
  const h = s.recruitPool.find((x) => x.id === heroId);
  if (!h) return err('ITEM_GONE');
  // v1.7：招募池已在生成时个体化，直接采用池中英雄（不再二次个体化），
  //       价格按实际基础值相对预设的偏离浮动（贵≠一定强，偏高无用属性也会抬价）。
  const preset = HERO_BY_ID[h.id]?.basePrimary;
  const cost = recruitCostOf(s.layer, h.basePrimary, preset);
  if (s.gold < cost) return err('INSUFFICIENT_GOLD');
  const uid = `H${s.opSeq + 1}`; // 确定性 uid（替代模块级 heroUidSeq）
  return ok({
    ...s,
    version: s.version + 1,
    gold: s.gold - cost,
    opSeq: s.opSeq + 1,
    team: [...s.team, { ...h, uid, star: 1, dupIndex: s.team.filter((t) => t.id === heroId).length + 1 }],
    recruitPool: s.recruitPool.filter((x) => x.id !== heroId),
  });
}

/** 一键装备：按评分从高到低塞满空槽（纯整理操作，无随机、无消耗 → 前端应即时执行） */
// ── 一键装备：equipAll（批量单次写，与 openDrops 同构；v3.4b 提升为云端命令）──
// 按评分从高到低逐件塞满空槽（纯整理，无随机无消耗）；单次命令内完成、
// 一次写回最终快照——避免逐件确认的中间快照把本地乐观状态覆盖回去（"自动脱"根因）。
export function equipAll(s: RunSnapshot, uid?: string): Result<RunSnapshot> {
  const targets = uid ? s.team.filter((h) => h.uid === uid) : s.team;
  if (targets.length === 0) return err('TEAM_INVALID', '没有可装备的英雄');
  const inv = [...s.inventory].sort((a, b) => equipScore(b) - equipScore(a));
  const eqMap = { ...s.equipped };
  let changed = 0;
  for (const h of targets) {
    const cap = equipCapFor(h);
    const cur = [...(eqMap[h.uid] ?? [])];
    while (cur.length < cap && inv.length) {
      cur.push(inv.shift()!);
      changed++;
    }
    eqMap[h.uid] = cur;
  }
  return ok({
    ...s, version: s.version + 1, inventory: inv, equipped: eqMap,
  });
}
