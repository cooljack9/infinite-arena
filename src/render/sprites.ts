// 像素角色渲染（美术 §4）
//
// v2.3 重写要点（目标：把观感拉到 Steam 独立像素游戏的基线）
//  1. 模板 16×16 → 20×20，并拆到 sprite-templates.ts；索引从 7 个扩到 13 个，
//     金属 / 皮革 / 布料 / 皮肤 / 能量各自独立，材质分层是像素画「贵」起来的第一要素。
//  2. 渲染改为「离屏 1:1 光栅化 + 缓存 + nearest 放大」。
//     旧实现每帧对每个单位跑 256 次 fillRect，还用 Math.ceil(px) 补缝——
//     结果是像素宽度忽 2 忽 3，边缘参差，这正是自制像素游戏「脏」的主因。
//     现在一个组合只光栅化一次，之后每帧只有一次 drawImage：更锐利，也快一个数量级。
//  3. selective outline：描边不用纯黑，用职业色压到 12% 明度。
//     纯黑描边会把角色从场景里「抠」下来，像贴纸；带色描边才有整体感。
//  4. 像素级 bloom：g/e 索引向四邻溢出一圈半透明亮色。
//     不用 canvas shadowBlur——那会产生非像素的连续渐变，破坏风格统一。
//  5. Boss 走独立强化路径（外扩暗红重描边 + 双层辉光 + 更强落地影），配合体型 titan 档。
import { SubClass, BodyType, SummonKind, MonsterKind, MountKind, MountRarity, BuildingKind, Gender } from '@arena/core/types';
import { SUBCLASS_INFO, BODY_INFO } from '@arena/core/content/classes';
import { MOUNTS, MOUNT_RARITY } from '@arena/core/content/mounts';
import { BUILDINGS } from '@arena/core/content/buildings';
import {
  TEMPLATES, TPL_W, SUMMON_TEMPLATES_PX, SUMMON_PALETTE, MATERIAL, GLOW_CHARS,
  MONSTER_TEMPLATES, MONSTER_PALETTE,
  MOUNT_TEMPLATES, MOUNT_TPL_W, MOUNT_TPL_H,
  BUILDING_TEMPLATES, BUILDING_TPL_SIZE,
} from './sprite-templates';

export { TEMPLATES, SUMMON_TEMPLATES_PX, MOUNT_TEMPLATES, BUILDING_TEMPLATES };

// ══ 颜色工具 ═════════════════════════════════════════════════════════
const shadeCache = new Map<string, string>();
/** 明度偏移。amt>0 提亮、<0 压暗 */
function shade(hex: string, amt: number): string {
  if (amt === 0) return hex;
  const key = `${hex}|${amt}`;
  const hit = shadeCache.get(key);
  if (hit) return hit;
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt > 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
  const hx = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  const out = `#${hx(r)}${hx(g)}${hx(b)}`;
  shadeCache.set(key, out);
  return out;
}

function toRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * 敌方染色。旧实现把所有敌人主色硬编码成同一个 #c0444a，
 * 结果 9 个职业的敌人版本颜色完全一样，只能靠剪影区分——信息量白白丢了一半。
 * 改为色相压缩：把原色相压进「深红→品红」这段窄区间，
 * 于是整体统一为「敌意红」，但职业之间仍保留可辨的色相次序。
 */
const enemyCache = new Map<string, string>();
function tintEnemy(hex: string): string {
  const hit = enemyCache.get(hex);
  if (hit) return hit;
  const [r0, g0, b0] = toRgb(hex);
  const r = r0 / 255, g = g0 / 255, b = b0 / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  // 色相压缩到 [-0.035, +0.085] 圈（≈ -13° 深红 → +31° 橙红），保留职业次序
  const nh = (0.985 + h * 0.10) % 1;
  const ns = Math.min(1, s * 1.08 + 0.18);
  const nl = l * 0.82;
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t; if (tt < 0) tt += 1; if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  let rr: number, gg: number, bb: number;
  if (ns === 0) { rr = gg = bb = nl; } else {
    const q = nl < 0.5 ? nl * (1 + ns) : nl + ns - nl * ns;
    const p = 2 * nl - q;
    rr = hue2rgb(p, q, nh + 1 / 3); gg = hue2rgb(p, q, nh); bb = hue2rgb(p, q, nh - 1 / 3);
  }
  const hx = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  const out = `#${hx(rr)}${hx(gg)}${hx(bb)}`;
  enemyCache.set(hex, out);
  return out;
}

