/// <reference lib="webworker" />
/**
 * 仿真 Worker：在独立线程持有并驱动 BattleSim，按固定步长推进，
 * 周期性把「渲染快照 + 音频线索」postMessage 回主线程。主线程只渲染，不跑 tick。
 *
 * 刻意只 import @arena/core 与 store-free 的 ../game/simArgs，绝不引入 app 的
 * store / backend，避免 Worker 打包拉起整个前端依赖图。
 */
import { makeSim } from '@arena/core/rules';
import { buildBattleSimArgs } from '../game/simArgs';
import { packUnit } from './packSurface';

const TICK = 1 / 20;

// 层内演示预热曲线（与 src/game/state/slices/helpers.layerTimeScale 逐字一致，
// 仅在此内联以便 Worker 自洽，不依赖 app 代码）。
function layerTimeScale(t: number): number {
  const PREHEAT = 10, NORMAL = 20, STEP = 5, PER = 0.2, CAP = 3;
  if (t < PREHEAT) return 0.6;
  if (t < NORMAL) return 1;
  const steps = Math.floor((t - NORMAL) / STEP);
  return Math.min(CAP, 1 + PER * steps);
}

// 最小 Worker 上下文类型（避免依赖 webworker lib，跨 tsconfig 更稳）
interface WorkerCtx {
  postMessage(msg: unknown): void;
  onmessage: ((e: { data: any }) => void) | null;
}
const ctx = self as unknown as WorkerCtx;

type Sim = ReturnType<typeof makeSim>;

let sim: Sim | null = null;
let speed = 1;
let running = true;
let acc = 0;
let last = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/** 把当前仿真状态序列化为渲染快照（structuredClone 保证主线程拿到的是独立副本）。 */
function snapshot() {
  if (!sim) return;
  const surface = {
    W: sim.W, H: sim.H, time: sim.time, over: sim.over, result: sim.result,
    // units 只打包渲染读取字段（见 ./packSurface），跳过 primary/derived/skill 等
    // 嵌套对象与 name 字符串，显著缩小每帧结构化克隆体积；渲染层类型 Unit[] 不变（边界 cast）。
    units: sim.units.map(packUnit) as unknown as typeof sim.units,
    projectiles: structuredClone(sim.projectiles),
    floaters: structuredClone(sim.floaters),
    effects: structuredClone(sim.effects),
    terrainCraters: structuredClone(sim.terrainCraters),
    terrainSlashs: structuredClone(sim.terrainSlashs),
    // 注意：arena 不进每帧快照。它在整场战斗中只读不写（battle.ts 仅构造期赋值，
    // 战斗中无 arena.*= 改写），且 SimClient 构造时已从 args.plan.arena 持有同一份引用
    // （= makeSim 收到的 arena）。每帧回传会被 postMessage 的结构化克隆白白深拷一份
    // tiles:string[]（含数百字符串），20Hz 下是纯 GC 负担。静态数据发一次即可。
  };
  const cues = sim.drainAudioCues();
  const msg: any = { type: 'snap', surface, cues };
  // 战斗结束瞬间一并回传结算数据（killGains / deadAllyUids / battleStats），
  // 主线程 settle（2s 横幅后）再读时早已就绪。
  if (sim.over) {
    msg.settlement = {
      killGains: sim.getKillGains(),
      deadAllyUids: sim.getDeadAllyUids(),
      battleStats: sim.getBattleStats(),
    };
  }
  ctx.postMessage(msg);
}

/** 固定步长推进：以墙钟时间为基准，按 eff = speed × 层预热倍率 缩放，单帧步数封顶防螺旋。 */
function step() {
  if (!sim || !running || sim.over) {
    if (sim?.over && timer !== null) { clearInterval(timer); timer = null; } // 战斗结束即停表，省电
    return;
  }
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const eff = speed * layerTimeScale(sim.time);
  acc += dt * eff;
  const maxSteps = Math.max(8, Math.ceil(eff * 8));
  let steps = 0;
  while (acc >= TICK && steps < maxSteps) {
    sim.tick(TICK);
    acc -= TICK;
    steps++;
  }
  snapshot();
}

ctx.onmessage = (e: { data: any }) => {
  const d = e.data;
  if (d.type === 'init') {
    try {
      sim = makeSim(
        buildBattleSimArgs(d.args.run, d.args.plan, d.args.equipped, d.args.formation, d.args.battleRemote, d.args.mods),
      );
      last = performance.now();
      acc = 0;
      timer = setInterval(step, TICK * 1000);
      snapshot(); // 立即发首包，主线程尽快定画布尺寸 + 拿到初始 units
    } catch (err) {
      ctx.postMessage({ type: 'error', message: String(err) });
    }
  } else if (d.type === 'controls') {
    speed = d.speed ?? 1;
    running = d.running ?? true;
  } else if (d.type === 'forceCast') {
    sim?.forceCast(d.subclass);
  } else if (d.type === 'dispose') {
    if (timer !== null) { clearInterval(timer); timer = null; }
    sim = null;
  }
};
