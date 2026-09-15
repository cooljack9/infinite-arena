// 敌方补给建筑（v2.6 §3 需求 #3）
// ────────────────────────────────────────────────────────────────────────
// 设计命题：建筑不是「多几个血包」，而是给自动战斗补一层**空间决策**。
// 原本的关卡里，玩家能做的只有开战前的编队与装备；开战后场面完全由数值决定。
// 建筑引入了一个数值之外的变量——**它在哪**。
//
// 三条硬纪律，缺一条这套系统就退化成噪声：
//  ① 建筑必须「不会动、但会持续产出」。不动 = 玩家可以规划；持续产出 = 不能拖。
//     这两条合起来才构成「拆除时机」这个抉择，也就是需求里的「合理站位拆除」。
//  ② 威胁必须**可预告**。战前情报面板会列出本层建筑与它的 threat 文案；
//     玩家被恶龙巢穴打爆可以，但不能是「我压根不知道地图上有这玩意」。
//  ③ 产出必须**有硬上限**（cap）。没有上限的产兵器在长局里必然滚雪球到不可解，
//     那不是难度曲线，是设计事故。需求点名的 8 / 3 / 4 就是这个上限。
import { BuildingDef, BuildingKind, BuildingSpawnKind, PrimaryAttrs, SubClass, BodyType, MonsterKind, SkillDef } from '../types';

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  // ── 营房 ──────────────────────────────────────────────
  // 需求：「会产生普通小兵，一场对局最多 8 个」。
  // interval=9s 是按「玩家清掉一波小兵的时间」定的：比 9s 快，前线永远回不了血；
  // 比 9s 慢，营房就成了背景板。开场先给 2 个兵，让玩家在第一时间就"看到"它在工作，
  // 否则前 9 秒里这栋楼看起来完全无害，玩家会理所当然地忽略它。
  barracks: {
    kind: 'barracks',
    name: '敌军营房',
    desc: '源源不断输出普通小兵的前哨。不拆，前线永远清不干净。',
    hp: 520,
    bodyType: 'heavy',
    spawn: { kind: 'soldier', initial: 2, interval: 9, cap: 8 },
    minLayer: 2,
    weight: 34,
    threat: '每 9 秒产 1 名小兵（全场上限 8）',
    color: '#8a6a3a', dark: '#4e3a1e', accent: '#d8b070',
  },

  // ── 三种防御塔 ────────────────────────────────────────
  // 需求原文（v2.9.x #4）：「箭塔…伤害低、血少、无特性、无意义」。
  // 这条需求不是「把塔削弱到没用」，而是**确认塔的设计定位就是路边骚扰**：
  // 塔不走、不追、不索敌离开射程圈，伤害还低于同层一波小兵——玩家走过去就能拆，
  // 不拆也只是沿途挨几下不痛不痒的箭，不会因此崩盘。
  // 因此塔的威胁文案必须诚实写「可绕开、非核心」，而不是假装它是火力点。
  // 注意「无特性」是结构保证：spawnFromBuilding 不调 rollTrait（见 types.ts BuildingDef 注释）。
  // 三档塔的区别只在于「驻守兵数量 + 血厚程度」，伤害都压在同层小兵之下，不构成风险阶梯。
  tower_wood: {
    kind: 'tower_wood',
    name: '木制箭塔',
    desc: '简易箭塔。伤害有限，塔上的弓手只是沿途骚扰，不拆也死不了人。',
    hp: 380,
    bodyType: 'medium',
    atk: 26, range: 4.8, atkInterval: 1.6,
    spawn: { kind: 'soldier', initial: 1, interval: 0, cap: 1 },
    minLayer: 2,
    weight: 26,
    threat: '4.8 格内轻微点射 · 可绕开，非核心威胁',
    color: '#9a7038', dark: '#5a3f1c', accent: '#c99a52',
  },
  tower_rock: {
    kind: 'tower_rock',
    name: '岩石哨塔',
    desc: '垒石而成，比木塔耐打，但火力依旧只是骚扰级别。',
    hp: 760,
    bodyType: 'heavy',
    atk: 44, range: 5.4, atkInterval: 1.8,
    spawn: { kind: 'soldier', initial: 2, interval: 0, cap: 2 },
    minLayer: 5,
    weight: 22,
    threat: '5.4 格内轻击 · 可绕开，非核心威胁',
    color: '#7e7e86', dark: '#43434a', accent: '#b6b6c0',
  },
  tower_iron: {
    kind: 'tower_iron',
    name: '玄铁重塔',
    desc: '玄铁浇筑，硬但火力没变强多少。血厚的塔只是更费拆，不是更危险。',
    hp: 1180,
    bodyType: 'colossal',
    atk: 68, range: 6.0, atkInterval: 2.0,
    spawn: { kind: 'soldier', initial: 2, interval: 0, cap: 2 },
    minLayer: 9,
    weight: 14,
    threat: '6 格内轻击 · 可绕开，非核心威胁',
    color: '#5c6472', dark: '#2c3038', accent: '#9fb0c4',
  },

  // ── 恶龙巢 / 恶龙巢穴 ─────────────────────────────────
  // 需求：巢「产幼龙（boss 幼体），最多三条」；巢穴「一条额外的成年龙 + 四条幼龙」。
  // 幼龙 = Boss 幼体：走 dragon 怪物皮 + heavy 体型，属性按 whelp 折算。
  // 它必须**看起来就是条龙**——玩家一眼认出「这是 Boss 的崽」，才会本能地优先处理。
  // 巢穴 minLayer=12：这是全局最危险的建筑，早期刷出来就是纯粹的处刑，
  // 12 层时玩家已经有成型的装备与升星，才谈得上"高风险高回报"。
  dragon_nest: {
    kind: 'dragon_nest',
    name: '恶龙巢',
    desc: '龙卵孵化场。幼龙是 Boss 幼体，越晚拆越难收场。',
    hp: 1150,
    bodyType: 'colossal',
    spawn: { kind: 'whelp', initial: 1, interval: 12, cap: 4 },
    minLayer: 7,
    weight: 12,
    threat: '每 12 秒孵化 1 条幼龙（上限 4）',
    color: '#5a3a6a', dark: '#2e1c38', accent: '#b98cff',
  },
  dragon_lair: {
    kind: 'dragon_lair',
    name: '恶龙巢穴',
    desc: '成年恶龙的居所。开场即释放守巢成龙与四条幼龙——务必先解决它。',
    hp: 2100,
    bodyType: 'colossal',
    // initial=5 = 1 条成年龙 + 4 条幼龙，由 BattleSim 按序拆分（第 1 只是成年龙）。
    // interval=0：一次性放完。巢穴的压力来自"开场即刻的五条龙"，
    // 再加持续产出会让这层直接变成不可解，违反纪律 ③。
    spawn: { kind: 'adult_dragon', initial: 5, interval: 0, cap: 5 },
    minLayer: 12,
    weight: 6,
    threat: '开场释放 1 条成年恶龙 + 4 条幼龙（经强化）',
    color: '#6a2a2a', dark: '#331414', accent: '#ff7a5a',
  },
};

