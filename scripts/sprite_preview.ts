// 精灵预览（trust-but-verify）：把真实的 drawSprite 跑在一个"录制型"Canvas 上下文上，
// 把所有绘制指令还原成 SVG。这样验收的是**线上那份代码**，而不是我重写的一份近似实现。
// 用途：肉眼确认 v1.6 三色阶明暗、落地投影、星级辉光是否真的生效。
import { drawSprite } from '../src/render/sprites';
import { SUBCLASS_INFO } from '../packages/core/src/content/classes';
import { SubClass, BodyType, SummonKind } from '../packages/core/src/types';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

type Cmd = string;

/** 只实现 drawSprite 用到的那部分 Canvas2D 表面，其余留空即可 */
function recorder() {
  const out: Cmd[] = [];
  let fill = '#000', stroke = '#000', alpha = 1, lw = 1;
  let shadowColor = '', shadowBlur = 0;
  const stack: any[] = [];
  let path: string[] = [];
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const ctx: any = {
    set fillStyle(v: string) { fill = v; }, get fillStyle() { return fill; },
    set strokeStyle(v: string) { stroke = v; }, get strokeStyle() { return stroke; },
    set globalAlpha(v: number) { alpha = v; }, get globalAlpha() { return alpha; },
    set lineWidth(v: number) { lw = v; }, get lineWidth() { return lw; },
    set shadowColor(v: string) { shadowColor = v; }, get shadowColor() { return shadowColor; },
    set shadowBlur(v: number) { shadowBlur = v; }, get shadowBlur() { return shadowBlur; },
    save() { stack.push({ fill, stroke, alpha, lw, shadowColor, shadowBlur }); },
    restore() {
      const s = stack.pop();
      if (s) ({ fill, stroke, alpha, lw, shadowColor, shadowBlur } = s);
    },
    fillRect(x: number, y: number, w: number, h: number) {
      out.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="${esc(fill)}" opacity="${alpha}"/>`);
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      out.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="none" stroke="${esc(stroke)}" stroke-width="${lw}" opacity="${alpha}"/>`);
    },
    beginPath() { path = []; },
    moveTo(x: number, y: number) { path.push(`M${x.toFixed(2)},${y.toFixed(2)}`); },
    lineTo(x: number, y: number) { path.push(`L${x.toFixed(2)},${y.toFixed(2)}`); },
    closePath() { path.push('Z'); },
    ellipse(x: number, y: number, rx: number, ry: number) {
      out.push(`<ellipse cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" fill="${esc(fill)}" opacity="${alpha}"/>`);
      path = ['__ellipse__'];
    },
    arc() { path = ['__arc__']; },
    fill() {
      if (!path.length || path[0].startsWith('__')) { path = []; return; }
      const glow = shadowBlur > 0 ? ` filter="url(#glow)"` : '';
      out.push(`<path d="${path.join(' ')}" fill="${esc(fill)}" opacity="${alpha}"${glow}/>`);
      path = [];
    },
    stroke() { path = []; },
  };
  return { ctx, out };
}

const SIZE = 72;
const GAP = 14;
const CLASSES: SubClass[] = [
  'physTank', 'magicTank', 'charge', 'hexblade', 'gunner', 'sniper', 'controller', 'summoner', 'healer',
];
const BODIES: BodyType[] = ['colossal', 'heavy', 'medium', 'light', 'petite'];
const SUMMONS: SummonKind[] = ['bulwark', 'sprinter', 'arcanist'];

const cells: string[] = [];
let maxX = 0, maxY = 0;

function cell(label: string, col: number, row: number, draw: (ctx: any, cx: number, cy: number) => void) {
  const x = 20 + col * (SIZE + GAP);
  const y = 40 + row * (SIZE + GAP + 16);
  const { ctx, out } = recorder();
  draw(ctx, x + SIZE / 2, y + SIZE / 2);
  cells.push(
    `<g>${out.join('')}<text x="${x + SIZE / 2}" y="${y + SIZE + 12}" font-size="9" fill="#9a8fb0" text-anchor="middle" font-family="monospace">${label}</text></g>`,
  );
  maxX = Math.max(maxX, x + SIZE);
  maxY = Math.max(maxY, y + SIZE + 16);
}

// 第 1-2 行：9 个职业（中等体型，友方）
CLASSES.forEach((sc, i) => {
  cell(sc, i % 5, Math.floor(i / 5), (ctx, cx, cy) =>
    drawSprite(ctx, sc, cx, cy, SIZE * 0.8, false, { bodyType: 'medium', t: 0.3 }));
});

// 第 3 行：五种体型（同一职业，验证体块重排 + 投影差异）
BODIES.forEach((b, i) => {
  cell(`physTank/${b}`, i, 2, (ctx, cx, cy) =>
    drawSprite(ctx, 'physTank', cx, cy, SIZE * 0.8, false, { bodyType: b, t: 0.3 }));
});

// 第 4 行：星级 1-5（验证五角星辉光）
[1, 2, 3, 4, 5].forEach((s, i) => {
  cell(`★${s}`, i, 3, (ctx, cx, cy) =>
    drawSprite(ctx, 'sniper', cx, cy, SIZE * 0.8, false, { bodyType: 'medium', star: s, t: 0.3 }));
});

// 第 5 行：敌方配色 + 3 类召唤物
cell('敌方', 0, 4, (ctx, cx, cy) =>
  drawSprite(ctx, 'charge', cx, cy, SIZE * 0.8, true, { bodyType: 'medium', t: 0.3 }));
SUMMONS.forEach((k, i) => {
  cell(`召唤/${k}`, i + 1, 4, (ctx, cx, cy) =>
    drawSprite(ctx, 'summoner', cx, cy, SIZE * 0.8, false, { summonKind: k, t: 0.3 }));
});
cell('void亮边', 4, 4, (ctx, cx, cy) =>
  drawSprite(ctx, 'controller', cx, cy, SIZE * 0.8, false, { bodyType: 'medium', outlineUnits: true, t: 0.3 }));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${maxX + 20}" height="${maxY + 20}" viewBox="0 0 ${maxX + 20} ${maxY + 20}">
<defs><filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
<feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<rect width="100%" height="100%" fill="#14101a"/>
<text x="20" y="24" font-size="13" fill="#ffcc4d" font-family="monospace">v1.6 精灵渲染验收 — 三色阶明暗 / 落地投影 / 星级辉光</text>
${cells.join('\n')}
</svg>`;

// 注意：脚本会被 esbuild 打包到 node_modules/.cache/ 再执行，import.meta.url 不可靠，
// 必须用 cwd（始终是项目根）来定位输出目录。
const outDir = join(process.cwd(), '.preview');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'sprites.svg'), svg);
console.log(`OK  ${CLASSES.length + BODIES.length + 5 + 5} 个精灵已渲染 → ${join(outDir, 'sprites.svg')}`);
console.log(`    调色板样例: ${CLASSES.slice(0, 3).map((c) => `${c}=${SUBCLASS_INFO[c].color}`).join(' ')}`);
