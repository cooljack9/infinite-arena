// 单帧绘制（从 ArenaCanvas 抽出，供实机与 dev 验收页共用）
// 抽出来的唯一理由：验收页如果自己重写一遍绘制，验收的就是另一份代码。
// v1.4：地图主题皮（美术 §3.4）+ 体型渲染（§4.5）+ 施法距离可视化三件套（§7.3.1）
import { BattleSim } from '@arena/core/engine/battle';
import { drawSprite, drawMount, drawBuilding, MOUNT_RIDER_LIFT, PoseTransform } from './sprites';
import { Unit, Effect, ThemeInfo, MapTheme, SubClass, SummonKind } from '@arena/core/types';
import { MAP_THEMES, fadeColor } from '@arena/core/content/arenas';
import { BODY_INFO, SUBCLASS_INFO } from '@arena/core/content/classes';
import { VFX_SCALE } from '@arena/core/content/skills';
import { fx, triggerFx, hexRgb } from './fx';

export const TILE = 24;
export const TICK = 1 / 20; // 逻辑步长（与 ArenaCanvas 保持一致）：渲染插值用

// 主题解析后的实用色板（已应用褪色滤镜，绘制时直接用，不在热循环里反复算 HSL）
export interface Skin {
  theme: ThemeInfo;
  floorA: string;
  floorB: string;
  wall: string;
  prop: string;
  accent: string;
  outlineUnits: boolean;
  // v2.9.8 色盲友好双通道：开启后阵营额外用「形状」表达（▲我方 / ▼敌方 + 实线/虚线环），
  // 并把血条换成蓝/橙这对色盲安全色。默认关闭，不影响原有观感。
  colorblind: boolean;
}

// 无主题时的回退（v1.3 的棕色地牢），保证未注入主题的 arena 仍能渲染
const FALLBACK: Skin = {
  theme: MAP_THEMES.sandstone,
  floorA: '#3a2e2a', floorB: '#352a26', wall: '#1a1410',
  prop: '#4a3a30', accent: '#ffae00', outlineUnits: false,
  colorblind: false,
};

export function buildSkin(theme?: MapTheme, fade = 0, colorblind = false): Skin {
  if (!theme) return { ...FALLBACK, colorblind };
  const t = MAP_THEMES[theme];
  return {
    theme: t,
    floorA: fadeColor(t.floorA, fade),
    floorB: fadeColor(t.floorB, fade),
    wall: fadeColor(t.wall, fade),
    prop: fadeColor(t.prop, fade),
    accent: fadeColor(t.accent, fade),
    outlineUnits: !!t.outlineUnits,
    colorblind,
  };
}

// ── v2.9.8 色盲双通道调色板 ──
// 蓝(#3d9bff) / 橙(#ff9a1f) 是通用色盲安全对（三类色觉障碍下亮度与色相差异都足够），
// 用来替换默认的蓝/红与绿/红。颜色只是第二通道，第一通道永远是形状。
const CB_ALLY = '#3d9bff';
const CB_ENEMY = '#ff9a1f';

// ── 环境粒子（美术 §3.4.2）──
// 用固定种子生成，绝不用 Math.random：随机粒子每帧重掷会闪成噪点，
// 且渲染层引入非确定性会让「同一 seed 回放同一局」这条线断掉。
export interface Particle { x: number; y: number; s: number; ph: number; }
export function makeParticles(n: number, w: number, h: number, seed: number): Particle[] {
  let st = seed >>> 0;
  const rnd = () => { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; };
  return Array.from({ length: n }, () => ({
    x: rnd() * w, y: rnd() * h, s: 0.5 + rnd(), ph: rnd() * Math.PI * 2,
  }));
}

export type TrailStore = Map<string, { x: number; y: number }[]>;

// v2.9.3 转身平滑状态：单位 facing 翻转时刻（渲染层私有，单位 id 每场战斗重建无残留）
const flipFacing = new Map<string, number>();
const flipAt = new Map<string, number>();
// v2.9.3 步态淡入状态：记录每单位最近一次"开始移动"的时刻（随 moveAnimUntil 更新检测）
const moveStartAt = new Map<string, { at: number; moveUntil: number }>();

// v2.9.1 全局打击感渲染状态机（fx / triggerFx / hexRgb）已抽到 ./fx.ts