export const BUILDING_KINDS = Object.keys(BUILDINGS) as BuildingKind[];

export const buildingOf = (k: BuildingKind): BuildingDef => BUILDINGS[k];

/** 是否为塔类（有攻击的建筑）——渲染与战报都要区分「会打人的楼」和「会生崽的楼」 */
export const isTower = (k: BuildingKind): boolean => k.startsWith('tower_');

// ── 建筑产出的单位模板 ────────────────────────────────────
// 不复用 ENEMIES 列表是刻意的：波次怪的强度按 encounterBudget 结算，
// 建筑产出走的是另一条预算线（它是"额外"威胁）。混用会让两套配平互相污染。
export interface SpawnTemplate {
  name: string;
  subclass: SubClass;
  basePrimary: PrimaryAttrs;
  bodyType: BodyType;
  monsterKind?: MonsterKind;
  skill?: SkillDef;
  /** 相对波次怪的强度折算：小兵偏弱，龙类偏强 */
  hpMult: number;
  dmgMult: number;
}

export const SPAWN_TEMPLATES: Record<BuildingSpawnKind, SpawnTemplate> = {
  // 普通小兵：刻意做得比同层波次怪弱一档（hp 0.7 / dmg 0.75）。
  // 它的威胁来自**数量与持续性**，不是单体强度——
  // 若单兵和波次怪等强，营房就等于「白送一整波敌人」，那不是战术压力是数值暴力。
  soldier: {
    name: '敌军小兵', subclass: 'charge',
    basePrimary: { con: 7, str: 9, agi: 7, int: 2 },
    bodyType: 'medium',
    hpMult: 0.7, dmgMult: 0.75,
  },
  // 幼龙 = Boss 幼体：dragon 皮 + heavy 体型。
  // 强于小兵但远弱于成年龙，定位是「必须分兵处理、但不至于灭队」的中量威胁。
  whelp: {
    name: '幼龙', subclass: 'charge',
    basePrimary: { con: 11, str: 11, agi: 6, int: 4 },
    bodyType: 'heavy', monsterKind: 'dragon',
    skill: {
      id: 'whelp_breath', name: '稚焰', cd: 8, damageType: 'physical',
      desc: '锥形龙息：朝最近敌人喷向前方（范围=3×体型），火=灼烧 / 冰=冰冻 / 毒=剧毒',
      skillStyle: 'melee_burst', castRange: 2.5,
    },
    hpMult: 1.4, dmgMult: 1.1,
  },
  // 成年恶龙：colossal 体型 + 龙息。刻意不标 isBoss——
  // 它是巢穴的产物而非本层 Boss，标了会让 HUD 出现第二条 Boss 血条，
  // 玩家会误以为通关条件变了。
  adult_dragon: {
    name: '成年恶龙', subclass: 'physTank',
    basePrimary: { con: 17, str: 15, agi: 4, int: 4 },
    bodyType: 'colossal', monsterKind: 'dragon',
    skill: {
      id: 'lair_dragon_breath', name: '焚巢龙息', cd: 7, damageType: 'physical',
      desc: '巨型锥形龙息：朝最近敌人喷向前方（范围=3×体型），火=灼烧 / 冰=冰冻 / 毒=剧毒',
      skillStyle: 'bulwark_taunt', castRange: 3.5,
    },
    hpMult: 2.6, dmgMult: 1.6,
  },
};

// ── 关卡内建筑数量 ────────────────────────────────────────
// 层数越深楼越多，但封顶 3 座。上限存在的理由和 cap 一样：
// 4 座以上时屏幕上同时存在的敌方产出源会超过玩家的注意力带宽，
// 「决定先拆哪个」会退化成「随便打，反正打不完」。
export function buildingCountFor(layer: number): number {
  if (layer < 2) return 0;      // 第 1 层不放建筑：教学层要干净
  if (layer < 5) return 1;
  if (layer < 11) return 2;
  return 3;
}

/** 该层可用的建筑池（按 minLayer 过滤） */
export function availableBuildings(layer: number): BuildingDef[] {
  return BUILDING_KINDS.map((k) => BUILDINGS[k]).filter((b) => b.minLayer <= layer);
}
