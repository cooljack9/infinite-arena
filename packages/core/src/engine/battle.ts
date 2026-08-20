// 自动战斗模拟（需求 5.4；开发 §6；美术 §6/§7）
// 纯 TS 确定性：固定步长 + 种子随机；逻辑与渲染解耦（开发 §6.5）
import {
  Unit, FloatText, Projectile, DerivedAttrs, ArenaDef,
  Effect, VfxShape, SummonKind, AudioCue, AudioEventId, WeatherDef,
  HeroGrowth, GrowthStatKey, GROWTH_STAT_KEYS, PRIMARY_KEYS,
  BuildingPlacement, BuildingSpawnKind, PrimaryAttrs,
  BattleStatRow, RangeTier, VanEncounter, TraitId,
} from '../types';
import { mulberry32, RNG, pick } from './rng';
import { SUBCLASS_INFO, BODY_INFO, hitRadiusOf } from '../content/classes';
import { derive } from './formulas';
import { rangeTier, TIER_TTL, LONG_WARN_TIME, beamThickness, vfxOf } from '../content/skills';
import { SUMMON_TEMPLATES, MAX_SUMMONS, pickSummonKind } from '../content/summons';
import { TRAIT_CFG, STAGE2_CFG, TRAITS, rollTrait, applyTraitStatic } from '../content/traits';
import { MOUNTS } from '../content/mounts';
import { BUILDINGS, SPAWN_TEMPLATES, isTower } from '../content/buildings';

import { clamp, dist, len2d, BOSS_CLONE_COUNT, BOSS_CLONE_HP, BOSS_CLONE_DMG, BOSS_CLONE_DURATION, nextBuildingId } from './battle/common';
import {
  applyEnemyFocus, findStrongestAlly, getEnemyFocus,
  ENEMY_FOCUS_DEFAULT, type EnemyFocusCfg,
} from './coherence';
// 演算路径禁止 Math.sin/cos/atan2/pow —— 它们是 implementation-approximated，跨引擎不一致。
// 一律走 detmath 的确定性实现。静态闸门：scripts/guard-determinism.mjs
import { dsin, dcos, drot, DEG } from './detmath';
export { applyRelics } from './battle/relics';

// v2.7 动作系统：尸体留存时长（秒）。单位死亡后 alive=false 但仍在 units 中保留
// CORPSE_TTL 秒，供渲染层播「倒下 → 渐隐」；之后才从数组移除。
// 0.45s 倒下 + 0.25s 定格 + 0.5s 渐隐到半透明，半透明尸体长期留在战场（战斗残留感）。
export const CORPSE_TTL = 1.2;

// 飘字硬上限：高层单位密集时，伤害数字经 fillText 渲染是 CPU 热点；封顶避免掉帧
const MAX_FLOATERS = 70;

// ── v2.9.x 面包车特殊关旋钮（cosplay 五菱宏光）──
// 三个数，三种确定性不同，标注分开写清楚：
/** 开场速度乘子 = 2。来自需求原文「开场 10 秒移速翻倍」，非推测值。 */
const VAN_OPENING_SPEED_MUL = 2;
/**
 * 撞击伤害基础倍率 [PLACEHOLDER · 待一轮数值 pass]
 *
 * 参照物：突击战士「冲锋」是 pDmg × 2.5 单体 + 晕 1 秒。
 * 面包车撞击是 AoE + 击退、不带控，所以基础倍率取得更低；
 * 乘上开场 ×2 后 ≈ 2.2，与冲锋同量级——开场那一撞该疼得让人记住，但不该是斩杀。
 * 卸完人后回落到 1.1，正是需求要的"威胁明显下降"。
 * 验证路径：中端机 30 局，记录「开场撞击后我方前排剩余血量%」，
 * 目标带 45%~70%（低于 45% = 开场即崩，高于 70% = 车队白来）。
 */
const VAN_RAM_MUL = 1.1;
/**
 * 击退距离（格）[PLACEHOLDER · 待手感 pass]
 *
 * 1.6 格 ≈ 一个近战身位：读作"阵型被撕开一个位置"，需要重新贴脸，
 * 而不是"被推到地图边缘"——后者把击退变成了控制链，不是本关想教的东西。
 * 卸人后撞击的击退距离减半（× 0.5），与伤害同步衰减，威胁下降是全方位的。
 */
const VAN_RAM_KNOCKBACK = 1.6;

// ── v2.9.x 渲染克制（需求②：降光污染 + 稳帧）──
// effects 数组原本只按 ttl 过滤、无上限：满屏弹道 + 多英雄同放大招时，
// 同帧可见 effect 可达上百个，既过曝又压帧。加硬上限，超出丢弃最旧。
// 取值 [PLACEHOLDER · 待一轮中端机 perf pass]：一场 ~30 单位、单技能收敛后 ≤8 effect、
// TTL≈0.5s@20fps ≈ 10 tick，正常峰值远低于此；64 只是防「多英雄同秒大招」尖峰的网。
const MAX_EFFECTS = 64;

// v2.9.x 特性触发特效（需求③）：克制的小特效，纯 emit、零 RNG、零状态写入，
// 不碰数值/回放确定性（effects 不进 checksum）。颜色跟特性走，一眼可读「刚触发了哪个特性」。
const TRAIT_VFX: Partial<Record<TraitId, { color: string; shape: VfxShape }>> = {
  lethal:     { color: '#ff4d6a', shape: 'blade' },
  shackle:    { color: '#9a7bff', shape: 'ring' },
  volley:     { color: '#ffae3d', shape: 'trail' },
  bulwark:    { color: '#6fd3ff', shape: 'bubble' },
  spellbreak: { color: '#b07bff', shape: 'beam' },
  heart:      { color: '#ff7a9a', shape: 'ring' },
  spacetime:  { color: '#7fe3ff', shape: 'rift' },
};

// ── v2.9.8 女娲「造化」强化（需求：召唤流必须能自我滚雪球）──
// 原设计里女娲开局要等满 CD 才出第一波召唤物，前 10 秒等于 2 打 3；
// 而一旦召唤物铺开，她本人又只是站桩平 A，大招节奏与场面完全脱钩。
// 三条改动把「召唤」变成一个由输出与击杀共同驱动的循环：
//   ① 开局立即释放 —— 第一 tick 强制施法，开场即三打三；
//   ② 普攻共鸣 —— 女娲本人 / 其召唤物每次普攻，为她削减 1s 大招冷却；
//   ③ 击杀即刻重铸 —— 女娲或其召唤物拿到人头，大招冷却清零并立刻再放一次。
const NUWA_ATTACK_CDR = 1.0;      // ② 每次普攻削减的冷却（秒）
const NUWA_SKILL_ID = 'summon';   // 女娲大招 id（召唤系英雄的判定锚点）

// ── v2.9.9 治疗职业「重击转群疗」──
// 治疗职业的轻击伤害削弱系数。她的定位是辅助，普攻只是「不站桩发呆」的填充行为，
// 不该抢输出位；0.5 意味着同等属性下她的平 A 只有其他远程的一半。
// 已验证（20 局 ×「武圣+炮手+治疗」标准阵容）：治疗职业伤害占全队 7.3%，
// 双坦阵容 18.8%（坦克本身没输出，属阵容伪影）。smoke 以 <15% 为回归门槛。
const HEALER_LIGHT_DMG_MULT = 0.5;
// 群疗的单体折扣：重击治疗按人头分摊，聚拢站位收益更高，但不会因为人多而线性爆炸。
// 已验证：均治疗量从 v2.9.8 的 364 降到 229（双坦阵容），群疗事件 2~5 次/局，
// 血线跌破 60% 的局重新出现（2/20），嘲讽二段等低血触发机制恢复生效。
const HEAL_BURST_SPLIT = 0.6;

export class BattleSim {
  units: Unit[] = [];
  projectiles: Projectile[] = [];
  floaters: FloatText[] = [];
  effects: Effect[] = [];
  time = 0;
  over = false;
  result: 'win' | 'lose' | null = null;
  W: number;
  H: number;
  rng: RNG;
  // vX 队伍协同系数（反"堆一人"）：仅由开局我方单位派生属性算出，确定性、对 replay 一致。
  // 在 applyDamage 中对我方攻击者乘上 → 均衡队输出拉满、一人独大则被压。
  // 反"堆一人"·敌方针对最强（coherence.ts）：层数 + 每场触发计数 + 配置。
  layer = 0;
  frontMutualCount = 0;
  backShackleCount = 0;
  enemyFocus: EnemyFocusCfg = ENEMY_FOCUS_DEFAULT;
  // v2.9 轻/重击伤害扰动专用独立随机流：种子从主 seed 派生，**不消耗主 rng**。
  // 主随机流（crit/技能/走位/闪避）序列完全不变 → 对局走向与旧版本一致，仅伤害带扰动。
  atkRng: RNG;
  arena: ArenaDef;

  // v1.7 §2 击杀成长账本：heroUid -> 累积的永久成长（已被逐 key 求和）。
  // 战斗结束由 BattleScreen 取走并写回 store。友方召唤物没有 heroUid，不参与记账。
  killGains: Map<string, HeroGrowth> = new Map();
  // v1.7 §2（改）：伤害归因表 —— 敌方单位 id → 对其造成过伤害的友方 heroUid 集合，用于判定击杀助攻。
  private damagers = new Map<string, Set<string>>();

  // v2.2 铁人无尽（permadeath）：本场战斗中阵亡的友方副本 uid 集合。
  // 友方召唤物（无 heroUid）不计入；仅真实勇者副本进入铁人「永久消失」判定。
  private deadAllies: Set<string> = new Set();

  // v2.4.4 通用数据回路在战斗内核的镜像：单位主键索引，O(1) 事件/索敌定位（替代 units.find 热路径）
  byId = new Map<string, Unit>();

  // v2.9.8 女娲「开局立即释放大招」：只在本场第一 tick 触发一次（波次增援不重复触发）
  private openingCastDone = false;

  // v3.1 场内生成物编号：召唤物 / Boss 分身共用一条**单调自增**序列。
  // 旧实现用 `'sum' + Math.floor(this.time*1000) + kind` 拼 id —— 同一 tick 内
  // 两名召唤师同时出同类型召唤物（或军团特性一次补两只）会得到**完全相同的 id**，
  // 而 id 是 targetId / damagers / pathCache / 渲染 key 的主键，撞号会导致
  // 索敌串目标、寻路缓存互相污染、渲染插值跳变等一连串难查的隐性 bug。
  // 计数器挂在 sim 实例上（而非模块级）：同 seed 同回放必然同序列，
  // 又不会被「玩家开过几次编队界面」这类外部调用次数污染。
  private spawnSeq = 0;
  /** 取下一个场内生成物 id（召唤物 / 分身共用序列，保证全局唯一） */
  private nextSpawnId(prefix: string): string {
    return `${prefix}${this.spawnSeq++}`;
  }

  constructor(units: Unit[], arena: ArenaDef, seed: number) {
    this.units = units;
    for (const u of units) this.byId.set(u.id, u); // v2.4.4 主键索引预热
    this.arena = arena;
    this.W = arena.width;
    this.H = arena.height;
    this.rng = mulberry32(seed);
    this.atkRng = mulberry32((seed ^ 0x9e3779b9) >>> 0); // v2.9：轻/重击伤害扰动独立流
    // v1.5 环境天气：增益在构造时一次性写进双方属性（美术 §3.4.5），零运行时随机
    if (arena.weather) this.applyWeather(arena.weather);
    // 反"堆一人"·轻量方案（coherence.ts）：按层调度给部分敌人打"针对最强"被动标记。
    // 浅层无、深层低频打标 → 敌人专搞我方最强，堆一人被结构性压制。
    this.layer = arena.layer ?? 0;
    this.frontMutualCount = 0;
    this.backShackleCount = 0;
    this.enemyFocus = getEnemyFocus();
    applyEnemyFocus(this.units, this.layer, this.rng);
  }

  /** v2.4.4 统一入列并登记主键索引（byId），保证事件/索敌 O(1) 定位覆盖全部单位 */
  private _push(u: Unit) {
    this.units.push(u);
    this.byId.set(u.id, u);
  }

  /**
   * v1.5 环境天气增益（美术 §3.4.5）：应用到场上双方，环境中性不偏袒任一方。
   * 应用一次、持续整场，不在 tick 里反复乘，避免浮点漂移。
   * 回血类（verdant）只写 regenPct，由 tick 按 dt 结算；其余直接改派生属性/伤害乘子。
   */
  private applyWeather(w: WeatherDef) {
    for (const u of this.units) {
      if (w.moveSpeedAdd !== undefined) u.derived.moveSpeed += w.moveSpeedAdd;
      if (w.atkSpeedAdd !== undefined) u.derived.atkSpeed += w.atkSpeedAdd;
      if (w.dmgMul !== undefined) u.dmgMult *= w.dmgMul;
      if (w.critAdd !== undefined) u.derived.crit += w.critAdd;
      if (w.regenPct !== undefined) u.derived.regenPct = w.regenPct;
      if (w.dmgTakenMul !== undefined) u.derived.dmgTakenMult = w.dmgTakenMul;
    }
  }

  arenaTile(r: number, c: number): string {
    const row = this.arena.tiles[r];
    return row ? row[c] ?? '.' : '.';
  }

  /** v2.4.4 特色地块效果：每 tick 按单位所在地块计算攻速/受伤乘子（确定性，无随机）。
   *  w 水域 → 攻速 ×0.88（−12%）；P 掩体 → 受伤 ×0.85（等效防御 +15%）；
   *  B 王座且 isBoss → 受伤 ×0.80（王座增益，配合本 tick 的王座回血）。 */
  private _updateTileEffects() {
    for (const u of this.units) {
      if (!u.alive) { u.tileSpdMul = 1; u.tileDmgTaken = 1; continue; }
      const ch = this.arenaTile(Math.floor(u.y), Math.floor(u.x));
      if (ch === 'w') { u.tileSpdMul = 0.88; u.tileDmgTaken = 1; }
      else if (ch === 'P') { u.tileSpdMul = 1; u.tileDmgTaken = 0.85; }
      else if (ch === 'B' && u.isBoss) { u.tileSpdMul = 1; u.tileDmgTaken = 0.80; }
      else { u.tileSpdMul = 1; u.tileDmgTaken = 1; }
    }
  }

  /** v2.9.3 瓦片可行走性：墙 # 与危险地形 ~ 不可通行（地面/P掩体/S/E/Boss台 可站） */
  private isWalkable(x: number, y: number): boolean {
    const r = Math.floor(y), c = Math.floor(x);
    if (r < 0 || r >= this.H || c < 0 || c >= this.W) return false;
    const ch = this.arenaTile(r, c);
    return ch !== '#' && ch !== '~';
  }

  /** 时空拓印·瞬移：把单位传到至少 minDist 格外、可站立、不与友方重叠的格；找不到则不动 */
  private teleportAway(u: Unit, minDist: number) {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (let r = 0; r < this.H; r++) {
      for (let c = 0; c < this.W; c++) {
        if (!this.isWalkable(c + 0.5, r + 0.5)) continue;
        const x = c + 0.5, y = r + 0.5;
        // 不与友方重叠（避免瞬移进别人身体）
        if (this.units.some((o) => o.alive && o.side === u.side && o.id !== u.id
          && Math.abs(o.x - x) < 0.6 && Math.abs(o.y - y) < 0.6)) continue;
        const d = Math.abs(x - u.x) + Math.abs(y - u.y);
        if (d < minDist) continue;
        if (d < bestD) { bestD = d; best = { x, y }; }
      }
    }
    if (best) {
      u.x = best.x; u.y = best.y;
      this.emit('rift', u.x, u.y, '#9be7ff', 0.3, { r: 0.8, alphaFrom: 0.9, alphaTo: 0 });
    }
  }

  // v2.9.3 寻路缓存：单位被障碍完全挡住时的 BFS 绕障路径（0.3s 缓存，成本可忽略）
  private pathCache = new Map<string, { at: number; path: { r: number; c: number }[] }>();

