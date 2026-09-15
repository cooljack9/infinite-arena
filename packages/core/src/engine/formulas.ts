// 一级 → 二级属性转化（需求 5.3；开发 §5.1/§6.3）
import { PrimaryAttrs, DerivedAttrs, BaseValues } from '../types';

export const BASE: BaseValues = {
  hp: 100,
  pDmg: 10,
  mDmg: 10,
  atkSpeed: 100,
  crit: 5,
  moveSpeed: 0,
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// 系数集中常量，便于调参（需求 5.3「可在数值表中调参」）
export function derive(a: PrimaryAttrs): DerivedAttrs {
  return {
    hp: BASE.hp + a.con * 10,
    pDmg: BASE.pDmg + a.str * 2.0 + a.con * 0.3,
    mDmg: BASE.mDmg + a.int * 2.0,
    atkSpeed: clamp(BASE.atkSpeed + a.agi * 0.4, 0, 200),
    dodge: clamp(a.agi * 0.25, 0, 75),
    moveSpeed: clamp(BASE.moveSpeed + a.agi * 0.3, 0, 60),
    crit: clamp(BASE.crit + a.agi * 0.2, 0, 75),
    critDmg: 150 + a.str * 0.5 + a.int * 0.5,
    // 坦克向减伤扩展（需求 5.3）：强壮→物理减伤，智力→魔法减伤
    pResist: clamp(a.con * 0.8, 0, 75),
    mResist: clamp(a.int * 0.8, 0, 75),
    heal: a.int * 1.5 + a.con * 0.5,
    // v1.5 天气字段默认值：无天气时回血 0、受伤 ×1（天气在 BattleSim 构造时覆盖）
    regenPct: 0,
    dmgTakenMult: 1,
  };
}