const HI = 0.22;   // 受光棱提亮
const LO = -0.32;  // 背光面压暗

/**
 * 逐像素定光照档位：假定光源在左上方（像素画通用约定，也是玩家直觉）。
 * 判据只看四邻是否实心——O(1)、与模板无关，天然沿剪影内缘生成一圈内斜面。
 */
function toneAt(tpl: string[], r: number, c: number): number {
  const solid = (rr: number, cc: number) => {
    const row = tpl[rr];
    if (!row) return false;
    const ch = row[cc];
    return ch !== undefined && ch !== '.' && ch !== 'O';
  };
  const up = solid(r - 1, c), left = solid(r, c - 1);
  const down = solid(r + 1, c), right = solid(r, c + 1);
  if (!up && !left) return HI;
  if (!down || !right) return LO;
  return 0;
}

// ══ 体块重排（美术 §4.5.2）═══════════════════════════════════════════
// 等比缩放是错的：12px 高的小人等比缩下去头只剩 4px，五官全糊。
// 像素画铁律——尺寸越小，特征越要夸张。巨躯插躯干行（重心下压），轻捷删躯干行（chibi 化）。

/** 把行数收回目标高度：优先牺牲顶部空行，其次底部空行，最后才截断（保住鞋底） */
function trimToHeight(rows: string[], h: number): string[] {
  const out = rows.slice();
  const isBlank = (s: string) => !/[^.]/.test(s);
  while (out.length > h && isBlank(out[0])) out.shift();
  while (out.length > h && isBlank(out[out.length - 1])) out.pop();
  while (out.length > h) out.pop();
  while (out.length < h) out.push('.'.repeat(out[0]?.length ?? TPL_W));
  return out;
}

function reshapeByBody(template: string[], body: BodyType): string[] {
  if (body === 'medium') return template;
  const rows = template.slice();
  const H = template.length;
  // 找躯干中段（含 'a' 最多的一行）作为插入/删除锚点
  let torso = Math.floor(H / 2);
  let best = -1;
  for (let i = 4; i < rows.length - 3; i++) {
    const n = (rows[i].match(/a/g) || []).length;
    if (n > best) { best = n; torso = i; }
  }
  switch (body) {
    case 'giant': {
      // v2.8 巨灵：比 titan 更庞大——躯干插 6 行 + 肩部大幅外扩（trim 26，全场最高的生物）
      rows.splice(torso, 0, rows[torso], rows[torso], rows[torso], rows[torso], rows[torso], rows[torso]);
      for (let i = Math.max(0, torso - 3); i < Math.min(rows.length, torso + 8); i++) {
        rows[i] = widen(widen(rows[i]));
      }
      return trimToHeight(rows, 26);
    }
    case 'titan': {
      // v2.3 Boss 专属档：躯干插 4 行 + 肩部大幅外扩 → 屏幕上是一座会动的建筑。
      // 保留插入的 4 行（trim 到 24 而非 H=20），让 Boss 比任何英雄都「高一头」
      rows.splice(torso, 0, rows[torso], rows[torso], rows[torso], rows[torso]);
      for (let i = Math.max(0, torso - 2); i < Math.min(rows.length, torso + 6); i++) {
        rows[i] = widen(widen(rows[i]));
      }
      return trimToHeight(rows, 24);
    }
    case 'obese': {
      // v2.8 肥胖：横向大幅外扩为主（宽厚而非高大），躯干插 2 行保持高度
      rows.splice(torso, 0, rows[torso], rows[torso]);
      for (let i = torso; i < Math.min(rows.length, torso + 6); i++) {
        rows[i] = widen(widen(rows[i]));
      }
      return trimToHeight(rows, H);
    }
    case 'colossal': {
      rows.splice(torso, 0, rows[torso], rows[torso]);
      for (let i = torso; i < Math.min(rows.length, torso + 4); i++) rows[i] = widen(rows[i]);
      return trimToHeight(rows, H);
    }
    case 'heavy': {
      rows.splice(torso, 0, rows[torso]);
      rows[torso] = widen(rows[torso], 'left');
      return trimToHeight(rows, H);
    }
    case 'light': {
      rows.splice(torso, 1);
      rows.push('.'.repeat(template[0].length));
      return rows;
    }
    case 'slim': {
      // v2.8 瘦小：比 light 更纤细——删 1 行 + 每行左右各收窄 1 列（收窄用行内函数，勿动空行）
      rows.splice(torso, 1);
      rows.push('.'.repeat(template[0].length));
      return rows.map((r) => {
        const arr = r.split('');
        const first = arr.findIndex((c) => c !== '.');
        let last = -1;
        for (let i = arr.length - 1; i >= 0; i--) { if (arr[i] !== '.') { last = i; break; } }
        if (first >= 0 && first < arr.length - 1) arr[first] = '.';
        if (last > 0 && last - first > 1) arr[last] = '.';
        return arr.join('');
      });
    }
    case 'petite': {
      // 头部行数不动——头跟着缩就没有「人」了
      rows.splice(torso, 2);
      rows.push('.'.repeat(template[0].length), '.'.repeat(template[0].length));
      return rows;
    }
    case 'gnome': {
      // v2.8 侏儒：比 petite 更矮小——删 3 行（头仍不动，保持「人」的辨识）
      rows.splice(torso, 3);
      rows.push('.'.repeat(template[0].length), '.'.repeat(template[0].length), '.'.repeat(template[0].length));
      return rows;
    }
    default:
      return rows;
  }
}