  /** BFS 从单位所在格到目标格的最短路径（4 邻接，返回从下一格开始的路径；目标不可达返回空） */
  private pathTo(u: Unit, tx: number, ty: number): { r: number; c: number }[] {
    const cached = this.pathCache.get(u.id);
    if (cached && this.time - cached.at < 0.3) return cached.path;
    const sr = Math.floor(u.y), sc = Math.floor(u.x);
    const tr = Math.floor(ty), tc = Math.floor(tx);
    const key = (r: number, c: number) => `${r},${c}`;
    const prev = new Map<string, string | null>();
    const q: string[] = [key(sr, sc)];
    prev.set(key(sr, sc), null);
    let found: string | null = null;
    let head = 0;
    while (head < q.length) {
      const cur = q[head++];
      if (cur === key(tr, tc)) { found = cur; break; }
      const [r, c] = cur.split(',').map(Number);
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc;
        const k = key(nr, nc);
        if (prev.has(k) || !this.isWalkable(nc + 0.5, nr + 0.5)) continue;
        prev.set(k, cur);
        q.push(k);
      }
    }
    if (!found) { this.pathCache.set(u.id, { at: this.time, path: [] }); return []; }
    const path: { r: number; c: number }[] = [];
    let cur: string | null = found;
    while (cur && prev.get(cur) !== null) {
      const [r, c] = cur.split(',').map(Number);
      path.unshift({ r, c });
      cur = prev.get(cur)!;
    }
    this.pathCache.set(u.id, { at: this.time, path });
    return path;
  }

  // v2.9.3 地形永久改变：技能打过的地面留下痕迹，本场战斗内永久（确定性数据，渲染层只读）。
  // 玄武镇岳怒吼 → 大坑（crater）；关羽青龙偃月斩 → 刀痕（slash，线状焦土+裂纹，单点武器克制破坏）。
  terrainCraters: { x: number; y: number; r: number }[] = [];
  terrainSlashs: { x0: number; y0: number; x1: number; y1: number; w: number }[] = [];

  /** 技能砸出的大坑（镇岳怒吼：玄武踏碎地面成坑）。范围随施法者体型缩放 */
  private markCrater(x: number, y: number, radius: number, by: Unit) {
    const m = BODY_INFO[by.bodyType].sizeMult; // 体型越大，坑越大
    this.terrainCraters.push({ x, y, r: radius * m });
  }

  /** 单点武器劈出的刀痕（青龙偃月斩：刀劈一线焦土 + 裂纹）。宽度随攻击者体型 */
  private markSlash(x0: number, y0: number, x1: number, y1: number, by: Unit) {
    const m = BODY_INFO[by.bodyType].sizeMult;
    this.terrainSlashs.push({ x0, y0, x1, y1, w: 0.5 * m });
  }

  private alive(side: 'ally' | 'enemy'): Unit[] {
    return this.units.filter((u) => u.alive && u.side === side);
  }
  private nearest(pool: Unit[], u: Unit): Unit {
    return pool.reduce((b, c) => (dist(c, u) < dist(b, u) ? c : b));
  }
  private farthest(pool: Unit[], u: Unit): Unit {
    return pool.reduce((b, c) => (dist(c, u) > dist(b, u) ? c : b));
  }
  private lowestHp(pool: Unit[]): Unit {
    return pool.reduce((b, c) => (c.hp < b.hp ? c : b));
  }

  // 发射一个技能特效（需求 v1.3：按 shape 区分几何形状）
  private emit(shape: VfxShape, x: number, y: number, color: string, ttl: number, opts: Partial<Effect> = {}) {
    this.effects.push({ shape, x, y, color, ttl, maxTtl: ttl, r: 0.8, ...opts });
    // v2.9.x 渲染克制：超出上限丢弃最旧，防光污染/掉帧尖峰（effects 不进 checksum，纯渲染旁路）
    if (this.effects.length > MAX_EFFECTS) this.effects.splice(0, this.effects.length - MAX_EFFECTS);
  }

  /**
   * 起手距离环（需求 v1.4 §5.4 三件套 ①；美术 §7.3.1）
   * 施法瞬间在脚下画半径 = 真实施法距离的虚线圆，0.25s，alpha 0.35→0。
   * 让玩家一眼看到「这技能能够多远」。castRange=0（self 档）不画——
   * 画一个半径 0 的圈是噪声。
   */
  private windup(u: Unit, castRange: number, color: string) {
    if (castRange <= 0) return;
    this.effects.push({
      shape: 'ring', x: u.x, y: u.y, r: castRange,
      color, ttl: 0.25, maxTtl: 0.25,
      dashed: true, alphaFrom: 0.35, alphaTo: 0,
    });
  }

  // ══ v2.9.9 大招签名帧（需求②：全队大招特效都达到关羽水平）══════════════════
  // 关羽「青龙偃月斩」在 v2.9.8 立了标准：一次大招 = 四层递进，而不是一个孤零零的形状。
  //   ① 主体层：技能身份形状，够大够久，先声夺人
  //   ② 副体层：错时（delay）拉开的一组同形/近形残影，读作「一招带出一片」
  //   ③ 冲击层：nova 放射定「爆点」+ shock 扩散定「范围」，把尺度钉在地面上
  //   ④ 收尾层：quake 余波 + 内环回吸 + 技能名飘字，让这一帧有重量
  // 其余 8 个大招原本大多只有 ① 一层（护盾就一个泡泡、群疗就一片光），
  // 在满屏弹道里根本挑不出来。下面三个 helper 把 ②③④ 抽成公共件——
  // 八个 case 各写一遍，就一定会漏掉两遍。
  //
  // 铁律：全部是纯 emit / floaters（零 RNG、零状态写入），
  // 对确定性回放与数值平衡无任何影响。smoke [2] 的同 seed 一致性即为守门断言。

  /** ③④ 冲击 + 收尾层。core=爆点色（亮），echo=扩散色（浅） */
  private ultBurst(
    x: number, y: number,
    o: { core: string; echo: string; r: number; tier?: RangeTier; sizeMul?: number; quake?: string },
  ) {
    const { core, echo, r, tier, sizeMul } = o;
    // v2.9.x 克制：原④层（quake 余波 + 内环回吸）删除——单技能 4 个 effect 是光污染主源。
    // 爆点(nova) + 扩散(shock) 已把尺度钉在地面，余波/回吸属冗余描边。
    this.emit('nova', x, y, core, 0.42, { r: r * 0.85, tier, sizeMul });
    this.emit('shock', x, y, echo, 0.52, { r, tier, sizeMul, alphaFrom: 0.85, alphaTo: 0 });
  }

  /**
   * ② 副体层·环形阵列：以 (x,y) 为心、rad 为半径均分 n 个点，逐点错时 emit 同一形状。
   * 三角函数是确定性的，不碰随机流。
   */
  private ultRadial(
    shape: VfxShape, x: number, y: number, color: string, ttl: number,
    o: { n: number; rad: number; size: number; step?: number; tier?: RangeTier; sizeMul?: number; phase?: number },
  ) {
    const n = Math.min(o.n, 4); // v2.9.x 克制：环形阵列上限 4，原 6~8 是满屏刀阵的来源
    const step = o.step ?? 0.05;
    const phase = o.phase ?? 0;
    for (let i = 0; i < n; i++) {
      const a = phase + (Math.PI * 2 * i) / o.n;
      this.emit(shape, x + dcos(a) * o.rad, y + dsin(a) * o.rad, color, ttl, {
        r: o.size, tier: o.tier, sizeMul: o.sizeMul, delay: i * step,
      });
    }
  }

  /** ④ 收尾层·技能名横幅：大招是这一局的高光时刻，得报出名字 */
  private ultName(x: number, y: number, name: string, color: string) {
    this.floaters.push({ x, y: y - 1.4, text: name, color, ttl: 0.9 });
  }

  /** 技能施法距离（格）。逻辑判定与特效尺寸共用同一个数。 */
  private castRangeOf(u: Unit): number {
    return (u.skill.castRange ?? SUBCLASS_INFO[u.subclass].attackRange) + (u.rangeBonus ?? 0);
  }

  /** 取施法距离内的敌人（v1.4：技能不再「全体生效」，否则距离环就没有意义） */
  private inCastRange(u: Unit, pool: Unit[]): Unit[] {
    const r = this.castRangeOf(u);
    return pool.filter((t) => dist(t, u) <= r + t.hitRadius);
  }

  /** 战斗日志（自动战斗必须可播报，需求 §5.2.2） */
  log: string[] = [];

  /**
   * 音频事件汇（音频设计文档 §4）
   * 纯数据：仿真只 push cue，渲染层在 tick 外 drain 消费。不 import 音频模块，
   * 对确定性零影响——这只是往数组里追加，不参与任何模拟数学。
   */
  audioCues: AudioCue[] = [];
  private emitAudio(cue: AudioCue) { this.audioCues.push(cue); }
  /** 渲染层每帧调用：取走并清空本帧累积的音频事件 */
  drainAudioCues(): AudioCue[] {
    if (!this.audioCues.length) return [];
    const c = this.audioCues;
    this.audioCues = [];
    return c;
  }

  private pushLog(s: string) {
    this.log.push(s);
    if (this.log.length > 40) this.log.shift();
  }

  /**
   * 延迟结算队列（美术 §7.3.1 ③「先告知，再兑现」）
   * 原实现里 long 档的预警线是**画在伤害之后**的——飘字和"预警"同时出现，
   * 预警就成了事后追认，玩家体感是「我血怎么突然没了」。这不是难度，是信息缺失。
   * 加这个队列让伤害真的落在预警线之后，0.22s 的屏息才成立。
   * 用 filter 保序处理，不引入非确定性（固定步长下回放结果一致）。
   */
  private pending: { at: number; fn: () => void }[] = [];
  private schedule(delay: number, fn: () => void) {
    if (delay <= 0) { fn(); return; }
    this.pending.push({ at: this.time + delay, fn });
  }
  private runPending() {
    if (!this.pending.length) return;
    const due = this.pending.filter((p) => p.at <= this.time);
    if (!due.length) return;
    this.pending = this.pending.filter((p) => p.at > this.time);
    for (const d of due) d.fn();
  }

  private acquireTarget(u: Unit): Unit | null {
    // 奶妈不索敌（只治疗，见 tick）
    const foes = this.alive(u.side === 'ally' ? 'enemy' : 'ally');
    if (!foes.length) return null;

    // v1.8.4 兽类小个体「复仇」：母体被击杀后，优先攻击击杀母体者（母体存活时正常索敌）
    if (u.isBeastling && u.vengeTargetId) {
      const v = this.byId.get(u.vengeTargetId ?? '');
      if (v && v.alive) return v;
    }

    // ── 召唤物三类各自的索敌行为（需求 §5.2.2）──
    if (u.summonKind === 'sprinter') return this.lowestHp(foes);              // 直扑残血，无视中间目标
    if (u.summonKind === 'bulwark') return this.nearest(foes, u);             // 挡在最近的敌人前
    if (u.summonKind === 'arcanist') return this.nearest(foes, u);            // 远程消耗，保持距离见 moveToward

    const taunters = foes.filter((f) => f.tauntUntil > this.time);
    const pool = taunters.length ? taunters : foes;

    // ── v3.1 性格索敌（需求 §6）──
    // 嘲讽仍然压过性格：pool 已被嘲讽过滤，性格只在"允许选谁"的范围内挑。
    // 'steady'（随遇而安）= 保留 v3.0 的默认行为，不进偏好通道。
    if (u.personality && u.personality !== 'steady' && pool.length > 1) {
      return this.byPersonality(u, pool);
    }

    if (this.attackRangeOf(u) > 3) return this.lowestHp(pool);
    return this.nearest(pool, u);
  }

  /**
   * v1.8.3 卡住修复配套：在「可达」的存活敌人里按与 acquireTarget 相同的偏好选目标。
   * 仅用于 acquireTarget 选中的目标被墙/水完全挡住时换靶；全部不可达则返回 null（保持原目标）。
   * 可达性 = BFS（pathTo 非空），纯确定性。
   */
  private acquireReachable(u: Unit): Unit | null {
    const foes = this.alive(u.side === 'ally' ? 'enemy' : 'ally')
      .filter((f) => this.pathTo(u, f.x, f.y).length > 0);
    if (!foes.length) return null;
    const taunters = foes.filter((f) => f.tauntUntil > this.time);
    const pool = taunters.length ? taunters : foes;
    if (this.attackRangeOf(u) > 3) return this.lowestHp(pool);
    return this.nearest(pool, u);
  }

  /**
   * v3.1 性格偏好索敌。
   *
   * 关键取舍：**不做纯优先级，做「偏好分 − 距离」的加权**。
   * 纯优先级会让一个近战刺客无视贴脸的坦克，横穿整张图去够后排法师——
   * 路上被四个人围殴致死，玩家看到的不是"性格"，是"AI 犯蠢"。
   * 用 PREF_W 格的距离预算把偏好换算成"我愿意为这个目标多走几步"，
   * 偏好足够强时依然会绕后，但不会做出自杀式远征。
   */
  private byPersonality(u: Unit, pool: Unit[]): Unit {
    const PREF_W = 6; // 偏好满分 ≈ 值得多走 6 格

    // 「前排 / 后排」以**我方阵型重心**为基准，而不是攻击者自身——
    // 用自身位置的话，"前排"会退化成"离我最近"，攻坚者与随遇而安就没区别了。
    let ax = 0, ay = 0, an = 0;
    for (const a of this.units) {
      if (a.alive && a.side === u.side && !a.summonKind) { ax += a.x; ay += a.y; an++; }
    }
    if (!an) { ax = u.x; ay = u.y; an = 1; }
    ax /= an; ay /= an;

    // 阵深归一化：离我方重心最近 = 前排(1)，最远 = 后排(0)
    let dMin = Infinity, dMax = -Infinity;
    const depth = new Map<string, number>();
    for (const f of pool) {
      const d = len2d(f.x - ax, f.y - ay);
      depth.set(f.id, d);
      if (d < dMin) dMin = d;
      if (d > dMax) dMax = d;
    }
    const span = Math.max(0.001, dMax - dMin);

    // 战力评分归一化（救困扶危用）：输出 + 血量厚度，Boss 天然分高
    const threat = (f: Unit) => f.derived.pDmg + f.derived.mDmg + f.maxHp * 0.04;
    let tMax = 0;
    for (const f of pool) tMax = Math.max(tMax, threat(f));
    tMax = Math.max(1, tMax);

    let best = pool[0];
    let bestScore = -Infinity;
    for (const f of pool) {
      const front = 1 - (depth.get(f.id)! - dMin) / span; // 1=最前 0=最后
      let pref = 0;
      switch (u.personality) {
        case 'valiant':  pref = f.hp > f.maxHp * 0.8 ? 1 : 0; break;      // 不畏强暴
        case 'hunter':   pref = 1 - f.hp / Math.max(1, f.maxHp); break;   // 猎手
        case 'breaker':  pref = front; break;                             // 攻坚者
        case 'assassin': pref = 1 - front; break;                         // 专业刺客
        case 'savior':   pref = threat(f) / tMax; break;                  // 救困扶危
        default:         pref = 0;
      }
      const score = pref * PREF_W - dist(f, u);
      if (score > bestScore) { bestScore = score; best = f; }
    }
    return best;
  }

  private moveToward(u: Unit, target: Unit, dt: number) {
    let dx = target.x - u.x;
    let dy = target.y - u.y;
    const raw = len2d(dx, dy) || 1;

    // 咒火灵（远程召唤物）：被近身则后撤，保持 4–5.5 格风筝距离
    if (u.summonKind === 'arcanist' && raw < 4) { dx = -dx; dy = -dy; }

    const d = len2d(dx, dy) || 1;
    // 移速：基础 + 二级属性（已含体型 B_ms）+ 轻捷「滑步」窗口 +20%
    // v2.8：slim「灵巧」滑步进阶 +25%（light 仍是 +20%）
    const glide = u.glideUntil && u.glideUntil > this.time ? (u.bodyType === 'slim' ? 1.25 : 1.2) : 1;
    // v1.6 禁锢减速：只影响位移，不影响攻速（否则控制师会一个人打完全场）
    const slow = (u.slowUntil ?? 0) > this.time ? 1 - (u.slowPct ?? 0) / 100 : 1;
    // v2.9.3 地形羁绊：站在坑内 −20%、刀痕上 −15%（破坏地形成了真战术：绕坑走位有价值）
    let terrainSlow = 1;
    for (const cr of this.terrainCraters) {
      if (len2d(u.x - cr.x, u.y - cr.y) < cr.r) { terrainSlow = 0.8; break; }
    }
    if (terrainSlow === 1) {
      for (const sl of this.terrainSlashs) {
        const dx = sl.x1 - sl.x0, dy = sl.y1 - sl.y0;
        const len2 = dx * dx + dy * dy || 1;
        const tproj = ((u.x - sl.x0) * dx + (u.y - sl.y0) * dy) / len2;
        const px2 = sl.x0 + dx * Math.max(0, Math.min(1, tproj));
        const py2 = sl.y0 + dy * Math.max(0, Math.min(1, tproj));
        if (len2d(u.x - px2, u.y - py2) < sl.w * 1.5) { terrainSlow = 0.85; break; }
      }
    }
    // v2.9.3 移速衰减：装备/坐骑/天气堆叠的移速超阈值衰减；滑步 glide（暂时）不衰减
    const dampMs = this.dampMoveSpeed(u);
    // v2.9.x 面包车开场油门：乘在**速度**上而不是移速属性上（理由见 vanSpeedMult 注释）。
    // 非面包车恒返回 1，对其余单位是零影响的一次乘法。
    const sp = (2.0 + dampMs * 0.02) * glide * Math.max(0.2, slow) * terrainSlow * this.vanSpeedMult(u);
    let nx = u.x + (dx / d) * sp * dt;
    let ny = u.y + (dy / d) * sp * dt;
    // v2.9.3 瓦片碰撞：墙/水不可通行。被挡时**先 BFS 寻路绕障**（找桥/通道——否则单位
    // 会滑到目标正上方的岸边死角永远到不了对岸）；目标确实不可达（如隔水）才轴分离滑动贴边。
    if (!this.isWalkable(nx, ny)) {
      const path = this.pathTo(u, target.x, target.y);
      if (path.length) {
        const ncx = path[0].c + 0.5, ncy = path[0].r + 0.5;
        // 曾用 atan2→cos/sin 求朝向单位向量，绕了一圈还引入跨引擎不确定性
        // （见 docs/backend/07）。直接归一化：与上面 dx/d 同款，既确定又更快。
        const vx = ncx - u.x, vy = ncy - u.y;
        const vlen = len2d(vx, vy) || 1;
        nx = u.x + (vx / vlen) * sp * dt;
        ny = u.y + (vy / vlen) * sp * dt;
      } else {
        const slidX = this.isWalkable(nx, u.y);
        const slidY = this.isWalkable(u.x, ny);
        if (slidX && !slidY) ny = u.y;
        else if (slidY && !slidX) nx = u.x;
        else if (slidX && slidY) {
          if (Math.abs(dx) >= Math.abs(dy)) ny = u.y; else nx = u.x;
        } else { nx = u.x; ny = u.y; }
      }
    }
    // 大体型「锚定」：2.5 格内若有 giant/titan/colossal 友军，本单位受击退 −50%（山锚定小队）。
    // 仅对友军生效（分离推挤本就只发生在同侧单位间）；大体型自身本就免疫击退，不受影响。
    let anchored = false;
    for (const a of this.units) {
      if (a === u || !a.alive || a.side !== u.side) continue;
      if ((a.bodyType === 'giant' || a.bodyType === 'titan' || a.bodyType === 'colossal') &&
          len2d(a.x - u.x, a.y - u.y) <= 2.5) { anchored = true; break; }
    }
    const anchorMult = anchored ? 0.5 : 1;
    for (const o of this.units) {
      if (o === u || !o.alive || o.side !== u.side) continue;
      const dd = len2d(o.x - u.x, o.y - u.y);
      // 分离距离按双方受击半径之和：巨躯真的占地方（视觉即判定）
      const sep = (u.hitRadius + o.hitRadius) * 1.6;
      if (dd < sep && dd > 0) {
        // 体型「压迫」：giant/titan 完全免疫被推开（碾压级质量），obese 厚皮仅一半，colossal 仅轻微滑动
        // v2.9 重击霸体：重击出手窗口内身体稳如磐石，同样不被推开（heavyArmorUntil 优先于体型）
        const heavyArmor = (u.heavyArmorUntil ?? 0) > this.time;
        const push = (heavyArmor ? 0
          : u.bodyType === 'giant' || u.bodyType === 'titan' ? 0
          : u.bodyType === 'obese' ? 0.15
          : u.bodyType === 'colossal' ? 0.08 : 0.3) * anchorMult;
        nx += ((u.x - o.x) / dd) * push;
        ny += ((u.y - o.y) / dd) * push;
      }
    }
    // v2.9.3 分离推挤后二次碰撞修正：拥挤场景（如八角笼 3×3 塞 12 个单位）里
    // push 会把单位挤进墙/水——回退到可行走方向，防止单位被挤进岩浆卡死
    if (!this.isWalkable(nx, ny)) {
      if (this.isWalkable(nx, u.y)) ny = u.y;
      else if (this.isWalkable(u.x, ny)) nx = u.x;
      else { nx = u.x; ny = u.y; }
    }
    const ox = u.x, oy = u.y;
    u.x = clamp(nx, 0.6, this.W - 0.6);
    u.y = clamp(ny, 0.6, this.H - 0.6);
    // v2.9.6 战后评价统计：累计本 tick 实际移动距离
    u.moveDist = (u.moveDist ?? 0) + len2d(u.x - ox, u.y - oy);
  }

  // ══ v1.6 角色特性运行时（开发文档附录 A.1）════════════════════════════
  // 设计纪律：所有钩子只读 sim 内部状态与种子 RNG，不引入 Math.random，
  // 否则同一 seed 的回放会分叉。特性只挂在英雄身上，召唤物/敌人不带 traitId。

  /** 攻击方特性对本次伤害的乘子（致命 / 禁锢 / 速射） */
  private traitOutMult(u: Unit | undefined, target: Unit): number {
    if (!u?.traitId) return 1;
    let m = 1;
    // 致命：残血目标增伤——把「收割」变成可感知的角色定位而非纯数值
    if (u.traitId === 'lethal' && target.hp < target.maxHp * TRAIT_CFG.lethalThreshold) {
      m *= 1 + TRAIT_CFG.lethalBonus;
    }
    // 禁锢：对被控/被减速目标增伤（自己的技能会挂减速，形成自循环）
    if (u.traitId === 'shackle') {
      const held = target.rootUntil > this.time || target.stunUntil > this.time
        || (target.slowUntil ?? 0) > this.time;
      if (held) m *= 1 + TRAIT_CFG.shackleBonus;
    }
    // 速射：连续打同一目标的叠层（层数在 basicAttack 里维护）
    if (u.traitId === 'volley' && u.lastHitTargetId === target.id) {
      m *= 1 + TRAIT_CFG.volleyPerStack * Math.min(u.traitStacks ?? 0, TRAIT_CFG.volleyMaxStacks);
    }
    return m;
  }

  /** 受击方特性钩子（在扣血之后、死亡判定之前调用） */
  private traitOnHit(target: Unit, dmg: number, type: Unit['damageType'], attacker?: Unit) {
    // 大心脏 / 时空拓印：累计窗口内受伤（供 tick 里的 4s/3s 窗口判定）。
    // 放在 early-return 之前：即便这一击致命，累计也不影响（窗口会在下次评估时重置）。
    if (dmg > 0 && (target.traitId === 'heart' || target.traitId === 'spacetime')) {
      if (target.traitId === 'heart') {
        target.heartLoss = (target.heartLoss ?? 0) + dmg;
        // v2.9.x 大心脏受伤累计：克制小红环，不叠满屏
        this.emit('ring', target.x, target.y, TRAIT_VFX.heart!.color, 0.26, { r: target.hitRadius * 1.3, alphaFrom: 0.6, alphaTo: 0 });
      } else {
        target.stLoss = (target.stLoss ?? 0) + dmg;
        this.emit('rift', target.x, target.y, TRAIT_VFX.spacetime!.color, 0.26, { r: target.hitRadius * 1.2, alphaFrom: 0.6, alphaTo: 0 });
      }
    }
    if (!target.traitId || target.hp <= 0) return;
    // v3.0 重做「势能」：攻速层不再受击清空。旧版「受击清零」逼玩家均养保命，
    // 与突击战士「主养反杀」定位冲突；改为技能吸血层仅在脱战时衰减（见 tick 主循环）。

    // 坚壁：每 5 次受击结一层护盾
    if (target.traitId === 'bulwark') {
      const n = (target.traitStacks ?? 0) + 1;
      if (n >= TRAIT_CFG.bulwarkHitsPerShield) {
        target.traitStacks = 0;
        const s = target.maxHp * TRAIT_CFG.bulwarkShieldPct;
        target.shield += s;
        this.emit('bubble', target.x, target.y, '#6fd3ff', 0.45, { r: target.hitRadius * 1.8 });
        this.floaters.push({
          x: target.x, y: target.y - 0.7, text: `坚壁 +${Math.round(s)}`, color: '#6fd3ff', ttl: 0.9,
        });
      } else {
        target.traitStacks = n;
      }
    }

    // 法障：反弹魔法伤害。用直接扣血而非 applyDamage —— 两个法障单位互殴会无限递归
    if (target.traitId === 'spellbreak' && type === 'magic' && attacker?.alive && dmg > 0) {
      const r = dmg * TRAIT_CFG.spellbreakReflect;
      attacker.hp -= r;
      attacker.flash = 0.12;
      this.emit('beam', target.x, target.y, '#b07bff', 0.22, {
        tx: attacker.x, ty: attacker.y, r: 0.15, thickness: 2,
      });
      this.floaters.push({
        x: attacker.x, y: attacker.y - 0.3, text: String(Math.round(r)), color: '#b07bff', ttl: 0.7,
      });
      this.killIfDown(attacker, target);
    }
  }

  /**
   * 反"堆一人"两条被动的统一掷骰：基础概率（vX 起不再乘集中度闸门，
   * 用户确认不需要回避均衡队——均衡队也会遇到死士，触发只由层深+概率+每场上限决定）。
   * 仍走 this.rng 种子流，同 seed 回放一致。
   */
  private focusRoll(baseP: number): boolean {
    return this.rng() < baseP;
  }

  /** 统一死亡结算（含魔刃击杀回响）。反弹伤害也要走这里，否则会出现 hp<0 的活人 */
  private killIfDown(u: Unit, killer?: Unit) {
    // 归来者：每场可死一次 → 原地复活并永久成长（带出）。拦截在正常死亡结算之前，
    // 此时 u.hp<=0 但 u.alive 仍为 true（死亡由本函数统一置 false）。
    if (u.side === 'ally' && u.traitId === 'returner' && !u.isSummon && u.heroUid
        && (u.returnerUsed ?? 0) < 1) {
      u.returnerUsed = 1;
      // 永久成长 4%（带出）：随机 1 项非防御二级属性 +4%（creditKillGrowth mul=4 → 二级 +4%）
      const pk = pick(this.rng, PRIMARY_KEYS) as keyof HeroGrowth['primary'];
      const sk = pick(this.rng, GROWTH_STAT_KEYS) as GrowthStatKey;
      const SK_CN: Record<string, string> = { hp: '生命', pDmg: '物伤', mDmg: '法伤', heal: '治疗' };
      this.creditKillGrowth(u.heroUid, pk, sk, TRAIT_CFG.returnerPermanentPct);
      // 复活：体型+30% / 射程+2 / 攻速+15% / 移速+15% / 每秒流失 8%
      u.sizeScale = (u.sizeScale ?? 1) * (1 + TRAIT_CFG.returnerBodyPct);
      u.rangeBonus = (u.rangeBonus ?? 0) + TRAIT_CFG.returnerRange;
      u.derived.atkSpeed *= 1 + TRAIT_CFG.returnerAsPct;
      u.derived.moveSpeed *= 1 + TRAIT_CFG.returnerMsPct;
      u.hp = u.maxHp * TRAIT_CFG.returnerReviveHpPct;
      u.alive = true;
      u.returnerDrain = true;
      this.deadAllies.delete(u.heroUid);
      this.pushLog(`${u.name} 归来者复活！永久成长 +${TRAIT_CFG.returnerPermanentPct}%${SK_CN[sk]}，体型+30% 射程+2 攻速/移速+15%`);
      this.emit('rift', u.x, u.y, '#ffd27a', 0.5, { r: u.hitRadius * 2 });
      this.floaters.push({ x: u.x, y: u.y - 0.9, text: '归来！', color: '#ffd27a', ttl: 1.3 });
      return;
    }

    if (u.hp > 0 || !u.alive) return;
    u.alive = false;
    u.deadAt = this.time; // v2.7：死亡时刻 → 渲染层驱动倒下动画

    // v1.8.4 兽类「自爆」：死亡时对周围 2 格非己方单位造成 35% 最大生命真实伤害（真伤无视抗性与免疫）
    if (u.side === 'enemy' && u.beastTrait === 'selfdestruct') {
      const R = 2;
      const dmg = u.maxHp * 0.35;
      for (const t of this.units) {
        if (t === u || !t.alive || t.side === u.side || t.isBuilding) continue;
        if (len2d(t.x - u.x, t.y - u.y) <= R) this.dealSkill(u, t, dmg, 'physical', false, true);
      }
      this.emit('ring', u.x, u.y, '#ff5a3c', 0.55, { r: R * 0.9 });
      this.floaters.push({ x: u.x, y: u.y - 0.9, text: '自爆！', color: '#ff5a3c', ttl: 1.0 });
      this.pushLog(`${u.name} 自爆！周围 2 格受到 ${Math.round(dmg)} 真实伤害`);
    }
    // v1.8.4 兽类「下一站」：母体死亡 → 存活小个体获得复仇目标（击杀母体者）
    if (u.beastTrait === 'nest') {
      for (const b of this.units) {
        if (b.isBeastling && b.parentId === u.id && b.alive && !b.vengeTargetId) {
          b.vengeTargetId = killer?.id;
        }
      }
    }
    // v2.2 铁人无尽：记录本场阵亡的友方副本，供 BattleScreen 在胜利后永久移除。
    if (u.side === 'ally' && !u.isSummon && u.heroUid) {
      this.deadAllies.add(u.heroUid);
      // 愤怒燃烧者：每有 1 名友军英雄阵亡，存活的 fury 双攻&攻速 +10%（独立乘，可叠）
      for (const a of this.units) {
        if (a.side === 'ally' && a.alive && !a.isSummon && a.traitId === 'fury' && a.id !== u.id) {
          a.derived.pDmg *= 1 + TRAIT_CFG.furyPerDeathPct;
          a.derived.mDmg *= 1 + TRAIT_CFG.furyPerDeathPct;
          a.derived.atkSpeed *= 1 + TRAIT_CFG.furyPerDeathPct;
          this.floaters.push({
            x: a.x, y: a.y - 0.9,
            text: `怒火 +${Math.round(TRAIT_CFG.furyPerDeathPct * 100)}%`, color: '#ff7a4d', ttl: 1.0,
          });
        }
      }
      this.pushLog(`${u.name} 阵亡 → 友军「愤怒燃烧者」怒火 +${Math.round(TRAIT_CFG.furyPerDeathPct * 100)}%`);
    }
    // 召唤物消散用召唤紫，避免玩家误判"死了个队友"（美术 §7.4.3）
    const deathColor = u.isSummon ? '#9b7bff' : '#ff6a6a';
    this.emit('ring', u.x, u.y, deathColor, 0.4, { r: u.hitRadius * 1.5 });
    this.emitAudio({ id: u.side === 'ally' ? 'death_ally' : 'death_enemy', x: u.x, arenaW: this.W });

    // v1.7 §2（改）：击杀成长。击杀者随机 100%~150%，助攻者（其他对该敌造成过伤害的友方英雄）随机 30%~50%。
    // 基础值：随机一项核心属性 +0.5、随机一项二级属性 +1%（与成长药剂同源，共用 store 合并逻辑）。
    // 只在「敌方单位被友方击杀」时记账；友方召唤物无 heroUid，故不会抢功也不会被记助攻。
    // 随机倍率全部走 this.rng（种子流），保证同 seed 回放一致。
    if (u.side === 'enemy' && killer?.side === 'ally' && killer.heroUid) {
      const pk = pick(this.rng, PRIMARY_KEYS) as keyof HeroGrowth['primary'];
      const sk = pick(this.rng, GROWTH_STAT_KEYS) as GrowthStatKey;
      const PK_CN: Record<string, string> = { con: '强壮', str: '力量', agi: '敏捷', int: '智力' };
      const SK_CN: Record<string, string> = { hp: '生命', pDmg: '物伤', mDmg: '法伤', heal: '治疗' };

      // 击杀者：随机 100%~150%
      const kMul = 1.0 + this.rng() * 0.5;
      this.creditKillGrowth(killer.heroUid, pk, sk, kMul);
      this.floaters.push({
        x: killer.x, y: killer.y - 0.9,
        text: `击杀成长 +${PK_CN[pk]}${(0.5 * kMul).toFixed(1)}/${SK_CN[sk]}+${(kMul * 100).toFixed(0)}%`,
        color: '#7ee08a', ttl: 1.1,
      });
      this.pushLog(`${killer.name} 击杀 ${u.name} → 成长 ${PK_CN[pk]}+${(0.5 * kMul).toFixed(1)}, ${SK_CN[sk]}+${(kMul * 100).toFixed(0)}%`);

      // 助攻者：随机 30%~50%（其他对该敌造成过伤害的友方英雄，排除击杀者本身）
      const dmgSet = this.damagers.get(u.id);
      if (dmgSet) {
        for (const aid of dmgSet) {
          if (aid === killer.heroUid) continue;
          const aMul = 0.3 + this.rng() * 0.2;
          this.creditKillGrowth(aid, pk, sk, aMul);
          this.pushLog(`${this.heroName(aid)} 助攻 ${u.name} → 成长 ${PK_CN[pk]}+${(0.5 * aMul).toFixed(1)}, ${SK_CN[sk]}+${(aMul * 100).toFixed(0)}%`);
        }
      }

      // 成长者：自身击杀/助攻 → 全属性 +10% 独立乘 + 体型增长 0.2%~1%（随机）
      const growerUids = new Set<string>();
      if (killer.traitId === 'grower') growerUids.add(killer.heroUid);
      if (dmgSet) {
        for (const aid of dmgSet) {
          const g = this.units.find((x) => x.heroUid === aid && x.alive && x.traitId === 'grower');
          if (g) growerUids.add(aid);
        }
      }
      for (const gid of growerUids) {
        const g = this.units.find((x) => x.heroUid === gid);
        if (!g || !g.alive) continue;
        g.derived.pDmg *= 1 + TRAIT_CFG.growerRampPct;
        g.derived.mDmg *= 1 + TRAIT_CFG.growerRampPct;
        g.derived.atkSpeed *= 1 + TRAIT_CFG.growerRampPct;
        g.derived.moveSpeed *= 1 + TRAIT_CFG.growerRampPct;
        // vX 体型增长曲线（按当前体型格数分层，抑制极端体型出现）：
        //  <0.5格 ×0.2；0.5~1格 ×0.8；1~3格 ×1.2；>3格 ×0.01；>3.2格 ×0.001
        const curSize = hitRadiusOf(g.bodyType) * (g.sizeScale ?? 1); // 当前体型半径（格）
        const sizeCurve = curSize < 0.5 ? 0.2 : curSize < 1 ? 0.8 : curSize < 3 ? 1.2 : curSize < 3.2 ? 0.01 : 0.001;
        const b = (TRAIT_CFG.growerBodyMin + this.rng() * (TRAIT_CFG.growerBodyMax - TRAIT_CFG.growerBodyMin)) * sizeCurve;
        g.sizeScale = (g.sizeScale ?? 1) * (1 + b);
        this.floaters.push({
          x: g.x, y: g.y - 0.9,
          text: `成长 +${Math.round(TRAIT_CFG.growerRampPct * 100)}%`, color: '#7ee08a', ttl: 1.0,
        });
      }
      if (growerUids.size) {
        this.pushLog(`成长者 ×${growerUids.size} 击杀/助攻 ${u.name} → 全属性 +${Math.round(TRAIT_CFG.growerRampPct * 100)}% 体型增长`);
      }
    }

    // 反"堆一人"·捆仙绳解除：被封印的任一方死亡 → 另一方立刻脱困。
    // 这是"除非两人中任意角色被击杀才解除"的落点；放在死亡处理里而不是 tick 轮询，
    // 既零额外开销，也保证解除时刻与死亡时刻同一 tick（回放无歧义）。
    if (u.shackleWith) {
      const mate = this.byId.get(u.shackleWith ?? '');
      if (mate) {
        mate.stunUntil = Math.min(mate.stunUntil, this.time);
        mate.rootUntil = Math.min(mate.rootUntil, this.time);
        mate.shackleWith = undefined;
        this.pushLog(`${u.name} 倒下 → ${mate.name} 挣脱捆仙绳`);
        this.emit('rift', mate.x, mate.y, '#ffe08a', 0.3, { r: 0.7, alphaFrom: 0.9, alphaTo: 0 });
      }
      u.shackleWith = undefined;
    }

    // 反"堆一人"·同归于尽：带 front 标记的前排敌死亡时，按概率带走我方最强英雄。
    // 双向死（敌人也死），本质"用一个杂兵换你核心"——堆一人 = 把核心暴露在换命池里。
    // 概率乘集中度闸门：均衡队闸门=0，这条被动对他们等于不存在。
    if (u.side === 'enemy' && u.focusRole === 'front' && this.frontMutualCount < this.enemyFocus.maxFrontPerBattle) {
      if (this.focusRoll(this.enemyFocus.frontMutualP)) {
        const strongest = findStrongestAlly(this.units);
        if (strongest) {
          this.frontMutualCount++;
          this.pushLog(`${u.name} 同归于尽 → 拖走 ${strongest.name}`);
          this.emitAudio({ id: 'cc_stun', x: strongest.x, arenaW: this.W });
          this.floaters.push({ x: strongest.x, y: strongest.y - 0.9, text: '同归于尽', color: '#ff6a6a', ttl: 1.3 });
          // 必须先清盾清血：killIfDown 的语义是"已经倒下就结算死亡"，
          // 对满血单位直接调用会在首行 hp>0 就 return —— 这是同归于尽真正"带走人"的关键。
          strongest.shield = 0;
          strongest.hp = 0;
          this.killIfDown(strongest, u);
        }
      }
    }

    // 魔刃：击杀回血 + 立即削减冷却，让「连杀」成为可滚雪球的节奏
    if (killer?.alive && killer.traitId === 'bloodedge' && !u.isSummon) {
      const h = killer.maxHp * TRAIT_CFG.bloodedgeHealPct;
      killer.hp = Math.min(killer.maxHp, killer.hp + h);
      killer.skillCd = Math.max(0, killer.skillCd - TRAIT_CFG.bloodedgeCdCut);
      // vX 被动·本局永久成长：每次击杀永久提升物理攻击 +10%、魔法伤害 +20%（叠加，仅本场生效）
      killer.derived.pDmg *= 1 + TRAIT_CFG.bloodedgePdmgPerKill;
      killer.derived.mDmg *= 1 + TRAIT_CFG.bloodedgeMdmgPerKill;
      this.emit('ring', killer.x, killer.y, '#ff5f8a', 0.35, { r: killer.hitRadius * 1.6 });
      this.floaters.push({
        x: killer.x, y: killer.y - 0.7, text: `魔刃 +${Math.round(h)}`, color: '#ff5f8a', ttl: 0.9,
      });
      this.pushLog(`${killer.name} 斩杀 ${u.name} → 魔刃回响（物攻+10% 法伤+20%）`);
    }

    // v2.9.8 女娲「造化·重铸」③：本人或召唤物击杀敌方单位 → 大招冷却清零并即刻再放。
    // 放在死亡结算最后：此时 u.alive 已置 false，shouldCast 里的存活敌人数是击杀后的真实值。
    if (u.side === 'enemy' && killer?.alive) this.nuwaKillRecast(killer);
  }

  /** v1.7 §2：取走本场击杀成长账本（按 heroUid 索引），供 BattleScreen 写回 store */
  getKillGains(): Record<string, HeroGrowth> {
    const out: Record<string, HeroGrowth> = {};
    for (const [uid, g] of this.killGains) out[uid] = g;
    return out;
  }

  /** v1.7 §2（改）：把一次击杀成长按倍率 mul 缩放基础值（核心 +0.5 / 二级 +1%）累加到指定 heroUid 账本 */
  private creditKillGrowth(uid: string, pk: keyof HeroGrowth['primary'], sk: GrowthStatKey, mul: number) {
    const prev = this.killGains.get(uid) ?? { primary: {}, secondaryPct: {} };
    prev.primary = { ...prev.primary, [pk]: (prev.primary?.[pk] ?? 0) + 0.5 * mul };
    prev.secondaryPct = { ...prev.secondaryPct, [sk]: (prev.secondaryPct?.[sk] ?? 0) + 1 * mul };
    this.killGains.set(uid, prev);
  }

  /** 按 heroUid 反查战场单位名（助攻日志用；找不到回落勇者） */
  private heroName(uid: string): string {
    const u = this.units.find((x) => x.heroUid === uid);
    return u ? u.name : '勇者';
  }

  /** v2.2 铁人无尽：取走本场阵亡的友方副本 uid（供 BattleScreen 在胜利后永久移除） */
  getDeadAllyUids(): string[] {
    return [...this.deadAllies];
  }

  // v2.9.3 属性衰减：攻速/移速堆叠过高时收益锐减，防止数值无限膨胀。
  // 攻速基准 100：≤2 倍(200) 全额；200~240 超出部分 ×10%；>240 超出部分 ×1%（最多 ≈204）。
  // 暂时的攻速 buff（势能 momentum 乘区等）不参与衰减——衰减只作用于基础合成值。
  private dampAtkSpeed(as: number): number {
    if (as <= 200) return as;
    if (as <= 240) return 200 + (as - 200) * 0.1;
    return 204 + (as - 240) * 0.01;
  }

  // 移速衰减：以单位基础移速（u.baseMove）为基准，≤1.5× 全额；1.5~2.2× 超出部分 ×40%；
  // >2.2× 超出部分 ×10%。暂时的移速 buff（滑步 glide 等）不衰减（在衰减结果上乘）。
  private dampMoveSpeed(u: Unit): number {
    const base = Math.max(1, u.baseMove ?? 1);
    const ms = u.derived.moveSpeed;
    const t1 = base * 1.5, t2 = base * 2.2;
    if (ms <= t1) return ms;
    if (ms <= t2) return t1 + (ms - t1) * 0.4;
    return t1 + (t2 - t1) * 0.4 + (ms - t2) * 0.1;
  }

  /** 实际攻击间隔（秒）。势能层数在这里兑现为攻速 */
  private attackInterval(u: Unit): number {
    let as = this.dampAtkSpeed(u.derived.atkSpeed) * (u.tileSpdMul ?? 1); // v2.4.4 水域攻速 −12%
    if (u.traitId === 'momentum') {
      const st = Math.min(u.traitStacks ?? 0, TRAIT_CFG.momentumMaxStacks);
      as *= 1 + (TRAIT_CFG.momentumPerStack * st) / 100; // 暂时的攻速 buff：不衰减
    }
    return 1 / Math.max(0.1, as / 100);
  }

  // v2.9：轻击主节奏间隔 = 基础间隔 × (130 / 个人轻击攻速)。
  // lightAs=130 → 与旧节奏一致；160 → 快 ~23%。装备/势能/天气攻速照常叠加（走 attackInterval）。
  private lightInterval(u: Unit): number {
    return this.attackInterval(u) * (130 / (u.lightAs ?? 130));
  }

  // v2.9：重击序列后的休息期 = 基础间隔 × (100 / 个人重击攻速)。
  // heavyAs=40 → 休息 2.5s（=每秒 0.4 次重击），26~57 档 → 1.75~3.85s。
  private heavyLockDuration(u: Unit): number {
    return this.attackInterval(u) * (100 / Math.max(10, u.heavyAs ?? 40));
  }

  // v2.9 轻/重击节奏判定（performAttack 内联）：
  //   ① 重击序列进行中（heavyBurst>0 且上次是重击）→ 本次继续重击（连打 1~2 次）；
  //   ② 否则 combo 达到阈值且不在休息期 → 触发新重击序列（combo 归零）；
  //   ③ 否则轻击，combo+1。
  // 主节奏冷却统一用轻击攻速；重击序列结束后进入休息期（heavyLock = 重击攻速换算）。

  /**
   * 轻/重击节奏判定（纯状态机，不结算效果）。
   * 抽出来的理由：v2.9.8 奶妈把「普攻」改成了「治疗」，但节奏必须和其他职业完全一致
   * ——如果治疗普攻自己再写一份 combo/heavyBurst 逻辑，两份状态机迟早会漂移。
   */
  private rollHeavy(u: Unit): boolean {
    let heavy = false;
    if ((u.heavyBurst ?? 0) > 0 && u.isHeavyHit) {
      // ① 重击序列连击
      heavy = true;
      u.heavyBurst = (u.heavyBurst ?? 0) - 1;
      if (u.heavyBurst <= 0) u.heavyLock = this.time + this.heavyLockDuration(u); // 序列结束→休息
    } else if ((u.heavyLock ?? 0) <= this.time && (u.combo ?? 0) >= (u.heavyAt ?? 5)) {
      // ② 触发新重击序列（首击）
      heavy = true;
      u.combo = 0;
      u.heavyBurst = (u.heavyBurstCount ?? 1) - 1; // 剩余连击次数
      u.heavyArmorUntil = this.time + 0.45;        // 重击霸体窗口（免疫被推开）
      if (u.heavyBurst <= 0) u.heavyLock = this.time + this.heavyLockDuration(u);
    } else {
      // ③ 轻击
      u.combo = (u.combo ?? 0) + 1;
    }
    u.isHeavyHit = heavy;
    return heavy;
  }

  /** 一次普攻收尾：写主节奏冷却（轻击攻速）+ 预测下一次是否重击 */
  private finishAttackRhythm(u: Unit) {
    u.cd = this.lightInterval(u);
    // v2.9.1 重击预告：预测"下一次普攻将是重击"（渲染层画蓄力金光圈，让玩家预知）
    u.heavyReady =
      ((u.heavyBurst ?? 0) > 0 && u.isHeavyHit) ||
      ((u.heavyLock ?? 0) <= this.time && (u.combo ?? 0) >= (u.heavyAt ?? 5));
  }

  /** 轻/重击攻击统一入口：判定节奏 → 动画 → 结算 → 主节奏冷却（轻击攻速） */
  private performAttack(u: Unit, target: Unit) {
    const heavy = this.rollHeavy(u);
    this.attackAnim(u);
    // v2.9.9 奶妈：只有「重击」这一拍转成群疗，轻击照常打敌人（弱普攻）。
    // v2.9.8 曾把轻击也改成治疗，实测把队伍血线长期托在 85%+，
    // 既让嘲讽等低血触发机制彻底失效，也让治疗职业变成无脑站桩泵。
    // 现在治疗频率降到约 1/6（combo 满才出重击），奶量回落到原来的一半左右，
    // 「什么时候能奶到」重新变成一个由节奏决定、玩家看得见的事件。
    if (this.isHealAttacker(u) && heavy && this.pickHealTarget(u)) {
      this.healBurst(u);
    } else {
      this.basicAttack(u, target, heavy);
    }
    this.finishAttackRhythm(u);
    // v2.9.8 女娲「共鸣」②：本人或其召唤物的每一次普攻，都为女娲削 1s 大招冷却
    this.nuwaResonate(u);
  }

  /**
   * v2.9.8：返回该单位对应的「女娲本体」——
   * 传入女娲自己 → 返回自己；传入她的召唤物 → 返回主人；其余情况返回 null。
   * 只认友方：敌方召唤系单位不吃这套强化（这是英雄专属加强，不是全局机制）。
   */
  private nuwaOwnerOf(u: Unit): Unit | null {
    if (u.side !== 'ally') return null;
    if (!u.isSummon) {
      return u.alive && u.skill.id === NUWA_SKILL_ID ? u : null;
    }
    if (!u.casterHeroUid) return null;
    const owner = this.units.find(
      (x) => x.alive && !x.isSummon && x.heroUid === u.casterHeroUid && x.skill.id === NUWA_SKILL_ID,
    );
    return owner ?? null;
  }

  /** v2.9.8 共鸣②：普攻削减女娲大招冷却 1s（冷却已就绪时不再空转累计） */
  private nuwaResonate(u: Unit) {
    const owner = this.nuwaOwnerOf(u);
    if (!owner || owner.skillCd <= 0) return;
    owner.skillCd = Math.max(0, owner.skillCd - NUWA_ATTACK_CDR);
    // 每次普攻在女娲身上汇聚一圈紫气：不发飘字（3 召唤物 ≈ 5 次/秒，会把伤害数字淹没）
    this.emit('ring', owner.x, owner.y, '#9b7bff', 0.18, { r: owner.hitRadius * 1.25, alphaFrom: 0.55, alphaTo: 0 });
    if (owner.skillCd <= 0) {
      this.floaters.push({ x: owner.x, y: owner.y - 1.0, text: '造化已满', color: '#c9b0ff', ttl: 0.8 });
    }
  }

  /**
   * v2.9.8 共鸣③：女娲 / 其召唤物击杀敌人 → 大招冷却清零并立刻再放一次。
   * 放在 killIfDown 尾部调用。summon 技能本身不造成伤害，故不会与 killIfDown 递归。
   */
  private nuwaKillRecast(killer: Unit) {
    const owner = this.nuwaOwnerOf(killer);
    if (!owner) return;
    owner.skillCd = 0;
    if (!this.shouldCast(owner)) return; // 场上已无敌人 → 不放空炮
    this.emit('rift', owner.x, owner.y, '#c9b0ff', 0.35, { r: 0.9, alphaFrom: 0.9, alphaTo: 0 });
    this.floaters.push({ x: owner.x, y: owner.y - 1.1, text: '造化·重铸', color: '#c9b0ff', ttl: 0.9 });
    this.pushLog(`${killer.name} 斩获人头 → ${owner.name} 造化重铸，立即再召`);
    this.castSkill(owner);
  }

  // ══ v2.9.9 奶妈「重击转群疗」（需求：重击和大招回血，普攻仍是弱普攻）═════════
  // 版本演进：v2.9.8 之前奶妈是全场唯一站桩发呆的单位（tick 里直接 continue）；
  // v2.9.8 把轻击+重击全改成治疗，结果治疗过强（血线常驻 85%+）；
  // v2.9.9 取中间态——她走和所有人一样的索敌/推进/普攻节奏，
  //   · 轻击 → 打敌人，但伤害按 HEALER_LIGHT_DMG_MULT 削弱（她不该抢输出位）
  //   · 重击 → 转为群疗（约每 6 拍 1 次，治疗从"常驻"变回"有节奏的事件"）
  //   · 大招 → 群体治疗，保持不变
  // 全队满血时重击不空放：直接打敌人，不浪费这一拍。

  /** 是否走「重击转治疗」的分流：仅我方非召唤的治疗职业 */
  private isHealAttacker(u: Unit): boolean {
    return u.subclass === 'healer' && u.side === 'ally' && !u.isSummon;
  }

  /** 治疗射程：沿用其普攻射程（治疗职业 5 格），逻辑判定与特效尺寸共用同一个数 */
  private healRangeOf(u: Unit): number {
    return this.attackRangeOf(u);
  }

  /**
   * 选疗目标：血量百分比最低的友方主力（同时用作「本次重击值不值得转治疗」的判据）。
   * 召唤物/建筑不占治疗资源——它们本就是消耗品，把奶量喂给 18s 后自然消散的石魂卫是纯亏。
   * 全队满血时：有「恩泽」（溢疗转盾）才继续奶（溢出真能变成护盾），否则返回 null → 该拍改打敌人。
   */
  private pickHealTarget(u: Unit): Unit | null {
    const pool = this.alive(u.side).filter((a) => !a.isSummon && !a.isBuilding);
    if (!pool.length) return null;
    const best = pool.reduce((b, c) => (c.hp / c.maxHp < b.hp / b.maxHp ? c : b));
    if (best.hp >= best.maxHp) return u.traitId === 'grace' ? best : null;
    return best;
  }

  /**
   * 重击群疗结算：以奶妈为心、治疗射程为半径的一圈群疗。
   * 单体系数打 6 折，命中人数越多总量越高——让「站位聚拢」成为一个有收益的选择。
   * 倍率沿用伤害重击的同源扰动（atkRng 独立流，不污染主随机流）：230%~360%。
   */
  private healBurst(u: Unit) {
    const base = u.derived.heal;
    const mult = 2.3 + this.atkRng() * 1.3;
    const R = this.healRangeOf(u);
    const pool = this.alive(u.side).filter((a) => !a.isBuilding && dist(a, u) <= R + a.hitRadius);
    for (const a of pool) this.applyHeal(a, base * mult * HEAL_BURST_SPLIT, u);
    this.emit('light', u.x, u.y, '#7fe3b0', 0.5, { r: R, alphaFrom: 0.9, alphaTo: 0 });
    this.emit('ring', u.x, u.y, '#aef0c0', 0.35, { r: R * 0.9, alphaFrom: 0.7, alphaTo: 0 });
    this.floaters.push({
      x: u.x, y: u.y - 0.9, text: `回春·重击 ×${pool.length}`, color: '#aef0c0', ttl: 0.6,
    });
    this.pushLog(`${u.name} 回春重击 → ${pool.length} 名队友受疗`);
  }

  /** 召唤位上限（军团 +1） */
  private maxSummonsFor(u: Unit): number {
    return MAX_SUMMONS + (u.traitId === 'legion' ? TRAIT_CFG.legionExtraSummon : 0);
  }

  // v2.9.14：层内 30s 后的「终局衰减」——物/魔减伤每秒 −2pp，爆伤每秒 +10pp。
  // 纯 sim.time 函数，确定性零影响（与播放速度无关，按游戏秒计；双方单位同受）。
  private lateDecay(): number { return Math.max(0, this.time - 30); }
  private effResist(target: Unit, type: Unit['damageType']): number {
    const base = type === 'magic'
      ? target.derived.mResist
      : type === 'physical'
        ? target.derived.pResist
        : (target.derived.pResist + target.derived.mResist) / 2;
    return Math.max(0, base - 2 * this.lateDecay());
  }
  private effCritDmg(u: Unit): number {
    return u.derived.critDmg + 10 * this.lateDecay();
  }

  private applyDamage(
    target: Unit, amount: number, type: Unit['damageType'], crit: boolean,
    attacker?: Unit, heavy = false, trueDmg = false,
  ) {
    // v1.8.4 兽类「双免轮换」：immunity 特性单位按当前相位免疫物理/魔法（真伤与混合伤害除外）
    if (!trueDmg && target.beastTrait === 'immunity' && (type === 'physical' || type === 'magic')) {
      const ph = (target.immunityPhase ?? 0) === 1;
      const mh = (target.immunityPhase ?? 0) === 2;
      if ((type === 'physical' && ph) || (type === 'magic' && mh)) {
        this.floaters.push({ x: target.x, y: target.y - 0.3, text: '免疫', color: '#7ad0ff', ttl: 0.7 });
        this.pushLog(`${target.name} 免疫${type === 'physical' ? '物理' : '魔法'}伤害`);
        return; // 完全免伤：不累计受击、不触发受击特性
      }
    }
    const resist = trueDmg ? 0 : this.effResist(target, type);
    // v2.9.3 减伤封顶 90%：抗性 + 减伤 buff（天气/体型稳桩/难瞄）总减伤不超过 90%。
    // 攻击方特性增伤（致命/禁锢/速射）在封顶之后乘——穿透减伤上限，不被封顶抬升。
    let dmgMult = (1 - resist / 100) * (target.derived.dmgTakenMult ?? 1);
    // ── 体型特性（需求 §5.2.1）──
    let dodged = false;
    // 精巧/侏儒「难瞄/极难瞄」：距攻击者 ≥ 4 格时，受到的远程伤害 −8%/−12%（v2.8 gnome 更强）
    if ((target.bodyType === 'petite' || target.bodyType === 'gnome') && attacker) {
      const far = dist(attacker, target) >= 4;
      const ranged = SUBCLASS_INFO[attacker.subclass].attackRange > 3;
      if (far && ranged) {
        dodged = true;
        dmgMult *= target.bodyType === 'gnome' ? 0.88 : 0.92;
      }
    }
    // 魁梧「稳桩」：上一次大额受伤触发的 1.5s 减伤窗口内 −10%
    if (target.braceUntil && target.braceUntil > this.time) dmgMult *= 0.90;
    dmgMult = Math.max(0.10, dmgMult); // 减伤 buff 上限 90%（下限乘子 0.10）
    dmgMult *= target.tileDmgTaken ?? 1; // v2.4.4 掩体(×0.85)/王座(×0.80) 等效防御加成
    const outMult = this.traitOutMult(attacker, target); // 攻击方特性：穿透减伤封顶
    dmgMult *= outMult;
    // v2.9.x 特性触发特效（需求③）：增伤特性实际生效的那一击，在目标身上点一个克制小特效。
    // 纯 emit，不碰数值/parity；outMult===1 表示未触发（如致命目标血线不够），不画。
    if (outMult > 1 && attacker?.traitId && TRAIT_VFX[attacker.traitId]) {
      const fx = TRAIT_VFX[attacker.traitId]!;
      this.emit(fx.shape, target.x, target.y, fx.color, 0.3, { r: target.hitRadius * 1.4, alphaFrom: 0.8, alphaTo: 0 });
    }
    let dmg = amount * dmgMult;

    dmg = Math.min(dmg, 2147483647); // 硬上限 2^31-1（需求 6.3）。写字面量而非 2**31-1：
                                     // `**` 在规范里等价于 Math.pow，属 implementation-approximated
    if (target.shield > 0) {
      const a = Math.min(target.shield, dmg);
      target.shield -= a;
      dmg -= a;
    }
    target.hp -= dmg;
    // v2.9.6 战后评价统计：造成伤害累计到攻击者，承受伤害累计到目标
    if (attacker) attacker.dmgDealt = (attacker.dmgDealt ?? 0) + dmg;
    target.dmgTaken = (target.dmgTaken ?? 0) + dmg;
    target.flashType = type; // v2.4.4 受击类型：供渲染层按物理/魔法/混合/真伤上色
    // v1.7 §2（改）：记录伤害来源（仅友方英雄对敌方单位），供击杀助攻判定。
    if (target.side === 'enemy' && attacker?.side === 'ally' && attacker.heroUid) {
      let set = this.damagers.get(target.id);
      if (!set) { set = new Set(); this.damagers.set(target.id, set); }
      set.add(attacker.heroUid);
    }
    target.flash = 0.12;

    // ── 音频：命中/暴击反馈（音频设计文档 §3；声像由世界 x 决定）──
    // v2.9.14：带上攻击方角色特征（子类×性别），让轻击/重击/暴击音色可辨识。
    const ranged = attacker ? this.attackRangeOf(attacker) > 3 : false;
    const variant = attacker && attacker.gender
      ? { subclass: attacker.subclass, gender: attacker.gender }
      : undefined;
    if (crit) this.emitAudio({ id: 'crit', x: target.x, arenaW: this.W, variant });
    else if (heavy) this.emitAudio({ id: 'hit_heavy', x: target.x, arenaW: this.W, variant });
    else this.emitAudio({ id: ranged ? 'hit_ranged' : 'hit_melee', x: target.x, arenaW: this.W, variant });

    // 魁梧「稳桩」触发判定：单次受伤 ≥ 15% 最大 HP → 后续 1.5s 减伤 10%（抗爆发而非抗平砍）
    if (target.bodyType === 'heavy' && dmg >= target.maxHp * 0.15) {
      target.braceUntil = this.time + 1.5;
    }

    this.floaters.push({
      x: target.x, y: target.y - 0.3,
      // 「难瞄」生效时飘字加 ~ 前缀，提示"被打偏了"（美术 §4.5.4）
      text: (dodged ? '~' : '') + String(Math.round(dmg)),
      color: crit ? '#ffcc4d' : '#ffffff', ttl: 0.8,
    });

    // v1.6 受击方特性（坚壁结盾 / 法障反弹 / 势能清层）
    this.traitOnHit(target, dmg, type, attacker);

    // 成长者：30% 概率秒杀体型比自己小的敌人（仅英雄本体触发；召唤物不参与）
    if (attacker?.traitId === 'grower' && !attacker.isSummon && target.side !== attacker.side
        && this.rng() < TRAIT_CFG.growerInstakillP) {
      const aSize = attacker.hitRadius * (attacker.sizeScale ?? 1);
      const tSize = target.hitRadius * (target.sizeScale ?? 1);
      if (aSize > tSize) {
        target.hp = 0;
        this.pushLog(`${attacker.name} 成长者秒杀体型更小的 ${target.name}`);
        this.emit('ring', target.x, target.y, '#7ee08a', 0.35, { r: target.hitRadius * 1.6 });
      }
    }

    this.killIfDown(target, attacker);
  }

  /** 闪避判定 + 轻捷/灵巧「滑步」联动（需求 §5.2.1；v2.8 slim 进阶） */
  private tryDodge(target: Unit, attacker?: Unit): boolean {
    // 巨灵「巨压」：基础攻击不可被闪避（体型即压迫——闪避在一座山面前没有意义）
    if (attacker?.bodyType === 'giant') return false;
    // v2.9.3 闪避封顶 75%：达到后即使闪避 buff 也不增加额外闪避
    const dodge = Math.min(75, target.derived.dodge);
    if (this.rng() >= dodge / 100) return false;
    // 滑步：奖励已发生的好运（light +20%；slim 进阶 +25%，系数见 move 的 glide 计算）
    if (target.bodyType === 'light' || target.bodyType === 'slim') target.glideUntil = this.time + 0.8;
    target.lastDodgeAt = this.time;
    // v3.0 闪避「残影」表现：成功闪避时本体位置甩出一道短暂残影 + 受击白闪，
    // 让「闪过去了」肉眼可见（此前只有 MISS 飘字，玩家读不到闪避是否发生）。
    target.flash = Math.max(target.flash, 0.18);
    this.emit('trail', target.x - 0.35, target.y, '#bfe0ff', 0.28, {
      tx: target.x + 0.35, ty: target.y, r: target.hitRadius * 1.5, alphaFrom: 0.9, alphaTo: 0,
    });
    this.floaters.push({ x: target.x, y: target.y - 0.3, text: 'MISS', color: '#9fb4d4', ttl: 0.6 });
    this.emitAudio({ id: 'dodge', x: target.x, arenaW: this.W });
    return true;
  }

  private applyHeal(target: Unit, amount: number, healer?: Unit) {
    if (!target.alive) return;
    // 肥胖「厚皮」：受到的治疗效果 +15%（receiver 侧增益；体型底子厚实，奶量更顶用）。
    // 仅放大实际落到的治疗量（HP 增益 / 溢出转盾 / 治疗统计统一走 eff）。
    const eff = target.bodyType === 'obese' ? amount * 1.15 : amount;
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + eff);
    const done = target.hp - before;
    // v2.9.6 战后评价统计：治疗量累计到治疗者
    if (healer) healer.healDone = (healer.healDone ?? 0) + done;
    // v2.9.8：满血目标不再刷「+0」飘字。奶妈改成持续治疗普攻后，
    // 满编满血时会每秒往屏幕上糊好几个 +0，纯噪声（溢疗转盾另有「盾 +N」飘字）
    if (done > 0.5) {
      this.floaters.push({
        x: target.x, y: target.y - 0.3,
        text: '+' + String(Math.round(done)),
        color: '#aef0c0', ttl: 0.8,
      });
    }
    // 恩泽：治疗溢出转护盾。满血队伍里奶妈原本是完全空转的，这条把「多余的治疗」变成资源
    const over = eff - done;
    if (over > 0.5 && healer?.traitId === 'grace') {
      const s = over * TRAIT_CFG.graceOverhealToShield;
      target.shield += s;
      this.floaters.push({
        x: target.x, y: target.y - 0.7, text: `盾 +${Math.round(s)}`, color: '#7fe3b0', ttl: 0.8,
      });
      this.emit('bubble', target.x, target.y, '#7fe3b0', 0.4, { r: target.hitRadius * 1.7 });
    }
    this.emitAudio({ id: 'heal', x: target.x, arenaW: this.W });
  }

  /**
   * v3.1 签名技效果乘子（技能等级 = 星级，+18%/星）。
   * 只在 castSkill 内部显式相乘，不塞进 dealSkill——
   * dealSkill 同时服务坐骑技与元素附伤，塞进去会让坐骑吃两层星级乘区。
   */
  private skillPow(u: Unit): number {
    return u.skillPower ?? 1;
  }

  private dealSkill(u: Unit, target: Unit, amount: number, type: Unit['damageType'], crit = false, trueDmg = false) {
    const c = crit || this.rng() < u.derived.crit / 100;
    const dmg = amount * (c ? this.effCritDmg(u) / 100 : 1) * u.dmgMult;
    this.applyDamage(target, dmg, type, c, u, false, trueDmg);
  }

  private basicAttack(u: Unit, target: Unit, heavy = false) {
    if (this.tryDodge(target, u)) return;
    // 速射：叠层必须在结算之前更新（traitOutMult 读的是当前层数）。
    // 换目标即清零 —— 这让「点杀 vs 换线」成为一个真实取舍
    if (u.traitId === 'volley') {
      u.traitStacks = u.lastHitTargetId === target.id
        ? Math.min(TRAIT_CFG.volleyMaxStacks, (u.traitStacks ?? 0) + 1)
        : 0;
    }
    // vX 英雄级普攻构成：无名剑客指定 atkRatio(40%物+75%魔)时按占比混算；
    // 其余沿用默认规则（magic→mDmg / physical→pDmg / hybrid→(p+m)/2）。
    // 重击沿用 mult(2.3~3.6) 叠加在「普攻倍率」之上，即重击 = 普攻构成 × 重击倍率。
    const base = u.atkRatio
      ? u.derived.pDmg * u.atkRatio.p + u.derived.mDmg * u.atkRatio.m
      : u.damageType === 'magic'
        ? u.derived.mDmg
        : u.damageType === 'physical'
          ? u.derived.pDmg
          : (u.derived.pDmg + u.derived.mDmg) / 2;
    const crit = this.rng() < u.derived.crit / 100;
    // v2.9 轻/重击伤害倍率（独立 atkRng 扰动，不污染主随机流）：
    //   轻击 75%~110%（每次轻微浮动，体现不同出手情况）；
    //   重击 230%~360%（大幅浮动——重击发力角度不同，伤害不同）。
    //   建筑（防御塔）不参与轻/重击：塔的攻击保持 100% 稳定倍率。
    const mult = u.isBuilding ? 1
      : heavy
        ? 2.3 + this.atkRng() * 1.3
        : 0.75 + this.atkRng() * 0.35;
    // v2.9.9 治疗职业的普攻是「弱普攻」：她把这一拍用来补一点伤害而不是发呆，
    // 但伤害必须明显低于同位置的输出职业，否则辅助位会挤占输出位的存在意义。
    const roleMult = this.isHealAttacker(u) ? HEALER_LIGHT_DMG_MULT : 1;
    // v3.0 双坦「守御」：普攻 = 基础伤害 +（自身生命上限 8% + 目标当前生命 5% + 自身护盾 70%）。
    // 重击（heavy）同样附加这份加成，使坦克承伤可转化为实打实输出，不再只能挨打。
    let tankBonus = 0;
    if (u.subclass === 'physTank' || u.subclass === 'magicTank') {
      tankBonus = u.maxHp * 0.08 + target.hp * 0.05 + u.shield * 0.70;
    }
    const dmg = base * mult * roleMult * (crit ? this.effCritDmg(u) / 100 : 1) * u.dmgMult + tankBonus;
    this.applyDamage(target, dmg, u.damageType, crit, u, heavy);
    // v2.9.1 重击命中白闪加强（0.12 → 0.2）：重击打中的目标"唰"地亮一下
    if (heavy) target.flash = Math.max(target.flash, 0.2);
    // v2.9 近战重击击倒：被击倒单位短暂无法行动（giant/titan 碾压级免疫——一座山倒不了）
    if (heavy && this.attackRangeOf(u) <= 3 &&
        target.bodyType !== 'giant' && target.bodyType !== 'titan') {
      target.kdUntil = Math.max(target.kdUntil ?? 0, this.time + 0.9);
    }
    // v2.9 重击飘字提示（渲染层按颜色放大字号，与普通伤害区分）
    if (heavy) {
      this.floaters.push({ x: target.x, y: target.y - 0.6, text: '重击', color: '#ffd24d', ttl: 0.55 });
    }
    u.lastHitTargetId = target.id;
    // 势能（v3.0 重做）：普攻同时叠 ①攻速层（无衰减、受击不清空）②技能吸血层；
    // 并记录本次普攻时刻，供 tick 主循环判定脱战衰减。
    if (u.traitId === 'momentum') {
      u.traitStacks = Math.min(TRAIT_CFG.momentumMaxStacks, (u.traitStacks ?? 0) + 1);
      u.lifestealStacks = Math.min(TRAIT_CFG.momentumLifestealMax, (u.lifestealStacks ?? 0) + 1);
      u.lastBasicAt = this.time;
    }
    if (this.attackRangeOf(u) > 3) {
      // 远程：重击弹道更粗更亮、飞行更久（渲染层按 heavy 加强）
      this.projectiles.push({
        x: u.x, y: u.y, tx: target.x, ty: target.y, color: this.colorOf(u),
        ttl: heavy ? 0.30 : 0.18, heavy,
      });
    }
  }

  /** 单位普攻射程：召唤物用模板射程，其余用子类射程 */
  private attackRangeOf(u: Unit): number {
    if (u.summonKind) return SUMMON_TEMPLATES[u.summonKind].range;
    return SUBCLASS_INFO[u.subclass].attackRange + (u.rangeBonus ?? 0);
  }

  private colorOf(u: Unit): string {
    if (u.summonKind) return SUMMON_TEMPLATES[u.summonKind].color;
    return SUBCLASS_INFO[u.subclass].color;
  }

  /**
   * 三类召唤物之一（需求 v1.4 §5.2.2；美术 §7.4）
   * 属性全部按召唤者 INT 折算，体型来自模板——石魂卫魁梧、影刃仆精巧、咒火灵轻捷，
   * 玩家在它开打之前就能从剪影认出它是什么类型。
   */
  private makeSummon(u: Unit, kind: SummonKind): Unit {
    const tpl = SUMMON_TEMPLATES[kind];
    const int = u.primary.int;
    // 军团：召唤物额外继承 25% 攻击。只放大攻击不放大生命——
    // 生命仍按基础 INT 算，否则「军团 + 石魂卫」会变成无法击穿的移动城墙
    const inherit = u.traitId === 'legion' ? 1 + TRAIT_CFG.legionAtkInherit : 1;
    // v3.1 升星强化技能：召唤物是「抟土化生」的技能产物，攻/血同吃技能等级乘子。
    // 只放大攻击不放大生命的老思路留给「军团」特性去做区分，这里两者一起抬——
    // 否则召唤流升到 5★ 依然是一群一碰就碎的纸人，玩家读不到升星收益
    const pow = this.skillPow(u);
    const primary = { con: 4, str: 4, agi: 4, int: Math.round(int * tpl.atkRatio * inherit * pow) };
    const derived: DerivedAttrs = derive(primary);
    derived.hp = Math.max(1, Math.round(int * 10 * tpl.hpRatio * pow));
    derived.moveSpeed = derived.moveSpeed * tpl.moveMult + (tpl.moveMult - 1) * 100;
    const hp = derived.hp;
    return {
      id: this.nextSpawnId(`sum_${kind}_`),
      side: u.side, name: tpl.name, category: 'mage', subclass: 'summoner',
      damageType: 'magic', x: u.x + 0.6, y: u.y,
      hp, maxHp: hp, primary, derived,
      cd: 0, skill: { id: 'none', name: '普攻', cd: 0, damageType: 'magic', desc: '' },
      skillCd: 0, alive: true, shield: 0, rootUntil: 0, stunUntil: 0, tauntUntil: 0,
      dmgMult: 1, level: 1,
      isSummon: true, summonUntil: this.time + tpl.duration, summonTotal: tpl.duration,
      summonKind: kind, bodyType: tpl.bodyType, gender: u.gender, hitRadius: hitRadiusOf(tpl.bodyType),
      flash: 0,
      // v2.9.8：反查主人。召唤物的普攻/击杀要回流到女娲的大招冷却上
      casterHeroUid: u.heroUid,
    };
  }

  /**
   * Boss 分身（美术 §7.2.1）
   * 走召唤物基础设施（isSummon + summonUntil），所以：
   *  · 不计入胜负判定 —— 杀光分身不算赢，逼玩家找本体
   *  · 用召唤物的窄 HUD —— 屏幕不会被 3 条 Boss 血条淹没
   * 分身不再分裂（skillCd 拉到无穷），否则 12s 一轮就是指数爆炸。
   */
  private makeClone(boss: Unit, idx: number): Unit {
    const primary = { ...boss.primary };
    const derived: DerivedAttrs = { ...boss.derived };
    derived.hp = Math.max(1, Math.round(boss.maxHp * BOSS_CLONE_HP));
    derived.pDmg *= BOSS_CLONE_DMG;
    derived.mDmg *= BOSS_CLONE_DMG;
    const hp = derived.hp;
    const ang = (idx / BOSS_CLONE_COUNT) * Math.PI * 2;
    // 分身体型降一档：一眼能和本体分开，不用读血条（美术 §4.5 体型即信息）
    // v2.8：giant→titan→colossal→heavy；obese 与 colossal 同降 heavy
    const body = boss.bodyType === 'giant' ? 'titan'
      : boss.bodyType === 'titan' ? 'colossal'
      : boss.bodyType === 'obese' || boss.bodyType === 'colossal' ? 'heavy' : 'medium';
    return {
      id: this.nextSpawnId(`clone_${idx}_`),
      side: boss.side, name: `${boss.name}·残影`, category: boss.category, subclass: boss.subclass,
      damageType: boss.damageType,
      x: clamp(boss.x + dcos(ang) * 1.2, 0.6, this.W - 0.6),
      y: clamp(boss.y + dsin(ang) * 1.2, 0.6, this.H - 0.6),
      hp, maxHp: hp, primary, derived,
      cd: 0, skill: { id: 'none', name: '普攻', cd: 0, damageType: boss.damageType, desc: '' },
      skillCd: Number.POSITIVE_INFINITY,
      alive: true, shield: 0, rootUntil: 0, stunUntil: 0, tauntUntil: 0,
      dmgMult: boss.dmgMult, level: boss.level,
      isSummon: true, summonUntil: this.time + BOSS_CLONE_DURATION, summonTotal: BOSS_CLONE_DURATION,
      bodyType: body, gender: boss.gender, hitRadius: hitRadiusOf(body),
      flash: 0,
      // v2.9 分身继承本体的轻/重击节奏（同门同套路）
      combo: boss.combo ?? 0, heavyAt: boss.heavyAt ?? 5, heavyBurst: 0,
      heavyBurstCount: boss.heavyBurstCount ?? 1, heavyLock: 0,
      lightAs: boss.lightAs ?? 130, heavyAs: boss.heavyAs ?? 40,
      heavyArmorUntil: 0, isHeavyHit: false,
    };
  }

  private lastSummonKind?: SummonKind;

  /**
   * v1.8.4 兽类「下一站」：母体产 3~6 只小个体。
   *  · 生命减半 / 体型小 40%（sizeScale ×0.6）/ 移速快 30%
   *  · isBeastling 标记 + parentId 指向母体；母体死亡时由 killIfDown 写入 vengeTargetId（复仇）
   *  · 数量与落点确定性：消费主 rng 流（同 seed 同战斗必然一致）
   */
  private spawnBeastlings(mother: Unit) {
    const n = 3 + Math.floor(this.rng() * 4); // 3~6
    for (let k = 0; k < n; k++) {
      const derived: DerivedAttrs = { ...mother.derived };
      derived.moveSpeed *= 1.3;
      const b: Unit = {
        ...mother,
        id: this.nextSpawnId(`beast_${k}_`),
        name: `${mother.name}·幼体`,
        isBeastling: true,
        parentId: mother.id,
        beastTrait: undefined,
        nestDone: true,
        isSummon: false,
        summonUntil: undefined,
        maxHp: mother.maxHp * 0.5,
        hp: mother.maxHp * 0.5,
        sizeScale: (mother.sizeScale ?? 1) * 0.6,
        derived,
        x: clamp(mother.x + (this.rng() - 0.5) * 1.0, 0.6, this.W - 0.6),
        y: clamp(mother.y + (this.rng() - 0.5) * 1.0, 0.6, this.H - 0.6),
      };
      this._push(b);
    }
    this.pushLog(`${mother.name} 下一站 → 产下 ${n} 只小个体`);
    this.emit('ring', mother.x, mother.y, '#ffb15a', 0.5, { r: 1.2 });
    this.emitAudio({ id: 'summon_expire', x: mother.x, arenaW: this.W });
  }

  private shouldCast(u: Unit): boolean {
    if (u.skillCd > 0) return false;
    const enemies = this.alive('enemy');
    if (!enemies.length) return false;
    switch (u.skill.id) {
      // v1.4：施法条件与 castRange 对齐——技能够不到就不该放，否则距离环是骗人的
      case 'taunt': return this.inCastRange(u, enemies).length >= 1
        && this.alive('ally').some((a) => a.hp < a.maxHp * 0.6);
      case 'ward': return u.hp < u.maxHp * 0.7;
      case 'groupheal': return this.inCastRange(u, this.alive('ally')).some((a) => a.hp < a.maxHp * 0.8);
      // v1.6：不再因「召唤位满」而禁施法——满位时二段机制改为强化现有召唤物
      case 'summon': return enemies.length >= 1;
      case 'hexburst': return this.inCastRange(u, enemies).length >= 2;
      case 'timelock': return this.inCastRange(u, enemies).length >= 2;
      case 'boss_stomp': return this.alive('ally').some((a) => dist(a, u) <= 3);
      case 'boss_devour': return enemies.length >= 1;
      // v2.9.6 龙吐息：射程内有敌人就喷（锥形 AoE 自带更大覆盖范围）
      case 'whelp_breath':
      case 'lair_dragon_breath':
      case 'm_dragon_skill':
        return this.inCastRange(u, enemies).length >= 1;
      // v2.9.x 面包车撞击：贴上了才撞。castRange 1.5 = 车头那一下的真实接触距离，
      // 隔着半个场地"撞击"会让击退变成不可理解的隔空推人
      case 'van_ram': return this.inCastRange(u, enemies).length >= 1;
      default: return true;
    }
  }

  /**
   * 施放技能。v1.4 三条纪律：
   *  1) 任何 castRange > 0 的技能都先发起手距离环（三件套 ①）
   *  2) 特效主尺寸 = castRange × TILE，禁止硬编码（三件套 ②）
   *  3) 命中反馈时长按四档位取 TIER_TTL（三件套 ③）
   */
  private castSkill(u: Unit) {
    // 反"堆一人"·捆仙绳：带 back 标记的后排敌施法时，按概率封印我方最强 + 施法怪自身。
    // 关键：用 stunUntil 而非 rootUntil —— 本引擎里 root 只挡移动（tick 第 2196 行），
    // 对一个神装远程等于没锁，他会站在原地照打。封印必须是"不能动也不能出手"。
    // 双方同封，解除 = 任一方被击杀（见 killIfDown）；backShackleT 只是防锁死整场的兜底上限。
    if (u.side === 'enemy' && u.focusRole === 'back' && this.backShackleCount < this.enemyFocus.maxBackPerBattle) {
      if (this.focusRoll(this.enemyFocus.backShackleP)) {
        const strongest = findStrongestAlly(this.units);
        if (strongest && strongest.stunUntil <= this.time && !strongest.shackleWith) {
          this.backShackleCount++;
          const T = this.enemyFocus.backShackleT;
          strongest.stunUntil = this.time + T;
          strongest.rootUntil = this.time + T;
          u.stunUntil = this.time + T;
          u.rootUntil = this.time + T;
          strongest.shackleWith = u.id;
          u.shackleWith = strongest.id;
          this.pushLog(`${u.name} 捆仙绳 → 封印 ${strongest.name}（击杀任一方解除）`);
          this.emitAudio({ id: 'cc_root', x: strongest.x, arenaW: this.W });
          this.floaters.push({ x: strongest.x, y: strongest.y - 0.9, text: '捆仙绳', color: '#ffe08a', ttl: 1.3 });
          this.emit('ring', strongest.x, strongest.y, '#ffe08a', 0.5, { r: strongest.hitRadius * 2 });
          // 捆仙绳就是这一次施法本身：占掉本轮技能 CD 并短路，不再叠放原技能。
          u.skillCd = u.skill.cd;
          return;
        }
      }
    }
    // v2.9.3 专属红装大招冷却缩减：skillCdr（0.10 + 每星 0.05，封顶 0.45）
    u.skillCd = u.skill.cd * (1 - (u.skillCdr ?? 0));
    // 基础攻击单位（skill='none'，含召唤物）没有特殊技能：
    // 进施法流程只会每轮 CD 画无意义起手环 + 发兜底 whoosh。直接短路。
    if (u.skill.id === 'none') { u.skillCd = 999; return; }
    const enemies = this.alive('enemy');
    const allies = this.alive('ally');
    // v1.5 技能签名：颜色/尺寸/运动跟「技能」走，不跟施法者。
    // 同一子类的不同技能因此颜色恒定可区分（美术 §7.3⑤）。
    const sig = vfxOf(u.skill, u.isBoss);
    this.castAnim(u);
    const R = this.castRangeOf(u);
    const tier = rangeTier(R);
    const ttl = TIER_TTL[tier];
    // v1.6：本次施法波及到的敌人。禁锢特性在收尾统一挂减速，
    // 避免在 9 个 case 里各写一遍（写九遍就一定会漏掉两遍）
    const touched: Unit[] = [];
    // v3.1 技能等级乘子（= 星级）。每个 case 的效果量都要乘它，
    // 否则「升星强化技能」在战场上依旧一点看不出来
    const P = this.skillPow(u);

    // ① 起手距离环：用签名色，但半径 = 真实 castRange（不放大），否则误导玩家读射程
    this.windup(u, R, sig.color);

    // ── 音频：技能起手音（音频设计文档 §3；cast_* 与对应 hit_* 可叠加）──
    const castSound: Record<string, AudioEventId> = {
      taunt: 'cast_taunt', ward: 'cast_ward', charge: 'cast_charge', hexburst: 'cast_hexburst',
      barrage: 'cast_barrage', deadshot: 'cast_deadshot_warn', timelock: 'cast_timelock',
      summon: 'cast_summon', groupheal: 'cast_groupheal',
      boss_stomp: 'cast_boss_stomp', boss_devour: 'cast_boss_devour_warn', boss_split: 'cast_boss_split',
    };
    this.emitAudio({
      id: castSound[u.skill.id] ?? 'cast_generic', x: u.x, arenaW: this.W,
      variant: u.gender ? { subclass: u.subclass, gender: u.gender } : undefined,
    });

    switch (u.skill.id) {
      case 'taunt': {
        // 范围化：只嘲讽 castRange 内的敌人。全场生效会让距离环变成谎言
        const hit = this.inCastRange(u, enemies);
        u.tauntUntil = this.time + 3;
        this.emitAudio({ id: 'cc_taunt', x: u.x, arenaW: this.W });
        for (const e of hit) e.targetId = u.id;
        touched.push(...hit);
        // ── v2.9.9 镇岳怒吼·签名帧 ──
        // ① 主体：签名色扩张环（v1.5 签名运动）
        this.emit('ring', u.x, u.y, sig.color, ttl, { r: R, tier, motion: sig.motion, sizeMul: sig.sizeMul });
        // ② 副体：三层错时同心声波 + 六根拔地而起的岩柱（「镇岳」＝山岳落地，不是喊一嗓子）
        for (let i = 0; i < 3; i++) {
          this.emit('ring', u.x, u.y, i % 2 ? '#c9d4ff' : sig.color, 0.46, {
            r: R * (0.55 + i * 0.28), tier, sizeMul: sig.sizeMul, delay: 0.07 * i, alphaFrom: 0.85, alphaTo: 0,
          });
        }
        this.ultRadial('blade', u.x, u.y, '#6f8fe0', 0.48, {
          n: 6, rad: R * 0.62, size: 1.9, step: 0.045, tier, sizeMul: sig.sizeMul,
        });
        // ③④ 冲击 + 收尾
        this.ultBurst(u.x, u.y, { core: sig.color, echo: '#c9d4ff', r: R * 0.95, tier, sizeMul: sig.sizeMul, quake: '#2c3f7a' });
        // v2.9.3 镇岳怒吼主体特效：地面地震裂痕（音波+地裂，玄武的"镇"）
        this.emit('quake', u.x, u.y, sig.color, 0.5, { r: R * 0.8, tier, sizeMul: sig.sizeMul });
        this.ultName(u.x, u.y, u.skill.name, sig.color);
        // v2.9.3 地形永久改变：玄武踏碎脚下地面 → 大坑（范围随体型，坑中角色下沉）
        this.markCrater(u.x, u.y, R * 0.6, u);
        // 二段（A.1.4）：血线健康时追加震荡波。纯嘲讽在自动战斗里毫无观感——
        // 玩家看不到「拉仇恨」，只能看到坦克站着挨打。给它一个可见的输出瞬间
        if (u.hp > u.maxHp * STAGE2_CFG.tauntHpGate && hit.length) {
          for (const e of hit) this.dealSkill(u, e, u.derived.pDmg * STAGE2_CFG.tauntWaveRatio * P, 'physical');
          this.emit('shock', u.x, u.y, sig.color, ttl * 0.8, {
            r: R * 0.9, tier, motion: sig.motion, sizeMul: sig.sizeMul,
          });
          this.pushLog(`${u.name} 怒吼震荡（${hit.length} 目标）`);
        }
        break;
      }
      case 'ward': {
        // 二段：护盾按已缺失生命加权，越残血越厚（最高 +60%）
        const missing = 1 - u.hp / u.maxHp;
        const bonus = 1 + missing * STAGE2_CFG.wardMissingBonusMax;
        u.shield += (u.primary.int * 2 + 50) * bonus * P;
        // ── v2.9.9 符甲护盾·签名帧 ──
        // 原实现只有一个泡泡，是全队 9 个大招里最没存在感的一个：
        // 玩家看到的只是"紫色闪了一下"，读不出「凝符为甲」这件事。
        const wr = u.hitRadius * 1.8;
        // ① 主体：护盾泡（跟体型走，不跟距离走——它是自身护盾，美术 §7.3.1 ②）
        this.emit('bubble', u.x, u.y, sig.color, ttl, { r: wr, tier, motion: sig.motion, sizeMul: sig.sizeMul });
        // ② 副体：八片符甲由外向内错时贴合成壳 + 三层收缩符文环（「凝」的过程要看得见）
        this.ultRadial('blade', u.x, u.y, '#d9b8ff', 0.5, {
          n: 8, rad: wr * 1.55, size: 1.15, step: 0.035, tier, sizeMul: sig.sizeMul, phase: 0.3,
        });
        for (let i = 0; i < 3; i++) {
          this.emit('ring', u.x, u.y, i % 2 ? '#e0c9ff' : sig.color, 0.42, {
            r: wr * (2.2 - i * 0.5), tier, sizeMul: sig.sizeMul, delay: 0.06 * i, alphaFrom: 0.9, alphaTo: 0,
          });
        }
        // ③④ 冲击 + 收尾（自身增益无地裂，故不给 quake）
        this.ultBurst(u.x, u.y, { core: sig.color, echo: '#e0c9ff', r: wr * 2.0, tier, sizeMul: sig.sizeMul });
        // 脚下符阵光环：护盾是持续状态，给它一个"落地生根"的底盘
        this.emit('light', u.x, u.y, '#c9a8ff', 0.55, { r: wr * 1.7, alphaFrom: 0.7, alphaTo: 0 });
        this.ultName(u.x, u.y, u.skill.name, sig.color);
        break;
      }
      case 'charge': {
        const ox = u.x, oy = u.y;
        const reach = this.inCastRange(u, enemies);
        const t = reach.length ? this.farthest(reach, u) : null;
        if (t) {
          u.x = clamp(t.x, 0.6, this.W - 0.6);
          u.y = clamp(t.y - 1, 0.6, this.H - 0.6);
          // 二段：自身残血时冲锋伤害 ×1.6——把「快死了」变成反打窗口而非纯劣势
          const burst = u.hp < u.maxHp * STAGE2_CFG.chargeHpGate ? STAGE2_CFG.chargeBurstMult : 1;
          this.dealSkill(u, t, u.derived.pDmg * 2.5 * burst * P, 'physical');
          // v3.0 势能·技能吸血：冲锋伤害按比例回血，层数来自普攻叠层（脱战才衰减，不再受击清零）。
          const ls = u.lifestealStacks ?? 0;
          if (ls > 0) {
            const heal = u.derived.pDmg * 2.5 * burst * P * u.dmgMult * TRAIT_CFG.momentumLifestealPerStack * ls;
            this.applyHeal(u, heal, u);
            this.pushLog(`${u.name} 势能吸血 +${Math.round(heal)}（${ls} 层）`);
          }
          if (burst > 1) this.pushLog(`${u.name} 背水冲锋（×${STAGE2_CFG.chargeBurstMult}）`);
          t.stunUntil = this.time + 1;
          this.emitAudio({ id: 'cc_stun', x: t.x, arenaW: this.W });
          touched.push(t);
          // 位移越长残影越多（美术 §7.3.1 ②）
          this.emit('trail', ox, oy, sig.color, ttl, { tx: u.x, ty: u.y, r: R, tier, motion: sig.motion, sizeMul: sig.sizeMul });
          // ── v2.9.8 青龙偃月斩·强化（需求④：红色大刀特效要「压得住场」）──
          // 旧版只有孤零零一柄 2.4 格红刀，0.45s 一闪就没了，在满屏弹道里根本挑不出来。
          // 现在拆成四层，层层递进，让这一刀成为整局最抢眼的一帧：
          //   ① 落点主刀：更高（3.6 格）更久（0.7s），先声夺人
          //   ② 刀阵残影：左右各两柄递减的刀影错时拔起，读作「一刀带出一片刀气」
          //   ③ 刀气冲击：放射 nova + 扩散 shock 红环，把范围感钉在地面上
          //   ④ 地裂与拖影：红色地裂 + 突进路径上的双段残影，收尾有重量
          // 全部是纯 emit（零 RNG、零逻辑），对确定性与数值平衡无任何影响。
          this.emit('blade', t.x, t.y, '#ff2a1a', 0.70, { r: 3.6, tier, sizeMul: sig.sizeMul });
          this.emit('blade', t.x, t.y, '#ffd0c4', 0.52, { r: 3.0, tier, sizeMul: sig.sizeMul, delay: 0.05 });
          for (let i = 0; i < 2; i++) {
            const off = 0.95 + i * 0.85;      // 左右对称外扩
            const h = 2.5 - i * 0.7;          // 越外侧越矮 → 刀阵纵深
            const dl = 0.06 + i * 0.07;       // 错时拔起 → 「唰唰唰」的连续感
            this.emit('blade', t.x - off, t.y, '#ff4d3d', 0.5, { r: h, tier, sizeMul: sig.sizeMul, delay: dl });
            this.emit('blade', t.x + off, t.y, '#ff4d3d', 0.5, { r: h, tier, sizeMul: sig.sizeMul, delay: dl });
          }
          this.emit('nova', t.x, t.y, '#ff3a24', 0.42, { r: 2.6, tier, motion: sig.motion, sizeMul: sig.sizeMul });
          this.emit('shock', t.x, t.y, '#ff6a4a', 0.5, { r: 2.9, tier, sizeMul: sig.sizeMul, alphaFrom: 0.85, alphaTo: 0 });
          this.emit('quake', t.x, t.y, '#8c1a10', 0.55, { r: 2.2, tier, sizeMul: sig.sizeMul, delay: 0.05 });
          this.emit('ring', t.x, t.y, '#ffd0c4', 0.3, { r: 1.5, alphaFrom: 0.9, alphaTo: 0 });
          this.floaters.push({ x: t.x, y: t.y - 1.4, text: '偃月突斩', color: '#ff6a4a', ttl: 0.9 });
          this.emitAudio({ id: 'cast_charge', x: t.x, arenaW: this.W, gain: 1,
            variant: u.gender ? { subclass: u.subclass, gender: u.gender } : undefined });
          // v2.9.3 地形永久改变：单点刀劈 → 线状刀痕（焦土+裂纹，克制的小破坏）
          this.markSlash(ox, oy, t.x, t.y, u);
          this.emit('beam', u.x, u.y, sig.color, ttl * 0.4, {
            tx: t.x, ty: t.y, r: 0.3, tier, thickness: beamThickness(R), motion: sig.motion, sizeMul: sig.sizeMul,
          });
          // 突进路径上的双段红色刀光（越靠近落点越亮）：把「冲过来」这段也画出来
          this.emit('beam', ox, oy, '#ff2a1a', 0.26, {
            tx: t.x, ty: t.y, r: 0.3, tier, thickness: beamThickness(R) * 2.2, alphaFrom: 0.75, alphaTo: 0,
          });
          this.emit('beam', ox, oy, '#ffe2da', 0.2, {
            tx: t.x, ty: t.y, r: 0.3, tier, thickness: beamThickness(R) * 0.9, alphaFrom: 0.9, alphaTo: 0, delay: 0.04,
          });
        }
        break;
      }
      case 'van_ram': {
        // ① 命中判定：castRange 内全部敌人。撞击是 AoE —— "击退阵型"要的就是一次推开一排，
        //    单体击退只会把阵型戳个洞，读不出"车队撞进来"
        const hit = this.inCastRange(u, enemies);
        if (!hit.length) break;
        this.dealRam(u, hit);
        touched.push(...hit);
        const opening = this.vanSpeedMult(u) > 1;
        // ② 特效范围 = R（真实 castRange），一格不放大。需求 #2 的验收线就是这条：
        //    特效比判定大 → 玩家学到错误的安全距离；特效比判定小 → 挨了打不知道为什么。
        //    开场那一撞给更亮更久的一层，卸人后自动降级——光污染只花在真有威胁的时候。
        this.emit('shock', u.x, u.y, '#ffcf3d', opening ? 0.42 : 0.28, {
          r: R, tier, alphaFrom: opening ? 0.85 : 0.5, alphaTo: 0,
        });
        this.emit('quake', u.x, u.y, '#6b5a1a', opening ? 0.4 : 0.26, {
          r: R * 0.9, tier, sizeMul: sig.sizeMul, delay: 0.04,
        });
        if (opening) {
          // 开场专属：车头前方的冲击楔形 + 一声重撞。只在这 10 秒出现，
          // 所以它天然是"开场很猛"的视觉签名，不需要额外堆特效去强调
          const t0 = this.nearest(hit, u);
          this.emit('beam', u.x, u.y, '#fff0b8', 0.22, {
            tx: t0.x, ty: t0.y, r: 0.3, tier,
            thickness: beamThickness(R) * 1.8, alphaFrom: 0.8, alphaTo: 0,
          });
          this.floaters.push({ x: u.x, y: u.y - 1.2, text: '蛮横冲撞', color: '#ffcf3d', ttl: 0.8 });
        }
        this.emitAudio({ id: opening ? 'cast_boss_stomp' : 'cast_charge', x: u.x, arenaW: this.W });
        // ③ 地形留痕：撞击点压出车辙坑。克制的破坏——一次撞击一个坑，不铺满全场
        this.markCrater(u.x, u.y, R * 0.7, u);
        break;
      }
      case 'hexburst': {
        const hit = this.inCastRange(u, enemies);
        for (const e of hit) {
          // vX 签名技：90%物攻 + 130%魔攻混伤（按派生 pDmg/mDmg 分别乘区，P=星级数乘子）
          this.dealSkill(u, e, (u.derived.pDmg * 0.90 + u.derived.mDmg * 1.30) * P, 'hybrid');
        }
        touched.push(...hit);
        // 二段：每命中一个目标吸血 3%——命中数越多续航越强，鼓励往人堆里插
        if (hit.length) {
          this.applyHeal(u, u.maxHp * STAGE2_CFG.hexburstLifestealPct * hit.length, u);
        }
        // ── v2.9.9 无形剑罡·签名帧 ──
        // ① 主体：nova 射线长 = castRange × 0.9，短促有力（近战爽感来自零延迟）；v1.5 旋转 nova
        this.emit('nova', u.x, u.y, sig.color, ttl, { r: R * 0.9, tier, motion: sig.motion, sizeMul: sig.sizeMul });
        // ② 副体：八道剑罡呈放射状错时拔起 + 一记反向旋转的第二层 nova
        //    「无形」不等于「看不见」——剑气本身要能被读成一片刀锋阵列
        this.ultRadial('blade', u.x, u.y, '#eaf3ff', 0.44, {
          n: 8, rad: R * 0.66, size: 1.7, step: 0.03, tier, sizeMul: sig.sizeMul,
        });
        this.emit('nova', u.x, u.y, '#eaf3ff', 0.36, {
          r: R * 0.6, tier, motion: sig.motion, sizeMul: sig.sizeMul, delay: 0.08, alphaFrom: 0.9, alphaTo: 0,
        });
        // ③④ 冲击 + 收尾（霜白剑气，地面留一层浅霜裂）
        this.ultBurst(u.x, u.y, { core: sig.color, echo: '#eaf3ff', r: R * 1.0, tier, sizeMul: sig.sizeMul, quake: '#6a8099' });
        this.ultName(u.x, u.y, u.skill.name, sig.color);
        break;
      }
      case 'barrage': {
        const reach = this.inCastRange(u, enemies);
        let lastX = u.x, lastY = u.y, fired = 0;
        for (let i = 0; i < 5; i++) {
          const t = pick(this.rng, reach);
          if (!t) continue;
          // 二段：第 2 发起每发递增 +20%（i=0 → ×1.0 … i=4 → ×1.8），
          // 让「连射」在飘字上真的是一串越来越大的数字
          const ramp = 1 + STAGE2_CFG.barrageRampPerShot * i;
          this.dealSkill(u, t, u.derived.pDmg * 0.8 * ramp * P, 'physical');
          touched.push(t);
          lastX = t.x; lastY = t.y; fired++;
          const d = i * 0.05; // 5 发错时：delay 拉开 0.05s/发（签名运动：交错扫射）
          // ── v2.9.9 神火霹雳·签名帧 ──
          // ① 主体：弹道光束（原实现只有这一条，5 发看起来像 5 根细线，毫无「霹雳」感）
          this.emit('beam', u.x, u.y, sig.color, ttl * 0.35, {
            tx: t.x, ty: t.y, r: 0.2, tier, thickness: beamThickness(R), delay: d, motion: sig.motion, sizeMul: sig.sizeMul,
          });
          // ② 副体：枪口焰 + 落点爆闪，伤害递增的同时爆点也逐发变大——数值曲线可视化
          this.emit('nova', u.x, u.y, '#ffd9a8', 0.16, { r: 0.75, tier, delay: d, alphaFrom: 0.95, alphaTo: 0 });
          this.emit('shock', t.x, t.y, sig.color, 0.3, {
            r: 0.85 + i * 0.14, tier, sizeMul: sig.sizeMul, delay: d + 0.04, alphaFrom: 0.9, alphaTo: 0,
          });
          this.emit('ring', t.x, t.y, '#ffe6c2', 0.22, { r: 0.5 + i * 0.1, delay: d + 0.05, alphaFrom: 0.9, alphaTo: 0 });
        }
        // ③④ 冲击 + 收尾：末发落点补一记大爆 + 焦土，把「最后一发最重」钉死
        if (fired) {
          this.ultBurst(lastX, lastY, { core: sig.color, echo: '#ffe6c2', r: 1.9, tier, sizeMul: sig.sizeMul, quake: '#7a4a1a' });
          this.ultName(u.x, u.y, u.skill.name, sig.color);
        }
        break;
      }
      case 'deadshot': {
        const reach = this.inCastRange(u, enemies);
        const t = reach.length ? this.lowestHp(reach) : null;
        if (t) {
          // long 档：先画 0.22s 预警细线（红色 = 危险提示，不替换为签名色），
          // 伤害与激光一起落在预警之后（美术 §7.3.1 ③）
          this.emit('beam', u.x, u.y, '#ff6a6a', LONG_WARN_TIME, {
            tx: t.x, ty: t.y, r: 0.1, tier, thickness: 1, alphaFrom: 0.5, alphaTo: 0.5,
          });
          // 结算激光用签名色（金）
          this.emit('beam', u.x, u.y, sig.color, ttl - LONG_WARN_TIME, {
            tx: t.x, ty: t.y, r: 0.25, tier, thickness: beamThickness(R), delay: LONG_WARN_TIME, motion: sig.motion, sizeMul: sig.sizeMul,
          });
          // ── v2.9.9 后羿射日·签名帧（预警段）──
          // ② 副体：beam_split 签名兑现——主光柱两侧各一条略偏的分裂细光，
          //    以及蓄力期弓身金环，让这 0.22s 的屏息真的「看得见在蓄力」
          this.emit('beam', u.x, u.y, '#fff2c9', ttl - LONG_WARN_TIME, {
            tx: t.x + 0.45, ty: t.y - 0.35, r: 0.2, tier, thickness: beamThickness(R) * 0.45,
            delay: LONG_WARN_TIME + 0.03, alphaFrom: 0.8, alphaTo: 0,
          });
          this.emit('beam', u.x, u.y, '#fff2c9', ttl - LONG_WARN_TIME, {
            tx: t.x - 0.45, ty: t.y + 0.35, r: 0.2, tier, thickness: beamThickness(R) * 0.45,
            delay: LONG_WARN_TIME + 0.06, alphaFrom: 0.8, alphaTo: 0,
          });
          for (let i = 0; i < 3; i++) {
            this.emit('ring', u.x, u.y, '#ffcf4d', 0.2, {
              r: 1.4 - i * 0.35, delay: i * 0.06, alphaFrom: 0.85, alphaTo: 0,
            });
          }
          touched.push(t);
          this.schedule(LONG_WARN_TIME, () => {
            if (!u.alive || !t.alive) return; // 预警期间死掉就不结算——这正是预警该有的代价
            // v3.1 修正：二段是「必定暴击」，不是「伤害翻倍」。
            // 旧实现对 >50% 血目标同时给了 ×2 伤害 + 强制暴击（实际 ×2×暴伤），
            // 与 SKILLS.deadshot / SKILL_STAGE2 的文案都对不上。现在伤害恒为 400%，
            // 高血量目标只吃「必定暴击」这一条——狙击手擅长的是开局破阵，不是凭空翻倍。
            const highHp = t.hp > t.maxHp * STAGE2_CFG.deadshotCritHpGate;
            this.dealSkill(u, t, u.derived.pDmg * 4 * P, 'physical', highHp);
            if (highHp) this.pushLog(`${u.name} 破阵一击（必定暴击）`);
            // v2.9.3 后羿射日：命中点太阳爆闪（金色光芒四射，主体特效）
            this.emit('sun', t.x, t.y, '#ffcf4d', 0.40, { r: 1.4, tier: 'long' });
            this.emitAudio({ id: 'cast_deadshot_fire', x: t.x, arenaW: this.W,
              variant: u.gender ? { subclass: u.subclass, gender: u.gender } : undefined });
            // ④ 收尾：技能名横幅在结算段揭示——狙击手「一击一名」，名字随命中一同落下
            this.ultName(u.x, u.y, u.skill.name, sig.color);
          });
        }
        break;
      }
      case 'timelock': {
        const hit = this.inCastRange(u, enemies);
        for (const e of hit) {
          // giant/titan 体型免疫禁锢（碾压级质量，定身锁不住）；其余单位正常定身
          if (e.bodyType !== 'giant' && e.bodyType !== 'titan') {
            e.rootUntil = this.time + 2.5;
            e.ccColor = sig.color; // v2.9.3：渲染层画腿部持续太极光，直到定身消失
            this.emitAudio({ id: 'cc_root', x: e.x, arenaW: this.W });
          }
          this.dealSkill(u, e, u.derived.mDmg * 1.2 * P, 'magic');
        }
        touched.push(...hit);
        // 二段：一次定身 ≥3 人返还 40% 冷却，奖励「等一个好时机」而不是见 CD 就放
        if (hit.length >= STAGE2_CFG.timelockRootGate) {
          u.skillCd *= 1 - STAGE2_CFG.timelockCdRefund;
          this.pushLog(`${u.name} 大范围定身 ×${hit.length} → 返还冷却`);
        }
        // ── v2.9.9 太极封禁·签名帧 ──
        // 旧版只有孤零零一个旋转牢笼，读不出「八卦锁敌、太极定身」这件事。
        // 拆成四层，让这一手禁锢成为整局最有压迫感的一帧：
        //   ① 主体：签名色牢笼（边长 = castRange × 0.7，v1.5 太极旋转运动）
        //   ② 副体：八枚八卦印由外向内错时贴合 + 三层同心扩散震环（「封禁」＝层层锁死）
        //   ③ 冲击：nova 放射 + 扩散 shock 青环 + 地裂，把定身范围钉在地面
        //   ④ 收尾：技能名横幅
        // 全部纯 emit（零 RNG、零逻辑），对确定性与平衡无任何影响。
        this.emit('cage', u.x, u.y, sig.color, ttl, { r: R * 0.7, tier, motion: sig.motion, sizeMul: sig.sizeMul });
        this.ultRadial('blade', u.x, u.y, '#bff3ec', 0.5, {
          n: 8, rad: R * 0.78, size: 1.6, step: 0.04, tier, sizeMul: sig.sizeMul, phase: 0.39,
        });
        for (let i = 0; i < 3; i++) {
          this.emit('ring', u.x, u.y, i % 2 ? '#bff3ec' : sig.color, 0.46, {
            r: R * (0.5 + i * 0.3), tier, sizeMul: sig.sizeMul, delay: 0.07 * i, alphaFrom: 0.85, alphaTo: 0,
          });
        }
        this.ultBurst(u.x, u.y, { core: sig.color, echo: '#bff3ec', r: R * 0.9, tier, sizeMul: sig.sizeMul, quake: '#1f6b66' });
        this.ultName(u.x, u.y, u.skill.name, sig.color);
        break;
      }
      case 'summon': {
        const cap = this.maxSummonsFor(u);
        const mine = this.units.filter((x) => x.isSummon && x.alive && x.side === u.side);

        // 二段：召唤位已满 → 强化现有召唤物而非回收重召。
        // 旧实现「杀掉最早的再召一个」净收益为零，玩家只看到自己的怪莫名消失
        if (mine.length >= cap) {
          const targets = mine.filter((m) => (m.traitStacks ?? 0) < STAGE2_CFG.summonEmpowerCap);
          if (targets.length) {
            for (const m of targets) {
              m.traitStacks = (m.traitStacks ?? 0) + 1;
              m.derived.pDmg *= 1 + STAGE2_CFG.summonEmpowerPct;
              m.derived.mDmg *= 1 + STAGE2_CFG.summonEmpowerPct;
              const add = Math.round(m.maxHp * STAGE2_CFG.summonEmpowerPct);
              m.maxHp += add; m.hp += add;
              m.summonUntil = (m.summonUntil ?? this.time) + STAGE2_CFG.summonEmpowerExtendSec;
              this.emit('bubble', m.x, m.y, '#9b7bff', 0.5, { r: m.hitRadius * 1.9 });
              this.floaters.push({
                x: m.x, y: m.y - 0.7, text: `强化 ${m.traitStacks}/${STAGE2_CFG.summonEmpowerCap}`,
                color: '#c9b0ff', ttl: 0.9,
              });
            }
            this.pushLog(`召唤位已满 → 强化 ${targets.length} 个召唤物`);
            this.emitAudio({ id: 'summon_spawn', x: u.x, arenaW: this.W });
          } else {
            // 全部满级：短 CD 空转重试，避免技能永久卡死在"可施法"状态刷日志
            u.skillCd = u.skill.cd * 0.5;
          }
          break;
        }

        // 三类选型 + 保底轮换，并把理由打进日志（自动战斗必须可播报）
        const { kind, reason } = pickSummonKind(
          this.alive(u.side), this.alive(u.side === 'ally' ? 'enemy' : 'ally'), this.lastSummonKind,
        );
        const tpl = SUMMON_TEMPLATES[kind];
        this._push(this.makeSummon(u, kind));
        this.lastSummonKind = kind;
        this.emitAudio({ id: 'summon_spawn', x: u.x + 0.6, arenaW: this.W });
        this.pushLog(`${reason} → 召唤${tpl.name}`);
        // 召唤裂隙用模板色（三类开口各异），叠加签名尺寸/运动
        this.emit('rift', u.x + 0.6, u.y, tpl.riftColor, ttl, {
          r: (tpl.riftW / 24) * 0.5, tier, motion: sig.motion, sizeMul: sig.sizeMul,
        });
        // ── v2.9.9 抟土造人·签名帧 ──
        // 旧版只有一道裂隙闪一下，读不出「按战况捏出泥卫/藤甲仆/灵火童」这件事。
        // 拆成四层，让造物落地这一刻有重量：
        //   ① 主体：召唤裂隙（模板色，三类开口各异）
        //   ② 副体：八枚土元素碎片由裂隙向外错时炸开（「抟土」＝把泥土捏成形）
        //   ③ 冲击：nova 放射 + 扩散 shock 土黄环 + 地裂，把造物之地钉在地面
        //   ④ 收尾：技能名横幅
        // 全部纯 emit（零 RNG、零逻辑），对确定性与平衡无任何影响。
        this.ultRadial('blade', u.x + 0.6, u.y, '#e6c79a', 0.46, {
          n: 8, rad: R * 0.42, size: 1.2, step: 0.035, tier, sizeMul: sig.sizeMul,
        });
        this.ultBurst(u.x + 0.6, u.y, { core: sig.color, echo: '#e6c79a', r: R * 0.45, tier, sizeMul: sig.sizeMul, quake: '#6b4a1f' });
        this.ultName(u.x, u.y, u.skill.name, sig.color);
        break;
      }
      case 'groupheal': {
        const heal = this.inCastRange(u, allies);
        // 二段：按缺失生命加权。均摊治疗在实战里永远是「奶满血的人」，
        // 加权后同一次施法会自动把资源倾斜给快死的那个
        for (const a of heal) {
          const missing = 1 - a.hp / a.maxHp;
          this.applyHeal(a, u.derived.heal * 2 * P * (1 + missing * STAGE2_CFG.grouphealMissingWeight), u);
        }
        // ── v2.9.9 青囊回春·签名帧 ──
        // 旧版只有一片薄荷光，是全队 9 个大招里最没「回春」感的一个：
        // 玩家只看到「绿光闪了一下」，读不出「青藤绕身、群疗落地」这件事。
        // 群疗是大招（200% 智力），特效应同关羽水平。拆成四层：
        //   ① 主体：签名色治疗光场（半径 = 真实治疗范围，玩家能看出谁在圈里）
        //   ② 副体：八道青藤由施法者向外错时抽枝（「回春」＝生命重新抽芽）
        //   ③ 冲击：nova 放射 + 扩散 shock 绿环，把治疗圈钉在地面
        //   ④ 收尾：技能名横幅
        // 全部纯 emit（零 RNG、零逻辑），对确定性与平衡无任何影响。
        this.emit('light', u.x, u.y, sig.color, ttl, { r: R, tier, motion: sig.motion, sizeMul: sig.sizeMul });
        this.ultRadial('blade', u.x, u.y, '#bff7cf', 0.5, {
          n: 8, rad: R * 0.62, size: 1.5, step: 0.04, tier, sizeMul: sig.sizeMul, phase: 0.3,
        });
        this.ultBurst(u.x, u.y, { core: sig.color, echo: '#bff7cf', r: R * 0.95, tier, sizeMul: sig.sizeMul });
        this.ultName(u.x, u.y, u.skill.name, sig.color);
        break;
      }
      case 'boss_stomp':
        for (const a of this.inCastRange(u, allies)) this.dealSkill(u, a, u.derived.pDmg * 3, 'physical');
        // v1.5：Boss 覆盖色（赤红）+ 厚冲击波
        this.emit('shock', u.x, u.y, sig.color, ttl, { r: R, tier, motion: sig.motion, sizeMul: sig.sizeMul });
        // v2.9.3 泰山压顶主体特效：地震裂痕（Boss 践踏地动山摇）
        this.emit('quake', u.x, u.y, sig.color, 0.55, { r: R * 0.9, tier, sizeMul: sig.sizeMul });
        break;
      case 'boss_devour': {
        // long 档全场吸血必须先预警（美术 §7.2.1）：给每个目标画 0.22s 暗红吸取线，
        // 伤害在预警后才兑现。原实现直接扣血，玩家只会觉得"我血怎么没了"
        const victims = this.inCastRange(u, allies);
        for (const a of victims) {
          this.emit('beam', u.x, u.y, '#8a1a1a', LONG_WARN_TIME, {
            tx: a.x, ty: a.y, r: 0.1, tier, thickness: 1, alphaFrom: 0.5, alphaTo: 0.5,
          });
        }
        // 涡裂隙用 Boss 覆盖色（暗红紫），尺寸用签名 sizeMul
        this.emit('rift', u.x, u.y, sig.color, ttl, { r: R * 0.25, tier, delay: LONG_WARN_TIME, motion: sig.motion, sizeMul: sig.sizeMul });
        this.schedule(LONG_WARN_TIME, () => {
          if (!u.alive) return;
          for (const a of victims) {
            if (!a.alive) continue;
            const d = Math.min(a.maxHp * 0.1, a.hp);
            a.hp -= d; u.hp = Math.min(u.maxHp, u.hp + d);
            a.flash = 0.25;
            this.killIfDown(a, u);
            this.emit('beam', u.x, u.y, '#ff2e2e', 0.3, {
              tx: a.x, ty: a.y, r: 0.15, tier, thickness: 2,
            });
            this.floaters.push({ x: a.x, y: a.y - 0.3, text: String(Math.round(d)), color: '#ff2e2e', ttl: 0.8 });
          }
          this.emitAudio({ id: 'cast_boss_devour', x: u.x, arenaW: this.W,
            variant: u.gender ? { subclass: u.subclass, gender: u.gender } : undefined });
        });
        break;
      }
      case 'boss_split': {
        // 文档 §7.2 从 v1.0 就写着「分身×2 持续8s」，此前只实现了回血——以文档为准补齐
        u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.2);
        // v1.5：Boss 覆盖色（赤红）+ 分身环
        this.emit('ring', u.x, u.y, sig.color, ttl, { r: u.hitRadius * 2, tier, motion: sig.motion, sizeMul: sig.sizeMul });
        for (let i = 0; i < BOSS_CLONE_COUNT; i++) {
          const c = this.makeClone(u, i);
          this._push(c);
          this.emit('rift', c.x, c.y, sig.color, 0.4, { r: 0.6, alphaFrom: 0.9, alphaTo: 0, motion: sig.motion, sizeMul: sig.sizeMul });
        }
        this.pushLog(`${u.name} 撕裂自身 → 分身 ×${BOSS_CLONE_COUNT}`);
        break;
      }
      // ── v2.9.6 龙吐息（重做）：幼龙 / 成年龙 / 邪龙共用一组锥形 AoE ──
      case 'whelp_breath':
      case 'lair_dragon_breath':
      case 'm_dragon_skill':
        this.dragonBreath(u);
        break;
    }

    // ── v1.6 禁锢：技能统一附带减速（在所有 case 之后收口）──
    if (u.traitId === 'shackle' && touched.length) {
      const seen = new Set<string>();
      for (const e of touched) {
        if (!e.alive || seen.has(e.id)) continue;
        seen.add(e.id);
        e.slowUntil = this.time + TRAIT_CFG.shackleSlowDur;
        e.slowPct = Math.max(e.slowPct ?? 0, TRAIT_CFG.shackleSlowPct);
        this.emit('ring', e.x, e.y, '#7ad0ff', 0.3, { r: e.hitRadius * 1.4, alphaFrom: 0.6, alphaTo: 0 });
      }
      if (seen.size) {
        this.pushLog(`${TRAITS.shackle.name}：${seen.size} 个目标被缚（-${TRAIT_CFG.shackleSlowPct}% 移速）`);
      }
    }
  }

  // ══ v2.9.6 龙吐息（重做）══════════════════════════════════════════
  // 锥形 AoE：范围 = 3 × 龙体型直径，半角 ~35°，朝向最近敌人喷。
  // 火=灼烧 DoT（3s）/ 冰=冰冻（定身 1.5s）/ 毒=剧毒（5%·秒 × 4s），
  // 命中目标同时吃一次吐息直伤。属性（火/冰/毒）首喷时按种子随机定下，终生不变。
  private dragonBreath(u: Unit) {
    const ELEM_KEYS: ('fire' | 'ice' | 'poison')[] = ['fire', 'ice', 'poison'];
    const ELEM_COLOR: Record<string, string> = { fire: '#ff5a2a', ice: '#7ad0ff', poison: '#39d353' };
    const ELEM_CN: Record<string, string> = { fire: '灼烧', ice: '冰冻', poison: '剧毒' };
    if (!u.dragonElement) u.dragonElement = pick(this.rng, ELEM_KEYS);
    const elem = u.dragonElement;
    const range = 6 * u.hitRadius;                 // 3 × 直径(2r)
    // 锥形张角的余弦。这是**逻辑判定**（下面 dot < halfCos 决定谁挨打），
    // 一个 ULP 的差异就能让站在锥形边缘的单位在 Safari 上被打、在 Chrome 上没被打。
    const halfCos = dcos(35 * DEG);
    const foes = this.alive(u.side === 'ally' ? 'enemy' : 'ally').filter((f) => !f.isBuilding);
    if (!foes.length) return;
    const t = this.nearest(foes, u);
    const aimX = t.x - u.x, aimY = t.y - u.y;
    const aimLen = len2d(aimX, aimY) || 1;
    const ax = aimX / aimLen, ay = aimY / aimLen;
    // 吐息倍率（贴合原技能文案：幼龙 160% / 成年龙 300% / 邪龙 350%）
    const mul = u.skill.id === 'whelp_breath' ? 1.6 : u.skill.id === 'm_dragon_skill' ? 3.5 : 3.0;
    const dmgType = u.skill.damageType;
    const ttl = TIER_TTL[rangeTier(this.castRangeOf(u))];
    for (const f of foes) {
      const dx = f.x - u.x, dy = f.y - u.y;
      const d = len2d(dx, dy);
      if (d > range + f.hitRadius) continue;        // 超出锥形长度
      const dot = (dx * ax + dy * ay) / (d || 1);
      if (dot < halfCos) continue;                   // 不在锥形张角内
      this.dealSkill(u, f, u.derived.pDmg * mul, dmgType);
      if (elem === 'fire') { f.burnUntil = this.time + 3; f.burnDps = 0.05; }
      else if (elem === 'ice') { f.freezeUntil = this.time + 1.5; }       // 冰冻=定身，tick 跳过 AI
      else { f.poisonUntil = this.time + 4; }                            // 毒：5%·秒 × 4 秒（tick 落地）
      this.emit('beam', u.x, u.y, ELEM_COLOR[elem], 0.3, { tx: f.x, ty: f.y, r: 0.35, thickness: 2 });
    }
    // 扇形光束近似锥形（5 道，每道偏转 14°，覆盖 ±28°），给玩家一个「喷向哪」的明确反馈。
    // 用「把瞄准向量转一个角度」代替「atan2 求角 → cos/sin 还原」：少一次超越函数调用，
    // 也彻底不需要实现 atan2。(ax, ay) 已是单位向量，旋转后仍然是。
    for (let i = -2; i <= 2; i++) {
      const d = drot(ax, ay, i * 14 * DEG);
      this.emit('beam', u.x, u.y, ELEM_COLOR[elem], ttl, {
        tx: u.x + d.x * range, ty: u.y + d.y * range,
        r: 0.5, thickness: 6, alphaFrom: 0.85, alphaTo: 0,
      });
    }
    this.pushLog(`${u.name} 龙息（${ELEM_CN[elem]}）`);
  }

  // ══ v2.6 §2 坐骑技能 ═══════════════════════════════════════════════
  // 与角色技能完全并行：独立 CD、独立判定、互不打断。
  // 之所以不塞进 castSkill 的 switch，是因为坐骑和职业是**正交**的两个维度——
  // 混在一起后每加一个坐骑就要在 9 个职业分支里各确认一遍，
  // 那种耦合会在第三次迭代时崩掉。
  private shouldCastMount(u: Unit): boolean {
    if (!u.mount || !u.mountSkill) return false;
    if ((u.mountCd ?? 0) > 0) return false;
    const foes = this.alive(u.side === 'ally' ? 'enemy' : 'ally');
    if (!foes.length) return false;
    const r = u.mountSkill.castRange ?? 3;
    // 赤兔是纯增益（全队 buff），场上有敌人就该放；其余坐骑技能都要有目标在射程内
    if (u.mount === 'redhare') return true;
    return foes.some((f) => dist(f, u) <= r + f.hitRadius);
  }

  /**
   * 施放坐骑技能。五只坐骑对应五种「这只畜生本身会做的事」：
   *   战象踩踏 / 玄豹扑杀 / 白额虎咆哮 / 赤兔疾驰 / 蛮牛顶撞
   * 每一个都复用已有的 VFX 签名管线（vfxOf → emit），不新增渲染分支：
   * 新增分支意味着新增一套需要单独调的视觉参数，而坐骑技能的辨识度
   * 靠的是「形状 + 颜色 + 文案」，已有的九种签名足够覆盖。
   */
  private castMountSkill(u: Unit) {
    const mk = u.mount;
    const sk = u.mountSkill;
    if (!mk || !sk) return;
    const m = MOUNTS[mk];
    u.mountCd = sk.cd;
    const foes = this.alive(u.side === 'ally' ? 'enemy' : 'ally');
    const friends = this.alive(u.side);
    const R = sk.castRange ?? 3;
    const tier = rangeTier(R);
    const ttl = TIER_TTL[tier];
    const sig = vfxOf(sk, false);
    // 坐骑技能统一用坐骑的点缀色，不用技能签名色：
    // 玩家看到金色扑击就知道是玄豹，不必去读技能名（美术 §7.3⑤ 的同一逻辑）
    const color = m.accent;
    this.castAnim(u);
    this.windup(u, R, color);
    this.emitAudio({ id: 'cast_generic', x: u.x, arenaW: this.W,
      variant: u.gender ? { subclass: u.subclass, gender: u.gender } : undefined });

    const inR = foes.filter((f) => dist(f, u) <= R + f.hitRadius);

    switch (mk) {
      case 'elephant': {
        // 战象踏阵：范围物伤 + 眩晕。象的战场价值就是「碾过去，什么都站不住」
        for (const e of inR) {
          this.dealSkill(u, e, u.derived.pDmg * 2.2, 'physical');
          if (e.bodyType !== 'giant' && e.bodyType !== 'titan') {
            e.stunUntil = Math.max(e.stunUntil, this.time + 1.2);
            this.emitAudio({ id: 'cc_stun', x: e.x, arenaW: this.W });
          }
        }
        this.emit('shock', u.x, u.y, color, ttl, { r: R, tier, motion: sig.motion, sizeMul: sig.sizeMul });
        if (inR.length) this.pushLog(`${u.name} 驱${m.name}踏阵（${inR.length} 目标 · 眩晕）`);
        break;
      }
      case 'leopard': {
        // 玄豹扑杀：位移到最残血目标 + 必定暴击。豹子的定义就是精准点杀
        const t = inR.length ? this.lowestHp(inR) : null;
        if (t) {
          const ox = u.x, oy = u.y;
          u.x = clamp(t.x, 0.6, this.W - 0.6);
          u.y = clamp(t.y + 0.9, 0.6, this.H - 0.6);
          this.faceToward(u, t);
          this.dealSkill(u, t, u.derived.pDmg * 3.0, 'physical', true);
          this.emit('trail', ox, oy, color, ttl, { tx: u.x, ty: u.y, r: R, tier, motion: sig.motion, sizeMul: sig.sizeMul });
          this.emit('beam', u.x, u.y, color, ttl * 0.4, {
            tx: t.x, ty: t.y, r: 0.3, tier, thickness: beamThickness(R), motion: sig.motion, sizeMul: sig.sizeMul,
          });
          this.pushLog(`${u.name} 纵${m.name}扑杀 ${t.name}（必暴）`);
        }
        break;
      }
      case 'tiger': {
        // 白额虎啸：范围减速 + 自身增伤。虎啸是「威慑」——让对面动不了，自己更能打
        for (const e of inR) {
          e.slowUntil = Math.max(e.slowUntil ?? 0, this.time + 3);
          e.slowPct = Math.max(e.slowPct ?? 0, 50);
        }
        u.dmgMult *= 1.25;
        const back = u.dmgMult;
        this.schedule(5, () => { u.dmgMult = Math.max(1, back / 1.25); });
        this.emit('ring', u.x, u.y, color, ttl, { r: R, tier, motion: sig.motion, sizeMul: sig.sizeMul });
        this.emit('bubble', u.x, u.y, color, ttl * 0.7, { r: u.hitRadius * 1.9 });
        // v2.9.10 状态技底部光环：虎啸是威慑型状态技，脚下常驻一圈光环标示"已施加状态"
        this.emit('ring', u.x, u.y, color, ttl * 1.4, { r: 1.0, tier: 'self', motion: sig.motion, sizeMul: sig.sizeMul });
        this.emit('bubble', u.x, u.y, color, ttl * 1.4, { r: u.hitRadius * 2.2, alphaFrom: 0.22, alphaTo: 0 });
        this.pushLog(`${u.name} ${m.name}长啸（${inR.length} 目标减速 · 自身增伤 25%）`);
        break;
      }
      case 'redhare': {
        // 赤兔疾驰：全队移速 / 攻速。赤兔在史料里从来不是武器，是**机动性**本身
        for (const a of friends) {
          a.derived.moveSpeed = clamp(a.derived.moveSpeed * 1.6, 0, 95);
          a.derived.atkSpeed = clamp(a.derived.atkSpeed + 25, 0, 260);
          this.emit('light', a.x, a.y, color, 0.5, { r: a.hitRadius * 1.6 });
          // v2.9.10 状态技底部光环：每名获得增益的友军脚下各一圈光环
          this.emit('ring', a.x, a.y, color, 0.7, { r: a.hitRadius * 1.3, tier: 'self', motion: sig.motion, sizeMul: sig.sizeMul });
        }
        // 骑手脚下主光环（最大的一圈）
        this.emit('ring', u.x, u.y, color, ttl * 1.4, { r: 1.2, tier: 'self', motion: sig.motion, sizeMul: sig.sizeMul });
        // 8s 后原样退回：不做永久 buff，否则一场打久了全队移速会被反复乘到上限，
        // 「疾驰」这个技能在第 3 次施放后就再也看不出效果了
        const snapshot = friends.map((a) => ({ a, ms: a.derived.moveSpeed, as: a.derived.atkSpeed }));
        this.schedule(8, () => {
          for (const s of snapshot) {
            if (!s.a.alive) continue;
            s.a.derived.moveSpeed = s.ms / 1.6;
            s.a.derived.atkSpeed = Math.max(0, s.as - 25);
          }
        });
        this.emit('light', u.x, u.y, color, ttl, { r: R, tier, motion: sig.motion, sizeMul: sig.sizeMul });
        this.pushLog(`${u.name} 策${m.name}疾驰（全队移速 +60% / 攻速 +25%，8 秒）`);
        break;
      }
      case 'ox': {
        // 蛮牛顶撞：直线穿刺 + 定身。牛是一条直线上的力量，不是范围
        const t = inR.length ? this.nearest(inR, u) : null;
        if (t) {
          this.faceToward(u, t);
          const dx = t.x - u.x, dy = t.y - u.y, dd = len2d(dx, dy) || 1;
          const ex = u.x + (dx / dd) * R, ey = u.y + (dy / dd) * R;
          // 线段命中判定：点到线段距离 <= 0.9 格 + 受击半径
          for (const e of foes) {
            const t01 = clamp(((e.x - u.x) * dx + (e.y - u.y) * dy) / (dd * dd), 0, 1);
            const px = u.x + dx * t01, py = u.y + dy * t01;
            if (len2d(e.x - px, e.y - py) > 0.9 + e.hitRadius) continue;
            this.dealSkill(u, e, u.derived.pDmg * 2.0, 'physical');
            if (e.bodyType !== 'giant' && e.bodyType !== 'titan') {
              e.rootUntil = Math.max(e.rootUntil, this.time + 1.0);
              this.emitAudio({ id: 'cc_root', x: e.x, arenaW: this.W });
            }
          }
          this.emit('beam', u.x, u.y, color, ttl, {
            tx: ex, ty: ey, r: 0.4, tier, thickness: beamThickness(R) + 1, motion: sig.motion, sizeMul: sig.sizeMul,
          });
          this.pushLog(`${u.name} 御${m.name}冲撞（直线穿刺 · 定身）`);
        }
        break;
      }
    }
  }

  // ══ v2.6 §2 动作状态写入 ════════════════════════════════════════════
  // 全部由仿真侧写，渲染只读。渲染层自己算「上一帧到这一帧动了多少」听起来更省事，
  // 但帧率一波动动作就会抽搐，而且回放（固定步长）和实况（可变帧率）会呈现不同动作。
  private faceToward(u: Unit, t: { x: number }) {
    if (Math.abs(t.x - u.x) < 0.05) return;
    u.facing = t.x >= u.x ? 1 : -1;
  }
  private attackAnim(u: Unit) { u.attackAnimAt = this.time; }
  private castAnim(u: Unit) { u.castAnimAt = this.time; }
  private moveAnim(u: Unit) { u.moveAnimUntil = this.time + 0.12; }

  // ══ v2.6 §3 敌方补给建筑 ═══════════════════════════════════════════

  /** 本场已生成的建筑（按 kind 计数，供上限与战报使用） */
  buildings: Unit[] = [];

  /**
   * 建筑落地。血量按层深 scaleHp 放大，与波次怪同一条缩放线——
   * 否则 20 层时营房会脆得像纸，「拆楼」这个决策直接消失。
   */
  spawnBuildings(placements: BuildingPlacement[], layer: number, scaleHp: number, scaleDmg: number) {
    for (const p of placements) {
      const def = BUILDINGS[p.kind];
      const hp = Math.max(1, Math.round(def.hp * scaleHp));
      const derived: DerivedAttrs = derive({ con: 10, str: 6, agi: 1, int: 1 });
      derived.hp = hp;
      derived.pDmg = Math.round((def.atk ?? 0) * scaleDmg);
      derived.mDmg = 0;
      derived.moveSpeed = 0;   // 建筑不动。这是它全部战术意义的前提
      derived.dodge = 0;       // 也不闪避：一栋楼躲开箭矢是荒谬的
      derived.atkSpeed = 0;
      const u: Unit = {
        id: nextBuildingId(),
        side: 'enemy',
        name: def.name,
        category: 'tank', subclass: 'physTank',
        damageType: 'physical',
        x: clamp(p.pos.x, 0.8, this.W - 0.8),
        y: clamp(p.pos.y, 0.8, this.H - 0.8),
        hp, maxHp: hp,
        primary: { con: 10, str: 6, agi: 1, int: 1 },
        derived,
        cd: def.atkInterval ?? 2,
        skill: { id: 'none', name: '无', cd: 0, damageType: 'physical', desc: '' },
        skillCd: Number.POSITIVE_INFINITY,
        alive: true, shield: 0, rootUntil: 0, stunUntil: 0, tauntUntil: 0,
        dmgMult: 1, level: layer, flash: 0,
        bodyType: def.bodyType, gender: 'male', hitRadius: hitRadiusOf(def.bodyType) * 1.25,
        isBuilding: true, buildingKind: p.kind,
        spawnTimer: 0, spawnedTotal: 0,
      };
      this._push(u);
      this.buildings.push(u);
      this.pushLog(`发现${def.name}：${def.threat}`);
    }
    // 开场立即产出 initial 那一批（驻守兵 / 巢穴里已成形的龙）。
    // 放在全部建筑落地之后统一执行，保证产出顺序只由 placements 顺序决定（可回放）。
    for (const b of this.buildings) this.buildingInitialSpawn(b, scaleHp, scaleDmg);
  }

  private buildingInitialSpawn(b: Unit, scaleHp: number, scaleDmg: number) {
    const def = BUILDINGS[b.buildingKind!];
    const sp = def.spawn;
    if (!sp) return;
    for (let i = 0; i < sp.initial; i++) {
      // 恶龙巢穴：第 1 只是成年龙，其余 4 只是幼龙（需求 #3 的原话）
      const kind: BuildingSpawnKind =
        b.buildingKind === 'dragon_lair' ? (i === 0 ? 'adult_dragon' : 'whelp') : sp.kind;
      this.spawnFromBuilding(b, kind, scaleHp, scaleDmg, i);
    }
    b.spawnedTotal = sp.initial;
    b.spawnTimer = sp.interval;
  }

  /** 建筑产出一个单位。位置绕建筑均匀散布，避免全部叠在同一个像素上 */
  private spawnFromBuilding(b: Unit, kind: BuildingSpawnKind, scaleHp: number, scaleDmg: number, idx: number) {
    const t = SPAWN_TEMPLATES[kind];
    const primary: PrimaryAttrs = { ...t.basePrimary };
    const lv = Math.max(1, b.level);
    for (const k of ['con', 'str', 'agi', 'int'] as (keyof PrimaryAttrs)[]) {
      primary[k] = primary[k] + (lv - 1) * 0.8;
    }
    const derived: DerivedAttrs = derive(primary);
    derived.hp = Math.max(1, Math.round(derived.hp * scaleHp * t.hpMult));
    const hp = derived.hp;
    const ang = (idx / 5) * Math.PI * 2 + (b.x + b.y);
    const rr = b.hitRadius + 0.9;
    const u: Unit = {
      id: nextBuildingId(),
      side: 'enemy',
      name: t.name,
      category: 'warrior', subclass: t.subclass,
      damageType: SUBCLASS_INFO[t.subclass].damageType,
      x: clamp(b.x + dcos(ang) * rr, 0.6, this.W - 0.6),
      y: clamp(b.y + dsin(ang) * rr, 0.6, this.H - 0.6),
      hp, maxHp: hp, primary, derived,
      cd: 0,
      skill: t.skill ?? { id: 'none', name: '普攻', cd: 0, damageType: 'physical', desc: '' },
      skillCd: t.skill ? t.skill.cd * 0.5 : Number.POSITIVE_INFINITY,
      alive: true, shield: 0, rootUntil: 0, stunUntil: 0, tauntUntil: 0,
      dmgMult: scaleDmg * t.dmgMult, level: lv, flash: 0,
      bodyType: t.bodyType, gender: 'male', hitRadius: hitRadiusOf(t.bodyType),
      monsterKind: t.monsterKind,
    };
    this._push(u);
    // v2.9.x 产兵预警（需求⑤：巢穴/兵营动画）：单位从建筑拔出时，在建筑本体点一圈预警环，
    // 读作「这栋建筑正在产兵」，比光在单位身上冒一个 rift 更指向来源。克制不叠满屏。
    this.emit('ring', b.x, b.y, BUILDINGS[b.buildingKind!].accent, 0.32, { r: b.hitRadius + 0.5, alphaFrom: 0.6, alphaTo: 0 });
    this.emit('rift', u.x, u.y, BUILDINGS[b.buildingKind!].accent, 0.4, { r: 0.6, alphaFrom: 0.9, alphaTo: 0 });
    // v2.9.x 龙巢/龙穴专属产兵特效（需求⑤：巢穴动画优化）：在通用预警环之上，再给来源建筑
    // 多一层「主题色 pop」，让玩家一眼读出「这栋龙巢正在孵蛋 / 这条龙穴刚破壳」。克制不叠满屏。
    // 纯 emit，不写单位状态 → 不进回放 checksum，parity 天然安全。
    if (b.buildingKind === 'dragon_nest') {
      this.emit('nova', b.x, b.y, BUILDINGS.dragon_nest.accent, 0.30, { r: b.hitRadius + 0.4, sizeMul: 0.9, alphaFrom: 0.7, alphaTo: 0 });
    } else if (b.buildingKind === 'dragon_lair' && idx === 0) {
      this.emit('quake', b.x, b.y, BUILDINGS.dragon_lair.accent, 0.5, { r: b.hitRadius + 0.8, sizeMul: 1.1 });
    }
    this.emitAudio({ id: 'summon_spawn', x: u.x, arenaW: this.W });
  }

  /** 建筑每帧行为：塔开火 / 产兵器计时。建筑不索敌移动、不施法。 */
  private tickBuilding(b: Unit, dt: number) {
    const def = BUILDINGS[b.buildingKind!];
    // ① 塔开火
    if (isTower(b.buildingKind!) && def.atk && def.range) {
      const foes = this.alive(b.side === 'ally' ? 'enemy' : 'ally')
        .filter((f) => !f.isBuilding && dist(f, b) <= def.range! + f.hitRadius);
      if (foes.length) {
        b.cd -= dt;
        if (b.cd <= 0) {
          const t = this.nearest(foes, b);
          this.faceToward(b, t);
          this.attackAnim(b);
          this.basicAttack(b, t);
          b.cd = def.atkInterval ?? 2;
        }
      }
    }
    // ② 产兵计时（interval<=0 = 一次性建筑，开场放完就是一栋纯血包）
    const sp = def.spawn;
    if (!sp || sp.interval <= 0) return;
    if ((b.spawnedTotal ?? 0) >= sp.cap) return;
    b.spawnTimer = (b.spawnTimer ?? sp.interval) - dt;
    if (b.spawnTimer > 0) return;
    b.spawnTimer = sp.interval;
    b.spawnedTotal = (b.spawnedTotal ?? 0) + 1;
    this.spawnFromBuilding(b, sp.kind, this.buildScaleHp, this.buildScaleDmg, b.spawnedTotal);
    this.pushLog(`${def.name} 产出 ${SPAWN_TEMPLATES[sp.kind].name}（${b.spawnedTotal}/${sp.cap}）`);
  }

  // 建筑产兵需要在 tick 里复用当初的缩放系数，存一份避免层层传参
  private buildScaleHp = 1;
  private buildScaleDmg = 1;
  setBuildingScale(hp: number, dmg: number) { this.buildScaleHp = hp; this.buildScaleDmg = dmg; }

  // 手动触发（UI 技能按钮）：强制施放某子类已就绪的友方技能
  forceCast(subclass: string): boolean {
    const u = this.units.find((x) => x.alive && x.side === 'ally' && x.subclass === subclass && x.skillCd <= 0);
    if (!u) return false;
    this.castSkill(u);
    return true;
  }

  // ══ v2.9.x 面包车车队（cosplay 五菱宏光）═══════════════════════════
  //
  // 需求原文拆成四段状态，**全部挂在面包车单位自己身上**，没有全局状态机：
  //   ① 开场冲锋：vanBuffUntil 窗口内速度 ×2 —— 车队像真的踩了油门
  //   ② 撞击：van_ram 命中前排，伤害 ∝ 当前速度，命中者被击退（"击退阵型"）
  //   ③ 开门：vanRamDone 置位后进入卸人状态
  //   ④ 逐人下落：每 dropInterval 秒下一个人，受同屏上限约束
  //
  // 状态放单位上而不放 sim 上的理由：一辆车被打爆时，它的卸人进度必须随之消失。
  // 全局队列做这件事得额外记 owner 并在死亡回调里清理，那是 bug 的温床——
  // 而这类 bug 的表现是"车都炸了还在冒人"，玩家会直接判定游戏坏了。

  private vanCfg?: VanEncounter;
  private vanScaleHp = 1;

  /**
   * 装配车队关。**必须在 makeSim 里调用**（前后端同一入口）。
   * 漏调的后果不是崩溃，而是远程回放拿到一堆既不撞人也不开门的静止面包车——
   * 胜负甚至可能一样，肉眼查不出来，这正是 1.9.0 事故的那一类。
   */
  setVanEncounter(ve: VanEncounter, scaleHp: number) {
    this.vanCfg = ve;
    this.vanScaleHp = scaleHp;
    for (const u of this.units) {
      if (u.side !== 'enemy' || u.monsterKind !== 'van') continue;
      u.vanBuffUntil = this.time + ve.openingBuffSec;
      u.vanDropLeft = ve.peoplePerVan;
      u.vanDropTimer = 0;
      u.vanRamDone = false;
    }
    this.pushLog(
      `面包车队冲入场地：${ve.vanCount} 辆 × ${ve.peoplePerVan} 人，` +
      `开场 ${ve.openingBuffSec} 秒油门到底（撞击最猛，卸人后威胁减半）`,
    );
  }

  /**
   * 面包车当前速度乘子：开场窗口内 2，之后 1。
   *
   * 为什么不直接把 derived.moveSpeed ×2：moveSpeed 是被 clamp 到 [0,80] 的**属性**，
   * 真实速度 = 2.0 + damp(moveSpeed) × 0.02。面包车 agi=4，moveSpeed 落在 20 上下，
   * 把这个属性翻倍只能把速度从 ~2.4 推到 ~2.8 —— 屏幕上是 17% 的加速，
   * 没有任何玩家会把它读成"翻倍"。需求要的是"开场撞击速度非常快"，那就得乘在速度上。
   *
   * 撞击伤害共用这同一个乘子：玩家看到的「冲得飞快」和跳出来的伤害数字必须同源，
   * 否则他学不到"车快=撞得疼"这条因果，而这条因果是整个关卡的玩法核心。
   */
  private vanSpeedMult(u: Unit): number {
    if (u.monsterKind !== 'van') return 1;
    return (u.vanBuffUntil ?? 0) > this.time ? VAN_OPENING_SPEED_MUL : 1;
  }

  /**
   * 撞击结算。需求原文「撞击伤害 ~ 物理攻击 × 移速」。
   *
   * 字面照抄会出事：moveSpeed 是 0~80 的属性值而不是倍率，pDmg × 20 一撞清场。
   * 这里取它的**设计意图**——伤害与当前速度成正比：
   *   ramDmg = pDmg × VAN_RAM_MUL × vanSpeedMult
   * 开场 2 倍、卸人后 1 倍，比值精确 2:1，正是"开场最猛、后续威胁明显下降"。
   */
  private dealRam(v: Unit, foes: Unit[]) {
    const mult = this.vanSpeedMult(v);
    const opening = mult > 1;
    for (const t of foes) {
      this.dealSkill(v, t, v.derived.pDmg * VAN_RAM_MUL * mult, 'physical');
      this.vanKnockback(t, v, opening ? VAN_RAM_KNOCKBACK : VAN_RAM_KNOCKBACK * 0.5);
    }
    // 撞完就开门：这一帧起进入卸人状态（需求"撞击完毕后打开车门"）
    v.vanRamDone = true;
    v.vanDropTimer = 0;
  }

  /**
   * 击退。引擎原本只有同侧「分离推挤」，没有真正的击退，所以这里新写一条，
   * 但**抗性规则与推挤完全一致**，避免同一个身体在两套物理里表现矛盾：
   *   giant / titan 免疫（碾压级质量，一辆面包车推不动巨像）
   *   obese 0.35 / colossal 0.25（有质量但不是免疫）
   *   重击霸体窗口内免疫（heavyArmorUntil 优先于体型，与推挤同一条规则）
   *
   * 距离取 1.6 格 ≈ 一个近战身位：读作"阵型被撕开一个位置"而不是"被推到地图边"。
   * 被推进墙/岩浆是不可接受的（那是把击退变成秒杀），所以落点必须过 isWalkable。
   */
  private vanKnockback(t: Unit, from: Unit, distTiles: number) {
    if ((t.heavyArmorUntil ?? 0) > this.time) return;
    const resist = t.bodyType === 'giant' || t.bodyType === 'titan' ? 0
      : t.bodyType === 'obese' ? 0.35
      : t.bodyType === 'colossal' ? 0.25 : 1;
    if (resist <= 0) return;
    const dx = t.x - from.x, dy = t.y - from.y;
    const d = len2d(dx, dy) || 1;
    const step = distTiles * resist;
    const nx = clamp(t.x + (dx / d) * step, 0.6, this.W - 0.6);
    const ny = clamp(t.y + (dy / d) * step, 0.6, this.H - 0.6);
    // 逐轴退让：整点不可走就试单轴，都不行就不推（宁可不击退，也不把人塞进墙里）
    if (this.isWalkable(nx, ny)) { t.x = nx; t.y = ny; }
    else if (this.isWalkable(nx, t.y)) t.x = nx;
    else if (this.isWalkable(t.x, ny)) t.y = ny;
  }

  /**
   * 车队每帧：只有「已撞击 + 还有人 + 同屏没到顶」的车才卸人。
   *
   * 同屏上限到顶时**车门不关，只是下人变慢**（计时器照常重置）。
   * 这个取舍是明确的：宁可让卸人节奏被拖慢，也不允许掉帧——
   * 中端机 60fps 是这一版的验收线，掉帧比少几个人可感知得多。
   */
  private tickVanConvoy(dt: number) {
    const ve = this.vanCfg;
    if (!ve) return;
    // 只数活人：帧率预算约束的是"同时在跑的单位"，尸体不进演算
    let alive = 0;
    for (const u of this.units) if (u.alive && u.monsterKind === 'van_person') alive++;
    for (const v of this.units) {
      if (!v.alive || v.monsterKind !== 'van') continue;
      if (!v.vanRamDone || (v.vanDropLeft ?? 0) <= 0) continue;
      v.vanDropTimer = (v.vanDropTimer ?? 0) - dt;
      if ((v.vanDropTimer ?? 0) > 0) continue;
      v.vanDropTimer = ve.dropInterval;
      if (alive >= ve.concurrentPeopleCap) continue; // 到顶就等下一个间隔
      // v2.9.x 开门瞬间：第一人下车 = 车门打开。只在这一刻画（vanDropLeft 仍是满值），
      // 给一个车门光 + 光圈，克制不叠特效；后续逐人下落走 spawnVanPerson 的落地 VFX。
      if (v.vanDropLeft === ve.peoplePerVan) {
        this.emit('ring', v.x, v.y, '#ffd23f', 0.35, { r: v.hitRadius + 0.6, alphaFrom: 0.85, alphaTo: 0 });
        this.emit('rift', v.x, v.y, '#ffd23f', 0.3, { r: v.hitRadius * 1.4, alphaFrom: 0.7, alphaTo: 0 });
      }
      v.vanDropLeft = (v.vanDropLeft ?? 0) - 1;
      this.spawnVanPerson(v, ve, ve.peoplePerVan - (v.vanDropLeft ?? 0));
      alive++;
    }
  }

  /**
   * 下一个面包人。属性严格按需求：= 车的 1/2，移速 +30、攻速 +50。
   *
   * 取的是车的**当前 primary**（已含层深等级），不是模板基础值——
   * 否则 30 层的车会掉出 1 级的人，"车 1/2"这条关系在深层直接失效。
   *
   * 特性池与角色一致随机（需求原文）：走 rollTrait(this.rng)，消费 sim 的种子 RNG。
   * 这是本关唯一的战斗内随机源，前后端同 seed 必然同人同特性。
   */
  private spawnVanPerson(v: Unit, ve: VanEncounter, idx: number) {
    const m = ve.personPrimaryMul;
    const primary: PrimaryAttrs = {
      con: v.primary.con * m, str: v.primary.str * m,
      agi: v.primary.agi * m, int: v.primary.int * m,
    };
    const traitId = rollTrait(this.rng);
    const derived: DerivedAttrs = applyTraitStatic(derive(primary), traitId);
    derived.hp = Math.max(1, Math.round(derived.hp * this.vanScaleHp));
    // 移速/攻速加成走 derive 同款上限，不破表（破表会让 dampMoveSpeed 的分段失去意义）
    derived.moveSpeed = clamp(derived.moveSpeed + ve.personMoveSpeedAdd, 0, 80);
    derived.atkSpeed = clamp(derived.atkSpeed + ve.personAtkSpeedAdd, 0, 250);
    const hp = derived.hp;
    // 下落点：绕车身一圈散开。用 idx 派生角度（非随机）——同 seed 同落点，且不吃 RNG，
    // 免得"下人"这件事把战斗内 RNG 流搅乱，害得特性 roll 结果依赖卸人顺序的浮点误差
    const ang = (idx / 5) * 360 + (v.x + v.y);
    const rr = v.hitRadius + 0.8;
    const u: Unit = {
      id: nextBuildingId(),
      side: 'enemy',
      name: '面包人',
      category: 'warrior', subclass: 'charge',
      damageType: 'physical',
      x: clamp(v.x + dcos(ang * DEG) * rr, 0.6, this.W - 0.6),
      y: clamp(v.y + dsin(ang * DEG) * rr, 0.6, this.H - 0.6),
      hp, maxHp: hp, primary, derived,
      cd: 0,
      skill: { id: 'none', name: '普攻', cd: 0, damageType: 'physical', desc: '' },
      skillCd: Number.POSITIVE_INFINITY,
      alive: true, shield: 0, rootUntil: 0, stunUntil: 0, tauntUntil: 0,
      dmgMult: v.dmgMult, level: v.level, flash: 0,
      bodyType: 'medium', gender: 'male', hitRadius: hitRadiusOf('medium'),
      monsterKind: 'van_person',
      baseMove: derive(primary).moveSpeed * BODY_INFO.medium.msMult,
      traitId,
    };
    this._push(u);
    // 下车这一下要有落地感：车门光 + 落地尘环 + 一次 spawn 音（不叠满屏特效，克制优先）
    this.emit('rift', u.x, u.y, '#ffd23f', 0.32, { r: 0.5, alphaFrom: 0.85, alphaTo: 0 });
    this.emit('ring', u.x, u.y, '#e8e8ec', 0.26, { r: 0.55, alphaFrom: 0.6, alphaTo: 0 });
    this.emitAudio({ id: 'summon_spawn', x: u.x, arenaW: this.W });
  }

  // 波次增援（BattleScreen 在清场后调用，开发 §7 / 需求 4.4.3）
  addUnits(units: Unit[]) {
    for (const uu of units) this._push(uu);
  }

  tick(dt: number) {
    if (this.over) return;
    this.time += dt;
    this._updateTileEffects();
    // 队伍协同系数已移除：反"堆一人"改由敌方针对最强被动（coherence.ts）实现。
    // v1.5 天气「丰茂」：每秒回血 = 最大生命 × regenPct（仅存活单位，不超上限、不触发死亡）
    for (const u of this.units) {
      const rp = u.derived.regenPct ?? 0;
      if (!u.alive || rp <= 0) continue;
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * rp * dt);
    }

    // v2.4.4 Boss 王座回血：站在 B 格上的 Boss 每秒回 1.5% 最大生命（特色地块生效，与掩体/水域同源）
    for (const u of this.units) {
      if (!u.alive || !u.isBoss) continue;
      if (this.arenaTile(Math.floor(u.y), Math.floor(u.x)) !== 'B') continue;
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.015 * dt);
    }

    // v2.9.3 岩浆灼烧：站在 'M' 格上的单位每秒损失 3% 最大生命（真伤，无视抗性；
    // 不飘字——血条自掉即反馈。灼烧可致死，走统一死亡结算无击杀成长）
    for (const u of this.units) {
      if (!u.alive || u.isBuilding) continue;
      const ch = this.arenaTile(Math.floor(u.y), Math.floor(u.x));
      if (ch !== 'M') continue;
      u.hp -= u.maxHp * 0.03 * dt;
      this.killIfDown(u, undefined);
    }

    // v2.9.6 龙吐息 DoT：灼烧（火龙）/ 剧毒（毒龙）按最大生命比例掉血，可致死。
    // 与岩浆同走 killIfDown(undefined)，无击杀者 → 不记账成长（避免凭空成长）。
    for (const u of this.units) {
      if (!u.alive || u.isBuilding) continue;
      let dot = 0;
      if (u.burnUntil && u.burnUntil > this.time) dot += u.maxHp * (u.burnDps ?? 0.05) * dt;
      if (u.poisonUntil && u.poisonUntil > this.time) dot += u.maxHp * 0.05 * dt;
      if (dot > 0) {
        u.hp -= dot;
        this.killIfDown(u, undefined);
      }
    }

    // 预警到期 → 兑现（必须在单位循环之前，否则伤害要慢一帧）
    this.runPending();

    // v2.9.8 女娲「开局立即释放大招」①：第一 tick 强制施法一次。
    // 不能靠把初始 skillCd 置 0 来实现——通用 AI 只在「进入普攻射程」的分支里才施法，
    // 而开场双方相距十几格，女娲要跑到能平 A 才肯放第一个召唤物，前 10 秒始终是缺编作战。
    if (!this.openingCastDone) {
      this.openingCastDone = true;
      for (const u of this.units) {
        if (!u.alive || u.isSummon || u.isBuilding) continue;
        if (u.side !== 'ally' || u.skill.id !== NUWA_SKILL_ID) continue;
        u.skillCd = 0;
        if (this.shouldCast(u)) {
          this.pushLog(`${u.name} 开局造化 → 立即召唤`);
          this.castSkill(u);
        }
      }
    }

    // 视觉元素衰减
    for (const f of this.floaters) { f.ttl -= dt; f.y -= dt * 0.6; }
    for (const p of this.projectiles) {
      p.prevX = p.x; p.prevY = p.y;
      p.ttl -= dt;
      const dx = p.tx - p.x, dy = p.ty - p.y, d = len2d(dx, dy) || 1;
      p.x += (dx / d) * 12 * dt; p.y += (dy / d) * 12 * dt;
    }
    // delay 用于 long 档「预警 → 兑现」两段与弹幕错时，先扣 delay 再扣 ttl
    for (const e of this.effects) {
      if (e.delay && e.delay > 0) { e.delay -= dt; continue; }
      e.ttl -= dt;
    }
    this.floaters = this.floaters.filter((f) => f.ttl > 0);
    if (this.floaters.length > MAX_FLOATERS) this.floaters.splice(0, this.floaters.length - MAX_FLOATERS);
    this.projectiles = this.projectiles.filter((p) => p.ttl > 0);
    this.effects = this.effects.filter((e) => e.ttl > 0);

    // v2.9.x 面包车车队卸人：放在单位主循环之前，新下来的人当帧即可行动
    // （与建筑产兵同一约定：spawnFromBuilding 也是在循环内 push 后当帧生效）。
    // 循环内 push 是安全的：新单位 monsterKind='van_person'，会被车队循环的 'van' 判断跳过。
    this.tickVanConvoy(dt);

    for (const u of this.units) {
      u.prevX = u.x; u.prevY = u.y; // 渲染插值锚点：本 tick 起点位置（动画/位移解耦）
      if (!u.alive) continue;
      u.flash = Math.max(0, u.flash - dt);
      // v3.0 势能·脱战衰减：技能吸血层仅在脱战（1 秒未普攻）后，每秒下降 1 层。
      // 攻击途中不衰减、受击不衰减——把「持续输出」变成续航来源，契合突击战士主养定位。
      // 用 traitTimer 累计脱战秒数，满 1 秒才扣 1 层；否则 20Hz 的 tick 会把层数一帧抽干。
      if (u.traitId === 'momentum' && (u.lifestealStacks ?? 0) > 0) {
        const idle = this.time - (u.lastBasicAt ?? this.time);
        if (idle >= 1) {
          let acc = (u.traitTimer ?? 0) + dt;
          while (acc >= 1 && (u.lifestealStacks ?? 0) > 0) {
            u.lifestealStacks = (u.lifestealStacks ?? 0) - 1;
            acc -= 1;
          }
          u.traitTimer = acc; // 保留小数秒，下个 tick 继续累计
        } else {
          u.traitTimer = 0;   // 重新交战：清零累计
        }
      }
      // ── vX 新增 6 特性·周期逻辑（每秒/dt 驱动）──
      // 大心脏：每 4s 窗口评估，累计受伤 < 50% 最大生命 → 回血 50% + 永久 +2% 攻速/双攻
      if (u.traitId === 'heart') {
        u.heartTim = (u.heartTim ?? 0) + dt;
        if (u.heartTim >= TRAIT_CFG.heartWindow) {
          u.heartTim = 0;
          if ((u.heartLoss ?? 0) < TRAIT_CFG.heartHealPct * u.maxHp) {
            u.hp = Math.min(u.maxHp, u.hp + TRAIT_CFG.heartHealPct * u.maxHp);
            u.derived.atkSpeed *= 1 + TRAIT_CFG.heartAsPct;
            u.derived.pDmg *= 1 + TRAIT_CFG.heartDmgPct;
            u.derived.mDmg *= 1 + TRAIT_CFG.heartDmgPct;
            this.floaters.push({ x: u.x, y: u.y - 0.9, text: `大心脏 +${Math.round(TRAIT_CFG.heartHealPct * 100)}%`, color: '#ff8fb0', ttl: 1.0 });
            this.pushLog(`${u.name} 大心脏触发 → 回血 +${Math.round(TRAIT_CFG.heartHealPct * 100)}% 攻速/双攻 +${Math.round(TRAIT_CFG.heartAsPct * 100)}%`);
          }
          u.heartLoss = 0;
        }
      }
      // 慢热型：每秒全属性 +2%（独立乘）。开局已在 makeAlly 经 staticMul 削 -30% 攻速/-40% 双攻。
      if (u.traitId === 'slowburn') {
        u.slowTim = (u.slowTim ?? 0) + dt;
        if (u.slowTim >= 1) {
          u.slowTim -= 1;
          u.derived.pDmg *= 1 + TRAIT_CFG.slowRampPct;
          u.derived.mDmg *= 1 + TRAIT_CFG.slowRampPct;
          u.derived.atkSpeed *= 1 + TRAIT_CFG.slowRampPct;
          u.derived.moveSpeed *= 1 + TRAIT_CFG.slowRampPct;
        }
      }
      // 时空拓印：每 3s 窗口评估，累计受伤 > 30% 最大生命 → 瞬移到 4 格外（6s 冷却）
      if (u.traitId === 'spacetime') {
        u.stTim = (u.stTim ?? 0) + dt;
        if (u.stTim >= TRAIT_CFG.stWindow) {
          u.stTim = 0;
          if ((u.stLoss ?? 0) > TRAIT_CFG.stLossPct * u.maxHp && (u.stCdUntil ?? 0) <= this.time) {
            this.teleportAway(u, TRAIT_CFG.stMinDist);
            u.stCdUntil = this.time + TRAIT_CFG.stCd;
            this.pushLog(`${u.name} 时空拓印 → 瞬移脱险`);
          }
          u.stLoss = 0;
        }
      }
      // 归来者：复活后每秒流失 8% 最大生命（可致死；此时 returnerUsed=1 → 永久死亡，不再复活）
      if (u.returnerDrain) {
        u.hp -= u.maxHp * TRAIT_CFG.returnerDrainPct * dt;
        if (u.hp <= 0) { u.hp = 0; this.killIfDown(u, undefined); }
      }

      u.skillCd = Math.max(0, u.skillCd - dt);
      // v2.6 §2 坐骑技能 CD 独立走表，不受眩晕/定身影响的只是「计时」，
      // 施放本身仍然要过下面的 stunUntil 门槛——被打晕的人放不出坐骑技能。
      if (u.mountCd !== undefined) u.mountCd = Math.max(0, u.mountCd - dt);
      // v2.6 §3 建筑：不索敌、不移动、不走下面的通用 AI，单独处理后直接跳过
      if (u.isBuilding) { this.tickBuilding(u, dt); continue; }

      // ── v1.8.4 兽类专属特性（敌方）：产仔 / 双免轮换 ──
      // 下一站：母体入场 2 秒后产 3~6 只小个体（不受控制影响，确定性消费主 rng 流）
      if (u.side === 'enemy' && u.beastTrait === 'nest' && !u.nestDone && this.time >= 2) {
        this.spawnBeastlings(u);
        u.nestDone = true;
      }
      // 双免轮换：每 3 秒在 物理免疫(1) / 魔法免疫(2) 间切换（纯 time 函数，确定性）
      if (u.side === 'enemy' && u.beastTrait === 'immunity') {
        u.immunityPhase = 1 + (Math.floor(this.time / 3) % 2);
      }
      if (u.summonUntil && this.time > u.summonUntil) {
        u.alive = false;
        // 到期消散用召唤紫粒子，与"队友阵亡"的红色区分（美术 §7.4.3）
        this.emit('rift', u.x, u.y, '#9b7bff', 0.3, { r: 0.5, alphaFrom: 0.8, alphaTo: 0 });
        this.emitAudio({ id: 'summon_expire', x: u.x, arenaW: this.W });
        continue;
      }
      if (u.stunUntil > this.time || (u.kdUntil ?? 0) > this.time || (u.freezeUntil ?? 0) > this.time) continue; // v2.9 击倒=短时定身；v2.9.6 冰龙吐息冰冻等同定身

      // v2.9.9：治疗职业不再拥有独立 AI 分支。
      // v2.9.8 的专属分支（只跟着伤员走、每拍都奶）把血线长期托在 85%+，
      // 既废掉了嘲讽等低血触发机制，也让她变成一台看不出节奏的站桩泵。
      // 现在她与所有远程共用同一套索敌/推进/普攻节奏，
      // 只在 performAttack 里把「重击」这一拍分流成群疗（约 1/6 频率）。

      // v2.9.5 重新索敌节流：保持当前目标直到其死亡或 0.5s 窗口到期，避免每 tick O(n²) 全量扫描。
      // 仅用 this.time 门控，不引入 RNG，同 seed 回放完全确定。
      let target: Unit | null = null;
      const held = u.targetId ? this.units.find((x) => x.id === u.targetId) : undefined;
      if (held && held.alive && (u.retargetAt ?? 0) > this.time) {
        // v1.8.3 卡住修复（held 分支）：旧目标活着且在索敌窗口内，但被墙/水完全挡住且不在贴脸距离
        // → 不等窗口过期立即换一个可达目标，避免死追隔墙/隔水目标原地站桩。
        if (len2d(held.x - u.x, held.y - u.y) > 1 && this.pathTo(u, held.x, held.y).length === 0) {
          const alt = this.acquireReachable(u);
          if (alt) {
            target = alt;
            u.targetId = alt.id;
            u.retargetAt = this.time + 0.5;
          } else {
            target = held; // 全不可达：保持原目标（等窗口自然过期再重试）
          }
        } else {
          target = held;
        }
      } else {
        target = this.acquireTarget(u);
        // v1.8.3 卡住修复：目标被墙/水完全挡住（pathTo 空）且不在贴脸距离时，
        // 换一个可达目标，避免 AI 死追隔墙/隔水目标 → 原地站桩（既不动也不攻击）。
        // 纯确定性（BFS 结果），不引入任何随机，同 seed 回放完全一致。
        if (target && len2d(target.x - u.x, target.y - u.y) > 1) {
          const unreach = this.pathTo(u, target.x, target.y).length === 0;
          if (unreach) {
            const alt = this.acquireReachable(u);
            if (alt) target = alt;
          }
        }
        u.targetId = target?.id;
        u.retargetAt = this.time + 0.5;
      }
      if (!target) continue;
      this.faceToward(u, target);
      const d = dist(u, target);
      const range = this.attackRangeOf(u);
      // 咒火灵需要主动拉开距离，故近了也要"移动"（moveToward 内部会反向）
      const needReposition = u.summonKind === 'arcanist' && d < 4;
      if (d > range || needReposition) {
        if (u.rootUntil <= this.time) { this.moveToward(u, target, dt); this.moveAnim(u); }
        if (needReposition && d <= range) {
          u.cd -= dt;
          if (u.cd <= 0) this.performAttack(u, target); // v2.9 轻/重击统一入口
        }
      } else {
        u.cd -= dt;
        if (u.cd <= 0) this.performAttack(u, target); // v2.9 轻/重击统一入口
        if (this.shouldCast(u)) this.castSkill(u);
      }
      // 坐骑技能与角色技能并行判定：够不到人也可能放（赤兔），故放在 if/else 之外
      if (this.shouldCastMount(u)) this.castMountSkill(u);
    }

    // v2.7：死亡单位保留 CORPSE_TTL 秒（尸体窗口，渲染层播倒下动画），之后再清理。
    // alive()/索敌/攻击全部按 alive 过滤，尸体不参与任何战斗逻辑。
    this.units = this.units.filter((u) => u.alive || (u.deadAt !== undefined && this.time - u.deadAt < CORPSE_TTL));
    this.checkOver();
  }

  private checkOver() {
    // 召唤物不计入存活判定：全队阵亡只剩一个石魂卫在场时，这局已经输了。
    // 让 18s 的召唤物拖着一个必败局面，只会浪费玩家时间。
    const allies = this.alive('ally').filter((u) => !u.isSummon).length;
    const enemies = this.alive('enemy').filter((u) => !u.isSummon).length;
    if (allies === 0) { this.over = true; this.result = 'lose'; this.emitAudio({ id: 'defeat' }); }
    else if (enemies === 0) { this.over = true; this.result = 'win'; this.emitAudio({ id: 'victory' }); }
  }

  /** v2.9.6 战后评价：返回所有非建筑单位的本场统计（确定性累计，仅作展示 / MVP 奖励记账）。 */
  getBattleStats(): BattleStatRow[] {
    return this.units
      .filter((u) => !u.isBuilding)
      .map((u) => ({
        id: u.id,
        side: u.side,
        name: u.name,
        dmgDealt: Math.round(u.dmgDealt ?? 0),
        dmgTaken: Math.round(u.dmgTaken ?? 0),
        healDone: Math.round(u.healDone ?? 0),
        moveDist: Math.round(u.moveDist ?? 0),
        heroUid: u.heroUid,
      }));
  }
}
