// v1.4 渲染验收页（仅 dev，不进产物）：把六套主题皮 / 五档体型 / 四档施法距离
// 一次性铺开，用眼睛而不是靠想象验收。
// 「感觉不对先查反馈通道」——那前提是你得先看得到反馈通道。
import { BattleSim } from '@arena/core/engine/battle';
import { makeAlly, makeEnemy } from '@arena/core/engine/unit';
import { genLayer } from '@arena/core/gen/levelGen';
import { HEROES } from '@arena/core/content/heroes';
import { ENEMIES } from '@arena/core/content/enemies';
import { MAP_THEMES, themeForDepth } from '@arena/core/content/arenas';
import { ALL_BODY_TYPES, BODY_INFO, SUBCLASS_INFO } from '@arena/core/content/classes';
import { SUMMON_TEMPLATES } from '@arena/core/content/summons';
import { drawSprite } from '../render/sprites';
import { enemyScale } from '@arena/core/engine/scaling';
import { Unit, SubClass } from '@arena/core/types';

const root = document.getElementById('root')!;

function section(title: string): HTMLDivElement {
  const h = document.createElement('h2');
  h.textContent = title;
  root.appendChild(h);
  const g = document.createElement('div');
  g.className = 'grid';
  root.appendChild(g);
  return g;
}

function cell(parent: HTMLElement, caption: string, w: number, h: number): CanvasRenderingContext2D {
  const d = document.createElement('div');
  d.className = 'cell';
  const c = document.createElement('div');
  c.className = 'cap';
  c.textContent = caption;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.style.width = `${w}px`; cv.style.height = `${h}px`;
  d.appendChild(c); d.appendChild(cv);
  parent.appendChild(d);
  return cv.getContext('2d')!;
}

// ── ① 六套主题皮 × 立柱迷宫布局（同一份 tilemap，只换皮）──
const g1 = section('① 地图主题皮（美术 §3.4）— 同一份 tilemap，只换主题');
const DEPTHS = [1, 15, 25, 35, 45, 55];
for (const depth of DEPTHS) {
  const plan = genLayer(depth, 42);
  // 强制用立柱迷宫，掩体形态差异才看得出来
  plan.arena = { ...plan.arena, id: 'A3', tiles: [
    '####################',
    '#..................#',
    '#...P......P.......#',
    '#..................#',
    '#......P.......P...#',
    '#..S...........E...#',
    '#..................#',
    '#...P.......P......#',
    '#..................#',
    '#......P.......P...#',
    '#..................#',
    '#..................#',
    '####################',
  ] };
  const team = [HEROES[0], HEROES[3], HEROES[7]];
  const allies: Unit[] = team.map((hh, i) => {
    const u = makeAlly(hh, 1 + Math.floor((depth - 1) / 2), []);
    u.x = 3.5; u.y = 5.5 + (i - 1) * 1.4; return u;
  });
  const sc = enemyScale(depth);
  const foes: Unit[] = ENEMIES.filter((e) => !e.isBoss).slice(0, 3).map((e, i) => {
    const u = makeEnemy(e, 1 + Math.floor(depth / 4), sc.hp, sc.dmg);
    u.x = 15.5; u.y = 5.5 + (i - 1) * 1.4; return u;
  });
  const sim = new BattleSim([...allies, ...foes], plan.arena, 7);
  for (let i = 0; i < 40; i++) sim.tick(1 / 20); // 跑 2 秒，让技能与召唤物出场
  const ctx = cell(g1, `L${depth} · ${MAP_THEMES[themeForDepth(depth)].cn} · fade=${plan.arena.fade}`, 480, 312);
  renderOnce(ctx, sim);
}

// ── ② 循环褪色 4 级（无限模式的叙事：越走越荒芜）──
const g2 = section('② 循环褪色 fade 0→4（美术 §3.4.3）— 60 层一轮，越走越荒芜');
for (const fade of [0, 1, 2, 3, 4]) {
  const depth = 1 + fade * 60;
  const plan = genLayer(depth, 42);
  const u = makeAlly(HEROES[0], 5, []); u.x = 3.5; u.y = 5.5;
  const e = makeEnemy(ENEMIES[0], 3, 1, 1); e.x = 7.5; e.y = 5.5;
  const sim = new BattleSim([u, e], plan.arena, 3);
  const ctx = cell(g2, `L${depth} · fade=${plan.arena.fade}`, 264, 216);
  renderCrop(ctx, sim, 11, 9);
}

// ── ③ 五档体型（同一子类，只换体型）──
const g3 = section('③ 体型系统（美术 §4.5）— 同一子类 physTank，只换体型');
{
  const ctx = cell(g3, 'colossal / heavy / medium / light / petite（含受击半径环）', 420, 90);
  ctx.fillStyle = '#241c33'; ctx.fillRect(0, 0, 420, 90);
  ALL_BODY_TYPES.forEach((b, i) => {
    const x = 45 + i * 82, y = 46;
    const info = BODY_INFO[b];
    // 受击半径环：视觉即判定
    ctx.strokeStyle = '#4aa3ff'; ctx.lineWidth = info.outline;
    ctx.beginPath();
    ctx.ellipse(x, y + info.renderPx * 0.35, 0.42 * info.sizeMult * 24, 0.42 * info.sizeMult * 24 * 0.44, 0, 0, Math.PI * 2);
    ctx.stroke();
    drawSprite(ctx, 'physTank', x, y, info.renderPx, false, { bodyType: b });
    ctx.fillStyle = '#8f88a0'; ctx.font = '10px ui-monospace'; ctx.textAlign = 'center';
    ctx.fillText(`${info.cn} ${info.renderPx}px`, x, 84);
  });
}

