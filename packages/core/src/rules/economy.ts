// ── 经济与成长领域公式（Pure Core）──────────────────────────
//
// 从原 src/game/state/slices/helpers.ts 拆出的「领域部分」：
// 折扣曲线 / 招募定价 / 金币奖励 / 成长合并 / 哈希 —— 这些是游戏规则，
// 前端本地算、后端 Edge 算，必须同一份，故进 core。
// 原 helpers.ts 保留 localStorage 持久化与渲染偏好（纯前端宿主职责）。
//
// 纪律：本文件零 IO、零环境 API，全部确定性纯函数。
import { GROWTH_STAT_KEYS, PRIMARY_KEYS } from '../types';
import type {
  Equipment, PrimaryAttrs, HeroGrowth, GrowthStatKey,
} from '../types';
import type { RNG } from '../engine/rng';
import { generateEquipment } from '../content/equipment';

// ── 常量 ────────────────────────────────────────────────
export const EQUIP_SLOTS = 6; // 每名勇者 6 个通用槽（需求 5.6）
export const TEAM_CAP = 7;    // 出战上限：开局 3，招募扩至 7 满编（需求 5.1 / §2.2）
export const REFRESH_COST = 1;   // v1.6 §A.7：1 金币刷新
export const FUSE_PER_LAYER = 2; // v1.6 §A.5.1：每层限 2 次合成

// v2.6 §1 教学初始装备包（新手模式专属）
const STARTER_BLUE = 2;
const STARTER_NORMAL = 2;

/** 生成教学初始装备包：2 蓝 + 2 白，全部已开箱（直接可用） */
export function rollStarterKit(rng: RNG): Equipment[] {
  const out: Equipment[] = [];
  for (let i = 0; i < STARTER_BLUE; i++) out.push({ ...generateEquipment(rng, 'blue'), opened: true });
  for (let i = 0; i < STARTER_NORMAL; i++) out.push({ ...generateEquipment(rng, 'normal'), opened: true });
  return out;
}

// v1.6 §A.6 / v2.7 §3：五星后属性突破的主属性命中率（60% 主属性 / 40% 其余三项）。
export const BREAKTHROUGH_MAIN_CHANCE = 0.6;

// ── 经济公式 ──────────────────────────────────────────────
// §11.2 折扣曲线：交易越多越深，满 20 次封顶 50% off
export const discountOf = (tradeCount: number) => Math.max(0, Math.min(0.5, tradeCount * 0.025));
// v1.3 招募价：随层数缓增
export const recruitCostOf = (layer: number) => 60 + 20 * layer;
// 胜利金币奖励：基线=40，每层 +12
export const goldReward = (layer: number) => 40 + 12 * layer;

// ── 确定性工具 ────────────────────────────────────────────
// 字符串哈希（用于药剂的确定性种子，避免引入 Math.random 破坏可复现）
export const hashStr = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

// 把一次成长（击杀 / 药剂）累加到既有的 HeroGrowth 上——逐 key 求和，绝不覆盖。
// 两个来源共用这个合并逻辑，保证「同一份角色」无论成长从哪来，结算结果都一致。
export function addGrowth(existing: HeroGrowth | undefined, add: HeroGrowth): HeroGrowth {
  const primary: Partial<PrimaryAttrs> = { ...(existing?.primary ?? {}) };
  for (const k of PRIMARY_KEYS) {
    const v = add.primary?.[k];
    if (v) primary[k] = Math.round(((primary[k] ?? 0) + v) * 100) / 100;
  }
  const secondaryPct: Partial<Record<GrowthStatKey, number>> = { ...(existing?.secondaryPct ?? {}) };
  for (const k of GROWTH_STAT_KEYS) {
    const v = add.secondaryPct?.[k];
    if (v) secondaryPct[k] = Math.round(((secondaryPct[k] ?? 0) + v) * 100) / 100;
  }
  return { primary, secondaryPct };
}
