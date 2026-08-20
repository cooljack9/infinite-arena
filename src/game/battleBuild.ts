/**
 * 战斗引擎构造（本地模式纯同步）+ 预载缓存。
 *
 * 目的：把 BattleScreen 里"进战才构造 sim"的逻辑抽出来，让 PreBattle 在玩家点
 * 「确认开战」（传参完成）时即后台预载，倒计时三句话播完时引擎已就绪 →
 * BattleScreen 直接消费预载 sim，去掉「⏳ 战斗加载中…」加载门。
 *
 * 确定性：buildBattleSim 与 BattleScreen 原构造逻辑逐行一致，随机数全部来自
 * run.seed + run.layer，不引入任何新随机源 → 回放/结算种子不变，21/21 契约不受影响。
 * 远程模式（replay 异步到达）不预载，保留 BattleScreen 原加载流程。
 *
 * v2.9.x：装配一律改走 `rules/makeSim`，本文件不再自己 `new BattleSim` + 手配。
 *
 * 为什么这不是"顺手重构"：**玩家看的是这里造的 sim，判胜负的是 runBattle 造的 sim**。
 * 两份装配代码只要错一个字段，屏幕上打赢了、结算判输——而没有任何报错。
 * 实际已经踩到一次：这里从来没调 `resetBuildingId`，车队关（无建筑）的面包人 id
 * 会从上一场的计数器接着涨，与权威那场对不上。现在 makeSim 是唯一装配入口，
 * 契约加字段时只有一处要维护，漏配会被 parity 测试当场打红。
 */
import { BattleSim } from '@arena/core/engine/battle';
import { makeSim } from '@arena/core/rules';
import type { RunState, Equipment, Vec2 } from '@arena/core/types';
import type { RunSlice } from './state/slices/types';
import { isRemoteMode } from '../backend/storeBridge';
// vX Web Worker 仿真：构造参数纯函数抽到 store-free 的 simArgs.ts（Worker 也能安全 import，不拉起前端 store/后端）。
import { buildBattleSimArgs, type BattlePlan, type BattleMods } from './simArgs';
export type { BattlePlan, BattleMods };
export { buildBattleSimArgs };

/** 与核心 buildUnits 一致的爬塔专属战斗种子（autoClimb 同式） */
export const climbBattleSeed = (seed: number, layer: number): number =>
  (seed ^ (layer * 0x85ebca77) ^ 0x5f356495) >>> 0;

/** 与核心 climbMult 一致的爬塔难度倍率（第 1 层 +10%，线性到第 10 层 +15%，i 从 1 起） */
export const climbMult = (i: number): number => 1.10 + (0.05 * (Math.min(i, 10) - 1)) / 9;

/** 与 BattleScreen 原构造逻辑逐行一致；本地模式同步产出完整 BattleSim。 */
export function buildBattleSim(
  run: RunState,
  plan: BattlePlan,
  equipped: Record<string, Equipment[]>,
  formation: Record<string, Vec2>,
  battleRemote: RunSlice['battleRemote'],
  mods?: BattleMods,
): BattleSim {
  return makeSim(buildBattleSimArgs(run, plan, equipped, formation, battleRemote, mods));
}

// ── 预载缓存：PreBattle.confirm 后台写入，BattleScreen 挂载时消费（消费一次即清空）──
let pendingSim: BattleSim | null = null;

/** 传参完成即后台构造战斗引擎（本地模式）。远程 replay 异步到达，无法预载，故 no-op。 */
export function preloadBattleSim(
  run: RunState,
  plan: BattlePlan,
  equipped: Record<string, Equipment[]>,
  formation: Record<string, Vec2>,
  battleRemote: RunSlice['battleRemote'],
  mods?: BattleMods,
): void {
  if (isRemoteMode()) return; // 远程 replay 异步到达，交由 BattleScreen 原流程构造
  try {
    pendingSim = buildBattleSim(run, plan, equipped, formation, battleRemote, mods);
  } catch (e) {
    // 构造失败不应阻断进战：清空缓存，BattleScreen 运行时 rAF 兜底再构造一次
    console.warn('[arena] 战斗引擎预载失败，回退到 BattleScreen 运行时构造:', e);
    pendingSim = null;
  }
}

/** 取出并清空预载（消费一次）。BattleScreen 挂载时调用。 */
export function consumeBattleSim(): BattleSim | null {
  const s = pendingSim;
  pendingSim = null;
  return s;
}

/** 进入新的布阵页时清掉残留预载，避免吃到上一场的 sim。 */
export function clearBattlePreload(): void {
  pendingSim = null;
}