// ── ④ 九子类剪影 × 默认体型 ──
const g4 = section('④ 九子类剪影 × 各自默认体型（美术 §4.4/§4.5）');
{
  const subs = Object.keys(SUBCLASS_INFO) as SubClass[];
  const ctx = cell(g4, '我方（上）/ 敌方配色（下）', 60 * subs.length, 130);
  ctx.fillStyle = '#241c33'; ctx.fillRect(0, 0, 60 * subs.length, 130);
  subs.forEach((s, i) => {
    const info = SUBCLASS_INFO[s];
    drawSprite(ctx, s, 30 + i * 60, 34, BODY_INFO[info.defaultBody].renderPx, false, { bodyType: info.defaultBody });
    drawSprite(ctx, s, 30 + i * 60, 88, BODY_INFO[info.defaultBody].renderPx, true, { bodyType: info.defaultBody });
    ctx.fillStyle = '#8f88a0'; ctx.font = '9px ui-monospace'; ctx.textAlign = 'center';
    ctx.fillText(info.cn, 30 + i * 60, 122);
  });
}

// ── ⑤ 同名多份 + 星级（商店升星的视觉出口）──
const g5 = section('⑤ 同名多份臂章 + 星级标识（美术 §4.6）');
{
  const ctx = cell(g5, '第 1/2/3 份 × 星级 1–5', 460, 90);
  ctx.fillStyle = '#241c33'; ctx.fillRect(0, 0, 460, 90);
  for (let d = 1; d <= 3; d++) {
    drawSprite(ctx, 'charge', 40 + (d - 1) * 60, 50, 30, false, { bodyType: 'heavy', dupIndex: d });
    ctx.fillStyle = '#8f88a0'; ctx.font = '9px ui-monospace'; ctx.textAlign = 'center';
    ctx.fillText(`第${d}份`, 40 + (d - 1) * 60, 80);
  }
  for (let s = 1; s <= 5; s++) {
    drawSprite(ctx, 'sniper', 250 + (s - 1) * 44, 50, 22, false, { bodyType: 'light', star: s });
    ctx.fillStyle = '#8f88a0'; ctx.font = '9px ui-monospace'; ctx.textAlign = 'center';
    ctx.fillText(`${s}★`, 250 + (s - 1) * 44, 80);
  }
}

// ── ⑥ 三类召唤物 ──
const g6 = section('⑥ 三类召唤物剪影（美术 §7.4）— 必须一眼不像英雄');
{
  const kinds = Object.keys(SUMMON_TEMPLATES) as (keyof typeof SUMMON_TEMPLATES)[];
  const ctx = cell(g6, '石魂卫（方）/ 影刃仆（尖）/ 咒火灵（火焰+唯一暖色）', 300, 100);
  ctx.fillStyle = '#241c33'; ctx.fillRect(0, 0, 300, 100);
  kinds.forEach((k, i) => {
    const tpl = SUMMON_TEMPLATES[k];
    drawSprite(ctx, 'summoner', 60 + i * 90, 44, BODY_INFO[tpl.bodyType].renderPx * 1.1, false, {
      bodyType: tpl.bodyType, summonKind: k, t: 0.25,
    });
    ctx.fillStyle = '#8f88a0'; ctx.font = '10px ui-monospace'; ctx.textAlign = 'center';
    ctx.fillText(`${tpl.name} ${tpl.duration}s`, 60 + i * 90, 88);
  });
}

// ── ⑦ 施法距离三件套（四档并排）──
const g7 = section('⑦ 施法距离可视化三件套（美术 §7.3.1）— 虚线环=castRange，实线=实际效果');
{
  const cases: { sub: SubClass; label: string }[] = [
    { sub: 'magicTank', label: '奥能护盾 0 格 · self' },
    { sub: 'physTank', label: '盾墙嘲讽 3.0 格 · short' },
    { sub: 'gunner', label: '弹幕压制 6.0 格 · mid' },
    { sub: 'sniper', label: '致命狙击 9.0 格 · long（预警细线）' },
  ];
  for (const cs of cases) {
    const hero = HEROES.find((h) => h.subclass === cs.sub)!;
    const plan = genLayer(3, 42);
    const a = makeAlly(hero, 6, []); a.x = 4.5; a.y = 6.5;
    const foes: Unit[] = ENEMIES.filter((e) => !e.isBoss).slice(0, 4).map((e, i) => {
      const u = makeEnemy(e, 3, 1.4, 0.2); u.x = 8.5 + i * 1.6; u.y = 5.0 + i * 0.9; return u;
    });
    const sim = new BattleSim([a, ...foes], { ...plan.arena, theme: 'sandstone', fade: 0 }, 5);
    sim.forceCast(cs.sub);
    sim.tick(1 / 20); sim.tick(1 / 20); // 走 2 帧让 windup 环与首段特效都在
    const ctx = cell(g7, cs.label, 480, 312);
    renderOnce(ctx, sim);
  }
}

// ── 渲染工具：复刻 ArenaCanvas 的绘制顺序（保持验收与实机一致）──
import { drawFrame } from '../render/frame';
function renderOnce(ctx: CanvasRenderingContext2D, sim: BattleSim) { drawFrame(ctx, sim); }
function renderCrop(ctx: CanvasRenderingContext2D, sim: BattleSim, w: number, h: number) {
  const tmp = document.createElement('canvas');
  tmp.width = sim.W * 24; tmp.height = sim.H * 24;
  drawFrame(tmp.getContext('2d')!, sim);
  ctx.drawImage(tmp, 0, 0, w * 24, h * 24, 0, 0, w * 24, h * 24);
}
