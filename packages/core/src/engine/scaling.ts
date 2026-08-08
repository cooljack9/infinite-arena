// 无尽难度缩放（需求 6.1 / 4.3；开发 §6.4）
//
// v2.0 重写（对齐《优化方向需求文档》§3.5.2 / §5.1 / §5.2 数值膨胀修复）：
//   旧实现 20 层后使用纯指数（hp: 1.12^k / dmg: 1.1^k），深塔数值爆炸，
//   玩家基础属性收益被稀释，战斗结果只看词条堆叠数量，策略构筑失去价值。
//   新实现采用亚线性（平方根）缩放，边际递减——深塔敌人仍然存在，但玩家
//   的装备/升星/词条/特性构筑收益持续有效，阵容搭配重新成为胜负关键。
//
// 曲线可在运行时通过 overrideScaling() 被 public/data/tuning.json 覆盖（MOD 化，见 §6.2）。

import { GameMode } from '../types';
import { dpow } from './detmath';

export interface ScaleCfg {
  knee: number;   // 线性段终点（层）
  linHp: number;  // 线性段每层的 HP 系数
  linDmg: number; // 线性段每层的 DMG 系数
  expHp: number;  // 深塔 HP 幂次（<1 → 亚线性 / 边际递减）
  expDmg: number; // 深塔 DMG 幂次（<1 → 亚线性 / 边际递减）
}

// 默认参数：20 层内线性温和上手；20 层后按 √(n/20) 增长，
// 即使到 500 层，HP/DMG 倍率也仅约 13×，远缓于旧纯指数。
let CFG: ScaleCfg = { knee: 20, linHp: 0.08, linDmg: 0.06, expHp: 0.5, expDmg: 0.5 };

/** 运行时覆盖缩放参数（外部 tuning.json 调用，便于 MOD / 二次开发调参） */
export function overrideScaling(p: Partial<ScaleCfg>): void {
  CFG = { ...CFG, ...p };
}

export function enemyScale(n: number): { hp: number; dmg: number } {
  const k = CFG.knee;
  if (n <= k) return { hp: 1 + CFG.linHp * n, dmg: 1 + CFG.linDmg * n };
  const baseHp = 1 + CFG.linHp * k;
  const baseDmg = 1 + CFG.linDmg * k;
  // 禁用 Math.pow：它是 implementation-approximated，而这两个数直接决定敌人 HP/伤害，
  // 会进战斗校验和。dpow 在指数 0.5（默认值）时走 Math.sqrt 精确快路，
  // 因此默认配置下的数值与改造前逐 bit 相同。见 docs/backend/07。
  const rHp = dpow(n / k, CFG.expHp);
  const rDmg = dpow(n / k, CFG.expDmg);
  return { hp: baseHp * rHp, dmg: baseDmg * rDmg };
}

// 真空期 / 突变层标记（需求 4.4.4 / 4.3）
export const isVacuum = (n: number): boolean => n % 10 === 0;
export const isMutation = (n: number): boolean => n % 10 === 0;

// 赛段倍率（资格赛/晋级赛/大师赛/传奇赛）
// v2.4 优化难度曲线：旧版在 10/30/60 层用阶梯跳变（1 → 1.3 → 1.6 → 2），
// 导致「过一层突然难一大截」的悬崖感（如 10→11 层敌人强度 +36%）。
// 改为随层深连续线性增长（每深 1 层 +0.8%，封顶 1.9），与 enemyScale 的亚线性缩放
// 叠加后整体平滑，玩家构筑收益持续有效，不再有突兀的难度台阶。
export function segmentMult(n: number): number {
  return Math.min(1.9, 1 + 0.008 * Math.max(0, n - 1));
}

// ── Boss 关卡密度（需求：每 3 关一个普通 Boss，每 5 关一个强力 Boss）──
// 普通 Boss = colossal 体型（压制感，但非碾压）；强力 Boss = titan 体型（每 5 关、最霸气）。
// 新手模式（5 层教学战役）仅封顶层放一个普通 Boss 作收尾，保持入门温和；
// 无尽模式按完整节奏铺排（mode 缺省按无尽处理，供无模式上下文的生成调用复用）。
export function bossTierAt(n: number, mode?: GameMode): 'strong' | 'normal' | undefined {
  if (mode === 'novice') return n >= NOVICE_CAP ? 'normal' : undefined;
  if (n % 5 === 0) return 'strong';
  if (n % 3 === 0) return 'normal';
  return undefined;
}

// DEMO_CAP：保留为集成测试循环上界（保证测试速度），同时是 levelGen 内容生成封顶。
export const DEMO_CAP = 30; // Demo 内容封顶（集成测试用，开发 §1.3）

// v2.2 新手模式封顶：打通 5 层即「通关」并解锁无尽模式，且 5 层内穿插弹窗教学，
// 让新玩家在最短路径内学会核心操作（升星/卖出/合成/重铸/购买/刷新）。
export const NOVICE_CAP = 5;

// v2.0：真正深塔软上限（需求文档"无限"承诺）。里程碑层 100/200/300/400/500。
// 到达后结算为通关胜利，但曲线本身已足够平缓，使深塔成为构筑较量而非数值堆砌。
// 普通无尽与铁人无尽共用此封顶；两者区别仅在「阵亡角色是否永久消失」。
export const ENDLESS_CAP = 500;

// v2.2：按模式取本局封顶层（需求 §8）
export function capFor(mode: GameMode): number {
  // 新手模式为有限战役；普通无尽 / 铁人无尽均为深塔至 500 层登顶
  return mode === 'novice' ? NOVICE_CAP : ENDLESS_CAP;
}
