// 生成像素 VFX / 挥击 / 地形 母题 → src/render/pixelVfxTemplates.ts
// v2.5.1：技能母题分辨率 16 → 32。
//   根因：大招直径可达 100~345px，而 16×16 母题的 block = round(diameter/16) 高达 9~22，
//   单个源像素被放大成 9~22px 的巨块 —— 这就是「扩散范围偏模糊、细节不行」。
//   尺寸不能压（半径承载 castRange 语义），故提分辨率：同样直径下 block 减半。
//   挥击 / 地形保持 16×16：它们渲染尺寸小（≈24~48px），32 会让 block 塌到 1、反而缩水变糊。
// 确定性 LCG，无 Math.random。
import { writeFileSync } from 'fs';

let N = 16, C = 7.5;          // 当前工作分辨率（切段切换）
const grid = () => Array.from({ length: N }, () => Array(N).fill('.'));
const set = (g, x, y, ch) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && x < N && y >= 0 && y < N) g[y][x] = ch; };
const dd = (x, y) => Math.hypot(x - C, y - C);
const lcg = (s) => { let v = s >>> 0; return () => (v = (v * 1664525 + 1013904223) >>> 0) / 4294967296; };

function annulus(g, r0, r1, ch, cond) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = dd(x, y); if (d < r0 || d > r1) continue;
    if (cond && !cond(x, y, d)) continue;
    set(g, x, y, ch);
  }
}
function disc(g, r, ch, cond) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = dd(x, y); if (d > r) continue;
    if (cond && !cond(x, y, d)) continue;
    set(g, x, y, ch);
  }
}
function ray(g, ang, r0, r1, ch, w) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = dd(x, y); if (d < r0 || d > r1) continue;
    const a = Math.atan2(y - C, x - C);
    const da = Math.abs(((a - ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (da * d <= w) set(g, x, y, ch);
  }
}
function bres(g, x0, y0, x1, y1, ch) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) { set(g, x0, y0, ch); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
}
function debris(g, seed, n, rMin, rMax, chs, size = 1) {
  const rnd = lcg(seed);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = rMin + rnd() * (rMax - rMin);
    const bx = Math.round(C + Math.cos(a) * r), by = Math.round(C + Math.sin(a) * r);
    const ch = chs[i % chs.length];
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) set(g, bx + dx, by + dy, ch);
  }
}
function discAt(g, cx, cy, r, ch) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (Math.hypot(x - cx, y - cy) <= r) set(g, x, y, ch);
}
function rayAt(g, cx, cy, ang, r0, r1, ch, w) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy); if (d < r0 || d > r1) continue;
    const a = Math.atan2(dy, dx);
    const da = Math.abs(((a - ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (da * d <= w) set(g, x, y, ch);
  }
}
function debrisAt(g, cx, cy, seed, n, rMin, rMax, chs, size = 1) {
  const rnd = lcg(seed);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = rMin + rnd() * (rMax - rMin);
    const bx = Math.round(cx + Math.cos(a) * r), by = Math.round(cy + Math.sin(a) * r);
    const ch = chs[i % chs.length];
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) set(g, bx + dx, by + dy, ch);
  }
}
// 抖动柔化外缘：扩散边缘做颗粒衰减，而不是一圈硬邦邦的粗块（「糊」的另一半来源）
function ditherEdge(g, seed, ch) {
  const rnd = lcg(seed);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (g[y][x] !== '.') continue;
    const nb = (g[y - 1]?.[x] ?? '.') !== '.' || (g[y + 1]?.[x] ?? '.') !== '.' ||
      (g[y]?.[x - 1] ?? '.') !== '.' || (g[y]?.[x + 1] ?? '.') !== '.';
    if (nb && rnd() < 0.28) set(g, x, y, ch);
  }
}

// ══════════ 技能母题（32×32：分辨率翻倍，block 减半）══════════
N = 32; C = 15.5;
const S = {};

S.ring = (() => { const g = grid();
  annulus(g, 14.0, 15.8, '1'); annulus(g, 11.2, 14.0, '3'); annulus(g, 9.6, 11.2, '4'); annulus(g, 8.0, 9.6, '2');
  debris(g, 1337, 26, 16.0, 18.4, ['2', '1'], 2);
  ditherEdge(g, 71, '2');
  return g; })();

