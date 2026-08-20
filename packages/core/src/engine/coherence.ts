// 反"堆一人"·轻量方案（敌方针对最强角色的被动）
//
// 根因：战斗引擎偏好「集中」——敌人不针对最强时，一个神装单体天然能 solo。
// （实测：堆一人队在总战力仅均衡队一半时仍稳赢；纯数值惩罚压不住，因伤害随
// 浓度非线性膨胀。）根因不在数值（升星/装备线性、不通胀），而在战斗结构。
//
// 本方案不碰经济/共享血/阵型，只在敌人 AI 加两条「消耗最强」规则：
//   · 前排敌（近战接触型）死亡 → 同归于尽，按概率带走我方当前最强英雄；
//   · 后排敌（远程/施法型）施法 → 捆仙绳，按概率 root 我方最强 + 施法怪自身。
//
// 调度（"不能每关都出"）：按层 onset（浅层无），按 applyChance 低频给敌人打标记，
// 每场有 maxFront/maxBack 上限（冷却）。普通敌不带标记 → 不会每波都触发。
// vX：不再用集中度闸门区分队伍——均衡队也会遇到这两条被动（用户确认不需要回避均衡队），
//     触发与否只由「层深 + 概率 + 每场上限」决定，简单可预期。
//
// 纪律：全部走 this.rng（种子流）→ 同 seed 回放一致；每场计数 reset 在构造 → parity 不破。
import type { RNG } from './rng';
import type { Unit } from '../types';
import { SUBCLASS_INFO } from '../content/classes';

export interface EnemyFocusCfg {
  /** 浅层不触发，深层引入（层数 < onsetFloor 时敌人不带任何标记） */
  onsetFloor: number;
  /** 每层敌人带被动标记的比例（低频；普通敌大多不带 → 不每关都出） */
  applyChance: number;
  /** 前排敌死亡「同归于尽」基础触发概率 */
  frontMutualP: number;
  /** 后排敌施法「捆仙绳」基础触发概率 */
  backShackleP: number;
  /** 捆仙绳封印上限秒（任一方死亡即提前解除；此值只是防「锁死整场」的兜底） */
  backShackleT: number;
  /** 每场同归于尽触发上限（冷却） */
  maxFrontPerBattle: number;
  /** 每场捆仙绳触发上限（冷却） */
  maxBackPerBattle: number;
}

// 数值 rationale（[PLACEHOLDER] 待 playtest）：
//   onsetFloor=8   → 前 7 层让玩家自由试错、看懂养成，第 8 层起才出现死士；
//   applyChance=0.18 → 深层也只有约 1/5 敌人带标记，一波敌人里通常 0~2 个，不每关都出；
//   frontMutualP=0.30 / backShackleP=0.40 → 低频触发，避免随机性碾压；
//   backShackleT=8 → 封印上限；正常应由「打死施法怪」提前解除，8s 只防锁死整场；
//   maxFrontPerBattle=2 / maxBackPerBattle=1 → 每场最多 2 次换命 + 1 次封印，节奏可控。
export const ENEMY_FOCUS_DEFAULT: EnemyFocusCfg = {
  onsetFloor: 8,
  applyChance: 0.18,
  frontMutualP: 0.30,
  backShackleP: 0.40,
  backShackleT: 8,
  maxFrontPerBattle: 2,
  maxBackPerBattle: 1,
};

let CFG: EnemyFocusCfg = ENEMY_FOCUS_DEFAULT;

/** 运行时覆盖（外部 tuning.json 调用，MOD / 二次开发调参） */
export function overrideEnemyFocus(p: Partial<EnemyFocusCfg>): void {
  CFG = { ...CFG, ...p };
}

/** 取当前生效配置（含 tuning.json override）。BattleSim 构造时调用一次。 */
export function getEnemyFocus(): EnemyFocusCfg {
  return CFG;
}

/** 单英雄战力评分（用于找"最强"；综合物/法伤 + 少量血量权重） */
export function power(u: Unit): number {
  return u.derived.pDmg + u.derived.mDmg + 0.05 * u.derived.hp;
}

/** 当前存活、非召唤、非建筑的我方英雄（本机制只认真实勇者副本） */
function aliveHeroes(units: Unit[]): Unit[] {
  return units.filter(
    (u) => u.side === 'ally' && u.alive && !u.isSummon && !u.isBuilding && power(u) > 0,
  );
}

/** 当前存活、非召唤、非建筑的我方英雄中战力最高者；无人返回 null */
export function findStrongestAlly(units: Unit[]): Unit | null {
  const allies = aliveHeroes(units);
  if (!allies.length) return null;
  return allies.reduce((best, u) => (power(u) > power(best) ? u : best), allies[0]);
}

/**
 * 构造时按层调度给部分敌人打「针对最强」被动标记（focusRole）。
 *   · 仅普通敌人（enemy & !isSummon & !isBoss）；
 *   · 层数 < onsetFloor → 不打标记（浅层自由）；
 *   · 按 applyChance 低频打标，其余敌人裸装（不每关都出）；
 *   · 近战接触型（射程 ≤ 2.5）→ 'front'（同归于尽）；远程/施法型 → 'back'（捆仙绳）。
 * vX：不再区分队伍集中度——均衡队也会遇到（用户确认不需要回避均衡队）。
 */
export function applyEnemyFocus(units: Unit[], layer: number, rng: RNG): void {
  if (layer < CFG.onsetFloor) return;
  for (const u of units) {
    if (u.side !== 'enemy' || u.isSummon || u.isBoss) continue;
    if (rng() >= CFG.applyChance) continue;
    const range = SUBCLASS_INFO[u.subclass].attackRange;
    u.focusRole = range <= 2.5 ? 'front' : 'back';
  }
}
