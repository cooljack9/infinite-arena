// v1.7 §4 一次性物品（需求 v1.7 §4；装备与经济设计 §13）
//
// 设计意图：装备是「长期资产」，买了就一直在。一次性物品补的是另一条曲线——
// 用完即消失的**即时决策**：这一层是把钱换成永久的一点点成长，
// 还是换成下一场硬仗的一次爆发？两种药剂刻意做成正交的，
// 一个作用于「以后的每一场」，一个只作用于「下一场」。
import { ConsumableItem, ConsumableKind, GrowthRoll, PrimaryAttrs, GrowthStatKey, GROWTH_STAT_KEYS, PRIMARY_KEYS } from '../types';
import { RNG, pick } from '../engine/rng';

/** 商店每个货位产出一次性物品的概率（需求 v1.7 §4：20%） */
export const CONSUMABLE_CHANCE = 0.20;

interface ConsumableCfg {
  name: string;
  desc: string;
  basePrice: number;
  color: string;
  icon: string;
}

export const CONSUMABLE_CFG: Record<ConsumableKind, ConsumableCfg> = {
  growth: {
    name: '成长药剂',
    // 与击杀成长同源：一瓶 ≈ 一次击杀的核心属性收益 + 0.5~2 倍的二级属性收益。
    // 定价刻意压在蓝装(120)之下，让「买永久成长」在前期是真的可选项而不是奢侈品。
    desc: '随机核心属性 +0.5，随机二级属性成长 0.5%~2%（永久，立即生效）',
    basePrice: 90,
    color: '#7ee08a',
    icon: '🧪',
  },
  burst: {
    name: '爆发药剂',
    // 只保 1 回合，所以定价必须明显低于永久成长，否则没人会买。
    desc: '主属性增强 50%，持续 1 回合（仅下一场战斗）',
    basePrice: 70,
    color: '#ff9a3c',
    icon: '⚗️',
  },
};

/** 成长药剂的二级属性成长区间（百分点） */
export const GROWTH_POTION_PCT = { min: 0.5, max: 2 };
/** 成长药剂的核心属性固定增幅 */
export const GROWTH_POTION_PRIMARY = 0.5;
/** 爆发药剂：主属性乘子 */
export const BURST_MULT = 1.5;

let cid = 0;
const nextConsumableId = () => `c${cid++}`;

export function makeConsumable(kind: ConsumableKind): ConsumableItem {
  const cfg = CONSUMABLE_CFG[kind];
  return { id: nextConsumableId(), kind, name: cfg.name, desc: cfg.desc, basePrice: cfg.basePrice };
}

/** 随机一种一次性物品（两种等概率） */
export function rollConsumable(rng: RNG): ConsumableItem {
  return makeConsumable(pick(rng, ['growth', 'burst'] as ConsumableKind[]));
}

/**
 * 掷一次成长药剂的结果。
 * 与击杀成长共用 GrowthRoll 结构，好处是 store 只需要一个 applyGrowth 入口，
 * 两个来源永远不会算出不一致的结果。
 */
export function rollGrowthPotion(rng: RNG): GrowthRoll {
  const primaryKey = pick(rng, PRIMARY_KEYS) as keyof PrimaryAttrs;
  const secondaryKey = pick(rng, GROWTH_STAT_KEYS) as GrowthStatKey;
  const span = GROWTH_POTION_PCT.max - GROWTH_POTION_PCT.min;
  // 保留 2 位小数：0.5~2% 的区间若不取整，UI 上会出现 1.3874999% 这种噪音
  const secondaryPct = Math.round((GROWTH_POTION_PCT.min + rng() * span) * 100) / 100;
  return { primaryKey, primaryAdd: GROWTH_POTION_PRIMARY, secondaryKey, secondaryPct };
}

/** 主属性 = 基础核心属性中的最高项（决定爆发药剂增强谁） */
export function dominantPrimary(p: PrimaryAttrs): keyof PrimaryAttrs {
  let best: keyof PrimaryAttrs = 'con';
  for (const k of PRIMARY_KEYS) if (p[k] > p[best]) best = k;
  return best;
}