S.shock = (() => { const g = grid();
  annulus(g, 15.2, 16.6, '1'); annulus(g, 12.4, 15.2, '3'); annulus(g, 10.0, 12.4, '4');
  annulus(g, 5.2, 6.8, '2');
  for (let i = 0; i < 12; i++) ray(g, (i / 12) * Math.PI * 2, 7.2, 10.0, '3', 0.9);
  debris(g, 4242, 14, 17.0, 18.6, ['2'], 2);
  ditherEdge(g, 72, '2');
  return g; })();

S.bubble = (() => { const g = grid();
  disc(g, 14.8, '2'); annulus(g, 13.2, 14.8, '1');
  annulus(g, 8.0, 11.2, '3', (x, y) => { const a = Math.atan2(y - C, x - C); return a > -2.5 && a < -1.1; });
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 + 0.4; set(g, C + Math.cos(a) * 11.6, C + Math.sin(a) * 11.6, '4'); }
  ditherEdge(g, 73, '2');
  return g; })();

S.nova = (() => { const g = grid();
  debris(g, 90210, 22, 15.4, 18.6, ['2', '1', '3'], 2);
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2;
    ray(g, a, 4.8, 10.4, '3', 2.6); ray(g, a, 10.0, 14.6, '2', 1.5); ray(g, a, 13.6, 15.6, '1', 0.7); }
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    ray(g, a, 4.4, 10.0, '3', 1.4); ray(g, a, 9.2, 11.6, '2', 0.6); }
  disc(g, 4.8, '4'); annulus(g, 4.8, 6.6, '3');
  ditherEdge(g, 74, '2');
  return g; })();

S.blade = (() => { const g = grid();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = dd(x, y); if (d < 6.8 || d > 15.2) continue;
    const a = Math.atan2(y - C, x - C);
    const da = Math.abs(((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const hw = 1.65 - (d - 6.8) * 0.115;
    if (da > hw) continue;
    set(g, x, y, d > 13.2 ? '4' : d > 11.2 ? '3' : d > 8.8 ? '2' : '1');
  }
  ditherEdge(g, 75, '2');
  return g; })();

S.sun = (() => { const g = grid();
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2;
    ray(g, a, 6.8, 13.2, '3', 1.3); ray(g, a, 12.0, 15.2, '2', 0.6); }
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    ray(g, a, 6.8, 11.0, '2', 0.7); }
  debris(g, 555, 18, 15.8, 18.0, ['2', '1'], 2);
  disc(g, 6.4, '4'); annulus(g, 6.4, 7.8, '3');
  ditherEdge(g, 76, '2');
  return g; })();

S.quake = (() => { const g = grid(); const rnd = lcg(4242);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.35, len = 6 + rnd() * 10;
    bres(g, C + Math.cos(a) * 1.0, 15.5 + Math.sin(a) * 0.4, C + Math.cos(a) * len, 15.5 + Math.sin(a) * len * 0.75, '1');
  }
  debris(g, 777, 18, 6.0, 14.0, ['2', '1'], 2);
  for (let x = 2; x <= 29; x++) { set(g, x, 14, '3'); set(g, x, 15, '3'); set(g, x, 16, '3'); }
  for (let x = 12; x <= 19; x++) set(g, x, 15, '4');
  ditherEdge(g, 77, '1');
  return g; })();

S.cage = (() => { const g = grid();
  for (let y = 4; y <= 27; y++) { set(g, 2, y, '1'); set(g, 29, y, '1'); }
  for (let x = 2; x <= 29; x++) { set(g, x, 4, '1'); set(g, x, 27, '1'); }
  for (let y = 8; y <= 23; y++) { set(g, 8, y, '1'); set(g, 23, y, '1'); }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const m = Math.abs(x - C) + Math.abs(y - C);
    if (m <= 4.4) set(g, x, y, '4'); else if (m <= 8.4) set(g, x, y, '3');
  }
  ditherEdge(g, 78, '1');
  return g; })();

S.rift = (() => { const g = grid(); const rnd = lcg(31415);
  for (let y = 0; y < N; y++) {
    const t = (y - C) / 15.5;
    const w = 5.6 * Math.max(0, 1 - t * t) + (rnd() - 0.5) * 1.6;
    for (let x = 0; x < N; x++) {
      const dx = Math.abs(x - C); if (dx > w) continue;
      set(g, x, y, dx <= 1.6 ? '4' : dx <= 3.0 ? '3' : dx <= 4.2 ? '2' : '1');
    }
  }
  ditherEdge(g, 79, '1');
  return g; })();

