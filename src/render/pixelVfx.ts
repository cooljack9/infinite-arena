// 战斗特效 / 挥击 / 地形 像素渲染器（v2.5.1）
//
// 定位：把 drawEffect、drawAtkOverlay、drawProp 从「平滑矢量图元」换成「像素精灵」，
// 复用 sprites.ts 已验证的同一套纪律：离屏 1:1 光栅化 → 缓存 → nearest 整数块缩放。
//
// ⚠️ 双分辨率（v2.5.1 关键修正，不要统一）：
//   · 技能特效 VFX_TPL = 32×32：大招直径可达 100~345px，16×16 下 block=round(d/16)
//     高达 9~22，单像素被放大成巨块 → 「扩散范围偏模糊」。32×32 让 block 减半。
//   · 挥击 / 地形 SMALL_TPL = 16×16：渲染尺寸仅 ~24~48px，若用 32×32 则 block 塌到 1，
//     内容反而缩水变糊。故保持 16。
//
// 三件事保证「像素纯度」：
//  1. 整数块缩放：目标尺寸吸附到 blockPx × S，像素块永远等宽正方
//     （非整数倍拉伸会让像素忽宽忽窄 —— sprites.ts 注释里点名的「脏」的来源）。
//  2. 坐标吸附：绘制中心 Math.round 到整数像素，杜绝亚像素抖动。
//  3. 禁用 shadowBlur / 大面积 lighter 渐变：发光改为「像素级 bloom」
//     （亮索引向四邻溢出一圈半透明亮色），与 sprites.ts 一致。
//
// 动画不手绘多帧 —— 由进度 p 程序合成（完全确定性，零 Math.random）：
//   · 整数块缩放承担「扩散感」（blockPx 随进度递增）
//   · 4×4 Bayer 有序抖动溶解承担「消散感」（像素美术经典技法）
//   · 色阶迁移承担「能量衰减」（白热→亮→中）
//
// ⚠️ 确定性纪律：本文件不得出现 Math.random。抖动阈值表是静态常量，
//    所有随机感来自模板生成期的种子 LCG（已固化在 pixelVfxTemplates.ts 里）。

import { VFX_TPL, SWING_TPL, PROP_TPL, VFX_TPL_W, SMALL_TPL_W } from './pixelVfxTemplates';
import type { Effect } from '@arena/core/types';

const PAD = 2;                 // 留边给像素级 bloom 溢出
const csOf = (S: number) => S + PAD * 2;
const STAGES = 4;              // 动画档位（0..3）
const ROT_STEPS = 8;           // 旋转量化档（仅旋转型特效用）

// 4×4 Bayer 有序抖动矩阵（0..15）→ 归一化阈值
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
// 各档位被剔除的像素比例（溶解强度）
const DISSOLVE = [0, 0, 0.18, 0.42];

// ══ 色阶 ══
const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
function shade(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return 'rgb(255,255,255)';
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt > 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
  return `rgb(${clamp255(r)},${clamp255(g)},${clamp255(b)})`;
}

const rampCache = new Map<string, string[]>();
/** 基色 → 四阶色阶 [1暗, 2中, 3亮, 4白热]。职业色识别度保留在中间调上。 */
function rampFor(color: string): string[] {
  const hit = rampCache.get(color);
  if (hit) return hit;
  const r = [shade(color, -0.5), shade(color, -0.15), shade(color, 0.18), shade(color, 0.68)];
  rampCache.set(color, r);
  return r;
}

// ══ 光栅化缓存 ══
// key = 造型名|中间调色|档位|旋转档|分辨率。每个组合只画一次，之后每帧仅一次 drawImage。
const spriteCache = new Map<string, HTMLCanvasElement>();

