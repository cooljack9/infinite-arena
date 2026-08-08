// 战斗画面渲染（开发 §8 / 美术 §8）。Canvas 2D 运行确定性模拟并驱动帧绘制
// 帧绘制本身在 ./frame.ts —— 与 dev 验收页共用同一份代码，
// 避免「验收页看着对、实机不对」这种最浪费时间的假验证
import { useEffect, useRef } from 'react';
import { BattleSim } from '@arena/core/engine/battle';
import { TILE, buildSkin, makeParticles, drawFrame, TrailStore } from './frame';
import { audio } from '../audio';
import { useGame } from '../game/state/store';
import { layerTimeScale } from '../game/state/slices/helpers';

const TICK = 1 / 20;

interface Props {
  sim: BattleSim;
  running: boolean;
  speed?: number;
  onEnd: (result: 'win' | 'lose') => void;
}

export default function ArenaCanvas({ sim, running, speed = 1, onEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const endedRef = useRef(false);
  // 残影历史：纯渲染层状态，不回写 sim（逻辑与渲染解耦，开发 §6.5）
  const trailRef = useRef<TrailStore>(new Map());
  // v1.6：倍速走 ref 而非 effect 依赖。若把 speed 放进依赖数组，每拖一次滑块
  // 都会重建 RAF 循环、重置残影并重启环境音——玩家会听到明显的「咔」一下断音。
  const speedRef = useRef(speed);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  // 暂停同理走 ref。若把 running 留在 effect 依赖里，每次暂停/继续都会重建 RAF 循环，
  // 连带清空残影、重启环境音——玩家点一下暂停画面就「闪」一下，比不做暂停还糟。
  const runningRef = useRef(running);
  useEffect(() => { runningRef.current = running; }, [running]);
  // v2.9.8 色盲双通道同样走 ref：放进依赖会在切换开关时重建 RAF 循环、清空残影、
  // 重启环境音（和倍速/暂停一个道理）。这里只要下一帧读到新值即可。
  const colorblind = useGame((s) => s.colorblind);
  const colorblindRef = useRef(colorblind);
  useEffect(() => { colorblindRef.current = colorblind; }, [colorblind]);

  useEffect(() => {
    endedRef.current = false;
    trailRef.current = new Map();
    const canvas = canvasRef.current!;
    canvas.width = sim.W * TILE;
    canvas.height = sim.H * TILE;
    const ctx = canvas.getContext('2d')!;
    // 皮只在开关变化时重建（buildSkin 里有 HSL 褪色计算，不该进每帧热路径）
    let skin = buildSkin(sim.arena.theme, sim.arena.fade ?? 0, colorblindRef.current);
    let skinCb = colorblindRef.current;
    const particles = makeParticles(46, canvas.width, canvas.height, sim.W * 977 + sim.H * 31 + 7);
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let intAcc = 0;

    // v3.4 BGM 由 App 按屏幕驱动（battle 战歌），此处仅保留张力调制 setIntensity
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (runningRef.current && !sim.over) {
        // v2.9.14：层内演示预热曲线（前10s 0.6× → 10~20s 1× → 20s后每5s +20%，封顶3×）
        // 叠加在玩家手动倍速之上；sim.time 不受影响，战斗结果确定性零影响。
        const eff = speedRef.current * layerTimeScale(sim.time);
        acc += dt * eff;
        // 步数上限随综合倍速放宽，否则 4× 时会被 8 步截断，实际只能跑到 ~2.7×
        const maxSteps = Math.max(8, Math.ceil(eff * 8));
        let steps = 0;
        while (acc >= TICK && steps < maxSteps) { sim.tick(TICK); acc -= TICK; steps++; }
        // 消费本帧仿真产出的音频事件（音频设计文档 §4：在 tick 之外播放，零确定性影响）
        for (const c of sim.drainAudioCues()) audio.playCue(c);
        // 自适应张力：按存活敌量 + Boss 存在写入 CombatIntensity（节流 0.3s）
        intAcc += dt;
        if (intAcc >= 0.3) {
          intAcc = 0;
          const enemies = sim.units.filter((u) => u.alive && u.side === 'enemy' && !u.isSummon).length;
          const boss = sim.units.some((u) => u.alive && u.isBoss);
          const intensity = enemies === 0 ? 0 : Math.min(1, 0.3 + 0.07 * (enemies - 1) + (boss ? 0.4 : 0));
          audio.setIntensity(intensity);
        }
      }
      // 渲染插值因子：tick 之间残余时间 / TICK ∈ [0,1)。
      // 配合 frame.ts 的 rt = sim.time + alpha*TICK，把视觉从 20Hz 逻辑时钟
      // 解耦到 RAF 帧率（修复 R1/R3/R4）。暂停或已结束时冻结（alpha=0）。
      const alpha = runningRef.current && !sim.over ? Math.min(1, Math.max(0, acc / TICK)) : 0;
      if (colorblindRef.current !== skinCb) {
        skinCb = colorblindRef.current;
        skin = buildSkin(sim.arena.theme, sim.arena.fade ?? 0, skinCb);
      }
      drawFrame(ctx, sim, skin, particles, trailRef.current, alpha);
      if (sim.over && !endedRef.current) {
        endedRef.current = true;
        onEnd(sim.result!);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); };
  }, [sim, onEnd]);

  return <canvas ref={canvasRef} style={{ imageRendering: 'pixelated' }} />;
}