/** 把一行里最左/最右的实心像素向外扩 1 列 */
function widen(row: string, side: 'both' | 'left' = 'both'): string {
  const arr = row.split('');
  const first = arr.findIndex((c) => c !== '.');
  if (first < 0) return row;
  const last = row.length - 1 - arr.slice().reverse().findIndex((c) => c !== '.');
  if (first > 0) arr[first - 1] = arr[first];
  if (side === 'both' && last < row.length - 1) arr[last + 1] = arr[last];
  return arr.join('');
}

// ══ 离屏光栅化 + 缓存 ════════════════════════════════════════════════
// 一个 (职业, 体型, 敌我, 分身序号, boss) 组合只光栅化一次。
// 缓存画布 1px = 1 模板像素，主循环只做一次 nearest 放大的 drawImage。

const PAD = 2; // 给 bloom 溢出与 boss 外描边留边距
const spriteCache = new Map<string, HTMLCanvasElement>();

interface RasterOpts {
  main: string;    // a
  accent: string;  // b
  glow: string;    // g
  outline: string; // O
  boss: boolean;
  dup: number;
}

function rasterize(tpl: string[], o: RasterOpts): HTMLCanvasElement {
  const w = tpl[0].length, h = tpl.length;
  const cv = document.createElement('canvas');
  cv.width = w + PAD * 2;
  cv.height = h + PAD * 2;
  const g = cv.getContext('2d')!;

  const at = (r: number, c: number) => tpl[r]?.[c] ?? '.';

  // ① Boss 外描边：向八邻溢出一圈暗红，让巨物在混战里始终「压」在其他单位之上
  if (o.boss) {
    g.fillStyle = 'rgba(120,10,14,0.85)';
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        if (at(r, c) === '.') continue;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (at(r + dr, c + dc) !== '.') continue;
            g.fillRect(PAD + c + dc, PAD + r + dr, 1, 1);
          }
        }
      }
    }
  }

  // ② 像素级 bloom：发光索引向四邻溢出半透明亮色（不用 shadowBlur，保持硬像素质感）
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (!GLOW_CHARS.has(at(r, c))) continue;
      const lit = at(r, c) === 'e' ? '#ffffff' : o.glow;
      g.fillStyle = lit;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]) {
        if (at(r + dr, c + dc) !== '.') continue;
        g.globalAlpha = o.boss ? 0.5 : 0.32;
        g.fillRect(PAD + c + dc, PAD + r + dr, 1, 1);
      }
      if (o.boss) {
        // Boss 再补一圈更淡的外辉光，技能未释放时也保持威压
        g.globalAlpha = 0.2;
        for (const [dr, dc] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, 1], [-1, 1], [1, -1]] as [number, number][]) {
          if (at(r + dr, c + dc) !== '.') continue;
          g.fillRect(PAD + c + dc, PAD + r + dr, 1, 1);
        }
      }
      g.globalAlpha = 1;
    }
  }

  // ③ 主体像素
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const ch = at(r, c);
      if (ch === '.') continue;
      let color: string;
      if (ch === 'O') color = o.outline;
      else if (ch === 'a') color = o.main;
      else if (ch === 'b') color = o.accent;
      else if (ch === 'g') color = o.glow;
      else color = MATERIAL[ch] ?? o.main;
      // 三色阶只作用于实体材质：描边参与就会散剪影，发光参与就不亮了
      if (ch !== 'O' && ch !== 'g' && ch !== 'e') color = shade(color, toneAt(tpl, r, c));
      g.fillStyle = color;
      g.fillRect(PAD + c, PAD + r, 1, 1);
    }
  }

  // ④ 同名多份臂章（美术 §4.6）：右上角 N−1 个辅色点，不侵占剪影
  if (o.dup > 1) {
    g.fillStyle = o.accent;
    for (let i = 0; i < Math.min(4, o.dup - 1); i++) {
      g.fillRect(PAD + w - 2 - i * 2, PAD + 1, 1, 1);
    }
  }

  return cv;
}

