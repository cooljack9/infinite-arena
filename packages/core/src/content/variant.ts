// v2.1 角色特性分离（需求 §5.2 / 开发 §5）：个体差异化。
//
// 设计动机：此前 HeroDef 的 basePrimary 与 bodyType 直接来自模板，
// 同一角色上场的每一份副本都是数值与体型的完美克隆——玩家招募到「另一个自己」时
// 没有任何取舍差异。v2.1 让每一个副本在生成时就获得「只属于它自己」的基础属性与体型，
// 呼应需求「即使同样的角色，基础属性和体型也会不一样」。
//
// 约束（与全工程一致）：
//   1) 纯函数 + 种子驱动——同 seed 同结果，保证确定性（不破坏冒烟测试的回放校验）。
//   2) 只落 basePrimary / bodyType / gender 三项，不碰成长/技能/特性（traitId 仍固定，
//      保留每个角色的身份辨识度，避免「千人一面」反过来变成「毫无辨识」）。
//   3) 体型只在子类默认体型上两档内波动（v2.8 原 ±1 档放宽到 ±2 档），
//      既「不一样」又不破坏职业手感与渲染比例。
//   4) 性别 50/50 确定性随机（v2.8 用户需求：所有职业都存在男女性别差异）。
//      性别是「副本个体」属性——同模板不同副本可以不同性别，差异即取舍：
//      女 → 攻速 +8% / 暴击 +5%；男 → 爆伤 +25% / 生命 ×1.08（unit.ts applyGender）。
import { HeroDef, PrimaryAttrs, BodyType, Gender } from '../types';
import { mulberry32, pick, RNG } from '../engine/rng';
import { SUBCLASS_INFO, ALL_BODY_TYPES } from './classes';
import { randomHeroName } from './names';
import { rollPersonality } from './personalities';

const round1 = (v: number) => Math.round(v * 10) / 10;

// v2.8 基础属性波动幅度 ±15%（原 ±10%）：更大的个体差异，仍由 0.85~1.15 包住不崩平衡
const VAR_LO = 0.85;
const VAR_HI = 1.15;

/**
 * 把一份英雄模板/副本，按种子派生为「个体差异化」的副本。
 * @param base  模板或既有副本（只读，不被修改）
 * @param seed  决定本次差异的确定性种子（由调用方用 run.seed 混盐得到）
 * @returns     新的 HeroDef：basePrimary 与 bodyType 已个体化，其余字段原样保留
 */
export function variateHero(base: HeroDef, seed: number, takenNames: Iterable<string> = []): HeroDef {
  const rng: RNG = mulberry32(seed >>> 0);

  // ── 体型：在子类默认体型上下各两档内随机（v2.8 原 ±1 档）──
  const def = SUBCLASS_INFO[base.subclass].defaultBody;
  const idx = ALL_BODY_TYPES.indexOf(def);
  const offset = pick(rng, [-2, -1, 0, 1, 2]);
  const bodyType: BodyType = ALL_BODY_TYPES[Math.max(0, Math.min(ALL_BODY_TYPES.length - 1, idx + offset))];

  // ── 性别：50/50 确定性随机（v2.8）──
  const gender: Gender = rng() < 0.5 ? 'female' : 'male';

  // ── 基础属性：四项各 ×[VAR_LO, VAR_HI] ──
  const f = () => VAR_LO + rng() * (VAR_HI - VAR_LO);
  const bp = base.basePrimary;
  const basePrimary: PrimaryAttrs = {
    con: round1(bp.con * f()),
    str: round1(bp.str * f()),
    agi: round1(bp.agi * f()),
    int: round1(bp.int * f()),
  };

  // ── v3.1 个体姓名 ──
  // 已经有名字的副本不重摇：玩家认识的是「孙澜」，不是「第 3 号铁壁镇守」，
  // 中途改名等于把这份记忆抹掉。只有全新副本才取名。
  const personalName = base.personalName
    ?? randomHeroName((seed ^ 0x9e3779b9) >>> 0, gender, takenNames);

  // ── v3.1 性格（索敌偏好）──
  // 与姓名同理：已有性格不重摇。性格摇在属性之后取 rng()，
  // 保证「旧存档 + 同 seed」的 basePrimary/bodyType/gender 与 v3.0 逐位一致，
  // 只在末尾多消费一个随机数——回放兼容优先于代码美观。
  const personality = base.personality ?? rollPersonality(rng());

  return { ...base, basePrimary, bodyType, gender, personalName, personality };
}
