// ── storeBridge：zustand store 与 GameBackend 的桥接 ────────
//
// 让 store 的局内 action 在 Remote 模式下走云端权威结算：
//   写操作 → GameBackend → Result<RunSnapshot> → applySnapshot 全量替换局内状态
// 本地模式（useLocalComputation=true）不经过本层——store 原有同步逻辑原样保留。
//
// 权威性纪律：快照是唯一真相。任何云端返回的快照应用后，本地状态与云端逐字段一致；
// 云端没有的命令（锻造/合成/奇遇/药水…）在 Remote 模式被禁用，避免状态分叉。
import type {
  RunSnapshot, MetaSnapshot, BattleResultDTO,
} from '@arena/core/contract';
import { CORE_VERSION } from '@arena/core/contract';
import { getBackend } from '../backend/index';
import { RemoteBackend } from '../backend/RemoteBackend';
import type { GameState } from '../game/state/slices/types';

/** 当前是否云端模式（getBackend 惰性创建，首次调用即决定通路） */
export function isRemoteMode(): boolean {
  return getBackend() instanceof RemoteBackend;
}

/** 幂等键：连点/网络重试靠它去重（对局内单调） */
let idemCounter = 0;
export function genIdemKey(): string {
  idemCounter = (idemCounter + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${idemCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 统一请求信封（写命令共享） */
export function envelope(runId: string) {
  return { runId, idempotencyKey: genIdemKey(), coreVersion: CORE_VERSION };
}

/**
 * 把权威快照应用到 store。
 * run.seed 取 snapshot.renderSeed——Remote 模式下根种子永不下发，
 * 前端所有 genLayer / 本地模拟继续读 run.seed（代码零改动），渲染观感与权威结算解耦。
 */
export function applySnapshot(
  set: (partial: Partial<GameState>) => void,
  snap: RunSnapshot,
): void {
  set({
    run: {
      runId: snap.runId,
      layer: snap.layer,
      team: snap.team,
      relics: snap.relics,
      score: snap.score,
      seed: snap.renderSeed,
      mode: snap.mode,
      failures: snap.failures,
    },
    gold: snap.gold,
    inventory: snap.inventory,
    pendingDrops: snap.pendingDrops,
    equipped: snap.equipped,
    tradeCount: snap.tradeCount,
    shopStock: snap.shopStock,
    consumables: snap.consumables,
    forgedThisLayer: snap.forgedThisLayer,
    recruitPool: snap.recruitPool,
    fusedThisLayer: snap.fusedThisLayer,
    reforgedThisLayer: snap.reforgedThisLayer ?? false, // 旧局快照可能无此字段
    refreshCount: snap.refreshCount,
    resolvedEvents: snap.resolvedEvents,
    lastTransferLogs: snap.receipts.lastTransferLogs ?? [],
    lastBreakthrough: snap.receipts.lastBreakthrough ?? null,
    lastMount: snap.receipts.lastMount ?? null,
    lastKillGains: snap.receipts.lastKillGains ?? null,
    lastReforge: snap.receipts.lastReforge ?? null,
  });
}

/** 云端模式账号级元数据同步（bestLayer / endlessUnlocked / presets） */
export function applyMeta(set: (partial: Partial<GameState>) => void, meta: MetaSnapshot): void {
  set({
    bestLayer: meta.bestLayer,
    endlessUnlocked: meta.endlessUnlocked,
    teamPresets: meta.teamPresets,
  });
}

/** 云端模式：开局 / 主菜单进入时同步一次账号元数据（静默失败） */
export async function syncMeta(set: (partial: Partial<GameState>) => void): Promise<void> {
  try {
    const r = await getBackend().queryMeta();
    if (r.ok) applyMeta(set, r.data);
  } catch { /* 网络失败保持本地值，下次操作再同步 */ }
}

/** 云端模式：战斗权威结果挂载（BattleScreen 用） */
export function battleRemoteOf(b: BattleResultDTO) {
  return {
    outcome: b.outcome,
    snapshot: b.snapshot,
    replay: b.replay,
  };
}

// ── 全局串行写队列（v3.4b）─────────────────────────────────
// 所有云端写命令统一入队、**串行执行**：前一条确认并应用快照后，才发下一条。
// 根治「连续快速操作并发云端写 → 乐观锁 version 互踩 → 部分确认失败回退」。
// UI 是乐观的（本地立即生效），队列只在后台消化确认，玩家无感。
type WriteJob = () => Promise<void>;
let writeQueue: WriteJob[] = [];
let writing = false;

async function pumpWrite(): Promise<void> {
  if (writing) return;
  writing = true;
  try {
    while (writeQueue.length) {
      const job = writeQueue.shift()!;
      try {
        await job();
      } catch (e) {
        // v3.4c 双保险：job 异常不中断泵（继续消化剩余写），writing 由 finally 复位
        console.warn('[arena] 云端写队列 job 异常:', e);
      }
    }
  } finally {
    writing = false;
  }
}

/**
 * 云端写命令的统一执行器：读 runId → 调 GameBackend → 成功则应用权威快照。
 * 入队后由全局队列串行执行（同 runId 前后写不并发，杜绝乐观锁互踩）。
 * 供 store action 的 Remote 分支使用（Local 分支保留原同步逻辑）。
 */
export function remoteWrite(
  get: () => GameState,
  set: (partial: Partial<GameState>) => void,
  call: (b: ReturnType<typeof getBackend>, env: { runId: string; idempotencyKey: string; coreVersion: string }) => Promise<{
    ok: boolean; data?: RunSnapshot; message?: string; code?: string;
  }>,
): Promise<void> {
  return new Promise((resolve) => {
    writeQueue.push(async () => {
      try {
        const run = get().run;
        if (!run) { resolve(); return; }
        const r = await call(getBackend(), envelope(run.runId));
        if (r.ok && r.data) {
          applySnapshot(set, r.data);
        } else if (!r.ok) {
          console.warn(`[arena] 云端操作被拒:`, r.code, r.message);
        }
      } catch (e) {
        // v3.4c 单条确认异常不致命：记录并继续（不污染队列/不 unhandled）
        console.warn('[arena] 云端确认异常:', e);
      } finally {
        resolve();
      }
    });
    void pumpWrite();
  });
}

export type { RunSnapshot };
