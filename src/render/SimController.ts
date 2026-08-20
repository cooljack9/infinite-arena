/**
 * 仿真控制器：统一「主线程直驱」与「Web Worker 仿真」两条路径。
 *
 * 设计目标（用户诉求②：把核心仿真移入 Web Worker，终极降主线程运算量）：
 *   - 默认路径 `DirectSim`：主线程直接持 BattleSim，行为与历史版本 100% 一致（引擎零改动）。
 *   - 开启路径 `SimClient`（`?simworker=1`，且仅本地模式）：仿真在 Worker 线程跑，
 *     主线程只接收「渲染快照 + 音频线索」并渲染，把每帧最贵的 `sim.tick` 彻底移出主线程。
 *   - 任何 Worker 创建/初始化失败 → `makeSimController` 同步回退 `DirectSim`，保证绝不回归。
 *
 * 渲染层（`drawFrame` / `ArenaCanvas`）与 React HUD / 技能条只认 `SimSurface` 这个只读表面，
 * 因此两条路径对调用方完全透明——`ArenaCanvas` 的 `sim.tick / sim.drainAudioCues / sim.units`
 * 等调用点一行都不用改。
 */
import type {
  Unit, Projectile, Effect, FloatText, ArenaDef,
  HeroGrowth, BattleStatRow, AudioCue,
} from '@arena/core/types';
import { BattleSim } from '@arena/core/engine/battle';
import { buildBattleSim, type BattlePlan, type BattleMods } from '../game/battleBuild';
import type { RunState, Equipment, Vec2 } from '@arena/core/types';
import type { RunSlice } from '../game/state/slices/types';
import { isRemoteMode } from '../backend/storeBridge';

/** 渲染层 + React HUD/技能条只读的战斗表面（drawFrame / ArenaCanvas / BattleScreen 共用）。 */
export interface SimSurface {
  W: number;
  H: number;
  time: number;
  over: boolean;
  result: 'win' | 'lose' | null;
  units: Unit[];
  projectiles: Projectile[];
  floaters: FloatText[];
  effects: Effect[];
  terrainCraters: { x: number; y: number; r: number }[];
  terrainSlashs: { x0: number; y0: number; x1: number; y1: number; w: number }[];
  arena: ArenaDef;
  arenaTile(r: number, c: number): string;
  tick(dt: number): void;
  drainAudioCues(): AudioCue[];
  forceCast(subclass: string): void;
  getKillGains(): Record<string, HeroGrowth>;
  getDeadAllyUids(): string[];
  getBattleStats(): BattleStatRow[];
}

/** 构造一个 SimController 所需的全部入参（会原样 postMessage 给 Worker，故须可结构化克隆）。 */
export interface SimBuildArgs {
  run: RunState;
  plan: BattlePlan;
  equipped: Record<string, Equipment[]>;
  formation: Record<string, Vec2>;
  battleRemote: RunSlice['battleRemote'];
  mods?: BattleMods;
}

/** 对调用方暴露的控制器：在 SimSurface 之上加「倍速/暂停转发」与「资源释放」。 */
export interface SimController extends SimSurface {
  /** 转发最新倍速/暂停状态（Worker 模式据此驱动步进；DirectSim 为 no-op）。 */
  setControls(speed: number, running: boolean): void;
  /** 释放资源（Worker 模式终止线程；DirectSim 为 no-op）。 */
  dispose(): void;
}

/** SimClient 持有的可变数据（方法在类上，不在 surface 上）。 */
type SurfaceData = Omit<
  SimSurface,
  'arenaTile' | 'tick' | 'drainAudioCues' | 'forceCast' | 'getKillGains' | 'getDeadAllyUids' | 'getBattleStats'
>;

// ─────────────────────────────────────────────────────────────────────────────
// DirectSim：默认路径，主线程直驱，行为与历史版本逐 bit 一致。
// ─────────────────────────────────────────────────────────────────────────────
export class DirectSim implements SimController {
  private sim: BattleSim;