function getSprite(
  key: string,
  build: () => { tpl: string[]; opts: RasterOpts },
): HTMLCanvasElement {
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const { tpl, opts } = build();
  const cv = rasterize(tpl, opts);
  spriteCache.set(key, cv);
  return cv;
}

/** 五角星（星级标识）。真星形而非方块——方块在 3px 尺度上读起来像噪点 */
function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** 角色动作变换（v2.7）：由 frame.ts 的 computePose 算出，drawSprite 仅作用于身体位图，不影响星级/血条 */
export interface PoseTransform {
  tx?: number;  // 水平位移(px)，正=朝前
  ty?: number;  // 垂直位移(px)，正=下
  rot?: number; // 整体旋转(rad)
  sx?: number;  // 水平缩放（挤压拉伸）
  sy?: number;  // 垂直缩放
}

export interface SpriteOpts {
  bodyType?: BodyType;
  gender?: Gender;        // v2.9.10 性别视觉特征：女性长发马尾、男性短发方颌（叠加绘制，不进缓存位图）
  summonKind?: SummonKind;
  monsterKind?: MonsterKind; // v2.5：西方怪物独立模板（不走职业模板/红染）
  star?: number;          // 头顶星级（1 星不画，美术 §4.6）
  dupIndex?: number;      // 同名多份标记
  outlineUnits?: boolean; // void 主题强制亮边（美术 §3.4.4）
  t?: number;             // 当前时间，用于呼吸发光
  boss?: boolean;         // v2.3：Boss 强化渲染
  pose?: PoseTransform;   // v2.7：动作变换（仅作用于身体位图）
}

