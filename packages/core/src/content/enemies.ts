// 敌人模板（需求 5.6 / 开发 §1.3）+ 西方怪物（v2.5 需求 #2）
import { EnemyDef, PrimaryAttrs, SubClass, BodyType, MonsterKind, SkillDef } from '../types';
import { SUBCLASS_SKILL, SKILLS } from './skills';
import { SUBCLASS_INFO } from './classes';

const base = (con: number, str: number, agi: number, int: number): PrimaryAttrs => ({ con, str, agi, int });

// ── v2.9.x 面包车特殊关配置（cosplay 五菱宏光）──
// 设计命题（用户需求）：车队冲锋击退阵型 → 开门逐人下落；面包车专属「开场 10s 移速翻倍，
// 撞击伤害 ≈ 物理攻击 × 移速」。面包人属性 = 车 1/2、移速 +30%、攻速 +50%，对冲己方召唤师偏高。
// 绝对基础属性为 [PLACEHOLDER · 待平衡 pass]：暂按「重甲慢车」设定（高 con/str、低 agi），
// 具体数值需一轮数值 pass + 封测复跑（与 v2.9.12 封测同流程）。
export const VAN_CFG = {
  /** 面包车基础一级属性（随层深 scaleHp/scaleAtk 放大） */
  vanBasePrimary: base(16, 13, 4, 2) as PrimaryAttrs,
  /** 面包人属性 = 车基础 × 此乘子 */
  personPrimaryMul: 0.5,
  /** 面包人移速加成（百分点，+30） */
  personMoveSpeedAdd: 30,
  /** 面包人攻速加成（百分点，+50） */
  personAtkSpeedAdd: 50,
  /** 开场移速翻倍持续秒数（10） */
  openingBuffSec: 10,
  /** 撞击技能 CD（秒）：开门后仍能持续撞击，但因移速回落威胁明显下降 */
  ramCd: 3,
  /** 逐人下落间隔（秒）：避免同帧爆兵 */
  dropInterval: 0.4,
  /** 车队规模范围（4~8） */
  vanCountRange: [4, 8] as [number, number],
  /** 每辆面包人数量范围（4~10，需求原文） */
  peopleRange: [4, 10] as [number, number],
  /**
   * 面包人总数目标区间 [PLACEHOLDER · 待平衡 pass]
   *
   * 为什么需要这一条：两个范围独立均匀抽时，总人数是 4×4=16 到 8×10=80，
   * 5 倍方差。同一层难度差 5 倍不叫随机性，叫抽奖——玩家会把失败归因于运气而不是决策，
   * 这条反馈链一断，后面所有数值调整都收不到有效信号。
   *
   * 做法：先抽车数（4~8 均匀，需求原文不动），再让每车人数向总数区间收敛，
   * 且**始终落在 4~10 内**（需求原文的每车范围一格没动）。
   * 结果：总人数 28~48（1.7 倍方差），车多则每车人少、车少则每车人多——
   * "一车塞满" 和 "车队铺开" 两种观感都保留，但两局难度可比。
   *
   * 参照物：普通层单波峰值 8 人、总量 ≤24（encounter.ts buildWaves）。
   * 面包人属性 = 车 1/2，单体威胁低于常规怪，故总量给到 ~1.5 倍。
   * 验证路径：中端机 30 局跑批，记录 (总人数, 通关率, 最低帧)，把 28/48 两端各推 ±20% 复跑。
   */
  peopleTotalBand: [28, 48] as [number, number],
  /**
   * 同屏面包人上限 [PLACEHOLDER · 需中端机实测]
   *
   * 24 是普通层已验证的同屏量级（3 波 × 8 全部存活时的上限），
   * +4 给车队关一点"人真多"的观感溢价。超出的人排队等空位，
   * 车门不会因此关上——只是下人变慢。宁可下人节奏被拖慢，也不允许掉帧。
   * 验证路径：中端机（骁龙 7 系同档）跑满 8 车 × 10 人，看 p95 帧时间是否 <16.6ms。
   */
  concurrentPeopleCap: 28,
};

/** 面包车撞击技能（v2.9.x）：伤害 ≈ 物理攻击 × 当前移速（moveSpeed/100），命中击退前排 */
export const VAN_RAM_SKILL: SkillDef = {
  id: 'van_ram', name: '蛮横冲撞', cd: VAN_CFG.ramCd, damageType: 'physical',
  desc: '朝最近前排猛撞，撞击伤害 ≈ 物理攻击 × 当前移速；开场 10 秒移速翻倍，撞击最猛',
  skillStyle: 'van_ram', castRange: 1.5,
};