S.light = (() => { const g = grid(); const rnd = lcg(8888);
  for (let y = 0; y < N; y++) {
    const w = 9.2 - 4.8 * (y / (N - 1));
    for (let x = 0; x < N; x++) {
      const dx = Math.abs(x - C); if (dx > w) continue;
      const t = dx / Math.max(0.001, w);
      set(g, x, y, t <= 0.25 ? '4' : t <= 0.5 ? '3' : t <= 0.78 ? '2' : '1');
    }
  }
  for (let i = 0; i < 24; i++) set(g, 2 + Math.floor(rnd() * 28), Math.floor(rnd() * N), '2');
  return g; })();

// beam/trail 是「沿方向平铺的段」，其可见粗细 = 内容行数 × block。
// block 最小为 1，故内容行数直接决定粗细 —— 32×32 下若沿用 16×16 的比例会让光束凭空变粗，
// 这里按原 16×16 的实际粗细（beam≈8 行、trail≈10 行）折算回内容行数。
S.beam = (() => { const g = grid();          // 内容 8 行（12..19）
  for (let x = 0; x < N; x++) {
    set(g, x, 15, '4'); set(g, x, 16, '4');
    set(g, x, 14, '3'); set(g, x, 17, '3');
    set(g, x, 13, '2'); set(g, x, 18, '2');
    if (x % 2 === 0) { set(g, x, 12, '1'); set(g, x, 19, '1'); }
  }
  return g; })();

S.trail = (() => { const g = grid();         // 内容 12 行（10..21）
  for (let x = 0; x < N; x++) {
    set(g, x, 14, '4'); set(g, x, 15, '4'); set(g, x, 16, '4'); set(g, x, 17, '4');
    set(g, x, 13, '3'); set(g, x, 18, '3');
    set(g, x, 12, '2'); set(g, x, 19, '2');
    set(g, x, 11, '2'); set(g, x, 20, '2');
    if (x % 2 === 0) { set(g, x, 10, '1'); set(g, x, 21, '1'); }
  }
  return g; })();

// ══════════ 挥击 / 地形（保持 16×16）══════════
N = 16; C = 7.5;
const K = {};

