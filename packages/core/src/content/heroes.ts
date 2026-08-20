// 9 名代表勇者（每子类 1，需求 5.2 / 开发 §1.3）
// v2.9.10：因每局会随机体型与性别（见 variant.ts），"关羽/后羿" 这类具体人物会与随机到的
// 侏儒/魁梧、男/女冲突。故统一改为职业称号（name），与子类的职业标签（cn）成对出现：
// name = 称号，cn = 职业流派。技能名也不再绑定个人传说（见 skills.ts）。
// v1.6：每人绑定一个 traitId，特性由战斗引擎实际执行（附录 A.1）。
import { HeroDef, PrimaryAttrs, HeroStatMods } from '../types';
import { RNG, shuffle } from '../engine/rng';
import { SUBCLASS_SKILL, SKILLS } from './skills';
import { SUBCLASS_INFO } from './classes';

// 直接构造（skill 来自 SKILLS）
// 元组尾部两项为可选：[4]=英雄数值微调 mods，[5]=普攻伤害构成 atkRatio
// vX：模板不再绑定特性 traitId——特性在 variateHero 时从全池随机分配（用户需求「所有角色都随机产生」），
// 因此这里删除了原先第 5 元组的固定 traitId；已生成/已存档副本的 traitId 由 variateHero 保留（旧存档兼容）。
const raw: Array<[string, string, HeroDef['subclass'], PrimaryAttrs, HeroStatMods?, { p: number; m: number }?]> = [
  ['h_physTank',   '铁壁镇守',   'physTank',   { con: 14, str: 8,  agi: 3,  int: 2  }],
  ['h_magicTank',  '玄符守御',   'magicTank',  { con: 14, str: 3,  agi: 3,  int: 10 }],
  ['h_charge',     '破阵猛将',   'charge',     { con: 8,  str: 14, agi: 10, int: 2  }],
  ['h_hexblade',   '无形剑客',   'hexblade',   { con: 8,  str: 11, agi: 8,  int: 9  },
    // vX 数值重做：基础生命-10% / 物攻-30% / 攻速+10% / 移速+5%；普攻 40%物+75%魔
    { hpMul: 0.90, pDmgMul: 0.70, atkSpeedMul: 1.10, moveSpeedMul: 1.05 },
    { p: 0.40, m: 0.75 }],
  ['h_gunner',     '神机炮手',   'gunner',     { con: 6,  str: 10, agi: 14, int: 3  }],
  ['h_sniper',     '贯日神射',   'sniper',     { con: 5,  str: 12, agi: 14, int: 3  }],
  ['h_controller', '太极宗师',   'controller', { con: 5,  str: 3,  agi: 8,  int: 14 }],
  ['h_summoner',   '造物术师',   'summoner',   { con: 7,  str: 4,  agi: 6,  int: 14 }],
  ['h_healer',     '回春医者',   'healer',     { con: 9,  str: 3,  agi: 5,  int: 14 }],
];

export const HEROES: HeroDef[] = raw.map(([id, name, subclass, base, mods, atkRatio]) => ({
  id, uid: id, name, category: SUBCLASS_INFO[subclass].category, subclass,
  basePrimary: base,
  growth: { con: 2, str: 2, agi: 2, int: 2 },
  skill: { ...SKILLS[SUBCLASS_SKILL[subclass]] },
  // 模板不绑特性；特性由 variateHero 从全池随机分配（见 variant.ts rollTrait）。
  traitId: undefined,
  mods,
  atkRatio,
  trait: undefined,
}));

export const HERO_BY_ID: Record<string, HeroDef> = Object.fromEntries(HEROES.map((h) => [h.id, h]));

// v1.3 英雄招募池：层间商店随机刷新，优先覆盖队伍尚未拥有的子类以最大化阵容多样性。
// v1.6 修正：必须保留「已拥有角色」的名额——否则需求 6 的升星与属性突破永远触发不了，
// 玩家攒下的金币在后期会失去唯一有意义的出口。
export function rollRecruitPool(rng: RNG, team: HeroDef[], count = 3): HeroDef[] {
  const owned = new Set(team.map((h) => h.id));
  const fresh = shuffle(rng, HEROES.filter((h) => !owned.has(h.id)));
  const dup = shuffle(rng, HEROES.filter((h) => owned.has(h.id)));

  const dupSlots = dup.length > 0 ? Math.min(dup.length, Math.max(1, Math.round(count / 3))) : 0;
  const freshSlots = count - dupSlots;
  let picks = [...fresh.slice(0, freshSlots), ...dup.slice(0, dupSlots)];
  if (picks.length < count) {
    const rest = shuffle(rng, HEROES.filter((h) => !picks.includes(h)));
    picks = [...picks, ...rest].slice(0, count);
  }
  return shuffle(rng, picks).slice(0, count);
}