// 元组第 7/8 项：monsterKind（独立像素皮）+ skillOverride（西方风味技能名，复用已有签名 VFX 避免太极/青囊特效落到怪物身上）
const list: Array<[string, string, SubClass, PrimaryAttrs, boolean?, BodyType?, MonsterKind?, SkillDef?]> = [
  // 坦克
  ['e_physTank_a', '重甲卫兵', 'physTank',  base(12, 7, 3, 2)],
  ['e_physTank_b', '钢盾狂战', 'physTank',  base(14, 9, 3, 2)],
  ['e_magicTank',  '咒法石像', 'magicTank', base(13, 3, 3, 9)],
  // 战士
  ['e_charge_a',   '突袭兵',   'charge',    base(7, 12, 9, 2)],
  ['e_charge_b',   '狂暴战士', 'charge',    base(8, 14, 8, 2)],
  ['e_hexblade',   '噬魔者',   'hexblade',  base(8, 10, 8, 8)],
  // 射手
  ['e_gunner_a',   '弩手',     'gunner',    base(6, 9, 12, 3)],
  ['e_gunner_b',   '火炮兵',   'gunner',    base(6, 11, 13, 3)],
  ['e_sniper',     '神射手',   'sniper',    base(5, 11, 13, 3)],
  // 法师
  ['e_controller', '冰霜巫师', 'controller',base(5, 3, 8, 12)],
  ['e_summoner',   '亡灵术士', 'summoner',  base(7, 4, 6, 12)],
  ['e_healer',     '邪术祭司', 'healer',    base(8, 3, 5, 12)],
  // Boss（传奇赛）：v2.3 全部升级为 titan 体型（碾压级压迫感）
  ['e_boss_colossus', '巨像', 'physTank', base(20, 16, 4, 4), true, 'titan'],
  ['e_boss_void',     '虚空吞噬者', 'magicTank', base(18, 6, 5, 18), true, 'titan'],
  ['e_boss_echo',     '残影之王', 'hexblade', base(16, 14, 12, 14), true, 'titan'],
  // 普通 Boss（每 3 关）：colossal 体型，比小怪强但弱于 titan 强力 Boss，作中期压力点
  ['e_miniboss_warden', '角斗场守卫', 'physTank', base(14, 12, 5, 3), true, 'colossal'],
  ['e_miniboss_oracle', '预言魔像', 'magicTank', base(13, 5, 5, 12), true, 'colossal'],
  ['e_miniboss_reaver', '血色劫掠者', 'hexblade', base(13, 11, 10, 9), true, 'colossal'],
  // ── 西方怪物（v2.5 需求 #2）──
  // 常规波次怪：怪物皮 + 西方技能名，机制复用英雄子类骨架，但视觉完全独立。
  ['m_witch',       '黑渊女巫',   'summoner',  base(5, 3, 8, 11),  false, undefined, 'witch',
    { id: 'm_witch_skill', name: '咒怨召唤', cd: 14, damageType: 'magic',
      desc: '女巫吟唱黑暗咒语，撕裂虚空召唤怨灵助战', skillStyle: 'summon_rift', castRange: 5.0 }],
  ['m_demon',       '炼狱恶魔',   'charge',    base(9, 12, 8, 3),   false, undefined, 'demon',
    { id: 'm_demon_skill', name: '炼狱爆发', cd: 7, damageType: 'hybrid',
      desc: '周身 2.5 格 AoE 180% 混伤，地狱火裹挟', skillStyle: 'melee_burst', castRange: 2.5 }],
  ['m_skeleton',    '枯骨战士',   'charge',    base(7, 10, 7, 2),   false, undefined, 'skeleton',
    { id: 'm_skel_skill', name: '骸骨突袭', cd: 6, damageType: 'physical',
      desc: '突进 6 格内最远敌人，250% 物伤 + 晕 1 秒', skillStyle: 'charge_dash', castRange: 6.0 }],
  ['m_gargoyle',    '石翼魔像',   'physTank',  base(12, 8, 3, 2),   false, undefined, 'gargoyle',
    { id: 'm_garg_skill', name: '石化咆哮', cd: 8, damageType: 'physical',
      desc: '咆哮震慑 3 格内敌人 3 秒，自身减伤提升', skillStyle: 'bulwark_taunt', castRange: 3.0 }],
  // 兽类新增（需求：龙加兽类标签 + 新增恶魔狼 / 精灵狼）：常规波次怪，非 Boss，走独立狼皮 + 西方技能名
  ['m_wolf_demon',  '恶魔狼',     'charge',    base(8, 12, 10, 2),  false, undefined, 'demon_wolf',
    { id: 'm_wolf_demon_skill', name: '暗影撕咬', cd: 6, damageType: 'physical',
      desc: '恶魔狼扑向 6 格内最远敌人，250% 物伤并撕裂伤口', skillStyle: 'charge_dash', castRange: 6.0 }],
  ['m_wolf_fae',    '精灵狼',     'controller', base(6, 5, 9, 11),  false, undefined, 'fae_wolf',
    { id: 'm_wolf_fae_skill', name: '幻月之噬', cd: 9, damageType: 'magic',
      desc: '精灵狼引动月光，5 格内敌人陷入沉眠并受 180% 法伤', skillStyle: 'zone_control', castRange: 5.0 }],
  // 西方 Boss：龙（titan 强力 Boss）/ 堕天使（colossal 普通 Boss），各自独立皮 + 西方技能名
  ['m_dragon',      '深渊邪龙',   'physTank',  base(20, 16, 4, 4),  true,  'titan',    'dragon',
    { id: 'm_dragon_skill', name: '焚世龙息', cd: 8, damageType: 'physical',
      desc: '巨龙喷吐巨型锥形龙息，朝最近敌人（范围=3×体型），火=灼烧 / 冰=冰冻 / 毒=剧毒', skillStyle: 'bulwark_taunt', castRange: 3.5 }],
  ['m_fallen_angel','堕天炽天使', 'magicTank',  base(18, 6, 5, 18),  true,  'colossal', 'fallen_angel',
    { id: 'm_angel_skill', name: '堕天审判', cd: 10, damageType: 'magic',
      desc: '审判之光吸取 8 格内敌方 10% 最大生命', skillStyle: 'bulwark_taunt', castRange: 8.0 }],
  // ── v2.9.x 面包车特殊关（cosplay 五菱宏光）──
  // 面包车：重甲慢车，专属 van_ram 撞击（开场 10s 移速翻倍 → 撞击最猛）。属性基础见 VAN_CFG。
  ['e_van', '面包车', 'physTank', VAN_CFG.vanBasePrimary, false, 'heavy', 'van', VAN_RAM_SKILL],
  // 面包人：属性 = 车 1/2（下方 base 仅作模板；实际由 VanConvoyScript 按 VAN_CFG 计算并随机赋特性）。
  ['e_van_person', '面包人', 'charge', base(8, 7, 3, 1), false, 'medium', 'van_person'],
];