  /** 接收预载好的 BattleSim（避免重复构造），或按入参现场构造（与默认路径一致）。 */
  constructor(simOrArgs: BattleSim | SimBuildArgs) {
    if (simOrArgs instanceof BattleSim) {
      this.sim = simOrArgs;
      return;
    }
    // 复用 buildBattleSim（含远程回放分支），保证与默认路径逐 bit 一致
    this.sim = buildBattleSim(
      simOrArgs.run, simOrArgs.plan, simOrArgs.equipped,
      simOrArgs.formation, simOrArgs.battleRemote, simOrArgs.mods,
    );
  }

  get W() { return this.sim.W; }
  get H() { return this.sim.H; }
  get time() { return this.sim.time; }
  get over() { return this.sim.over; }
  get result() { return this.sim.result; }
  get units() { return this.sim.units; }
  get projectiles() { return this.sim.projectiles; }
  get floaters() { return this.sim.floaters; }
  get effects() { return this.sim.effects; }
  get terrainCraters() { return this.sim.terrainCraters; }
  get terrainSlashs() { return this.sim.terrainSlashs; }
  get arena() { return this.sim.arena; }
  arenaTile(r: number, c: number) { return this.sim.arenaTile(r, c); }
  tick(dt: number) { this.sim.tick(dt); }
  drainAudioCues() { return this.sim.drainAudioCues(); }
  forceCast(subclass: string) { this.sim.forceCast(subclass); }
  getKillGains() { return this.sim.getKillGains(); }
  getDeadAllyUids() { return this.sim.getDeadAllyUids(); }
  getBattleStats() { return this.sim.getBattleStats(); }
  setControls(_speed: number, _running: boolean) { /* 主线程自驱，无需转发 */ }
  dispose() { /* 无资源需释放 */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker 消息协议
// ─────────────────────────────────────────────────────────────────────────────
interface SnapSurface {
  W: number; H: number; time: number; over: boolean; result: 'win' | 'lose' | null;
  units: Unit[]; projectiles: Projectile[]; floaters: FloatText[]; effects: Effect[];
  terrainCraters: { x: number; y: number; r: number }[];
  terrainSlashs: { x0: number; y0: number; x1: number; y1: number; w: number }[];
  // arena 不进快照：静态且 SimClient 构造时已持有（见 SimClient 构造），无需每帧回传。
}
interface Settlement {
  killGains: Record<string, HeroGrowth>;
  deadAllyUids: string[];
  battleStats: BattleStatRow[];
}
type WorkerMsg =
  | { type: 'snap'; surface: SnapSurface; cues: AudioCue[]; settlement?: Settlement }
  | { type: 'error'; message: string };

// ─────────────────────────────────────────────────────────────────────────────
// SimClient：Worker 路径（opt-in）。主线程只渲染快照，仿真在 Worker 内步进。
// ─────────────────────────────────────────────────────────────────────────────
export class SimClient implements SimController {
  private worker: Worker;
  private surface: SurfaceData;
  private cueQueue: AudioCue[] = [];
  private settlement: Settlement | null = null;
  private lastSpeed = NaN;
  private lastRunning = false;
  private alive = true;

  constructor(args: SimBuildArgs) {
    // 同步拿到 W/H/arena：ArenaCanvas 在首帧就需要据此定画布尺寸，不能等 Worker 首包。
    const a = args.plan.arena;
    this.surface = {
      W: a.width, H: a.height, time: 0, over: false, result: null,
      units: [], projectiles: [], floaters: [], effects: [],
      terrainCraters: [], terrainSlashs: [], arena: a,
    };
    this.worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent) => this.onMessage(e.data as WorkerMsg);
    this.worker.onerror = (e) => {
      // 异步失败（Worker 脚本运行期错误）：记录并冻结，绝不抛未捕获异常炸掉主线程。
      this.alive = false;
      console.error('[arena] sim worker 运行期错误，仿真已冻结（移除 ?simworker=1 可回退主线程）:', e.message || e);
    };
    // 若 args 含不可结构化克隆的字段，postMessage 会在此同步抛错 → 由 makeSimController 捕获回退 DirectSim
    this.worker.postMessage({ type: 'init', args });
  }

  private onMessage(d: WorkerMsg) {
    if (d.type === 'error') {
      this.alive = false;
      console.error('[arena] sim worker 初始化失败，仿真已冻结（移除 ?simworker=1 可回退主线程）:', d.message);
      return;
    }
    if (d.type === 'snap') {
      this.applySurface(d.surface);
      if (d.cues?.length) this.cueQueue.push(...d.cues);
      if (d.settlement) this.settlement = d.settlement;
    }
  }

  private applySurface(s: SnapSurface) {
    this.surface.W = s.W; this.surface.H = s.H; this.surface.time = s.time;
    this.surface.over = s.over; this.surface.result = s.result;
    this.surface.units = s.units; this.surface.projectiles = s.projectiles;
    this.surface.floaters = s.floaters; this.surface.effects = s.effects;
    this.surface.terrainCraters = s.terrainCraters; this.surface.terrainSlashs = s.terrainSlashs;
    // arena 保持构造期静态值（args.plan.arena），快照不再携带，故此处不覆盖。
  }

  get W() { return this.surface.W; }
  get H() { return this.surface.H; }
  get time() { return this.surface.time; }
  get over() { return this.surface.over; }
  get result() { return this.surface.result; }
  get units() { return this.surface.units; }
  get projectiles() { return this.surface.projectiles; }
  get floaters() { return this.surface.floaters; }
  get effects() { return this.surface.effects; }
  get terrainCraters() { return this.surface.terrainCraters; }
  get terrainSlashs() { return this.surface.terrainSlashs; }
  get arena() { return this.surface.arena; }
  arenaTile(r: number, c: number) {
    const row = this.surface.arena?.tiles?.[r];
    return row ? row[c] ?? '.' : '.';
  }
  /** Worker 自驱步进，主线程 tick 为 no-op（仅用于维持主循环 alpha 插值，见 ArenaCanvas）。 */
  tick(_dt: number) { /* no-op */ }
  drainAudioCues() {
    const q = this.cueQueue;
    this.cueQueue = [];
    return q;
  }
  forceCast(subclass: string) {
    if (!this.alive) return;
    this.worker.postMessage({ type: 'forceCast', subclass });
  }
  getKillGains() { return this.settlement?.killGains ?? {}; }
  getDeadAllyUids() { return this.settlement?.deadAllyUids ?? []; }
  getBattleStats() { return this.settlement?.battleStats ?? []; }
  setControls(speed: number, running: boolean) {
    if (!this.alive) return;
    if (speed === this.lastSpeed && running === this.lastRunning) return;
    this.lastSpeed = speed; this.lastRunning = running;
    this.worker.postMessage({ type: 'controls', speed, running });
  }
  dispose() {
    this.alive = false;
    try { this.worker.terminate(); } catch { /* 已终止，忽略 */ }
  }
}

/**
 * 工厂：根据开关选择控制器。
 *   - 默认：DirectSim（主线程，历史行为，零风险）。
 *   - `?simworker=1` 且本地模式：尝试 SimClient；任何同步失败（Worker 构造 / 参数不可克隆）
 *     立即回退 DirectSim，保证「开启开关也绝不比不开更差」。
 * 注：远程模式（云端权威结算）走服务端，本就不需主线程仿真，强制 DirectSim。
 */
export function makeSimController(args: SimBuildArgs): SimController {
  const preferWorker =
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('simworker') === '1';
  if (preferWorker && !isRemoteMode()) {
    try {
      return new SimClient(args);
    } catch (e) {
      console.warn('[arena] Web Worker 仿真创建失败，回退主线程 DirectSim:', e);
    }
  }
  return new DirectSim(args);
}