function rasterize(tpl: string[], ramp: string[], stage: number, rotStep: number, S: number): HTMLCanvasElement {
  const CS = csOf(S);
  const c = document.createElement('canvas');
  c.width = CS; c.height = CS;
  const g = c.getContext('2d')!;
  const rot = (rotStep / ROT_STEPS) * Math.PI * 2;
  if (rot !== 0) { g.translate(CS / 2, CS / 2); g.rotate(rot); g.translate(-CS / 2, -CS / 2); }

  // 色阶迁移：能量衰减（后期白热退为亮、亮退为中）
  const demote = (ch: string) => {
    if (stage < 2) return ch;
    if (ch === '4') return '3';
    if (ch === '3' && stage >= 3) return '2';
    return ch;
  };
  // ① 像素级 bloom：亮索引向四邻溢出一圈半透明亮色（不用 shadowBlur）
  g.globalAlpha = 0.3;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const ch = tpl[y][x];
      if (ch !== '4' && ch !== '3') continue;
      g.fillStyle = ramp[2];
      g.fillRect(x + PAD - 1, y + PAD, 1, 1);
      g.fillRect(x + PAD + 1, y + PAD, 1, 1);
      g.fillRect(x + PAD, y + PAD - 1, 1, 1);
      g.fillRect(x + PAD, y + PAD + 1, 1, 1);
    }
  }
  // ② 主体：抖动溶解剔除
  g.globalAlpha = 1;
  const thr = DISSOLVE[Math.min(STAGES - 1, stage)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const ch = demote(tpl[y][x]);
      if (ch === '.' || ch === undefined) continue;
      if (thr > 0 && BAYER4[y & 3][x & 3] / 16 < thr) continue;
      g.fillStyle = ramp[ch.charCodeAt(0) - 49] ?? ramp[1];
      g.fillRect(x + PAD, y + PAD, 1, 1);
    }
  }
  return c;
}