K.slash = (() => { const g = grid();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = dd(x, y); if (d < 3.0 || d > 7.2) continue;
    const a = Math.atan2(y - C, x - C);
    const da = Math.abs(((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const hw = 1.15 - (d - 3.0) * 0.11;
    if (da > hw) continue;
    set(g, x, y, d > 6.0 ? '4' : d > 4.8 ? '3' : '2');
  }
  return g; })();

K.thrust = (() => { const g = grid();
  for (let x = 1; x <= 14; x++) {
    set(g, x, 7, x >= 12 ? '4' : x >= 8 ? '3' : x >= 5 ? '2' : '1');
    set(g, x, 8, x >= 12 ? '4' : x >= 8 ? '3' : x >= 5 ? '2' : '1');
  }
  set(g, 14, 6, '3'); set(g, 14, 9, '3'); set(g, 13, 6, '2'); set(g, 13, 9, '2');
  return g; })();

K.gun = (() => { const g = grid();
  const cx = 4.5, cy = 8;
  for (let i = 0; i < 8; i++) rayAt(g, cx, cy, (i / 8) * Math.PI * 2, 1.5, 4.3, '3', 0.65);
  rayAt(g, cx, cy, 0, 1.5, 6.0, '2', 0.5); rayAt(g, cx, cy, Math.PI, 1.5, 3.0, '2', 0.5);
  discAt(g, cx, cy, 1.9, '4');
  debrisAt(g, cx, cy, 606, 5, 4.6, 6.4, ['2', '1']);
  return g; })();

K.bow = (() => { const g = grid();
  for (let x = 1; x <= 12; x++) set(g, x, 8, '3');
  bres(g, 12, 6, 14, 8, '4'); bres(g, 12, 10, 14, 8, '4'); set(g, 13, 8, '4'); set(g, 14, 8, '4');
  return g; })();

K.punch = (() => { const g = grid();
  const sect = (r0, r1, ch, hw) => annulus(g, r0, r1, ch, (x, y) => {
    const a = Math.atan2(y - C, x - C);
    return Math.abs(((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < hw;
  });
  sect(4.4, 5.8, '2', 1.15);
  sect(2.4, 3.6, '3', 1.15);
  disc(g, 1.7, '4');
  return g; })();

K.shield = (() => { const g = grid();
  annulus(g, 3.8, 4.9, '3', (x, y) => {
    const a = Math.atan2(y - C, x - C);
    return Math.abs(((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 1.25;
  });
  for (let x = 3; x <= 13; x++) set(g, x, 8, '4');
  annulus(g, 5.6, 6.2, '2', (x, y) => {
    const a = Math.atan2(y - C, x - C);
    return Math.abs(((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 1.25;
  });
  return g; })();

K.sweep = (() => { const g = grid();
  const at = (t) => [2 + t * 11, 13 - Math.pow(t, 1.5) * 9];
  for (let i = 0; i <= 18; i++) {
    const [x, y] = at(i / 18);
    set(g, x, y, '3'); set(g, x + 1, y + 1, '2'); set(g, x, y + 1, '2');
  }
  for (let i = 0; i < 4; i++) {
    const [x, y] = at(0.22 + i * 0.2);
    set(g, x, y - 2, '4'); set(g, x + 1, y - 2, '4'); set(g, x, y - 1, '3');
  }
  return g; })();

K.staff = (() => { const g = grid();
  disc(g, 2.2, '4', (x, y) => Math.hypot(x - C, y - 5.0) <= 2.2);
  annulus(g, 2.2, 3.0, '3', (x, y) => Math.hypot(x - C, y - 5.0) <= 3.0);
  for (let y = 8; y <= 13; y++) { const w = Math.max(0, 3 - (y - 8) * 0.55); for (let x = 0; x < N; x++) if (Math.abs(x - C) <= w) set(g, x, y, y > 11 ? '2' : '3'); }
  return g; })();

const P = {};

P.sandstone = (() => { const g = grid();
  for (let y = 2; y <= 13; y++) for (let x = 3; x <= 12; x++) set(g, x, y, '2');
  for (let y = 2; y <= 13; y++) { set(g, 2, y, '1'); set(g, 13, y, '1'); }
  for (let x = 2; x <= 13; x++) { set(g, x, 1, '1'); set(g, x, 14, '1'); }
  for (let y = 3; y <= 12; y++) set(g, 3, y, '3');
  for (let x = 3; x <= 12; x++) set(g, x, 2, '3');
  for (let y = 5; y <= 10; y++) for (let x = 5; x <= 10; x++) set(g, x, y, '1');
  return g; })();

P.frost = (() => { const g = grid();
  for (let y = 1; y <= 14; y++) {
    const hw = ((y - 1) / 13) * 5.6;
    for (let x = 0; x < N; x++) {
      const dx = Math.abs(x - C); if (dx > hw) continue;
      set(g, x, y, dx > hw - 1 ? '1' : x >= 8 ? '3' : '2');
    }
  }
  for (let y = 4; y <= 11; y++) if (g[y][9] !== '.') set(g, 9, y, '4');
  return g; })();

P.magma = (() => { const g = grid();
  for (let y = 2; y <= 13; y++) for (let x = 3; x <= 12; x++) set(g, x, y, '1');
  for (let y = 3; y <= 12; y++) for (let x = 4; x <= 11; x++) set(g, x, y, '2');
  const rnd = lcg(1717);
  for (let y = 4; y <= 12; y++) { const j = rnd() < 0.35 ? 1 : 0; set(g, 7 + j, y, '4'); set(g, 8 + j, y, '3'); }
  return g; })();

P.void = (() => { const g = grid();
  for (let y = 4; y <= 10; y++) for (let x = 3; x <= 12; x++) {
    set(g, x, y, (x <= 3 || x >= 12 || y <= 4 || y >= 10) ? '1' : '2');
  }
  for (let x = 4; x <= 11; x++) { set(g, x, 12, '1'); set(g, x, 4, '3'); }
  return g; })();

P.verdant = (() => { const g = grid();
  for (let y = 6; y <= 13; y++) for (let x = 3; x <= 12; x++) {
    set(g, x, y, (x <= 3 || x >= 12 || y >= 13) ? '1' : '2');
  }
  for (let y = 4; y <= 6; y++) for (let x = 3; x <= 12; x++) {
    if (Math.hypot(x - C, (y - 5) * 2.2) <= 5) set(g, x, y, '3');
  }
  for (let y = 4; y <= 6; y++) for (let x = 3; x <= 12; x++) {
    const d = Math.hypot(x - C, (y - 5) * 2.2);
    if (Math.abs(d - 3.1) < 0.6 || Math.abs(d - 1.5) < 0.5) set(g, x, y, '1');
  }
  return g; })();

P.sanctum = (() => { const g = grid();
  for (let x = 2; x <= 13; x++) { set(g, x, 2, '3'); set(g, x, 3, '2'); set(g, x, 4, '1'); }
  for (let y = 5; y <= 13; y++) for (let x = 5; x <= 10; x++) {
    set(g, x, y, (x <= 5 || x >= 10) ? '1' : '2');
  }
  bres(g, 5, 9, 10, 12, '1');
  return g; })();

// ── 输出 TS ──
const fmt = (name, g) => `  ${name}: [\n${g.map((r) => `    '${r.join('')}',`).join('\n')}\n  ],`;
let out = `// 像素 VFX / 挥击 / 地形 母题（v2.5.1）— 由 scripts/gen-pixel-vfx-templates.mjs 生成后固化。
// 色阶字符：'.'=透明  '1'=暗轮廓  '2'=中间调  '3'=亮部  '4'=白热核心
//
// ⚠️ 分辨率分档（不要随意统一）：
//   · VFX_TPL = 32×32 —— 技能特效直径可达 100~345px，16×16 会让 block=round(d/16) 达 9~22，
//     单像素被放大成巨块（「扩散范围偏模糊」的根因）。32×32 使 block 减半。
//   · SWING_TPL / PROP_TPL = 16×16 —— 渲染尺寸仅 ~24~48px，用 32×32 会让 block 塌到 1、
//     内容反而缩水变糊。故保持 16。
// ⚠️ 本文件由脚本生成，手工微调请直接改字符串；重跑脚本会丢弃手工改动。

/** 技能特效母题：32×32 */
export const VFX_TPL_W = 32;
/** 挥击 / 地形母题：16×16 */
export const SMALL_TPL_W = 16;

/** 12 种技能 shape → 32×32 母题。beam / trail 为「可沿方向平铺的段」。 */
export const VFX_TPL: Record<string, string[]> = {
${Object.keys(S).map((k) => fmt(k, S[k])).join('\n')}
};

/** 8 种普攻挥击（AtkKind）→ 16×16 母题。 */
export const SWING_TPL: Record<string, string[]> = {
${Object.keys(K).map((k) => fmt(k, K[k])).join('\n')}
};

/** 6 种地形掩体（MapTheme）→ 16×16 母题。色阶：'1'=wall '2'=prop '3'=受光 '4'=accent。 */
export const PROP_TPL: Record<string, string[]> = {
${Object.keys(P).map((k) => fmt(k, P[k])).join('\n')}
};
`;

// ⚠️ 会覆盖 src/render/pixelVfxTemplates.ts。母题已静态固化并允许手工微调，
//    重跑会丢弃所有手工改动 —— 仅在需要重新生成全部母题时使用。生成结果确定性（种子 LCG）。
const OUT = new URL('../src/render/pixelVfxTemplates.ts', import.meta.url);
writeFileSync(OUT, out.replace(/\n/g, '\r\n'), 'utf8');

let bad = 0;
for (const [k, g] of Object.entries(S)) {
  g.forEach((r, i) => { if (r.length !== 32) { console.log(`BAD ${k} row${i} len=${r.length}`); bad++; } });
  console.log(`${k} (${g.flat().filter((c) => c !== '.').length} px)`);
}
for (const [k, g] of [...Object.entries(K), ...Object.entries(P)]) {
  g.forEach((r, i) => { if (r.length !== 16) { console.log(`BAD ${k} row${i} len=${r.length}`); bad++; } });
  console.log(`${k} (${g.flat().filter((c) => c !== '.').length} px)`);
}
console.log(bad === 0 ? '\nOK all rows valid' : `\nFAIL ${bad}`);