function bossSkill(id: string) {
  if (id === 'e_boss_colossus') return SKILLS.boss_stomp;
  if (id === 'e_boss_void') return SKILLS.boss_devour;
  if (id === 'e_boss_echo') return SKILLS.boss_split;
  // 普通 Boss 复用三种 Boss 技能
  if (id === 'e_miniboss_warden') return SKILLS.boss_stomp;
  if (id === 'e_miniboss_oracle') return SKILLS.boss_devour;
  return SKILLS.boss_split;
}

export const ENEMIES: EnemyDef[] = list.map(([id, name, subclass, p, isBoss, body, monsterKind, skillOverride]) => ({
  id, name, category: SUBCLASS_INFO[subclass].category, subclass,
  basePrimary: p, isBoss, bodyType: body, monsterKind,
  // 西方怪物用自带西方技能名；其余英雄系敌人按子类自动取技能（含中国风技能名）
  skill: skillOverride ?? (isBoss ? bossSkill(id) : (subclass === 'healer' ? undefined : { ...SKILLS[SUBCLASS_SKILL[subclass]] })),
}));

/**
 * v2.9.x 面包车专属单位不进普通抽取池。
 *
 * 这不是洁癖，是一个真实的回归：ENEMIES_BY_CAT 按 category 过滤，
 * e_van 是 physTank → 'tank'、e_van_person 是 charge → 'warrior'，
 * 不排除的话它们会直接漏进 buildWaves 的常规波次——普通层凭空开出面包车。
 * 更隐蔽的后果是 pick() 用 `pool.length` 取模，池子长度从 4 变 5，
 * **同一 seed 的所有历史波次组成全部错位**，回放和存档对不上。
 * 排除后池子长度回到原值，历史 seed 行为不变。
 */
const VAN_ONLY_IDS = new Set(['e_van', 'e_van_person']);

export const ENEMIES_BY_CAT = (cat: string) =>
  ENEMIES.filter((e) => !e.isBoss && !VAN_ONLY_IDS.has(e.id) && e.category === cat);

/** 面包车本体（车队关 wave 0 的全部内容，由 levelGen 按 vanCount 复制） */
export const VAN_ENEMY: EnemyDef = ENEMIES.find((e) => e.id === 'e_van')!;
/** 面包人模板（属性由 VanConvoyScript 按 VAN_CFG.personPrimaryMul 现算，特性随机赋） */
export const VAN_PERSON: EnemyDef = ENEMIES.find((e) => e.id === 'e_van_person')!;
export const BOSSES = ENEMIES.filter((e) => e.isBoss);
// v2.4 Boss 分级：强力 Boss = titan 体型（每 5 关），普通 Boss = colossal 体型（每 3 关）
export const STRONG_BOSSES = BOSSES.filter((e) => e.bodyType === 'titan');
export const NORMAL_BOSSES = BOSSES.filter((e) => e.bodyType === 'colossal');