function getSprite(name: string, tpl: string[], ramp: string[], stage: number, rotStep: number, S: number): HTMLCanvasElement {
  const key = `${name}|${ramp[1]}|${stage}|${rotStep}|${S}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const c = rasterize(tpl, ramp, stage, rotStep, S);
  spriteCache.set(key, c);
  return c;
}

/** 整数块缩放：把目标尺寸吸附到 blockPx × S，保证像素块等宽正方。 */
const blockOf = (sizePx: number, S: number) => Math.max(1, Math.round(sizePx / S));

// ══ 对外：技能特效（32×32 母题）══
/**
 * 绘制像素技能特效。
 * @param sizePx 目标直径（世界像素）。实际绘制尺寸会吸附到整数块倍数。
 * @param p      特效进度 0..1（驱动档位：扩散 / 溶解 / 色阶衰减）
 * @param rot    旋转弧度（已由调用方算出）；非旋转特效传 0
 * @returns false 表示该 shape 无像素母题，调用方应回退矢量路径
 */
export function drawPixelEffect(
  ctx: CanvasRenderingContext2D,
  e: Effect,
  cx: number, cy: number,
  sizePx: number,
  p: number,
  alpha: number,
  rot: number,
): boolean {
  const tpl = VFX_TPL[e.shape];
  if (!tpl) return false;
  const S = VFX_TPL_W;
  const ramp = rampFor(e.color);
  const stage = Math.max(0, Math.min(STAGES - 1, Math.floor(p * STAGES)));
  // 旋转量化：仅保留 ROT_STEPS 档，避免缓存爆炸
  let rotStep = 0;
  if (rot !== 0) {
    const q = Math.round((rot / (Math.PI * 2)) * ROT_STEPS) % ROT_STEPS;
    rotStep = q < 0 ? q + ROT_STEPS : q;
  }
  const spr = getSprite(e.shape, tpl, ramp, stage, rotStep, S);
  const block = blockOf(sizePx, S);
  const dest = block * csOf(S);
  const dx = Math.round(cx - dest / 2);
  const dy = Math.round(cy - dest / 2);

  const prevSmooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.drawImage(spr, dx, dy, dest, dest);
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = prevSmooth;
  return true;
}

// ══ 对外：beam / trail 方向性特效（32×32 段）══
// 沿方向平铺段（段内沿 x 均匀 → 无缝），命中端挂端点爆点。
// 不整体拉伸单张精灵（会把像素格子拉变形），也不逐像素 fillRect（太贵）。
export function drawPixelBeam(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number,
  shape: 'beam' | 'trail',
  color: string, thicknessPx: number,
  alpha: number, p: number,
  endpointBurst: boolean,
): void {
  const tpl = VFX_TPL[shape];
  if (!tpl) return;
  const S = VFX_TPL_W;
  const ramp = rampFor(color);
  const stage = Math.max(0, Math.min(STAGES - 1, Math.floor(p * STAGES)));
  const spr = getSprite(shape, tpl, ramp, stage, 0, S);

  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1) return;
  const block = Math.max(1, Math.round(thicknessPx / S));
  const tile = block * csOf(S);

  const prevSmooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.translate(Math.round(x0), Math.round(y0));
  ctx.rotate(Math.atan2(y1 - y0, x1 - x0));
  for (let d = 0; d < len; d += tile) {
    ctx.drawImage(spr, d, -tile / 2, tile, tile);
  }
  ctx.restore();

  if (endpointBurst) {
    const bname = 'nova';
    const btpl = VFX_TPL[bname];
    const bspr = getSprite(bname, btpl, ramp, stage, 0, S);
    const bblock = Math.max(1, Math.round((thicknessPx * 2.2) / S));
    const bdest = bblock * csOf(S);
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha * 1.1));
    ctx.drawImage(bspr, Math.round(x1 - bdest / 2), Math.round(y1 - bdest / 2), bdest, bdest);
    ctx.globalAlpha = 1;
  }
  ctx.imageSmoothingEnabled = prevSmooth;
}

// ══ 对外：普攻挥击（16×16 母题）══
export function drawPixelSwing(
  ctx: CanvasRenderingContext2D,
  kind: string,
  cx: number, cy: number,
  sizePx: number,
  alpha: number,
  flip: boolean,
  rot: number,
): boolean {
  const tpl = SWING_TPL[kind];
  if (!tpl) return false;
  const S = SMALL_TPL_W;
  const ramp = rampFor('#ffd9a0');           // 挥击统一暖色（武器火花/气劲）
  const block = blockOf(sizePx, S);
  const dest = block * csOf(S);
  const prevSmooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.translate(Math.round(cx), Math.round(cy));
  if (rot) ctx.rotate(rot);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(getSprite(kind, tpl, ramp, 0, 0, S), -dest / 2, -dest / 2, dest, dest);
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = prevSmooth;
  return true;
}

// ══ 对外：地形掩体（16×16 母题）══
// 地形必须「恰好嵌进格子」：用 floor 而非 round 取块（round 会把 24px 格撑到 32px 溢出），
// 再按格子居中。母题缺失时返回 false，调用方回退矢量。
const propCache = new Map<string, { base: HTMLCanvasElement; glow: HTMLCanvasElement | null }>();

function rasterizeFiltered(tpl: string[], ramp: string[], glowOnly: boolean, S: number): HTMLCanvasElement {
  const CS = csOf(S);
  const c = document.createElement('canvas');
  c.width = CS; c.height = CS;
  const g = c.getContext('2d')!;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const ch = tpl[y][x];
      if (ch === '.' || ch === undefined) continue;
      const isGlow = ch === '4' || ch === '3';
      if (glowOnly && !isGlow) continue;
      g.fillStyle = ramp[ch.charCodeAt(0) - 49] ?? ramp[1];
      g.fillRect(x + PAD, y + PAD, 1, 1);
    }
  }
  return c;
}

/**
 * 绘制地形掩体（同一个 'P' 在各主题换剪影：沙岩方碑 / 冰霜冰棱 / 虚空浮石 …）。
 * 保留两个原设计动态：magma 熔缝呼吸、void 悬空浮动 —— 都是零额外计算的整块位移/叠绘。
 */
export function drawPixelProp(
  ctx: CanvasRenderingContext2D,
  themeId: string, x: number, y: number, tilePx: number,
  wall: string, prop: string, accent: string, t: number,
): boolean {
  const tpl = PROP_TPL[themeId];
  if (!tpl) return false;
  const S = SMALL_TPL_W;
  const key = `${prop}|${wall}|${accent}|${themeId}`;
  let ent = propCache.get(key);
  if (!ent) {
    // '1'=wall(暗) '2'=prop(基色) '3'=受光(prop 提亮) '4'=accent(高光/熔缝)
    const ramp = [wall, prop, shade(prop, 0.2), accent];
    ent = {
      base: rasterizeFiltered(tpl, ramp, false, S),
      glow: themeId === 'magma' ? rasterizeFiltered(tpl, ramp, true, S) : null,
    };
    propCache.set(key, ent);
  }
  const block = Math.max(1, Math.floor(tilePx / S));
  const dest = block * csOf(S);
  // void：悬空浮动（虚空里没有地基）—— 整块上下位移，与母题的下方虚影配合
  const float = themeId === 'void' ? Math.sin(t * 1.2 + x * 0.07) * 1.5 : 0;
  const dx = Math.round(x + (tilePx - dest) / 2);
  const dy = Math.round(y + (tilePx - dest) / 2 + float);

  const prevSmooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(ent.base, dx, dy, dest, dest);
  // magma：熔缝呼吸（唯一动态掩体，暗示脚下是活的）—— 只叠熔缝层，不整块闪
  if (ent.glow) {
    ctx.globalAlpha = 0.45 + 0.25 * Math.sin(t * 2 + x * 0.1);
    ctx.drawImage(ent.glow, dx, dy, dest, dest);
    ctx.globalAlpha = 1;
  }
  ctx.imageSmoothingEnabled = prevSmooth;
  return true;
}

/** 缓存占用（调试/预算观测用） */
export const pixelVfxCacheSize = () => spriteCache.size;
