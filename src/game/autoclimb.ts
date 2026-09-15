// ── v1.8 自动爬塔：本地直调 core / 远程走后端权威 ──────────
// 本地模式：run.seed 就是根种子，前端直接调 core 纯函数 autoClimb / predictWinRate
// （与后端同一份字节码，结果逐 bit 一致）；应用时按核心 applyAutoClimb 同语义写回 store。
// 远程模式：根种子永不下发，改走后端 autoClimb 契约，返回权威 AutoClimbRespDTO。
import {
  autoClimb as coreAutoClimb, predictWinRate as corePredictWinRate,
  makeWinRatePredictor, climbMult,
} from '@arena/core/rules';
import { capFor } from '@arena/core/engine/scaling';
import { CORE_VERSION, type ClimbOptsDTO, type AutoClimbResultDTO, type RunSnapshot } from '@arena/core/contract';
import type { ClimbStrategy } from '@arena/core/content/climb';
import { useGame } from './state/store';
import { isRemoteMode, genIdemKey } from '../backend/storeBridge';
import { getBackend } from '../backend';

/** 把 store 状态组装成 autoClimb 需要的 RunSnapshot（本地模式；远程走后端权威） */
export function snapshotLike(): RunSnapshot {
  const s = useGame.getState();
  const run = s.run!;
  return {
    runId: run.runId,
    version: 0,
    layer: run.layer,
    mode: run.mode,
    score: run.score,
    failures: run.failures,
    cap: capFor(run.mode),
    team: run.team,
    relics: run.relics,
    resolvedEvents: s.resolvedEvents,
    status: 'active',
    gold: s.gold,
    inventory: s.inventory,
    pendingDrops: s.pendingDrops,
    equipped: s.equipped,
    consumables: s.consumables,
    shopStock: s.shopStock,
    recruitPool: s.recruitPool,
    tradeCount: s.tradeCount,
    refreshCount: s.refreshCount,
    forgedThisLayer: s.forgedThisLayer,
    fusedThisLayer: s.fusedThisLayer,
    reforgedThisLayer: s.reforgedThisLayer,
    opSeq: 0, // core 不读它，仅补全类型
    renderSeed: run.seed,
    receipts: {},
  };
}

/** 预计胜率（0~1）：本地蒙特卡洛估算（c2 滑条展示用；远程也允许本地估算，仅作 UI 参考） */
export function predictWinRateAt(layer: number, strategy: ClimbStrategy): number {
  const s = useGame.getState();
  const run = s.run!;
  const i = Math.max(1, layer - run.layer);
  const mult = climbMult(i);
  return corePredictWinRate(snapshotLike(), { seed: run.seed }, s.formation, layer, {
    enemyHpMult: mult, enemyDmgMult: mult, strategy,
  });
}

// ── v1.8.1：把 UI 侧的胜率估算从主线程上"摊开" ──────────────
//
// 20 局蒙特卡洛实测 80~170ms。同步跑在 render 里有两个后果：
//   1. 点战略按钮到高亮之间整整卡一帧以上（掉帧肉眼可见）；
//   2. 更糟——胜率目标滑条每动一格都会触发 re-render，于是**每一格都重算一遍**。
// 解法不是少算（那会让展示值和后端闸门对不上），而是切片算：
// 每片只跑 1~2 个样本（≈4~8ms，稳稳落在一帧预算内），片间把主线程还给浏览器。
// 总耗时不变甚至略增，但用户感知从"卡死 150ms"变成"数字渐进出现"。

/** 让出主线程一拍。MessageChannel 是最快的宏任务（≈0ms），且仍会让浏览器处理输入与绘制 */
function yieldToUI(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel === 'function') {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
      ch.port2.postMessage(0);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export interface PredictProgress {
  /** 已跑样本 / 总样本 */
  ran: number;
  total: number;
  /** 当前部分估算值（0~1），仅供渐进展示 */
  partial: number;
}

/**
 * 分片版预计胜率：结果与 `predictWinRateAt` 完全相同（同一批样本、同一批种子），
 * 只是把计算摊到多个宏任务里。`cancelled()` 返回 true 时提前放弃并 resolve(null)。
 */
export async function predictWinRateAtAsync(
  layer: number,
  strategy: ClimbStrategy,
  opts: { chunk?: number; cancelled?: () => boolean; onProgress?: (p: PredictProgress) => void } = {},
): Promise<number | null> {
  const s = useGame.getState();
  const run = s.run!;
  const mult = climbMult(Math.max(1, layer - run.layer));
  const p = makeWinRatePredictor(snapshotLike(), { seed: run.seed }, s.formation, layer, {
    enemyHpMult: mult, enemyDmgMult: mult, strategy,
  });
  const chunk = Math.max(1, opts.chunk ?? 2);
  while (!p.done) {
    if (opts.cancelled?.()) return null;
    p.step(chunk);
    opts.onProgress?.({ ran: p.ran, total: p.count, partial: p.rate });
    if (!p.done) await yieldToUI();
  }
  return p.finalRate;
}

/** 本地应用自动爬塔结果（与核心 applyAutoClimb 同语义）：发奖 + 跳层 + 失败容错 */
function applyLocalAutoClimb(result: AutoClimbResultDTO): void {
  const s = useGame.getState();
  s.climbReward(result.totalGold, result.totalDrops);
  if (result.stopReason === 'fail') {
    s.setFailures((s.run?.failures ?? 0) + 1);
  } else if (result.finalLayer > (s.run?.layer ?? 0)) {
    // 本地：停留在最后清掉的层（休整页显示），next() 再 +1 出发下一层
    s.setLayer(result.finalLayer);
  }
}

/**
 * 执行自动爬塔并返回结果：
 *   · 本地成功路径：已按核心语义写入 store（发奖/跳层/容错），返回 result（snapshot 为占位）。
 *   · 本地失败路径：**不**写失败/奖励（奖励由逐层播放时发放），调用方按 result 决定是否进入播放。
 *   · 远程：走后端权威，返回 { result, snapshot }（调用方 applySnapshot）。
 */
export async function runAutoClimb(
  opts: ClimbOptsDTO,
): Promise<{ result: AutoClimbResultDTO; snapshot: RunSnapshot } | { code: string; message: string }> {
  const s = useGame.getState();
  const run = s.run!;
  if (isRemoteMode()) {
    const r = await getBackend().autoClimb({
      runId: run.runId, idempotencyKey: genIdemKey(), coreVersion: CORE_VERSION,
      opts, formation: s.formation,
    });
    if (!r.ok) return { code: r.code, message: r.message };
    return r.data;
  }
  const r = coreAutoClimb(snapshotLike(), { seed: run.seed }, s.formation, opts);
  if (!r.ok) return { code: r.code, message: r.message };
  const result = r.data;
  // 失败路径不在此应用（进入逐层播放，奖励/容错随播放发放），其余路径直接写回
  if (result.stopReason !== 'fail') applyLocalAutoClimb(result);
  return { result, snapshot: snapshotLike() };
}

export type { ClimbStrategy };