export function drawSprite(
  ctx: CanvasRenderingContext2D,
  subclass: SubClass,
  cx: number,
  cy: number,
  sizePx: number,
  enemy = false,
  opts: SpriteOpts = {},
) {
  const body = opts.bodyType ?? 'medium';
  const binfo = BODY_INFO[body];
  const boss = !!opts.boss;

  // 落地投影（美术 §4.5.3）。影子不是重量特权，是「站在地上」的最低成本证据。
  {
    const heavy = !!binfo.shadow;
    ctx.save();
    ctx.globalAlpha = boss ? 0.42 : heavy ? 0.30 : 0.17;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(
      cx, cy + sizePx * 0.44,
      sizePx * (boss ? 0.46 : heavy ? 0.40 : 0.28),
      sizePx * (boss ? 0.15 : heavy ? 0.13 : 0.085),
      0, 0, Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
  }

  const prevSmooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;

  // ── 动作变换（v2.7）：包住身体位图（职业/召唤物/怪物模板统一生效）。
  // 落地投影、星级、描边不受影响——身体倒下时影子留在原地，才是"倒在地上" ──
  if (opts.pose) {
    ctx.save();
    ctx.translate(cx + (opts.pose.tx ?? 0), cy + (opts.pose.ty ?? 0));
    if (opts.pose.rot) ctx.rotate(opts.pose.rot);
    if ((opts.pose.sx ?? 1) !== 1 || (opts.pose.sy ?? 1) !== 1) {
      ctx.scale(opts.pose.sx ?? 1, opts.pose.sy ?? 1);
    }
    ctx.translate(-cx, -cy);
  }

  // ── 身体位图：召唤物 / 西方怪物 / 职业模板 三分支，统一出口 ──
  // （动作变换与 imageSmoothing 恢复只做一次，任意分支画完都走同一出口）
  if (opts.summonKind) {
    const kind = opts.summonKind;
    const pal = SUMMON_PALETTE[kind];
    const cv = getSprite(`sm|${kind}`, () => ({
      tpl: SUMMON_TEMPLATES_PX[kind],
      opts: {
        main: pal.a, accent: shade(pal.a, 0.25), glow: pal.glow,
        outline: pal.o, boss: false, dup: 1,
      },
    }));
    // 咒火灵/影刃仆的核心呼吸：整体轻微透明度脉动，成本为零且一眼能看出「这是临时单位」
    const pulse = kind === 'bulwark' ? 1 : 0.82 + 0.18 * Math.sin((opts.t ?? 0) * Math.PI * 2);
    const scale = sizePx / Math.max(cv.width, cv.height);
    const w = cv.width * scale, h = cv.height * scale;
    ctx.globalAlpha = pulse;
    ctx.drawImage(cv, cx - w / 2, cy - h / 2, w, h);
    ctx.globalAlpha = 1;
  } else if (opts.monsterKind) {
    // 不复用职业模板、不做红染——拥有自己的像素剪影与配色，视觉上完全独立。
    const tpl = MONSTER_TEMPLATES[opts.monsterKind];
    const pal = MONSTER_PALETTE[opts.monsterKind];
    const mbody = opts.bodyType ?? 'medium';
    const mBoss = !!opts.boss; // 龙(titan)/堕天使(colossal) 走 Boss 强化渲染
    const cv = getSprite(`m|${opts.monsterKind}|${mbody}|${mBoss ? 1 : 0}`, () => ({
      tpl: reshapeByBody(tpl, mbody),
      opts: {
        main: pal.a, accent: pal.b, glow: pal.g,
        outline: pal.o, boss: mBoss, dup: 1,
      },
    }));
    const scale = sizePx / TPL_W;
    const w = cv.width * scale, h = cv.height * scale;
    ctx.drawImage(cv, cx - w / 2, cy - h / 2, w, h);
  } else {
    const info = SUBCLASS_INFO[subclass];
    const dup = opts.dupIndex ?? 1;
    const main = enemy ? tintEnemy(info.color) : info.color;
    const accent = enemy ? tintEnemy(info.color2) : info.color2;

    const key = `c|${subclass}|${body}|${enemy ? 1 : 0}|${boss ? 1 : 0}|${Math.min(5, dup)}`;
    const cv = getSprite(key, () => ({
      tpl: reshapeByBody(TEMPLATES[subclass], body),
      opts: {
        main,
        accent,
        // 发光索引统一走辅色提亮：既保持职业识别色，又足够亮到能读成「能量」
        glow: shade(accent, 0.45),
        // selective outline：描边取主色压到 ~12% 明度，而非纯黑
        outline: shade(main, -0.88),
        boss,
        dup,
      },
    }));

    // 缓存画布带 PAD 边距，按边距等比放大，保证角色在格内的相对位置与旧版一致
    const scale = sizePx / TPL_W;
    const w = cv.width * scale, h = cv.height * scale;
    ctx.drawImage(cv, cx - w / 2, cy - h / 2, w, h);

    // v2.9.10 性别视觉特征：叠加绘制（缓存键不含性别），让男女一眼可辨。
    // 女性 = 脑后长发马尾 + 头顶发髻（明确长发剪影）；男性 = 方颌短须（与长发形成对比）。
    // 本地 -x 即「朝后」，外层 ctx.scale(-1,1) 镜像后会自动转到行进反方向。
    if (opts.gender === 'female') {
      const hair = shade(main, -0.42);
      ctx.save();
      ctx.globalAlpha = 0.96;
      ctx.fillStyle = hair;
      ctx.beginPath();
      ctx.ellipse(cx - w * 0.26, cy - h * 0.22, w * 0.10, h * 0.27, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx, cy - h * 0.40, w * 0.14, h * 0.10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (opts.gender === 'male') {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = shade(main, -0.42);
      ctx.fillRect(cx - w * 0.14, cy - h * 0.16, w * 0.28, h * 0.05);
      ctx.restore();
    }
  }

  // 动作变换结束：恢复（投影/星级/描边在变换外绘制）
  if (opts.pose) ctx.restore();
  ctx.imageSmoothingEnabled = prevSmooth;

  // void 主题：单位强制 1px 亮边（深紫单位在深紫背景上必糊，唯一需要特判的主题）
  if (opts.outlineUnits) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    const px = sizePx / TPL_W;
    ctx.strokeRect(cx - sizePx / 2 + px * 2.5, cy - sizePx / 2 + px * 1.5, sizePx - px * 5, sizePx - px * 3);
    ctx.restore();
  }

  // 星级标识（美术 §4.6）：只在偏离默认时给信息——1 星不画，否则屏幕顶部糊满金点
  const star = opts.star ?? 1;
  if (star >= 2) {
    const sr = 2.6, gap = 1.6;
    const step = sr * 2 + gap;
    const total = star * step - gap;
    const sy = cy - sizePx / 2 - 4;
    ctx.save();
    ctx.shadowColor = 'rgba(255,210,63,0.9)';
    ctx.shadowBlur = star >= 5 ? 6 : 3;
    for (let i = 0; i < star; i++) {
      const sx = cx - total / 2 + sr + i * step;
      drawStar(ctx, sx, sy, sr, star >= 5 ? '#ffe98a' : '#ffd23f');
    }
    ctx.restore();
  }
}

// ══ 坐骑渲染（v2.6 §2）════════════════════════════════════════════════
// 骑手与坐骑分两次 drawImage，而不是做 5×9=45 张"人马合一"的合成模板。
// 理由很直接：合成模板的维护成本是乘法级的，而分层只有加法级；
// 更关键的是分层让「骑手出手」与「坐骑迈步」可以各自动，合成图做不到。
//
// 绘制约定：坐骑贴图始终朝右，朝左由调用方 ctx.scale(-1,1) 镜像。
// cx/cy 是**骑手的中心点**，坐骑自己往下沉 —— 这样调用方不需要关心两者的对位。

export interface MountDrawOpts {
  t?: number;        // 当前时间，驱动步态
  moving?: boolean;  // 移动中：四蹄上下错相摆动
  ready?: boolean;   // 坐骑技能已就绪：脚下一圈呼吸辉光（玩家要能预判大招）
  rarity?: MountRarity; // v2.9.3 坐骑品质：脚下品质光环（蓝/橙/紫）+ 鞍鞯点缀
  casting?: boolean; // v2.9.10 施法蓄势：躯干后仰 + 微抬，呼应"发大招"的顿挫（只作用于坐骑本体）
}

// v2.9.3 坐骑专属步态：五兽各自的速度与起伏（战象低沉、赤兔疾驰、玄豹弹跳……）
// v2.9.10 整体上调幅度，使坐骑起伏接近徒步角色的生动程度（此前坐骑只有轻微上下浮动）
const MOUNT_GAIT: Record<MountKind, { freq: number; amp: number; bounce: number }> = {
  elephant: { freq: 5.5, amp: 0.032, bounce: 0.006 },  // 沉稳如鼓
  leopard:  { freq: 11,  amp: 0.050, bounce: 0.040 },  // 轻快弹跳
  tiger:    { freq: 7.5, amp: 0.038, bounce: 0.018 },  // 肌肉起伏
  redhare:  { freq: 14,  amp: 0.056, bounce: 0.030 },  // 疾驰生风
  ox:       { freq: 6.5, amp: 0.030, bounce: 0.012 },  // 沉重碾地
};

/** 坐骑贴图相对骑手 renderPx 的宽度倍率。战象最壮、玄豹最修长 */
const MOUNT_SCALE: Record<MountKind, number> = {
  elephant: 1.55, leopard: 1.42, tiger: 1.46, redhare: 1.50, ox: 1.48,
};

/** 骑手相对坐骑背脊的上抬量（占骑手 renderPx 的比例） */
export const MOUNT_RIDER_LIFT: Record<MountKind, number> = {
  elephant: 0.40, leopard: 0.24, tiger: 0.28, redhare: 0.34, ox: 0.32,
};

export function drawMount(
  ctx: CanvasRenderingContext2D,
  kind: MountKind,
  cx: number,
  cy: number,
  riderPx: number,
  opts: MountDrawOpts = {},
) {
  const def = MOUNTS[kind];
  const t = opts.t ?? 0;
  const w = riderPx * MOUNT_SCALE[kind];
  const h = w * (MOUNT_TPL_H / MOUNT_TPL_W);

  const cv = getSprite(`mt|${kind}`, () => ({
    tpl: MOUNT_TEMPLATES[kind],
    opts: {
      main: def.body,
      accent: def.accent,
      glow: shade(def.accent, 0.35),
      outline: def.dark,
      boss: false,
      dup: 1,
    },
  }));

  // 坐骑落地影：比徒步单位更大更实——多了 400 公斤，影子必须跟上，否则像贴纸浮在地面
  ctx.save();
  ctx.globalAlpha = 0.34;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(cx, cy + h * 0.46, w * 0.40, h * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 技能就绪辉光：坐骑技能是独立 CD，玩家没有任何 UI 能看到它，
  // 只能靠脚下这圈光判断「下一秒会不会有大动作」
  if (opts.ready) {
    ctx.save();
    ctx.globalAlpha = 0.22 + 0.16 * Math.sin(t * 4);
    ctx.strokeStyle = def.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy + h * 0.46, w * 0.44, h * 0.17, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // v2.9.3 坐骑品质光环：蓝/橙/紫——脚下常驻品质色呼吸圈（含技能辉光叠加，可读性优先）
  // 步态：v2.9.3 五兽专属（移动 vs 静止），替换旧版统一 11Hz
  const g = MOUNT_GAIT[kind];
  // v2.9.10 动作升级：在垂直起伏之上叠加①移动前倾（躯干朝行进方向前压）②小跑侧摆
  // ③施法仰首（后仰 + 微抬）。前倾/仰首只作用于坐骑本体（绕足底为轴旋转），
  // 脚下光环与落地影保持贴地不动——物理上才对。本地 +x 即行进方向（外层已随朝向镜像）。
  let lean = 0;     // 躯干俯仰（弧度，+前倾 / −仰首）
  let swayX = 0;    // 小跑侧摆（像素）
  let hop = 0;      // 仰首时的整体微抬
  if (opts.casting) {
    lean = -0.20;
    hop = -h * 0.05;
  } else if (opts.moving) {
    lean = 0.08 + Math.sin(t * g.freq * 0.5) * 0.02;
    swayX = Math.sin(t * g.freq) * w * 0.012;
  }
  const gait = opts.moving
    ? Math.sin(t * g.freq) * h * g.amp + Math.abs(Math.sin(t * g.freq * 0.5)) * h * g.bounce
    : Math.sin(t * 2.0) * h * 0.012;

  if (opts.rarity) {
    const rc = MOUNT_RARITY[opts.rarity].color;
    ctx.save();
    ctx.globalAlpha = 0.30 + 0.10 * Math.sin(t * 3);
    ctx.strokeStyle = rc;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy + h * 0.47, w * 0.50, h * 0.18, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 坐骑本体（含鞍鞯点缀）绕足底为轴施加前倾/仰首 + 侧摆；脚下光环不在此变换内
  const feetY = cy + h * 0.46;
  ctx.save();
  if (lean !== 0 || swayX !== 0) {
    ctx.translate(cx + swayX, feetY);
    ctx.rotate(lean);
    ctx.translate(-(cx + swayX), -feetY);
  }
  // 鞍鞯点缀色（坐骑背上一小块品质色，跟随坐骑本体一起倾摆）
  if (opts.rarity) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = MOUNT_RARITY[opts.rarity].color;
    ctx.fillRect(cx + swayX - w * 0.06, cy + gait + hop - h * 0.02, w * 0.12, h * 0.05);
    ctx.restore();
  }
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  const scale = w / MOUNT_TPL_W;
  const dw = cv.width * scale, dh = cv.height * scale;
  ctx.drawImage(cv, cx + swayX - dw / 2, cy + gait + hop - dh / 2, dw, dh);
  ctx.imageSmoothingEnabled = prev;
  ctx.restore();
}

// ══ 敌方补给建筑渲染（v2.6 §3）═════════════════════════════════════════
// 建筑不吃 reshapeByBody（它不是生物，拉伸躯干只会变形），也不吃敌方红染
// （红染会把六种建筑压成同一坨暗红，玩家就分不出「这栋会出兵」和「这栋会打我」）。
// 取而代之的是：每类建筑自带配色 + 一圈敌意红地基环，阵营信息由地基承担。

export interface BuildingDrawOpts {
  t?: number;
  hpFrac?: number;   // 剩余血量比例，驱动"结构受损"表现
  ready?: boolean;   // 即将产兵（<1.5s）：顶部预警脉冲
}

export function drawBuilding(
  ctx: CanvasRenderingContext2D,
  kind: BuildingKind,
  cx: number,
  cy: number,
  sizePx: number,
  opts: BuildingDrawOpts = {},
) {
  const def = BUILDINGS[kind];
  const t = opts.t ?? 0;
  const hpFrac = opts.hpFrac ?? 1;

  const cv = getSprite(`bd|${kind}`, () => ({
    tpl: BUILDING_TEMPLATES[kind],
    opts: {
      main: def.color,
      accent: def.accent,
      glow: shade(def.accent, 0.4),
      outline: def.dark,
      boss: false,
      dup: 1,
    },
  }));

  // 地基阴影：建筑是"压"在地上的，投影比同尺寸单位更大更暗
  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(cx, cy + sizePx * 0.46, sizePx * 0.44, sizePx * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;

  // 受损：整体下沉 + 压暗。硬拆到一半的塔必须"看起来快塌了"，
  // 否则玩家永远不知道该不该再补一轮输出还是转火
  const sink = (1 - hpFrac) * sizePx * 0.05;
  const scale = sizePx / BUILDING_TPL_SIZE;
  const dw = cv.width * scale, dh = cv.height * scale;
  ctx.drawImage(cv, cx - dw / 2, cy + sink - dh / 2, dw, dh);

  if (hpFrac < 0.99) {
    ctx.globalAlpha = (1 - hpFrac) * 0.42;
    ctx.fillStyle = '#000000';
    ctx.fillRect(cx - dw / 2, cy + sink - dh / 2, dw, dh);
    ctx.globalAlpha = 1;
  }
  ctx.imageSmoothingEnabled = prev;

  // 濒危余烬：血量 <35% 时基座冒橙火星。这是"再打两下就倒"的最后一次提示
  if (hpFrac < 0.35) {
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const ph = t * 1.8 + i * 0.7;
      const k = ph - Math.floor(ph);
      ctx.globalAlpha = (1 - k) * 0.7;
      ctx.fillStyle = k < 0.5 ? '#ffd23f' : '#ff7a2a';
      const ex = cx + Math.sin(ph * 5 + i) * sizePx * 0.24;
      const ey = cy + sizePx * 0.36 - k * sizePx * 0.5;
      ctx.fillRect(ex, ey, 2, 2);
    }
    ctx.restore();
  }

  // 敌意地基环：六种建筑配色各异，阵营归属统一由这圈红环承担
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = '#ff4a4a';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.ellipse(cx, cy + sizePx * 0.46, sizePx * 0.46, sizePx * 0.15, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // 产兵预警：出兵前 1.5 秒顶部亮起脉冲。产兵器最忌讳"凭空冒兵"，
  // 玩家必须有一个提前量去决定是继续拆还是先转火接兵
  if (opts.ready && def.spawn) {
    ctx.save();
    ctx.globalAlpha = 0.45 + 0.45 * Math.sin(t * 12);
    ctx.fillStyle = def.accent;
    ctx.beginPath();
    ctx.arc(cx, cy - sizePx * 0.5, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
