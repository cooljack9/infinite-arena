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

// vX 击杀播报：death cue 携带的阵亡/击杀者信息，转发给战场 killfeed UI（纯展示）
export interface KillEvent {
  victim: string;
  killer?: string;
  side: 'ally' | 'enemy';
  x: number;
  y: number;
}

// vX 战场缩放（camera zoom）：作为「满屏 contain 拟合」之上的叠加倍率。
// 默认 'auto' = 1.0 → 战场按屏幕实际最大尺寸 contain（不裁切、不浪费空间）；
// 手动值 1.0/1.25/1.5 = 在满屏基础上再拉近（>1 会裁切溢出部分，等同「拉近镜头」）。
// 仅作用于合成期，零 sim/parity 影响。
function effectiveZoom(mode: 'auto' | number): number {
  if (mode === 'auto') return 1;
  return Math.max(0.5, Math.min(3, mode));
}
// 跟随镜头默认拉近倍率（auto 时）：以队长为中心显示约 1/1.4 战场，再 contain 填满屏幕
const FOLLOW_AUTO_ZOOM = 1.4;

interface Props {
  sim: SimController;
  running: boolean;
  speed?: number;
  onEnd: (result: 'win' | 'lose') => void;
  onKill?: (k: KillEvent) => void;
}

export default function ArenaCanvas({ sim, running, speed = 1, onEnd, onKill }: Props) {
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
  // vX 击杀播报：onKill 走 ref，避免回调身份变化触发 RAF 重建（与 speed/running 同理）
  const onKillRef = useRef(onKill);
  useEffect(() => { onKillRef.current = onKill; }, [onKill]);
  // vX 渲染质量档位：同样走 ref，避免重建 RAF。粒子数在进战（effect 建立）时按档位定稿，
  // 暴击辉光 critGlow 则逐帧实时读取（低档可即时关阴影）。
  const renderQuality = useGame((s) => s.renderQuality);
  const renderQualityRef = useRef(renderQuality);
  useEffect(() => { renderQualityRef.current = renderQuality; }, [renderQuality]);
  // vX 战场缩放（camera zoom）：'auto' 自适应 或 手动数值。渲染层以 ref 模式读取，改完立刻生效（无需重开战斗）。
  // cameraZoomModeRef 存原始模式（'auto' | number），cameraZoomRef 存合成期「实际缩放倍数」（恒为 number）；
  // 二者分离：模式变化只改 ref、不重建 RAF；auto 模式下实际倍数随窗口宽/分辨率在 applyScale 内实时换算。
  const cameraZoom = useGame((s) => s.cameraZoom);
  const cameraZoomModeRef = useRef(cameraZoom);
  const cameraZoomRef = useRef<number>(1);
  useEffect(() => {
    cameraZoomModeRef.current = cameraZoom;
    cameraZoomRef.current = effectiveZoom(cameraZoom);
  }, [cameraZoom]);
  // vX 超采样倍率：离屏 world 画布相对可见 canvas 的内部放大倍数（1×~3×）。平滑写入 ref，
  // 合成期读取，避免放进 effect 依赖导致 RAF 重建。
  const ssRef = useRef(1);
  // vX 镜头模式（全图 / 跟随队长）：渲染层以 ref 模式读取，改完立刻生效（无需重开战斗）
  const cameraMode = useGame((s) => s.cameraMode);
  const cameraModeRef = useRef(cameraMode);
  useEffect(() => { cameraModeRef.current = cameraMode; }, [cameraMode]);
  const leaderUid = useGame((s) => s.run?.leaderUid ?? null);
  const leaderUidRef = useRef<string | null>(leaderUid);
  useEffect(() => { leaderUidRef.current = leaderUid; }, [leaderUid]);
  // v1.4 渲染层战斗观感状态：暴击飘字 / 死亡粒子爆发（纯渲染层，随 effect 重建而清空，不回写 sim）
  const critFlt = useRef<CritFloater[]>([]);
  const burstRef = useRef<Burst[]>([]);
  // vX 跟随队长镜头：每帧重算队长（或队长阵亡时首个存活友方）的世界像素坐标，供合成期取景
  const leaderPosRef = useRef<{ x: number; y: number } | null>(null);
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
    const baseW = sim.W * TILE;
    const baseH = sim.H * TILE;
    const ctx = canvas.getContext('2d')!;
    // vX 战场缩放（camera zoom）：drawFrame 先画到离屏 off（世界像素、恒等 transform，零改动），
    // 合成阶段再整体放大 zoom 倍、围绕战场中心裁切后 blit 到可见 canvas。zoom=1 与旧行为逐像素一致（零回归）；
    // zoom>1 时单位视觉放大、边缘裁切（拉近）。drawFrame 内部完全不动 → parity/确定性零影响。
    const off = document.createElement('canvas');
    off.width = baseW; off.height = baseH;
    const octx = off.getContext('2d')!;
    // vX 全屏自适应 + 超采样清晰化：
    // ① 可见 canvas 内部分辨率 = CSS 尺寸 × devicePixelRatio（封顶 2×）→ 高 DPI 屏不再发虚；
    // ② 离屏 world 画布按「可见分辨率 / 世界分辨率」超采样（1×~3×），先在高内部分辨率画像素美术，
    //    再以≈1:1 合成到可见 canvas —— 大屏上单位不再被 nearest 拉成粗块，细节更锐利；
    // ③ 战斗按屏幕实际最大尺寸 contain 拟合（见 loop 内合成），不再有 1.35 硬封顶与黑边浪费。
    const applyScale = () => {
      const cssW = canvas.clientWidth || baseW;
      const cssH = canvas.clientHeight || baseH;
      const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
      const pw = Math.max(1, Math.round(cssW * dpr));
      const ph = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      // 超采样倍率：让离屏像素数 ≥ 可见像素数（取较小轴拟合，保证最终合成≈1:1，最锐利）。
      // 上限 2：2× 超采样 + 2× DPR = 4× 细节已足够锐利，且把离屏像素成本锁在 4× 以内，避免 4K/高 DPR 屏上 9× 拖垮低端机。
      const ss = Math.max(1, Math.min(2, Math.round(Math.min(pw / baseW, ph / baseH))));
      if (off.width !== baseW * ss || off.height !== baseH * ss) {
        off.width = baseW * ss;
        off.height = baseH * ss;
        // 重置 canvas 会清空 context 状态，必须重设变换：世界坐标 ×ss → 离屏像素，并关平滑保持像素风
        octx.setTransform(ss, 0, 0, ss, 0, 0);
        octx.imageSmoothingEnabled = false;
      }
      ssRef.current = ss;
      // 战场缩放倍率（叠加在满屏 contain 之上；auto=1 即纯满屏）
      cameraZoomRef.current = effectiveZoom(cameraZoomModeRef.current);
    };
    applyScale();
    const ro = new ResizeObserver(() => applyScale());
    ro.observe(canvas);
    // 皮只在开关变化时重建（buildSkin 里有 HSL 褪色计算，不该进每帧热路径）
    let skin = buildSkin(sim.arena.theme, sim.arena.fade ?? 0, colorblindRef.current);
    let skinCb = colorblindRef.current;
    // vX 渲染质量档位 → 背景粒子数（见模块级 PARTICLE_COUNT）。粒子是纯装饰 overdraw，低档显著减负。
    const particles = makeParticles(PARTICLE_COUNT[renderQualityRef.current] ?? 28, baseW, baseH, sim.W * 977 + sim.H * 31 + 7);
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
            // vX 击杀播报：把阵亡/击杀事件转发给 React 层 killfeed（纯展示，零 core/parity 影响）
            onKillRef.current?.({ side: c.id === 'death_ally' ? 'ally' : 'enemy', victim: c.victim ?? '', killer: c.killer, x: cx, y });
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
      drawFrame(octx, sim, skin, particles, trailRef.current, alpha, critFlt.current, burstRef.current, eff, critGlow, autoNRef.current);
      // vX 跟随队长镜头：每帧定位队长单位（heroUid 匹配；队长阵亡则平滑切到首个存活友方），取世界像素中心
      if (cameraModeRef.current === 'follow' && leaderUidRef.current) {
        const u = sim.units.find((x) => x.alive && x.heroUid === leaderUidRef.current)
          ?? sim.units.find((x) => x.alive && x.side === 'ally');
        leaderPosRef.current = u ? { x: u.x * TILE + TILE / 2, y: u.y * TILE + TILE / 2 } : null;
      } else {
        leaderPosRef.current = null;
      }
      // vX 战场合成：满屏 contain 拟合 + 超采样清晰化。
      // 离屏 off 已按 ss 倍超采样（像素美术在高内部分辨率先画好），这里把它 contain 进可见 canvas：
      // 战场在屏幕实际最大尺寸下完整呈现（不裁切、不浪费空间）；cameraZoom>1 时在满屏基础上再拉近
      // （裁切溢出部分 = 拉近镜头）；follow 模式以队长为中心窗口同样 contain 填满。单次 drawImage，零 sim/parity 影响。
      const z = cameraZoomRef.current;
      const mode = cameraModeRef.current;
      const ss = ssRef.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false; // 像素美术：最终合成保持 nearest（离屏已超采样，≈1:1 不糊）
      let sx = 0, sy = 0, sw = baseW, sh = baseH; // 源矩形（世界坐标）
      if (mode === 'follow' && leaderPosRef.current) {
        const fz = cameraZoomModeRef.current === 'auto' ? FOLLOW_AUTO_ZOOM : Math.max(0.5, Math.min(3, cameraZoomModeRef.current));
        sw = baseW / fz; sh = baseH / fz;
        const lp = leaderPosRef.current;
        sx = Math.max(0, Math.min(baseW - sw, lp.x - sw / 2));
        sy = Math.max(0, Math.min(baseH - sh, lp.y - sh / 2));
      }
      // contain 拟合：源矩形（×ss 转离屏像素）放到可见 canvas，保持比例、居中、最小黑边
      const fit = Math.min(canvas.width / (sw * ss), canvas.height / (sh * ss)) * z;
      const dw = sw * ss * fit, dh = sh * ss * fit;
      const dx = (canvas.width - dw) / 2, dy = (canvas.height - dh) / 2;
      ctx.drawImage(off, sx * ss, sy * ss, sw * ss, sh * ss, dx, dy, dw, dh);
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
