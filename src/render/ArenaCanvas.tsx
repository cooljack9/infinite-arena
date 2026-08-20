// 战斗画面渲染（开发 §8 / 美术 §8）。Canvas 2D 运行确定性模拟并驱动帧绘制
// 帧绘制本身在 ./frame.ts —— 与 dev 验收页共用同一份代码，
// 避免「验收页看着对、实机不对」这种最浪费时间的假验证
import { useEffect, useRef } from 'react';
import { TILE, buildSkin, makeParticles, drawFrame, TrailStore, CritFloater, Burst } from './frame';
import type { SimController } from './SimController';
import { audio } from '../audio';
import { useGame } from '../game/state/store';
import { layerTimeScale } from '../game/state/slices/helpers';

const TICK = 1 / 20;

// vX 渲染质量档位 → 背景粒子数（高=40 / 标准=28 / 省电=12）与暴击辉光（高=10 / 标准=6 / 省电=0）。
// 低档显著减负：粒子是纯装饰 overdraw，暴击辉光是 Canvas 最贵的阴影操作。
const PARTICLE_COUNT: Record<string, number> = { high: 40, standard: 28, low: 12 };
const CRIT_GLOW: Record<string, number> = { high: 10, standard: 6, low: 0 };

// vX 降低运算量：热路径每帧对 critFlt/burstRef 做 .filter() 会分配新数组（60fps 持续 GC 源）。
// 改为原地 swap-remove 紧凑，零分配；二者都是无序活跃特效集合，重排顺序不影响观感。
function pruneInPlace<T>(arr: T[], keep: (v: T) => boolean): void {
  let w = 0;
  for (let i = 0; i < arr.length; i++) {
    if (keep(arr[i])) {
      if (w !== i) arr[w] = arr[i];
      w++;
    }
  }
  arr.length = w;
}

interface Props {
  sim: SimController;
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
  // vX 渲染质量档位：同样走 ref，避免重建 RAF。粒子数在进战（effect 建立）时按档位定稿，
  // 暴击辉光 critGlow 则逐帧实时读取（低档可即时关阴影）。
  const renderQuality = useGame((s) => s.renderQuality);
  const renderQualityRef = useRef(renderQuality);
  useEffect(() => { renderQualityRef.current = renderQuality; }, [renderQuality]);
  // v1.4 渲染层战斗观感状态：暴击飘字 / 死亡粒子爆发（纯渲染层，随 effect 重建而清空，不回写 sim）
  const critFlt = useRef<CritFloater[]>([]);
  const burstRef = useRef<Burst[]>([]);
  // vX 自适应降载：帧率持续偏低时自动压低粒子预算与暴击辉光（不高于用户所选档位），
  // 动态「降低运算量」；帧率恢复后逐步回升。纯渲染层，零 sim 影响。
  const ftEmaRef = useRef(16.7);
  const lowAccumRef = useRef(0);
  const highAccumRef = useRef(0);
  const autoNRef = useRef(PARTICLE_COUNT[renderQuality] ?? 28);
  const autoGlowRef = useRef(CRIT_GLOW[renderQuality] ?? 6);