/** 绘制一帧。绘制顺序即信息优先级：地形 < 氛围 < 残影 < 单位 < 弹道 < 特效 < 飘字 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  sim: BattleSim,
  skin: Skin = buildSkin(sim.arena.theme, sim.arena.fade ?? 0),
  particles: Particle[] = makeParticles(46, sim.W * TILE, sim.H * TILE, sim.W * 977 + sim.H * 31 + 7),
  trails: TrailStore = new Map(),
  alpha = 0,
) {
  const wall = performance.now() / 1000;
  // 战斗重开（sim.time 回退）→ 重置全部渲染特效状态，防止跨场残留
  if (sim.time < fx.lastSimT - 0.05) {
    fx.stopUntil = 0; fx.frozenT = null; fx.shakeUntil = 0; fx.flashUntil = 0;
  }
  fx.lastSimT = sim.time;

  // ── 打击感触发源（纯渲染检测，只读 sim 状态，不产生任何 sim 事件）──
  // v2.9.2 三级手感：重击（90ms/4px/暖光）< 技能起手（60ms/3px）< 技能爆发（120~150ms/5~7px/技能色闪光）
  // ① 重击命中峰（攻击窗口 [0.15,0.25]s）：90ms 顿帧 + 4px 震屏 + 全屏暖光微闪
  if (wall >= fx.stopUntil) {
    for (const u of sim.units) {
      if (!u.alive || !u.isHeavyHit) continue;
      const atkT = u.attackAnimAt !== undefined ? sim.time - u.attackAnimAt : 999;
      if (atkT >= 0.15 && atkT < 0.25) {
        triggerFx(wall, 0.09, 4, 0.18, '255,236,200', 0.12, 0.10);
        break;
      }
    }
  }
  // ② 技能起手（castAnimAt 刚写入，0.05s 内，lastCastAt 防抖）：60ms 微顿 + 3px——"技能要来了"
  if (wall >= fx.stopUntil) {
    for (const u of sim.units) {
      if (!u.alive) continue;
      const castT = u.castAnimAt !== undefined ? sim.time - u.castAnimAt : 999;
      if (castT >= 0 && castT < 0.05 && (u.castAnimAt ?? -1) !== fx.lastCastAt) {
        fx.lastCastAt = u.castAnimAt ?? -1;
        triggerFx(wall, 0.06, 3, 0.15, null, 0, 0);
        break;
      }
    }
  }
  // ③ 技能爆发（effect 刚出现，ttl>maxTtl-0.1 天然一次性）：120~150ms 大顿 + 5~7px + 技能色全屏闪光
  if (wall >= fx.stopUntil) {
    let best: { stop: number; amp: number; dur: number; fa: number; fd: number } | null = null;
    let bestCol = '255,255,255';
    for (const e of sim.effects) {
      if (e.dashed || e.ttl <= e.maxTtl - 0.1) continue;
      const tier = e.tier ?? 'mid';
      const cfg = tier === 'long'
        ? { stop: 0.15, amp: 7, dur: 0.28, fa: 0.25, fd: 0.18 }
        : tier === 'mid'
          ? { stop: 0.13, amp: 5, dur: 0.22, fa: 0.20, fd: 0.15 }
          : { stop: 0.12, amp: 5, dur: 0.22, fa: 0.18, fd: 0.15 };
      if (!best || cfg.stop > best.stop) { best = cfg; bestCol = hexRgb(e.color); }
    }
    if (best) triggerFx(wall, best.stop, best.amp, best.dur, bestCol, best.fa, best.fd);
  }

  // 顿帧：hit-stop 期间渲染时间冻结在命中帧（sim 照常推进，动作相位凝固——打击感核心）
  let t: number;
  if (wall < fx.stopUntil) {
    if (fx.frozenT === null) fx.frozenT = sim.time + alpha * TICK;
    t = fx.frozenT;
  } else {
    fx.frozenT = null;
    t = sim.time + alpha * TICK;
  }
  const W = sim.W * TILE, H = sim.H * TILE;
  ctx.clearRect(0, 0, W, H);

  // 震屏：命中后短暂随机平移（伪随机相位，帧间自收敛到 0）
  if (wall < fx.shakeUntil) {
    const s = fx.shakeAmp * Math.max(0, (fx.shakeUntil - wall) / Math.max(0.001, fx.shakeDur));
    ctx.save();
    ctx.translate(
      (Math.sin(wall * 137.3) * 0.6 + Math.sin(wall * 91.7) * 0.4) * s,
      (Math.cos(wall * 113.1) * 0.6 + Math.sin(wall * 157.7) * 0.4) * s,
    );
  }

  for (let r = 0; r < sim.H; r++) {
    for (let c = 0; c < sim.W; c++) {
      drawTile(ctx, sim.arenaTile(r, c), r, c, skin, t, sim.arena.hazardBase, sim.arena.hazardWave);
    }
  }
  // v2.9.3 地形永久改变——刀痕（青龙偃月斩：线状焦土 + 贯穿裂纹，单点克制破坏）
  for (const sl of sim.terrainSlashs) drawSlashArea(ctx, sl);
  // v2.9.3 地形永久改变——坑底（玄武大坑的凹陷部分，画在单位之下）
  for (const cr of sim.terrainCraters) drawCraterBase(ctx, cr, t);

  drawParticles(ctx, skin, particles, t, W, H);

  updateTrails(trails, sim.units);
  for (const u of sim.units) drawTrail(ctx, u, trails);

  for (const u of sim.units) drawUnit(ctx, u, skin, t, alpha, sim.terrainCraters);

  for (const p of sim.projectiles) {
    // 弹道头部按 alpha 在上一 tick→当前 tick 间插值（R1：弹道不再 20Hz 跳格）
    const hx = (p.prevX ?? p.x) + (p.x - (p.prevX ?? p.x)) * alpha;
    const hy = (p.prevY ?? p.y) + (p.y - (p.prevY ?? p.y)) * alpha;
    // v2.9 重击弹道：更粗 + 加色发光 + 白热芯（远程重击要有"重"的观感）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (p.heavy) {
      ctx.strokeStyle = p.color; ctx.lineWidth = 5;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(hx * TILE, hy * TILE);
      ctx.lineTo(p.tx * TILE, p.ty * TILE);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.4;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(hx * TILE, hy * TILE);
      ctx.lineTo(p.tx * TILE, p.ty * TILE);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(hx * TILE - 3, hy * TILE - 3, 6, 6);
    } else {
      ctx.strokeStyle = p.color; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hx * TILE, hy * TILE);
      ctx.lineTo(p.tx * TILE, p.ty * TILE);
      ctx.stroke();
      ctx.fillStyle = p.color;
      ctx.fillRect(hx * TILE - 2, hy * TILE - 2, 4, 4);
    }
    ctx.restore();
  }

  for (const e of sim.effects) drawEffect(ctx, e, alpha);

  ctx.textAlign = 'center';
  // v2.9.5 飘字分组渲染：按字体分组、仅在字体变化时切换 ctx.font，减少 Canvas 状态抖动
  const heavyFont = 'bold 16px ui-monospace, monospace';
  const normalFont = 'bold 12px ui-monospace, monospace';
  let lastFont = '';
  for (const f of sim.floaters) {
    const font = f.color === '#ffd24d' ? heavyFont : normalFont;
    if (font !== lastFont) { ctx.font = font; lastFont = font; }
    ctx.globalAlpha = Math.max(0, Math.min(1, f.ttl * 1.5));
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x * TILE, f.y * TILE);
  }
  ctx.globalAlpha = 1;

  // v2.9.3 坑沿前景（画在单位之后）：土堆盖住坑内角色脚部——"陷在地面以下"的感觉
  for (const cr of sim.terrainCraters) drawCraterRim(ctx, cr, t);

  // 震屏复位（若有）
  if (wall < fx.shakeUntil) ctx.restore();

  // v2.9.1/2 全屏闪光：重击=暖光微闪 0.12；技能爆发=技能色 0.18~0.25（规格高于重击）
  if (wall < fx.flashUntil) {
    const fa = fx.flashAmp * Math.max(0, (fx.flashUntil - wall) / Math.max(0.001, fx.flashDur));
    ctx.fillStyle = `rgba(${fx.flashColor},${fa})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// ── 地块 ─────────────────────────────────────────────────────
// 布局（tilemap）一个字节都没改，换的只是这里的颜色与掩体形态。
// 这是「主题与布局正交」的落地点：战术记忆保留，视觉新鲜感刷新。
function drawTile(
  ctx: CanvasRenderingContext2D, ch: string, r: number, c: number, skin: Skin, t: number,
  hazardBase = '#05030a', hazardWave = 'rgba(74,163,255,0.20)',
) {
  const x = c * TILE, y = r * TILE;

  if (ch === '~') {
    // v2.9.3 危险地形：底色随地图（楚河汉界=水蓝 / 八角笼=岩浆红 / 默认虚空黑）
    ctx.fillStyle = hazardBase;
    ctx.fillRect(x, y, TILE, TILE);
    // 两条相位错开的波纹/熔光扫色（河与岩浆都"活"）
    ctx.strokeStyle = hazardWave;
    ctx.lineWidth = 1;
    const ph = t * 1.6 + r * 0.7 + c * 0.11;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 4 + Math.sin(ph) * 2);
    ctx.lineTo(x + TILE - 2, y + 4 + Math.sin(ph + 1.2) * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 2, y + TILE - 5 + Math.cos(ph * 0.8) * 2);
    ctx.lineTo(x + TILE - 2, y + TILE - 5 + Math.cos(ph * 0.8 + 0.9) * 2);
    ctx.stroke();
    return;
  }

  if (ch === 'M') {
    // v2.9.3 随机岩浆：可通行但每秒灼烧 3%——暗红底 + 熔光核心 + 波纹（"烫"的地面）
    ctx.fillStyle = '#4a1508';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = 'rgba(255,110,40,0.30)';
    ctx.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
    ctx.strokeStyle = 'rgba(255,140,60,0.5)';
    ctx.lineWidth = 1;
    const mph = t * 2.0 + r * 0.6 + c * 0.13;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 5 + Math.sin(mph) * 2);
    ctx.lineTo(x + TILE - 2, y + 5 + Math.sin(mph + 1.1) * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 2, y + TILE - 6 + Math.cos(mph * 0.9) * 2);
    ctx.lineTo(x + TILE - 2, y + TILE - 6 + Math.cos(mph * 0.9 + 0.8) * 2);
    ctx.stroke();
    return;
  }

  if (ch === '#') {
    ctx.fillStyle = skin.wall;
    ctx.fillRect(x, y, TILE, TILE);
    // 顶面高光 1px：唯一能让「墙」在低对比度主题里读出体积的笔触
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = skin.accent;
    ctx.fillRect(x, y, TILE, 1);
    ctx.globalAlpha = 1;
    return;
  }

  // 地面棋格：floorA/floorB 交替，对比度锁在 ≤1.15:1（美术 §3.4.4 可读性硬约束）
  ctx.fillStyle = (r + c) % 2 === 0 ? skin.floorA : skin.floorB;
  ctx.fillRect(x, y, TILE, TILE);

  if (ch === 'P') drawProp(ctx, x, y, skin, t);
  if (ch === 'S') { ctx.fillStyle = 'rgba(74,163,255,0.18)'; ctx.fillRect(x, y, TILE, TILE); }
  if (ch === 'E') { ctx.fillStyle = 'rgba(255,74,74,0.18)'; ctx.fillRect(x, y, TILE, TILE); }
  if (ch === 'B') {
    ctx.fillStyle = skin.prop;
    ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = skin.accent; ctx.lineWidth = 1;
    ctx.strokeRect(x + 2, y + 2, TILE - 4, TILE - 4);
  }
}

// v2.9.3 地形永久改变：刀痕（线状焦土+贯穿裂纹）/ 大坑（坑底 + 坑沿前景，角色陷坑）。
// 裂纹/碎土位置用坐标哈希确定性生成（零 Math.random，帧间稳定）。

/** 刀痕（青龙偃月斩）：沿劈砍方向的焦土带 + 贯穿主裂纹 + 着力点亮痕——单点武器克制的破坏 */
function drawSlashArea(ctx: CanvasRenderingContext2D, sl: { x0: number; y0: number; x1: number; y1: number; w: number }) {
  const x0 = sl.x0 * TILE, y0 = sl.y0 * TILE, x1 = sl.x1 * TILE, y1 = sl.y1 * TILE;
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const w = Math.max(4, sl.w * TILE * 2.2); // 带宽（随体型）
  const h = (Math.round(sl.x0 * 977) + Math.round(sl.y0 * 631)) % 100;
  ctx.save();
  ctx.translate((x0 + x1) / 2, (y0 + y1) / 2);
  ctx.rotate(ang);
  ctx.lineCap = 'round';
  // ① 焦土带：三层线堆叠（粗焦棕 → 中黑 → 细黑核心），"刀过留焦"
  ctx.strokeStyle = 'rgba(72,40,18,0.55)';
  ctx.lineWidth = w * 1.5;
  ctx.beginPath(); ctx.moveTo(-len / 2, 0); ctx.lineTo(len / 2, 0); ctx.stroke();
  ctx.strokeStyle = 'rgba(20,12,8,0.85)';
  ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(-len / 2, 0); ctx.lineTo(len / 2, 0); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.95)';
  ctx.lineWidth = w * 0.4;
  ctx.beginPath(); ctx.moveTo(-len / 2, 0); ctx.lineTo(len / 2, 0); ctx.stroke();
  // ② 贯穿主裂纹：波浪折线（确定性），刀劈处地裂一线
  ctx.strokeStyle = 'rgba(0,0,0,0.95)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-len / 2, 0);
  const seg = 5;
  for (let i = 1; i <= seg; i++) {
    const px2 = -len / 2 + (len * i) / seg;
    const py2 = Math.sin(i * 2.7 + h * 0.1) * w * 0.45;
    ctx.lineTo(px2, py2);
  }
  ctx.stroke();
  // 主裂纹中段分叉（Y 形短支）
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-len * 0.1, Math.sin(2 * 2.7 + h * 0.1) * w * 0.45);
  ctx.lineTo(-len * 0.1 + w * 0.8, Math.sin(2 * 2.7 + h * 0.1) * w * 0.45 - w * 0.7);
  ctx.stroke();
  // ③ 劈砍着力点亮痕（刀起处暗红余烬）
  ctx.fillStyle = 'rgba(200,70,35,0.6)';
  ctx.beginPath(); ctx.arc(-len / 2, 0, w * 0.32, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** 大坑坑底（玄武）：深陷椭圆 + 坑底更黑 + 暗红余烬——画在单位之下 */
function drawCraterBase(ctx: CanvasRenderingContext2D, cr: { x: number; y: number; r: number }, t: number) {
  const cx = cr.x * TILE, cy = cr.y * TILE;
  const rw = cr.r * TILE, rh = cr.r * 0.62 * TILE; // 地面视角压扁
  ctx.save();
  // 坑底主凹陷
  ctx.fillStyle = 'rgba(8,5,10,0.95)';
  ctx.beginPath(); ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2); ctx.fill();
  // 最深处
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.beginPath(); ctx.ellipse(cx, cy, rw * 0.62, rh * 0.55, 0, 0, Math.PI * 2); ctx.fill();
  // 坑底暗红余烬（玄武之怒的余温，呼吸）
  ctx.globalAlpha = 0.4 + 0.2 * Math.sin(t * 2 + cr.x * 7);
  ctx.fillStyle = 'rgba(190,60,30,0.6)';
  ctx.beginPath(); ctx.ellipse(cx, cy - rh * 0.15, rw * 0.24, rh * 0.15, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** 大坑坑沿前景（画在单位之后）：土堆月牙盖住坑内角色脚部——"陷在地面以下" */
function drawCraterRim(ctx: CanvasRenderingContext2D, cr: { x: number; y: number; r: number }, _t: number) {
  const cx = cr.x * TILE, cy = cr.y * TILE;
  const rw = cr.r * TILE, rh = cr.r * 0.62 * TILE;
  const h = (Math.round(cr.x * 31) + Math.round(cr.y * 17)) % 100;
  ctx.save();
  // 下方土堆月牙（前景，盖住角色脚部）
  ctx.fillStyle = 'rgba(160,130,95,0.6)';
  ctx.beginPath(); ctx.ellipse(cx, cy, rw * 1.2, rh * 1.2, 0, Math.PI * 0.95, Math.PI * 1.95); ctx.fill();
  ctx.fillStyle = 'rgba(70,52,38,0.8)';
  ctx.beginPath(); ctx.ellipse(cx, cy, rw * 1.06, rh * 1.06, 0, Math.PI * 1.05, Math.PI * 1.85); ctx.fill();
  // 高光弧（左上坑沿被光照亮）
  ctx.strokeStyle = 'rgba(210,190,165,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(cx, cy, rw * 1.04, rh * 1.04, 0, Math.PI * 0.85, Math.PI * 1.45); ctx.stroke();
  // 坑沿碎土粒（确定性）
  ctx.fillStyle = 'rgba(120,95,70,0.65)';
  ctx.fillRect(cx - rw + (h % 5) + 2, cy - rh + ((h >> 2) % 4) + 2, 2, 2);
  ctx.fillRect(cx + rw - ((h >> 4) % 5) - 4, cy + rh - ((h >> 6) % 4) - 4, 2, 2);
  ctx.restore();
}

// 掩体形态按主题换剪影：同一个 'P' 在沙岩是方碑、在冰霜是冰棱、在虚空是浮石。
// 掩体是玩家读地形的主要锚点，形状变了「这张图不一样」的感受才成立——只换颜色骗不过人。
function drawProp(ctx: CanvasRenderingContext2D, x: number, y: number, skin: Skin, t: number) {
  ctx.fillStyle = skin.prop;
  switch (skin.theme.id) {
    case 'frost': { // 冰棱：上尖下宽三角 + 顶端高光
      ctx.beginPath();
      ctx.moveTo(x + TILE / 2, y + 2);
      ctx.lineTo(x + TILE - 3, y + TILE - 2);
      ctx.lineTo(x + 3, y + TILE - 2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = skin.accent; ctx.globalAlpha = 0.5;
      ctx.fillRect(x + TILE / 2 - 1, y + 3, 2, 6);
      ctx.globalAlpha = 1;
      break;
    }
    case 'magma': { // 岩柱：暗块 + 呼吸的熔缝（唯一动态掩体，暗示脚下是活的）
      ctx.fillStyle = '#2a1410';
      ctx.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
      ctx.globalAlpha = 0.45 + 0.25 * Math.sin(t * 2 + x * 0.1);
      ctx.fillStyle = skin.prop;
      ctx.fillRect(x + TILE / 2 - 1, y + 5, 2, TILE - 10);
      ctx.globalAlpha = 1;
      break;
    }
    case 'void': { // 浮石：悬空 + 下方虚影（虚空里没有「地基」这回事）
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#000';
      ctx.fillRect(x + 5, y + TILE - 4, TILE - 10, 2);
      ctx.globalAlpha = 1; ctx.fillStyle = skin.prop;
      const off = Math.sin(t * 1.2 + x * 0.07) * 1.5;
      ctx.fillRect(x + 4, y + 4 + off, TILE - 8, TILE - 11);
      ctx.strokeStyle = skin.accent; ctx.globalAlpha = 0.4; ctx.lineWidth = 1;
      ctx.strokeRect(x + 4, y + 4 + off, TILE - 8, TILE - 11);
      ctx.globalAlpha = 1;
      break;
    }
    case 'verdant': { // 树桩：圆 + 年轮
      ctx.beginPath(); ctx.arc(x + TILE / 2, y + TILE / 2, TILE * 0.36, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = skin.accent; ctx.globalAlpha = 0.45; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x + TILE / 2, y + TILE / 2, TILE * 0.20, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'sanctum': { // 断柱：柱身 + 柱头横楣
      ctx.fillRect(x + 6, y + 4, TILE - 12, TILE - 6);
      ctx.fillStyle = skin.accent; ctx.globalAlpha = 0.55;
      ctx.fillRect(x + 3, y + 3, TILE - 6, 3);
      ctx.globalAlpha = 1;
      break;
    }
    default: { // sandstone：方碑 + 内凹
      ctx.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
      ctx.fillStyle = skin.wall;
      ctx.fillRect(x + 6, y + 6, TILE - 12, TILE - 12);
      break;
    }
  }
}

// ── 环境粒子 ─────────────────────────────────────────────────
// 硬约束：alpha ≤ 0.5、尺寸 ≤ 3px、且全部画在单位之下。
// 氛围一旦开始跟血条抢注意力，它就从加分项变成了 bug。
function drawParticles(ctx: CanvasRenderingContext2D, skin: Skin, ps: Particle[], t: number, w: number, h: number) {
  ctx.save();
  const kind = skin.theme.particle;
  ctx.fillStyle = kind === 'ember' ? skin.prop : skin.accent;
  for (const p of ps) {
    switch (kind) {
      case 'sand': {
        const x = (p.x + t * 22 * p.s) % w;
        ctx.globalAlpha = 0.14;
        ctx.fillRect(x, p.y, 2, 1);
        break;
      }
      case 'mist': {
        const y = (p.y - t * 5 * p.s + h) % h;
        ctx.globalAlpha = 0.05;
        ctx.beginPath(); ctx.arc(p.x, y, 9 + p.s * 8, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'ember': {
        const y = h - ((p.y + t * 28 * p.s) % h);
        const x = p.x + Math.sin(t * 2 + p.ph) * 3;
        ctx.globalAlpha = 0.35 + 0.25 * Math.sin(t * 6 + p.ph);
        ctx.fillRect(x, y, 2, 2);
        break;
      }
      case 'star': { // 静止星点闪烁（虚空唯一的空间参照物，不能动）
        ctx.globalAlpha = 0.10 + 0.22 * Math.abs(Math.sin(t * 1.6 + p.ph));
        ctx.fillRect(p.x, p.y, 1, 1);
        break;
      }
      case 'leaf': {
        const y = (p.y + t * 14 * p.s) % h;
        const x = (p.x + Math.sin(t * 0.9 + p.ph) * 6 + w) % w;
        ctx.globalAlpha = 0.16;
        ctx.fillRect(x, y, Math.sin(t + p.ph) > 0 ? 3 : 1, 2);
        break;
      }
      case 'dust': {
        const y = (p.y + t * 7 * p.s) % h;
        ctx.globalAlpha = 0.10;
        ctx.fillRect(p.x, y, 1, 1);
        break;
      }
    }
  }
  ctx.restore();
}

// ── 残影 ─────────────────────────────────────────────────────
function updateTrails(map: TrailStore, units: Unit[]) {
  for (const u of units) {
    if (!u.alive) { map.delete(u.id); continue; }
    if (BODY_INFO[u.bodyType].trailFrames <= 0) continue;
    const arr = map.get(u.id) ?? [];
    arr.push({ x: u.x, y: u.y });
    if (arr.length > 7) arr.shift();
    map.set(u.id, arr);
  }
}

function drawTrail(ctx: CanvasRenderingContext2D, u: Unit, map: TrailStore) {
  const frames = BODY_INFO[u.bodyType].trailFrames;
  if (frames <= 0 || !u.alive) return;
  const hist = map.get(u.id);
  if (!hist || hist.length < 3) return;
  const size = BODY_INFO[u.bodyType].renderPx * 0.55;
  const col = u.side === 'enemy' ? '#c0444a' : SUBCLASS_INFO[u.subclass].color;
  ctx.save();
  ctx.fillStyle = col;
  for (let i = 1; i <= frames; i++) {
    const g = hist[hist.length - 1 - i * 2];
    if (!g) continue;
    // 静止时不留残影：残影是「速度」的编码，站桩的小个子拖影只会显得画面脏
    if (Math.hypot(g.x - u.x, g.y - u.y) < 0.06) continue;
    ctx.globalAlpha = 0.22 / i;
    ctx.fillRect(g.x * TILE - size / 2, g.y * TILE - size / 2, size, size);
  }
  ctx.restore();
}

// ── 单位 ─────────────────────────────────────────────────────
// ── v1.6 特性视觉签名（美术升级 A.8）──
// 特性写进引擎却在画面上看不见，等于没做。每个特性给一个专属色的脚下光环，
// 玩家扫一眼阵型就知道谁带了什么，不必去翻面板。
const TRAIT_AURA: Record<string, string> = {
  bulwark: '#6fd3ff', spellbreak: '#b07bff', momentum: '#ffd23f',
  bloodedge: '#ff5f8a', volley: '#7dd87d', lethal: '#ff9a3f',
  shackle: '#7ad0ff', legion: '#9b7bff', grace: '#7fe3b0',
};

/** 由 id 派生稳定相位：同屏单位的待机呼吸必须错开，齐步呼吸看起来像卡帧 */
function idPhase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 628) / 100;
}

// ══ v2.7 角色招牌动作系统 ════════════════════════════════════
// 9 职业各有动作签名：待机节奏 / 普攻轨迹 / 施法姿态 / 受击反应 / 倒下方式。
// 原则：动作即身份——剪影之外，靠"动起来的样子"区分职业：
// 玄武沉稳如盾、枪手举铳微颤、后羿凝神如松、女娲蛇形轻摆……
// 替换旧版全局统一的机械抖动（人人同频呼吸 + 同幅前冲），消除"乱跳没美感"。
//
// 全部由确定性 sim 相位（attackAnimAt/castAnimAt/flash/alive/deadAt）驱动，
// 渲染层零 Math.random，同一 seed 回放视觉一致。

type AtkKind = 'slash' | 'thrust' | 'gun' | 'bow' | 'punch' | 'shield' | 'sweep' | 'staff';

interface MotionCfg {
  freq: number;      // 待机呼吸频率（越大越"躁"，越小越"稳"）
  amp: number;       // 待机呼吸幅度（× px）
  lean: number;      // 待机常驻前倾（rad，气势：武圣前压、剑客弓腰）
  atk: AtkKind;      // 普攻轨迹样式
  windup: number;    // 收势后拽（px）
  lunge: number;     // 出手前冲（px）
  squash: number;    // 命中挤压（1−squash = scaleY 压缩量）
  atkColor: string;  // 武器轨迹色（跟随职业签名色）
  castRise: number;  // 施法上浮（× px）
  orb: string;       // 施法聚能球色（'' = 无球）
  hitLean: number;   // 受击后仰（rad）
  dieRot: number;    // 倒下旋转（rad）
  dieSink: number;   // 倒下下沉（× px）
  sway?: number;     // 额外侧摆（× px，蛇形/飘动单位）
}

const MOTION: Record<SubClass, MotionCfg> = {
  // 玄武前排：重盾将，呼吸沉稳；普攻=盾击横扫（横线+盾环）
  physTank:   { freq: 1.6, amp: 0.016, lean: 0.020, atk: 'shield', windup: 2, lunge: 3, squash: 0.12, atkColor: SUBCLASS_INFO.physTank.color, castRise: 0.05, orb: '', hitLean: 0.10, dieRot: 0.85, dieSink: 0.32 },
  // 符甲战将：符箓道袍，呼吸轻快；普攻=符箓横扫（上扫曲线）
  magicTank:  { freq: 2.0, amp: 0.018, lean: 0.010, atk: 'sweep', windup: 2, lunge: 3, squash: 0.10, atkColor: SUBCLASS_INFO.magicTank.color, castRise: 0.10, orb: SUBCLASS_INFO.magicTank.color, hitLean: 0.13, dieRot: 1.00, dieSink: 0.30 },
  // 武圣突袭：长髯重刀，出手大开大合；普攻=青龙月牙斩（弧）
  charge:     { freq: 1.4, amp: 0.020, lean: 0.035, atk: 'slash', windup: 3, lunge: 5, squash: 0.15, atkColor: SUBCLASS_INFO.charge.color, castRise: 0.05, orb: SUBCLASS_INFO.charge.color, hitLean: 0.09, dieRot: 0.65, dieSink: 0.38 },
  // 无名剑客：江湖客，快剑突刺；普攻=竖直快剑（线+尖端亮）
  hexblade:   { freq: 2.6, amp: 0.010, lean: 0.040, atk: 'thrust', windup: 2, lunge: 4, squash: 0.12, atkColor: SUBCLASS_INFO.hexblade.color, castRise: 0.06, orb: '', hitLean: 0.16, dieRot: 1.20, dieSink: 0.26 },
  // 神机炮手：举铳微颤（枪不稳）；普攻=枪口火花+放射线
  gunner:     { freq: 3.4, amp: 0.007, lean: 0.015, atk: 'gun', windup: 1, lunge: 1, squash: 0.16, atkColor: SUBCLASS_INFO.gunner.color, castRise: 0.03, orb: '', hitLean: 0.10, dieRot: 0.95, dieSink: 0.30 },
  // 神射手·后羿：凝神如松（几乎不呼吸）；普攻=箭轨细线
  sniper:     { freq: 1.2, amp: 0.008, lean: 0.025, atk: 'bow', windup: 2, lunge: 0, squash: 0.06, atkColor: SUBCLASS_INFO.sniper.color, castRise: 0.02, orb: '', hitLean: 0.12, dieRot: 1.25, dieSink: 0.24 },
  // 太极宗师：舒缓推掌；普攻=圆波
  controller: { freq: 1.8, amp: 0.018, lean: 0.010, atk: 'punch', windup: 2, lunge: 3, squash: 0.10, atkColor: SUBCLASS_INFO.controller.color, castRise: 0.12, orb: SUBCLASS_INFO.controller.color, hitLean: 0.12, dieRot: 1.00, dieSink: 0.30 },
  // 女娲造人：蛇形轻摆（sway）；普攻=杖头光点
  summoner:   { freq: 2.2, amp: 0.014, lean: 0.010, atk: 'staff', windup: 1, lunge: 2, squash: 0.08, atkColor: SUBCLASS_INFO.summoner.color, castRise: 0.10, orb: SUBCLASS_INFO.summoner.color, hitLean: 0.14, dieRot: 1.05, dieSink: 0.34, sway: 0.020 },
  // 青囊神医：把脉前倾；普攻=药杖轻点
  healer:     { freq: 2.0, amp: 0.012, lean: 0.030, atk: 'staff', windup: 1, lunge: 2, squash: 0.08, atkColor: SUBCLASS_INFO.healer.color, castRise: 0.10, orb: SUBCLASS_INFO.healer.color, hitLean: 0.14, dieRot: 1.00, dieSink: 0.30 },
};

// 召唤物轻量配置：机制骨架可复用职业，但动作从简（消耗品，不抢主力注意力）
const SUMMON_MOTION: Record<SummonKind, MotionCfg> = {
  bulwark:  { freq: 0.8, amp: 0.004, lean: 0, atk: 'punch', windup: 0, lunge: 0, squash: 0.06, atkColor: '#6fd3ff', castRise: 0, orb: '', hitLean: 0.06, dieRot: 0.40, dieSink: 0.30 },
  sprinter: { freq: 5.0, amp: 0.010, lean: 0, atk: 'thrust', windup: 0, lunge: 1, squash: 0.10, atkColor: '#cfe3ff', castRise: 0, orb: '', hitLean: 0.10, dieRot: 1.00, dieSink: 0.24 },
  arcanist: { freq: 4.0, amp: 0.016, lean: 0, atk: 'staff', windup: 0, lunge: 0, squash: 0.08, atkColor: '#ffb84d', castRise: 0.05, orb: '', hitLean: 0.10, dieRot: 0.80, dieSink: 0.30 },
};

// 怪物（monsterKind 走独立模板，机制骨架是某 SubClass）用保守默认：不抖不飘，只保留受击/倒下
const DEFAULT_MOTION: MotionCfg = {
  freq: 2.0, amp: 0.012, lean: 0, atk: 'punch', windup: 1, lunge: 2, squash: 0.10,
  atkColor: '#ffffff', castRise: 0.05, orb: '', hitLean: 0.12, dieRot: 1.00, dieSink: 0.30,
};

function motionOf(u: Unit): MotionCfg {
  if (u.summonKind) return SUMMON_MOTION[u.summonKind] ?? DEFAULT_MOTION;
  return MOTION[u.subclass] ?? DEFAULT_MOTION;
}

/** computePose 的输出：身体变换 + 绘制辅助信息 */
interface PoseOut {
  pose: PoseTransform;                       // 传给 drawSprite（tx 局部=朝前方向，镜像由外层处理）
  bodyY: number;                             // 身体绘制 cy（含呼吸/步态/施法上浮；不含 pose.ty）
  overlay?: { kind: AtkKind; prog: number; color: string; heavy?: boolean } | null; // 武器轨迹
  orb?: { r: number; color: string } | null; // 施法聚能球
  alpha: number;                             // 1=存活；尸体渐隐
  hud: boolean;                              // 尸体不画 HUD/状态装饰
  hitFx?: { prog: number; color: string } | null; // v2.9 重击命中冲击环（纯渲染，无 sim 事件）
}

/** 由确定性 sim 相位计算角色姿态。0.32s 普攻窗口、0.28s 施法窗口与引擎 attackAnim/castAnim 对齐 */
function computePose(u: Unit, t: number, _cx: number, cy: number, px: number): PoseOut {
  const cfg = motionOf(u);
  const phase = idPhase(u.id);

  // ── 尸体窗口（alive=false 且 deadAt 已置）：倒下 → 定格 → 渐隐半透明 ──
  if (!u.alive) {
    const age = u.deadAt !== undefined ? t - u.deadAt : 0;
    const k = Math.min(1, Math.max(0, age / 0.45));   // 倒下进度 0..1
    const ease = 1 - Math.pow(1 - k, 2);              // ease-out：快倒慢停
    const alpha = age < 0.7 ? 1 : Math.max(0.32, 1 - (age - 0.7) / 0.5); // 1→0.32 半透明尸体
    return {
      pose: { ty: px * cfg.dieSink * ease, rot: -cfg.dieRot * ease },
      bodyY: cy + px * 0.10 * ease,
      alpha,
      hud: false,
    };
  }

  // ── v2.9 击倒（kdUntil>t）：活着但被近战重击放倒 → 快速倒地 → 苏醒回正 ──
  if ((u.kdUntil ?? 0) > t) {
    const remain = (u.kdUntil ?? 0) - t;
    const k = 1 - Math.max(0, remain / 0.9);  // 击倒进度 0..1（总时长 0.9s 与引擎一致）
    let rot: number;
    // v2.9.3 缓动：倒地 easeOut（快倒慢停）、回正 easeOutCubic（不弹）
    if (k < 0.6) {
      const kk = k / 0.6;
      rot = -1.25 * (1 - Math.pow(1 - kk, 2));   // 快倒慢停
    } else {
      const kk = Math.min(1, (k - 0.6) / 0.25);
      rot = -1.25 * (1 - kk * kk * (3 - 2 * kk)); // 回正 smoothstep，无回弹
    }
    return {
      pose: { rot, ty: px * 0.10 * Math.min(1, k * 2) },
      bodyY: cy + px * 0.05,
      alpha: 1,
      hud: true,
    };
  }

  // ── 待机：per-class 呼吸节奏 + 可选蛇形侧摆 ──
  // v2.9.3 骑乘时禁用自身呼吸/步态：坐骑代步（MOUNT_GAIT 五兽专属步态），
  // 骑手再上下颠就是双重抖动——不流畅的隐形主因
  const riding = !!u.mount;
  const bob = riding ? 0 : Math.sin(t * cfg.freq + phase) * px * cfg.amp;
  const sway = riding ? 0 : cfg.sway ? Math.sin(t * cfg.freq * 1.3 + phase) * px * cfg.sway : 0;
  // 步态：移动中上下错相（v2.9.3 降频 11→5.5Hz、幅度 0.04→0.028 + 相位错开——
  // 高频颠簸是"弹弹人"观感主因，5.5Hz 接近自然步频，相位错开避免全队同步弹）
  // v2.9.3 移动窗口两端淡入淡出：开始 0.12s 淡入、最后 0.15s 淡出——消除起步/止步的幅度跳变
  const moveAge = (u.moveAnimUntil ?? 0) > t ? (u.moveAnimUntil ?? 0) - t : 0;
  let walkBob = 0;
  if (!riding && moveAge > 0) {
    const started = moveStartAt.get(u.id);
    if (started === undefined || (u.moveAnimUntil ?? 0) > started.moveUntil) {
      moveStartAt.set(u.id, { at: t, moveUntil: u.moveAnimUntil ?? 0 });
    }
    const st = moveStartAt.get(u.id)!;
    const fadeIn = Math.min(1, Math.max(0, (t - st.at) / 0.12));
    const fadeOut = Math.min(1, moveAge / 0.15);
    walkBob = Math.sin(t * 5.5 + phase * 0.5) * px * 0.028 * fadeIn * fadeOut;
  }

  let rot = cfg.lean;
  let tx = 0, ty = 0, sx = 1, sy = 1;
  let overlay: PoseOut['overlay'] = null;
  let orb: PoseOut['orb'] = null;
  let hitFx: PoseOut['hitFx'] = null;

  // ── 普攻：轻击 0.32s / 重击 0.5s（v2.9：重击蓄力更深、前冲更猛、挤压更狠）──
  // 收势后拽 → 前冲 → 命中挤压 → 回位 + 武器轨迹；重击命中峰叠加冲击环
  const heavy = !!u.isHeavyHit;
  const atkWin = heavy ? 0.5 : 0.32;
  const atkT = u.attackAnimAt !== undefined ? t - u.attackAnimAt : 999;
  if (atkT >= 0 && atkT < atkWin) {
    const p = atkT / atkWin;
    const wu = heavy ? cfg.windup * 1.6 : cfg.windup;
    const lu = heavy ? cfg.lunge * 1.35 : cfg.lunge;
    const sq = heavy ? cfg.squash * 1.5 : cfg.squash;
    if (p < 0.12) {
      // v2.9.3 收势后拽加 easeOut：起步先慢后快，不再线性硬拉
      const kk = p / 0.12;
      tx = -wu * (1 - Math.pow(1 - kk, 2));
    }
    else if (p < 0.5) tx = lu * Math.sin(((p - 0.12) / 0.38) * Math.PI); // 前冲→峰值→回
    const g = Math.exp(-Math.pow((p - 0.38) / 0.13, 2)); // 命中挤压（高斯峰）
    sx = 1 + g * sq * 0.7;
    sy = 1 - g * sq;
    if (p >= 0.15 && p < 0.85) overlay = { kind: cfg.atk, prog: (p - 0.15) / 0.7, color: cfg.atkColor, heavy };
    // v2.9 重击命中冲击环：挤压峰值附近爆发（纯渲染，不产生 sim 事件）
    if (heavy && p >= 0.30 && p < 0.50) {
      hitFx = { prog: (p - 0.30) / 0.20, color: cfg.atkColor };
    }
  }

  // ── 施法（0.28s）：上浮 + 身前聚能球由小变大 ──
  let castFloat = 0;
  const castT = u.castAnimAt !== undefined ? t - u.castAnimAt : 999;
  if (castT >= 0 && castT < 0.28) {
    const cr = castT / 0.28;
    castFloat = -Math.sin(cr * Math.PI) * px * cfg.castRise;
    if (cfg.orb) orb = { r: px * (0.10 + 0.22 * cr), color: cfg.orb };
  }

  // ── 受击（flash>0）：后仰 + 高频短抖（血条不跟抖，保持可读）──
  if (u.flash > 0) {
    const k = Math.min(1, u.flash * 4);
    rot -= cfg.hitLean * k;
    ty += Math.sin(t * 14) * px * 0.012 * k;
  }

  return {
    pose: { tx, ty, rot, sx, sy },
    bodyY: cy + bob + walkBob + sway + castFloat,
    overlay,
    orb,
    alpha: 1,
    hud: true,
    hitFx,
  };
}

/** 武器轨迹 overlay（镜像包裹内调用：局部 x 正=朝前，facing 由外层镜像自动处理） */
function drawAtkOverlay(
  ctx: CanvasRenderingContext2D,
  o: NonNullable<PoseOut['overlay']>,
  cx: number, bodyY: number, px: number,
) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter'; // 加色：轨迹是"光"不是"墨"
  // v2.8 更亮：峰值 alpha 0.55 → 0.85，配合发光底 + 白热芯
  // v2.9 重击轨迹峰值再拉高（0.85 → 0.95），与轻击拉开亮度层级
  const a = Math.sin(Math.min(1, o.prog * 2.4) * Math.PI) * (o.heavy ? 0.95 : 0.85); // 出现→峰值→淡出
  ctx.lineCap = 'round';
  const x0 = cx, y0 = bodyY;
  // 发光底(低 alpha 粗线) + 亮芯(白热细线) 两遍绘制
  const pass = (draw: () => void) => {
    ctx.globalAlpha = a * 0.35;
    ctx.strokeStyle = o.color;
    draw();
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#ffffff';
    draw();
  };
  switch (o.kind) {
    case 'slash': { // 武圣：水平月牙横扫（v2.9.3 刃朝敌方——弧围绕朝前 x 轴扫出）
      const w = px * 0.20;
      const a0 = -Math.PI * 0.30 + o.prog * Math.PI * 0.6;
      pass(() => { ctx.lineWidth = w; ctx.beginPath(); ctx.arc(x0 + px * 0.12, y0 + px * 0.02, px * 0.55, a0, a0 + 1.0); ctx.stroke(); });
      break;
    }
    case 'thrust': { // 剑客：水平刺击（v2.9.3 剑刃朝前刺出，尖端亮）
      const w = px * 0.13;
      const len = px * (0.35 + 0.55 * o.prog);
      pass(() => { ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0 + px * 0.10, y0 - px * 0.10); ctx.lineTo(x0 + px * 0.10 + len, y0 - px * 0.10); ctx.stroke(); });
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = Math.min(1, a * 1.4);
      ctx.beginPath();
      ctx.arc(x0 + px * 0.10 + len, y0 - px * 0.10, px * 0.08, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'gun': { // 枪手：枪口火花 + 放射线
      const gx = x0 + px * 0.42, gy = y0 - px * 0.12;
      ctx.fillStyle = o.color;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(gx, gy, px * (0.12 + 0.12 * (1 - o.prog)), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = px * 0.07;
      for (let i = 0; i < 4; i++) {
        const ang = -Math.PI / 2 + (i - 1.5) * 0.55;
        ctx.globalAlpha = a * 0.8;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + Math.cos(ang) * px * 0.36, gy + Math.sin(ang) * px * 0.36);
        ctx.stroke();
      }
      break;
    }
    case 'bow': { // 后羿：箭轨细线
      const w = px * 0.09;
      pass(() => { ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0 + px * 0.10, y0 - px * 0.15); ctx.lineTo(x0 + px * 0.78, y0 - px * 0.15); ctx.stroke(); });
      break;
    }
    case 'punch': { // 太极：推掌圆波
      const w = px * 0.12;
      pass(() => { ctx.lineWidth = w; ctx.beginPath(); ctx.arc(x0 + px * 0.30, y0 - px * 0.08, px * (0.22 + 0.26 * o.prog), o.prog * 3, o.prog * 3 + 1.5); ctx.stroke(); });
      break;
    }
    case 'shield': { // 玄武：盾击横线 + 盾环
      const w = px * 0.16;
      pass(() => { ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0 + px * 0.08, y0 - px * 0.20); ctx.lineTo(x0 + px * 0.62, y0 - px * 0.20); ctx.stroke(); });
      ctx.lineWidth = px * 0.07;
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x0 + px * 0.62, y0 - px * 0.20, px * 0.13, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'sweep': { // 符甲：符箓上扫曲线
      const w = px * 0.10;
      pass(() => { ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0 - px * 0.36); ctx.quadraticCurveTo(x0 + px * 0.40, y0 - px * 0.56, x0 + px * 0.72, y0 - px * 0.24); ctx.stroke(); });
      break;
    }
    case 'staff': { // 药杖/法杖：杖头光点下压
      ctx.fillStyle = o.color;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(x0 + px * 0.35, y0 - px * 0.42, px * (0.13 + 0.06 * o.prog), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = a * 0.8;
      ctx.beginPath();
      ctx.arc(x0 + px * 0.35, y0 - px * 0.42, px * 0.06, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

/** 施法聚能球：外圈呼吸辉光 + 白热核心（加色混合，随 cr 由小变大） */
function drawCastOrb(
  ctx: CanvasRenderingContext2D,
  orb: NonNullable<PoseOut['orb']>,
  x: number, y: number, t: number,
) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const breath = 0.75 + 0.25 * Math.sin(t * 10);
  ctx.fillStyle = orb.color;
  ctx.globalAlpha = 0.5 * breath;
  ctx.beginPath();
  ctx.arc(x, y, orb.r * 2.0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(x, y, orb.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(x, y, orb.r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 控制状态小金星（眩晕用）：4 角星，比方块在像素尺度上更易读
function drawCcStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const rad = i % 2 === 0 ? r : r * 0.4;
    const a = -Math.PI / 2 + (i * Math.PI) / 4;
    const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function drawUnit(
  ctx: CanvasRenderingContext2D, u: Unit, skin: Skin, t: number, alpha = 0,
  craters: { x: number; y: number; r: number }[] = [],
) {
  // R3：单位位移在上一 tick(x=prevX)→当前 tick(x) 间按 alpha 线性插值，
  // 消除「跳格移动」观感（不动 sim 数学，确定性零影响）。
  const ax = alpha > 0 && u.prevX !== undefined ? u.prevX + (u.x - u.prevX) * alpha : u.x;
  const ay = alpha > 0 && u.prevY !== undefined ? u.prevY + (u.y - u.prevY) * alpha : u.y;
  // v2.9.3 坑内下沉：站进玄武大坑的单位整体陷到地面以下（中心最深 3.5px，边缘 0）
  let sink = 0;
  for (const cr of craters) {
    const d = Math.hypot(ax - cr.x, ay - cr.y) / cr.r;
    if (d < 1) sink = Math.max(sink, (1 - d) * 3.5);
  }
  const cx = ax * TILE;
  const cy = ay * TILE + sink;
  const binfo = BODY_INFO[u.bodyType];
  const px = binfo.renderPx;

  // v2.7 动作系统：姿态统一由 computePose 计算（呼吸/攻击/施法/受击/倒下），
  // 职业各有招牌动作节奏，替换旧版"人人同频呼吸 + 同幅前冲"的机械抖动。
  // 尸体（alive=false）返回 hud=false：不画状态装饰与血条，只播倒下→渐隐。
  const mo = computePose(u, t, cx, cy, px);
  const bodyY = mo.bodyY; // 身体绘制 cy（已含呼吸/步态/施法上浮）
  const facing = u.facing ?? 1;

  // v2.9 闪避残影：lastDodgeAt 距今 0.25s 内，朝身后拖 3 个半透明残像（证明真闪了）
  const dodgeAge = u.lastDodgeAt !== undefined && u.alive ? t - u.lastDodgeAt : 9;
  if (dodgeAge >= 0 && dodgeAge < 0.25) {
    const gcol = u.side === 'enemy' ? '255,96,96' : '96,170,255';
    const back = facing === 1 ? -1 : 1;
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const gg = dodgeAge / 0.25 + i * 0.07;
      if (gg > 0.92) continue;
      const gx = cx + back * px * 0.85 * gg;
      const gy = cy + px * 0.02 * Math.sin(gg * 9 + idPhase(u.id));
      ctx.fillStyle = `rgba(${gcol},${Math.max(0, 0.30 * (1 - gg))})`;
      ctx.fillRect(gx - px * 0.28, gy - px * 0.50, px * 0.56, px * 0.66);
    }
    ctx.restore();
  }

  // v2.9.2 技能释放能量上涌：施法窗口内 additive 竖光柱（特殊技规格高于重击的视觉锚点）
  const castT = u.castAnimAt !== undefined ? t - u.castAnimAt : 999;
  if (u.alive && castT >= 0 && castT < 0.28) {
    const cr = castT / 0.28;
    const rise = Math.sin(cr * Math.PI); // 上涌节奏：升起→回落
    const gcol = u.side === 'enemy' ? '255,90,90' : SUBCLASS_INFO[u.subclass].color;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // 光柱（三段 alpha 模拟渐变，避免每帧 createLinearGradient）
    const bh = px * 1.5, bw = px * 0.34;
    const gx0 = cx - bw / 2, gy0 = cy - px * 1.05;
    ctx.globalAlpha = 0.10 * rise;
    ctx.fillStyle = gcol;
    ctx.fillRect(gx0, gy0, bw, bh);
    ctx.globalAlpha = 0.30 * rise;
    ctx.fillRect(gx0, gy0 + bh * 0.5, bw, bh * 0.5);
    ctx.globalAlpha = 0.85 * rise;
    ctx.fillRect(gx0, gy0 + bh * 0.8, bw, bh * 0.2);
    // 顶部能量点
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.9 * rise;
    ctx.beginPath(); ctx.arc(cx, gy0 - px * 0.10, px * (0.10 + 0.06 * rise), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // 阵营环：半径 = 真实受击半径（视觉即判定，不做欺骗性碰撞盒，需求 §5.3）
  const rr = u.hitRadius * TILE;

  // 状态装饰（特性光环/减速/控制状态/阵营环/稳桩/滑步）：尸体不画
  if (mo.hud) {
    // 特性光环：画在阵营环之下，用低透明度避免与"选中/受击"这类强反馈抢注意力
    const aura = u.traitId ? TRAIT_AURA[u.traitId] : undefined;
    if (aura) {
      ctx.save();
      ctx.globalAlpha = 0.20 + 0.10 * Math.sin(t * 2 + idPhase(u.id));
      ctx.strokeStyle = aura;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy + px * 0.35, rr * 1.25, rr * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 减速（禁锢）：脚下冰蓝弧 + 单位偏冷。被减速是战术信息，必须能读出来
    if ((u.slowUntil ?? 0) > t) {
      ctx.save();
      ctx.globalAlpha = 0.65;
      ctx.strokeStyle = '#7ad0ff';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const a0 = t * 1.5 + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.ellipse(cx, cy + px * 0.35, rr * 1.05, rr * 0.46, 0, a0, a0 + 0.7);
        ctx.stroke();
      }
      ctx.restore();
    }

    // v2.9.3 控制状态持续光：被太极封禁等控制/减速的单位，腿部持续同色光直到控制消失
    //（ccColor 由施加控制的技能写入 sim，渲染层只读状态画光，控制一结束光自然消失）
    if (u.ccColor && ((u.slowUntil ?? 0) > t || (u.rootUntil ?? 0) > t)) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const pulse = 0.30 + 0.12 * Math.sin(t * 6 + idPhase(u.id));
      ctx.fillStyle = u.ccColor;
      ctx.globalAlpha = pulse;
      ctx.beginPath(); ctx.ellipse(cx, cy + px * 0.42, rr * 0.72, rr * 0.30, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.22;
      // 双腿竖直光晕
      ctx.fillRect(cx - px * 0.22, cy - px * 0.05, px * 0.14, px * 0.52);
      ctx.fillRect(cx + px * 0.08, cy - px * 0.05, px * 0.14, px * 0.52);
      ctx.restore();
    }

    // ── 控制状态可视化（美术 §7.5）：三类控制各有独立图标 + 颜色，闭眼也能分辨 ──
    // 眩晕=旋转金星（黄）；定身=脚下绿锁链（绿）；嘲讽=头顶红箭头 + 脉冲红环（红）。
    // 慢速（上方冰蓝弧）占蓝，四者色相完全正交，绝不在混战里撞色。
    if ((u.stunUntil ?? 0) > t) {
      ctx.save();
      const sy = cy - px * 0.54;
      ctx.fillStyle = '#ffd23f';
      for (let i = 0; i < 3; i++) {
        const a = t * 6 + (i * Math.PI * 2) / 3;
        drawCcStar(ctx, cx + Math.cos(a) * px * 0.18, sy + Math.sin(a) * px * 0.08, px * 0.06);
      }
      ctx.restore();
    }
    if ((u.rootUntil ?? 0) > t) {
      ctx.save();
      ctx.globalAlpha = 0.82;
      ctx.strokeStyle = '#6fe07a';
      ctx.lineWidth = 1.5;
      const ry = cy + px * 0.4;
      ctx.beginPath(); ctx.ellipse(cx, ry, rr * 0.9, rr * 0.4, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); // 锁链两道竖线：被钉在原地
      ctx.moveTo(cx - rr * 0.5, ry - rr * 0.32); ctx.lineTo(cx - rr * 0.5, ry + rr * 0.32);
      ctx.moveTo(cx + rr * 0.5, ry - rr * 0.32); ctx.lineTo(cx + rr * 0.5, ry + rr * 0.32);
      ctx.stroke();
      ctx.restore();
    }
    // v2.9 击倒标记：头顶橙色小星（与眩晕金星的"转"区分，击倒是"定"）
    if ((u.kdUntil ?? 0) > t) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = '#ffb84d';
      ctx.lineWidth = 1.5;
      const ky = cy - px * 0.60;
      ctx.beginPath(); ctx.arc(cx, ky, px * 0.10, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - px * 0.07, ky); ctx.lineTo(cx + px * 0.07, ky);
      ctx.moveTo(cx, ky - px * 0.07); ctx.lineTo(cx, ky + px * 0.07);
      ctx.stroke();
      ctx.restore();
    }
    if ((u.tauntUntil ?? 0) > t) {
      ctx.save();
      const pulse = 0.5 + 0.5 * Math.sin(t * 8);
      ctx.globalAlpha = 0.35 + 0.4 * pulse;
      ctx.strokeStyle = '#ff5a5a';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(cx, cy + px * 0.35, rr * 1.15, rr * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
      // 头顶向下红箭头：被逼着把火力引向「我」
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ff5a5a';
      const ay = cy - px * 0.64;
      ctx.beginPath();
      ctx.moveTo(cx, ay + px * 0.12);
      ctx.lineTo(cx - px * 0.1, ay - px * 0.04);
      ctx.lineTo(cx + px * 0.1, ay - px * 0.04);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // v2.9.1 重击蓄力预警：下次普攻将是重击 → 脚下金色脉冲圈（提前告知"要出重击了"）
    if (u.heavyReady) {
      ctx.save();
      const pulse = 0.6 + 0.4 * Math.sin(t * 14);
      ctx.globalAlpha = 0.45 * pulse;
      ctx.strokeStyle = '#ffd24d';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(cx, cy + px * 0.35, rr * (1.0 + 0.12 * pulse), rr * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // 阵营环：半径 = 真实受击半径（视觉即判定，不做欺骗性碰撞盒，需求 §5.3）
    // 建筑不吃这圈：drawBuilding 自带敌意红地基环，叠加会糊成一团
    if (!u.isBuilding) {
      const ally = u.side === 'ally';
      ctx.save();
      ctx.strokeStyle = skin.colorblind ? (ally ? CB_ALLY : CB_ENEMY) : ally ? '#4aa3ff' : '#ff4a4a';
      ctx.lineWidth = binfo.outline;
      // v2.9.8 色盲双通道①：敌方脚环改虚线。线型是与色觉完全无关的通道，
      // 就算把画面转成灰度，实线圈/虚线圈依然一眼可分。
      if (skin.colorblind) {
        ctx.setLineDash(ally ? [] : [3, 3]);
        ctx.lineWidth = binfo.outline + 0.5; // 虚线在 24px 网格上偏细，补一点线宽
      }
      ctx.beginPath();
      ctx.ellipse(cx, cy + px * 0.35, rr, rr * 0.44, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 稳桩（魁梧）：受重击后的减伤窗口，脚下方框提示
    // 不给提示的话玩家只会以为「这次没掉多少血」，体型特性就白做了
    if (u.braceUntil && u.braceUntil > t) {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.2 * Math.sin(t * 12);
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 1;
      ctx.strokeRect(cx - rr, cy + px * 0.2, rr * 2, rr * 0.7);
      ctx.restore();
    }
    // 滑步（轻捷）：闪避后的加速窗口，身后速度线
    if (u.glideUntil && u.glideUntil > t) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#c9ffff'; ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        const oy = cy - px * 0.2 + i * 4;
        ctx.beginPath(); ctx.moveTo(cx - rr * 1.6, oy); ctx.lineTo(cx - rr * 0.8, oy); ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── 主体绘制（建筑 / 坐骑+骑手 / 普通单位）──
  if (u.isBuilding && u.buildingKind) {
    // 建筑不吃朝向镜像、不吃敌方红染、不吃动作系统：自有配色 + 红地基环。
    // hpFrac 驱动结构受损、spawnTimer 驱动产兵预警脉冲。
    drawBuilding(ctx, u.buildingKind, cx, cy, px, {
      t,
      hpFrac: u.maxHp ? Math.max(0, u.hp / u.maxHp) : 1,
      ready: (u.spawnTimer ?? 99) < 1.5,
    });
  } else {
    // 镜像包裹：朝左时整组水平翻转（骑手与坐骑一起翻，朝向天然一致）
    // v2.9.3 转身平滑：facing 翻转瞬间 scaleX 从 0→1 渐变（100ms），消除"转身弹一下"
    ctx.save();
    if (facing === -1) {
      const prevF = flipFacing.get(u.id);
      if (prevF !== facing) { flipFacing.set(u.id, facing); flipAt.set(u.id, t); }
      const flipAge = t - (flipAt.get(u.id) ?? -1);
      const flipScale = flipAge >= 0 && flipAge < 0.1 ? Math.sin((flipAge / 0.1) * (Math.PI / 2)) : 1;
      ctx.translate(cx * 2, 0);
      ctx.scale(-1, flipScale);
    }
    ctx.globalAlpha = mo.alpha; // 尸体渐隐

    if (u.mount) {
      const lift = MOUNT_RIDER_LIFT[u.mount] * px; // 骑手相对坐骑背脊上抬量
      drawMount(ctx, u.mount, cx, bodyY, px, {
        t, moving: (u.moveAnimUntil ?? 0) > t, ready: (u.mountCd ?? 1) <= 0,
        rarity: u.mountRarity, // v2.9.3 坐骑品质：脚下光环 + 鞍鞯点缀
        casting: (u.castAnimAt ?? -1) > t - 0.35, // v2.9.10 施法蓄势：躯干后仰（只作用于坐骑本体）
      });
      drawSprite(ctx, u.subclass, cx, bodyY - lift, px, u.side === 'enemy', {
        bodyType: u.bodyType,
        gender: u.gender,
        summonKind: u.summonKind,
        monsterKind: u.monsterKind, // v2.5：西方怪物皮（独立于职业模板，走 MONSTER_TEMPLATES）
        star: u.star,
        dupIndex: u.dupIndex,
        outlineUnits: skin.outlineUnits,
        t,
        boss: !!u.isBoss, // v2.3：触发 sprites.ts 的 Boss 强化渲染路径（暗红外描边 + 双层辉光 + 更强落地影）
        pose: mo.pose, // v2.7：动作变换（骑手全身；坐骑保持自身步态）
      });
    } else {
      drawSprite(ctx, u.subclass, cx, bodyY, px, u.side === 'enemy', {
        bodyType: u.bodyType,
        gender: u.gender,
        summonKind: u.summonKind,
        monsterKind: u.monsterKind,
        star: u.star,
        dupIndex: u.dupIndex,
        outlineUnits: skin.outlineUnits,
        t,
        boss: !!u.isBoss,
        pose: mo.pose,
      });
    }

    // v2.7 武器轨迹 + 施法聚能球（镜像包裹内：局部 x 正=朝前，镜像自动处理朝向）
    // v2.9 重击轨迹：整体放大 1.35×（线宽/弧长成比例变粗变长，更有"重"的压迫感）
    if (mo.overlay) drawAtkOverlay(ctx, mo.overlay, cx, bodyY, px * (mo.overlay.heavy ? 1.35 : 1));
    if (mo.orb) drawCastOrb(ctx, mo.orb, cx + px * 0.42, bodyY - px * 0.18, t);

    // v2.9 重击命中冲击环（纯渲染，无 sim 事件）：挤压峰值从单位中心爆出
    if (mo.hitFx) {
      const hp = mo.hitFx.prog;
      const hr = px * (0.35 + 0.55 * hp);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = mo.hitFx.color;
      ctx.globalAlpha = (1 - hp) * 0.8;
      ctx.lineWidth = 2.5 * (1 - hp * 0.6);
      ctx.beginPath(); ctx.arc(cx, bodyY - px * 0.08, hr, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = (1 - hp) * 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, bodyY - px * 0.08, hr * 0.6, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // 尸体：不画 HUD（血条/护盾/叠层/倒计时），保持倒下姿态直到被引擎清理
  if (!mo.hud) return;

  // 骑手实际中心（供受击闪光 / 护盾 / 血条垂直锚定）：坐骑抬高、施法上浮都吃进来
  const riderCenterY = u.isBuilding
    ? cy
    : bodyY - (u.mount ? MOUNT_RIDER_LIFT[u.mount] * px : 0);
  // 血条锚点：坐骑抬高时血条也要跟着上移；普通单位锁回原 cy，保持与旧版一致
  const hudY = cy - (u.mount ? MOUNT_RIDER_LIFT[u.mount] * px : 0);

  if (u.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${u.flash * 4})`;
    ctx.fillRect(cx - px / 2, riderCenterY - px / 2, px, px);
  }

  if (u.shield > 0) {
    // 护盾：外圈实线 + 内圈呼吸辉光。原本是一条 1px 灰紫细线，
    // 在 24px 网格上几乎看不见，玩家根本不知道自己有盾
    ctx.save();
    ctx.strokeStyle = '#b06bff';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(cx, riderCenterY, px * 0.6, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.18 + 0.10 * Math.sin(t * 4);
    ctx.fillStyle = '#b06bff';
    ctx.beginPath(); ctx.arc(cx, riderCenterY, px * 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ── HUD 层级（美术 §7.4.4）──
  // 召唤物用更窄更矮的条：它们是消耗品，HUD 权重必须低于主力，
  // 否则 2 个召唤物就能把队伍血条淹没在屏幕噪声里。
  const isSum = !!u.isSummon;
  const bw = isSum ? px * 0.6 : px * 0.9;
  const bh = isSum ? 2 : 3;
  const bx = cx - bw / 2;
  const by = hudY - px / 2 - (isSum ? 4 : 5);
  ctx.fillStyle = '#000';
  ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
  // v2.9.8 色盲双通道②：血条颜色换成蓝/橙安全对。默认的绿/红正是红绿色盲最难分的一组，
  // 而血条是玩家读战况的第一入口——这里分不清，整场战斗就等于在看抽象画。
  ctx.fillStyle = isSum
    ? '#7f9fbf'
    : skin.colorblind
      ? (u.side === 'ally' ? CB_ALLY : CB_ENEMY)
      : u.side === 'ally' ? '#4ad27a' : '#ff4a4a';
  ctx.fillRect(bx, by, bw * Math.max(0, u.hp / u.maxHp), bh);

  // v2.9.8 色盲双通道③：血条上方的阵营三角标 —— 这是**主**通道。
  // ▲（尖朝上，实心）= 我方；▼（尖朝下，空心带描边）= 敌方。
  // 形状 + 填充方式两条线索都与颜色无关，灰度打印都能分辨。
  if (skin.colorblind && !u.isBuilding) {
    const ally = u.side === 'ally';
    const mw = isSum ? 3 : 4;            // 半宽
    const mh = isSum ? 3.5 : 4.5;        // 高
    const myBase = by - (u.shield > 0 ? 5 : 2);
    ctx.save();
    ctx.beginPath();
    if (ally) {
      ctx.moveTo(cx, myBase - mh); ctx.lineTo(cx - mw, myBase); ctx.lineTo(cx + mw, myBase);
    } else {
      ctx.moveTo(cx, myBase); ctx.lineTo(cx - mw, myBase - mh); ctx.lineTo(cx + mw, myBase - mh);
    }
    ctx.closePath();
    if (ally) {
      ctx.fillStyle = CB_ALLY;
      ctx.fill();
      ctx.strokeStyle = '#0a0a12'; ctx.lineWidth = 1; ctx.stroke();
    } else {
      ctx.fillStyle = '#0a0a12';
      ctx.fill();
      ctx.strokeStyle = CB_ENEMY; ctx.lineWidth = 1.2; ctx.stroke();
    }
    ctx.restore();
  }
  if (u.shield > 0) {
    ctx.fillStyle = '#b06bff';
    const sw = Math.min(bw, bw * (u.shield / u.maxHp));
    ctx.fillRect(bx, by - 3, sw, 2);
  }

  // ── v1.6 特性叠层指示（美术升级 A.8）──
  // 势能/速射/坚壁的层数是玩家唯一能"操作"的战斗变量（换不换目标、要不要被摸到），
  // 藏在代码里等于没有。用血条下方的小方点表示，满层变亮 + 描边
  const stackTrait = u.traitId === 'momentum' || u.traitId === 'volley' || u.traitId === 'bulwark';
  const stacks = u.traitStacks ?? 0;
  if (stackTrait && stacks > 0 && !isSum) {
    const max = u.traitId === 'momentum' ? 8 : u.traitId === 'volley' ? 5 : 5;
    const col = TRAIT_AURA[u.traitId!] ?? '#ffd23f';
    const pw = 2, pg = 1;
    const shown = Math.min(stacks, max);
    const totalW = max * pw + (max - 1) * pg;
    let sx = cx - totalW / 2;
    const sy = by + bh + 2;
    for (let i = 0; i < max; i++) {
      ctx.fillStyle = i < shown ? col : 'rgba(255,255,255,0.14)';
      ctx.fillRect(sx, sy, pw, pw);
      sx += pw + pg;
    }
    if (shown >= max) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5 + 0.4 * Math.sin(t * 8);
      ctx.strokeRect(cx - totalW / 2 - 1, sy - 1, totalW + 2, pw + 2);
      ctx.globalAlpha = 1;
    }
  }

  // 召唤物存续倒计时：玩家要能预判「还能挡几秒」，
  // 否则召唤物消失永远是「凭空背刺」
  if (isSum && u.summonUntil && u.summonTotal) {
    const left = Math.max(0, Math.min(1, (u.summonUntil - t) / u.summonTotal));
    ctx.fillStyle = '#000';
    ctx.fillRect(bx - 1, by + bh + 1, bw + 2, 3);
    ctx.fillStyle = left < 0.25 ? '#ff8c42' : '#9b7bff'; // 最后 25% 转橙 = 撤退预警
    ctx.fillRect(bx, by + bh + 2, bw * left, 1);
  }
}

// ── 技能特效 ─────────────────────────────────────────────────
// v1.4 核心改动：特效尺寸一律由 e.r（= castRange，世界格）驱动，禁止硬编码 px。
// 策划把 castRange 从 3 改成 5，屏幕上的圈就必须跟着变大——这条纪律消灭的是
// 「数值改了美术没跟」这类最难查、玩家却最先感觉到的不一致。
function drawEffect(ctx: CanvasRenderingContext2D, e: Effect, renderAlpha = 0) {
  // delay 未走完的特效在 sim 里 ttl 不推进，渲染也必须完全跳过，
  // 否则 long 档「预警→兑现」的第二段会提前显形，预警就失去意义
  if (e.delay && e.delay > 0) return;

  // R4：用连续渲染时间推算本帧特效剩余寿命，扩张进度随 RAF 帧率平滑，
  // 不再每 20Hz tick 跳一档（fast nova/ring 尤其明显）。
  const effTtl = Math.max(0, e.ttl - renderAlpha * TICK);
  const p = 1 - effTtl / e.maxTtl;
  // v2.9.12 亮度调校：VFX_BRIGHTNESS 为全局技能特效亮度系数（纯渲染，不影响数值/确定性）。
  // 用户反馈「技能太亮」——v2.8 把 ALPHA_CAP 0.7→0.9、v2.9.2 又加了白热中心爆点，叠加导致过曝。
  const VFX_BRIGHTNESS = 0.62;
  // alphaFrom/alphaTo 显式指定时按进度插值，否则沿用 v1.3 的淡出。乘 VFX_BRIGHTNESS 全局降亮。
  const alpha = (e.alphaFrom !== undefined
    ? e.alphaFrom + ((e.alphaTo ?? 0) - e.alphaFrom) * p
    : Math.max(0, Math.min(1, e.ttl * 2.2))) * VFX_BRIGHTNESS;
  const cx = e.x * TILE, cy = e.y * TILE;

  // v1.5 技能签名全局放大：半径再 × VFX_SCALE × 签名 sizeMul（美术 §7.3⑤）。
  // 起手距离环（dashed）是射程指示器，必须保持真实 castRange，故不参与放大。
  const scale = VFX_SCALE * (e.sizeMul ?? 1);

  // 距离档位 → 动画语言（美术 §7.3.1 ③）
  // self 原地重击不扩张、long 扩张快而锐利：让玩家从动画本身读出「这一下打了多远」
  const tier = e.tier ?? 'mid';
  const grow = tier === 'self' ? 0.15 : tier === 'short' ? 1.1 : tier === 'long' ? 1.9 : 1.4;
  const lw = tier === 'long' ? 2.5 : tier === 'short' ? 4 : 3;

  // 起手距离环（dashed）是辅助信息，保持 0.35 不抢戏；技能爆发上限随 VFX_BRIGHTNESS 降亮。
  const ALPHA_CAP = e.dashed ? 0.35 : 0.9 * VFX_BRIGHTNESS;

  // v2.9.2 技能爆发中心爆点：特效刚出现（p<0.18）时白热核心 + 放射线。
  // 比重击命中冲击环更大更亮——"特殊技规格明显高于重击"的视觉锚点。
  if (p < 0.18 && !e.dashed) {
    const k = 1 - p / 0.18;
    const cr = TILE * (0.6 + 1.1 * p) * scale;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.9 * k * VFX_BRIGHTNESS;
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(2, cr * 0.16), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.55 * k * VFX_BRIGHTNESS;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + p * 3;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * cr * 0.55, cy + Math.sin(a) * cr * 0.55);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(ALPHA_CAP, alpha));
  ctx.strokeStyle = e.color;
  ctx.fillStyle = e.color;

  switch (e.shape) {
    case 'ring': {
      if (e.dashed) {
        // ①起手距离环：半径恒定 = 真实 castRange，绝不随进度扩张。
        // 会扩张的圈表达的是「冲击波」，表达不了「我能打到这里」。
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, e.r * TILE, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      } else {
        const r = (e.r + p * grow) * TILE * scale;
        ctx.globalCompositeOperation = 'lighter';
        // 外发光
        ctx.lineWidth = lw * 3.2;
        ctx.globalAlpha = Math.min(ALPHA_CAP, alpha) * 0.22;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        // 主圈
        ctx.globalAlpha = Math.min(ALPHA_CAP, alpha);
        ctx.lineWidth = lw;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        // 白热内核
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = alpha * 0.5;
        ctx.lineWidth = lw * 0.45;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = e.color;
      }
      break;
    }
    case 'shock': {
      const r = (e.r + p * grow * 1.4) * TILE * scale;
      ctx.globalCompositeOperation = 'lighter';
      // 外发光
      ctx.lineWidth = (lw + 2) * 2.4;
      ctx.globalAlpha = Math.min(ALPHA_CAP, alpha) * 0.25;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      // 主冲击圈
      ctx.globalAlpha = Math.min(ALPHA_CAP, alpha);
      ctx.lineWidth = lw + 2;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      // 白热内核
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = alpha * 0.45;
      ctx.lineWidth = (lw + 2) * 0.4;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = e.color;
      break;
    }
    case 'bubble': {
      const r = e.r * TILE * scale * (1 + p * 0.08); // self 档的呼吸感，不做扩张
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * 0.5;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = Math.min(ALPHA_CAP, alpha);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      // v2.9.3 符甲护盾主体特效：shield_pulse 时 8 个金色符块环绕旋转 + 成型闪光
      if (e.motion === 'shield_pulse') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const rr2 = r * (0.92 + 0.12 * Math.sin(p * 9));
        ctx.fillStyle = '#ffd24d';
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + p * 3;
          ctx.globalAlpha = 0.5;
          ctx.fillRect(cx + Math.cos(a) * rr2 - 1.5, cy + Math.sin(a) * rr2 - 1.5, 3, 3);
        }
        if (p < 0.2) { // 护盾成型瞬间白热闪光
          const gk = 1 - p / 0.2;
          ctx.strokeStyle = '#ffffff';
          ctx.globalAlpha = 0.85 * gk;
          ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(cx, cy, r * 1.06, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
      }
      break;
    }
    case 'quake': {
      // v2.9.3 镇岳怒吼 / 泰山压顶：地面地震裂痕 + 压扁冲击波（"镇"与"踏"）
      const r = e.r * TILE * scale;
      const spread = Math.min(1, p * 2.5);  // 前 40% 裂开
      const fade = 1 - Math.max(0, (p - 0.6) / 0.4);
      const gy = cy + TILE * 0.3;           // 地面线
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // 压扁冲击波（地面视角椭圆）
      ctx.strokeStyle = e.color;
      ctx.globalAlpha = 0.6 * fade;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(cx, gy, r * spread, r * 0.32 * spread, 0, 0, Math.PI * 2); ctx.stroke();
      // 地面放射裂痕（8 条折线，长短不一模拟地震裂纹）
      ctx.globalAlpha = 0.5 * fade;
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.35;
        const len = r * spread * (0.45 + 0.55 * (((i * 37) % 10) / 10));
        const jag = 2.5;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r * 0.14, gy + Math.sin(a) * r * 0.05);
        ctx.lineTo(
          cx + Math.cos(a) * len * 0.6 + Math.cos(a + 1.2) * jag,
          gy + Math.sin(a) * len * 0.22 + Math.sin(a + 1.2) * jag,
        );
        ctx.lineTo(cx + Math.cos(a) * len, gy + Math.sin(a) * len * 0.38);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'nova': {
      const r = (e.r + p * grow) * TILE * scale;
      const rot = e.motion === 'nova_spin' ? p * Math.PI * 2 : 0;
      const spikes = 9;
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < spikes; i++) {
        const a = (i / spikes) * Math.PI * 2 + rot;
        // 外发光
        ctx.strokeStyle = e.color;
        ctx.globalAlpha = Math.min(ALPHA_CAP, alpha) * 0.3;
        ctx.lineWidth = lw * 2.2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
        // 主刺
        ctx.globalAlpha = Math.min(ALPHA_CAP, alpha);
        ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
        // 白热尖端
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = alpha * 0.55;
        ctx.lineWidth = lw * 0.4;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
      }
      // v2.9.3 无形剑罡主体特效：nova_spin 追加锋锐剑气（刺外圈细长亮线穿出，剑罡外溢）
      if (e.motion === 'nova_spin') {
        ctx.save();
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = 0.5 * (1 - p);
        ctx.lineWidth = 1;
        for (let i = 0; i < spikes; i++) {
          const a = (i / spikes) * Math.PI * 2 + rot;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85);
          ctx.lineTo(cx + Math.cos(a) * r * 1.3, cy + Math.sin(a) * r * 1.3);
          ctx.stroke();
        }
        ctx.restore();
      }
      break;
    }
    case 'beam':
    case 'trail': {
      const tx = (e.tx ?? e.x) * TILE, ty = (e.ty ?? e.y) * TILE;
      ctx.globalCompositeOperation = 'lighter';
      const w = e.thickness ?? (e.shape === 'beam' ? 3 : 6);
      // 外发光
      ctx.lineWidth = w * 1.8;
      ctx.globalAlpha = Math.min(ALPHA_CAP, alpha) * 0.3;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
      // 主光束
      ctx.globalAlpha = Math.min(ALPHA_CAP, alpha);
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
      // 白热芯
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = alpha * 0.6;
      ctx.lineWidth = Math.max(1, w * 0.4);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.strokeStyle = e.color;
      // ③long 档命中端补十字准星：远程命中需要一个「落点」
      if (tier === 'long' && e.shape === 'beam') {
        const k = 5;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = Math.min(ALPHA_CAP, alpha);
        ctx.beginPath();
        ctx.moveTo(tx - k, ty); ctx.lineTo(tx + k, ty);
        ctx.moveTo(tx, ty - k); ctx.lineTo(tx, ty + k);
        ctx.stroke();
      }
      // v2.9.3 弹道落点小爆：mid 档（连射/弹幕）命中端白热爆点——每一发落地都有"砸中"感
      if (tier !== 'long' && e.shape === 'beam') {
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = Math.min(1, alpha * 1.2);
        ctx.beginPath(); ctx.arc(tx, ty, 2 + p * 2.5, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'cage': {
      const r = e.r * TILE * scale;
      ctx.lineWidth = 2;
      if (e.motion === 'taiji_spin') {
        // v2.5 中国风：太极封禁 = 旋转的八卦环 + 中央太极阴阳（控制师「太极封禁」专属）
        const rot = p * Math.PI * 2;
        ctx.save();
        ctx.translate(cx, cy); ctx.rotate(rot);
        ctx.globalAlpha = ALPHA_CAP * (0.45 + 0.55 * (1 - p));
        // v2.9.3 太极图打出瞬间自身闪亮：前 25% 寿命叠白热双圈（"太极图亮了一下"）
        if (p < 0.25) {
          const gk = 1 - p / 0.25;
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = '#ffffff';
          ctx.globalAlpha = 0.75 * gk;
          ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 0.45 * gk;
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2); ctx.stroke();
        }
        // 八卦环：8 段径向短划，代表八卦方位
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const r1 = r * 0.60, r2 = r * 0.88;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
          ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
          ctx.stroke();
        }
        // 中央太极阴阳鱼
        const tr = r * 0.50;
        ctx.fillStyle = e.color;
        ctx.beginPath(); ctx.arc(0, 0, tr, -Math.PI / 2, Math.PI / 2); ctx.fill();
        ctx.fillStyle = '#0a0a12';
        ctx.beginPath(); ctx.arc(0, 0, tr, Math.PI / 2, -Math.PI / 2); ctx.fill();
        // 阴阳眼（小圆点）
        ctx.fillStyle = e.color;
        ctx.beginPath(); ctx.arc(0, -tr / 2, tr / 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#0a0a12';
        ctx.beginPath(); ctx.arc(0, tr / 2, tr / 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else {
        // v1.5 签名运动：zone_control 的牢笼随寿命旋转，与 nova 旋转呼应（美术 §7.3⑤）
        const rot = e.motion === 'cage_spin' ? p * Math.PI * 0.5 : 0;
        ctx.save();
        ctx.translate(cx, cy); ctx.rotate(rot); ctx.translate(-cx, -cy);
        ctx.strokeRect(cx - r, cy - r, r * 2, r * 2);
        ctx.beginPath();
        ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
        ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
        ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case 'blade': {
      // v2.9.3 青龙偃月斩：突刺落点拔地而起的红色通天刀虚影（招牌主体特效）
      const bh = e.r * TILE * scale;        // 刀高（格 × TILE × scale）
      const bw = bh * 0.14;                 // 刀宽
      const rise = Math.min(1, p * 3);      // 前 1/3 从地面拔起
      const riseH = bh * rise;
      const fade = 1 - Math.max(0, (p - 0.6) / 0.4); // 后 40% 淡出
      const groundY = cy + TILE * 0.45;       // 刀从脚下地面拔起
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // 外发光（宽刃光晕）
      ctx.fillStyle = e.color;
      ctx.globalAlpha = 0.28 * fade;
      ctx.fillRect(cx - bw * 1.6, groundY - riseH, bw * 3.2, riseH);
      // 主刀身（细长红刃）
      ctx.globalAlpha = 0.72 * fade;
      ctx.fillRect(cx - bw * 0.5, groundY - riseH, bw, riseH);
      // 刀尖（白热三角，自刀顶向下渐窄）
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.85 * fade;
      ctx.beginPath();
      ctx.moveTo(cx, groundY - riseH - bw * 1.3);
      ctx.lineTo(cx - bw * 0.85, groundY - riseH + bw * 0.55);
      ctx.lineTo(cx + bw * 0.85, groundY - riseH + bw * 0.55);
      ctx.closePath(); ctx.fill();
      // 刀身中线亮脊
      ctx.globalAlpha = 0.5 * fade;
      ctx.fillRect(cx - bw * 0.1, groundY - riseH, bw * 0.2, riseH);
      // 拔起时的地面闪光
      ctx.globalAlpha = 0.5 * fade * (1 - rise) * 0.5;
      ctx.fillStyle = e.color;
      ctx.beginPath(); ctx.ellipse(cx, groundY, bw * 2.2, bw * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      break;
    }
    case 'sun': {
      // v2.9.3 后羿射日：命中点太阳爆闪（金色光芒四射 + 白热核心）
      const r = e.r * TILE * scale;
      const burst = Math.min(1, p * 4);     // 前 1/4 爆开
      const fade = 1 - Math.max(0, (p - 0.55) / 0.45);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // 光芒放射 12 条
      ctx.strokeStyle = e.color;
      ctx.globalAlpha = 0.7 * fade;
      ctx.lineWidth = 2;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + p * 1.2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r * 0.2 * burst, cy + Math.sin(a) * r * 0.2 * burst);
        ctx.lineTo(cx + Math.cos(a) * r * 1.1 * burst, cy + Math.sin(a) * r * 1.1 * burst);
        ctx.stroke();
      }
      // 白热核心
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.95 * fade;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.22 * burst, 0, Math.PI * 2); ctx.fill();
      // 主光晕两圈
      ctx.strokeStyle = e.color;
      ctx.globalAlpha = 0.5 * fade;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.5 * burst, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.25 * fade;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.8 * burst, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      break;
    }
    case 'rift': {
      // 召唤裂隙：宽高比由 SummonTemplate 的 riftW/riftH 决定，
      // 三类召唤物开出的口子形状不同（石魂卫宽、影刃仆窄、咒火灵中）
      const rx = e.r * TILE * scale * 0.4, ry = e.r * TILE * scale;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx * (0.3 + p * 0.7), ry, 0, 0, Math.PI * 2); ctx.stroke();
      // v2.9.3 裂隙撕开瞬间：金色裂口闪光（大地裂缝的"裂开"感）
      if (p < 0.3) {
        const gk = 1 - p / 0.3;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = '#ffd24d';
        ctx.globalAlpha = 0.6 * gk;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx * (0.3 + p * 0.7) * 1.06, ry * 1.06, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case 'light': {
      const r = e.r * TILE * scale;
      if (e.motion === 'blessing_vine') {
        // v2.5 中国风：青囊回春 = 从底部上攀的树藤 + 叶点（牧师「青囊回春」专属，呼应青囊绿光晕）
        ctx.save();
        ctx.globalAlpha = ALPHA_CAP * (0.4 + 0.6 * (1 - p));
        ctx.strokeStyle = e.color;
        ctx.fillStyle = e.color;
        ctx.lineWidth = 2;
        const vines = 5;
        for (let i = 0; i < vines; i++) {
          const vx = cx + (i - (vines - 1) / 2) * r * 0.30;
          const sway = Math.sin(i * 2.1 + p * 6) * r * 0.12;
          const baseY = cy + r * 0.92;
          const topY = cy + r * (0.92 - p * 1.7); // 随时间向上攀
          ctx.beginPath();
          ctx.moveTo(vx, baseY);
          ctx.quadraticCurveTo(vx + sway, (baseY + topY) / 2, vx, topY);
          ctx.stroke();
          ctx.beginPath(); ctx.arc(vx, topY, 2.4, 0, Math.PI * 2); ctx.fill(); // 藤尖嫩叶
        }
        ctx.restore();
        // v2.9.3 青囊回春主体特效：中央绿色光柱上涌 + 生命叶点飘散（生机感）
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const hgt = r * (0.5 + 0.7 * p);
        ctx.fillStyle = e.color;
        ctx.globalAlpha = 0.16 * (1 - p);
        ctx.fillRect(cx - r * 0.08, cy - hgt, r * 0.16, hgt);
        for (let i = 0; i < 4; i++) {
          const fy = cy - hgt * (0.25 + 0.75 * ((i * 0.37 + p) % 1));
          ctx.fillStyle = i % 2 ? '#ffffff' : e.color;
          ctx.globalAlpha = 0.45 * (1 - p);
          ctx.beginPath();
          ctx.arc(cx + Math.sin(i * 2.4 + p * 7) * r * 0.22, fy, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      } else {
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2 + p * 1.5;
          const rr = r * (0.35 + 0.65 * p);
          ctx.fillRect(cx + Math.cos(a) * rr - 1.5, cy + Math.sin(a) * rr - 1.5, 3, 3);
        }
      }
      break;
    }
  }
  ctx.restore();
}
