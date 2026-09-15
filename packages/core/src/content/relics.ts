// 遗物（Demo 15，需求 5.6 / 开发 §1.3）。mod 在战斗开始时应用（battle.applyRelics）
import { RelicDef } from '../types';

export const RELICS: RelicDef[] = [
  { id: 'r_rage',   name: '狂怒',   desc: '物理伤害+15%',   mod: { pDmg: 6 } },
  { id: 'r_arcane', name: '奥能',   desc: '魔法伤害+15%',   mod: { mDmg: 6 } },
  { id: 'r_wall',   name: '坚壁',   desc: '物理减伤+10%',   mod: { pResist: 10 } },
  { id: 'r_ward2',  name: '法障',   desc: '魔法减伤+10%',   mod: { mResist: 10 } },
  { id: 'r_wind',   name: '疾风',   desc: '攻速+15%',       mod: { atkSpeed: 15 } },
  { id: 'r_swift',  name: '迅捷',   desc: '闪避+10%',       mod: { dodge: 10 } },
  { id: 'r_fleet',  name: '疾行',   desc: '移速+15%',       mod: { moveSpeed: 15 } },
  { id: 'r_crit',   name: '锐眼',   desc: '暴击+10%',       mod: { crit: 10 } },
  { id: 'r_brutal', name: '残暴',   desc: '暴伤+30%',       mod: { critDmg: 30 } },
  { id: 'r_vigor',  name: '活力',   desc: '生命+20%',       mod: { hpMult: 1.2 } },
  { id: 'r_blood',  name: '嗜血',   desc: '伤害+10%',       mod: { dmgMult: 1.1 } },
  { id: 'r_tough',  name: '坚韧',   desc: '物理/魔法减伤+5%', mod: { pResist: 5, mResist: 5 } },
  { id: 'r_sage',   name: '贤者',   desc: '智力+6(治疗+)',  mod: { heal: 20 } },
  { id: 'r_bulwark',name: '壁垒',   desc: '生命+15%且减伤+5%', mod: { hpMult: 1.15, pResist: 5, mResist: 5 } },
  { id: 'r_tempest',name: '风暴',   desc: '攻速+10%且暴击+8%', mod: { atkSpeed: 10, crit: 8 } },
];

export const RELIC_BY_ID: Record<string, RelicDef> = Object.fromEntries(RELICS.map((r) => [r.id, r]));