  useEffect(() => {
    endedRef.current = false;
    trailRef.current = new Map();
    const canvas = canvasRef.current!;
    canvas.width = sim.W * TILE;
    canvas.height = sim.H * TILE;
    const ctx = canvas.getContext('2d')!;

    // v2.4.4 内部分辨率整数倍提升：CSS width: 100% 拉伸显示，但位图在手机高 DPR 下颗粒重；
    // 用 ResizeObserver 测 CSS 显示宽度，按整数倍（1×/2×/3×，封顶 3×）放大 canvas 内部分辨率，
    // 并 setTransform 等比缩放 → drawFrame 仍按 480×312 逻辑坐标绘制，像素密度提升、清晰度翻倍。
    // 整数倍保证 pixelated 渲染下无插值模糊，并规避非整数缩放带来的边线锯齿。
    const baseW = sim.W * TILE;
    const baseH = sim.H * TILE;
    const applyScale = () => {
      const cssW = canvas.clientWidth || baseW;
      const scale = Math.max(1, Math.min(3, Math.max(1, Math.round(cssW / baseW))));
      if (canvas.width !== baseW * scale) {
        canvas.width = baseW * scale;
        canvas.height = baseH * scale;
      }
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
    };
    applyScale();
    const ro = new ResizeObserver(() => applyScale());
    ro.observe(canvas);
    // 皮只在开关变化时重建（buildSkin 里有 HSL 褪色计算，不该进每帧热路径）
    let skin = buildSkin(sim.arena.theme, sim.arena.fade ?? 0, colorblindRef.current);
    let skinCb = colorblindRef.current;
    // vX 渲染质量档位 → 背景粒子数（见模块级 PARTICLE_COUNT）。粒子是纯装饰 overdraw，低档显著减负。
    const particles = makeParticles(PARTICLE_COUNT[renderQualityRef.current] ?? 28, canvas.width, canvas.height, sim.W * 977 + sim.H * 31 + 7);
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let intAcc = 0;

    // v3.4 BGM 由 App 按屏幕驱动（battle 战歌），此处仅保留张力调制 setIntensity
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // vX 自适应降载：帧时间指数滑动平均；持续 >22ms（≈<45fps）降载，持续 <14ms（≈>71fps）回升。
      const ft = dt * 1000;
      ftEmaRef.current = ftEmaRef.current * 0.9 + ft * 0.1;
      const ema = ftEmaRef.current;
      const baseN = PARTICLE_COUNT[renderQualityRef.current] ?? 28;
      const baseGlow = CRIT_GLOW[renderQualityRef.current] ?? 6;
      if (ema > 22) { lowAccumRef.current += dt; highAccumRef.current = 0; }
      else if (ema < 14) { highAccumRef.current += dt; lowAccumRef.current = 0; }
      else { lowAccumRef.current = 0; highAccumRef.current = 0; }
      // 粒子：低帧每 0.8s 降 4（下限 8），高帧每 3s 升 4 回基线；档位下调时立刻收敛
      if (lowAccumRef.current > 0.8) { autoNRef.current = Math.max(8, autoNRef.current - 4); lowAccumRef.current = 0; }
      if (highAccumRef.current > 3) { autoNRef.current = Math.min(baseN, autoNRef.current + 4); highAccumRef.current = 0; }
      autoNRef.current = Math.min(autoNRef.current, baseN);
      // 暴击辉光：持续低帧关（0），恢复后回到档位基线，且绝不高于档位
      if (ema > 22) autoGlowRef.current = 0;
      else if (ema < 14) autoGlowRef.current = baseGlow;
      autoGlowRef.current = Math.min(autoGlowRef.current, baseGlow);
      // v2.9.14：层内演示预热曲线（前10s 0.6× → 10~20s 1× → 20s后每5s +20%，封顶3×）
      // 叠加在玩家手动倍速之上；sim.time 不受影响，战斗结果确定性零影响。
      // vX：同时作为渲染层「additive 负荷预算」的有效倍速因子（见 frame.ts），故提到 loop 作用域。
      const eff = speedRef.current * layerTimeScale(sim.time);
      // vX Web Worker 仿真：把倍速/暂停状态转发给 Worker（DirectSim 路径为 no-op）。
      // Worker 据此驱动 sim.tick；主线程 tick 已退化为仅维持 alpha 插值的空转。
      sim.setControls(speedRef.current, runningRef.current && !sim.over);
      if (runningRef.current && !sim.over) {
        acc += dt * eff;
        // 步数上限随综合倍速放宽，否则 4× 时会被 8 步截断，实际只能跑到 ~2.7×
        const maxSteps = Math.max(8, Math.ceil(eff * 8));
        let steps = 0;
        while (acc >= TICK && steps < maxSteps) { sim.tick(TICK); acc -= TICK; steps++; }
        // 消费本帧仿真产出的音频事件（音频设计文档 §4：在 tick 之外播放，零确定性影响）
        const cues = sim.drainAudioCues();
        for (const c of cues) audio.playCue(c);
        // v1.4 战斗观感：同批 cue 额外喂给渲染层特效（零 core 改动）
        const nowS = performance.now() / 1000;
        // 原地紧凑：剔除过期特效，避免每帧分配新数组（零 GC 热路径）
        pruneInPlace(critFlt.current, (f) => nowS - f.t0 < 0.8);
        pruneInPlace(burstRef.current, (b) => nowS - b.t0 < 0.7);
        for (const c of cues) {
          const cx = c.x ?? 0;
          if (c.id === 'crit') {
            // 「暴击!」标签贴到受击敌方单位身上；找不到则落在上半身默认高度
            const tgt = sim.units.find((u) => u.side === 'enemy' && u.alive && Math.abs(u.x - cx) < 0.6);
            critFlt.current.push({ x: cx, y: tgt ? tgt.y : 1.3, t0: nowS });
          } else if (c.id === 'death_ally' || c.id === 'death_enemy') {
            const u = sim.units.find((x) => Math.abs(x.x - cx) < 0.6);
            const y = u ? u.y : 0.7;
            const color = c.id === 'death_ally' ? '#7fb0ff' : '#ff7a7a';
            const seed = (Math.floor(cx * 131) + Math.floor((c.arenaW ?? 1) * 7) + Math.floor(nowS * 1000)) >>> 0;
            burstRef.current.push({ x: cx, y, color, seed, t0: nowS });
          }
        }
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
      // vX 渲染质量档位 → 暴击金数字外发光（高=10 / 标准=6 / 省电=0 关闭，见模块级 CRIT_GLOW）。
      // 自适应降载会在帧率不足时临时压低（autoGlowRef），帧率恢复后回升到档位基线，绝不高于档位。
      const critGlow = autoGlowRef.current;
      drawFrame(ctx, sim, skin, particles, trailRef.current, alpha, critFlt.current, burstRef.current, eff, critGlow, autoNRef.current);
      if (sim.over && !endedRef.current) {
        endedRef.current = true;
        onEnd(sim.result!);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [sim, onEnd]);

  return <canvas ref={canvasRef} style={{ imageRendering: 'pixelated' }} />;
}
