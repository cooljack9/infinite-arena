// 天赋（局内三选一，需求 5.5）。Demo 复用为战前增益池（开发 §1.3 / 美术 §2.3）
import { TalentDef } from '../types';
import { RELICS } from './relics';

// 战前「增益三选一」直接复用遗物池（开发 §8 PreBattle）
export const PRE_BATTLE_POOL: TalentDef[] = RELICS.map((r) => ({
  id: r.id, name: r.name, desc: r.desc,
}));

export const TALENTS: TalentDef[] = PRE_BATTLE_POOL;
