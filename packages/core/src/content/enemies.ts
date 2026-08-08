// 敌人模板（需求 5.6 / 开发 §1.3）+ 西方怪物（v2.5 需求 #2）
import { EnemyDef, PrimaryAttrs, SubClass, BodyType, MonsterKind, SkillDef } from '../types';
import { SUBCLASS_SKILL, SKILLS } from './skills';
import { SUBCLASS_INFO } from './classes';

const base = (con: number, str: number, agi: number, int: number): PrimaryAttrs => ({ con, str, agi, int });

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
  // 西方 Boss：龙（titan 强力 Boss）/ 堕天使（colossal 普通 Boss），各自独立皮 + 西方技能名
  ['m_dragon',      '深渊邪龙',   'physTank',  base(20, 16, 4, 4),  true,  'titan',    'dragon',
    { id: 'm_dragon_skill', name: '焚世龙息', cd: 8, damageType: 'physical',
      desc: '巨龙喷吐巨型锥形龙息，朝最近敌人（范围=3×体型），火=灼烧 / 冰=冰冻 / 毒=剧毒', skillStyle: 'bulwark_taunt', castRange: 3.5 }],
  ['m_fallen_angel','堕天炽天使', 'magicTank',  base(18, 6, 5, 18),  true,  'colossal', 'fallen_angel',
    { id: 'm_angel_skill', name: '堕天审判', cd: 10, damageType: 'magic',
      desc: '审判之光吸取 8 格内敌方 10% 最大生命', skillStyle: 'bulwark_taunt', castRange: 8.0 }],
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

export const ENEMIES_BY_CAT = (cat: string) => ENEMIES.filter((e) => !e.isBoss && e.category === cat);
export const BOSSES = ENEMIES.filter((e) => e.isBoss);
// v2.4 Boss 分级：强力 Boss = titan 体型（每 5 关），普通 Boss = colossal 体型（每 3 关）
export const STRONG_BOSSES = BOSSES.filter((e) => e.bodyType === 'titan');
export const NORMAL_BOSSES = BOSSES.filter((e) => e.bodyType === 'colossal');
