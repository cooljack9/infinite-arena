var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// packages/core/src/types.ts
var GROWTH_STAT_KEYS = ["hp", "pDmg", "mDmg", "heal"];
var PRIMARY_KEYS = ["con", "str", "agi", "int"];

// packages/core/src/contract/index.ts
var CORE_VERSION = "2.2.0";
var ok = (data) => ({ ok: true, data, coreVersion: CORE_VERSION });
var err = (code, message = code) => ({ ok: false, code, message, coreVersion: CORE_VERSION });

// packages/core/src/engine/rng.ts
function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}
function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}
function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// packages/core/src/engine/detmath.ts
var _dv = new DataView(new ArrayBuffer(8));
function pow2i(e) {
  if (e >= -1022 && e <= 1023) {
    _dv.setUint32(0, e + 1023 << 20 >>> 0, false);
    _dv.setUint32(4, 0, false);
    return _dv.getFloat64(0, false);
  }
  if (e > 1023) return pow2i(1023) * pow2i(e - 1023);
  return pow2i(-1022) * pow2i(e + 1022);
}
function frexp(x) {
  let v = x;
  let bias = 0;
  if (v < 22250738585072014e-324) {
    v *= 9007199254740992;
    bias = -53;
  }
  _dv.setFloat64(0, v, false);
  const hi = _dv.getUint32(0, false);
  const e = (hi >>> 20 & 2047) - 1022;
  _dv.setUint32(0, (hi & 2148532223 | 1022 << 20) >>> 0, false);
  return { m: _dv.getFloat64(0, false), e: e + bias };
}
var PIO2_HI = 1.5707963267341256;
var PIO2_LO = 6077100506506192e-26;
var TWO_OVER_PI = 0.6366197723675814;
var S1 = -0.16666666666666632;
var S2 = 0.00833333333332249;
var S3 = -1984126982985795e-19;
var S4 = 27557313707070068e-22;
var S5 = -25050760253406863e-24;
var S6 = 158969099521155e-24;
var C1 = 0.0416666666666666;
var C2 = -0.001388888888887411;
var C3 = 2480158728947673e-20;
var C4 = -27557314351390663e-23;
var C5 = 2087572321298175e-24;
var C6 = -11359647557788195e-27;
function kSin(x) {
  const z = x * x;
  return x + x * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
}
function kCos(x) {
  const z = x * x;
  return 1 - 0.5 * z + z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
}
function reduce(x) {
  const k = Math.round(x * TWO_OVER_PI);
  const r = x - k * PIO2_HI;
  return { r: r - k * PIO2_LO, q: (k % 4 + 4) % 4 };
}
function dsin(x) {
  if (!Number.isFinite(x)) return NaN;
  const { r, q } = reduce(x);
  switch (q) {
    case 0:
      return kSin(r);
    case 1:
      return kCos(r);
    case 2:
      return -kSin(r);
    default:
      return -kCos(r);
  }
}
function dcos(x) {
  if (!Number.isFinite(x)) return NaN;
  const { r, q } = reduce(x);
  switch (q) {
    case 0:
      return kCos(r);
    case 1:
      return -kSin(r);
    case 2:
      return -kCos(r);
    default:
      return kSin(r);
  }
}
var LOG2E = 1.4426950408889634;
var LN2 = 0.6931471805599453;
var SQRT1_2 = 0.7071067811865476;
function dlog(x) {
  const { m: m0, e: e0 } = frexp(x);
  const m = m0 < SQRT1_2 ? m0 * 2 : m0;
  const e = m0 < SQRT1_2 ? e0 - 1 : e0;
  const t = (m - 1) / (m + 1);
  const t2 = t * t;
  const s = 1 + t2 * (1 / 3 + t2 * (1 / 5 + t2 * (1 / 7 + t2 * (1 / 9 + t2 * (1 / 11 + t2 * (1 / 13 + t2 * (1 / 15 + t2 * (1 / 17 + t2 * (1 / 19 + t2 * (1 / 21))))))))));
  return 2 * t * s + e * LN2;
}
function dexp(z) {
  const n = Math.round(z * LOG2E);
  const f = z - n * LN2;
  const e = 1 + f * (1 + f * (1 / 2 + f * (1 / 6 + f * (1 / 24 + f * (1 / 120 + f * (1 / 720 + f * (1 / 5040 + f * (1 / 40320 + f * (1 / 362880 + f * (1 / 3628800 + f * (1 / 39916800 + f * (1 / 479001600))))))))))));
  return e * pow2i(n);
}
function dpowi(base2, n) {
  let e = n < 0 ? -n : n;
  let b = base2;
  let r = 1;
  while (e > 0) {
    if (e & 1) r *= b;
    b *= b;
    e >>>= 1;
  }
  return n < 0 ? 1 / r : r;
}
function dpow(x, y) {
  if (y === 0) return 1;
  if (y === 1) return x;
  if (y === 2) return x * x;
  if (y === -1) return 1 / x;
  if (x === 1) return 1;
  if (y === 0.5) return Math.sqrt(x);
  if (y === -0.5) return 1 / Math.sqrt(x);
  if (Number.isInteger(y) && y >= -1024 && y <= 1024) return dpowi(x, y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Math.pow(x, y);
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x < 0) return NaN;
  return dexp(y * dlog(x));
}
function drot(x, y, theta) {
  const c = dcos(theta), s = dsin(theta);
  return { x: x * c - y * s, y: x * s + y * c };
}
var DEG = Math.PI / 180;

// packages/core/src/content/arenas.ts
var A1 = {
  id: "A1",
  name: "\u5706\u5F62\u7ADE\u6280\u573A",
  width: 20,
  height: 13,
  tiles: [
    "####################",
    "#..................#",
    "#..................#",
    "#..................#",
    "#..S...........E...#",
    "#..................#",
    "#..................#",
    "#..................#",
    "#..................#",
    "#..................#",
    "#..................#",
    "#..................#",
    "####################"
  ]
};
var A3 = {
  id: "A3",
  name: "\u7ACB\u67F1\u8FF7\u5BAB",
  width: 20,
  height: 13,
  tiles: [
    "####################",
    "#..................#",
    "#...P......P.......#",
    "#..................#",
    "#......P.......P...#",
    "#..S...........E...#",
    "#..................#",
    "#...P.......P......#",
    "#..................#",
    "#......P.......P...#",
    "#..................#",
    "#..................#",
    "####################"
  ]
};
var A6 = {
  id: "A6",
  name: "\u5BF9\u79F0\u89D2\u6597\u573A",
  width: 20,
  height: 13,
  tiles: [
    "####################",
    "#..................#",
    "#..................#",
    "#..S..........E....#",
    "#..................#",
    "#.......BBBB.......#",
    "#.......BBBB.......#",
    "#..................#",
    "#..................#",
    "#..................#",
    "#..................#",
    "#..................#",
    "####################"
  ]
};
var W = 20;
var H = 13;
var setCh = (row, c, ch) => row.slice(0, c) + ch + row.slice(c + 1);
var blankTiles = () => {
  const rows = [];
  for (let r = 0; r < H; r++) {
    let row = "";
    for (let c = 0; c < W; c++) row += r === 0 || r === H - 1 || c === 0 || c === W - 1 ? "#" : ".";
    rows.push(row);
  }
  return rows;
};
var scatterProps = (tiles, rng, count, skipRows = []) => {
  let guard = 0;
  let placed = 0;
  while (placed < count && guard++ < 400) {
    const r = 1 + Math.floor(rng() * (H - 2));
    const c = 1 + Math.floor(rng() * (W - 2));
    if (skipRows.includes(r)) continue;
    if (tiles[r][c] === ".") {
      tiles[r] = setCh(tiles[r], c, "P");
      placed++;
    }
  }
};
var scatterChar = (tiles, rng, ch, count, skipRows = []) => {
  let guard = 0;
  let placed = 0;
  while (placed < count && guard++ < 400) {
    const r = 1 + Math.floor(rng() * (H - 2));
    const c = 1 + Math.floor(rng() * (W - 2));
    if (skipRows.includes(r)) continue;
    if (tiles[r][c] === ".") {
      tiles[r] = setCh(tiles[r], c, ch);
      placed++;
    }
  }
};
var placeSpawn = (tiles, rng, ch, rowBand) => {
  const r = rowBand[Math.floor(rng() * rowBand.length)];
  const cands = [];
  for (let c2 = 1; c2 < W - 1; c2++) if (tiles[r][c2] === ".") cands.push(c2);
  if (!cands.length) return;
  const c = cands[Math.floor(rng() * cands.length)];
  tiles[r] = setCh(tiles[r], c, ch);
};
function genArena(kind, seed) {
  const rng = mulberry32((seed + 7) * 2654435761 >>> 0);
  let tiles = blankTiles();
  let name = "";
  let dragonNests;
  switch (kind) {
    case "RIVER": {
      name = "\u695A\u6CB3\u6C49\u754C";
      const riverRows = 2 + Math.floor(rng() * 3);
      const riverTop = 5 + Math.floor(rng() * 2);
      for (let r = riverTop; r < Math.min(H - 1, riverTop + riverRows); r++) {
        for (let c = 1; c < W - 1; c++) tiles[r] = setCh(tiles[r], c, "~");
      }
      const bridges = rng() < 0.5 ? [5, 14] : [6, 13];
      for (const bc of bridges) {
        for (let r = riverTop; r < Math.min(H - 1, riverTop + riverRows); r++) tiles[r] = setCh(tiles[r], bc, ".");
      }
      scatterProps(tiles, rng, 8, [riverTop - 1, riverTop, riverTop + 1, riverTop + 2]);
      scatterChar(tiles, rng, "w", 5, [riverTop - 1, riverTop, riverTop + 1, riverTop + 2]);
      placeSpawn(tiles, rng, "S", [2, 3]);
      placeSpawn(tiles, rng, "E", [H - 3, H - 4]);
      break;
    }
    case "JIANGE": {
      name = "\u5251\u9601";
      const mode = rng() < 0.5 ? "single" : "double";
      const cols = [7, 8, 9, 10, 11];
      for (let r = 1; r < H - 1; r++) for (const c of cols) tiles[r] = setCh(tiles[r], c, "#");
      if (mode === "single") {
        for (const c of cols) tiles[6] = setCh(tiles[6], c, ".");
      } else {
        for (const c of cols) {
          tiles[2] = setCh(tiles[2], c, ".");
          tiles[10] = setCh(tiles[10], c, ".");
        }
      }
      scatterProps(tiles, rng, 4, [6]);
      placeSpawn(tiles, rng, "S", [6]);
      placeSpawn(tiles, rng, "E", [6]);
      break;
    }
    case "DRAGON": {
      name = "\u75AF\u72C2\u9F99\u5DE2";
      scatterProps(tiles, rng, 10);
      scatterChar(tiles, rng, "M", 3);
      placeSpawn(tiles, rng, "S", [2, 3]);
      placeSpawn(tiles, rng, "E", [H - 3, H - 4]);
      dragonNests = 3 + Math.floor(rng() * 3);
      break;
    }
    case "CAGE": {
      name = "\u771F\u7537\u4EBA\u516B\u89D2\u7B3C";
      tiles = [];
      for (let r = 0; r < H; r++) {
        let row = "";
        for (let c = 0; c < W; c++) {
          const border = r === 0 || r === H - 1 || c === 0 || c === W - 1;
          const cage = r >= 4 && r <= 8 && c >= 7 && c <= 12;
          row += border ? "#" : cage ? "." : "~";
        }
        tiles.push(row);
      }
      tiles[4] = setCh(tiles[4], 7, "S");
      tiles[8] = setCh(tiles[8], 12, "E");
      break;
    }
    case "VAN": {
      name = "\u9762\u5305\u8F66\u505C\u8F66\u573A";
      scatterProps(tiles, rng, 6);
      scatterChar(tiles, rng, "w", 4);
      placeSpawn(tiles, rng, "S", [2, 3]);
      placeSpawn(tiles, rng, "E", [H - 3, H - 4]);
      break;
    }
    default:
      name = "\u7ADE\u6280\u573A";
  }
  const arena = { id: kind, name, width: W, height: H, tiles };
  if (dragonNests !== void 0) arena.dragonNests = dragonNests;
  if (kind === "RIVER") {
    arena.hazardBase = "#0d3a6e";
    arena.hazardWave = "rgba(120,200,255,0.38)";
  }
  if (kind === "CAGE") {
    arena.hazardBase = "#3a0d05";
    arena.hazardWave = "rgba(255,120,40,0.45)";
  }
  return arena;
}
var ARENAS = {
  A1,
  A3,
  A6,
  RIVER: genArena("RIVER", 1),
  JIANGE: genArena("JIANGE", 1),
  DRAGON: genArena("DRAGON", 1),
  CAGE: genArena("CAGE", 1),
  VAN: genArena("VAN", 1)
};
var ARENA_LIST = [
  A1,
  A3,
  A6,
  genArena("RIVER", 1),
  genArena("RIVER", 2),
  genArena("RIVER", 3),
  genArena("JIANGE", 1),
  genArena("JIANGE", 2),
  genArena("DRAGON", 1),
  genArena("DRAGON", 2),
  genArena("CAGE", 1),
  genArena("CAGE", 2),
  genArena("VAN", 1),
  genArena("VAN", 2)
];
var WEATHER_BY_THEME = {
  sandstone: { kind: "sandstone", cn: "\u98CE\u6C99", icon: "\u{1F32A}", moveSpeedAdd: 20 },
  // 移速 +20%（v1.1.0 原 +10%）
  frost: { kind: "frost", cn: "\u971C\u5BD2", icon: "\u2744", atkSpeedAdd: -24 },
  // 攻击间隔 +24%（atkSpeed -24，v1.1.0 原 -12）
  magma: { kind: "magma", cn: "\u7194\u706B", icon: "\u{1F525}", dmgMul: 1.24 },
  // 伤害 +24%（v1.1.0 原 +12%）
  void: { kind: "void", cn: "\u865A\u7A7A\u4FB5\u8680", icon: "\u{1F30C}", critAdd: 16 },
  // 暴击 +16%（v1.1.0 原 +8%）
  verdant: { kind: "verdant", cn: "\u4E30\u8302", icon: "\u{1F33F}", regenPct: 0.024 },
  // 每秒回复 2.4% 最大生命（v1.1.0 原 1.2%）
  sanctum: { kind: "sanctum", cn: "\u5723\u5149", icon: "\u2728", dmgTakenMul: 0.76 }
  // 受到伤害 -24%（v1.1.0 原 -12%）
};
var THEME_ORDER = ["sandstone", "frost", "magma", "void", "verdant", "sanctum"];
var THEME_SPAN = 10;
var CYCLE_LEN = THEME_ORDER.length * THEME_SPAN;
var MAX_FADE_CYCLE = 4;
function themeForDepth(depth) {
  const idx = Math.floor((depth - 1) % CYCLE_LEN / THEME_SPAN);
  return THEME_ORDER[Math.max(0, Math.min(THEME_ORDER.length - 1, idx))];
}
function fadeCycleForDepth(depth) {
  return Math.min(MAX_FADE_CYCLE, Math.floor((depth - 1) / CYCLE_LEN));
}
function withTheme(arena, depth) {
  const theme = themeForDepth(depth);
  return {
    ...arena,
    theme,
    fade: fadeCycleForDepth(depth),
    weather: WEATHER_BY_THEME[theme],
    // v1.5：天气由主题推导，随层深循环确定性生成
    layer: depth
    // 反"堆一人"：敌方针对最强被动按层调度（battle.ts 读取）
  };
}
function parseSpawns(arena) {
  const ally = [];
  const enemy = [];
  let boss;
  for (let r = 0; r < arena.tiles.length; r++) {
    for (let c = 0; c < arena.tiles[r].length; c++) {
      const ch = arena.tiles[r][c];
      const p = { x: c + 0.5, y: r + 0.5 };
      if (ch === "S") ally.push(p);
      else if (ch === "E") enemy.push(p);
      else if (ch === "B") boss = p;
    }
  }
  return { ally, enemy, boss };
}

// packages/core/src/engine/scaling.ts
var CFG = { knee: 20, linHp: 0.08, linDmg: 0.06, expHp: 0.5, expDmg: 0.5 };
function enemyScale(n) {
  const k = CFG.knee;
  if (n <= k) return { hp: 1 + CFG.linHp * n, dmg: 1 + CFG.linDmg * n };
  const baseHp = 1 + CFG.linHp * k;
  const baseDmg = 1 + CFG.linDmg * k;
  const rHp = dpow(n / k, CFG.expHp);
  const rDmg = dpow(n / k, CFG.expDmg);
  return { hp: baseHp * rHp, dmg: baseDmg * rDmg };
}
var isVacuum = (n) => n % 10 === 0;
var isMutation = (n) => n % 10 === 0;
function segmentMult(n) {
  return Math.min(1.9, 1 + 8e-3 * Math.max(0, n - 1));
}
function bossTierAt(n, mode) {
  if (mode === "novice") return n >= NOVICE_CAP ? "normal" : void 0;
  if (n % 5 === 0) return "strong";
  if (n % 3 === 0) return "normal";
  return void 0;
}
var DEMO_CAP = 30;
var NOVICE_CAP = 10;
var ENDLESS_CAP = 500;
function capFor(mode) {
  return mode === "novice" ? NOVICE_CAP : ENDLESS_CAP;
}

// packages/core/src/content/skills.ts
var SKILL_VFX = {
  bulwark_taunt: { color: "#4d7cff", sizeMul: 1.45, motion: "expand_ring" },
  bulwark_shield: { color: "#b06bff", sizeMul: 1.2, motion: "shield_pulse" },
  charge_dash: { color: "#ff4d3d", sizeMul: 1.35, motion: "charge_wedge" },
  melee_burst: { color: "#cfe3ff", sizeMul: 1.5, motion: "nova_spin" },
  projectile_volley: { color: "#ffae3d", sizeMul: 1.3, motion: "volley_scatter" },
  precision_beam: { color: "#ffcf4d", sizeMul: 1.2, motion: "beam_split" },
  zone_control: { color: "#7fe0d8", sizeMul: 1.45, motion: "taiji_spin" },
  summon_rift: { color: "#c79a5a", sizeMul: 1.35, motion: "rift_tear" },
  blessing_field: { color: "#4fd982", sizeMul: 1.45, motion: "blessing_vine" },
  van_ram: { color: "#ffcf3d", sizeMul: 1.4, motion: "charge_wedge" }
  // v2.9.x 面包车撞击
};
var BOSS_VFX_OVERRIDE = {
  boss_stomp: { color: "#ff1f1f", sizeMul: 1.65 },
  // v2.3 更红更大：践踏是 Boss 招牌，必须全场最炸
  boss_devour: { color: "#ff2e6a", sizeMul: 1.4 },
  // 吞噬：品红深渊感，比 stom 更「邪」
  boss_split: { color: "#ff3b3b", sizeMul: 1.55 },
  // 分裂：裂痕红色，配合 colossal 分身
  m_dragon_skill: { color: "#ff3b1f", sizeMul: 1.7 },
  // v2.5 西方邪龙：焚世龙息，赤红灼烧感
  m_angel_skill: { color: "#ffd23f", sizeMul: 1.45 }
  // v2.5 堕天审判：审判金光，神圣而压迫
};
function vfxOf(skill, isBoss) {
  const style = skill.skillStyle ?? "melee_burst";
  const base2 = SKILL_VFX[style];
  if (isBoss && BOSS_VFX_OVERRIDE[skill.id]) {
    const o = BOSS_VFX_OVERRIDE[skill.id];
    return { color: o.color, sizeMul: o.sizeMul, motion: base2.motion };
  }
  return base2;
}
var SKILLS = {
  taunt: { id: "taunt", name: "\u9547\u5CB3\u6012\u543C", cd: 8, damageType: "physical", desc: "\u6012\u543C\u9707\u6151 3 \u683C\u5185\u654C\u4EBA 3 \u79D2\uFF0C\u81EA\u8EAB\u51CF\u4F24\u63D0\u5347", skillStyle: "bulwark_taunt", castRange: 3 },
  ward: { id: "ward", name: "\u7B26\u7532\u62A4\u76FE", cd: 10, damageType: "magic", desc: "\u51DD\u7B26\u4E3A\u7532\uFF0C\u83B7\u5F97\u5438\u6536\u62A4\u76FE\uFF0C\u53CD\u5F39\u90E8\u5206\u9B54\u4F24", skillStyle: "bulwark_shield", castRange: 0 },
  charge: { id: "charge", name: "\u5043\u6708\u7A81\u65A9", cd: 6, damageType: "physical", desc: "\u62D6\u5200\u7A81\u8FDB 6 \u683C\u5185\u6700\u8FDC\u654C\u4EBA\uFF0C250%\u7269\u4F24+\u66551\u79D2", skillStyle: "charge_dash", castRange: 6 },
  hexburst: { id: "hexburst", name: "\u65E0\u5F62\u5251\u7F61", cd: 7, damageType: "hybrid", desc: "\u5468\u8EAB 2.5 \u683C AoE\uFF1A90%\u7269\u653B + 130%\u9B54\u653B\u6DF7\u4F24", skillStyle: "melee_burst", castRange: 2.5 },
  barrage: { id: "barrage", name: "\u795E\u706B\u9739\u96F3", cd: 5, damageType: "physical", desc: "5 \u8FDE\u5C04 80%\u7269\u4F24\uFF0C\u547D\u4E2D 6 \u683C\u5185\u968F\u673A\u654C\u4EBA", skillStyle: "projectile_volley", castRange: 6 },
  deadshot: { id: "deadshot", name: "\u8D2F\u65E5\u795E\u5C04", cd: 9, damageType: "physical", desc: "9 \u683C\u5185\u5355\u4F53 400%\u7269\u4F24\uFF0C\u84C4\u529B\u8D2F\u65E5\u4E00\u51FB", skillStyle: "precision_beam", castRange: 9 },
  timelock: { id: "timelock", name: "\u592A\u6781\u5C01\u7981", cd: 12, damageType: "magic", desc: "\u592A\u6781\u516B\u5366\u9501 6 \u683C\u5185\u654C\u4EBA 2.5 \u79D2 + 120%\u9B54\u4F24", skillStyle: "zone_control", castRange: 6 },
  summon: { id: "summon", name: "\u629F\u571F\u5316\u751F", cd: 14, damageType: "magic", desc: "\u6309\u6218\u51B5\u634F\u51FA\u6CE5\u536B/\u85E4\u7532\u4EC6/\u7075\u706B\u7AE5\u4E4B\u4E00", skillStyle: "summon_rift", castRange: 5 },
  groupheal: { id: "groupheal", name: "\u9752\u85E4\u56DE\u6625", cd: 10, damageType: "magic", desc: "\u6CBB\u7597 5 \u683C\u5185\u961F\u53CB 200%\u667A\u529B\uFF0C\u9752\u85E4\u7ED5\u8EAB\u56DE\u8840", skillStyle: "blessing_field", castRange: 5 },
  // Boss 技（美术 §7.2.1）：不新开风格枚举，从 9 种里复用。
  // 玩家已经用 9 个签名技学会了这套视觉词汇，Boss 复用等于认知直接迁移；
  // Boss 的压迫感该来自数值和尺寸，不该来自玩家看不懂。
  boss_stomp: { id: "boss_stomp", name: "\u6CF0\u5C71\u538B\u9876", cd: 8, damageType: "physical", desc: "3.5 \u683C\u5185 300%\u7269\u4F24 + \u51FB\u9000", skillStyle: "bulwark_taunt", castRange: 3.5 },
  boss_devour: { id: "boss_devour", name: "\u566C\u9B42", cd: 10, damageType: "magic", desc: "\u5438\u53D6 8 \u683C\u5185\u654C\u65B9 10%\u6700\u5927\u751F\u547D", skillStyle: "zone_control", castRange: 8 },
  boss_split: { id: "boss_split", name: "\u88C2\u9B42\u5206\u8EAB", cd: 12, damageType: "physical", desc: "\u56DE\u590D 20% \u751F\u547D\u5E76\u5206\u88C2\u51FA 2 \u4E2A\u5206\u8EAB\uFF088s\uFF09", skillStyle: "summon_rift", castRange: 0 }
};
var SUBCLASS_SKILL = {
  physTank: "taunt",
  magicTank: "ward",
  charge: "charge",
  hexblade: "hexburst",
  gunner: "barrage",
  sniper: "deadshot",
  controller: "timelock",
  summoner: "summon",
  healer: "groupheal"
};
function rangeTier(castRange = 0) {
  if (castRange <= 1.5) return "self";
  if (castRange <= 3.5) return "short";
  if (castRange <= 6.5) return "mid";
  return "long";
}
var TIER_TTL = {
  self: 0.65,
  // 内缩汇聚 → 成型过冲 → 脉动（加长，存在感更足）
  short: 0.62,
  // 顿地 → 瞬时外扩（无飞行段，近战爽感来自零延迟）
  mid: 0.85,
  // 发射闪光 → 可见飞行体 → 落点小爆
  long: 1.1
  // 预警细线 0.22s → 瞬时激光 → 残线滞留更久
};
var LONG_WARN_TIME = 0.22;
var beamThickness = (castRange) => 3 + castRange * 0.45;

// packages/core/src/content/classes.ts
var SUBCLASS_INFO = {
  physTank: { category: "tank", role: "tank", name: "physTank", cn: "\u7384\u6B66\u524D\u6392", damageType: "physical", attackRange: 1.1, color: "#5a7bd6", color2: "#c9d4ff", defaultBody: "colossal" },
  magicTank: { category: "tank", role: "tank", name: "magicTank", cn: "\u7B26\u7532\u6218\u5C06", damageType: "magic", attackRange: 1.1, color: "#b06bff", color2: "#e0c9ff", defaultBody: "heavy" },
  charge: { category: "warrior", role: "dps", name: "charge", cn: "\u7A81\u88AD\u6218\u58EB", damageType: "physical", attackRange: 2.5, color: "#ff4d3d", color2: "#ffd9b0", defaultBody: "heavy" },
  hexblade: { category: "warrior", role: "dps", name: "hexblade", cn: "\u65E0\u540D\u5251\u5BA2", damageType: "hybrid", attackRange: 3, color: "#cfe3ff", color2: "#eaf3ff", defaultBody: "light" },
  gunner: { category: "archer", role: "dps", name: "gunner", cn: "\u795E\u673A\u70AE\u5175", damageType: "physical", attackRange: 5, color: "#ff9a3c", color2: "#ffd9a8", defaultBody: "heavy" },
  sniper: { category: "archer", role: "dps", name: "sniper", cn: "\u795E\u5C04\u624B", damageType: "physical", attackRange: 6.5, color: "#ffd84a", color2: "#fff2c9", defaultBody: "light" },
  controller: { category: "mage", role: "control", name: "controller", cn: "\u592A\u6781\u672F\u5E08", damageType: "magic", attackRange: 6, color: "#7fe0d8", color2: "#d6fffb", defaultBody: "medium" },
  summoner: { category: "mage", role: "dps", name: "summoner", cn: "\u5316\u751F\u672F\u5E08", damageType: "magic", attackRange: 5, color: "#c79a5a", color2: "#e8d3ad", defaultBody: "medium" },
  healer: { category: "mage", role: "healer", name: "healer", cn: "\u56DE\u6625\u533B\u5B98", damageType: "magic", attackRange: 5, color: "#4fd982", color2: "#d6ffe6", defaultBody: "petite" }
};
var ALL_SUBCLASSES = Object.keys(SUBCLASS_INFO);
var BASE_BODY_SCALE = 1.3;
var BODY_INFO = {
  giant: { id: "giant", cn: "\u5DE8\u7075", hpMult: 2.6, msMult: 0.42, asMult: 0.565, sizeMult: 2.1, dodgeBonus: -10, renderPx: 70, outline: 3, trailFrames: 0, shadow: true, trait: "\u5DE8\u538B", traitDesc: "\u514D\u75AB\u51FB\u9000/\u7981\u9522\uFF1B\u5468\u56F4\u53CB\u519B\u53D7\u5230\u7684\u51FB\u9000 \u221250%\uFF1B\u57FA\u7840\u653B\u51FB\u4E0D\u53EF\u88AB\u95EA\u907F" },
  titan: { id: "titan", cn: "\u6CF0\u5766", hpMult: 2.2, msMult: 0.5, asMult: 0.625, sizeMult: 1.85, dodgeBonus: -8, renderPx: 62, outline: 3, trailFrames: 0, shadow: true, trait: "\u78BE\u538B", traitDesc: "\u514D\u75AB\u51FB\u9000/\u7981\u9522\uFF1B\u5468\u56F4\u53CB\u519B\u53D7\u5230\u7684\u51FB\u9000 \u221250%\uFF1B\u4F53\u578B\u5373\u538B\u8FEB" },
  obese: { id: "obese", cn: "\u80A5\u80D6", hpMult: 1.65, msMult: 0.65, asMult: 0.738, sizeMult: 1.55, dodgeBonus: -5, renderPx: 54, outline: 2, trailFrames: 0, shadow: true, trait: "\u539A\u76AE", traitDesc: "\u53D7\u51FB\u9000\u8DDD\u79BB \u221250%\uFF1B\u53D7\u5230\u7684\u6CBB\u7597\u6548\u679C +15%" },
  colossal: { id: "colossal", cn: "\u5DE8\u8EAF", hpMult: 1.5, msMult: 0.67, asMult: 0.753, sizeMult: 1.45, dodgeBonus: -6, renderPx: 50, outline: 2, trailFrames: 0, shadow: true, trait: "\u538B\u8FEB", traitDesc: "\u514D\u75AB\u51FB\u9000\uFF1B\u5468\u56F4\u53CB\u519B\u53D7\u5230\u7684\u51FB\u9000 \u221250%" },
  heavy: { id: "heavy", cn: "\u9B41\u68A7", hpMult: 1.2, msMult: 0.83, asMult: 0.873, sizeMult: 1.18, dodgeBonus: -3, renderPx: 40, outline: 2, trailFrames: 0, shadow: false, trait: "\u7A33\u6869", traitDesc: "\u5355\u6B21\u53D7\u4F24\u226515%\u6700\u5927HP\u65F6\uFF0C1.5s\u5185\u51CF\u4F2410%" },
  medium: { id: "medium", cn: "\u6807\u51C6", hpMult: 1, msMult: 1, asMult: 1, sizeMult: 1, dodgeBonus: 0, renderPx: 34, outline: 1, trailFrames: 0, shadow: false, trait: "\u901A\u7528", traitDesc: "\u65E0\u4FEE\u6B63\uFF08\u6240\u6709\u7CFB\u6570\u7684\u8C03\u53C2\u951A\u70B9\uFF09" },
  light: { id: "light", cn: "\u8F7B\u6377", hpMult: 0.83, msMult: 1.2, asMult: 1.15, sizeMult: 0.82, dodgeBonus: 3, renderPx: 28, outline: 1, trailFrames: 1, shadow: false, trait: "\u6ED1\u6B65", traitDesc: "\u95EA\u907F\u6210\u529F\u540E 0.8s \u5185\u79FB\u901F +20%" },
  slim: { id: "slim", cn: "\u7626\u5C0F", hpMult: 0.78, msMult: 1.28, asMult: 1.21, sizeMult: 0.78, dodgeBonus: 4, renderPx: 26, outline: 1, trailFrames: 1, shadow: false, trait: "\u7075\u5DE7", traitDesc: "\u95EA\u907F\u6210\u529F\u540E 0.8s \u5185\u79FB\u901F +25%\uFF08\u6ED1\u6B65\u8FDB\u9636\uFF09\uFF1B\u53D7\u51FB\u534A\u5F84\u66F4\u5C0F" },
  petite: { id: "petite", cn: "\u7CBE\u5DE7", hpMult: 0.67, msMult: 1.5, asMult: 1.375, sizeMult: 0.7, dodgeBonus: 6, renderPx: 24, outline: 1, trailFrames: 2, shadow: false, trait: "\u96BE\u7784", traitDesc: "\u8DDD\u653B\u51FB\u8005\u22654\u683C\u65F6\uFF0C\u53D7\u5230\u7684\u8FDC\u7A0B\u4F24\u5BB3 \u22128%" },
  gnome: { id: "gnome", cn: "\u4F8F\u5112", hpMult: 0.58, msMult: 1.72, asMult: 1.54, sizeMult: 0.6, dodgeBonus: 7, renderPx: 20, outline: 1, trailFrames: 2, shadow: false, trait: "\u6781\u96BE\u7784", traitDesc: "\u8DDD\u653B\u51FB\u8005\u22654\u683C\u65F6\uFF0C\u53D7\u5230\u7684\u8FDC\u7A0B\u4F24\u5BB3 \u221212%" }
};
var ALL_BODY_TYPES = Object.keys(BODY_INFO);
var hitRadiusOf = (b) => 0.42 * BASE_BODY_SCALE * BODY_INFO[b].sizeMult;
var starMult = (star = 1) => 1 + 0.18 * (Math.max(1, Math.min(5, star)) - 1);
var starGrowthBonus = (star = 1) => Math.max(1, Math.min(5, star)) - 1;
var skillLevelOf = (star = 1) => Math.max(1, Math.min(5, Math.round(star)));
var skillPowerMult = (star = 1) => 1 + 0.18 * (skillLevelOf(star) - 1);
var skillStarCdr = (star = 1) => 0.04 * (skillLevelOf(star) - 1);

// packages/core/src/content/enemies.ts
var base = (con, str, agi, int) => ({ con, str, agi, int });
var VAN_CFG = {
  /** 面包车基础一级属性（随层深 scaleHp/scaleAtk 放大） */
  vanBasePrimary: base(16, 13, 4, 2),
  /** 面包人属性 = 车基础 × 此乘子 */
  personPrimaryMul: 0.5,
  /** 面包人移速加成（百分点，+30） */
  personMoveSpeedAdd: 30,
  /** 面包人攻速加成（百分点，+50） */
  personAtkSpeedAdd: 50,
  /** 开场移速翻倍持续秒数（10） */
  openingBuffSec: 10,
  /** 撞击技能 CD（秒）：开门后仍能持续撞击，但因移速回落威胁明显下降 */
  ramCd: 3,
  /** 逐人下落间隔（秒）：避免同帧爆兵 */
  dropInterval: 0.4,
  /** 车队规模范围（4~8） */
  vanCountRange: [4, 8],
  /** 每辆面包人数量范围（4~10，需求原文） */
  peopleRange: [4, 10],
  /**
   * 面包人总数目标区间 [PLACEHOLDER · 待平衡 pass]
   *
   * 为什么需要这一条：两个范围独立均匀抽时，总人数是 4×4=16 到 8×10=80，
   * 5 倍方差。同一层难度差 5 倍不叫随机性，叫抽奖——玩家会把失败归因于运气而不是决策，
   * 这条反馈链一断，后面所有数值调整都收不到有效信号。
   *
   * 做法：先抽车数（4~8 均匀，需求原文不动），再让每车人数向总数区间收敛，
   * 且**始终落在 4~10 内**（需求原文的每车范围一格没动）。
   * 结果：总人数 28~48（1.7 倍方差），车多则每车人少、车少则每车人多——
   * "一车塞满" 和 "车队铺开" 两种观感都保留，但两局难度可比。
   *
   * 参照物：普通层单波峰值 8 人、总量 ≤24（encounter.ts buildWaves）。
   * 面包人属性 = 车 1/2，单体威胁低于常规怪，故总量给到 ~1.5 倍。
   * 验证路径：中端机 30 局跑批，记录 (总人数, 通关率, 最低帧)，把 28/48 两端各推 ±20% 复跑。
   */
  peopleTotalBand: [28, 48],
  /**
   * 同屏面包人上限 [PLACEHOLDER · 需中端机实测]
   *
   * 24 是普通层已验证的同屏量级（3 波 × 8 全部存活时的上限），
   * +4 给车队关一点"人真多"的观感溢价。超出的人排队等空位，
   * 车门不会因此关上——只是下人变慢。宁可下人节奏被拖慢，也不允许掉帧。
   * 验证路径：中端机（骁龙 7 系同档）跑满 8 车 × 10 人，看 p95 帧时间是否 <16.6ms。
   */
  concurrentPeopleCap: 28
};
var VAN_RAM_SKILL = {
  id: "van_ram",
  name: "\u86EE\u6A2A\u51B2\u649E",
  cd: VAN_CFG.ramCd,
  damageType: "physical",
  desc: "\u671D\u6700\u8FD1\u524D\u6392\u731B\u649E\uFF0C\u649E\u51FB\u4F24\u5BB3 \u2248 \u7269\u7406\u653B\u51FB \xD7 \u5F53\u524D\u79FB\u901F\uFF1B\u5F00\u573A 10 \u79D2\u79FB\u901F\u7FFB\u500D\uFF0C\u649E\u51FB\u6700\u731B",
  skillStyle: "van_ram",
  castRange: 1.5
};
var list = [
  // 坦克
  ["e_physTank_a", "\u91CD\u7532\u536B\u5175", "physTank", base(12, 7, 3, 2)],
  ["e_physTank_b", "\u94A2\u76FE\u72C2\u6218", "physTank", base(14, 9, 3, 2)],
  ["e_magicTank", "\u5492\u6CD5\u77F3\u50CF", "magicTank", base(13, 3, 3, 9)],
  // 战士
  ["e_charge_a", "\u7A81\u88AD\u5175", "charge", base(7, 12, 9, 2)],
  ["e_charge_b", "\u72C2\u66B4\u6218\u58EB", "charge", base(8, 14, 8, 2)],
  ["e_hexblade", "\u566C\u9B54\u8005", "hexblade", base(8, 10, 8, 8)],
  // 射手
  ["e_gunner_a", "\u5F29\u624B", "gunner", base(6, 9, 12, 3)],
  ["e_gunner_b", "\u706B\u70AE\u5175", "gunner", base(6, 11, 13, 3)],
  ["e_sniper", "\u795E\u5C04\u624B", "sniper", base(5, 11, 13, 3)],
  // 法师
  ["e_controller", "\u51B0\u971C\u5DEB\u5E08", "controller", base(5, 3, 8, 12)],
  ["e_summoner", "\u4EA1\u7075\u672F\u58EB", "summoner", base(7, 4, 6, 12)],
  ["e_healer", "\u90AA\u672F\u796D\u53F8", "healer", base(8, 3, 5, 12)],
  // Boss（传奇赛）：v2.3 全部升级为 titan 体型（碾压级压迫感）
  ["e_boss_colossus", "\u5DE8\u50CF", "physTank", base(20, 16, 4, 4), true, "titan"],
  ["e_boss_void", "\u865A\u7A7A\u541E\u566C\u8005", "magicTank", base(18, 6, 5, 18), true, "titan"],
  ["e_boss_echo", "\u6B8B\u5F71\u4E4B\u738B", "hexblade", base(16, 14, 12, 14), true, "titan"],
  // 普通 Boss（每 3 关）：colossal 体型，比小怪强但弱于 titan 强力 Boss，作中期压力点
  ["e_miniboss_warden", "\u89D2\u6597\u573A\u5B88\u536B", "physTank", base(14, 12, 5, 3), true, "colossal"],
  ["e_miniboss_oracle", "\u9884\u8A00\u9B54\u50CF", "magicTank", base(13, 5, 5, 12), true, "colossal"],
  ["e_miniboss_reaver", "\u8840\u8272\u52AB\u63A0\u8005", "hexblade", base(13, 11, 10, 9), true, "colossal"],
  // ── 西方怪物（v2.5 需求 #2）──
  // 常规波次怪：怪物皮 + 西方技能名，机制复用英雄子类骨架，但视觉完全独立。
  [
    "m_witch",
    "\u9ED1\u6E0A\u5973\u5DEB",
    "summoner",
    base(5, 3, 8, 11),
    false,
    void 0,
    "witch",
    {
      id: "m_witch_skill",
      name: "\u5492\u6028\u53EC\u5524",
      cd: 14,
      damageType: "magic",
      desc: "\u5973\u5DEB\u541F\u5531\u9ED1\u6697\u5492\u8BED\uFF0C\u6495\u88C2\u865A\u7A7A\u53EC\u5524\u6028\u7075\u52A9\u6218",
      skillStyle: "summon_rift",
      castRange: 5
    }
  ],
  [
    "m_demon",
    "\u70BC\u72F1\u6076\u9B54",
    "charge",
    base(9, 12, 8, 3),
    false,
    void 0,
    "demon",
    {
      id: "m_demon_skill",
      name: "\u70BC\u72F1\u7206\u53D1",
      cd: 7,
      damageType: "hybrid",
      desc: "\u5468\u8EAB 2.5 \u683C AoE 180% \u6DF7\u4F24\uFF0C\u5730\u72F1\u706B\u88F9\u631F",
      skillStyle: "melee_burst",
      castRange: 2.5
    }
  ],
  [
    "m_skeleton",
    "\u67AF\u9AA8\u6218\u58EB",
    "charge",
    base(7, 10, 7, 2),
    false,
    void 0,
    "skeleton",
    {
      id: "m_skel_skill",
      name: "\u9AB8\u9AA8\u7A81\u88AD",
      cd: 6,
      damageType: "physical",
      desc: "\u7A81\u8FDB 6 \u683C\u5185\u6700\u8FDC\u654C\u4EBA\uFF0C250% \u7269\u4F24 + \u6655 1 \u79D2",
      skillStyle: "charge_dash",
      castRange: 6
    }
  ],
  [
    "m_gargoyle",
    "\u77F3\u7FFC\u9B54\u50CF",
    "physTank",
    base(12, 8, 3, 2),
    false,
    void 0,
    "gargoyle",
    {
      id: "m_garg_skill",
      name: "\u77F3\u5316\u5486\u54EE",
      cd: 8,
      damageType: "physical",
      desc: "\u5486\u54EE\u9707\u6151 3 \u683C\u5185\u654C\u4EBA 3 \u79D2\uFF0C\u81EA\u8EAB\u51CF\u4F24\u63D0\u5347",
      skillStyle: "bulwark_taunt",
      castRange: 3
    }
  ],
  // 兽类新增（需求：龙加兽类标签 + 新增恶魔狼 / 精灵狼）：常规波次怪，非 Boss，走独立狼皮 + 西方技能名
  [
    "m_wolf_demon",
    "\u6076\u9B54\u72FC",
    "charge",
    base(8, 12, 10, 2),
    false,
    void 0,
    "demon_wolf",
    {
      id: "m_wolf_demon_skill",
      name: "\u6697\u5F71\u6495\u54AC",
      cd: 6,
      damageType: "physical",
      desc: "\u6076\u9B54\u72FC\u6251\u5411 6 \u683C\u5185\u6700\u8FDC\u654C\u4EBA\uFF0C250% \u7269\u4F24\u5E76\u6495\u88C2\u4F24\u53E3",
      skillStyle: "charge_dash",
      castRange: 6
    }
  ],
  [
    "m_wolf_fae",
    "\u7CBE\u7075\u72FC",
    "controller",
    base(6, 5, 9, 11),
    false,
    void 0,
    "fae_wolf",
    {
      id: "m_wolf_fae_skill",
      name: "\u5E7B\u6708\u4E4B\u566C",
      cd: 9,
      damageType: "magic",
      desc: "\u7CBE\u7075\u72FC\u5F15\u52A8\u6708\u5149\uFF0C5 \u683C\u5185\u654C\u4EBA\u9677\u5165\u6C89\u7720\u5E76\u53D7 180% \u6CD5\u4F24",
      skillStyle: "zone_control",
      castRange: 5
    }
  ],
  // 西方 Boss：龙（titan 强力 Boss）/ 堕天使（colossal 普通 Boss），各自独立皮 + 西方技能名
  [
    "m_dragon",
    "\u6DF1\u6E0A\u90AA\u9F99",
    "physTank",
    base(20, 16, 4, 4),
    true,
    "titan",
    "dragon",
    {
      id: "m_dragon_skill",
      name: "\u711A\u4E16\u9F99\u606F",
      cd: 8,
      damageType: "physical",
      desc: "\u5DE8\u9F99\u55B7\u5410\u5DE8\u578B\u9525\u5F62\u9F99\u606F\uFF0C\u671D\u6700\u8FD1\u654C\u4EBA\uFF08\u8303\u56F4=3\xD7\u4F53\u578B\uFF09\uFF0C\u706B=\u707C\u70E7 / \u51B0=\u51B0\u51BB / \u6BD2=\u5267\u6BD2",
      skillStyle: "bulwark_taunt",
      castRange: 3.5
    }
  ],
  [
    "m_fallen_angel",
    "\u5815\u5929\u70BD\u5929\u4F7F",
    "magicTank",
    base(18, 6, 5, 18),
    true,
    "colossal",
    "fallen_angel",
    {
      id: "m_angel_skill",
      name: "\u5815\u5929\u5BA1\u5224",
      cd: 10,
      damageType: "magic",
      desc: "\u5BA1\u5224\u4E4B\u5149\u5438\u53D6 8 \u683C\u5185\u654C\u65B9 10% \u6700\u5927\u751F\u547D",
      skillStyle: "bulwark_taunt",
      castRange: 8
    }
  ],
  // ── v2.9.x 面包车特殊关（cosplay 五菱宏光）──
  // 面包车：重甲慢车，专属 van_ram 撞击（开场 10s 移速翻倍 → 撞击最猛）。属性基础见 VAN_CFG。
  ["e_van", "\u9762\u5305\u8F66", "physTank", VAN_CFG.vanBasePrimary, false, "heavy", "van", VAN_RAM_SKILL],
  // 面包人：属性 = 车 1/2（下方 base 仅作模板；实际由 VanConvoyScript 按 VAN_CFG 计算并随机赋特性）。
  ["e_van_person", "\u9762\u5305\u4EBA", "charge", base(8, 7, 3, 1), false, "medium", "van_person"]
];
function bossSkill(id) {
  if (id === "e_boss_colossus") return SKILLS.boss_stomp;
  if (id === "e_boss_void") return SKILLS.boss_devour;
  if (id === "e_boss_echo") return SKILLS.boss_split;
  if (id === "e_miniboss_warden") return SKILLS.boss_stomp;
  if (id === "e_miniboss_oracle") return SKILLS.boss_devour;
  return SKILLS.boss_split;
}
var ENEMIES = list.map(([id, name, subclass, p, isBoss, body, monsterKind, skillOverride]) => ({
  id,
  name,
  category: SUBCLASS_INFO[subclass].category,
  subclass,
  basePrimary: p,
  isBoss,
  bodyType: body,
  monsterKind,
  // 西方怪物用自带西方技能名；其余英雄系敌人按子类自动取技能（含中国风技能名）
  skill: skillOverride ?? (isBoss ? bossSkill(id) : subclass === "healer" ? void 0 : { ...SKILLS[SUBCLASS_SKILL[subclass]] })
}));
var VAN_ONLY_IDS = /* @__PURE__ */ new Set(["e_van", "e_van_person"]);
var ENEMIES_BY_CAT = (cat) => ENEMIES.filter((e) => !e.isBoss && !VAN_ONLY_IDS.has(e.id) && e.category === cat);
var VAN_ENEMY = ENEMIES.find((e) => e.id === "e_van");
var VAN_PERSON = ENEMIES.find((e) => e.id === "e_van_person");
var BOSSES = ENEMIES.filter((e) => e.isBoss);
var STRONG_BOSSES = BOSSES.filter((e) => e.bodyType === "titan");
var NORMAL_BOSSES = BOSSES.filter((e) => e.bodyType === "colossal");

// packages/core/src/content/consumables.ts
var CONSUMABLE_CHANCE = 0.2;
var CONSUMABLE_CFG = {
  growth: {
    name: "\u6210\u957F\u836F\u5242",
    // 与击杀成长同源：一瓶 ≈ 一次击杀的核心属性收益 + 0.5~2 倍的二级属性收益。
    // 定价刻意压在蓝装(120)之下，让「买永久成长」在前期是真的可选项而不是奢侈品。
    desc: "\u968F\u673A\u6838\u5FC3\u5C5E\u6027 +0.5\uFF0C\u968F\u673A\u4E8C\u7EA7\u5C5E\u6027\u6210\u957F 0.5%~2%\uFF08\u6C38\u4E45\uFF0C\u7ACB\u5373\u751F\u6548\uFF09",
    basePrice: 90,
    color: "#7ee08a",
    icon: "\u{1F9EA}"
  },
  burst: {
    name: "\u7206\u53D1\u836F\u5242",
    // 只保 1 回合，所以定价必须明显低于永久成长，否则没人会买。
    desc: "\u4E3B\u5C5E\u6027\u589E\u5F3A 50%\uFF0C\u6301\u7EED 1 \u56DE\u5408\uFF08\u4EC5\u4E0B\u4E00\u573A\u6218\u6597\uFF09",
    basePrice: 70,
    color: "#ff9a3c",
    icon: "\u2697\uFE0F"
  }
};
var BURST_MULT = 1.5;
var cid = 0;
var nextConsumableId = () => `c${cid++}`;
function makeConsumable(kind) {
  const cfg = CONSUMABLE_CFG[kind];
  return { id: nextConsumableId(), kind, name: cfg.name, desc: cfg.desc, basePrice: cfg.basePrice };
}
function rollConsumable(rng) {
  return makeConsumable(pick(rng, ["growth", "burst"]));
}
function dominantPrimary(p) {
  let best = "con";
  for (const k of PRIMARY_KEYS) if (p[k] > p[best]) best = k;
  return best;
}

// packages/core/src/content/equipment.ts
var AFFIX_POOL = {
  pDmg: { name: "\u7269\u7406\u4F24\u5BB3", min: 4, max: 9 },
  mDmg: { name: "\u9B54\u6CD5\u4F24\u5BB3", min: 4, max: 9 },
  hp: { name: "\u751F\u547D", min: 25, max: 60 },
  atkSpeed: { name: "\u653B\u901F", min: 3, max: 8 },
  crit: { name: "\u66B4\u51FB", min: 2, max: 5 },
  critDmg: { name: "\u66B4\u51FB\u4F24\u5BB3", min: 6, max: 14 },
  pResist: { name: "\u7269\u7406\u51CF\u4F24", min: 3, max: 8 },
  mResist: { name: "\u9B54\u6CD5\u51CF\u4F24", min: 3, max: 8 },
  moveSpeed: { name: "\u79FB\u901F", min: 2, max: 6 },
  dodge: { name: "\u95EA\u907F", min: 2, max: 6 },
  heal: { name: "\u6CBB\u7597\u91CF", min: 6, max: 16 }
};
var RARITY_CFG = {
  normal: { mult: 1, affixMin: 1, affixMax: 1, weight: 68, basePrice: 30, prefix: "\u7C97\u5236" },
  blue: { mult: 1.8, affixMin: 2, affixMax: 2, weight: 24, basePrice: 120, prefix: "\u7CBE\u826F" },
  orange: { mult: 3, affixMin: 2, affixMax: 3, weight: 6.5, basePrice: 400, prefix: "\u5353\u8D8A" },
  red: { mult: 5, affixMin: 3, affixMax: 3, weight: 1.5, basePrice: 1200, prefix: "\u4F20\u8BF4" }
};
var AFFIX_NOUN = {
  pDmg: "\u5229\u5203",
  mDmg: "\u6CD5\u73E0",
  hp: "\u58C1\u5792",
  atkSpeed: "\u75BE\u98CE",
  crit: "\u9E70\u773C",
  critDmg: "\u5C60\u622E",
  pResist: "\u94C1\u58C1",
  mResist: "\u79D8\u94F6",
  moveSpeed: "\u8F7B\u8DB3",
  dodge: "\u5E7B\u5F71",
  heal: "\u5723\u7597"
};
var ALL_AFFIX_KEYS = Object.keys(AFFIX_POOL);
var FLAT_BLOCKED = /* @__PURE__ */ new Set(["pResist", "mResist"]);
var FLAT_KEYS = ALL_AFFIX_KEYS.filter((k) => !FLAT_BLOCKED.has(k));
var PCT_CHANCE = { normal: 0, blue: 0, orange: 0.35, red: 0.5 };
var PCT_RANGE = {
  normal: { min: 0, max: 0 },
  blue: { min: 0, max: 0 },
  orange: { min: 6, max: 12 },
  red: { min: 10, max: 18 }
};
var QUALITY_LEVEL = { normal: 0, blue: 1, orange: 2, red: 3 };
var eqStarMult = (eq) => eq.rarity === "red" ? 1 + 0.25 * (Math.max(1, Math.min(5, eq.star ?? 1)) - 1) : 1;
var PCT_SCORE_PER_POINT = 0.12;
function equipScore(eq) {
  const sm = eqStarMult(eq);
  let s = 0;
  for (const a of eq.affixes) {
    const v = a.value * sm;
    if (a.mode === "pct") s += v * PCT_SCORE_PER_POINT;
    else s += v / Math.max(1, AFFIX_POOL[a.key].max);
  }
  return Math.round((s + QUALITY_LEVEL[eq.rarity] * 1e-3) * 1e3) / 1e3;
}
var eid = 0;
var nextEqId = () => `e${eid++}`;
function rollRarity(rng) {
  const total = Object.values(RARITY_CFG).reduce((s, c) => s + c.weight, 0);
  let r = rng() * total;
  for (const [k, c] of Object.entries(RARITY_CFG)) {
    if (r < c.weight) return k;
    r -= c.weight;
  }
  return "normal";
}
function rollAffixes(rng, rarity) {
  const cfg = RARITY_CFG[rarity];
  const count = randInt(rng, cfg.affixMin, cfg.affixMax);
  const keys = shuffle(rng, ALL_AFFIX_KEYS).slice(0, count);
  const pctChance = PCT_CHANCE[rarity];
  const out = [];
  const usedPct = /* @__PURE__ */ new Set();
  for (const key of keys) {
    if (pctChance > 0 && rng() < pctChance && !usedPct.has(key)) {
      const pr = PCT_RANGE[rarity];
      usedPct.add(key);
      out.push({ key, value: randInt(rng, pr.min, pr.max), mode: "pct" });
    } else {
      const usedKeys = new Set(keys);
      for (const a of out) usedKeys.add(a.key);
      const candidates = FLAT_KEYS.filter((k) => !usedKeys.has(k));
      const fk = FLAT_BLOCKED.has(key) ? candidates.length ? pick(rng, candidates) : pick(rng, FLAT_KEYS) : key;
      const pool = AFFIX_POOL[fk];
      const base2 = randInt(rng, pool.min, pool.max);
      out.push({ key: fk, value: Math.max(1, Math.round(base2 * cfg.mult)), mode: "flat" });
    }
  }
  return out;
}
var SPECIAL_NAMES = {
  physTank: "\u7384\u6B66\xB7\u9547\u5CB3\u91CD\u76FE",
  magicTank: "\u7B26\u7532\xB7\u7384\u7B26\u9053\u888D",
  charge: "\u7A81\u88AD\xB7\u5043\u6708\u957F\u5200",
  hexblade: "\u5251\u5BA2\xB7\u65E0\u540D\u53E4\u5251",
  gunner: "\u70AE\u624B\xB7\u795E\u673A\u706B\u94F3",
  sniper: "\u795E\u5C04\xB7\u843D\u65E5\u795E\u5F13",
  controller: "\u592A\u6781\xB7\u9634\u9633\u7F57\u76D8",
  summoner: "\u5316\u751F\xB7\u9020\u5316\u9676\u571F",
  healer: "\u56DE\u6625\xB7\u767E\u8349\u846B\u82A6"
};
var SPECIAL_AFFIXES = {
  physTank: ["hp", "pDmg"],
  magicTank: ["hp", "mDmg"],
  charge: ["pDmg", "hp"],
  hexblade: ["pDmg", "crit"],
  gunner: ["pDmg", "atkSpeed"],
  sniper: ["pDmg", "critDmg"],
  controller: ["mDmg", "atkSpeed"],
  summoner: ["mDmg", "hp"],
  healer: ["heal", "hp"]
};
var GENERIC_FAMILIES = [
  { family: "pojun", name: "\u7834\u519B" },
  { family: "xuanlin", name: "\u7384\u9CDE" },
  { family: "yunwen", name: "\u4E91\u7EB9" },
  { family: "tiangong", name: "\u5929\u5DE5" },
  { family: "jiuyao", name: "\u4E5D\u66DC" }
];
function genSpecial(sub, rng, r) {
  const mult = RARITY_CFG[r].mult;
  const core = SPECIAL_AFFIXES[sub];
  const affixes = core.map((k) => {
    const pool = AFFIX_POOL[k];
    const base2 = randInt(rng, Math.round(pool.max * 0.8), pool.max);
    return { key: k, value: Math.max(1, Math.round(base2 * mult)), mode: "flat" };
  });
  const rest = Object.keys(AFFIX_POOL).filter(
    (k) => !core.includes(k) && !FLAT_BLOCKED.has(k)
  );
  const k3 = pick(rng, rest);
  const p3 = AFFIX_POOL[k3];
  affixes.push({ key: k3, value: Math.max(1, Math.round(randInt(rng, p3.min, p3.max) * mult)), mode: "flat" });
  return {
    id: nextEqId(),
    name: SPECIAL_NAMES[sub],
    rarity: r,
    affixes,
    opened: false,
    basePrice: RARITY_CFG[r].basePrice,
    star: 1,
    special: sub
  };
}
function genGeneric(fam, rng, r) {
  const affixes = rollAffixes(rng, r);
  return {
    id: nextEqId(),
    name: fam.name,
    rarity: r,
    affixes,
    opened: false,
    basePrice: RARITY_CFG[r].basePrice,
    star: 1,
    family: fam.family
  };
}
function generateEquipment(rng, rarity) {
  const r = rarity ?? rollRarity(rng);
  if (r === "red") {
    const n = Math.floor(rng() * 14);
    if (n < 9) return genSpecial(ALL_SUBCLASSES[n], rng, r);
    return genGeneric(GENERIC_FAMILIES[n - 9], rng, r);
  }
  const affixes = rollAffixes(rng, r);
  const primary = affixes[0].key;
  return {
    id: nextEqId(),
    name: RARITY_CFG[r].prefix + AFFIX_NOUN[primary],
    rarity: r,
    affixes,
    opened: false,
    basePrice: RARITY_CFG[r].basePrice
  };
}
var chestCount = (rng, boss) => boss ? randInt(rng, 8, 12) : randInt(rng, 3, 6);
var CHEST_TABLE = [
  { reward: "equip_normal", p: 0.4 },
  { reward: "gold_small", p: 0.2 },
  { reward: "equip_high", p: 0.2 },
  { reward: "equip_rare", p: 0.1 },
  { reward: "gold_large", p: 0.1 }
];
var CHEST_TABLE_HIGH = [
  { reward: "equip_normal", p: 0.4 * (10 / 14) },
  { reward: "gold_small", p: 0.2 * (10 / 14) },
  { reward: "equip_high", p: 0.25 },
  { reward: "equip_rare", p: 0.15 },
  { reward: "gold_large", p: 0.1 * (10 / 14) }
];
var RARE_RED_CHANCE = 0.2;
var chestGold = (rng, layer, big) => big ? randInt(rng, 35 + 12 * layer, 65 + 22 * layer) : randInt(rng, 8 + 3 * layer, 16 + 5 * layer);
function rollChestReward(rng, highBonus = false) {
  const table = highBonus ? CHEST_TABLE_HIGH : CHEST_TABLE;
  let r = rng();
  for (const row of table) {
    if (r < row.p) return row.reward;
    r -= row.p;
  }
  return "equip_normal";
}
var cidx = 0;
var nextChestId = () => `k${cidx++}`;
function rollChest(rng, layer, highBonus = false) {
  const reward = rollChestReward(rng, highBonus);
  switch (reward) {
    case "gold_small":
      return { id: nextChestId(), reward, gold: chestGold(rng, layer, false) };
    case "gold_large":
      return { id: nextChestId(), reward, gold: chestGold(rng, layer, true) };
    case "equip_high":
      return { id: nextChestId(), reward, equipment: generateEquipment(rng, "blue") };
    case "equip_rare":
      return {
        id: nextChestId(),
        reward,
        equipment: generateEquipment(rng, rng() < RARE_RED_CHANCE ? "red" : "orange")
      };
    default:
      return { id: nextChestId(), reward, equipment: generateEquipment(rng, "normal") };
  }
}
function rollDrops(rng, layer, boss, highBonus = false) {
  const n = chestCount(rng, boss);
  return Array.from({ length: n }, () => rollChest(rng, layer, highBonus));
}
function rollShopStock(rng, count = 8) {
  const equipment = [];
  const consumables = [];
  for (let i = 0; i < count; i++) {
    if (rng() < CONSUMABLE_CHANCE) {
      consumables.push(rollConsumable(rng));
    } else {
      const e = generateEquipment(rng);
      e.opened = true;
      equipment.push(e);
    }
  }
  return { equipment, consumables };
}

// packages/core/src/rules/economy.ts
var EQUIP_SLOTS = 6;
var TEAM_CAP = 7;
var REFRESH_COST = 1;
var FUSE_PER_LAYER = 2;
var STARTER_BLUE = 2;
var STARTER_NORMAL = 2;
function rollStarterKit(rng) {
  const out = [];
  for (let i = 0; i < STARTER_BLUE; i++) out.push({ ...generateEquipment(rng, "blue"), opened: true });
  for (let i = 0; i < STARTER_NORMAL; i++) out.push({ ...generateEquipment(rng, "normal"), opened: true });
  return out;
}
var BREAKTHROUGH_MAIN_CHANCE = 0.6;
var discountOf = (tradeCount) => Math.max(0, Math.min(0.5, tradeCount * 0.025));
var recruitCostOf = (layer, base2, preset) => {
  const baseCost = 60 + 20 * layer;
  if (!base2 || !preset) return baseCost;
  const keys = ["con", "str", "agi", "int"];
  let sumDev = 0;
  for (const k of keys) {
    const p = preset[k] || 1;
    sumDev += (base2[k] - p) / p;
  }
  const avgDev = sumDev / keys.length;
  let mult = 1;
  if (avgDev >= 0.3) mult = 2;
  else if (avgDev >= 0.1) mult = 1.1;
  else if (avgDev <= -0.2) mult = 0.75;
  return Math.round(baseCost * mult);
};
var goldReward = (layer) => 40 + 12 * layer;
var hashStr = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
function addGrowth(existing, add) {
  const primary = { ...existing?.primary ?? {} };
  for (const k of PRIMARY_KEYS) {
    const v = add.primary?.[k];
    if (v) primary[k] = Math.round(((primary[k] ?? 0) + v) * 100) / 100;
  }
  const secondaryPct = { ...existing?.secondaryPct ?? {} };
  for (const k of GROWTH_STAT_KEYS) {
    const v = add.secondaryPct?.[k];
    if (v) secondaryPct[k] = Math.round(((secondaryPct[k] ?? 0) + v) * 100) / 100;
  }
  return { primary, secondaryPct };
}

// packages/core/src/content/beast.ts
var BEAST_MONSTER_KINDS = ["demon", "gargoyle", "dragon", "demon_wolf", "fae_wolf"];
var isBeastEnemy = (kind) => !!kind && BEAST_MONSTER_KINDS.includes(kind);
var BEAST_TRAITS = ["selfdestruct", "nest", "immunity"];
var BEAST_CHANCE = 35;
function beastTraitFor(enemyId, layer, waveIdx, i) {
  const h = hashStr(`${enemyId}|${layer}|${waveIdx}|${i}`) >>> 0;
  if (h % 100 >= BEAST_CHANCE) return void 0;
  return BEAST_TRAITS[h % BEAST_TRAITS.length];
}

// packages/core/src/gen/encounter.ts
var CATS = ["tank", "warrior", "archer", "mage"];
function buildWaves(rng, n, bossTier) {
  const waveCount = n <= 10 ? 1 : n <= 30 ? 2 : 3;
  const waves = [];
  for (let w = 0; w < waveCount; w++) {
    const count = Math.min(8, 2 + Math.floor(n / 5) + (w > 0 ? 1 : 0));
    const wave = [];
    for (let i = 0; i < count; i++) {
      const cat = pick(rng, CATS);
      const pool = ENEMIES_BY_CAT(cat);
      const e = pick(rng, pool);
      wave.push(
        isBeastEnemy(e.monsterKind) ? { ...e, beastTrait: beastTraitFor(e.id, n, w, i) } : e
      );
    }
    waves.push(wave);
  }
  if (bossTier) waves.push([pick(rng, bossTier === "strong" ? STRONG_BOSSES : NORMAL_BOSSES)]);
  return waves;
}

// packages/core/src/content/buildings.ts
var BUILDINGS = {
  // ── 营房 ──────────────────────────────────────────────
  // 需求：「会产生普通小兵，一场对局最多 8 个」。
  // interval=9s 是按「玩家清掉一波小兵的时间」定的：比 9s 快，前线永远回不了血；
  // 比 9s 慢，营房就成了背景板。开场先给 2 个兵，让玩家在第一时间就"看到"它在工作，
  // 否则前 9 秒里这栋楼看起来完全无害，玩家会理所当然地忽略它。
  barracks: {
    kind: "barracks",
    name: "\u654C\u519B\u8425\u623F",
    desc: "\u6E90\u6E90\u4E0D\u65AD\u8F93\u51FA\u666E\u901A\u5C0F\u5175\u7684\u524D\u54E8\u3002\u4E0D\u62C6\uFF0C\u524D\u7EBF\u6C38\u8FDC\u6E05\u4E0D\u5E72\u51C0\u3002",
    hp: 520,
    bodyType: "heavy",
    spawn: { kind: "soldier", initial: 2, interval: 9, cap: 8 },
    minLayer: 2,
    weight: 34,
    threat: "\u6BCF 9 \u79D2\u4EA7 1 \u540D\u5C0F\u5175\uFF08\u5168\u573A\u4E0A\u9650 8\uFF09",
    color: "#8a6a3a",
    dark: "#4e3a1e",
    accent: "#d8b070"
  },
  // ── 三种防御塔 ────────────────────────────────────────
  // 需求原文（v2.9.x #4）：「箭塔…伤害低、血少、无特性、无意义」。
  // 这条需求不是「把塔削弱到没用」，而是**确认塔的设计定位就是路边骚扰**：
  // 塔不走、不追、不索敌离开射程圈，伤害还低于同层一波小兵——玩家走过去就能拆，
  // 不拆也只是沿途挨几下不痛不痒的箭，不会因此崩盘。
  // 因此塔的威胁文案必须诚实写「可绕开、非核心」，而不是假装它是火力点。
  // 注意「无特性」是结构保证：spawnFromBuilding 不调 rollTrait（见 types.ts BuildingDef 注释）。
  // 三档塔的区别只在于「驻守兵数量 + 血厚程度」，伤害都压在同层小兵之下，不构成风险阶梯。
  tower_wood: {
    kind: "tower_wood",
    name: "\u6728\u5236\u7BAD\u5854",
    desc: "\u7B80\u6613\u7BAD\u5854\u3002\u4F24\u5BB3\u6709\u9650\uFF0C\u5854\u4E0A\u7684\u5F13\u624B\u53EA\u662F\u6CBF\u9014\u9A9A\u6270\uFF0C\u4E0D\u62C6\u4E5F\u6B7B\u4E0D\u4E86\u4EBA\u3002",
    hp: 380,
    bodyType: "medium",
    atk: 26,
    range: 4.8,
    atkInterval: 1.6,
    spawn: { kind: "soldier", initial: 1, interval: 0, cap: 1 },
    minLayer: 2,
    weight: 26,
    threat: "4.8 \u683C\u5185\u8F7B\u5FAE\u70B9\u5C04 \xB7 \u53EF\u7ED5\u5F00\uFF0C\u975E\u6838\u5FC3\u5A01\u80C1",
    color: "#9a7038",
    dark: "#5a3f1c",
    accent: "#c99a52"
  },
  tower_rock: {
    kind: "tower_rock",
    name: "\u5CA9\u77F3\u54E8\u5854",
    desc: "\u5792\u77F3\u800C\u6210\uFF0C\u6BD4\u6728\u5854\u8010\u6253\uFF0C\u4F46\u706B\u529B\u4F9D\u65E7\u53EA\u662F\u9A9A\u6270\u7EA7\u522B\u3002",
    hp: 760,
    bodyType: "heavy",
    atk: 44,
    range: 5.4,
    atkInterval: 1.8,
    spawn: { kind: "soldier", initial: 2, interval: 0, cap: 2 },
    minLayer: 5,
    weight: 22,
    threat: "5.4 \u683C\u5185\u8F7B\u51FB \xB7 \u53EF\u7ED5\u5F00\uFF0C\u975E\u6838\u5FC3\u5A01\u80C1",
    color: "#7e7e86",
    dark: "#43434a",
    accent: "#b6b6c0"
  },
  tower_iron: {
    kind: "tower_iron",
    name: "\u7384\u94C1\u91CD\u5854",
    desc: "\u7384\u94C1\u6D47\u7B51\uFF0C\u786C\u4F46\u706B\u529B\u6CA1\u53D8\u5F3A\u591A\u5C11\u3002\u8840\u539A\u7684\u5854\u53EA\u662F\u66F4\u8D39\u62C6\uFF0C\u4E0D\u662F\u66F4\u5371\u9669\u3002",
    hp: 1180,
    bodyType: "colossal",
    atk: 68,
    range: 6,
    atkInterval: 2,
    spawn: { kind: "soldier", initial: 2, interval: 0, cap: 2 },
    minLayer: 9,
    weight: 14,
    threat: "6 \u683C\u5185\u8F7B\u51FB \xB7 \u53EF\u7ED5\u5F00\uFF0C\u975E\u6838\u5FC3\u5A01\u80C1",
    color: "#5c6472",
    dark: "#2c3038",
    accent: "#9fb0c4"
  },
  // ── 恶龙巢 / 恶龙巢穴 ─────────────────────────────────
  // 需求：巢「产幼龙（boss 幼体），最多三条」；巢穴「一条额外的成年龙 + 四条幼龙」。
  // 幼龙 = Boss 幼体：走 dragon 怪物皮 + heavy 体型，属性按 whelp 折算。
  // 它必须**看起来就是条龙**——玩家一眼认出「这是 Boss 的崽」，才会本能地优先处理。
  // 巢穴 minLayer=12：这是全局最危险的建筑，早期刷出来就是纯粹的处刑，
  // 12 层时玩家已经有成型的装备与升星，才谈得上"高风险高回报"。
  dragon_nest: {
    kind: "dragon_nest",
    name: "\u6076\u9F99\u5DE2",
    desc: "\u9F99\u5375\u5B75\u5316\u573A\u3002\u5E7C\u9F99\u662F Boss \u5E7C\u4F53\uFF0C\u8D8A\u665A\u62C6\u8D8A\u96BE\u6536\u573A\u3002",
    hp: 1150,
    bodyType: "colossal",
    spawn: { kind: "whelp", initial: 1, interval: 12, cap: 4 },
    minLayer: 7,
    weight: 12,
    threat: "\u6BCF 12 \u79D2\u5B75\u5316 1 \u6761\u5E7C\u9F99\uFF08\u4E0A\u9650 4\uFF09",
    color: "#5a3a6a",
    dark: "#2e1c38",
    accent: "#b98cff"
  },
  dragon_lair: {
    kind: "dragon_lair",
    name: "\u6076\u9F99\u5DE2\u7A74",
    desc: "\u6210\u5E74\u6076\u9F99\u7684\u5C45\u6240\u3002\u5F00\u573A\u5373\u91CA\u653E\u5B88\u5DE2\u6210\u9F99\u4E0E\u56DB\u6761\u5E7C\u9F99\u2014\u2014\u52A1\u5FC5\u5148\u89E3\u51B3\u5B83\u3002",
    hp: 2100,
    bodyType: "colossal",
    // initial=5 = 1 条成年龙 + 4 条幼龙，由 BattleSim 按序拆分（第 1 只是成年龙）。
    // interval=0：一次性放完。巢穴的压力来自"开场即刻的五条龙"，
    // 再加持续产出会让这层直接变成不可解，违反纪律 ③。
    spawn: { kind: "adult_dragon", initial: 5, interval: 0, cap: 5 },
    minLayer: 12,
    weight: 6,
    threat: "\u5F00\u573A\u91CA\u653E 1 \u6761\u6210\u5E74\u6076\u9F99 + 4 \u6761\u5E7C\u9F99\uFF08\u7ECF\u5F3A\u5316\uFF09",
    color: "#6a2a2a",
    dark: "#331414",
    accent: "#ff7a5a"
  }
};
var BUILDING_KINDS = Object.keys(BUILDINGS);
var isTower = (k) => k.startsWith("tower_");
var SPAWN_TEMPLATES = {
  // 普通小兵：刻意做得比同层波次怪弱一档（hp 0.7 / dmg 0.75）。
  // 它的威胁来自**数量与持续性**，不是单体强度——
  // 若单兵和波次怪等强，营房就等于「白送一整波敌人」，那不是战术压力是数值暴力。
  soldier: {
    name: "\u654C\u519B\u5C0F\u5175",
    subclass: "charge",
    basePrimary: { con: 7, str: 9, agi: 7, int: 2 },
    bodyType: "medium",
    hpMult: 0.7,
    dmgMult: 0.75
  },
  // 幼龙 = Boss 幼体：dragon 皮 + heavy 体型。
  // 强于小兵但远弱于成年龙，定位是「必须分兵处理、但不至于灭队」的中量威胁。
  whelp: {
    name: "\u5E7C\u9F99",
    subclass: "charge",
    basePrimary: { con: 11, str: 11, agi: 6, int: 4 },
    bodyType: "heavy",
    monsterKind: "dragon",
    skill: {
      id: "whelp_breath",
      name: "\u7A1A\u7130",
      cd: 8,
      damageType: "physical",
      desc: "\u9525\u5F62\u9F99\u606F\uFF1A\u671D\u6700\u8FD1\u654C\u4EBA\u55B7\u5411\u524D\u65B9\uFF08\u8303\u56F4=3\xD7\u4F53\u578B\uFF09\uFF0C\u706B=\u707C\u70E7 / \u51B0=\u51B0\u51BB / \u6BD2=\u5267\u6BD2",
      skillStyle: "melee_burst",
      castRange: 2.5
    },
    hpMult: 1.4,
    dmgMult: 1.1
  },
  // 成年恶龙：colossal 体型 + 龙息。刻意不标 isBoss——
  // 它是巢穴的产物而非本层 Boss，标了会让 HUD 出现第二条 Boss 血条，
  // 玩家会误以为通关条件变了。
  adult_dragon: {
    name: "\u6210\u5E74\u6076\u9F99",
    subclass: "physTank",
    basePrimary: { con: 17, str: 15, agi: 4, int: 4 },
    bodyType: "colossal",
    monsterKind: "dragon",
    skill: {
      id: "lair_dragon_breath",
      name: "\u711A\u5DE2\u9F99\u606F",
      cd: 7,
      damageType: "physical",
      desc: "\u5DE8\u578B\u9525\u5F62\u9F99\u606F\uFF1A\u671D\u6700\u8FD1\u654C\u4EBA\u55B7\u5411\u524D\u65B9\uFF08\u8303\u56F4=3\xD7\u4F53\u578B\uFF09\uFF0C\u706B=\u707C\u70E7 / \u51B0=\u51B0\u51BB / \u6BD2=\u5267\u6BD2",
      skillStyle: "bulwark_taunt",
      castRange: 3.5
    },
    hpMult: 2.6,
    dmgMult: 1.6
  }
};
function buildingCountFor(layer) {
  if (layer < 2) return 0;
  if (layer < 5) return 1;
  if (layer < 11) return 2;
  return 3;
}
function availableBuildings(layer) {
  return BUILDING_KINDS.map((k) => BUILDINGS[k]).filter((b) => b.minLayer <= layer);
}

// packages/core/src/content/events.ts
function rollRandomEvent(rng, layer, isBoss) {
  if (layer <= 1) return void 0;
  if (isBoss) return void 0;
  if (rng() >= 0.35) return void 0;
  const pool = [mysticMerchant, wanderingVault, sacrificeAltar, luckyChest];
  const pickIdx = Math.floor(rng() * pool.length) % pool.length;
  return pool[pickIdx](rng);
}
function mysticMerchant() {
  return {
    id: "mystic_merchant",
    title: "\u795E\u79D8\u5546\u4EBA",
    desc: "\u4E00\u540D\u62AB\u6597\u7BF7\u7684\u5546\u4EBA\u62E6\u5728\u8DEF\u53E3\uFF0C\u5411\u4F60\u515C\u552E\u521A\u4ECE\u79D8\u5883\u91CC\u6DD8\u6765\u7684\u88C5\u5907\u3002",
    options: [
      { label: "\u82B1 80 \u91D1\u5E01 \xB7 \u84DD\u88C5\xD71", desc: "\u8D2D\u5165 1 \u4EF6\u84DD\u88C5\uFF08\u786E\u5B9A\u6027\u751F\u6210\uFF09", effect: { gold: -80, give: { rarity: "blue", count: 1 } } },
      { label: "\u82B1 220 \u91D1\u5E01 \xB7 \u6A59\u88C5\xD71", desc: "\u8D2D\u5165 1 \u4EF6\u6A59\u88C5\uFF08\u786E\u5B9A\u6027\u751F\u6210\uFF09", effect: { gold: -220, give: { rarity: "orange", count: 1 } } },
      { label: "\u4E0D\u4E70\uFF0C\u8D76\u8DEF", desc: "\u65E0\u4E8B\u53D1\u751F", effect: {} }
    ]
  };
}
function wanderingVault() {
  return {
    id: "wandering_vault",
    title: "\u6D41\u6D6A\u5B9D\u5E93",
    desc: "\u4E00\u5C0A\u65E0\u4E3B\u5B9D\u7BB1\u9759\u9759\u7ACB\u5728\u5899\u89D2\uFF0C\u91CC\u9762\u4F3C\u4E4E\u53EA\u5BB9\u4F60\u53D6\u8D70\u4E00\u6837\u4E1C\u897F\u3002",
    options: [
      { label: "\u53D6 \u6A59\u88C5\xD71", desc: "\u83B7\u5F97 1 \u4EF6\u968F\u673A\u6A59\u88C5", effect: { give: { rarity: "orange", count: 1 } } },
      { label: "\u53D6 300 \u91D1\u5E01", desc: "\u76F4\u63A5\u62FF\u94B1\u8D70\u4EBA", effect: { gold: 300 } },
      { label: "\u4E0D\u78B0\uFF0C\u6015\u6709\u8BC8", desc: "\u65E0\u4E8B\u53D1\u751F", effect: {} }
    ]
  };
}
function sacrificeAltar() {
  return {
    id: "sacrifice_altar",
    title: "\u53E4\u8001\u796D\u575B",
    desc: "\u796D\u575B\u4F4E\u8BED\uFF1A\u732E\u4E0A\u4E00\u4EF6\u88C5\u5907\uFF0C\u6362\u53D6\u5B83\u7684\u7CBE\u534E\u6240\u5316\u7684\u91D1\u5E01\u3002",
    options: [
      { label: "\u732E\u796D\u6700\u5DEE\u88C5\u5907 \xB7 +180 \u91D1\u5E01", desc: "\u9500\u6BC1\u80CC\u5305\u8BC4\u5206\u6700\u4F4E\u7684\u4E00\u4EF6\u88C5\u5907\uFF0C\u5F97 180 \u91D1\u5E01", effect: { gold: 180, sacrificeLowest: true } },
      { label: "\u4E0D\u732E\u796D", desc: "\u65E0\u4E8B\u53D1\u751F", effect: {} }
    ]
  };
}
function luckyChest(rng) {
  const win = rng() < 0.5;
  return {
    id: "lucky_chest",
    title: "\u5E78\u8FD0\u5B9D\u7BB1",
    desc: win ? "\u7BB1\u9501\u4E00\u78B0\u5C31\u5F00\uFF0C\u91D1\u5149\u56DB\u6EA2\u2014\u2014\u91CC\u9762\u662F 400 \u91D1\u5E01\uFF01" : "\u7BB1\u91CC\u85CF\u7740\u7684\u4E0D\u662F\u8D22\u5B9D\uFF0C\u800C\u662F\u4E00\u7A9D\u4F0F\u51FB\u7684\u523A\u5BA2\uFF0C\u4F60\u635F\u5931\u4E86 150 \u91D1\u5E01\u624D\u7A81\u56F4\u3002",
    options: [
      { label: win ? "\u5F00\u7BB1 \xB7 +400 \u91D1\u5E01" : "\u5F00\u7BB1 \xB7 -150 \u91D1\u5E01", desc: win ? "\u7A33\u7A33\u843D\u888B" : "\u906D\u9047\u4F0F\u51FB", effect: { gold: win ? 400 : -150 } },
      { label: "\u4E0D\u6253\u5F00", desc: "\u7ED5\u9053\u800C\u884C", effect: {} }
    ]
  };
}

// packages/core/src/gen/levelGen.ts
var MUTATIONS = [
  "\u7981\u7528\u5C04\u624B\u5927\u62DB3\u5C42",
  "\u5168\u573A\u6301\u7EED\u6389\u8840",
  "\u654C\u4EBA\u7A83\u53D6\u62A4\u76FE",
  "\u654C\u65B9\u79FB\u901F\u7FFB\u500D",
  "\u4EC5\u9B54\u6CD5\u4F24\u5BB3"
];
var SPECIAL_ARENAS = [
  ["DRAGON", 7],
  // 疯狂龙巢：3+ 龙巢持续产龙
  ["CAGE", 7],
  // 八角笼：岩浆环绕的 5×6 死斗平台
  ["VAN", 7]
  // 面包车：车队冲锋击退阵型 → 开门逐人下落
];
var NORMAL_WEIGHT = 79;
var SPECIAL_IDS = new Set(SPECIAL_ARENAS.map(([id]) => id));
var SPECIAL_MIN_LAYER = 3;
var DRAGON_BOSS_ONLY = false;
function rollArenaArchetype(rng, layer, mode, bossTier) {
  const allowSpecial = mode !== "novice" && layer >= SPECIAL_MIN_LAYER;
  const table = [["NORMAL", NORMAL_WEIGHT]];
  if (allowSpecial) {
    for (const [id, w] of SPECIAL_ARENAS) {
      if (id === "DRAGON" && DRAGON_BOSS_ONLY && !bossTier) continue;
      table.push([id, w]);
    }
  }
  const total = table.reduce((s, [, w]) => s + w, 0);
  let t = rng() * total;
  let chosen = "NORMAL";
  for (const [id, w] of table) {
    t -= w;
    if (t <= 0) {
      chosen = id;
      break;
    }
  }
  const pool = chosen === "NORMAL" ? ARENA_LIST.filter((a) => !SPECIAL_IDS.has(a.id)) : ARENA_LIST.filter((a) => a.id === chosen);
  return pick(rng, pool.length ? pool : ARENA_LIST);
}
function rollVanEncounter(rng) {
  const [vMin, vMax] = VAN_CFG.vanCountRange;
  const [pMin, pMax] = VAN_CFG.peopleRange;
  const [tMin, tMax] = VAN_CFG.peopleTotalBand;
  const vanCount = vMin + Math.floor(rng() * (vMax - vMin + 1));
  const target = tMin + Math.floor(rng() * (tMax - tMin + 1));
  const peoplePerVan = Math.max(pMin, Math.min(pMax, Math.round(target / vanCount)));
  return {
    vanCount,
    peoplePerVan,
    vanBasePrimary: VAN_CFG.vanBasePrimary,
    personPrimaryMul: VAN_CFG.personPrimaryMul,
    personMoveSpeedAdd: VAN_CFG.personMoveSpeedAdd,
    personAtkSpeedAdd: VAN_CFG.personAtkSpeedAdd,
    openingBuffSec: VAN_CFG.openingBuffSec,
    dropInterval: VAN_CFG.dropInterval,
    concurrentPeopleCap: VAN_CFG.concurrentPeopleCap
  };
}
function ensureBossPlatform(arena) {
  if (arena.tiles.some((row) => row.includes("B"))) return arena;
  const tiles = arena.tiles.map((r) => r.split(""));
  const r0 = 5, c0 = 9;
  for (let dr = 0; dr < 2; dr++) {
    for (let dc = 0; dc < 2; dc++) {
      const r = r0 + dr, c = c0 + dc;
      if (tiles[r] && tiles[r][c] === ".") tiles[r][c] = "B";
    }
  }
  return { ...arena, tiles: tiles.map((r) => r.join("")) };
}
function placeBuildings(rng, arena, layer, ally, enemy, boss) {
  const count = buildingCountFor(layer);
  if (count <= 0) return [];
  const pool = availableBuildings(layer);
  if (!pool.length) return [];
  const cands = [];
  const MARGIN = 2;
  for (let r = MARGIN; r < arena.tiles.length - MARGIN; r++) {
    for (let c = MARGIN; c < arena.tiles[r].length - MARGIN; c++) {
      const ch = arena.tiles[r][c];
      if (ch === "#" || ch === "~" || ch === "S" || ch === "E" || ch === "B" || ch === "M") continue;
      cands.push({ x: c + 0.5, y: r + 0.5 });
    }
  }
  if (!cands.length) return [];
  const d = (a, b) => {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  };
  const MIN_FROM_ALLY = 5.5;
  const MIN_BETWEEN = 4;
  const anchor = enemy.length ? { x: enemy.reduce((s, p) => s + p.x, 0) / enemy.length, y: enemy.reduce((s, p) => s + p.y, 0) / enemy.length } : boss ?? { x: arena.width * 0.75, y: arena.height / 2 };
  const scored = cands.filter((p) => ally.every((a) => d(p, a) >= MIN_FROM_ALLY)).map((p) => ({ p, s: d(p, anchor) - Math.min(...ally.map((a) => d(p, a))) * 0.35 })).sort((a, b) => a.s - b.s);
  if (!scored.length) return [];
  const head = scored.slice(0, Math.max(count * 4, Math.ceil(scored.length * 0.4))).map((e) => e.p);
  const pickKind = () => {
    const total = pool.reduce((s, b) => s + b.weight, 0);
    let t = rng() * total;
    for (const b of pool) {
      t -= b.weight;
      if (t <= 0) return b.kind;
    }
    return pool[pool.length - 1].kind;
  };
  const out = [];
  const used = [];
  let guard = 0;
  while (out.length < count && guard++ < 200) {
    const spot = pick(rng, head);
    if (!spot) break;
    if (used.some((u) => d(u, spot) < MIN_BETWEEN)) continue;
    const kind = pickKind();
    if (kind === "dragon_lair" && out.some((o) => o.kind === "dragon_lair")) continue;
    used.push(spot);
    out.push({ kind, pos: { x: spot.x, y: spot.y } });
  }
  return out;
}
function forceDragonNests(rng, arena, out, count, ally) {
  const d = (a, b) => {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  };
  const cands = [];
  const MARGIN = 3;
  for (let r = MARGIN; r < arena.tiles.length - MARGIN; r++) {
    for (let c = MARGIN; c < arena.tiles[r].length - MARGIN; c++) {
      const ch = arena.tiles[r][c];
      if (ch === "#" || ch === "~" || ch === "S" || ch === "E" || ch === "B" || ch === "M") continue;
      cands.push({ x: c + 0.5, y: r + 0.5 });
    }
  }
  const scored = cands.filter((p) => ally.every((a) => d(p, a) >= 4.5)).sort((a, b) => d(b, { x: arena.width * 0.75, y: arena.height / 2 }) - d(a, { x: arena.width * 0.75, y: arena.height / 2 }));
  let placed = 0, guard = 0;
  while (placed < count && guard++ < 400 && scored.length) {
    const spot = scored[Math.floor(rng() * Math.min(scored.length, Math.max(count * 5, 8)))];
    if (out.some((o) => d(o.pos, spot) < 4)) {
      scored.splice(scored.indexOf(spot), 1);
      continue;
    }
    const wantLair = placed === count - 1 && !out.some((o) => o.kind === "dragon_lair");
    const kind = wantLair ? "dragon_lair" : "dragon_nest";
    out.push({ kind, pos: { x: spot.x, y: spot.y } });
    placed++;
  }
}
function sprinkleLava(arena, rng) {
  const cells = [];
  for (let r = 1; r < arena.tiles.length - 1; r++) {
    for (let c = 1; c < arena.tiles[r].length - 1; c++) {
      if (arena.tiles[r][c] === ".") cells.push({ x: c, y: r });
    }
  }
  if (!cells.length) return;
  const tiles = arena.tiles.map((row) => row.split(""));
  const n = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < n && cells.length; i++) {
    const p = cells.splice(Math.floor(rng() * cells.length), 1)[0];
    tiles[p.y][p.x] = "M";
  }
  arena.tiles = tiles.map((row) => row.join(""));
}
function genLayer(n, seed, mode) {
  const clamped = Math.min(n, DEMO_CAP);
  const rng = mulberry32(seed + n * 7919 >>> 0);
  const bossTier = bossTierAt(clamped, mode);
  let arena = withTheme(rollArenaArchetype(rng, clamped, mode, bossTier), n);
  const vanEncounter = arena.id === "VAN" ? rollVanEncounter(rng) : void 0;
  if (rng() < 0.45 && !arena.tiles.some((row) => row.includes("~"))) {
    sprinkleLava(arena, rng);
  }
  if (bossTier) arena = ensureBossPlatform(arena);
  const rolledWaves = buildWaves(rng, clamped, bossTier);
  const waves = vanEncounter ? [
    Array.from({ length: vanEncounter.vanCount }, () => VAN_ENEMY),
    ...bossTier ? rolledWaves.slice(-1) : []
  ] : rolledWaves;
  const scale = enemyScale(clamped);
  const budget = Math.round(100 * scale.hp * segmentMult(clamped));
  const spawns = parseSpawns(arena);
  const buildings = mode === "novice" || vanEncounter ? [] : placeBuildings(rng, arena, clamped, spawns.ally, spawns.enemy, spawns.boss);
  if (arena.dragonNests && mode !== "novice") {
    forceDragonNests(rng, arena, buildings, arena.dragonNests, spawns.ally);
  }
  const eliteBoss = !!bossTier && clamped % 10 === 0;
  const randomEvent = rollRandomEvent(rng, clamped, !!bossTier);
  return {
    layer: n,
    arena,
    waves,
    buildings,
    isVacuum: isVacuum(clamped),
    isMutation: isMutation(clamped),
    mutationRule: isMutation(clamped) ? pick(rng, MUTATIONS) : void 0,
    encounterBudget: budget,
    spawnAlly: spawns.ally,
    spawnEnemy: spawns.enemy,
    bossPos: spawns.boss,
    bossTier,
    eliteBoss,
    randomEvent,
    vanEncounter
  };
}

// packages/core/src/engine/formulas.ts
var BASE = {
  hp: 100,
  pDmg: 10,
  mDmg: 10,
  atkSpeed: 100,
  crit: 5,
  moveSpeed: 0
};
var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function derive(a) {
  return {
    hp: BASE.hp + a.con * 10,
    pDmg: BASE.pDmg + a.str * 2 + a.con * 0.3,
    mDmg: BASE.mDmg + a.int * 2,
    atkSpeed: clamp(BASE.atkSpeed + a.agi * 0.4, 0, 200),
    dodge: clamp(a.agi * 0.25, 0, 75),
    moveSpeed: clamp(BASE.moveSpeed + a.agi * 0.3, 0, 60),
    crit: clamp(BASE.crit + a.agi * 0.2, 0, 75),
    critDmg: 150 + a.str * 0.5 + a.int * 0.5,
    // 坦克向减伤扩展（需求 5.3）：强壮→物理减伤，智力→魔法减伤
    pResist: clamp(a.con * 0.8, 0, 75),
    mResist: clamp(a.int * 0.8, 0, 75),
    heal: a.int * 1.5 + a.con * 0.5,
    // v1.5 天气字段默认值：无天气时回血 0、受伤 ×1（天气在 BattleSim 构造时覆盖）
    regenPct: 0,
    dmgTakenMult: 1
  };
}

// packages/core/src/content/traits.ts
var TRAITS = {
  bulwark: {
    id: "bulwark",
    name: "\u575A\u58C1",
    desc: "\u6BCF\u53D7\u5230 5 \u6B21\u4F24\u5BB3\uFF0C\u83B7\u5F97\u76F8\u5F53\u4E8E 12% \u6700\u5927\u751F\u547D\u7684\u62A4\u76FE\u3002",
    staticMod: { pResist: 6 }
  },
  spellbreak: {
    id: "spellbreak",
    name: "\u6CD5\u969C",
    desc: "\u53D7\u5230\u9B54\u6CD5\u4F24\u5BB3\u65F6\uFF0C\u53CD\u5F39 20% \u7ED9\u4F24\u5BB3\u6765\u6E90\u3002",
    staticMod: { mResist: 10 }
  },
  momentum: {
    id: "momentum",
    name: "\u52BF\u80FD",
    desc: "\u6BCF\u6B21\u666E\u653B\u53E0\u52A0 1 \u5C42\u653B\u901F +4%\uFF08\u65E0\u8870\u51CF\u3001\u53D7\u51FB\u4E0D\u6E05\u7A7A\uFF0C\u4E0A\u9650 8 \u5C42\uFF09\uFF1B\u5E76\u53E0\u52A0 1 \u5C42\u6280\u80FD\u5438\u8840\uFF08\u6BCF\u5C42 +6% \u6280\u80FD\u56DE\u8840\uFF0C\u4E0A\u9650 8 \u5C42\uFF09\uFF1B\u8131\u6218\uFF081 \u79D2\u672A\u666E\u653B\uFF09\u540E\u6BCF\u79D2\u4E0B\u964D 1 \u5C42\u5438\u8840\u3002"
  },
  bloodedge: {
    id: "bloodedge",
    name: "\u9B54\u5203",
    desc: "\u51FB\u6740\u76EE\u6807\u65F6\u56DE\u590D 20% \u6700\u5927\u751F\u547D\uFF0C\u5927\u62DB\u51B7\u5374\u51CF\u5C11 2 \u79D2\uFF1B\u672C\u573A\u6BCF\u6B21\u51FB\u6740\u6C38\u4E45\u63D0\u5347\u7269\u7406\u653B\u51FB 10%\u3001\u9B54\u6CD5\u4F24\u5BB3 20%\u3002"
  },
  volley: {
    id: "volley",
    name: "\u901F\u5C04",
    desc: "\u8FDE\u7EED\u653B\u51FB\u540C\u4E00\u76EE\u6807\u65F6\u6BCF\u5C42\u4F24\u5BB3 +6%\uFF08\u4E0A\u9650 5 \u5C42\uFF09\uFF0C\u66F4\u6362\u76EE\u6807\u540E\u6E05\u96F6\u3002",
    staticMod: { atkSpeed: 8 }
  },
  lethal: {
    id: "lethal",
    name: "\u81F4\u547D",
    desc: "\u5BF9\u751F\u547D\u503C\u4F4E\u4E8E 40% \u7684\u76EE\u6807\u9020\u6210\u7684\u4F24\u5BB3\u63D0\u9AD8 35%\u3002",
    staticMod: { critDmg: 20 }
  },
  shackle: {
    id: "shackle",
    name: "\u7981\u9522",
    desc: "\u6280\u80FD\u9644\u5E26 1.5 \u79D2 30% \u51CF\u901F\uFF1B\u5BF9\u88AB\u63A7\u5236\u6216\u51CF\u901F\u7684\u76EE\u6807\u4F24\u5BB3\u63D0\u9AD8 25%\u3002"
  },
  legion: {
    id: "legion",
    name: "\u519B\u56E2",
    desc: "\u53EC\u5524\u7269\u6570\u91CF +1\uFF0C\u4E14\u6240\u6709\u53EC\u5524\u7269\u989D\u5916\u7EE7\u627F\u4E3B\u4EBA 25% \u653B\u51FB\u529B\u3002"
  },
  grace: {
    id: "grace",
    name: "\u6069\u6CFD",
    desc: "\u6CBB\u7597\u6EA2\u51FA\u7684\u90E8\u5206\uFF0C60% \u8F6C\u5316\u4E3A\u76EE\u6807\u7684\u62A4\u76FE\u3002",
    staticMod: { heal: 15 }
  },
  // ── vX 用户新增 6 特性（效果均为「在基础数值上额外独立乘」）──
  fury: {
    id: "fury",
    name: "\u6124\u6012\u71C3\u70E7\u8005",
    desc: "\u6BCF\u6709 1 \u540D\u53CB\u519B\u82F1\u96C4\u9635\u4EA1\uFF0C\u53CC\u653B\u4E0E\u653B\u901F +10%\uFF08\u72EC\u7ACB\u4E58\uFF0C\u53EF\u53E0\u52A0\uFF09\u3002"
  },
  heart: {
    id: "heart",
    name: "\u5927\u5FC3\u810F",
    desc: "\u82E5 4 \u79D2\u5185\u7D2F\u8BA1\u53D7\u4F24 < 50% \u6700\u5927\u751F\u547D\uFF0C\u5219\u56DE\u590D 50% \u751F\u547D\uFF0C\u5E76\u6C38\u4E45 +2% \u653B\u901F\u3001+2% \u53CC\u653B\u3002"
  },
  slowburn: {
    id: "slowburn",
    name: "\u6162\u70ED\u578B",
    desc: "\u5F00\u5C40\u653B\u901F -30%\u3001\u53CC\u653B -40%\uFF1B\u4E4B\u540E\u6BCF\u79D2\u5168\u5C5E\u6027 +2%\uFF08\u72EC\u7ACB\u4E58\uFF09\u3002",
    // 开局削用乘区（staticMul）：-30% 攻速 = ×0.7，-40% 双攻 = ×0.6。
    // 注意 staticMod 是加性百分点，pDmg/mDmg 是伤害值不是百分点，不能用 staticMod 做 -40%。
    staticMul: { atkSpeed: 0.7, pDmg: 0.6, mDmg: 0.6 }
  },
  spacetime: {
    id: "spacetime",
    name: "\u65F6\u7A7A\u62D3\u5370",
    desc: "\u5E03\u9635\u53EF\u7AD9\u5168\u56FE\u4EFB\u610F\u53EF\u7AD9\u683C\uFF1B\u82E5 3 \u79D2\u5185\u7D2F\u8BA1\u53D7\u4F24 > 30% \u6700\u5927\u751F\u547D\uFF0C\u77AC\u79FB\u5230 4 \u683C\u5916\uFF08\u6BCF 6 \u79D2\u6700\u591A\u4E00\u6B21\uFF09\u3002"
  },
  returner: {
    id: "returner",
    name: "\u5F52\u6765\u8005",
    desc: "\u9632\u5FA1\u6052\u4E3A 0\uFF1B\u6BCF\u573A\u53EF\u6B7B\u4E00\u6B21\uFF0C\u6B7B\u4EA1\u968F\u673A 1 \u9879\u5C5E\u6027\u6C38\u4E45 +4%\uFF08\u5E26\u51FA\uFF09\uFF0C\u590D\u6D3B\u540E\u4F53\u578B +30%\u3001\u5C04\u7A0B +2\u3001\u653B\u901F/\u79FB\u901F +15%\uFF0C\u6BCF\u79D2\u6D41\u5931 8% \u751F\u547D\u3002"
  },
  grower: {
    id: "grower",
    name: "\u6210\u957F\u8005",
    desc: "\u521D\u59CB\u5168\u5C5E\u6027 -15%\u3001\u4F53\u578B -30%\uFF1B\u6BCF\u6B21\u51FB\u6740/\u52A9\u653B\u5168\u5C5E\u6027 +10%\uFF08\u72EC\u7ACB\u4E58\uFF09\u4E14\u4F53\u578B +0.2%~1%\uFF1B\u4EC5\u80FD\u88C5\u5907 3 \u4EF6\uFF1B30% \u6982\u7387\u79D2\u6740\u4F53\u578B\u66F4\u5C0F\u7684\u654C\u4EBA\u3002",
    // 初始全属性 -15%：pDmg/mDmg/hp/atkSpeed/moveSpeed 各 ×0.85。体型 -30% 在 unit.ts 用 sizeScale 处理（离散体型无法连续缩放）。
    staticMul: { pDmg: 0.85, mDmg: 0.85, hp: 0.85, atkSpeed: 0.85, moveSpeed: 0.85 }
  }
};
var ALL_TRAIT_IDS = [
  "bulwark",
  "spellbreak",
  "momentum",
  "bloodedge",
  "volley",
  "lethal",
  "shackle",
  "legion",
  "grace",
  "fury",
  "heart",
  "slowburn",
  "spacetime",
  "returner",
  "grower"
];
function rollTrait(rng) {
  return pick(rng, ALL_TRAIT_IDS);
}
function applyTraitStatic(d, traitId) {
  if (!traitId) return d;
  const def = TRAITS[traitId];
  if (!def) return d;
  let out = { ...d };
  const mod = def.staticMod;
  if (mod) {
    for (const [k, v] of Object.entries(mod)) {
      const cur = out[k];
      if (typeof cur === "number" && typeof v === "number") {
        out[k] = cur + v;
      }
    }
  }
  const mul = def.staticMul;
  if (mul) {
    for (const [k, v] of Object.entries(mul)) {
      const cur = out[k];
      if (typeof cur === "number" && typeof v === "number") {
        out[k] = cur * v;
      }
    }
  }
  return out;
}
var TRAIT_CFG = {
  bulwarkHitsPerShield: 5,
  bulwarkShieldPct: 0.12,
  spellbreakReflect: 0.2,
  momentumPerStack: 4,
  // 攻速百分点
  momentumMaxStacks: 8,
  momentumLifestealPerStack: 0.06,
  // v3.0 每层技能吸血比例（冲锋等大招回血）
  momentumLifestealMax: 8,
  // v3.0 技能吸血层数上限
  bloodedgeHealPct: 0.2,
  bloodedgeCdCut: 2,
  // 秒（大招冷却减少）
  bloodedgePdmgPerKill: 0.1,
  // vX 每次击杀永久提升物理攻击（本局叠加）
  bloodedgeMdmgPerKill: 0.2,
  // vX 每次击杀永久提升魔法伤害（本局叠加）
  volleyPerStack: 0.06,
  volleyMaxStacks: 5,
  lethalThreshold: 0.4,
  lethalBonus: 0.35,
  shackleSlowPct: 30,
  shackleSlowDur: 1.5,
  shackleBonus: 0.25,
  legionExtraSummon: 1,
  legionAtkInherit: 0.25,
  graceOverhealToShield: 0.6,
  // ── vX 新增 6 特性数值常量（集中管理，便于平衡）──
  furyPerDeathPct: 0.1,
  // 愤怒燃烧者：每友军亡 双攻&攻速 +10%（独立乘）
  heartWindow: 4,
  // 大心脏：滚动窗口秒
  heartHealPct: 0.5,
  // 大心脏：窗口内少受伤则回血 50% 最大生命
  heartAsPct: 0.02,
  // 大心脏：回复时永久 +2% 攻速
  heartDmgPct: 0.02,
  // 大心脏：回复时永久 +2% 双攻
  slowRampPct: 0.02,
  // 慢热型：每秒全属性 +2%（独立乘）
  stWindow: 3,
  // 时空拓印：受伤窗口秒
  stLossPct: 0.3,
  // 时空拓印：窗口内受伤 >30% 最大生命触发瞬移
  stMinDist: 4,
  // 时空拓印：瞬移到至少 4 格外
  stCd: 6,
  // 时空拓印：瞬移冷却秒
  returnerReviveHpPct: 0.6,
  // 归来者：复活时血量 = 60% 最大生命
  returnerBodyPct: 0.3,
  // 归来者：复活体型 +30%
  returnerRange: 2,
  // 归来者：复活射程 +2
  returnerAsPct: 0.15,
  // 归来者：复活攻速 +15%（独立乘）
  returnerMsPct: 0.15,
  // 归来者：复活移速 +15%（独立乘）
  returnerDrainPct: 0.08,
  // 归来者：复活后每秒流失 8% 最大生命
  returnerPermanentPct: 4,
  // 归来者：死亡永久成长 +4%（带出；creditKillGrowth 用 mul=4）
  growerBodyPct: 0.3,
  // 成长者：开局体型 -30%
  growerRampPct: 0.1,
  // 成长者：每次击杀/助攻 全属性 +10%（独立乘）
  growerInstakillP: 0.3,
  // 成长者：30% 概率秒杀体型更小的敌人
  growerBodyMin: 2e-3,
  // 成长者：击杀/助攻体型增长下限 0.2%
  growerBodyMax: 0.01,
  // 成长者：击杀/助攻体型增长上限 1.0%
  growerEquipCap: 3
  // 成长者：仅能装备 3 件
};
var STAGE2_CFG = {
  tauntHpGate: 0.7,
  tauntWaveRatio: 0.5,
  wardMissingBonusMax: 0.6,
  chargeHpGate: 0.5,
  chargeBurstMult: 1.6,
  hexburstLifestealPct: 0.03,
  barrageRampPerShot: 0.2,
  // 贯日神射「必暴」血线。注意这是暴击门槛，不是伤害倍率门槛——
  // 伤害恒为 400%，过线只改变「是否必定暴击」
  deadshotCritHpGate: 0.5,
  timelockRootGate: 3,
  timelockCdRefund: 0.4,
  summonEmpowerPct: 0.3,
  // 强化层数上限：不设上限的话「召唤位满 → 每轮CD强化」会指数膨胀，
  // 深层召唤流会直接压过其他所有流派。3 层 = 攻击约 ×2.2，是明确收益但不失控。
  summonEmpowerCap: 3,
  summonEmpowerExtendSec: 3,
  grouphealMissingWeight: 1.2
};

// packages/core/src/content/mounts.ts
var MOUNT_RARITY = {
  blue: { cn: "\u84DD", mult: 1, weight: 55, color: "#5aa2ff" },
  orange: { cn: "\u6A59", mult: 1.5, weight: 33, color: "#ff9a3c" },
  purple: { cn: "\u7D2B", mult: 2.2, weight: 12, color: "#c07bff" }
};
var MOUNT_RARITY_KEYS = ["blue", "orange", "purple"];
function rollMountRarity(rng) {
  const total = MOUNT_RARITY_KEYS.reduce((s, k) => s + MOUNT_RARITY[k].weight, 0);
  let t = rng() * total;
  for (const k of MOUNT_RARITY_KEYS) {
    t -= MOUNT_RARITY[k].weight;
    if (t <= 0) return k;
  }
  return "blue";
}
var MOUNTS = {
  elephant: {
    kind: "elephant",
    name: "\u6218\u8C61",
    desc: "\u62AB\u7532\u5DE8\u8C61\u3002\u8E0F\u5730\u5982\u64C2\u9F13\uFF0C\u56DB\u5468\u654C\u4EBA\u7AD9\u4E0D\u7A33\u811A\u3002\u751F\u5B58\u4E0E\u786C\u63A7\u6362\u673A\u52A8\u3002",
    ride: { hpPct: 0.25, pResistAdd: 8, moveSpeedAdd: -8 },
    skill: {
      id: "mount_stomp",
      name: "\u5DE8\u8C61\u8E0F\u9635",
      cd: 11,
      damageType: "physical",
      desc: "\u5DE8\u8C61\u524D\u8DB3\u8E0F\u5730\uFF0C2.8 \u683C\u5185\u654C\u4EBA\u53D7 220% \u7269\u4F24\u5E76\u7729\u6655 1.2 \u79D2",
      skillStyle: "melee_burst",
      castRange: 2.8
    },
    body: "#8d8f9c",
    dark: "#5b5d68",
    accent: "#c9a227"
  },
  leopard: {
    kind: "leopard",
    name: "\u7384\u8C79",
    desc: "\u9ED1\u7EB9\u91D1\u77B3\u7684\u730E\u8C79\u3002\u9501\u5B9A\u6B8B\u8840\u76EE\u6807\u4E00\u8DC3\u5373\u81F3\uFF0C\u4E13\u53F8\u6536\u5272\u3002",
    ride: { critAdd: 10, moveSpeedAdd: 18, atkSpeedAdd: 8 },
    skill: {
      id: "mount_pounce",
      name: "\u75BE\u5F71\u730E\u6740",
      cd: 9,
      damageType: "physical",
      desc: "\u6251\u5411 7 \u683C\u5185\u8840\u91CF\u6700\u4F4E\u7684\u654C\u4EBA\uFF0C\u9020\u6210 300% \u7269\u4F24\u4E14\u5FC5\u5B9A\u66B4\u51FB",
      skillStyle: "charge_dash",
      castRange: 7
    },
    body: "#2f2b3a",
    dark: "#1a1722",
    accent: "#e8b23a"
  },
  tiger: {
    kind: "tiger",
    name: "\u767D\u989D\u864E",
    desc: "\u989D\u6709\u738B\u7EB9\u7684\u731B\u864E\u3002\u4E00\u58F0\u957F\u5578\uFF0C\u56DB\u65B9\u80C6\u5BD2\u2014\u2014\u654C\u4EBA\u8FDF\u6EDE\uFF0C\u9A91\u624B\u6C14\u76DB\u3002",
    ride: { pDmgPct: 0.18, critAdd: 5, hpPct: 0.08 },
    skill: {
      id: "mount_roar",
      name: "\u731B\u864E\u5578\u5C71",
      cd: 12,
      damageType: "physical",
      desc: "\u864E\u5578\u6151\u654C\uFF1A4 \u683C\u5185\u654C\u4EBA\u51CF\u901F 50% \u6301\u7EED 2.5 \u79D2\uFF0C\u81EA\u8EAB\u4F24\u5BB3\u63D0\u5347 25% \u6301\u7EED 5 \u79D2",
      skillStyle: "bulwark_taunt",
      castRange: 4
    },
    body: "#e8c07a",
    dark: "#8a6231",
    accent: "#2b2b2b"
  },
  redhare: {
    kind: "redhare",
    name: "\u8D64\u5154",
    desc: "\u65E5\u884C\u5343\u91CC\u7684\u8D64\u8272\u795E\u9A79\u3002\u5B83\u5E26\u8D77\u7684\u98CE\u4F1A\u63A8\u7740\u6574\u6761\u6218\u7EBF\u4E00\u8D77\u524D\u8FDB\u3002",
    ride: { moveSpeedAdd: 30, atkSpeedAdd: 12, dodgeAdd: 6 },
    skill: {
      id: "mount_gallop",
      name: "\u5343\u91CC\u795E\u9A79",
      cd: 14,
      damageType: "physical",
      desc: "\u7B56\u9A6C\u626C\u5C18\uFF1A\u81EA\u8EAB\u4E0E 5 \u683C\u5185\u53CB\u519B\u79FB\u901F +60%\u3001\u653B\u901F +25%\uFF0C\u6301\u7EED 5 \u79D2",
      skillStyle: "blessing_field",
      castRange: 5
    },
    body: "#c0392b",
    dark: "#7b2318",
    accent: "#f0d060"
  },
  ox: {
    kind: "ox",
    name: "\u86EE\u725B",
    desc: "\u53CC\u89D2\u5305\u94C1\u7684\u5DE8\u725B\u3002\u4F4E\u5934\u51B2\u8D77\u6765\u5C31\u4E0D\u4F1A\u62D0\u5F2F\uFF0C\u6B63\u9762\u6321\u8DEF\u7684\u5168\u90E8\u649E\u98DE\u3002",
    ride: { hpPct: 0.18, pDmgPct: 0.12, pResistAdd: 5, moveSpeedAdd: -4 },
    skill: {
      id: "mount_gore",
      name: "\u86EE\u725B\u51B2\u649E",
      cd: 10,
      damageType: "physical",
      desc: "\u6CBF\u76F4\u7EBF\u51B2\u649E 6 \u683C\uFF0C\u9014\u7ECF\u654C\u4EBA\u53D7 200% \u7269\u4F24\u3001\u88AB\u649E\u5F00\u5E76\u5B9A\u8EAB 1 \u79D2",
      skillStyle: "charge_dash",
      castRange: 6
    },
    body: "#4a4238",
    dark: "#2a251f",
    accent: "#d9cbb0"
  }
};
var MOUNT_KINDS = ["elephant", "leopard", "tiger", "redhare", "ox"];
function rollMount(rng) {
  return MOUNT_KINDS[Math.floor(rng() * MOUNT_KINDS.length)];
}

// packages/core/src/engine/unit.ts
var uid = 0;
var nextId = () => `u${uid++}`;
var resetUid = (n = 0) => {
  uid = n;
};
var clampE = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function applyEquipment(base2, eqs) {
  const d = { ...base2 };
  const pctAcc = {};
  const famCount = /* @__PURE__ */ new Map();
  for (const eq of eqs) {
    if (eq.family) famCount.set(eq.family, (famCount.get(eq.family) ?? 0) + 1);
  }
  const famMult = /* @__PURE__ */ new Map();
  for (const [fam, n] of famCount) famMult.set(fam, 1 + 0.05 * Math.min(5, n));
  for (const eq of eqs) {
    const sm = eqStarMult(eq);
    const fm = eq.family ? famMult.get(eq.family) ?? 1 : 1;
    for (const a of eq.affixes) {
      const v = a.value * sm * fm;
      if (a.mode === "pct") pctAcc[a.key] = (pctAcc[a.key] ?? 0) + v;
      else d[a.key] += v;
    }
  }
  for (const [k, v] of Object.entries(pctAcc)) {
    d[k] = d[k] * (1 + v / 100);
  }
  d.hp = Math.round(d.hp);
  d.pDmg = Math.round(d.pDmg);
  d.mDmg = Math.round(d.mDmg);
  d.dodge = clampE(d.dodge, 0, 90);
  d.moveSpeed = clampE(d.moveSpeed, 0, 80);
  d.crit = clampE(d.crit, 0, 90);
  d.atkSpeed = clampE(d.atkSpeed, 0, 250);
  return d;
}
function primaryAtLevel(base2, growth, level, star = 1, bonusPct) {
  const lv = level - 1;
  const sm = starMult(star);
  const gb = starGrowthBonus(star);
  const bp = (k) => 1 + (bonusPct?.[k] ?? 0) / 100;
  return {
    con: (base2.con * sm + (growth.con + gb) * lv) * bp("con"),
    str: (base2.str * sm + (growth.str + gb) * lv) * bp("str"),
    agi: (base2.agi * sm + (growth.agi + gb) * lv) * bp("agi"),
    int: (base2.int * sm + (growth.int + gb) * lv) * bp("int")
  };
}
function applyBody(d, body) {
  const b = BODY_INFO[body];
  return {
    ...d,
    hp: Math.round(d.hp * b.hpMult),
    moveSpeed: d.moveSpeed * b.msMult,
    atkSpeed: d.atkSpeed * b.asMult,
    dodge: Math.max(0, Math.min(75, d.dodge + b.dodgeBonus))
  };
}
function applyGender(d, g) {
  if (g === "female") {
    return {
      ...d,
      atkSpeed: clampE(d.atkSpeed + 8, 0, 250),
      crit: clampE(d.crit + 5, 0, 90)
    };
  }
  if (g === "male") {
    return {
      ...d,
      critDmg: d.critDmg + 25,
      hp: Math.round(d.hp * 1.08)
    };
  }
  return d;
}
var hashStr2 = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i) >>> 0;
  return h;
};
var genderOf = (def, key) => def ?? ((hashStr2(key ?? "") & 1) === 0 ? "female" : "male");
var combatParamsOf = (key) => {
  const h = hashStr2(key ?? "");
  return {
    lightAs: 130 + (h & 31),
    // 130~161
    heavyAs: 26 + (h >>> 5 & 31),
    // 26~57
    heavyAt: 3 + (h >>> 10) % 6,
    // 3~8
    heavyBurstCount: 1 + (h >>> 16 & 1)
    // 1~2
  };
};
function applyGrowthPct(d, g) {
  const pct = g?.secondaryPct;
  if (!pct) return d;
  const out = { ...d };
  for (const [k, v] of Object.entries(pct)) {
    if (!v) continue;
    out[k] = out[k] * (1 + v / 100);
  }
  out.hp = Math.round(out.hp);
  out.pDmg = Math.round(out.pDmg);
  out.mDmg = Math.round(out.mDmg);
  return out;
}
function applyMount(d, kind, rarity) {
  if (!kind) return d;
  const r = MOUNTS[kind].ride;
  const m = rarity ? MOUNT_RARITY[rarity].mult : 1;
  const out = { ...d };
  if (r.hpPct) out.hp = Math.round(out.hp * (1 + r.hpPct * m));
  if (r.pDmgPct) out.pDmg = Math.round(out.pDmg * (1 + r.pDmgPct * m));
  if (r.moveSpeedAdd) out.moveSpeed = clampE(out.moveSpeed + r.moveSpeedAdd * m, 0, 95);
  if (r.atkSpeedAdd) out.atkSpeed = clampE(out.atkSpeed + r.atkSpeedAdd * m, 0, 260);
  if (r.critAdd) out.crit = clampE(out.crit + r.critAdd * m, 0, 92);
  if (r.pResistAdd) out.pResist = clampE(out.pResist + r.pResistAdd * m, 0, 80);
  if (r.dodgeAdd) out.dodge = clampE(out.dodge + r.dodgeAdd * m, 0, 90);
  return out;
}
var displayName = (hero) => hero.personalName || hero.name;
function makeAlly(hero, level, equipment = [], opts = {}) {
  const star = hero.star ?? 1;
  const bodyType = hero.bodyType ?? SUBCLASS_INFO[hero.subclass].defaultBody;
  const gender = genderOf(hero.gender, hero.name + hero.subclass);
  const tBase = hero.templateBase ?? hero.basePrimary;
  const growRate = (k) => Math.max(0.25, Math.min(1.75, (hero.basePrimary[k] || 0) / (tBase[k] || hero.basePrimary[k] || 1)));
  const growth = {
    con: hero.growth.con * growRate("con"),
    str: hero.growth.str * growRate("str"),
    agi: hero.growth.agi * growRate("agi"),
    int: hero.growth.int * growRate("int")
  };
  const primary = primaryAtLevel(hero.basePrimary, growth, level, star, hero.bonusPct);
  const gp = hero.growthBonus?.primary;
  if (gp) {
    for (const k of ["con", "str", "agi", "int"]) {
      primary[k] += gp[k] ?? 0;
    }
  }
  if (opts.burst) {
    const k = dominantPrimary(hero.basePrimary);
    primary[k] *= BURST_MULT;
  }
  let skillCdr = 0;
  for (const eq of equipment) {
    if (eq.special === hero.subclass) {
      const k = dominantPrimary(hero.basePrimary);
      primary[k] *= 1.2;
      skillCdr = Math.min(0.45, 0.1 + ((eq.star ?? 1) - 1) * 0.05);
      break;
    }
  }
  const totalSkillCdr = Math.min(0.55, skillCdr + skillStarCdr(star));
  const derived = applyMount(
    applyTraitStatic(
      applyGrowthPct(applyGender(applyBody(applyEquipment(derive(primary), equipment), bodyType), gender), hero.growthBonus),
      hero.traitId
    ),
    hero.mount,
    hero.mountRarity
  );
  if (hero.mods) {
    if (hero.mods.hpMul) derived.hp *= hero.mods.hpMul;
    if (hero.mods.pDmgMul) derived.pDmg *= hero.mods.pDmgMul;
    if (hero.mods.atkSpeedMul) derived.atkSpeed *= hero.mods.atkSpeedMul;
    if (hero.mods.moveSpeedMul) derived.moveSpeed *= hero.mods.moveSpeedMul;
  }
  if (hero.subclass === "physTank" || hero.subclass === "magicTank") {
    derived.atkSpeed *= 0.9;
  }
  const mountSkill = hero.mount ? MOUNTS[hero.mount].skill : void 0;
  const u = {
    id: nextId(),
    side: "ally",
    mount: hero.mount,
    mountRarity: hero.mountRarity,
    // v2.9.3 坐骑品质（渲染光环 + 面板展示）
    mountSkill,
    mountCd: mountSkill ? mountSkill.cd * 0.4 : void 0,
    name: displayName(hero),
    title: hero.name,
    // v3.1 职业称号（战斗 HUD / 战报里与姓名成对展示）
    personality: hero.personality,
    // v3.1 性格 → battle.ts::acquireTarget 索敌偏好
    category: hero.category,
    subclass: hero.subclass,
    damageType: SUBCLASS_INFO[hero.subclass].damageType,
    x: 0,
    y: 0,
    hp: derived.hp,
    maxHp: derived.hp,
    primary,
    derived,
    cd: 0,
    skill: hero.skill,
    skillCd: 0,
    alive: true,
    shield: 0,
    rootUntil: 0,
    stunUntil: 0,
    tauntUntil: 0,
    dmgMult: 1,
    level,
    flash: 0,
    bodyType,
    gender,
    hitRadius: hitRadiusOf(bodyType),
    star,
    dupIndex: hero.dupIndex ?? 1,
    traitId: hero.traitId,
    traitStacks: 0,
    traitTimer: 0,
    heroUid: hero.uid,
    // v1.7 §2：击杀成长的记账凭据
    // v2.9 轻/重击节奏（确定性派生，不消耗战斗随机流）
    // 第三参数只对我方治疗职业开：敌方邪术祭司走原随机节奏，不吃这套治疗定档
    ...initCombat(
      genderOf(hero.gender, hero.name + hero.subclass),
      hero.name + hero.subclass,
      hero.subclass === "healer"
    ),
    // v2.9.3 基础移速（衰减基准）：agi 派生 × 体型乘子（装备/坐骑/天气是"加成"不算基础）
    baseMove: derive(primary).moveSpeed * BODY_INFO[bodyType].msMult,
    // v2.9.3 专属红装 + v3.1 星级冷却缩减（合并后封顶 0.55）
    skillCdr: totalSkillCdr > 0 ? totalSkillCdr : void 0,
    // v3.1 升星强化签名技：技能等级 = 星级，效果 +18%/星
    skillPower: skillPowerMult(star)
  };
  if (hero.traitId === "grower") u.sizeScale = 1 - TRAIT_CFG.growerBodyPct;
  if (hero.traitId === "returner") {
    u.derived.pResist = 0;
    u.derived.mResist = 0;
  }
  return u;
}
var HEALER_RHYTHM = {
  heavyAt: 3,
  // 每 3 次轻击触发一次群疗（原随机 3~8）
  heavyBurstCount: 2,
  // 群疗连打 2 拍：把"奶到了"做成一个能看见的双段事件
  heavyAs: 70
  // 休息期 = 攻击间隔 × 100/70 ≈ 1.43×（原 26~57 档 → 1.8~3.8×）
};
var initCombat = (g, key, healRhythm = false) => {
  const base2 = combatParamsOf(key + ":" + g);
  const p = healRhythm ? { ...base2, ...HEALER_RHYTHM } : base2;
  return {
    // 治疗职业 combo 预充满：进入射程的第一拍就是群疗。
    // 与女娲「开局立即造化」同构——开场即有可见的职业身份表达；
    // 满血开场时这一拍经「恩泽」转成全队护盾，提前量变成资源而不是空放。
    combo: healRhythm ? p.heavyAt : 0,
    heavyAt: p.heavyAt,
    heavyBurst: p.heavyBurstCount,
    heavyBurstCount: p.heavyBurstCount,
    heavyLock: 0,
    lightAs: p.lightAs,
    heavyAs: p.heavyAs,
    heavyArmorUntil: 0,
    isHeavyHit: false,
    heavyReady: false
  };
};
function makeEnemy(enemy, level, scaleHp, scaleDmg) {
  const bodyType = enemy.bodyType ?? SUBCLASS_INFO[enemy.subclass].defaultBody;
  const gender = genderOf(enemy.gender, enemy.name + enemy.subclass);
  const primary = primaryAtLevel(enemy.basePrimary, { con: 1, str: 1, agi: 1, int: 1 }, level);
  const derived = applyGender(applyBody(derive(primary), bodyType), gender);
  derived.hp = Math.round(derived.hp * scaleHp);
  const maxHp = derived.hp;
  return {
    id: nextId(),
    side: "enemy",
    name: enemy.name,
    category: enemy.category,
    subclass: enemy.subclass,
    damageType: enemy.skill ? SUBCLASS_INFO[enemy.subclass].damageType : "physical",
    x: 0,
    y: 0,
    hp: maxHp,
    maxHp,
    primary,
    derived,
    cd: 0,
    skill: enemy.skill ?? { id: "none", name: "\u666E\u653B", cd: 0, damageType: "physical", desc: "" },
    skillCd: 0,
    alive: true,
    shield: 0,
    rootUntil: 0,
    stunUntil: 0,
    tauntUntil: 0,
    dmgMult: scaleDmg,
    level,
    isBoss: enemy.isBoss,
    flash: 0,
    bodyType,
    gender,
    hitRadius: hitRadiusOf(bodyType) * (enemy.isBoss ? 1.6 : 1),
    monsterKind: enemy.monsterKind,
    // v2.5：西方怪物皮，驱动独立精灵模板
    // v1.8.4 兽类专属特性：透传 + 运行时状态初始化（免疫 0=无、nest 未产）
    beastTrait: enemy.beastTrait,
    immunityPhase: 0,
    nestDone: false,
    // v2.9 轻/重击节奏（确定性派生）
    ...initCombat(gender, enemy.name + enemy.subclass),
    // v2.9.3 基础移速（衰减基准）
    baseMove: derive(primary).moveSpeed * BODY_INFO[bodyType].msMult
  };
}

// packages/core/src/content/summons.ts
var SUMMON_TEMPLATES = {
  bulwark: {
    kind: "bulwark",
    name: "\u77F3\u9B42\u536B",
    bodyType: "heavy",
    hpRatio: 2.2,
    atkRatio: 0.6,
    moveMult: 0.75,
    range: 1.1,
    duration: 18,
    // 要撑过一整个交火窗口才有意义
    color: "#8a7a5a",
    riftColor: "#8a7a5a",
    riftW: 30,
    riftH: 54,
    // 最宽的裂隙 = 最重的出场
    spawnAnim: 0.35,
    logReason: "\u9635\u7EBF\u544A\u6025"
  },
  sprinter: {
    kind: "sprinter",
    name: "\u5F71\u5203\u4EC6",
    bodyType: "petite",
    hpRatio: 0.8,
    atkRatio: 1.3,
    moveMult: 1.6,
    // 全场最快。「极速冲刺」四个字必须由数值兑现
    range: 1.1,
    duration: 10,
    // 冲刺型只在窗口期有用，长了就是站场刷屏
    color: "#4a2a6a",
    riftColor: "#4a2a6a",
    riftW: 12,
    riftH: 40,
    // 细长裂隙 + 0.08s 瞬开
    spawnAnim: 0.08,
    logReason: "\u6355\u6349\u6B8B\u8840"
  },
  arcanist: {
    kind: "arcanist",
    name: "\u5492\u706B\u7075",
    bodyType: "light",
    hpRatio: 0.9,
    atkRatio: 1.1,
    moveMult: 1,
    range: 5.5,
    duration: 14,
    // 消耗需要时间累积，但不该盖过本体
    color: "#ff6b2a",
    riftColor: "#ff6b2a",
    riftW: 22,
    riftH: 40,
    spawnAnim: 0.4,
    // 由火星聚合成形
    logReason: "\u6218\u7EBF\u80F6\u7740"
  }
};
var MAX_SUMMONS = 2;
function pickSummonKind(allies, enemies, lastKind) {
  const order = [];
  const aliveTanks = allies.filter(
    (u) => u.alive && !u.isSummon && (u.subclass === "physTank" || u.subclass === "magicTank")
  ).length;
  if (aliveTanks === 0) order.push("bulwark");
  const hasWounded = enemies.some((u) => u.alive && u.hp / Math.max(1, u.maxHp) < 0.4);
  if (hasWounded) order.push("sprinter");
  order.push("arcanist");
  for (const k of ["bulwark", "sprinter", "arcanist"]) {
    if (!order.includes(k)) order.push(k);
  }
  const kind = order.find((k) => k !== lastKind) ?? order[0];
  return { kind, reason: SUMMON_TEMPLATES[kind].logReason };
}

// packages/core/src/engine/battle/common.ts
var clamp2 = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
var BOSS_CLONE_COUNT = 2;
var BOSS_CLONE_HP = 0.5;
var BOSS_CLONE_DMG = 0.6;
var BOSS_CLONE_DURATION = 8;
var dist = (a, b) => {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
};
var len2d = (dx, dy) => Math.sqrt(dx * dx + dy * dy);
var bId = 0;
var nextBuildingId = () => `b${bId++}`;
var resetBuildingId = (n = 0) => {
  bId = n;
};

// packages/core/src/engine/coherence.ts
var ENEMY_FOCUS_DEFAULT = {
  onsetFloor: 8,
  applyChance: 0.18,
  frontMutualP: 0.3,
  backShackleP: 0.4,
  backShackleT: 8,
  maxFrontPerBattle: 2,
  maxBackPerBattle: 1
};
var CFG2 = ENEMY_FOCUS_DEFAULT;
function getEnemyFocus() {
  return CFG2;
}
function power(u) {
  return u.derived.pDmg + u.derived.mDmg + 0.05 * u.derived.hp;
}
function aliveHeroes(units) {
  return units.filter(
    (u) => u.side === "ally" && u.alive && !u.isSummon && !u.isBuilding && power(u) > 0
  );
}
function findStrongestAlly(units) {
  const allies = aliveHeroes(units);
  if (!allies.length) return null;
  return allies.reduce((best, u) => power(u) > power(best) ? u : best, allies[0]);
}
function applyEnemyFocus(units, layer, rng) {
  if (layer < CFG2.onsetFloor) return;
  for (const u of units) {
    if (u.side !== "enemy" || u.isSummon || u.isBoss) continue;
    if (rng() >= CFG2.applyChance) continue;
    const range = SUBCLASS_INFO[u.subclass].attackRange;
    u.focusRole = range <= 2.5 ? "front" : "back";
  }
}

// packages/core/src/engine/battle/relics.ts
function applyRelics(units, relics) {
  for (const r of relics) {
    const mod = r.mod;
    if (!mod) continue;
    for (const u of units) {
      if (u.side !== "ally") continue;
      if (mod.dmgMult) u.dmgMult *= mod.dmgMult;
      if (mod.hpMult) {
        u.derived.hp = Math.round(u.derived.hp * mod.hpMult);
        u.maxHp = u.derived.hp;
        u.hp = u.derived.hp;
      }
      for (const k of Object.keys(mod)) {
        if (k === "dmgMult" || k === "hpMult") continue;
        const val = mod[k];
        if (typeof val === "number" && k in u.derived) {
          u.derived[k] += val;
        }
      }
    }
  }
}

// packages/core/src/engine/battle.ts
var CORPSE_TTL = 1.2;
var MAX_FLOATERS = 70;
var VAN_OPENING_SPEED_MUL = 2;
var VAN_RAM_MUL = 1.1;
var VAN_RAM_KNOCKBACK = 1.6;
var MAX_EFFECTS = 64;
var TRAIT_VFX = {
  lethal: { color: "#ff4d6a", shape: "blade" },
  shackle: { color: "#9a7bff", shape: "ring" },
  volley: { color: "#ffae3d", shape: "trail" },
  bulwark: { color: "#6fd3ff", shape: "bubble" },
  spellbreak: { color: "#b07bff", shape: "beam" },
  heart: { color: "#ff7a9a", shape: "ring" },
  spacetime: { color: "#7fe3ff", shape: "rift" }
};
var NUWA_ATTACK_CDR = 1;
var NUWA_SKILL_ID = "summon";
var HEALER_LIGHT_DMG_MULT = 0.5;
var HEAL_BURST_SPLIT = 0.6;
var BattleSim = class {
  constructor(units, arena, seed) {
    __publicField(this, "units", []);
    __publicField(this, "projectiles", []);
    __publicField(this, "floaters", []);
    __publicField(this, "effects", []);
    __publicField(this, "time", 0);
    __publicField(this, "over", false);
    __publicField(this, "result", null);
    __publicField(this, "W");
    __publicField(this, "H");
    __publicField(this, "rng");
    // vX 队伍协同系数（反"堆一人"）：仅由开局我方单位派生属性算出，确定性、对 replay 一致。
    // 在 applyDamage 中对我方攻击者乘上 → 均衡队输出拉满、一人独大则被压。
    // 反"堆一人"·敌方针对最强（coherence.ts）：层数 + 每场触发计数 + 配置。
    __publicField(this, "layer", 0);
    __publicField(this, "frontMutualCount", 0);
    __publicField(this, "backShackleCount", 0);
    __publicField(this, "enemyFocus", ENEMY_FOCUS_DEFAULT);
    // v2.9 轻/重击伤害扰动专用独立随机流：种子从主 seed 派生，**不消耗主 rng**。
    // 主随机流（crit/技能/走位/闪避）序列完全不变 → 对局走向与旧版本一致，仅伤害带扰动。
    __publicField(this, "atkRng");
    __publicField(this, "arena");
    // v1.7 §2 击杀成长账本：heroUid -> 累积的永久成长（已被逐 key 求和）。
    // 战斗结束由 BattleScreen 取走并写回 store。友方召唤物没有 heroUid，不参与记账。
    __publicField(this, "killGains", /* @__PURE__ */ new Map());
    // v1.7 §2（改）：伤害归因表 —— 敌方单位 id → 对其造成过伤害的友方 heroUid 集合，用于判定击杀助攻。
    __publicField(this, "damagers", /* @__PURE__ */ new Map());
    // v2.2 铁人无尽（permadeath）：本场战斗中阵亡的友方副本 uid 集合。
    // 友方召唤物（无 heroUid）不计入；仅真实勇者副本进入铁人「永久消失」判定。
    __publicField(this, "deadAllies", /* @__PURE__ */ new Set());
    // v2.4.4 通用数据回路在战斗内核的镜像：单位主键索引，O(1) 事件/索敌定位（替代 units.find 热路径）
    __publicField(this, "byId", /* @__PURE__ */ new Map());
    // v2.9.8 女娲「开局立即释放大招」：只在本场第一 tick 触发一次（波次增援不重复触发）
    __publicField(this, "openingCastDone", false);
    // v3.1 场内生成物编号：召唤物 / Boss 分身共用一条**单调自增**序列。
    // 旧实现用 `'sum' + Math.floor(this.time*1000) + kind` 拼 id —— 同一 tick 内
    // 两名召唤师同时出同类型召唤物（或军团特性一次补两只）会得到**完全相同的 id**，
    // 而 id 是 targetId / damagers / pathCache / 渲染 key 的主键，撞号会导致
    // 索敌串目标、寻路缓存互相污染、渲染插值跳变等一连串难查的隐性 bug。
    // 计数器挂在 sim 实例上（而非模块级）：同 seed 同回放必然同序列，
    // 又不会被「玩家开过几次编队界面」这类外部调用次数污染。
    __publicField(this, "spawnSeq", 0);
    // v2.9.3 寻路缓存：单位被障碍完全挡住时的 BFS 绕障路径（0.3s 缓存，成本可忽略）
    __publicField(this, "pathCache", /* @__PURE__ */ new Map());
    // v2.9.3 地形永久改变：技能打过的地面留下痕迹，本场战斗内永久（确定性数据，渲染层只读）。
    // 玄武镇岳怒吼 → 大坑（crater）；关羽青龙偃月斩 → 刀痕（slash，线状焦土+裂纹，单点武器克制破坏）。
    __publicField(this, "terrainCraters", []);
    __publicField(this, "terrainSlashs", []);
    /** 战斗日志（自动战斗必须可播报，需求 §5.2.2） */
    __publicField(this, "log", []);
    /**
     * 音频事件汇（音频设计文档 §4）
     * 纯数据：仿真只 push cue，渲染层在 tick 外 drain 消费。不 import 音频模块，
     * 对确定性零影响——这只是往数组里追加，不参与任何模拟数学。
     */
    __publicField(this, "audioCues", []);
    /**
     * 延迟结算队列（美术 §7.3.1 ③「先告知，再兑现」）
     * 原实现里 long 档的预警线是**画在伤害之后**的——飘字和"预警"同时出现，
     * 预警就成了事后追认，玩家体感是「我血怎么突然没了」。这不是难度，是信息缺失。
     * 加这个队列让伤害真的落在预警线之后，0.22s 的屏息才成立。
     * 用 filter 保序处理，不引入非确定性（固定步长下回放结果一致）。
     */
    __publicField(this, "pending", []);
    __publicField(this, "lastSummonKind");
    // ══ v2.6 §3 敌方补给建筑 ═══════════════════════════════════════════
    /** 本场已生成的建筑（按 kind 计数，供上限与战报使用） */
    __publicField(this, "buildings", []);
    // 建筑产兵需要在 tick 里复用当初的缩放系数，存一份避免层层传参
    __publicField(this, "buildScaleHp", 1);
    __publicField(this, "buildScaleDmg", 1);
    // ══ v2.9.x 面包车车队（cosplay 五菱宏光）═══════════════════════════
    //
    // 需求原文拆成四段状态，**全部挂在面包车单位自己身上**，没有全局状态机：
    //   ① 开场冲锋：vanBuffUntil 窗口内速度 ×2 —— 车队像真的踩了油门
    //   ② 撞击：van_ram 命中前排，伤害 ∝ 当前速度，命中者被击退（"击退阵型"）
    //   ③ 开门：vanRamDone 置位后进入卸人状态
    //   ④ 逐人下落：每 dropInterval 秒下一个人，受同屏上限约束
    //
    // 状态放单位上而不放 sim 上的理由：一辆车被打爆时，它的卸人进度必须随之消失。
    // 全局队列做这件事得额外记 owner 并在死亡回调里清理，那是 bug 的温床——
    // 而这类 bug 的表现是"车都炸了还在冒人"，玩家会直接判定游戏坏了。
    __publicField(this, "vanCfg");
    __publicField(this, "vanScaleHp", 1);
    this.units = units;
    for (const u of units) this.byId.set(u.id, u);
    this.arena = arena;
    this.W = arena.width;
    this.H = arena.height;
    this.rng = mulberry32(seed);
    this.atkRng = mulberry32((seed ^ 2654435769) >>> 0);
    if (arena.weather) this.applyWeather(arena.weather);
    this.layer = arena.layer ?? 0;
    this.frontMutualCount = 0;
    this.backShackleCount = 0;
    this.enemyFocus = getEnemyFocus();
    applyEnemyFocus(this.units, this.layer, this.rng);
  }
  /** 取下一个场内生成物 id（召唤物 / 分身共用序列，保证全局唯一） */
  nextSpawnId(prefix) {
    return `${prefix}${this.spawnSeq++}`;
  }
  /** v2.4.4 统一入列并登记主键索引（byId），保证事件/索敌 O(1) 定位覆盖全部单位 */
  _push(u) {
    this.units.push(u);
    this.byId.set(u.id, u);
  }
  /**
   * v1.5 环境天气增益（美术 §3.4.5）：应用到场上双方，环境中性不偏袒任一方。
   * 应用一次、持续整场，不在 tick 里反复乘，避免浮点漂移。
   * 回血类（verdant）只写 regenPct，由 tick 按 dt 结算；其余直接改派生属性/伤害乘子。
   */
  applyWeather(w) {
    for (const u of this.units) {
      if (w.moveSpeedAdd !== void 0) u.derived.moveSpeed += w.moveSpeedAdd;
      if (w.atkSpeedAdd !== void 0) u.derived.atkSpeed += w.atkSpeedAdd;
      if (w.dmgMul !== void 0) u.dmgMult *= w.dmgMul;
      if (w.critAdd !== void 0) u.derived.crit += w.critAdd;
      if (w.regenPct !== void 0) u.derived.regenPct = w.regenPct;
      if (w.dmgTakenMul !== void 0) u.derived.dmgTakenMult = w.dmgTakenMul;
    }
  }
  arenaTile(r, c) {
    const row = this.arena.tiles[r];
    return row ? row[c] ?? "." : ".";
  }
  /** v2.4.4 特色地块效果：每 tick 按单位所在地块计算攻速/受伤乘子（确定性，无随机）。
   *  w 水域 → 攻速 ×0.88（−12%）；P 掩体 → 受伤 ×0.85（等效防御 +15%）；
   *  B 王座且 isBoss → 受伤 ×0.80（王座增益，配合本 tick 的王座回血）。 */
  _updateTileEffects() {
    for (const u of this.units) {
      if (!u.alive) {
        u.tileSpdMul = 1;
        u.tileDmgTaken = 1;
        continue;
      }
      const ch = this.arenaTile(Math.floor(u.y), Math.floor(u.x));
      if (ch === "w") {
        u.tileSpdMul = 0.88;
        u.tileDmgTaken = 1;
      } else if (ch === "P") {
        u.tileSpdMul = 1;
        u.tileDmgTaken = 0.85;
      } else if (ch === "B" && u.isBoss) {
        u.tileSpdMul = 1;
        u.tileDmgTaken = 0.8;
      } else {
        u.tileSpdMul = 1;
        u.tileDmgTaken = 1;
      }
    }
  }
  /** v2.9.3 瓦片可行走性：墙 # 与危险地形 ~ 不可通行（地面/P掩体/S/E/Boss台 可站） */
  isWalkable(x, y) {
    const r = Math.floor(y), c = Math.floor(x);
    if (r < 0 || r >= this.H || c < 0 || c >= this.W) return false;
    const ch = this.arenaTile(r, c);
    return ch !== "#" && ch !== "~";
  }
  /** 时空拓印·瞬移：把单位传到至少 minDist 格外、可站立、不与友方重叠的格；找不到则不动 */
  teleportAway(u, minDist) {
    let best = null;
    let bestD = Infinity;
    for (let r = 0; r < this.H; r++) {
      for (let c = 0; c < this.W; c++) {
        if (!this.isWalkable(c + 0.5, r + 0.5)) continue;
        const x = c + 0.5, y = r + 0.5;
        if (this.units.some((o) => o.alive && o.side === u.side && o.id !== u.id && Math.abs(o.x - x) < 0.6 && Math.abs(o.y - y) < 0.6)) continue;
        const d = Math.abs(x - u.x) + Math.abs(y - u.y);
        if (d < minDist) continue;
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    if (best) {
      u.x = best.x;
      u.y = best.y;
      this.emit("rift", u.x, u.y, "#9be7ff", 0.3, { r: 0.8, alphaFrom: 0.9, alphaTo: 0 });
    }
  }
  /** BFS 从单位所在格到目标格的最短路径（4 邻接，返回从下一格开始的路径；目标不可达返回空） */
  pathTo(u, tx, ty) {
    const cached = this.pathCache.get(u.id);
    if (cached && this.time - cached.at < 0.3) return cached.path;
    const sr = Math.floor(u.y), sc = Math.floor(u.x);
    const tr = Math.floor(ty), tc = Math.floor(tx);
    const key = (r, c) => `${r},${c}`;
    const prev = /* @__PURE__ */ new Map();
    const q = [key(sr, sc)];
    prev.set(key(sr, sc), null);
    let found = null;
    let head = 0;
    while (head < q.length) {
      const cur2 = q[head++];
      if (cur2 === key(tr, tc)) {
        found = cur2;
        break;
      }
      const [r, c] = cur2.split(",").map(Number);
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc;
        const k = key(nr, nc);
        if (prev.has(k) || !this.isWalkable(nc + 0.5, nr + 0.5)) continue;
        prev.set(k, cur2);
        q.push(k);
      }
    }
    if (!found) {
      this.pathCache.set(u.id, { at: this.time, path: [] });
      return [];
    }
    const path = [];
    let cur = found;
    while (cur && prev.get(cur) !== null) {
      const [r, c] = cur.split(",").map(Number);
      path.unshift({ r, c });
      cur = prev.get(cur);
    }
    this.pathCache.set(u.id, { at: this.time, path });
    return path;
  }
  /** 技能砸出的大坑（镇岳怒吼：玄武踏碎地面成坑）。范围随施法者体型缩放 */
  markCrater(x, y, radius, by) {
    const m = BODY_INFO[by.bodyType].sizeMult;
    this.terrainCraters.push({ x, y, r: radius * m });
  }
  /** 单点武器劈出的刀痕（青龙偃月斩：刀劈一线焦土 + 裂纹）。宽度随攻击者体型 */
  markSlash(x0, y0, x1, y1, by) {
    const m = BODY_INFO[by.bodyType].sizeMult;
    this.terrainSlashs.push({ x0, y0, x1, y1, w: 0.5 * m });
  }
  alive(side) {
    return this.units.filter((u) => u.alive && u.side === side);
  }
  nearest(pool, u) {
    return pool.reduce((b, c) => dist(c, u) < dist(b, u) ? c : b);
  }
  farthest(pool, u) {
    return pool.reduce((b, c) => dist(c, u) > dist(b, u) ? c : b);
  }
  lowestHp(pool) {
    return pool.reduce((b, c) => c.hp < b.hp ? c : b);
  }
  // 发射一个技能特效（需求 v1.3：按 shape 区分几何形状）
  emit(shape, x, y, color, ttl, opts = {}) {
    this.effects.push({ shape, x, y, color, ttl, maxTtl: ttl, r: 0.8, ...opts });
    if (this.effects.length > MAX_EFFECTS) this.effects.splice(0, this.effects.length - MAX_EFFECTS);
  }
  /**
   * 起手距离环（需求 v1.4 §5.4 三件套 ①；美术 §7.3.1）
   * 施法瞬间在脚下画半径 = 真实施法距离的虚线圆，0.25s，alpha 0.35→0。
   * 让玩家一眼看到「这技能能够多远」。castRange=0（self 档）不画——
   * 画一个半径 0 的圈是噪声。
   */
  windup(u, castRange, color) {
    if (castRange <= 0) return;
    this.effects.push({
      shape: "ring",
      x: u.x,
      y: u.y,
      r: castRange,
      color,
      ttl: 0.25,
      maxTtl: 0.25,
      dashed: true,
      alphaFrom: 0.35,
      alphaTo: 0
    });
  }
  // ══ v2.9.9 大招签名帧（需求②：全队大招特效都达到关羽水平）══════════════════
  // 关羽「青龙偃月斩」在 v2.9.8 立了标准：一次大招 = 四层递进，而不是一个孤零零的形状。
  //   ① 主体层：技能身份形状，够大够久，先声夺人
  //   ② 副体层：错时（delay）拉开的一组同形/近形残影，读作「一招带出一片」
  //   ③ 冲击层：nova 放射定「爆点」+ shock 扩散定「范围」，把尺度钉在地面上
  //   ④ 收尾层：quake 余波 + 内环回吸 + 技能名飘字，让这一帧有重量
  // 其余 8 个大招原本大多只有 ① 一层（护盾就一个泡泡、群疗就一片光），
  // 在满屏弹道里根本挑不出来。下面三个 helper 把 ②③④ 抽成公共件——
  // 八个 case 各写一遍，就一定会漏掉两遍。
  //
  // 铁律：全部是纯 emit / floaters（零 RNG、零状态写入），
  // 对确定性回放与数值平衡无任何影响。smoke [2] 的同 seed 一致性即为守门断言。
  /** ③④ 冲击 + 收尾层。core=爆点色（亮），echo=扩散色（浅） */
  ultBurst(x, y, o) {
    const { core, echo, r, tier, sizeMul } = o;
    this.emit("nova", x, y, core, 0.42, { r: r * 0.85, tier, sizeMul });
    this.emit("shock", x, y, echo, 0.52, { r, tier, sizeMul, alphaFrom: 0.85, alphaTo: 0 });
  }
  /**
   * ② 副体层·环形阵列：以 (x,y) 为心、rad 为半径均分 n 个点，逐点错时 emit 同一形状。
   * 三角函数是确定性的，不碰随机流。
   */
  ultRadial(shape, x, y, color, ttl, o) {
    const n = Math.min(o.n, 4);
    const step = o.step ?? 0.05;
    const phase = o.phase ?? 0;
    for (let i = 0; i < n; i++) {
      const a = phase + Math.PI * 2 * i / o.n;
      this.emit(shape, x + dcos(a) * o.rad, y + dsin(a) * o.rad, color, ttl, {
        r: o.size,
        tier: o.tier,
        sizeMul: o.sizeMul,
        delay: i * step
      });
    }
  }
  /** ④ 收尾层·技能名横幅：大招是这一局的高光时刻，得报出名字 */
  ultName(x, y, name, color) {
    this.floaters.push({ x, y: y - 1.4, text: name, color, ttl: 0.9 });
  }
  /** 技能施法距离（格）。逻辑判定与特效尺寸共用同一个数。 */
  castRangeOf(u) {
    return (u.skill.castRange ?? SUBCLASS_INFO[u.subclass].attackRange) + (u.rangeBonus ?? 0);
  }
  /** 取施法距离内的敌人（v1.4：技能不再「全体生效」，否则距离环就没有意义） */
  inCastRange(u, pool) {
    const r = this.castRangeOf(u);
    return pool.filter((t) => dist(t, u) <= r + t.hitRadius);
  }
  emitAudio(cue) {
    this.audioCues.push(cue);
  }
  /** 渲染层每帧调用：取走并清空本帧累积的音频事件 */
  drainAudioCues() {
    if (!this.audioCues.length) return [];
    const c = this.audioCues;
    this.audioCues = [];
    return c;
  }
  pushLog(s) {
    this.log.push(s);
    if (this.log.length > 40) this.log.shift();
  }
  schedule(delay, fn) {
    if (delay <= 0) {
      fn();
      return;
    }
    this.pending.push({ at: this.time + delay, fn });
  }
  runPending() {
    if (!this.pending.length) return;
    const due = this.pending.filter((p) => p.at <= this.time);
    if (!due.length) return;
    this.pending = this.pending.filter((p) => p.at > this.time);
    for (const d of due) d.fn();
  }
  acquireTarget(u) {
    const foes = this.alive(u.side === "ally" ? "enemy" : "ally");
    if (!foes.length) return null;
    if (u.isBeastling && u.vengeTargetId) {
      const v = this.byId.get(u.vengeTargetId ?? "");
      if (v && v.alive) return v;
    }
    if (u.summonKind === "sprinter") return this.lowestHp(foes);
    if (u.summonKind === "bulwark") return this.nearest(foes, u);
    if (u.summonKind === "arcanist") return this.nearest(foes, u);
    const taunters = foes.filter((f) => f.tauntUntil > this.time);
    const pool = taunters.length ? taunters : foes;
    if (u.personality && u.personality !== "steady" && pool.length > 1) {
      return this.byPersonality(u, pool);
    }
    if (this.attackRangeOf(u) > 3) return this.lowestHp(pool);
    return this.nearest(pool, u);
  }
  /**
   * v1.8.3 卡住修复配套：在「可达」的存活敌人里按与 acquireTarget 相同的偏好选目标。
   * 仅用于 acquireTarget 选中的目标被墙/水完全挡住时换靶；全部不可达则返回 null（保持原目标）。
   * 可达性 = BFS（pathTo 非空），纯确定性。
   */
  acquireReachable(u) {
    const foes = this.alive(u.side === "ally" ? "enemy" : "ally").filter((f) => this.pathTo(u, f.x, f.y).length > 0);
    if (!foes.length) return null;
    const taunters = foes.filter((f) => f.tauntUntil > this.time);
    const pool = taunters.length ? taunters : foes;
    if (this.attackRangeOf(u) > 3) return this.lowestHp(pool);
    return this.nearest(pool, u);
  }
  /**
   * v3.1 性格偏好索敌。
   *
   * 关键取舍：**不做纯优先级，做「偏好分 − 距离」的加权**。
   * 纯优先级会让一个近战刺客无视贴脸的坦克，横穿整张图去够后排法师——
   * 路上被四个人围殴致死，玩家看到的不是"性格"，是"AI 犯蠢"。
   * 用 PREF_W 格的距离预算把偏好换算成"我愿意为这个目标多走几步"，
   * 偏好足够强时依然会绕后，但不会做出自杀式远征。
   */
  byPersonality(u, pool) {
    const PREF_W = 6;
    let ax = 0, ay = 0, an = 0;
    for (const a of this.units) {
      if (a.alive && a.side === u.side && !a.summonKind) {
        ax += a.x;
        ay += a.y;
        an++;
      }
    }
    if (!an) {
      ax = u.x;
      ay = u.y;
      an = 1;
    }
    ax /= an;
    ay /= an;
    let dMin = Infinity, dMax = -Infinity;
    const depth = /* @__PURE__ */ new Map();
    for (const f of pool) {
      const d = len2d(f.x - ax, f.y - ay);
      depth.set(f.id, d);
      if (d < dMin) dMin = d;
      if (d > dMax) dMax = d;
    }
    const span = Math.max(1e-3, dMax - dMin);
    const threat = (f) => f.derived.pDmg + f.derived.mDmg + f.maxHp * 0.04;
    let tMax = 0;
    for (const f of pool) tMax = Math.max(tMax, threat(f));
    tMax = Math.max(1, tMax);
    let best = pool[0];
    let bestScore = -Infinity;
    for (const f of pool) {
      const front = 1 - (depth.get(f.id) - dMin) / span;
      let pref = 0;
      switch (u.personality) {
        case "valiant":
          pref = f.hp > f.maxHp * 0.8 ? 1 : 0;
          break;
        case "hunter":
          pref = 1 - f.hp / Math.max(1, f.maxHp);
          break;
        case "breaker":
          pref = front;
          break;
        case "assassin":
          pref = 1 - front;
          break;
        case "savior":
          pref = threat(f) / tMax;
          break;
        default:
          pref = 0;
      }
      const score = pref * PREF_W - dist(f, u);
      if (score > bestScore) {
        bestScore = score;
        best = f;
      }
    }
    return best;
  }
  moveToward(u, target, dt) {
    let dx = target.x - u.x;
    let dy = target.y - u.y;
    const raw2 = len2d(dx, dy) || 1;
    if (u.summonKind === "arcanist" && raw2 < 4) {
      dx = -dx;
      dy = -dy;
    }
    const d = len2d(dx, dy) || 1;
    const glide = u.glideUntil && u.glideUntil > this.time ? u.bodyType === "slim" ? 1.25 : 1.2 : 1;
    const slow = (u.slowUntil ?? 0) > this.time ? 1 - (u.slowPct ?? 0) / 100 : 1;
    let terrainSlow = 1;
    for (const cr of this.terrainCraters) {
      if (len2d(u.x - cr.x, u.y - cr.y) < cr.r) {
        terrainSlow = 0.8;
        break;
      }
    }
    if (terrainSlow === 1) {
      for (const sl of this.terrainSlashs) {
        const dx2 = sl.x1 - sl.x0, dy2 = sl.y1 - sl.y0;
        const len2 = dx2 * dx2 + dy2 * dy2 || 1;
        const tproj = ((u.x - sl.x0) * dx2 + (u.y - sl.y0) * dy2) / len2;
        const px2 = sl.x0 + dx2 * Math.max(0, Math.min(1, tproj));
        const py2 = sl.y0 + dy2 * Math.max(0, Math.min(1, tproj));
        if (len2d(u.x - px2, u.y - py2) < sl.w * 1.5) {
          terrainSlow = 0.85;
          break;
        }
      }
    }
    const dampMs = this.dampMoveSpeed(u);
    const sp = (2 + dampMs * 0.02) * glide * Math.max(0.2, slow) * terrainSlow * this.vanSpeedMult(u);
    let nx = u.x + dx / d * sp * dt;
    let ny = u.y + dy / d * sp * dt;
    if (!this.isWalkable(nx, ny)) {
      const path = this.pathTo(u, target.x, target.y);
      if (path.length) {
        const ncx = path[0].c + 0.5, ncy = path[0].r + 0.5;
        const vx = ncx - u.x, vy = ncy - u.y;
        const vlen = len2d(vx, vy) || 1;
        nx = u.x + vx / vlen * sp * dt;
        ny = u.y + vy / vlen * sp * dt;
      } else {
        const slidX = this.isWalkable(nx, u.y);
        const slidY = this.isWalkable(u.x, ny);
        if (slidX && !slidY) ny = u.y;
        else if (slidY && !slidX) nx = u.x;
        else if (slidX && slidY) {
          if (Math.abs(dx) >= Math.abs(dy)) ny = u.y;
          else nx = u.x;
        } else {
          nx = u.x;
          ny = u.y;
        }
      }
    }
    let anchored = false;
    for (const a of this.units) {
      if (a === u || !a.alive || a.side !== u.side) continue;
      if ((a.bodyType === "giant" || a.bodyType === "titan" || a.bodyType === "colossal") && len2d(a.x - u.x, a.y - u.y) <= 2.5) {
        anchored = true;
        break;
      }
    }
    const anchorMult = anchored ? 0.5 : 1;
    for (const o of this.units) {
      if (o === u || !o.alive || o.side !== u.side) continue;
      const dd = len2d(o.x - u.x, o.y - u.y);
      const sep = (u.hitRadius + o.hitRadius) * 1.6;
      if (dd < sep && dd > 0) {
        const heavyArmor = (u.heavyArmorUntil ?? 0) > this.time;
        const push = (heavyArmor ? 0 : u.bodyType === "giant" || u.bodyType === "titan" ? 0 : u.bodyType === "obese" ? 0.15 : u.bodyType === "colossal" ? 0.08 : 0.3) * anchorMult;
        nx += (u.x - o.x) / dd * push;
        ny += (u.y - o.y) / dd * push;
      }
    }
    if (!this.isWalkable(nx, ny)) {
      if (this.isWalkable(nx, u.y)) ny = u.y;
      else if (this.isWalkable(u.x, ny)) nx = u.x;
      else {
        nx = u.x;
        ny = u.y;
      }
    }
    const ox = u.x, oy = u.y;
    u.x = clamp2(nx, 0.6, this.W - 0.6);
    u.y = clamp2(ny, 0.6, this.H - 0.6);
    u.moveDist = (u.moveDist ?? 0) + len2d(u.x - ox, u.y - oy);
  }
  // ══ v1.6 角色特性运行时（开发文档附录 A.1）════════════════════════════
  // 设计纪律：所有钩子只读 sim 内部状态与种子 RNG，不引入 Math.random，
  // 否则同一 seed 的回放会分叉。特性只挂在英雄身上，召唤物/敌人不带 traitId。
  /** 攻击方特性对本次伤害的乘子（致命 / 禁锢 / 速射） */
  traitOutMult(u, target) {
    if (!u?.traitId) return 1;
    let m = 1;
    if (u.traitId === "lethal" && target.hp < target.maxHp * TRAIT_CFG.lethalThreshold) {
      m *= 1 + TRAIT_CFG.lethalBonus;
    }
    if (u.traitId === "shackle") {
      const held = target.rootUntil > this.time || target.stunUntil > this.time || (target.slowUntil ?? 0) > this.time;
      if (held) m *= 1 + TRAIT_CFG.shackleBonus;
    }
    if (u.traitId === "volley" && u.lastHitTargetId === target.id) {
      m *= 1 + TRAIT_CFG.volleyPerStack * Math.min(u.traitStacks ?? 0, TRAIT_CFG.volleyMaxStacks);
    }
    return m;
  }
  /** 受击方特性钩子（在扣血之后、死亡判定之前调用） */
  traitOnHit(target, dmg, type, attacker) {
    if (dmg > 0 && (target.traitId === "heart" || target.traitId === "spacetime")) {
      if (target.traitId === "heart") {
        target.heartLoss = (target.heartLoss ?? 0) + dmg;
        this.emit("ring", target.x, target.y, TRAIT_VFX.heart.color, 0.26, { r: target.hitRadius * 1.3, alphaFrom: 0.6, alphaTo: 0 });
      } else {
        target.stLoss = (target.stLoss ?? 0) + dmg;
        this.emit("rift", target.x, target.y, TRAIT_VFX.spacetime.color, 0.26, { r: target.hitRadius * 1.2, alphaFrom: 0.6, alphaTo: 0 });
      }
    }
    if (!target.traitId || target.hp <= 0) return;
    if (target.traitId === "bulwark") {
      const n = (target.traitStacks ?? 0) + 1;
      if (n >= TRAIT_CFG.bulwarkHitsPerShield) {
        target.traitStacks = 0;
        const s = target.maxHp * TRAIT_CFG.bulwarkShieldPct;
        target.shield += s;
        this.emit("bubble", target.x, target.y, "#6fd3ff", 0.45, { r: target.hitRadius * 1.8 });
        this.floaters.push({
          x: target.x,
          y: target.y - 0.7,
          text: `\u575A\u58C1 +${Math.round(s)}`,
          color: "#6fd3ff",
          ttl: 0.9
        });
      } else {
        target.traitStacks = n;
      }
    }
    if (target.traitId === "spellbreak" && type === "magic" && attacker?.alive && dmg > 0) {
      const r = dmg * TRAIT_CFG.spellbreakReflect;
      attacker.hp -= r;
      attacker.flash = 0.12;
      this.emit("beam", target.x, target.y, "#b07bff", 0.22, {
        tx: attacker.x,
        ty: attacker.y,
        r: 0.15,
        thickness: 2
      });
      this.floaters.push({
        x: attacker.x,
        y: attacker.y - 0.3,
        text: String(Math.round(r)),
        color: "#b07bff",
        ttl: 0.7
      });
      this.killIfDown(attacker, target);
    }
  }
  /**
   * 反"堆一人"两条被动的统一掷骰：基础概率（vX 起不再乘集中度闸门，
   * 用户确认不需要回避均衡队——均衡队也会遇到死士，触发只由层深+概率+每场上限决定）。
   * 仍走 this.rng 种子流，同 seed 回放一致。
   */
  focusRoll(baseP) {
    return this.rng() < baseP;
  }
  /** 统一死亡结算（含魔刃击杀回响）。反弹伤害也要走这里，否则会出现 hp<0 的活人 */
  killIfDown(u, killer) {
    if (u.side === "ally" && u.traitId === "returner" && !u.isSummon && u.heroUid && (u.returnerUsed ?? 0) < 1) {
      u.returnerUsed = 1;
      const pk = pick(this.rng, PRIMARY_KEYS);
      const sk = pick(this.rng, GROWTH_STAT_KEYS);
      const SK_CN = { hp: "\u751F\u547D", pDmg: "\u7269\u4F24", mDmg: "\u6CD5\u4F24", heal: "\u6CBB\u7597" };
      this.creditKillGrowth(u.heroUid, pk, sk, TRAIT_CFG.returnerPermanentPct);
      u.sizeScale = (u.sizeScale ?? 1) * (1 + TRAIT_CFG.returnerBodyPct);
      u.rangeBonus = (u.rangeBonus ?? 0) + TRAIT_CFG.returnerRange;
      u.derived.atkSpeed *= 1 + TRAIT_CFG.returnerAsPct;
      u.derived.moveSpeed *= 1 + TRAIT_CFG.returnerMsPct;
      u.hp = u.maxHp * TRAIT_CFG.returnerReviveHpPct;
      u.alive = true;
      u.returnerDrain = true;
      this.deadAllies.delete(u.heroUid);
      this.pushLog(`${u.name} \u5F52\u6765\u8005\u590D\u6D3B\uFF01\u6C38\u4E45\u6210\u957F +${TRAIT_CFG.returnerPermanentPct}%${SK_CN[sk]}\uFF0C\u4F53\u578B+30% \u5C04\u7A0B+2 \u653B\u901F/\u79FB\u901F+15%`);
      this.emit("rift", u.x, u.y, "#ffd27a", 0.5, { r: u.hitRadius * 2 });
      this.floaters.push({ x: u.x, y: u.y - 0.9, text: "\u5F52\u6765\uFF01", color: "#ffd27a", ttl: 1.3 });
      return;
    }
    if (u.hp > 0 || !u.alive) return;
    u.alive = false;
    u.deadAt = this.time;
    if (u.side === "enemy" && u.beastTrait === "selfdestruct") {
      const R = 2;
      const dmg = u.maxHp * 0.35;
      for (const t of this.units) {
        if (t === u || !t.alive || t.side === u.side || t.isBuilding) continue;
        if (len2d(t.x - u.x, t.y - u.y) <= R) this.dealSkill(u, t, dmg, "physical", false, true);
      }
      this.emit("ring", u.x, u.y, "#ff5a3c", 0.55, { r: R * 0.9 });
      this.floaters.push({ x: u.x, y: u.y - 0.9, text: "\u81EA\u7206\uFF01", color: "#ff5a3c", ttl: 1 });
      this.pushLog(`${u.name} \u81EA\u7206\uFF01\u5468\u56F4 2 \u683C\u53D7\u5230 ${Math.round(dmg)} \u771F\u5B9E\u4F24\u5BB3`);
    }
    if (u.beastTrait === "nest") {
      for (const b of this.units) {
        if (b.isBeastling && b.parentId === u.id && b.alive && !b.vengeTargetId) {
          b.vengeTargetId = killer?.id;
        }
      }
    }
    if (u.side === "ally" && !u.isSummon && u.heroUid) {
      this.deadAllies.add(u.heroUid);
      for (const a of this.units) {
        if (a.side === "ally" && a.alive && !a.isSummon && a.traitId === "fury" && a.id !== u.id) {
          a.derived.pDmg *= 1 + TRAIT_CFG.furyPerDeathPct;
          a.derived.mDmg *= 1 + TRAIT_CFG.furyPerDeathPct;
          a.derived.atkSpeed *= 1 + TRAIT_CFG.furyPerDeathPct;
          this.floaters.push({
            x: a.x,
            y: a.y - 0.9,
            text: `\u6012\u706B +${Math.round(TRAIT_CFG.furyPerDeathPct * 100)}%`,
            color: "#ff7a4d",
            ttl: 1
          });
        }
      }
      this.pushLog(`${u.name} \u9635\u4EA1 \u2192 \u53CB\u519B\u300C\u6124\u6012\u71C3\u70E7\u8005\u300D\u6012\u706B +${Math.round(TRAIT_CFG.furyPerDeathPct * 100)}%`);
    }
    const deathColor = u.isSummon ? "#9b7bff" : "#ff6a6a";
    this.emit("ring", u.x, u.y, deathColor, 0.4, { r: u.hitRadius * 1.5 });
    this.emitAudio({ id: u.side === "ally" ? "death_ally" : "death_enemy", x: u.x, arenaW: this.W });
    if (u.side === "enemy" && killer?.side === "ally" && killer.heroUid) {
      const pk = pick(this.rng, PRIMARY_KEYS);
      const sk = pick(this.rng, GROWTH_STAT_KEYS);
      const PK_CN = { con: "\u5F3A\u58EE", str: "\u529B\u91CF", agi: "\u654F\u6377", int: "\u667A\u529B" };
      const SK_CN = { hp: "\u751F\u547D", pDmg: "\u7269\u4F24", mDmg: "\u6CD5\u4F24", heal: "\u6CBB\u7597" };
      const kMul = 1 + this.rng() * 0.5;
      this.creditKillGrowth(killer.heroUid, pk, sk, kMul);
      this.floaters.push({
        x: killer.x,
        y: killer.y - 0.9,
        text: `\u51FB\u6740\u6210\u957F +${PK_CN[pk]}${(0.5 * kMul).toFixed(1)}/${SK_CN[sk]}+${(kMul * 100).toFixed(0)}%`,
        color: "#7ee08a",
        ttl: 1.1
      });
      this.pushLog(`${killer.name} \u51FB\u6740 ${u.name} \u2192 \u6210\u957F ${PK_CN[pk]}+${(0.5 * kMul).toFixed(1)}, ${SK_CN[sk]}+${(kMul * 100).toFixed(0)}%`);
      const dmgSet = this.damagers.get(u.id);
      if (dmgSet) {
        for (const aid of dmgSet) {
          if (aid === killer.heroUid) continue;
          const aMul = 0.3 + this.rng() * 0.2;
          this.creditKillGrowth(aid, pk, sk, aMul);
          this.pushLog(`${this.heroName(aid)} \u52A9\u653B ${u.name} \u2192 \u6210\u957F ${PK_CN[pk]}+${(0.5 * aMul).toFixed(1)}, ${SK_CN[sk]}+${(aMul * 100).toFixed(0)}%`);
        }
      }
      const growerUids = /* @__PURE__ */ new Set();
      if (killer.traitId === "grower") growerUids.add(killer.heroUid);
      if (dmgSet) {
        for (const aid of dmgSet) {
          const g = this.units.find((x) => x.heroUid === aid && x.alive && x.traitId === "grower");
          if (g) growerUids.add(aid);
        }
      }
      for (const gid of growerUids) {
        const g = this.units.find((x) => x.heroUid === gid);
        if (!g || !g.alive) continue;
        g.derived.pDmg *= 1 + TRAIT_CFG.growerRampPct;
        g.derived.mDmg *= 1 + TRAIT_CFG.growerRampPct;
        g.derived.atkSpeed *= 1 + TRAIT_CFG.growerRampPct;
        g.derived.moveSpeed *= 1 + TRAIT_CFG.growerRampPct;
        const curSize = hitRadiusOf(g.bodyType) * (g.sizeScale ?? 1);
        const sizeCurve = curSize < 0.5 ? 0.2 : curSize < 1 ? 0.8 : curSize < 3 ? 1.2 : curSize < 3.2 ? 0.01 : 1e-3;
        const b = (TRAIT_CFG.growerBodyMin + this.rng() * (TRAIT_CFG.growerBodyMax - TRAIT_CFG.growerBodyMin)) * sizeCurve;
        g.sizeScale = (g.sizeScale ?? 1) * (1 + b);
        this.floaters.push({
          x: g.x,
          y: g.y - 0.9,
          text: `\u6210\u957F +${Math.round(TRAIT_CFG.growerRampPct * 100)}%`,
          color: "#7ee08a",
          ttl: 1
        });
      }
      if (growerUids.size) {
        this.pushLog(`\u6210\u957F\u8005 \xD7${growerUids.size} \u51FB\u6740/\u52A9\u653B ${u.name} \u2192 \u5168\u5C5E\u6027 +${Math.round(TRAIT_CFG.growerRampPct * 100)}% \u4F53\u578B\u589E\u957F`);
      }
    }
    if (u.shackleWith) {
      const mate = this.byId.get(u.shackleWith ?? "");
      if (mate) {
        mate.stunUntil = Math.min(mate.stunUntil, this.time);
        mate.rootUntil = Math.min(mate.rootUntil, this.time);
        mate.shackleWith = void 0;
        this.pushLog(`${u.name} \u5012\u4E0B \u2192 ${mate.name} \u6323\u8131\u6346\u4ED9\u7EF3`);
        this.emit("rift", mate.x, mate.y, "#ffe08a", 0.3, { r: 0.7, alphaFrom: 0.9, alphaTo: 0 });
      }
      u.shackleWith = void 0;
    }
    if (u.side === "enemy" && u.focusRole === "front" && this.frontMutualCount < this.enemyFocus.maxFrontPerBattle) {
      if (this.focusRoll(this.enemyFocus.frontMutualP)) {
        const strongest = findStrongestAlly(this.units);
        if (strongest) {
          this.frontMutualCount++;
          this.pushLog(`${u.name} \u540C\u5F52\u4E8E\u5C3D \u2192 \u62D6\u8D70 ${strongest.name}`);
          this.emitAudio({ id: "cc_stun", x: strongest.x, arenaW: this.W });
          this.floaters.push({ x: strongest.x, y: strongest.y - 0.9, text: "\u540C\u5F52\u4E8E\u5C3D", color: "#ff6a6a", ttl: 1.3 });
          strongest.shield = 0;
          strongest.hp = 0;
          this.killIfDown(strongest, u);
        }
      }
    }
    if (killer?.alive && killer.traitId === "bloodedge" && !u.isSummon) {
      const h = killer.maxHp * TRAIT_CFG.bloodedgeHealPct;
      killer.hp = Math.min(killer.maxHp, killer.hp + h);
      killer.skillCd = Math.max(0, killer.skillCd - TRAIT_CFG.bloodedgeCdCut);
      killer.derived.pDmg *= 1 + TRAIT_CFG.bloodedgePdmgPerKill;
      killer.derived.mDmg *= 1 + TRAIT_CFG.bloodedgeMdmgPerKill;
      this.emit("ring", killer.x, killer.y, "#ff5f8a", 0.35, { r: killer.hitRadius * 1.6 });
      this.floaters.push({
        x: killer.x,
        y: killer.y - 0.7,
        text: `\u9B54\u5203 +${Math.round(h)}`,
        color: "#ff5f8a",
        ttl: 0.9
      });
      this.pushLog(`${killer.name} \u65A9\u6740 ${u.name} \u2192 \u9B54\u5203\u56DE\u54CD\uFF08\u7269\u653B+10% \u6CD5\u4F24+20%\uFF09`);
    }
    if (u.side === "enemy" && killer?.alive) this.nuwaKillRecast(killer);
  }
  /** v1.7 §2：取走本场击杀成长账本（按 heroUid 索引），供 BattleScreen 写回 store */
  getKillGains() {
    const out = {};
    for (const [uid2, g] of this.killGains) out[uid2] = g;
    return out;
  }
  /** v1.7 §2（改）：把一次击杀成长按倍率 mul 缩放基础值（核心 +0.5 / 二级 +1%）累加到指定 heroUid 账本 */
  creditKillGrowth(uid2, pk, sk, mul) {
    const prev = this.killGains.get(uid2) ?? { primary: {}, secondaryPct: {} };
    prev.primary = { ...prev.primary, [pk]: (prev.primary?.[pk] ?? 0) + 0.5 * mul };
    prev.secondaryPct = { ...prev.secondaryPct, [sk]: (prev.secondaryPct?.[sk] ?? 0) + 1 * mul };
    this.killGains.set(uid2, prev);
  }
  /** 按 heroUid 反查战场单位名（助攻日志用；找不到回落勇者） */
  heroName(uid2) {
    const u = this.units.find((x) => x.heroUid === uid2);
    return u ? u.name : "\u52C7\u8005";
  }
  /** v2.2 铁人无尽：取走本场阵亡的友方副本 uid（供 BattleScreen 在胜利后永久移除） */
  getDeadAllyUids() {
    return [...this.deadAllies];
  }
  // v2.9.3 属性衰减：攻速/移速堆叠过高时收益锐减，防止数值无限膨胀。
  // 攻速基准 100：≤2 倍(200) 全额；200~240 超出部分 ×10%；>240 超出部分 ×1%（最多 ≈204）。
  // 暂时的攻速 buff（势能 momentum 乘区等）不参与衰减——衰减只作用于基础合成值。
  dampAtkSpeed(as) {
    if (as <= 200) return as;
    if (as <= 240) return 200 + (as - 200) * 0.1;
    return 204 + (as - 240) * 0.01;
  }
  // 移速衰减：以单位基础移速（u.baseMove）为基准，≤1.5× 全额；1.5~2.2× 超出部分 ×40%；
  // >2.2× 超出部分 ×10%。暂时的移速 buff（滑步 glide 等）不衰减（在衰减结果上乘）。
  dampMoveSpeed(u) {
    const base2 = Math.max(1, u.baseMove ?? 1);
    const ms = u.derived.moveSpeed;
    const t1 = base2 * 1.5, t2 = base2 * 2.2;
    if (ms <= t1) return ms;
    if (ms <= t2) return t1 + (ms - t1) * 0.4;
    return t1 + (t2 - t1) * 0.4 + (ms - t2) * 0.1;
  }
  /** 实际攻击间隔（秒）。势能层数在这里兑现为攻速 */
  attackInterval(u) {
    let as = this.dampAtkSpeed(u.derived.atkSpeed) * (u.tileSpdMul ?? 1);
    if (u.traitId === "momentum") {
      const st = Math.min(u.traitStacks ?? 0, TRAIT_CFG.momentumMaxStacks);
      as *= 1 + TRAIT_CFG.momentumPerStack * st / 100;
    }
    return 1 / Math.max(0.1, as / 100);
  }
  // v2.9：轻击主节奏间隔 = 基础间隔 × (130 / 个人轻击攻速)。
  // lightAs=130 → 与旧节奏一致；160 → 快 ~23%。装备/势能/天气攻速照常叠加（走 attackInterval）。
  lightInterval(u) {
    return this.attackInterval(u) * (130 / (u.lightAs ?? 130));
  }
  // v2.9：重击序列后的休息期 = 基础间隔 × (100 / 个人重击攻速)。
  // heavyAs=40 → 休息 2.5s（=每秒 0.4 次重击），26~57 档 → 1.75~3.85s。
  heavyLockDuration(u) {
    return this.attackInterval(u) * (100 / Math.max(10, u.heavyAs ?? 40));
  }
  // v2.9 轻/重击节奏判定（performAttack 内联）：
  //   ① 重击序列进行中（heavyBurst>0 且上次是重击）→ 本次继续重击（连打 1~2 次）；
  //   ② 否则 combo 达到阈值且不在休息期 → 触发新重击序列（combo 归零）；
  //   ③ 否则轻击，combo+1。
  // 主节奏冷却统一用轻击攻速；重击序列结束后进入休息期（heavyLock = 重击攻速换算）。
  /**
   * 轻/重击节奏判定（纯状态机，不结算效果）。
   * 抽出来的理由：v2.9.8 奶妈把「普攻」改成了「治疗」，但节奏必须和其他职业完全一致
   * ——如果治疗普攻自己再写一份 combo/heavyBurst 逻辑，两份状态机迟早会漂移。
   */
  rollHeavy(u) {
    let heavy = false;
    if ((u.heavyBurst ?? 0) > 0 && u.isHeavyHit) {
      heavy = true;
      u.heavyBurst = (u.heavyBurst ?? 0) - 1;
      if (u.heavyBurst <= 0) u.heavyLock = this.time + this.heavyLockDuration(u);
    } else if ((u.heavyLock ?? 0) <= this.time && (u.combo ?? 0) >= (u.heavyAt ?? 5)) {
      heavy = true;
      u.combo = 0;
      u.heavyBurst = (u.heavyBurstCount ?? 1) - 1;
      u.heavyArmorUntil = this.time + 0.45;
      if (u.heavyBurst <= 0) u.heavyLock = this.time + this.heavyLockDuration(u);
    } else {
      u.combo = (u.combo ?? 0) + 1;
    }
    u.isHeavyHit = heavy;
    return heavy;
  }
  /** 一次普攻收尾：写主节奏冷却（轻击攻速）+ 预测下一次是否重击 */
  finishAttackRhythm(u) {
    u.cd = this.lightInterval(u);
    u.heavyReady = (u.heavyBurst ?? 0) > 0 && u.isHeavyHit || (u.heavyLock ?? 0) <= this.time && (u.combo ?? 0) >= (u.heavyAt ?? 5);
  }
  /** 轻/重击攻击统一入口：判定节奏 → 动画 → 结算 → 主节奏冷却（轻击攻速） */
  performAttack(u, target) {
    const heavy = this.rollHeavy(u);
    this.attackAnim(u);
    if (this.isHealAttacker(u) && heavy && this.pickHealTarget(u)) {
      this.healBurst(u);
    } else {
      this.basicAttack(u, target, heavy);
    }
    this.finishAttackRhythm(u);
    this.nuwaResonate(u);
  }
  /**
   * v2.9.8：返回该单位对应的「女娲本体」——
   * 传入女娲自己 → 返回自己；传入她的召唤物 → 返回主人；其余情况返回 null。
   * 只认友方：敌方召唤系单位不吃这套强化（这是英雄专属加强，不是全局机制）。
   */
  nuwaOwnerOf(u) {
    if (u.side !== "ally") return null;
    if (!u.isSummon) {
      return u.alive && u.skill.id === NUWA_SKILL_ID ? u : null;
    }
    if (!u.casterHeroUid) return null;
    const owner = this.units.find(
      (x) => x.alive && !x.isSummon && x.heroUid === u.casterHeroUid && x.skill.id === NUWA_SKILL_ID
    );
    return owner ?? null;
  }
  /** v2.9.8 共鸣②：普攻削减女娲大招冷却 1s（冷却已就绪时不再空转累计） */
  nuwaResonate(u) {
    const owner = this.nuwaOwnerOf(u);
    if (!owner || owner.skillCd <= 0) return;
    owner.skillCd = Math.max(0, owner.skillCd - NUWA_ATTACK_CDR);
    this.emit("ring", owner.x, owner.y, "#9b7bff", 0.18, { r: owner.hitRadius * 1.25, alphaFrom: 0.55, alphaTo: 0 });
    if (owner.skillCd <= 0) {
      this.floaters.push({ x: owner.x, y: owner.y - 1, text: "\u9020\u5316\u5DF2\u6EE1", color: "#c9b0ff", ttl: 0.8 });
    }
  }
  /**
   * v2.9.8 共鸣③：女娲 / 其召唤物击杀敌人 → 大招冷却清零并立刻再放一次。
   * 放在 killIfDown 尾部调用。summon 技能本身不造成伤害，故不会与 killIfDown 递归。
   */
  nuwaKillRecast(killer) {
    const owner = this.nuwaOwnerOf(killer);
    if (!owner) return;
    owner.skillCd = 0;
    if (!this.shouldCast(owner)) return;
    this.emit("rift", owner.x, owner.y, "#c9b0ff", 0.35, { r: 0.9, alphaFrom: 0.9, alphaTo: 0 });
    this.floaters.push({ x: owner.x, y: owner.y - 1.1, text: "\u9020\u5316\xB7\u91CD\u94F8", color: "#c9b0ff", ttl: 0.9 });
    this.pushLog(`${killer.name} \u65A9\u83B7\u4EBA\u5934 \u2192 ${owner.name} \u9020\u5316\u91CD\u94F8\uFF0C\u7ACB\u5373\u518D\u53EC`);
    this.castSkill(owner);
  }
  // ══ v2.9.9 奶妈「重击转群疗」（需求：重击和大招回血，普攻仍是弱普攻）═════════
  // 版本演进：v2.9.8 之前奶妈是全场唯一站桩发呆的单位（tick 里直接 continue）；
  // v2.9.8 把轻击+重击全改成治疗，结果治疗过强（血线常驻 85%+）；
  // v2.9.9 取中间态——她走和所有人一样的索敌/推进/普攻节奏，
  //   · 轻击 → 打敌人，但伤害按 HEALER_LIGHT_DMG_MULT 削弱（她不该抢输出位）
  //   · 重击 → 转为群疗（约每 6 拍 1 次，治疗从"常驻"变回"有节奏的事件"）
  //   · 大招 → 群体治疗，保持不变
  // 全队满血时重击不空放：直接打敌人，不浪费这一拍。
  /** 是否走「重击转治疗」的分流：仅我方非召唤的治疗职业 */
  isHealAttacker(u) {
    return u.subclass === "healer" && u.side === "ally" && !u.isSummon;
  }
  /** 治疗射程：沿用其普攻射程（治疗职业 5 格），逻辑判定与特效尺寸共用同一个数 */
  healRangeOf(u) {
    return this.attackRangeOf(u);
  }
  /**
   * 选疗目标：血量百分比最低的友方主力（同时用作「本次重击值不值得转治疗」的判据）。
   * 召唤物/建筑不占治疗资源——它们本就是消耗品，把奶量喂给 18s 后自然消散的石魂卫是纯亏。
   * 全队满血时：有「恩泽」（溢疗转盾）才继续奶（溢出真能变成护盾），否则返回 null → 该拍改打敌人。
   */
  pickHealTarget(u) {
    const pool = this.alive(u.side).filter((a) => !a.isSummon && !a.isBuilding);
    if (!pool.length) return null;
    const best = pool.reduce((b, c) => c.hp / c.maxHp < b.hp / b.maxHp ? c : b);
    if (best.hp >= best.maxHp) return u.traitId === "grace" ? best : null;
    return best;
  }
  /**
   * 重击群疗结算：以奶妈为心、治疗射程为半径的一圈群疗。
   * 单体系数打 6 折，命中人数越多总量越高——让「站位聚拢」成为一个有收益的选择。
   * 倍率沿用伤害重击的同源扰动（atkRng 独立流，不污染主随机流）：230%~360%。
   */
  healBurst(u) {
    const base2 = u.derived.heal;
    const mult = 2.3 + this.atkRng() * 1.3;
    const R = this.healRangeOf(u);
    const pool = this.alive(u.side).filter((a) => !a.isBuilding && dist(a, u) <= R + a.hitRadius);
    for (const a of pool) this.applyHeal(a, base2 * mult * HEAL_BURST_SPLIT, u);
    this.emit("light", u.x, u.y, "#7fe3b0", 0.5, { r: R, alphaFrom: 0.9, alphaTo: 0 });
    this.emit("ring", u.x, u.y, "#aef0c0", 0.35, { r: R * 0.9, alphaFrom: 0.7, alphaTo: 0 });
    this.floaters.push({
      x: u.x,
      y: u.y - 0.9,
      text: `\u56DE\u6625\xB7\u91CD\u51FB \xD7${pool.length}`,
      color: "#aef0c0",
      ttl: 0.6
    });
    this.pushLog(`${u.name} \u56DE\u6625\u91CD\u51FB \u2192 ${pool.length} \u540D\u961F\u53CB\u53D7\u7597`);
  }
  /** 召唤位上限（军团 +1） */
  maxSummonsFor(u) {
    return MAX_SUMMONS + (u.traitId === "legion" ? TRAIT_CFG.legionExtraSummon : 0);
  }
  // v2.9.14：层内 30s 后的「终局衰减」——物/魔减伤每秒 −2pp，爆伤每秒 +10pp。
  // 纯 sim.time 函数，确定性零影响（与播放速度无关，按游戏秒计；双方单位同受）。
  lateDecay() {
    return Math.max(0, this.time - 30);
  }
  effResist(target, type) {
    const base2 = type === "magic" ? target.derived.mResist : type === "physical" ? target.derived.pResist : (target.derived.pResist + target.derived.mResist) / 2;
    return Math.max(0, base2 - 2 * this.lateDecay());
  }
  effCritDmg(u) {
    return u.derived.critDmg + 10 * this.lateDecay();
  }
  applyDamage(target, amount, type, crit, attacker, heavy = false, trueDmg = false) {
    if (!trueDmg && target.beastTrait === "immunity" && (type === "physical" || type === "magic")) {
      const ph = (target.immunityPhase ?? 0) === 1;
      const mh = (target.immunityPhase ?? 0) === 2;
      if (type === "physical" && ph || type === "magic" && mh) {
        this.floaters.push({ x: target.x, y: target.y - 0.3, text: "\u514D\u75AB", color: "#7ad0ff", ttl: 0.7 });
        this.pushLog(`${target.name} \u514D\u75AB${type === "physical" ? "\u7269\u7406" : "\u9B54\u6CD5"}\u4F24\u5BB3`);
        return;
      }
    }
    const resist = trueDmg ? 0 : this.effResist(target, type);
    let dmgMult = (1 - resist / 100) * (target.derived.dmgTakenMult ?? 1);
    let dodged = false;
    if ((target.bodyType === "petite" || target.bodyType === "gnome") && attacker) {
      const far = dist(attacker, target) >= 4;
      const ranged2 = SUBCLASS_INFO[attacker.subclass].attackRange > 3;
      if (far && ranged2) {
        dodged = true;
        dmgMult *= target.bodyType === "gnome" ? 0.88 : 0.92;
      }
    }
    if (target.braceUntil && target.braceUntil > this.time) dmgMult *= 0.9;
    dmgMult = Math.max(0.1, dmgMult);
    dmgMult *= target.tileDmgTaken ?? 1;
    const outMult = this.traitOutMult(attacker, target);
    dmgMult *= outMult;
    if (outMult > 1 && attacker?.traitId && TRAIT_VFX[attacker.traitId]) {
      const fx = TRAIT_VFX[attacker.traitId];
      this.emit(fx.shape, target.x, target.y, fx.color, 0.3, { r: target.hitRadius * 1.4, alphaFrom: 0.8, alphaTo: 0 });
    }
    let dmg = amount * dmgMult;
    dmg = Math.min(dmg, 2147483647);
    if (target.shield > 0) {
      const a = Math.min(target.shield, dmg);
      target.shield -= a;
      dmg -= a;
    }
    target.hp -= dmg;
    if (attacker) attacker.dmgDealt = (attacker.dmgDealt ?? 0) + dmg;
    target.dmgTaken = (target.dmgTaken ?? 0) + dmg;
    target.flashType = type;
    if (target.side === "enemy" && attacker?.side === "ally" && attacker.heroUid) {
      let set = this.damagers.get(target.id);
      if (!set) {
        set = /* @__PURE__ */ new Set();
        this.damagers.set(target.id, set);
      }
      set.add(attacker.heroUid);
    }
    target.flash = 0.12;
    const ranged = attacker ? this.attackRangeOf(attacker) > 3 : false;
    const variant = attacker && attacker.gender ? { subclass: attacker.subclass, gender: attacker.gender } : void 0;
    if (crit) this.emitAudio({ id: "crit", x: target.x, arenaW: this.W, variant });
    else if (heavy) this.emitAudio({ id: "hit_heavy", x: target.x, arenaW: this.W, variant });
    else this.emitAudio({ id: ranged ? "hit_ranged" : "hit_melee", x: target.x, arenaW: this.W, variant });
    if (target.bodyType === "heavy" && dmg >= target.maxHp * 0.15) {
      target.braceUntil = this.time + 1.5;
    }
    this.floaters.push({
      x: target.x,
      y: target.y - 0.3,
      // 「难瞄」生效时飘字加 ~ 前缀，提示"被打偏了"（美术 §4.5.4）
      text: (dodged ? "~" : "") + String(Math.round(dmg)),
      color: crit ? "#ffcc4d" : "#ffffff",
      ttl: 0.8
    });
    this.traitOnHit(target, dmg, type, attacker);
    if (attacker?.traitId === "grower" && !attacker.isSummon && target.side !== attacker.side && this.rng() < TRAIT_CFG.growerInstakillP) {
      const aSize = attacker.hitRadius * (attacker.sizeScale ?? 1);
      const tSize = target.hitRadius * (target.sizeScale ?? 1);
      if (aSize > tSize) {
        target.hp = 0;
        this.pushLog(`${attacker.name} \u6210\u957F\u8005\u79D2\u6740\u4F53\u578B\u66F4\u5C0F\u7684 ${target.name}`);
        this.emit("ring", target.x, target.y, "#7ee08a", 0.35, { r: target.hitRadius * 1.6 });
      }
    }
    this.killIfDown(target, attacker);
  }
  /** 闪避判定 + 轻捷/灵巧「滑步」联动（需求 §5.2.1；v2.8 slim 进阶） */
  tryDodge(target, attacker) {
    if (attacker?.bodyType === "giant") return false;
    const dodge = Math.min(75, target.derived.dodge);
    if (this.rng() >= dodge / 100) return false;
    if (target.bodyType === "light" || target.bodyType === "slim") target.glideUntil = this.time + 0.8;
    target.lastDodgeAt = this.time;
    target.flash = Math.max(target.flash, 0.18);
    this.emit("trail", target.x - 0.35, target.y, "#bfe0ff", 0.28, {
      tx: target.x + 0.35,
      ty: target.y,
      r: target.hitRadius * 1.5,
      alphaFrom: 0.9,
      alphaTo: 0
    });
    this.floaters.push({ x: target.x, y: target.y - 0.3, text: "MISS", color: "#9fb4d4", ttl: 0.6 });
    this.emitAudio({ id: "dodge", x: target.x, arenaW: this.W });
    return true;
  }
  applyHeal(target, amount, healer) {
    if (!target.alive) return;
    const eff = target.bodyType === "obese" ? amount * 1.15 : amount;
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + eff);
    const done = target.hp - before;
    if (healer) healer.healDone = (healer.healDone ?? 0) + done;
    if (done > 0.5) {
      this.floaters.push({
        x: target.x,
        y: target.y - 0.3,
        text: "+" + String(Math.round(done)),
        color: "#aef0c0",
        ttl: 0.8
      });
    }
    const over = eff - done;
    if (over > 0.5 && healer?.traitId === "grace") {
      const s = over * TRAIT_CFG.graceOverhealToShield;
      target.shield += s;
      this.floaters.push({
        x: target.x,
        y: target.y - 0.7,
        text: `\u76FE +${Math.round(s)}`,
        color: "#7fe3b0",
        ttl: 0.8
      });
      this.emit("bubble", target.x, target.y, "#7fe3b0", 0.4, { r: target.hitRadius * 1.7 });
    }
    this.emitAudio({ id: "heal", x: target.x, arenaW: this.W });
  }
  /**
   * v3.1 签名技效果乘子（技能等级 = 星级，+18%/星）。
   * 只在 castSkill 内部显式相乘，不塞进 dealSkill——
   * dealSkill 同时服务坐骑技与元素附伤，塞进去会让坐骑吃两层星级乘区。
   */
  skillPow(u) {
    return u.skillPower ?? 1;
  }
  dealSkill(u, target, amount, type, crit = false, trueDmg = false) {
    const c = crit || this.rng() < u.derived.crit / 100;
    const dmg = amount * (c ? this.effCritDmg(u) / 100 : 1) * u.dmgMult;
    this.applyDamage(target, dmg, type, c, u, false, trueDmg);
  }
  basicAttack(u, target, heavy = false) {
    if (this.tryDodge(target, u)) return;
    if (u.traitId === "volley") {
      u.traitStacks = u.lastHitTargetId === target.id ? Math.min(TRAIT_CFG.volleyMaxStacks, (u.traitStacks ?? 0) + 1) : 0;
    }
    const base2 = u.atkRatio ? u.derived.pDmg * u.atkRatio.p + u.derived.mDmg * u.atkRatio.m : u.damageType === "magic" ? u.derived.mDmg : u.damageType === "physical" ? u.derived.pDmg : (u.derived.pDmg + u.derived.mDmg) / 2;
    const crit = this.rng() < u.derived.crit / 100;
    const mult = u.isBuilding ? 1 : heavy ? 2.3 + this.atkRng() * 1.3 : 0.75 + this.atkRng() * 0.35;
    const roleMult = this.isHealAttacker(u) ? HEALER_LIGHT_DMG_MULT : 1;
    let tankBonus = 0;
    if (u.subclass === "physTank" || u.subclass === "magicTank") {
      tankBonus = u.maxHp * 0.08 + target.hp * 0.05 + u.shield * 0.7;
    }
    const dmg = base2 * mult * roleMult * (crit ? this.effCritDmg(u) / 100 : 1) * u.dmgMult + tankBonus;
    this.applyDamage(target, dmg, u.damageType, crit, u, heavy);
    if (heavy) target.flash = Math.max(target.flash, 0.2);
    if (heavy && this.attackRangeOf(u) <= 3 && target.bodyType !== "giant" && target.bodyType !== "titan") {
      target.kdUntil = Math.max(target.kdUntil ?? 0, this.time + 0.9);
    }
    if (heavy) {
      this.floaters.push({ x: target.x, y: target.y - 0.6, text: "\u91CD\u51FB", color: "#ffd24d", ttl: 0.55 });
    }
    u.lastHitTargetId = target.id;
    if (u.traitId === "momentum") {
      u.traitStacks = Math.min(TRAIT_CFG.momentumMaxStacks, (u.traitStacks ?? 0) + 1);
      u.lifestealStacks = Math.min(TRAIT_CFG.momentumLifestealMax, (u.lifestealStacks ?? 0) + 1);
      u.lastBasicAt = this.time;
    }
    if (this.attackRangeOf(u) > 3) {
      this.projectiles.push({
        x: u.x,
        y: u.y,
        tx: target.x,
        ty: target.y,
        color: this.colorOf(u),
        ttl: heavy ? 0.3 : 0.18,
        heavy
      });
    }
  }
  /** 单位普攻射程：召唤物用模板射程，其余用子类射程 */
  attackRangeOf(u) {
    if (u.summonKind) return SUMMON_TEMPLATES[u.summonKind].range;
    return SUBCLASS_INFO[u.subclass].attackRange + (u.rangeBonus ?? 0);
  }
  colorOf(u) {
    if (u.summonKind) return SUMMON_TEMPLATES[u.summonKind].color;
    return SUBCLASS_INFO[u.subclass].color;
  }
  /**
   * 三类召唤物之一（需求 v1.4 §5.2.2；美术 §7.4）
   * 属性全部按召唤者 INT 折算，体型来自模板——石魂卫魁梧、影刃仆精巧、咒火灵轻捷，
   * 玩家在它开打之前就能从剪影认出它是什么类型。
   */
  makeSummon(u, kind) {
    const tpl = SUMMON_TEMPLATES[kind];
    const int = u.primary.int;
    const inherit = u.traitId === "legion" ? 1 + TRAIT_CFG.legionAtkInherit : 1;
    const pow = this.skillPow(u);
    const primary = { con: 4, str: 4, agi: 4, int: Math.round(int * tpl.atkRatio * inherit * pow) };
    const derived = derive(primary);
    derived.hp = Math.max(1, Math.round(int * 10 * tpl.hpRatio * pow));
    derived.moveSpeed = derived.moveSpeed * tpl.moveMult + (tpl.moveMult - 1) * 100;
    const hp = derived.hp;
    return {
      id: this.nextSpawnId(`sum_${kind}_`),
      side: u.side,
      name: tpl.name,
      category: "mage",
      subclass: "summoner",
      damageType: "magic",
      x: u.x + 0.6,
      y: u.y,
      hp,
      maxHp: hp,
      primary,
      derived,
      cd: 0,
      skill: { id: "none", name: "\u666E\u653B", cd: 0, damageType: "magic", desc: "" },
      skillCd: 0,
      alive: true,
      shield: 0,
      rootUntil: 0,
      stunUntil: 0,
      tauntUntil: 0,
      dmgMult: 1,
      level: 1,
      isSummon: true,
      summonUntil: this.time + tpl.duration,
      summonTotal: tpl.duration,
      summonKind: kind,
      bodyType: tpl.bodyType,
      gender: u.gender,
      hitRadius: hitRadiusOf(tpl.bodyType),
      flash: 0,
      // v2.9.8：反查主人。召唤物的普攻/击杀要回流到女娲的大招冷却上
      casterHeroUid: u.heroUid
    };
  }
  /**
   * Boss 分身（美术 §7.2.1）
   * 走召唤物基础设施（isSummon + summonUntil），所以：
   *  · 不计入胜负判定 —— 杀光分身不算赢，逼玩家找本体
   *  · 用召唤物的窄 HUD —— 屏幕不会被 3 条 Boss 血条淹没
   * 分身不再分裂（skillCd 拉到无穷），否则 12s 一轮就是指数爆炸。
   */
  makeClone(boss, idx) {
    const primary = { ...boss.primary };
    const derived = { ...boss.derived };
    derived.hp = Math.max(1, Math.round(boss.maxHp * BOSS_CLONE_HP));
    derived.pDmg *= BOSS_CLONE_DMG;
    derived.mDmg *= BOSS_CLONE_DMG;
    const hp = derived.hp;
    const ang = idx / BOSS_CLONE_COUNT * Math.PI * 2;
    const body = boss.bodyType === "giant" ? "titan" : boss.bodyType === "titan" ? "colossal" : boss.bodyType === "obese" || boss.bodyType === "colossal" ? "heavy" : "medium";
    return {
      id: this.nextSpawnId(`clone_${idx}_`),
      side: boss.side,
      name: `${boss.name}\xB7\u6B8B\u5F71`,
      category: boss.category,
      subclass: boss.subclass,
      damageType: boss.damageType,
      x: clamp2(boss.x + dcos(ang) * 1.2, 0.6, this.W - 0.6),
      y: clamp2(boss.y + dsin(ang) * 1.2, 0.6, this.H - 0.6),
      hp,
      maxHp: hp,
      primary,
      derived,
      cd: 0,
      skill: { id: "none", name: "\u666E\u653B", cd: 0, damageType: boss.damageType, desc: "" },
      skillCd: Number.POSITIVE_INFINITY,
      alive: true,
      shield: 0,
      rootUntil: 0,
      stunUntil: 0,
      tauntUntil: 0,
      dmgMult: boss.dmgMult,
      level: boss.level,
      isSummon: true,
      summonUntil: this.time + BOSS_CLONE_DURATION,
      summonTotal: BOSS_CLONE_DURATION,
      bodyType: body,
      gender: boss.gender,
      hitRadius: hitRadiusOf(body),
      flash: 0,
      // v2.9 分身继承本体的轻/重击节奏（同门同套路）
      combo: boss.combo ?? 0,
      heavyAt: boss.heavyAt ?? 5,
      heavyBurst: 0,
      heavyBurstCount: boss.heavyBurstCount ?? 1,
      heavyLock: 0,
      lightAs: boss.lightAs ?? 130,
      heavyAs: boss.heavyAs ?? 40,
      heavyArmorUntil: 0,
      isHeavyHit: false
    };
  }
  /**
   * v1.8.4 兽类「下一站」：母体产 3~6 只小个体。
   *  · 生命减半 / 体型小 40%（sizeScale ×0.6）/ 移速快 30%
   *  · isBeastling 标记 + parentId 指向母体；母体死亡时由 killIfDown 写入 vengeTargetId（复仇）
   *  · 数量与落点确定性：消费主 rng 流（同 seed 同战斗必然一致）
   */
  spawnBeastlings(mother) {
    const n = 3 + Math.floor(this.rng() * 4);
    for (let k = 0; k < n; k++) {
      const derived = { ...mother.derived };
      derived.moveSpeed *= 1.3;
      const b = {
        ...mother,
        id: this.nextSpawnId(`beast_${k}_`),
        name: `${mother.name}\xB7\u5E7C\u4F53`,
        isBeastling: true,
        parentId: mother.id,
        beastTrait: void 0,
        nestDone: true,
        isSummon: false,
        summonUntil: void 0,
        maxHp: mother.maxHp * 0.5,
        hp: mother.maxHp * 0.5,
        sizeScale: (mother.sizeScale ?? 1) * 0.6,
        derived,
        x: clamp2(mother.x + (this.rng() - 0.5) * 1, 0.6, this.W - 0.6),
        y: clamp2(mother.y + (this.rng() - 0.5) * 1, 0.6, this.H - 0.6)
      };
      this._push(b);
    }
    this.pushLog(`${mother.name} \u4E0B\u4E00\u7AD9 \u2192 \u4EA7\u4E0B ${n} \u53EA\u5C0F\u4E2A\u4F53`);
    this.emit("ring", mother.x, mother.y, "#ffb15a", 0.5, { r: 1.2 });
    this.emitAudio({ id: "summon_expire", x: mother.x, arenaW: this.W });
  }
  shouldCast(u) {
    if (u.skillCd > 0) return false;
    const enemies = this.alive("enemy");
    if (!enemies.length) return false;
    switch (u.skill.id) {
      case "taunt":
        return this.inCastRange(u, enemies).length >= 1 && this.alive("ally").some((a) => a.hp < a.maxHp * 0.6);
      case "ward":
        return u.hp < u.maxHp * 0.7;
      case "groupheal":
        return this.inCastRange(u, this.alive("ally")).some((a) => a.hp < a.maxHp * 0.8);
      case "summon":
        return enemies.length >= 1;
      case "hexburst":
        return this.inCastRange(u, enemies).length >= 2;
      case "timelock":
        return this.inCastRange(u, enemies).length >= 2;
      case "boss_stomp":
        return this.alive("ally").some((a) => dist(a, u) <= 3);
      case "boss_devour":
        return enemies.length >= 1;
      case "whelp_breath":
      case "lair_dragon_breath":
      case "m_dragon_skill":
        return this.inCastRange(u, enemies).length >= 1;
      case "van_ram":
        return this.inCastRange(u, enemies).length >= 1;
      default:
        return true;
    }
  }
  /**
   * 施放技能。v1.4 三条纪律：
   *  1) 任何 castRange > 0 的技能都先发起手距离环（三件套 ①）
   *  2) 特效主尺寸 = castRange × TILE，禁止硬编码（三件套 ②）
   *  3) 命中反馈时长按四档位取 TIER_TTL（三件套 ③）
   */
  castSkill(u) {
    if (u.side === "enemy" && u.focusRole === "back" && this.backShackleCount < this.enemyFocus.maxBackPerBattle) {
      if (this.focusRoll(this.enemyFocus.backShackleP)) {
        const strongest = findStrongestAlly(this.units);
        if (strongest && strongest.stunUntil <= this.time && !strongest.shackleWith) {
          this.backShackleCount++;
          const T = this.enemyFocus.backShackleT;
          strongest.stunUntil = this.time + T;
          strongest.rootUntil = this.time + T;
          u.stunUntil = this.time + T;
          u.rootUntil = this.time + T;
          strongest.shackleWith = u.id;
          u.shackleWith = strongest.id;
          this.pushLog(`${u.name} \u6346\u4ED9\u7EF3 \u2192 \u5C01\u5370 ${strongest.name}\uFF08\u51FB\u6740\u4EFB\u4E00\u65B9\u89E3\u9664\uFF09`);
          this.emitAudio({ id: "cc_root", x: strongest.x, arenaW: this.W });
          this.floaters.push({ x: strongest.x, y: strongest.y - 0.9, text: "\u6346\u4ED9\u7EF3", color: "#ffe08a", ttl: 1.3 });
          this.emit("ring", strongest.x, strongest.y, "#ffe08a", 0.5, { r: strongest.hitRadius * 2 });
          u.skillCd = u.skill.cd;
          return;
        }
      }
    }
    u.skillCd = u.skill.cd * (1 - (u.skillCdr ?? 0));
    if (u.skill.id === "none") {
      u.skillCd = 999;
      return;
    }
    const enemies = this.alive("enemy");
    const allies = this.alive("ally");
    const sig = vfxOf(u.skill, u.isBoss);
    this.castAnim(u);
    const R = this.castRangeOf(u);
    const tier = rangeTier(R);
    const ttl = TIER_TTL[tier];
    const touched = [];
    const P = this.skillPow(u);
    this.windup(u, R, sig.color);
    const castSound = {
      taunt: "cast_taunt",
      ward: "cast_ward",
      charge: "cast_charge",
      hexburst: "cast_hexburst",
      barrage: "cast_barrage",
      deadshot: "cast_deadshot_warn",
      timelock: "cast_timelock",
      summon: "cast_summon",
      groupheal: "cast_groupheal",
      boss_stomp: "cast_boss_stomp",
      boss_devour: "cast_boss_devour_warn",
      boss_split: "cast_boss_split"
    };
    this.emitAudio({
      id: castSound[u.skill.id] ?? "cast_generic",
      x: u.x,
      arenaW: this.W,
      variant: u.gender ? { subclass: u.subclass, gender: u.gender } : void 0
    });
    switch (u.skill.id) {
      case "taunt": {
        const hit = this.inCastRange(u, enemies);
        u.tauntUntil = this.time + 3;
        this.emitAudio({ id: "cc_taunt", x: u.x, arenaW: this.W });
        for (const e of hit) e.targetId = u.id;
        touched.push(...hit);
        this.emit("ring", u.x, u.y, sig.color, ttl, { r: R, tier, motion: sig.motion, sizeMul: sig.sizeMul });
        for (let i = 0; i < 3; i++) {
          this.emit("ring", u.x, u.y, i % 2 ? "#c9d4ff" : sig.color, 0.46, {
            r: R * (0.55 + i * 0.28),
            tier,
            sizeMul: sig.sizeMul,
            delay: 0.07 * i,
            alphaFrom: 0.85,
            alphaTo: 0
          });
        }
        this.ultRadial("blade", u.x, u.y, "#6f8fe0", 0.48, {
          n: 6,
          rad: R * 0.62,
          size: 1.9,
          step: 0.045,
          tier,
          sizeMul: sig.sizeMul
        });
        this.ultBurst(u.x, u.y, { core: sig.color, echo: "#c9d4ff", r: R * 0.95, tier, sizeMul: sig.sizeMul, quake: "#2c3f7a" });
        this.emit("quake", u.x, u.y, sig.color, 0.5, { r: R * 0.8, tier, sizeMul: sig.sizeMul });
        this.ultName(u.x, u.y, u.skill.name, sig.color);
        this.markCrater(u.x, u.y, R * 0.6, u);
        if (u.hp > u.maxHp * STAGE2_CFG.tauntHpGate && hit.length) {
          for (const e of hit) this.dealSkill(u, e, u.derived.pDmg * STAGE2_CFG.tauntWaveRatio * P, "physical");
          this.emit("shock", u.x, u.y, sig.color, ttl * 0.8, {
            r: R * 0.9,
            tier,
            motion: sig.motion,
            sizeMul: sig.sizeMul
          });
          this.pushLog(`${u.name} \u6012\u543C\u9707\u8361\uFF08${hit.length} \u76EE\u6807\uFF09`);
        }
        break;
      }
      case "ward": {
        const missing = 1 - u.hp / u.maxHp;
        const bonus = 1 + missing * STAGE2_CFG.wardMissingBonusMax;
        u.shield += (u.primary.int * 2 + 50) * bonus * P;
        const wr = u.hitRadius * 1.8;
        this.emit("bubble", u.x, u.y, sig.color, ttl, { r: wr, tier, motion: sig.motion, sizeMul: sig.sizeMul });
        this.ultRadial("blade", u.x, u.y, "#d9b8ff", 0.5, {
          n: 8,
          rad: wr * 1.55,
          size: 1.15,
          step: 0.035,
          tier,
          sizeMul: sig.sizeMul,
          phase: 0.3
        });
        for (let i = 0; i < 3; i++) {
          this.emit("ring", u.x, u.y, i % 2 ? "#e0c9ff" : sig.color, 0.42, {
            r: wr * (2.2 - i * 0.5),
            tier,
            sizeMul: sig.sizeMul,
            delay: 0.06 * i,
            alphaFrom: 0.9,
            alphaTo: 0
          });
        }
        this.ultBurst(u.x, u.y, { core: sig.color, echo: "#e0c9ff", r: wr * 2, tier, sizeMul: sig.sizeMul });
        this.emit("light", u.x, u.y, "#c9a8ff", 0.55, { r: wr * 1.7, alphaFrom: 0.7, alphaTo: 0 });
        this.ultName(u.x, u.y, u.skill.name, sig.color);
        break;
      }
      case "charge": {
        const ox = u.x, oy = u.y;
        const reach = this.inCastRange(u, enemies);
        const t = reach.length ? this.farthest(reach, u) : null;
        if (t) {
          u.x = clamp2(t.x, 0.6, this.W - 0.6);
          u.y = clamp2(t.y - 1, 0.6, this.H - 0.6);
          const burst = u.hp < u.maxHp * STAGE2_CFG.chargeHpGate ? STAGE2_CFG.chargeBurstMult : 1;
          this.dealSkill(u, t, u.derived.pDmg * 2.5 * burst * P, "physical");
          const ls = u.lifestealStacks ?? 0;
          if (ls > 0) {
            const heal = u.derived.pDmg * 2.5 * burst * P * u.dmgMult * TRAIT_CFG.momentumLifestealPerStack * ls;
            this.applyHeal(u, heal, u);
            this.pushLog(`${u.name} \u52BF\u80FD\u5438\u8840 +${Math.round(heal)}\uFF08${ls} \u5C42\uFF09`);
          }
          if (burst > 1) this.pushLog(`${u.name} \u80CC\u6C34\u51B2\u950B\uFF08\xD7${STAGE2_CFG.chargeBurstMult}\uFF09`);
          t.stunUntil = this.time + 1;
          this.emitAudio({ id: "cc_stun", x: t.x, arenaW: this.W });
          touched.push(t);
          this.emit("trail", ox, oy, sig.color, ttl, { tx: u.x, ty: u.y, r: R, tier, motion: sig.motion, sizeMul: sig.sizeMul });
          this.emit("blade", t.x, t.y, "#ff2a1a", 0.7, { r: 3.6, tier, sizeMul: sig.sizeMul });
          this.emit("blade", t.x, t.y, "#ffd0c4", 0.52, { r: 3, tier, sizeMul: sig.sizeMul, delay: 0.05 });
          for (let i = 0; i < 2; i++) {
            const off = 0.95 + i * 0.85;
            const h = 2.5 - i * 0.7;
            const dl = 0.06 + i * 0.07;
            this.emit("blade", t.x - off, t.y, "#ff4d3d", 0.5, { r: h, tier, sizeMul: sig.sizeMul, delay: dl });
            this.emit("blade", t.x + off, t.y, "#ff4d3d", 0.5, { r: h, tier, sizeMul: sig.sizeMul, delay: dl });
          }
          this.emit("nova", t.x, t.y, "#ff3a24", 0.42, { r: 2.6, tier, motion: sig.motion, sizeMul: sig.sizeMul });
          this.emit("shock", t.x, t.y, "#ff6a4a", 0.5, { r: 2.9, tier, sizeMul: sig.sizeMul, alphaFrom: 0.85, alphaTo: 0 });
          this.emit("quake", t.x, t.y, "#8c1a10", 0.55, { r: 2.2, tier, sizeMul: sig.sizeMul, delay: 0.05 });
          this.emit("ring", t.x, t.y, "#ffd0c4", 0.3, { r: 1.5, alphaFrom: 0.9, alphaTo: 0 });
          this.floaters.push({ x: t.x, y: t.y - 1.4, text: "\u5043\u6708\u7A81\u65A9", color: "#ff6a4a", ttl: 0.9 });
          this.emitAudio({
            id: "cast_charge",
            x: t.x,
            arenaW: this.W,
            gain: 1,
            variant: u.gender ? { subclass: u.subclass, gender: u.gender } : void 0
          });
          this.markSlash(ox, oy, t.x, t.y, u);
          this.emit("beam", u.x, u.y, sig.color, ttl * 0.4, {
            tx: t.x,
            ty: t.y,
            r: 0.3,
            tier,
            thickness: beamThickness(R),
            motion: sig.motion,
            sizeMul: sig.sizeMul
          });
          this.emit("beam", ox, oy, "#ff2a1a", 0.26, {
            tx: t.x,
            ty: t.y,
            r: 0.3,
            tier,
            thickness: beamThickness(R) * 2.2,
            alphaFrom: 0.75,
            alphaTo: 0
          });
          this.emit("beam", ox, oy, "#ffe2da", 0.2, {
            tx: t.x,
            ty: t.y,
            r: 0.3,
            tier,
            thickness: beamThickness(R) * 0.9,
            alphaFrom: 0.9,
            alphaTo: 0,
            delay: 0.04
          });
        }
        break;
      }
      case "van_ram": {
        const hit = this.inCastRange(u, enemies);
        if (!hit.length) break;
        this.dealRam(u, hit);
        touched.push(...hit);
        const opening = this.vanSpeedMult(u) > 1;
        this.emit("shock", u.x, u.y, "#ffcf3d", opening ? 0.42 : 0.28, {
          r: R,
          tier,
          alphaFrom: opening ? 0.85 : 0.5,
          alphaTo: 0
        });
        this.emit("quake", u.x, u.y, "#6b5a1a", opening ? 0.4 : 0.26, {
          r: R * 0.9,
          tier,
          sizeMul: sig.sizeMul,
          delay: 0.04
        });
        if (opening) {
          const t0 = this.nearest(hit, u);
          this.emit("beam", u.x, u.y, "#fff0b8", 0.22, {
            tx: t0.x,
            ty: t0.y,
            r: 0.3,
            tier,
            thickness: beamThickness(R) * 1.8,
            alphaFrom: 0.8,
            alphaTo: 0
          });
          this.floaters.push({ x: u.x, y: u.y - 1.2, text: "\u86EE\u6A2A\u51B2\u649E", color: "#ffcf3d", ttl: 0.8 });
        }
        this.emitAudio({ id: opening ? "cast_boss_stomp" : "cast_charge", x: u.x, arenaW: this.W });
        this.markCrater(u.x, u.y, R * 0.7, u);
        break;
      }
      case "hexburst": {
        const hit = this.inCastRange(u, enemies);
        for (const e of hit) {
          this.dealSkill(u, e, (u.derived.pDmg * 0.9 + u.derived.mDmg * 1.3) * P, "hybrid");
        }
        touched.push(...hit);
        if (hit.length) {
          this.applyHeal(u, u.maxHp * STAGE2_CFG.hexburstLifestealPct * hit.length, u);
        }
        this.emit("nova", u.x, u.y, sig.color, ttl, { r: R * 0.9, tier, motion: sig.motion, sizeMul: sig.sizeMul });
        this.ultRadial("blade", u.x, u.y, "#eaf3ff", 0.44, {
          n: 8,
          rad: R * 0.66,
          size: 1.7,
          step: 0.03,
          tier,
          sizeMul: sig.sizeMul
        });
        this.emit("nova", u.x, u.y, "#eaf3ff", 0.36, {
          r: R * 0.6,
          tier,
          motion: sig.motion,
          sizeMul: sig.sizeMul,
          delay: 0.08,
          alphaFrom: 0.9,
          alphaTo: 0
        });
        this.ultBurst(u.x, u.y, { core: sig.color, echo: "#eaf3ff", r: R * 1, tier, sizeMul: sig.sizeMul, quake: "#6a8099" });
        this.ultName(u.x, u.y, u.skill.name, sig.color);
        break;
      }
      case "barrage": {
        const reach = this.inCastRange(u, enemies);
        let lastX = u.x, lastY = u.y, fired = 0;
        for (let i = 0; i < 5; i++) {
          const t = pick(this.rng, reach);
          if (!t) continue;
          const ramp = 1 + STAGE2_CFG.barrageRampPerShot * i;
          this.dealSkill(u, t, u.derived.pDmg * 0.8 * ramp * P, "physical");
          touched.push(t);
          lastX = t.x;
          lastY = t.y;
          fired++;
          const d = i * 0.05;
          this.emit("beam", u.x, u.y, sig.color, ttl * 0.35, {
            tx: t.x,
            ty: t.y,
            r: 0.2,
            tier,
            thickness: beamThickness(R),
            delay: d,
            motion: sig.motion,
            sizeMul: sig.sizeMul
          });
          this.emit("nova", u.x, u.y, "#ffd9a8", 0.16, { r: 0.75, tier, delay: d, alphaFrom: 0.95, alphaTo: 0 });
          this.emit("shock", t.x, t.y, sig.color, 0.3, {
            r: 0.85 + i * 0.14,
            tier,
            sizeMul: sig.sizeMul,
            delay: d + 0.04,
            alphaFrom: 0.9,
            alphaTo: 0
          });
          this.emit("ring", t.x, t.y, "#ffe6c2", 0.22, { r: 0.5 + i * 0.1, delay: d + 0.05, alphaFrom: 0.9, alphaTo: 0 });
        }
        if (fired) {
          this.ultBurst(lastX, lastY, { core: sig.color, echo: "#ffe6c2", r: 1.9, tier, sizeMul: sig.sizeMul, quake: "#7a4a1a" });
          this.ultName(u.x, u.y, u.skill.name, sig.color);
        }
        break;
      }
      case "deadshot": {
        const reach = this.inCastRange(u, enemies);
        const t = reach.length ? this.lowestHp(reach) : null;
        if (t) {
          this.emit("beam", u.x, u.y, "#ff6a6a", LONG_WARN_TIME, {
            tx: t.x,
            ty: t.y,
            r: 0.1,
            tier,
            thickness: 1,
            alphaFrom: 0.5,
            alphaTo: 0.5
          });
          this.emit("beam", u.x, u.y, sig.color, ttl - LONG_WARN_TIME, {
            tx: t.x,
            ty: t.y,
            r: 0.25,
            tier,
            thickness: beamThickness(R),
            delay: LONG_WARN_TIME,
            motion: sig.motion,
            sizeMul: sig.sizeMul
          });
          this.emit("beam", u.x, u.y, "#fff2c9", ttl - LONG_WARN_TIME, {
            tx: t.x + 0.45,
            ty: t.y - 0.35,
            r: 0.2,
            tier,
            thickness: beamThickness(R) * 0.45,
            delay: LONG_WARN_TIME + 0.03,
            alphaFrom: 0.8,
            alphaTo: 0
          });
          this.emit("beam", u.x, u.y, "#fff2c9", ttl - LONG_WARN_TIME, {
            tx: t.x - 0.45,
            ty: t.y + 0.35,
            r: 0.2,
            tier,
            thickness: beamThickness(R) * 0.45,
            delay: LONG_WARN_TIME + 0.06,
            alphaFrom: 0.8,
            alphaTo: 0
          });
          for (let i = 0; i < 3; i++) {
            this.emit("ring", u.x, u.y, "#ffcf4d", 0.2, {
              r: 1.4 - i * 0.35,
              delay: i * 0.06,
              alphaFrom: 0.85,
              alphaTo: 0
            });
          }
          touched.push(t);
          this.schedule(LONG_WARN_TIME, () => {
            if (!u.alive || !t.alive) return;
            const highHp = t.hp > t.maxHp * STAGE2_CFG.deadshotCritHpGate;
            this.dealSkill(u, t, u.derived.pDmg * 4 * P, "physical", highHp);
            if (highHp) this.pushLog(`${u.name} \u7834\u9635\u4E00\u51FB\uFF08\u5FC5\u5B9A\u66B4\u51FB\uFF09`);
            this.emit("sun", t.x, t.y, "#ffcf4d", 0.4, { r: 1.4, tier: "long" });
            this.emitAudio({
              id: "cast_deadshot_fire",
              x: t.x,
              arenaW: this.W,
              variant: u.gender ? { subclass: u.subclass, gender: u.gender } : void 0
            });
            this.ultName(u.x, u.y, u.skill.name, sig.color);
          });
        }
        break;
      }
      case "timelock": {
        const hit = this.inCastRange(u, enemies);
        for (const e of hit) {
          if (e.bodyType !== "giant" && e.bodyType !== "titan") {
            e.rootUntil = this.time + 2.5;
            e.ccColor = sig.color;
            this.emitAudio({ id: "cc_root", x: e.x, arenaW: this.W });
          }
          this.dealSkill(u, e, u.derived.mDmg * 1.2 * P, "magic");
        }
        touched.push(...hit);
        if (hit.length >= STAGE2_CFG.timelockRootGate) {
          u.skillCd *= 1 - STAGE2_CFG.timelockCdRefund;
          this.pushLog(`${u.name} \u5927\u8303\u56F4\u5B9A\u8EAB \xD7${hit.length} \u2192 \u8FD4\u8FD8\u51B7\u5374`);
        }
        this.emit("cage", u.x, u.y, sig.color, ttl, { r: R * 0.7, tier, motion: sig.motion, sizeMul: sig.sizeMul });
        this.ultRadial("blade", u.x, u.y, "#bff3ec", 0.5, {
          n: 8,
          rad: R * 0.78,
          size: 1.6,
          step: 0.04,
          tier,
          sizeMul: sig.sizeMul,
          phase: 0.39
        });
        for (let i = 0; i < 3; i++) {
          this.emit("ring", u.x, u.y, i % 2 ? "#bff3ec" : sig.color, 0.46, {
            r: R * (0.5 + i * 0.3),
            tier,
            sizeMul: sig.sizeMul,
            delay: 0.07 * i,
            alphaFrom: 0.85,
            alphaTo: 0
          });
        }
        this.ultBurst(u.x, u.y, { core: sig.color, echo: "#bff3ec", r: R * 0.9, tier, sizeMul: sig.sizeMul, quake: "#1f6b66" });
        this.ultName(u.x, u.y, u.skill.name, sig.color);
        break;
      }
      case "summon": {
        const cap = this.maxSummonsFor(u);
        const mine = this.units.filter((x) => x.isSummon && x.alive && x.side === u.side);
        if (mine.length >= cap) {
          const targets = mine.filter((m) => (m.traitStacks ?? 0) < STAGE2_CFG.summonEmpowerCap);
          if (targets.length) {
            for (const m of targets) {
              m.traitStacks = (m.traitStacks ?? 0) + 1;
              m.derived.pDmg *= 1 + STAGE2_CFG.summonEmpowerPct;
              m.derived.mDmg *= 1 + STAGE2_CFG.summonEmpowerPct;
              const add = Math.round(m.maxHp * STAGE2_CFG.summonEmpowerPct);
              m.maxHp += add;
              m.hp += add;
              m.summonUntil = (m.summonUntil ?? this.time) + STAGE2_CFG.summonEmpowerExtendSec;
              this.emit("bubble", m.x, m.y, "#9b7bff", 0.5, { r: m.hitRadius * 1.9 });
              this.floaters.push({
                x: m.x,
                y: m.y - 0.7,
                text: `\u5F3A\u5316 ${m.traitStacks}/${STAGE2_CFG.summonEmpowerCap}`,
                color: "#c9b0ff",
                ttl: 0.9
              });
            }
            this.pushLog(`\u53EC\u5524\u4F4D\u5DF2\u6EE1 \u2192 \u5F3A\u5316 ${targets.length} \u4E2A\u53EC\u5524\u7269`);
            this.emitAudio({ id: "summon_spawn", x: u.x, arenaW: this.W });
          } else {
            u.skillCd = u.skill.cd * 0.5;
          }
          break;
        }
        const { kind, reason } = pickSummonKind(
          this.alive(u.side),
          this.alive(u.side === "ally" ? "enemy" : "ally"),
          this.lastSummonKind
        );
        const tpl = SUMMON_TEMPLATES[kind];
        this._push(this.makeSummon(u, kind));
        this.lastSummonKind = kind;
        this.emitAudio({ id: "summon_spawn", x: u.x + 0.6, arenaW: this.W });
        this.pushLog(`${reason} \u2192 \u53EC\u5524${tpl.name}`);
        this.emit("rift", u.x + 0.6, u.y, tpl.riftColor, ttl, {
          r: tpl.riftW / 24 * 0.5,
          tier,
          motion: sig.motion,
          sizeMul: sig.sizeMul
        });
        this.ultRadial("blade", u.x + 0.6, u.y, "#e6c79a", 0.46, {
          n: 8,
          rad: R * 0.42,
          size: 1.2,
          step: 0.035,
          tier,
          sizeMul: sig.sizeMul
        });
        this.ultBurst(u.x + 0.6, u.y, { core: sig.color, echo: "#e6c79a", r: R * 0.45, tier, sizeMul: sig.sizeMul, quake: "#6b4a1f" });
        this.ultName(u.x, u.y, u.skill.name, sig.color);
        break;
      }
      case "groupheal": {
        const heal = this.inCastRange(u, allies);
        for (const a of heal) {
          const missing = 1 - a.hp / a.maxHp;
          this.applyHeal(a, u.derived.heal * 2 * P * (1 + missing * STAGE2_CFG.grouphealMissingWeight), u);
        }
        this.emit("light", u.x, u.y, sig.color, ttl, { r: R, tier, motion: sig.motion, sizeMul: sig.sizeMul });
        this.ultRadial("blade", u.x, u.y, "#bff7cf", 0.5, {
          n: 8,
          rad: R * 0.62,
          size: 1.5,
          step: 0.04,
          tier,
          sizeMul: sig.sizeMul,
          phase: 0.3
        });
        this.ultBurst(u.x, u.y, { core: sig.color, echo: "#bff7cf", r: R * 0.95, tier, sizeMul: sig.sizeMul });
        this.ultName(u.x, u.y, u.skill.name, sig.color);
        break;
      }
      case "boss_stomp":
        for (const a of this.inCastRange(u, allies)) this.dealSkill(u, a, u.derived.pDmg * 3, "physical");
        this.emit("shock", u.x, u.y, sig.color, ttl, { r: R, tier, motion: sig.motion, sizeMul: sig.sizeMul });
        this.emit("quake", u.x, u.y, sig.color, 0.55, { r: R * 0.9, tier, sizeMul: sig.sizeMul });
        break;
      case "boss_devour": {
        const victims = this.inCastRange(u, allies);
        for (const a of victims) {
          this.emit("beam", u.x, u.y, "#8a1a1a", LONG_WARN_TIME, {
            tx: a.x,
            ty: a.y,
            r: 0.1,
            tier,
            thickness: 1,
            alphaFrom: 0.5,
            alphaTo: 0.5
          });
        }
        this.emit("rift", u.x, u.y, sig.color, ttl, { r: R * 0.25, tier, delay: LONG_WARN_TIME, motion: sig.motion, sizeMul: sig.sizeMul });
        this.schedule(LONG_WARN_TIME, () => {
          if (!u.alive) return;
          for (const a of victims) {
            if (!a.alive) continue;
            const d = Math.min(a.maxHp * 0.1, a.hp);
            a.hp -= d;
            u.hp = Math.min(u.maxHp, u.hp + d);
            a.flash = 0.25;
            this.killIfDown(a, u);
            this.emit("beam", u.x, u.y, "#ff2e2e", 0.3, {
              tx: a.x,
              ty: a.y,
              r: 0.15,
              tier,
              thickness: 2
            });
            this.floaters.push({ x: a.x, y: a.y - 0.3, text: String(Math.round(d)), color: "#ff2e2e", ttl: 0.8 });
          }
          this.emitAudio({
            id: "cast_boss_devour",
            x: u.x,
            arenaW: this.W,
            variant: u.gender ? { subclass: u.subclass, gender: u.gender } : void 0
          });
        });
        break;
      }
      case "boss_split": {
        u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.2);
        this.emit("ring", u.x, u.y, sig.color, ttl, { r: u.hitRadius * 2, tier, motion: sig.motion, sizeMul: sig.sizeMul });
        for (let i = 0; i < BOSS_CLONE_COUNT; i++) {
          const c = this.makeClone(u, i);
          this._push(c);
          this.emit("rift", c.x, c.y, sig.color, 0.4, { r: 0.6, alphaFrom: 0.9, alphaTo: 0, motion: sig.motion, sizeMul: sig.sizeMul });
        }
        this.pushLog(`${u.name} \u6495\u88C2\u81EA\u8EAB \u2192 \u5206\u8EAB \xD7${BOSS_CLONE_COUNT}`);
        break;
      }
      case "whelp_breath":
      case "lair_dragon_breath":
      case "m_dragon_skill":
        this.dragonBreath(u);
        break;
    }
    if (u.traitId === "shackle" && touched.length) {
      const seen = /* @__PURE__ */ new Set();
      for (const e of touched) {
        if (!e.alive || seen.has(e.id)) continue;
        seen.add(e.id);
        e.slowUntil = this.time + TRAIT_CFG.shackleSlowDur;
        e.slowPct = Math.max(e.slowPct ?? 0, TRAIT_CFG.shackleSlowPct);
        this.emit("ring", e.x, e.y, "#7ad0ff", 0.3, { r: e.hitRadius * 1.4, alphaFrom: 0.6, alphaTo: 0 });
      }
      if (seen.size) {
        this.pushLog(`${TRAITS.shackle.name}\uFF1A${seen.size} \u4E2A\u76EE\u6807\u88AB\u7F1A\uFF08-${TRAIT_CFG.shackleSlowPct}% \u79FB\u901F\uFF09`);
      }
    }
  }
  // ══ v2.9.6 龙吐息（重做）══════════════════════════════════════════
  // 锥形 AoE：范围 = 3 × 龙体型直径，半角 ~35°，朝向最近敌人喷。
  // 火=灼烧 DoT（3s）/ 冰=冰冻（定身 1.5s）/ 毒=剧毒（5%·秒 × 4s），
  // 命中目标同时吃一次吐息直伤。属性（火/冰/毒）首喷时按种子随机定下，终生不变。
  dragonBreath(u) {
    const ELEM_KEYS = ["fire", "ice", "poison"];
    const ELEM_COLOR = { fire: "#ff5a2a", ice: "#7ad0ff", poison: "#39d353" };
    const ELEM_CN = { fire: "\u707C\u70E7", ice: "\u51B0\u51BB", poison: "\u5267\u6BD2" };
    if (!u.dragonElement) u.dragonElement = pick(this.rng, ELEM_KEYS);
    const elem = u.dragonElement;
    const range = 6 * u.hitRadius;
    const halfCos = dcos(35 * DEG);
    const foes = this.alive(u.side === "ally" ? "enemy" : "ally").filter((f) => !f.isBuilding);
    if (!foes.length) return;
    const t = this.nearest(foes, u);
    const aimX = t.x - u.x, aimY = t.y - u.y;
    const aimLen = len2d(aimX, aimY) || 1;
    const ax = aimX / aimLen, ay = aimY / aimLen;
    const mul = u.skill.id === "whelp_breath" ? 1.6 : u.skill.id === "m_dragon_skill" ? 3.5 : 3;
    const dmgType = u.skill.damageType;
    const ttl = TIER_TTL[rangeTier(this.castRangeOf(u))];
    for (const f of foes) {
      const dx = f.x - u.x, dy = f.y - u.y;
      const d = len2d(dx, dy);
      if (d > range + f.hitRadius) continue;
      const dot = (dx * ax + dy * ay) / (d || 1);
      if (dot < halfCos) continue;
      this.dealSkill(u, f, u.derived.pDmg * mul, dmgType);
      if (elem === "fire") {
        f.burnUntil = this.time + 3;
        f.burnDps = 0.05;
      } else if (elem === "ice") {
        f.freezeUntil = this.time + 1.5;
      } else {
        f.poisonUntil = this.time + 4;
      }
      this.emit("beam", u.x, u.y, ELEM_COLOR[elem], 0.3, { tx: f.x, ty: f.y, r: 0.35, thickness: 2 });
    }
    for (let i = -2; i <= 2; i++) {
      const d = drot(ax, ay, i * 14 * DEG);
      this.emit("beam", u.x, u.y, ELEM_COLOR[elem], ttl, {
        tx: u.x + d.x * range,
        ty: u.y + d.y * range,
        r: 0.5,
        thickness: 6,
        alphaFrom: 0.85,
        alphaTo: 0
      });
    }
    this.pushLog(`${u.name} \u9F99\u606F\uFF08${ELEM_CN[elem]}\uFF09`);
  }
  // ══ v2.6 §2 坐骑技能 ═══════════════════════════════════════════════
  // 与角色技能完全并行：独立 CD、独立判定、互不打断。
  // 之所以不塞进 castSkill 的 switch，是因为坐骑和职业是**正交**的两个维度——
  // 混在一起后每加一个坐骑就要在 9 个职业分支里各确认一遍，
  // 那种耦合会在第三次迭代时崩掉。
  shouldCastMount(u) {
    if (!u.mount || !u.mountSkill) return false;
    if ((u.mountCd ?? 0) > 0) return false;
    const foes = this.alive(u.side === "ally" ? "enemy" : "ally");
    if (!foes.length) return false;
    const r = u.mountSkill.castRange ?? 3;
    if (u.mount === "redhare") return true;
    return foes.some((f) => dist(f, u) <= r + f.hitRadius);
  }
  /**
   * 施放坐骑技能。五只坐骑对应五种「这只畜生本身会做的事」：
   *   战象踩踏 / 玄豹扑杀 / 白额虎咆哮 / 赤兔疾驰 / 蛮牛顶撞
   * 每一个都复用已有的 VFX 签名管线（vfxOf → emit），不新增渲染分支：
   * 新增分支意味着新增一套需要单独调的视觉参数，而坐骑技能的辨识度
   * 靠的是「形状 + 颜色 + 文案」，已有的九种签名足够覆盖。
   */
  castMountSkill(u) {
    const mk = u.mount;
    const sk = u.mountSkill;
    if (!mk || !sk) return;
    const m = MOUNTS[mk];
    u.mountCd = sk.cd;
    const foes = this.alive(u.side === "ally" ? "enemy" : "ally");
    const friends = this.alive(u.side);
    const R = sk.castRange ?? 3;
    const tier = rangeTier(R);
    const ttl = TIER_TTL[tier];
    const sig = vfxOf(sk, false);
    const color = m.accent;
    this.castAnim(u);
    this.windup(u, R, color);
    this.emitAudio({
      id: "cast_generic",
      x: u.x,
      arenaW: this.W,
      variant: u.gender ? { subclass: u.subclass, gender: u.gender } : void 0
    });
    const inR = foes.filter((f) => dist(f, u) <= R + f.hitRadius);
    switch (mk) {
      case "elephant": {
        for (const e of inR) {
          this.dealSkill(u, e, u.derived.pDmg * 2.2, "physical");
          if (e.bodyType !== "giant" && e.bodyType !== "titan") {
            e.stunUntil = Math.max(e.stunUntil, this.time + 1.2);
            this.emitAudio({ id: "cc_stun", x: e.x, arenaW: this.W });
          }
        }
        this.emit("shock", u.x, u.y, color, ttl, { r: R, tier, motion: sig.motion, sizeMul: sig.sizeMul });
        if (inR.length) this.pushLog(`${u.name} \u9A71${m.name}\u8E0F\u9635\uFF08${inR.length} \u76EE\u6807 \xB7 \u7729\u6655\uFF09`);
        break;
      }
      case "leopard": {
        const t = inR.length ? this.lowestHp(inR) : null;
        if (t) {
          const ox = u.x, oy = u.y;
          u.x = clamp2(t.x, 0.6, this.W - 0.6);
          u.y = clamp2(t.y + 0.9, 0.6, this.H - 0.6);
          this.faceToward(u, t);
          this.dealSkill(u, t, u.derived.pDmg * 3, "physical", true);
          this.emit("trail", ox, oy, color, ttl, { tx: u.x, ty: u.y, r: R, tier, motion: sig.motion, sizeMul: sig.sizeMul });
          this.emit("beam", u.x, u.y, color, ttl * 0.4, {
            tx: t.x,
            ty: t.y,
            r: 0.3,
            tier,
            thickness: beamThickness(R),
            motion: sig.motion,
            sizeMul: sig.sizeMul
          });
          this.pushLog(`${u.name} \u7EB5${m.name}\u6251\u6740 ${t.name}\uFF08\u5FC5\u66B4\uFF09`);
        }
        break;
      }
      case "tiger": {
        for (const e of inR) {
          e.slowUntil = Math.max(e.slowUntil ?? 0, this.time + 3);
          e.slowPct = Math.max(e.slowPct ?? 0, 50);
        }
        u.dmgMult *= 1.25;
        const back = u.dmgMult;
        this.schedule(5, () => {
          u.dmgMult = Math.max(1, back / 1.25);
        });
        this.emit("ring", u.x, u.y, color, ttl, { r: R, tier, motion: sig.motion, sizeMul: sig.sizeMul });
        this.emit("bubble", u.x, u.y, color, ttl * 0.7, { r: u.hitRadius * 1.9 });
        this.emit("ring", u.x, u.y, color, ttl * 1.4, { r: 1, tier: "self", motion: sig.motion, sizeMul: sig.sizeMul });
        this.emit("bubble", u.x, u.y, color, ttl * 1.4, { r: u.hitRadius * 2.2, alphaFrom: 0.22, alphaTo: 0 });
        this.pushLog(`${u.name} ${m.name}\u957F\u5578\uFF08${inR.length} \u76EE\u6807\u51CF\u901F \xB7 \u81EA\u8EAB\u589E\u4F24 25%\uFF09`);
        break;
      }
      case "redhare": {
        for (const a of friends) {
          a.derived.moveSpeed = clamp2(a.derived.moveSpeed * 1.6, 0, 95);
          a.derived.atkSpeed = clamp2(a.derived.atkSpeed + 25, 0, 260);
          this.emit("light", a.x, a.y, color, 0.5, { r: a.hitRadius * 1.6 });
          this.emit("ring", a.x, a.y, color, 0.7, { r: a.hitRadius * 1.3, tier: "self", motion: sig.motion, sizeMul: sig.sizeMul });
        }
        this.emit("ring", u.x, u.y, color, ttl * 1.4, { r: 1.2, tier: "self", motion: sig.motion, sizeMul: sig.sizeMul });
        const snapshot = friends.map((a) => ({ a, ms: a.derived.moveSpeed, as: a.derived.atkSpeed }));
        this.schedule(8, () => {
          for (const s of snapshot) {
            if (!s.a.alive) continue;
            s.a.derived.moveSpeed = s.ms / 1.6;
            s.a.derived.atkSpeed = Math.max(0, s.as - 25);
          }
        });
        this.emit("light", u.x, u.y, color, ttl, { r: R, tier, motion: sig.motion, sizeMul: sig.sizeMul });
        this.pushLog(`${u.name} \u7B56${m.name}\u75BE\u9A70\uFF08\u5168\u961F\u79FB\u901F +60% / \u653B\u901F +25%\uFF0C8 \u79D2\uFF09`);
        break;
      }
      case "ox": {
        const t = inR.length ? this.nearest(inR, u) : null;
        if (t) {
          this.faceToward(u, t);
          const dx = t.x - u.x, dy = t.y - u.y, dd = len2d(dx, dy) || 1;
          const ex = u.x + dx / dd * R, ey = u.y + dy / dd * R;
          for (const e of foes) {
            const t01 = clamp2(((e.x - u.x) * dx + (e.y - u.y) * dy) / (dd * dd), 0, 1);
            const px = u.x + dx * t01, py = u.y + dy * t01;
            if (len2d(e.x - px, e.y - py) > 0.9 + e.hitRadius) continue;
            this.dealSkill(u, e, u.derived.pDmg * 2, "physical");
            if (e.bodyType !== "giant" && e.bodyType !== "titan") {
              e.rootUntil = Math.max(e.rootUntil, this.time + 1);
              this.emitAudio({ id: "cc_root", x: e.x, arenaW: this.W });
            }
          }
          this.emit("beam", u.x, u.y, color, ttl, {
            tx: ex,
            ty: ey,
            r: 0.4,
            tier,
            thickness: beamThickness(R) + 1,
            motion: sig.motion,
            sizeMul: sig.sizeMul
          });
          this.pushLog(`${u.name} \u5FA1${m.name}\u51B2\u649E\uFF08\u76F4\u7EBF\u7A7F\u523A \xB7 \u5B9A\u8EAB\uFF09`);
        }
        break;
      }
    }
  }
  // ══ v2.6 §2 动作状态写入 ════════════════════════════════════════════
  // 全部由仿真侧写，渲染只读。渲染层自己算「上一帧到这一帧动了多少」听起来更省事，
  // 但帧率一波动动作就会抽搐，而且回放（固定步长）和实况（可变帧率）会呈现不同动作。
  faceToward(u, t) {
    if (Math.abs(t.x - u.x) < 0.05) return;
    u.facing = t.x >= u.x ? 1 : -1;
  }
  attackAnim(u) {
    u.attackAnimAt = this.time;
  }
  castAnim(u) {
    u.castAnimAt = this.time;
  }
  moveAnim(u) {
    u.moveAnimUntil = this.time + 0.12;
  }
  /**
   * 建筑落地。血量按层深 scaleHp 放大，与波次怪同一条缩放线——
   * 否则 20 层时营房会脆得像纸，「拆楼」这个决策直接消失。
   */
  spawnBuildings(placements, layer, scaleHp, scaleDmg) {
    for (const p of placements) {
      const def = BUILDINGS[p.kind];
      const hp = Math.max(1, Math.round(def.hp * scaleHp));
      const derived = derive({ con: 10, str: 6, agi: 1, int: 1 });
      derived.hp = hp;
      derived.pDmg = Math.round((def.atk ?? 0) * scaleDmg);
      derived.mDmg = 0;
      derived.moveSpeed = 0;
      derived.dodge = 0;
      derived.atkSpeed = 0;
      const u = {
        id: nextBuildingId(),
        side: "enemy",
        name: def.name,
        category: "tank",
        subclass: "physTank",
        damageType: "physical",
        x: clamp2(p.pos.x, 0.8, this.W - 0.8),
        y: clamp2(p.pos.y, 0.8, this.H - 0.8),
        hp,
        maxHp: hp,
        primary: { con: 10, str: 6, agi: 1, int: 1 },
        derived,
        cd: def.atkInterval ?? 2,
        skill: { id: "none", name: "\u65E0", cd: 0, damageType: "physical", desc: "" },
        skillCd: Number.POSITIVE_INFINITY,
        alive: true,
        shield: 0,
        rootUntil: 0,
        stunUntil: 0,
        tauntUntil: 0,
        dmgMult: 1,
        level: layer,
        flash: 0,
        bodyType: def.bodyType,
        gender: "male",
        hitRadius: hitRadiusOf(def.bodyType) * 1.25,
        isBuilding: true,
        buildingKind: p.kind,
        spawnTimer: 0,
        spawnedTotal: 0
      };
      this._push(u);
      this.buildings.push(u);
      this.pushLog(`\u53D1\u73B0${def.name}\uFF1A${def.threat}`);
    }
    for (const b of this.buildings) this.buildingInitialSpawn(b, scaleHp, scaleDmg);
  }
  buildingInitialSpawn(b, scaleHp, scaleDmg) {
    const def = BUILDINGS[b.buildingKind];
    const sp = def.spawn;
    if (!sp) return;
    for (let i = 0; i < sp.initial; i++) {
      const kind = b.buildingKind === "dragon_lair" ? i === 0 ? "adult_dragon" : "whelp" : sp.kind;
      this.spawnFromBuilding(b, kind, scaleHp, scaleDmg, i);
    }
    b.spawnedTotal = sp.initial;
    b.spawnTimer = sp.interval;
  }
  /** 建筑产出一个单位。位置绕建筑均匀散布，避免全部叠在同一个像素上 */
  spawnFromBuilding(b, kind, scaleHp, scaleDmg, idx) {
    const t = SPAWN_TEMPLATES[kind];
    const primary = { ...t.basePrimary };
    const lv = Math.max(1, b.level);
    for (const k of ["con", "str", "agi", "int"]) {
      primary[k] = primary[k] + (lv - 1) * 0.8;
    }
    const derived = derive(primary);
    derived.hp = Math.max(1, Math.round(derived.hp * scaleHp * t.hpMult));
    const hp = derived.hp;
    const ang = idx / 5 * Math.PI * 2 + (b.x + b.y);
    const rr = b.hitRadius + 0.9;
    const u = {
      id: nextBuildingId(),
      side: "enemy",
      name: t.name,
      category: "warrior",
      subclass: t.subclass,
      damageType: SUBCLASS_INFO[t.subclass].damageType,
      x: clamp2(b.x + dcos(ang) * rr, 0.6, this.W - 0.6),
      y: clamp2(b.y + dsin(ang) * rr, 0.6, this.H - 0.6),
      hp,
      maxHp: hp,
      primary,
      derived,
      cd: 0,
      skill: t.skill ?? { id: "none", name: "\u666E\u653B", cd: 0, damageType: "physical", desc: "" },
      skillCd: t.skill ? t.skill.cd * 0.5 : Number.POSITIVE_INFINITY,
      alive: true,
      shield: 0,
      rootUntil: 0,
      stunUntil: 0,
      tauntUntil: 0,
      dmgMult: scaleDmg * t.dmgMult,
      level: lv,
      flash: 0,
      bodyType: t.bodyType,
      gender: "male",
      hitRadius: hitRadiusOf(t.bodyType),
      monsterKind: t.monsterKind
    };
    this._push(u);
    this.emit("ring", b.x, b.y, BUILDINGS[b.buildingKind].accent, 0.32, { r: b.hitRadius + 0.5, alphaFrom: 0.6, alphaTo: 0 });
    this.emit("rift", u.x, u.y, BUILDINGS[b.buildingKind].accent, 0.4, { r: 0.6, alphaFrom: 0.9, alphaTo: 0 });
    if (b.buildingKind === "dragon_nest") {
      this.emit("nova", b.x, b.y, BUILDINGS.dragon_nest.accent, 0.3, { r: b.hitRadius + 0.4, sizeMul: 0.9, alphaFrom: 0.7, alphaTo: 0 });
    } else if (b.buildingKind === "dragon_lair" && idx === 0) {
      this.emit("quake", b.x, b.y, BUILDINGS.dragon_lair.accent, 0.5, { r: b.hitRadius + 0.8, sizeMul: 1.1 });
    }
    this.emitAudio({ id: "summon_spawn", x: u.x, arenaW: this.W });
  }
  /** 建筑每帧行为：塔开火 / 产兵器计时。建筑不索敌移动、不施法。 */
  tickBuilding(b, dt) {
    const def = BUILDINGS[b.buildingKind];
    if (isTower(b.buildingKind) && def.atk && def.range) {
      const foes = this.alive(b.side === "ally" ? "enemy" : "ally").filter((f) => !f.isBuilding && dist(f, b) <= def.range + f.hitRadius);
      if (foes.length) {
        b.cd -= dt;
        if (b.cd <= 0) {
          const t = this.nearest(foes, b);
          this.faceToward(b, t);
          this.attackAnim(b);
          this.basicAttack(b, t);
          b.cd = def.atkInterval ?? 2;
        }
      }
    }
    const sp = def.spawn;
    if (!sp || sp.interval <= 0) return;
    if ((b.spawnedTotal ?? 0) >= sp.cap) return;
    b.spawnTimer = (b.spawnTimer ?? sp.interval) - dt;
    if (b.spawnTimer > 0) return;
    b.spawnTimer = sp.interval;
    b.spawnedTotal = (b.spawnedTotal ?? 0) + 1;
    this.spawnFromBuilding(b, sp.kind, this.buildScaleHp, this.buildScaleDmg, b.spawnedTotal);
    this.pushLog(`${def.name} \u4EA7\u51FA ${SPAWN_TEMPLATES[sp.kind].name}\uFF08${b.spawnedTotal}/${sp.cap}\uFF09`);
  }
  setBuildingScale(hp, dmg) {
    this.buildScaleHp = hp;
    this.buildScaleDmg = dmg;
  }
  // 手动触发（UI 技能按钮）：强制施放某子类已就绪的友方技能
  forceCast(subclass) {
    const u = this.units.find((x) => x.alive && x.side === "ally" && x.subclass === subclass && x.skillCd <= 0);
    if (!u) return false;
    this.castSkill(u);
    return true;
  }
  /**
   * 装配车队关。**必须在 makeSim 里调用**（前后端同一入口）。
   * 漏调的后果不是崩溃，而是远程回放拿到一堆既不撞人也不开门的静止面包车——
   * 胜负甚至可能一样，肉眼查不出来，这正是 1.9.0 事故的那一类。
   */
  setVanEncounter(ve, scaleHp) {
    this.vanCfg = ve;
    this.vanScaleHp = scaleHp;
    for (const u of this.units) {
      if (u.side !== "enemy" || u.monsterKind !== "van") continue;
      u.vanBuffUntil = this.time + ve.openingBuffSec;
      u.vanDropLeft = ve.peoplePerVan;
      u.vanDropTimer = 0;
      u.vanRamDone = false;
    }
    this.pushLog(
      `\u9762\u5305\u8F66\u961F\u51B2\u5165\u573A\u5730\uFF1A${ve.vanCount} \u8F86 \xD7 ${ve.peoplePerVan} \u4EBA\uFF0C\u5F00\u573A ${ve.openingBuffSec} \u79D2\u6CB9\u95E8\u5230\u5E95\uFF08\u649E\u51FB\u6700\u731B\uFF0C\u5378\u4EBA\u540E\u5A01\u80C1\u51CF\u534A\uFF09`
    );
  }
  /**
   * 面包车当前速度乘子：开场窗口内 2，之后 1。
   *
   * 为什么不直接把 derived.moveSpeed ×2：moveSpeed 是被 clamp 到 [0,80] 的**属性**，
   * 真实速度 = 2.0 + damp(moveSpeed) × 0.02。面包车 agi=4，moveSpeed 落在 20 上下，
   * 把这个属性翻倍只能把速度从 ~2.4 推到 ~2.8 —— 屏幕上是 17% 的加速，
   * 没有任何玩家会把它读成"翻倍"。需求要的是"开场撞击速度非常快"，那就得乘在速度上。
   *
   * 撞击伤害共用这同一个乘子：玩家看到的「冲得飞快」和跳出来的伤害数字必须同源，
   * 否则他学不到"车快=撞得疼"这条因果，而这条因果是整个关卡的玩法核心。
   */
  vanSpeedMult(u) {
    if (u.monsterKind !== "van") return 1;
    return (u.vanBuffUntil ?? 0) > this.time ? VAN_OPENING_SPEED_MUL : 1;
  }
  /**
   * 撞击结算。需求原文「撞击伤害 ~ 物理攻击 × 移速」。
   *
   * 字面照抄会出事：moveSpeed 是 0~80 的属性值而不是倍率，pDmg × 20 一撞清场。
   * 这里取它的**设计意图**——伤害与当前速度成正比：
   *   ramDmg = pDmg × VAN_RAM_MUL × vanSpeedMult
   * 开场 2 倍、卸人后 1 倍，比值精确 2:1，正是"开场最猛、后续威胁明显下降"。
   */
  dealRam(v, foes) {
    const mult = this.vanSpeedMult(v);
    const opening = mult > 1;
    for (const t of foes) {
      this.dealSkill(v, t, v.derived.pDmg * VAN_RAM_MUL * mult, "physical");
      this.vanKnockback(t, v, opening ? VAN_RAM_KNOCKBACK : VAN_RAM_KNOCKBACK * 0.5);
    }
    v.vanRamDone = true;
    v.vanDropTimer = 0;
  }
  /**
   * 击退。引擎原本只有同侧「分离推挤」，没有真正的击退，所以这里新写一条，
   * 但**抗性规则与推挤完全一致**，避免同一个身体在两套物理里表现矛盾：
   *   giant / titan 免疫（碾压级质量，一辆面包车推不动巨像）
   *   obese 0.35 / colossal 0.25（有质量但不是免疫）
   *   重击霸体窗口内免疫（heavyArmorUntil 优先于体型，与推挤同一条规则）
   *
   * 距离取 1.6 格 ≈ 一个近战身位：读作"阵型被撕开一个位置"而不是"被推到地图边"。
   * 被推进墙/岩浆是不可接受的（那是把击退变成秒杀），所以落点必须过 isWalkable。
   */
  vanKnockback(t, from, distTiles) {
    if ((t.heavyArmorUntil ?? 0) > this.time) return;
    const resist = t.bodyType === "giant" || t.bodyType === "titan" ? 0 : t.bodyType === "obese" ? 0.35 : t.bodyType === "colossal" ? 0.25 : 1;
    if (resist <= 0) return;
    const dx = t.x - from.x, dy = t.y - from.y;
    const d = len2d(dx, dy) || 1;
    const step = distTiles * resist;
    const nx = clamp2(t.x + dx / d * step, 0.6, this.W - 0.6);
    const ny = clamp2(t.y + dy / d * step, 0.6, this.H - 0.6);
    if (this.isWalkable(nx, ny)) {
      t.x = nx;
      t.y = ny;
    } else if (this.isWalkable(nx, t.y)) t.x = nx;
    else if (this.isWalkable(t.x, ny)) t.y = ny;
  }
  /**
   * 车队每帧：只有「已撞击 + 还有人 + 同屏没到顶」的车才卸人。
   *
   * 同屏上限到顶时**车门不关，只是下人变慢**（计时器照常重置）。
   * 这个取舍是明确的：宁可让卸人节奏被拖慢，也不允许掉帧——
   * 中端机 60fps 是这一版的验收线，掉帧比少几个人可感知得多。
   */
  tickVanConvoy(dt) {
    const ve = this.vanCfg;
    if (!ve) return;
    let alive = 0;
    for (const u of this.units) if (u.alive && u.monsterKind === "van_person") alive++;
    for (const v of this.units) {
      if (!v.alive || v.monsterKind !== "van") continue;
      if (!v.vanRamDone || (v.vanDropLeft ?? 0) <= 0) continue;
      v.vanDropTimer = (v.vanDropTimer ?? 0) - dt;
      if ((v.vanDropTimer ?? 0) > 0) continue;
      v.vanDropTimer = ve.dropInterval;
      if (alive >= ve.concurrentPeopleCap) continue;
      if (v.vanDropLeft === ve.peoplePerVan) {
        this.emit("ring", v.x, v.y, "#ffd23f", 0.35, { r: v.hitRadius + 0.6, alphaFrom: 0.85, alphaTo: 0 });
        this.emit("rift", v.x, v.y, "#ffd23f", 0.3, { r: v.hitRadius * 1.4, alphaFrom: 0.7, alphaTo: 0 });
      }
      v.vanDropLeft = (v.vanDropLeft ?? 0) - 1;
      this.spawnVanPerson(v, ve, ve.peoplePerVan - (v.vanDropLeft ?? 0));
      alive++;
    }
  }
  /**
   * 下一个面包人。属性严格按需求：= 车的 1/2，移速 +30、攻速 +50。
   *
   * 取的是车的**当前 primary**（已含层深等级），不是模板基础值——
   * 否则 30 层的车会掉出 1 级的人，"车 1/2"这条关系在深层直接失效。
   *
   * 特性池与角色一致随机（需求原文）：走 rollTrait(this.rng)，消费 sim 的种子 RNG。
   * 这是本关唯一的战斗内随机源，前后端同 seed 必然同人同特性。
   */
  spawnVanPerson(v, ve, idx) {
    const m = ve.personPrimaryMul;
    const primary = {
      con: v.primary.con * m,
      str: v.primary.str * m,
      agi: v.primary.agi * m,
      int: v.primary.int * m
    };
    const traitId = rollTrait(this.rng);
    const derived = applyTraitStatic(derive(primary), traitId);
    derived.hp = Math.max(1, Math.round(derived.hp * this.vanScaleHp));
    derived.moveSpeed = clamp2(derived.moveSpeed + ve.personMoveSpeedAdd, 0, 80);
    derived.atkSpeed = clamp2(derived.atkSpeed + ve.personAtkSpeedAdd, 0, 250);
    const hp = derived.hp;
    const ang = idx / 5 * 360 + (v.x + v.y);
    const rr = v.hitRadius + 0.8;
    const u = {
      id: nextBuildingId(),
      side: "enemy",
      name: "\u9762\u5305\u4EBA",
      category: "warrior",
      subclass: "charge",
      damageType: "physical",
      x: clamp2(v.x + dcos(ang * DEG) * rr, 0.6, this.W - 0.6),
      y: clamp2(v.y + dsin(ang * DEG) * rr, 0.6, this.H - 0.6),
      hp,
      maxHp: hp,
      primary,
      derived,
      cd: 0,
      skill: { id: "none", name: "\u666E\u653B", cd: 0, damageType: "physical", desc: "" },
      skillCd: Number.POSITIVE_INFINITY,
      alive: true,
      shield: 0,
      rootUntil: 0,
      stunUntil: 0,
      tauntUntil: 0,
      dmgMult: v.dmgMult,
      level: v.level,
      flash: 0,
      bodyType: "medium",
      gender: "male",
      hitRadius: hitRadiusOf("medium"),
      monsterKind: "van_person",
      baseMove: derive(primary).moveSpeed * BODY_INFO.medium.msMult,
      traitId
    };
    this._push(u);
    this.emit("rift", u.x, u.y, "#ffd23f", 0.32, { r: 0.5, alphaFrom: 0.85, alphaTo: 0 });
    this.emit("ring", u.x, u.y, "#e8e8ec", 0.26, { r: 0.55, alphaFrom: 0.6, alphaTo: 0 });
    this.emitAudio({ id: "summon_spawn", x: u.x, arenaW: this.W });
  }
  // 波次增援（BattleScreen 在清场后调用，开发 §7 / 需求 4.4.3）
  addUnits(units) {
    for (const uu of units) this._push(uu);
  }
  tick(dt) {
    if (this.over) return;
    this.time += dt;
    this._updateTileEffects();
    for (const u of this.units) {
      const rp = u.derived.regenPct ?? 0;
      if (!u.alive || rp <= 0) continue;
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * rp * dt);
    }
    for (const u of this.units) {
      if (!u.alive || !u.isBoss) continue;
      if (this.arenaTile(Math.floor(u.y), Math.floor(u.x)) !== "B") continue;
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.015 * dt);
    }
    for (const u of this.units) {
      if (!u.alive || u.isBuilding) continue;
      const ch = this.arenaTile(Math.floor(u.y), Math.floor(u.x));
      if (ch !== "M") continue;
      u.hp -= u.maxHp * 0.03 * dt;
      this.killIfDown(u, void 0);
    }
    for (const u of this.units) {
      if (!u.alive || u.isBuilding) continue;
      let dot = 0;
      if (u.burnUntil && u.burnUntil > this.time) dot += u.maxHp * (u.burnDps ?? 0.05) * dt;
      if (u.poisonUntil && u.poisonUntil > this.time) dot += u.maxHp * 0.05 * dt;
      if (dot > 0) {
        u.hp -= dot;
        this.killIfDown(u, void 0);
      }
    }
    this.runPending();
    if (!this.openingCastDone) {
      this.openingCastDone = true;
      for (const u of this.units) {
        if (!u.alive || u.isSummon || u.isBuilding) continue;
        if (u.side !== "ally" || u.skill.id !== NUWA_SKILL_ID) continue;
        u.skillCd = 0;
        if (this.shouldCast(u)) {
          this.pushLog(`${u.name} \u5F00\u5C40\u9020\u5316 \u2192 \u7ACB\u5373\u53EC\u5524`);
          this.castSkill(u);
        }
      }
    }
    for (const f of this.floaters) {
      f.ttl -= dt;
      f.y -= dt * 0.6;
    }
    for (const p of this.projectiles) {
      p.prevX = p.x;
      p.prevY = p.y;
      p.ttl -= dt;
      const dx = p.tx - p.x, dy = p.ty - p.y, d = len2d(dx, dy) || 1;
      p.x += dx / d * 12 * dt;
      p.y += dy / d * 12 * dt;
    }
    for (const e of this.effects) {
      if (e.delay && e.delay > 0) {
        e.delay -= dt;
        continue;
      }
      e.ttl -= dt;
    }
    this.floaters = this.floaters.filter((f) => f.ttl > 0);
    if (this.floaters.length > MAX_FLOATERS) this.floaters.splice(0, this.floaters.length - MAX_FLOATERS);
    this.projectiles = this.projectiles.filter((p) => p.ttl > 0);
    this.effects = this.effects.filter((e) => e.ttl > 0);
    this.tickVanConvoy(dt);
    for (const u of this.units) {
      u.prevX = u.x;
      u.prevY = u.y;
      if (!u.alive) continue;
      u.flash = Math.max(0, u.flash - dt);
      if (u.traitId === "momentum" && (u.lifestealStacks ?? 0) > 0) {
        const idle = this.time - (u.lastBasicAt ?? this.time);
        if (idle >= 1) {
          let acc = (u.traitTimer ?? 0) + dt;
          while (acc >= 1 && (u.lifestealStacks ?? 0) > 0) {
            u.lifestealStacks = (u.lifestealStacks ?? 0) - 1;
            acc -= 1;
          }
          u.traitTimer = acc;
        } else {
          u.traitTimer = 0;
        }
      }
      if (u.traitId === "heart") {
        u.heartTim = (u.heartTim ?? 0) + dt;
        if (u.heartTim >= TRAIT_CFG.heartWindow) {
          u.heartTim = 0;
          if ((u.heartLoss ?? 0) < TRAIT_CFG.heartHealPct * u.maxHp) {
            u.hp = Math.min(u.maxHp, u.hp + TRAIT_CFG.heartHealPct * u.maxHp);
            u.derived.atkSpeed *= 1 + TRAIT_CFG.heartAsPct;
            u.derived.pDmg *= 1 + TRAIT_CFG.heartDmgPct;
            u.derived.mDmg *= 1 + TRAIT_CFG.heartDmgPct;
            this.floaters.push({ x: u.x, y: u.y - 0.9, text: `\u5927\u5FC3\u810F +${Math.round(TRAIT_CFG.heartHealPct * 100)}%`, color: "#ff8fb0", ttl: 1 });
            this.pushLog(`${u.name} \u5927\u5FC3\u810F\u89E6\u53D1 \u2192 \u56DE\u8840 +${Math.round(TRAIT_CFG.heartHealPct * 100)}% \u653B\u901F/\u53CC\u653B +${Math.round(TRAIT_CFG.heartAsPct * 100)}%`);
          }
          u.heartLoss = 0;
        }
      }
      if (u.traitId === "slowburn") {
        u.slowTim = (u.slowTim ?? 0) + dt;
        if (u.slowTim >= 1) {
          u.slowTim -= 1;
          u.derived.pDmg *= 1 + TRAIT_CFG.slowRampPct;
          u.derived.mDmg *= 1 + TRAIT_CFG.slowRampPct;
          u.derived.atkSpeed *= 1 + TRAIT_CFG.slowRampPct;
          u.derived.moveSpeed *= 1 + TRAIT_CFG.slowRampPct;
        }
      }
      if (u.traitId === "spacetime") {
        u.stTim = (u.stTim ?? 0) + dt;
        if (u.stTim >= TRAIT_CFG.stWindow) {
          u.stTim = 0;
          if ((u.stLoss ?? 0) > TRAIT_CFG.stLossPct * u.maxHp && (u.stCdUntil ?? 0) <= this.time) {
            this.teleportAway(u, TRAIT_CFG.stMinDist);
            u.stCdUntil = this.time + TRAIT_CFG.stCd;
            this.pushLog(`${u.name} \u65F6\u7A7A\u62D3\u5370 \u2192 \u77AC\u79FB\u8131\u9669`);
          }
          u.stLoss = 0;
        }
      }
      if (u.returnerDrain) {
        u.hp -= u.maxHp * TRAIT_CFG.returnerDrainPct * dt;
        if (u.hp <= 0) {
          u.hp = 0;
          this.killIfDown(u, void 0);
        }
      }
      u.skillCd = Math.max(0, u.skillCd - dt);
      if (u.mountCd !== void 0) u.mountCd = Math.max(0, u.mountCd - dt);
      if (u.isBuilding) {
        this.tickBuilding(u, dt);
        continue;
      }
      if (u.side === "enemy" && u.beastTrait === "nest" && !u.nestDone && this.time >= 2) {
        this.spawnBeastlings(u);
        u.nestDone = true;
      }
      if (u.side === "enemy" && u.beastTrait === "immunity") {
        u.immunityPhase = 1 + Math.floor(this.time / 3) % 2;
      }
      if (u.summonUntil && this.time > u.summonUntil) {
        u.alive = false;
        this.emit("rift", u.x, u.y, "#9b7bff", 0.3, { r: 0.5, alphaFrom: 0.8, alphaTo: 0 });
        this.emitAudio({ id: "summon_expire", x: u.x, arenaW: this.W });
        continue;
      }
      if (u.stunUntil > this.time || (u.kdUntil ?? 0) > this.time || (u.freezeUntil ?? 0) > this.time) continue;
      let target = null;
      const held = u.targetId ? this.units.find((x) => x.id === u.targetId) : void 0;
      if (held && held.alive && (u.retargetAt ?? 0) > this.time) {
        if (len2d(held.x - u.x, held.y - u.y) > 1 && this.pathTo(u, held.x, held.y).length === 0) {
          const alt = this.acquireReachable(u);
          if (alt) {
            target = alt;
            u.targetId = alt.id;
            u.retargetAt = this.time + 0.5;
          } else {
            target = held;
          }
        } else {
          target = held;
        }
      } else {
        target = this.acquireTarget(u);
        if (target && len2d(target.x - u.x, target.y - u.y) > 1) {
          const unreach = this.pathTo(u, target.x, target.y).length === 0;
          if (unreach) {
            const alt = this.acquireReachable(u);
            if (alt) target = alt;
          }
        }
        u.targetId = target?.id;
        u.retargetAt = this.time + 0.5;
      }
      if (!target) continue;
      this.faceToward(u, target);
      const d = dist(u, target);
      const range = this.attackRangeOf(u);
      const needReposition = u.summonKind === "arcanist" && d < 4;
      if (d > range || needReposition) {
        if (u.rootUntil <= this.time) {
          this.moveToward(u, target, dt);
          this.moveAnim(u);
        }
        if (needReposition && d <= range) {
          u.cd -= dt;
          if (u.cd <= 0) this.performAttack(u, target);
        }
      } else {
        u.cd -= dt;
        if (u.cd <= 0) this.performAttack(u, target);
        if (this.shouldCast(u)) this.castSkill(u);
      }
      if (this.shouldCastMount(u)) this.castMountSkill(u);
    }
    this.units = this.units.filter((u) => u.alive || u.deadAt !== void 0 && this.time - u.deadAt < CORPSE_TTL);
    this.checkOver();
  }
  checkOver() {
    const allies = this.alive("ally").filter((u) => !u.isSummon).length;
    const enemies = this.alive("enemy").filter((u) => !u.isSummon).length;
    if (allies === 0) {
      this.over = true;
      this.result = "lose";
      this.emitAudio({ id: "defeat" });
    } else if (enemies === 0) {
      this.over = true;
      this.result = "win";
      this.emitAudio({ id: "victory" });
    }
  }
  /** v2.9.6 战后评价：返回所有非建筑单位的本场统计（确定性累计，仅作展示 / MVP 奖励记账）。 */
  getBattleStats() {
    return this.units.filter((u) => !u.isBuilding).map((u) => ({
      id: u.id,
      side: u.side,
      name: u.name,
      dmgDealt: Math.round(u.dmgDealt ?? 0),
      dmgTaken: Math.round(u.dmgTaken ?? 0),
      healDone: Math.round(u.healDone ?? 0),
      moveDist: Math.round(u.moveDist ?? 0),
      heroUid: u.heroUid
    }));
  }
};

// packages/core/src/gen/formation.ts
var DEPLOY_COL_MIN = 1;
var DEPLOY_COL_MAX = 6;
var BLOCKED = /* @__PURE__ */ new Set(["#", "P", "~", "B", "E", "M"]);
function tileAt(arena, c, r) {
  if (r < 0 || r >= arena.tiles.length) return "#";
  const row = arena.tiles[r];
  if (c < 0 || c >= row.length) return "#";
  return row[c];
}
function isWalkable(arena, c, r) {
  return !BLOCKED.has(tileAt(arena, c, r));
}
function isDeployable(arena, c, r) {
  if (c < DEPLOY_COL_MIN || c > DEPLOY_COL_MAX) return false;
  return isWalkable(arena, c, r);
}
var toPos = (c, r) => ({ x: c + 0.5, y: r + 0.5 });
var cellKey = (c, r) => `${c},${r}`;
var FORMATION_PRESETS = {
  line: {
    cn: "\u7EB5\u5217",
    desc: "\u4E00\u5B57\u6392\u5F00\uFF0C\u7AD9\u4F4D\u5747\u8861\uFF0C\u65E0\u660E\u663E\u8F6F\u808B",
    offsets: [[0, 0], [0, -2], [0, 2], [0, -4], [0, 4], [1, -1], [1, 1]]
  },
  wedge: {
    cn: "\u6954\u5F62",
    desc: "\u524D\u950B\u7A81\u51FA\u627F\u4F24\uFF0C\u540E\u6392\u659C\u63A0\u8F93\u51FA",
    offsets: [[2, 0], [0, -2], [0, 2], [-2, -3], [-2, 3], [-1, -1], [-1, 1]]
  },
  spread: {
    cn: "\u6563\u9635",
    desc: "\u5927\u95F4\u8DDD\u62C9\u5F00\uFF0C\u89C4\u907F\u8303\u56F4\u6280\u80FD\u8FDE\u9501",
    offsets: [[1, -4], [0, 0], [1, 4], [-2, -2], [-2, 2], [2, -1], [2, 1]]
  },
  turtle: {
    cn: "\u9F9F\u7F29",
    desc: "\u5168\u5458\u9760\u540E\u6536\u7F29\uFF0C\u903C\u654C\u65B9\u957F\u9A71\u76F4\u5165",
    offsets: [[-1, 0], [-2, -2], [-2, 2], [-3, -1], [-3, 1], [-3, -3], [-3, 3]]
  }
};
function resolveOffsets(arena, anchor, offsets, count) {
  const ac = Math.floor(anchor.x);
  const ar = Math.floor(anchor.y);
  const used = /* @__PURE__ */ new Set();
  const out = [];
  for (let i = 0; i < count; i++) {
    const [dx, dy] = offsets[i % offsets.length];
    const extra = Math.floor(i / offsets.length);
    const tc = ac + dx;
    const tr = ar + dy + extra;
    const found = nearestFree(arena, tc, tr, used);
    if (found) {
      used.add(cellKey(found.c, found.r));
      out.push(toPos(found.c, found.r));
    } else {
      out.push(toPos(ac, ar));
    }
  }
  return out;
}
function nearestFree(arena, c, r, used) {
  const maxR = Math.max(arena.width, arena.height);
  for (let rad = 0; rad <= maxR; rad++) {
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (!isDeployable(arena, nc, nr)) continue;
        if (used.has(cellKey(nc, nr))) continue;
        return { c: nc, r: nr };
      }
    }
  }
  return null;
}
function presetFormation(arena, anchor, count, preset = "line") {
  const a = anchor ?? toPos(3, Math.floor(arena.height / 2));
  return resolveOffsets(arena, a, FORMATION_PRESETS[preset].offsets, count);
}
function sanitizeFormation(arena, saved, anchor, count) {
  const fallback = presetFormation(arena, anchor, count, "line");
  if (!saved || saved.length === 0) return fallback;
  const used = /* @__PURE__ */ new Set();
  const out = [];
  for (let i = 0; i < count; i++) {
    const s = saved[i];
    const base2 = s ?? fallback[i];
    const found = nearestFree(arena, Math.floor(base2.x), Math.floor(base2.y), used);
    const cell = found ?? { c: Math.floor(fallback[i].x), r: Math.floor(fallback[i].y) };
    used.add(cellKey(cell.c, cell.r));
    out.push(toPos(cell.c, cell.r));
  }
  return out;
}
function spreadPositions(arena, anchors, count, opts = {}) {
  if (count <= 0) return [];
  const minCol = opts.minCol ?? Math.floor(arena.width / 2) - 1;
  const passable = (c, r) => {
    if (c < minCol) return false;
    const ch = tileAt(arena, c, r);
    if (ch === "B") return !!opts.allowBossTile;
    return !BLOCKED.has(ch);
  };
  const out = [];
  const used = /* @__PURE__ */ new Set();
  const seen = /* @__PURE__ */ new Set();
  const queue = [];
  for (const a of anchors) {
    const c = Math.floor(a.x);
    const r = Math.floor(a.y);
    if (seen.has(cellKey(c, r))) continue;
    seen.add(cellKey(c, r));
    queue.push({ c, r });
  }
  if (queue.length === 0) queue.push({ c: arena.width - 4, r: Math.floor(arena.height / 2) });
  const DIRS = [[0, -1], [0, 1], [1, 0], [-1, 0]];
  let head = 0;
  while (head < queue.length && out.length < count) {
    const cur = queue[head++];
    if (passable(cur.c, cur.r) && !used.has(cellKey(cur.c, cur.r))) {
      used.add(cellKey(cur.c, cur.r));
      out.push(toPos(cur.c, cur.r));
    }
    for (const [dc, dr] of DIRS) {
      const nc = cur.c + dc;
      const nr = cur.r + dr;
      if (nc < 0 || nr < 0 || nc >= arena.width || nr >= arena.tiles.length) continue;
      const k = cellKey(nc, nr);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ c: nc, r: nr });
    }
  }
  while (out.length < count) out.push(anchors[0] ?? toPos(arena.width - 4, Math.floor(arena.height / 2)));
  return out;
}
function enemyPlacements(arena, spawnEnemy, bossPos, defs) {
  const spots = spreadPositions(arena, spawnEnemy, defs.length);
  return defs.map((d, i) => d.isBoss && bossPos ? bossPos : spots[i]);
}

// packages/core/src/content/heroes.ts
var raw = [
  ["h_physTank", "\u94C1\u58C1\u9547\u5B88", "physTank", { con: 14, str: 8, agi: 3, int: 2 }],
  ["h_magicTank", "\u7384\u7B26\u5B88\u5FA1", "magicTank", { con: 14, str: 3, agi: 3, int: 10 }],
  ["h_charge", "\u7834\u9635\u731B\u5C06", "charge", { con: 8, str: 14, agi: 10, int: 2 }],
  [
    "h_hexblade",
    "\u65E0\u5F62\u5251\u5BA2",
    "hexblade",
    { con: 8, str: 11, agi: 8, int: 9 },
    // vX 数值重做：基础生命-10% / 物攻-30% / 攻速+10% / 移速+5%；普攻 40%物+75%魔
    { hpMul: 0.9, pDmgMul: 0.7, atkSpeedMul: 1.1, moveSpeedMul: 1.05 },
    { p: 0.4, m: 0.75 }
  ],
  ["h_gunner", "\u795E\u673A\u70AE\u624B", "gunner", { con: 6, str: 10, agi: 14, int: 3 }],
  ["h_sniper", "\u8D2F\u65E5\u795E\u5C04", "sniper", { con: 5, str: 12, agi: 14, int: 3 }],
  ["h_controller", "\u592A\u6781\u5B97\u5E08", "controller", { con: 5, str: 3, agi: 8, int: 14 }],
  ["h_summoner", "\u9020\u7269\u672F\u5E08", "summoner", { con: 7, str: 4, agi: 6, int: 14 }],
  ["h_healer", "\u56DE\u6625\u533B\u8005", "healer", { con: 9, str: 3, agi: 5, int: 14 }]
];
var HEROES = raw.map(([id, name, subclass, base2, mods, atkRatio]) => ({
  id,
  uid: id,
  name,
  category: SUBCLASS_INFO[subclass].category,
  subclass,
  basePrimary: base2,
  growth: { con: 2, str: 2, agi: 2, int: 2 },
  skill: { ...SKILLS[SUBCLASS_SKILL[subclass]] },
  // 模板不绑特性；特性由 variateHero 从全池随机分配（见 variant.ts rollTrait）。
  traitId: void 0,
  mods,
  atkRatio,
  trait: void 0
}));
var HERO_BY_ID = Object.fromEntries(HEROES.map((h) => [h.id, h]));
function rollRecruitPool(rng, team, count = 3) {
  const owned = new Set(team.map((h) => h.id));
  const fresh = shuffle(rng, HEROES.filter((h) => !owned.has(h.id)));
  const dup = shuffle(rng, HEROES.filter((h) => owned.has(h.id)));
  const dupSlots = dup.length > 0 ? Math.min(dup.length, Math.max(1, Math.round(count / 3))) : 0;
  const freshSlots = count - dupSlots;
  let picks = [...fresh.slice(0, freshSlots), ...dup.slice(0, dupSlots)];
  if (picks.length < count) {
    const rest = shuffle(rng, HEROES.filter((h) => !picks.includes(h)));
    picks = [...picks, ...rest].slice(0, count);
  }
  return shuffle(rng, picks).slice(0, count);
}

// packages/core/src/content/relics.ts
var RELICS = [
  { id: "r_rage", name: "\u72C2\u6012", desc: "\u7269\u7406\u4F24\u5BB3+15%", mod: { pDmg: 6 } },
  { id: "r_arcane", name: "\u5965\u80FD", desc: "\u9B54\u6CD5\u4F24\u5BB3+15%", mod: { mDmg: 6 } },
  { id: "r_wall", name: "\u575A\u58C1", desc: "\u7269\u7406\u51CF\u4F24+10%", mod: { pResist: 10 } },
  { id: "r_ward2", name: "\u6CD5\u969C", desc: "\u9B54\u6CD5\u51CF\u4F24+10%", mod: { mResist: 10 } },
  { id: "r_wind", name: "\u75BE\u98CE", desc: "\u653B\u901F+15%", mod: { atkSpeed: 15 } },
  { id: "r_swift", name: "\u8FC5\u6377", desc: "\u95EA\u907F+10%", mod: { dodge: 10 } },
  { id: "r_fleet", name: "\u75BE\u884C", desc: "\u79FB\u901F+15%", mod: { moveSpeed: 15 } },
  { id: "r_crit", name: "\u9510\u773C", desc: "\u66B4\u51FB+10%", mod: { crit: 10 } },
  { id: "r_brutal", name: "\u6B8B\u66B4", desc: "\u66B4\u4F24+30%", mod: { critDmg: 30 } },
  { id: "r_vigor", name: "\u6D3B\u529B", desc: "\u751F\u547D+20%", mod: { hpMult: 1.2 } },
  { id: "r_blood", name: "\u55DC\u8840", desc: "\u4F24\u5BB3+10%", mod: { dmgMult: 1.1 } },
  { id: "r_tough", name: "\u575A\u97E7", desc: "\u7269\u7406/\u9B54\u6CD5\u51CF\u4F24+5%", mod: { pResist: 5, mResist: 5 } },
  { id: "r_sage", name: "\u8D24\u8005", desc: "\u667A\u529B+6(\u6CBB\u7597+)", mod: { heal: 20 } },
  { id: "r_bulwark", name: "\u58C1\u5792", desc: "\u751F\u547D+15%\u4E14\u51CF\u4F24+5%", mod: { hpMult: 1.15, pResist: 5, mResist: 5 } },
  { id: "r_tempest", name: "\u98CE\u66B4", desc: "\u653B\u901F+10%\u4E14\u66B4\u51FB+8%", mod: { atkSpeed: 10, crit: 8 } }
];
var RELIC_BY_ID = Object.fromEntries(RELICS.map((r) => [r.id, r]));

// packages/core/src/content/climb.ts
var CLIMB_STRATEGIES = {
  raidRear: {
    id: "raidRear",
    name: "\u7A81\u88AD\u540E\u6392",
    desc: "\u524D\u6392\u79FB\u901F +10%\uFF0C\u5168\u961F\u751F\u547D \u22128%",
    frontRow: { moveSpeed: 10 },
    all: { hpMult: 0.92 }
  },
  steadyPush: {
    id: "steadyPush",
    name: "\u5E73\u7A33\u63A8\u8FDB",
    desc: "\u524D\u6392\u751F\u547D +15%\uFF0C\u5168\u961F\u79FB\u901F \u221210%",
    frontRow: { hpMult: 1.15 },
    all: { moveSpeed: -10 }
  },
  breakThrough: {
    id: "breakThrough",
    name: "\u96C6\u4E2D\u7A81\u7834",
    desc: "\u5168\u961F\u4F24\u5BB3 +15%\uFF0C\u653B\u901F \u22128%",
    all: { dmgMult: 1.15, atkSpeed: -8 }
  }
};
function isFrontRowUnit(u) {
  const r = u.skill?.castRange ?? SUBCLASS_INFO[u.subclass]?.attackRange ?? 5;
  return r < 4;
}
function applyClimbStrategy(units, strategy) {
  const def = CLIMB_STRATEGIES[strategy];
  if (!def) return;
  for (const u of units) {
    if (u.side !== "ally" || u.isSummon) continue;
    const front = isFrontRowUnit(u);
    const apply = (mod) => {
      if (!mod) return;
      if (mod.hpMult) {
        u.derived.hp = Math.round(u.derived.hp * mod.hpMult);
        u.maxHp = u.derived.hp;
        u.hp = u.derived.hp;
      }
      if (mod.dmgMult) u.dmgMult *= mod.dmgMult;
      if (mod.moveSpeed !== void 0) u.derived.moveSpeed += mod.moveSpeed;
      if (mod.atkSpeed !== void 0) u.derived.atkSpeed += mod.atkSpeed;
    };
    if (front) apply(def.frontRow);
    apply(def.all);
  }
}

// packages/core/src/content/registry.ts
function matchRow(row, where) {
  if (!where) return true;
  for (const k of Object.keys(where)) {
    if (k.startsWith("$")) continue;
    const want = where[k];
    if (want && typeof want === "object" && !(want instanceof Date) && !Array.isArray(want)) {
      const ops = want;
      for (const op of Object.keys(ops)) {
        const ov = ops[op];
        const rv = row[k];
        let ok2 = true;
        switch (op) {
          case "$in":
            ok2 = Array.isArray(ov) && ov.includes(rv);
            break;
          case "$nin":
            ok2 = !(Array.isArray(ov) && ov.includes(rv));
            break;
          case "$ne":
            ok2 = rv !== ov;
            break;
          case "$gt":
            ok2 = rv > ov;
            break;
          case "$gte":
            ok2 = rv >= ov;
            break;
          case "$lt":
            ok2 = rv < ov;
            break;
          case "$lte":
            ok2 = rv <= ov;
            break;
          default:
            ok2 = rv === ov;
        }
        if (!ok2) return false;
      }
    } else if (row[k] !== want) {
      return false;
    }
  }
  return true;
}
function fromRecord(rec, pk) {
  return Object.keys(rec).map((k) => ({ [pk]: k, ...rec[k] }));
}
var Table = class {
  constructor(name, pk, rows) {
    __publicField(this, "name");
    __publicField(this, "pk");
    __publicField(this, "rows");
    __publicField(this, "byPk", /* @__PURE__ */ new Map());
    this.name = name;
    this.pk = pk;
    this.rows = rows;
    for (const r of rows) this.byPk.set(r[pk], r);
  }
  get(id) {
    return this.byPk.get(id);
  }
  list() {
    return this.rows;
  }
  query(where, opts) {
    const res = this.rows.filter((r) => matchRow(r, where));
    if (opts?.sort) {
      const key = opts.sort;
      const dir = opts.dir ?? 1;
      res.sort((a, b) => {
        const av = a[key];
        const bv = b[key];
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
    }
    if (opts?.limit !== void 0) return res.slice(0, opts.limit);
    return res;
  }
};
var DBCore = class {
  constructor() {
    __publicField(this, "tables", /* @__PURE__ */ new Map());
    __publicField(this, "cache", /* @__PURE__ */ new Map());
    __publicField(this, "cacheMax", 512);
  }
  register(name, pk, rows) {
    this.tables.set(name, new Table(name, pk, rows));
    return this;
  }
  get(name, id) {
    return this.tables.get(name)?.get(id);
  }
  list(name) {
    return this.tables.get(name)?.list() ?? [];
  }
  query(name, where, opts) {
    const t = this.tables.get(name);
    if (!t) return [];
    const key = name + "|" + JSON.stringify(where ?? null) + "|" + JSON.stringify(opts ?? null);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const res = t.query(where, opts);
    if (this.cache.size >= this.cacheMax) this.cache.clear();
    this.cache.set(key, res);
    return res;
  }
  clearCache() {
    this.cache.clear();
  }
};
var DB = new DBCore();
DB.register("heroes", "id", HEROES).register("enemies", "id", ENEMIES).register("bosses", "id", BOSSES).register("relics", "id", RELICS).register("traits", "key", fromRecord(TRAITS, "key")).register("subclasses", "key", fromRecord(SUBCLASS_INFO, "key")).register("bodies", "key", fromRecord(BODY_INFO, "key")).register("buildings", "key", fromRecord(BUILDINGS, "key")).register("climb", "key", fromRecord(CLIMB_STRATEGIES, "key")).register("consumables", "key", fromRecord(CONSUMABLE_CFG, "key")).register("affixes", "key", fromRecord(AFFIX_POOL, "key")).register("rarities", "key", fromRecord(RARITY_CFG, "key"));

// packages/core/src/content/names.ts
var SURNAMES = [
  "\u8D75",
  "\u94B1",
  "\u5B59",
  "\u674E",
  "\u5468",
  "\u5434",
  "\u90D1",
  "\u738B",
  "\u51AF",
  "\u9648",
  "\u891A",
  "\u536B",
  "\u848B",
  "\u6C88",
  "\u97E9",
  "\u6768",
  "\u6731",
  "\u79E6",
  "\u8BB8",
  "\u4F55",
  "\u5415",
  "\u65BD",
  "\u5F20",
  "\u5B54",
  "\u66F9",
  "\u4E25",
  "\u534E",
  "\u91D1",
  "\u9B4F",
  "\u9676",
  "\u59DC",
  "\u8C22",
  "\u90B9",
  "\u67CF",
  "\u7AA6",
  "\u7AE0",
  "\u82CF",
  "\u6F58",
  "\u845B",
  "\u8303",
  "\u5F6D",
  "\u9C81",
  "\u97E6",
  "\u9A6C",
  "\u82D7",
  "\u51E4",
  "\u82B1",
  "\u65B9",
  "\u4FDE",
  "\u4EFB",
  "\u8881",
  "\u67F3",
  "\u9C8D",
  "\u53F2",
  "\u5510",
  "\u8D39",
  "\u5EC9",
  "\u5C91",
  "\u859B",
  "\u96F7",
  "\u8D3A",
  "\u502A",
  "\u6C64",
  "\u6ED5",
  "\u6BB7",
  "\u7F57",
  "\u6BD5",
  "\u90DD",
  "\u5B89",
  "\u5E38",
  "\u4E50",
  "\u4E8E",
  "\u5085",
  "\u76AE",
  "\u535E",
  "\u9F50",
  "\u4F0D",
  "\u4F59",
  "\u5143",
  "\u987E",
  "\u5B5F",
  "\u5E73",
  "\u9EC4",
  "\u7A46",
  "\u8427",
  "\u5C39",
  "\u59DA",
  "\u90B5",
  "\u6E5B",
  "\u6C6A",
  "\u7941",
  "\u6BDB",
  "\u72C4",
  "\u7C73",
  "\u8D1D",
  "\u660E",
  "\u81E7",
  "\u6210",
  "\u6234",
  "\u5B8B"
];
var MALE_CHARS = [
  "\u5CB3",
  "\u9706",
  "\u5C71",
  "\u5DDD",
  "\u6208",
  "\u950B",
  "\u70C8",
  "\u7F61",
  "\u7384",
  "\u82CD",
  "\u660A",
  "\u78CA",
  "\u94A7",
  "\u5F18",
  "\u6BC5",
  "\u52C7",
  "\u731B",
  "\u864E",
  "\u9F99",
  "\u9A81",
  "\u9A8F",
  "\u9633",
  "\u5929",
  "\u4E91",
  "\u6D77",
  "\u5CF0",
  "\u94EE",
  "\u94E0",
  "\u6977",
  "\u6F9C",
  "\u9756",
  "\u6853",
  "\u97EC",
  "\u7565",
  "\u8C26",
  "\u6714",
  "\u5D16",
  "\u621F",
  "\u52B2",
  "\u62D3"
];
var FEMALE_CHARS = [
  "\u7476",
  "\u73A5",
  "\u5A49",
  "\u5C9A",
  "\u971C",
  "\u5F71",
  "\u97F3",
  "\u7075",
  "\u6C50",
  "\u82B7",
  "\u5170",
  "\u82E5",
  "\u598D",
  "\u67D4",
  "\u6F88",
  "\u7433",
  "\u66E6",
  "\u59DD",
  "\u5B81",
  "\u7EEB",
  "\u7B60",
  "\u68E0",
  "\u83F1",
  "\u747E",
  "\u73D1",
  "\u5AE3",
  "\u70DF",
  "\u83B9",
  "\u831C",
  "\u6F2A"
];
var NEUTRAL_CHARS = [
  "\u9752",
  "\u767D",
  "\u5C18",
  "\u821F",
  "\u6B4C",
  "\u7AF9",
  "\u79CB",
  "\u4E66",
  "\u98CE",
  "\u5BD2",
  "\u781A",
  "\u4E34",
  "\u77E5",
  "\u884C",
  "\u672A",
  "\u6613",
  "\u8861",
  "\u548C",
  "\u5B89",
  "\u5E38"
];
function rollName(rng, gender) {
  const surname = pick(rng, SURNAMES) ?? "\u674E";
  const pool = gender === "female" ? FEMALE_CHARS : MALE_CHARS;
  const first = pick(rng, pool) ?? "\u4E91";
  if (rng() < 0.45) return surname + first;
  const second = pick(rng, NEUTRAL_CHARS) ?? "\u98CE";
  return surname + first + second;
}
function randomHeroName(seed, gender, taken = []) {
  const used = new Set(taken);
  let name = "";
  for (let i = 0; i < 64; i++) {
    name = rollName(mulberry32(seed + i * 7919 >>> 0), gender);
    if (!used.has(name)) return name;
  }
  return name;
}

// packages/core/src/content/personalities.ts
var PERSONALITIES = {
  valiant: {
    id: "valiant",
    cn: "\u4E0D\u754F\u5F3A\u66B4",
    weight: 1,
    color: "#ff8a5c",
    hint: "\u4F18\u5148\u6253\u6EE1\u8840\u654C\u4EBA",
    desc: "\u4E13\u6311\u8FD8\u7AD9\u5F97\u7B14\u76F4\u7684\u6253\u2014\u2014\u4F18\u5148\u653B\u51FB\u751F\u547D\u503C\u9AD8\u4E8E 80% \u7684\u654C\u4EBA\u3002\u538B\u5236\u529B\u5F3A\uFF0C\u4F46\u4E0D\u64C5\u957F\u6536\u5C3E\u3002"
  },
  hunter: {
    id: "hunter",
    cn: "\u730E\u624B",
    weight: 1,
    color: "#6fd36f",
    hint: "\u4F18\u5148\u6253\u6B8B\u8840\u654C\u4EBA",
    desc: "\u8FFD\u7740\u6B8B\u8840\u8D70\u2014\u2014\u4F18\u5148\u653B\u51FB\u5F53\u524D\u751F\u547D\u767E\u5206\u6BD4\u6700\u4F4E\u7684\u654C\u4EBA\u3002\u6536\u5272\u6548\u7387\u9AD8\uFF0C\u5BB9\u6613\u88AB\u8BF1\u9975\u7275\u8D70\u3002"
  },
  breaker: {
    id: "breaker",
    cn: "\u653B\u575A\u8005",
    weight: 1,
    color: "#5a9bd6",
    hint: "\u4F18\u5148\u6253\u654C\u65B9\u524D\u6392",
    desc: "\u786C\u78B0\u786C\u51FF\u5F00\u9635\u7EBF\u2014\u2014\u4F18\u5148\u653B\u51FB\u654C\u65B9\u524D\u6392\u3002\u7A33\uFF0C\u4F46\u5F88\u96BE\u6478\u5230\u5BF9\u9762\u7684\u8F93\u51FA\u6838\u5FC3\u3002"
  },
  assassin: {
    id: "assassin",
    cn: "\u4E13\u4E1A\u523A\u5BA2",
    weight: 1,
    color: "#c07bff",
    hint: "\u4F18\u5148\u6253\u654C\u65B9\u540E\u6392",
    desc: "\u7ED5\u5F00\u8089\u76FE\u76F4\u53D6\u8981\u5BB3\u2014\u2014\u4F18\u5148\u653B\u51FB\u654C\u65B9\u540E\u6392\u3002\u5A01\u80C1\u6700\u5927\uFF0C\u4E5F\u6700\u5BB9\u6613\u88AB\u524D\u6392\u534A\u8DEF\u622A\u4F4F\u3002"
  },
  savior: {
    id: "savior",
    cn: "\u6551\u56F0\u6276\u5371",
    weight: 1,
    color: "#ffd23f",
    hint: "\u4F18\u5148\u6253\u654C\u65B9\u6700\u5F3A\u8005",
    desc: "\u8C01\u6700\u51F6\u5C31\u51B2\u8C01\u2014\u2014\u4F18\u5148\u653B\u51FB\u6218\u529B\u8BC4\u5206\u6700\u9AD8\u7684\u654C\u4EBA\u3002\u4E13\u6CBB\u6838\u5FC3\uFF0C\u4EE3\u4EF7\u662F\u5E38\u5E74\u5728\u5543\u786C\u9AA8\u5934\u3002"
  },
  steady: {
    id: "steady",
    cn: "\u968F\u9047\u800C\u5B89",
    weight: 1.6,
    color: "#9aa4b8",
    hint: "\u5C31\u8FD1\u9009\u62E9\u76EE\u6807",
    desc: "\u4E0D\u6311\u98DF\uFF0C\u8C01\u8FD1\u6253\u8C01\uFF08\u8FDC\u7A0B\u4ECD\u504F\u597D\u6B8B\u8840\uFF09\u3002\u6CA1\u6709\u504F\u79D1\uFF0C\u4E5F\u5C31\u6CA1\u6709\u77ED\u677F\u3002"
  }
};
var PERSONALITY_IDS = Object.keys(PERSONALITIES);
function rollPersonality(r) {
  const total = PERSONALITY_IDS.reduce((s, id) => s + PERSONALITIES[id].weight, 0);
  let x = r * total;
  for (const id of PERSONALITY_IDS) {
    x -= PERSONALITIES[id].weight;
    if (x <= 0) return id;
  }
  return "steady";
}

// packages/core/src/content/variant.ts
var round1 = (v) => Math.round(v * 10) / 10;
var VAR_LO = 0.25;
var VAR_HI = 1.75;
function variateHero(base2, seed, takenNames = []) {
  const rng = mulberry32(seed >>> 0);
  const def = SUBCLASS_INFO[base2.subclass].defaultBody;
  const idx = ALL_BODY_TYPES.indexOf(def);
  const offset = pick(rng, [-2, -1, 0, 1, 2]);
  const bodyType = ALL_BODY_TYPES[Math.max(0, Math.min(ALL_BODY_TYPES.length - 1, idx + offset))];
  const gender = rng() < 0.5 ? "female" : "male";
  const f = () => VAR_LO + rng() * (VAR_HI - VAR_LO);
  const bp = base2.basePrimary;
  const basePrimary = {
    con: round1(bp.con * f()),
    str: round1(bp.str * f()),
    agi: round1(bp.agi * f()),
    int: round1(bp.int * f())
  };
  const personalName = base2.personalName ?? randomHeroName((seed ^ 2654435769) >>> 0, gender, takenNames);
  const personality = base2.personality ?? rollPersonality(rng());
  const traitId = base2.traitId ?? rollTrait(rng);
  const templateBase = base2.templateBase ?? base2.basePrimary;
  return {
    ...base2,
    basePrimary,
    templateBase,
    bodyType,
    gender,
    personalName,
    personality,
    traitId,
    trait: `${TRAITS[traitId].name}\uFF1A${TRAITS[traitId].desc}`
  };
}

// packages/core/src/rules/index.ts
var TICK = 1 / 20;
var REFRESH_COST2 = 1;
function createRun(input) {
  const { runId, seed, heroIds, mode, endlessUnlocked } = input;
  const safeMode = (mode === "normal" || mode === "ironman") && !endlessUnlocked ? "novice" : mode;
  if (heroIds.length !== 3) return err("TEAM_INVALID", "\u5F00\u5C40\u5FC5\u987B\u6070\u597D 3 \u4EBA");
  const rng = mulberry32((seed ^ 2654435769) >>> 0);
  const taken = [];
  const team = heroIds.map((id, i) => {
    const base2 = DB.get("heroes", id);
    if (!base2) return null;
    const v = variateHero(base2, (seed ^ (i + 1) * 2654435761) >>> 0, taken);
    if (v.personalName) taken.push(v.personalName);
    return { ...v, uid: `H${i + 1}`, star: 1, dupIndex: 1 };
  });
  if (team.some((t) => t === null)) {
    return err("TEAM_INVALID", "\u961F\u4F0D\u5305\u542B\u672A\u77E5\u82F1\u96C4");
  }
  const teamOk = team;
  const snapshot = {
    runId,
    version: 0,
    layer: 1,
    mode: safeMode,
    score: 0,
    failures: 0,
    cap: capFor(safeMode),
    team: teamOk,
    relics: [],
    resolvedEvents: [],
    status: "active",
    gold: 0,
    inventory: safeMode === "novice" ? rollStarterKit(rng) : [],
    pendingDrops: [],
    equipped: {},
    consumables: [],
    shopStock: rollShopStock(rng, 8),
    // v1.7 招募池生成时即个体化（同角色不同副本基础值/体型/姓名各异），价格据此浮动
    recruitPool: rollRecruitPool(mulberry32((seed ^ 104729) >>> 0), teamOk).map((h, i) => variateHero(h, (seed ^ 104729 + i * 2654435761) >>> 0, teamOk.map((t) => t.personalName ?? t.name))),
    tradeCount: 0,
    refreshCount: 0,
    forgedThisLayer: [],
    fusedThisLayer: 0,
    reforgedThisLayer: false,
    opSeq: 3,
    // 开局 3 人；opSeq 单调递增、不受背包状态影响
    // 渲染种子：确定性派生（本地/测试用）；云端宿主会覆写为独立随机，与权威种子解耦
    renderSeed: (seed ^ 2246822507) >>> 0,
    receipts: {}
  };
  return ok(snapshot);
}
function advanceLayer(s) {
  return ok({ ...s, version: s.version + 1 });
}
function advanceLayerTo(s, n) {
  return ok({
    ...s,
    version: s.version + 1,
    layer: Math.max(1, Math.min(n, capFor(s.mode))),
    forgedThisLayer: [],
    fusedThisLayer: 0,
    reforgedThisLayer: false
  });
}
function upgradeHero(s, uid2) {
  const h = s.team.find((x) => x.uid === uid2);
  if (!h) return err("TEAM_INVALID", "\u82F1\u96C4\u4E0D\u5B58\u5728");
  const cost = recruitCostOf(s.layer);
  if (s.gold < cost) return err("INSUFFICIENT_GOLD", `\u5347\u661F\u9700 ${cost} \u91D1\u5E01`);
  const star = h.star ?? 1;
  const nextStar = Math.min(star + 1, 5);
  const main = dominantPrimary(h.basePrimary);
  const bonusPct = { ...h.bonusPct ?? {} };
  const add = (k, v) => {
    bonusPct[k] = Math.round(((bonusPct[k] ?? 0) + v) * 10) / 10;
  };
  let lastBreakthrough;
  let mount = h.mount;
  let mountRarity = h.mountRarity;
  if (star < 5) {
    const rng = mulberry32(hashStr(`${s.runId}:${uid2}:${star}`));
    const pick2 = () => PRIMARY_KEYS[Math.floor(rng() * PRIMARY_KEYS.length)];
    const p5 = [pick2(), pick2()];
    const p3 = [pick2(), pick2()];
    add(main, 10);
    for (const k of p5) add(k, 5);
    for (const k of p3) add(k, 3);
    if (nextStar >= 5 && !mount) {
      const mSeed = ((s.renderSeed ?? 0) ^ hashStr(uid2) ^ s.layer * 2246822507 >>> 0) >>> 0;
      mount = rollMount(mulberry32(mSeed));
      mountRarity = rollMountRarity(mulberry32((mSeed ^ 2654435769) >>> 0));
    }
    lastBreakthrough = { heroId: h.id, heroUid: uid2, key: main, add: 10, main: true, p5, p3 };
  } else {
    const accum = Math.round(Object.values(bonusPct).reduce((sum, v) => sum + (v ?? 0), 0) * 10);
    const seed = ((s.renderSeed ?? 0) ^ s.layer * 1779033703 >>> 0 ^ s.tradeCount * 3144134277 >>> 0 ^ s.score * 13 >>> 0 ^ hashStr(uid2) ^ Math.imul(accum + 1, 668265261)) >>> 0;
    const rng = mulberry32(seed);
    const hitMain = rng() < BREAKTHROUGH_MAIN_CHANCE;
    const others = PRIMARY_KEYS.filter((k) => k !== main);
    const key = hitMain ? main : others[Math.floor(rng() * others.length)] ?? main;
    const value = Math.round((3 + rng() * 2) * 10) / 10;
    add(key, value);
    lastBreakthrough = { heroId: h.id, heroUid: uid2, key, add: value, main: hitMain };
  }
  const team = s.team.map(
    (x) => x.uid === uid2 ? { ...x, bonusPct, star: nextStar, mount, mountRarity } : x
  );
  return ok({
    ...s,
    version: s.version + 1,
    gold: s.gold - cost,
    team,
    receipts: {
      ...s.receipts,
      lastBreakthrough,
      lastMount: mount && mount !== h.mount ? { heroUid: uid2, kind: mount } : s.receipts.lastMount
    }
  });
}
var SeqIdGen = class {
  constructor(n = 0) {
    this.n = n;
  }
  next(p) {
    return `${p}${this.n++}`;
  }
  get cursor() {
    return this.n;
  }
};
var seeds = {
  layer: (s, layer) => s + layer * 7919 >>> 0,
  drops: (s, layer) => (s ^ layer * 7919) >>> 0,
  shop: (s, layer, rc) => (s ^ layer * 7919 ^ rc * 2654435761) >>> 0,
  recruit: (s, layer, rc) => (s ^ layer * 104729 ^ rc * 2246822519) >>> 0,
  battle: (s, layer) => s + layer >>> 0,
  /** 修复 run.ts:180 的 Math.random —— MVP 奖励属性改为确定性派生 */
  mvp: (s, layer, uid2) => (s ^ layer * 461845907 ^ hashStr(uid2)) >>> 0,
  breakthrough: (s, uid2, acc) => (s ^ hashStr(uid2) ^ Math.imul(acc + 1, 668265261)) >>> 0
};
function hashTrace(s) {
  let h1 = 3735928559, h2 = 1103547991;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
  h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
function planBattle(snap, secret) {
  if (snap.status !== "active") return err("RUN_ENDED");
  const plan = genLayer(snap.layer, secret.seed, snap.mode);
  return ok({
    layer: snap.layer,
    arena: plan.arena,
    enemyPreview: {
      defs: plan.waves.flat(),
      bossTier: plan.bossTier,
      eliteBoss: !!plan.eliteBoss,
      isVacuum: plan.isVacuum,
      isMutation: plan.isMutation,
      mutationRule: plan.mutationRule
    },
    buildings: plan.buildings,
    spawnAlly: plan.spawnAlly,
    spawnEnemy: plan.spawnEnemy,
    bossPos: plan.bossPos,
    randomEvent: plan.randomEvent
  });
}
function toSnapshot(u) {
  return JSON.parse(JSON.stringify(u));
}
function buildUnits(snap, secret, formation, opts) {
  resetUid(0);
  const layer = opts?.layer ?? snap.layer;
  const plan = genLayer(layer, secret.seed, snap.mode);
  const spots = sanitizeFormation(
    plan.arena,
    snap.team.map((h) => formation[h.uid]),
    plan.spawnAlly[0],
    snap.team.length
  );
  const allies = snap.team.map((h, i) => {
    const eqs = snap.equipped[h.uid] ?? [];
    const u = makeAlly(h, 1 + Math.floor((layer - 1) / 2), eqs, { burst: !!h.pendingBurst });
    u.x = spots[i].x;
    u.y = spots[i].y;
    return u;
  });
  applyRelics(allies, snap.relics);
  const scale = enemyScale(layer);
  const eLevel = 1 + Math.floor(layer / 4);
  const defs = plan.waves.flat();
  const eSpots = enemyPlacements(plan.arena, plan.spawnEnemy, plan.bossPos, defs);
  const hpMult = opts?.enemyHpMult ?? 1;
  const dmgMult = opts?.enemyDmgMult ?? 1;
  const enemies = defs.map((e, i) => {
    const u = makeEnemy(e, eLevel, scale.hp * hpMult, scale.dmg * dmgMult);
    u.x = eSpots[i].x;
    u.y = eSpots[i].y;
    return u;
  });
  return { plan, allies, enemies, scale };
}
function makeSim(i) {
  const sim = new BattleSim([...i.allies, ...i.enemies], i.arena, i.battleSeed);
  sim.setBuildingScale(i.buildingScale.hp, i.buildingScale.dmg);
  resetBuildingId(0);
  if (i.buildings.length) {
    sim.spawnBuildings(i.buildings, i.layer, i.buildingScale.hp, i.buildingScale.dmg);
  }
  if (i.vanEncounter) sim.setVanEncounter(i.vanEncounter, i.buildingScale.hp);
  return sim;
}
function traceLine(sim, step) {
  let line = `${step}`;
  for (const u of sim.units) {
    line += `|${u.id},${u.x.toFixed(6)},${u.y.toFixed(6)},${u.hp.toFixed(6)},${u.alive ? 1 : 0}`;
  }
  return line;
}
function replayBattle(replay, onTick) {
  const clone = (u) => JSON.parse(JSON.stringify(u));
  const sim = makeSim({
    allies: replay.allies.map(clone),
    enemies: replay.enemies.map(clone),
    arena: replay.arena,
    buildings: replay.buildings,
    layer: replay.layer,
    battleSeed: replay.battleSeed,
    buildingScale: replay.buildingScale,
    vanEncounter: replay.vanEncounter
  });
  const parts = [];
  let steps = 0;
  const MAX = 20 * 180;
  while (!sim.over && steps < MAX) {
    sim.tick(TICK);
    parts.push(traceLine(sim, steps));
    onTick?.(sim, steps);
    steps++;
  }
  return {
    sim,
    totalTicks: steps,
    result: sim.result ?? "lose",
    checksum: hashTrace(parts.join("\n"))
  };
}
function runBattle(snap, secret, formation, opts) {
  if (snap.status !== "active") return err("RUN_ENDED");
  const effLayer = opts?.effLayer ?? snap.layer;
  const hpMult = opts?.enemyHpMult ?? 1;
  const dmgMult = opts?.enemyDmgMult ?? 1;
  const { plan, allies, enemies, scale } = buildUnits(snap, secret, formation, {
    layer: effLayer,
    enemyHpMult: opts?.enemyHpMult,
    enemyDmgMult: opts?.enemyDmgMult
  });
  const allySnap = allies.map(toSnapshot);
  const enemySnap = enemies.map(toSnapshot);
  const battleSeed = seeds.battle(secret.seed, effLayer);
  const sim = makeSim({
    allies,
    enemies,
    arena: plan.arena,
    buildings: plan.buildings,
    layer: effLayer,
    battleSeed,
    buildingScale: { hp: scale.hp * hpMult, dmg: scale.dmg * dmgMult },
    vanEncounter: plan.vanEncounter
  });
  const parts = [];
  let steps = 0;
  const MAX = 20 * 180;
  while (!sim.over && steps < MAX) {
    sim.tick(TICK);
    parts.push(traceLine(sim, steps));
    steps++;
  }
  const stats = sim.getBattleStats();
  const killGains = sim.getKillGains();
  const MVP_HEAL_W = 1;
  const MVP_TANK_W = 0.7;
  let mvpUid = null;
  let best = -1;
  for (const r of stats) {
    if (r.side !== "ally" || !r.heroUid) continue;
    const sc = r.dmgDealt + MVP_HEAL_W * r.healDone + MVP_TANK_W * r.dmgTaken;
    if (sc > best) {
      best = sc;
      mvpUid = r.heroUid;
    }
  }
  let mvpStat = null;
  let mvpAdd = 0;
  if (sim.result === "win" && mvpUid) {
    const rng = mulberry32(seeds.mvp(secret.seed, snap.layer, mvpUid));
    mvpStat = PRIMARY_KEYS[Math.floor(rng() * PRIMARY_KEYS.length)];
    mvpAdd = 1;
  }
  return ok({
    battleSeed,
    checksum: hashTrace(parts.join("\n")),
    result: sim.result ?? "lose",
    totalTicks: steps,
    durationSec: Math.round(sim.time * 100) / 100,
    stats,
    killGains,
    deadAllyUids: sim.getDeadAllyUids(),
    mvpUid,
    mvpStat,
    mvpAdd,
    allies: allySnap,
    enemies: enemySnap,
    arena: plan.arena,
    buildings: plan.buildings,
    buildingScale: { hp: scale.hp * hpMult, dmg: scale.dmg * dmgMult },
    vanEncounter: plan.vanEncounter
  });
}
function applySettlement(snap, secret, r, opts) {
  let next = { ...snap, version: snap.version + 1 };
  let team = next.team.map((h) => {
    const g = r.killGains[h.uid];
    return g ? { ...h, growthBonus: addGrowth(h.growthBonus, g) } : h;
  });
  if (r.result === "win" && r.mvpUid && r.mvpStat) {
    team = team.map((h) => h.uid === r.mvpUid ? { ...h, growthBonus: addGrowth(h.growthBonus, { primary: { [r.mvpStat]: r.mvpAdd } }) } : h);
  }
  team = team.map((h) => h.pendingBurst ? { ...h, pendingBurst: false } : h);
  if (next.mode === "ironman" && r.deadAllyUids.length) {
    const survivors = team.filter((h) => !r.deadAllyUids.includes(h.uid));
    if (survivors.length >= 1) {
      const equipped = { ...next.equipped };
      const returned = [];
      for (const uid2 of r.deadAllyUids) {
        returned.push(...equipped[uid2] ?? []);
        delete equipped[uid2];
      }
      team = survivors;
      next = { ...next, equipped, inventory: [...next.inventory, ...returned] };
    }
  }
  next = { ...next, team, receipts: { ...next.receipts, lastKillGains: r.killGains } };
  if (r.result === "win") {
    const cap = capFor(next.mode);
    const layers = opts?.rewardLayers && opts.rewardLayers.length ? opts.rewardLayers : [next.layer];
    let goldGain = 0;
    let drops = [];
    for (const L of layers) {
      goldGain += goldReward(L);
      drops = [...drops, ...rollDrops(mulberry32(seeds.drops(secret.seed, L)), L, !!bossTierAt(L, next.mode), !!opts?.highBonus)];
    }
    const effLayer = opts?.effLayer ?? next.layer;
    const nextLayer = effLayer + 1;
    next = {
      ...next,
      gold: next.gold + goldGain,
      pendingDrops: [...next.pendingDrops, ...drops],
      score: next.score + effLayer * 10,
      layer: Math.min(nextLayer, cap),
      status: nextLayer > cap ? "won" : "active",
      // 跨层重置的局内计数
      forgedThisLayer: [],
      fusedThisLayer: 0,
      reforgedThisLayer: false
    };
  } else {
    const loseFailures = opts?.loseFailures ?? 1;
    const failures = next.failures + loseFailures;
    next = { ...next, failures, status: failures >= 3 ? "lost" : "active" };
  }
  return next;
}
var climbMult = (i) => 1.1 + 0.05 * (Math.min(i, 10) - 1) / 9;
function cloneUnits(us) {
  return typeof structuredClone === "function" ? structuredClone(us) : JSON.parse(JSON.stringify(us));
}
function makeWinRatePredictor(snap, secret, formation, layer, mods, count = 20) {
  const hpMult = mods.enemyHpMult ?? 1;
  const dmgMult = mods.enemyDmgMult ?? 1;
  const built = buildUnits(snap, secret, formation, {
    layer,
    enemyHpMult: mods.enemyHpMult,
    enemyDmgMult: mods.enemyDmgMult
  });
  const buildingScale = { hp: built.scale.hp * hpMult, dmg: built.scale.dmg * dmgMult };
  let k = 0;
  let wins = 0;
  const sample = () => {
    const allies = cloneUnits(built.allies);
    const enemies = cloneUnits(built.enemies);
    if (mods.strategy) applyClimbStrategy(allies, mods.strategy);
    const seed = (secret.seed ^ layer * 2654435761 ^ k * 2654435761) >>> 0;
    const sim = makeSim({
      allies,
      enemies,
      arena: built.plan.arena,
      buildings: built.plan.buildings,
      layer,
      battleSeed: seed,
      buildingScale,
      vanEncounter: built.plan.vanEncounter
    });
    let steps = 0;
    while (!sim.over && steps < 20 * 180) {
      sim.tick(TICK);
      steps++;
    }
    return sim.result === "win";
  };
  return {
    get count() {
      return count;
    },
    get ran() {
      return k;
    },
    get wins() {
      return wins;
    },
    get done() {
      return k >= count;
    },
    /** 当前估算值（跑满前为部分样本比例，仅供进度展示） */
    get rate() {
      return k === 0 ? 0 : wins / k;
    },
    /** 跑满 count 后的最终值（未跑满时按已跑样本折算，语义同 predictWinRate 的 wins/count） */
    get finalRate() {
      return count === 0 ? 0 : wins / count;
    },
    /** 推进 n 个样本，返回是否已跑完 */
    step(n = 1) {
      for (let i = 0; i < n && k < count; i++) {
        if (sample()) wins++;
        k++;
      }
      return k >= count;
    }
  };
}
function predictWinRate(snap, secret, formation, layer, mods, count = 20) {
  if (count <= 0) return 0;
  const p = makeWinRatePredictor(snap, secret, formation, layer, mods, count);
  p.step(count);
  return p.finalRate;
}
function predictWinRateAtLeast(snap, secret, formation, layer, mods, target, count = 20) {
  if (count <= 0) return 0 >= target;
  let need = 0;
  while (need <= count && need / count < target) need++;
  if (need > count) return false;
  if (need === 0) return true;
  const p = makeWinRatePredictor(snap, secret, formation, layer, mods, count);
  while (!p.done) {
    p.step(1);
    if (p.wins >= need) return true;
    if (p.wins + (count - p.ran) < need) return false;
  }
  return p.wins >= need;
}
function autoClimb(snap, secret, formation, opts) {
  if (snap.status !== "active") return err("RUN_ENDED");
  const cap = capFor(snap.mode);
  const max = Math.max(1, Math.min(opts.maxLayers ?? 10, 10));
  const layers = [];
  const totalDrops = [];
  let totalGold = 0;
  let finalLayer = snap.layer;
  let stopReason = "done";
  let failLayer = null;
  for (let i = 1; i <= max; i++) {
    const layer = snap.layer + i;
    if (layer > cap) {
      stopReason = "cap";
      break;
    }
    const mult = climbMult(i);
    const mods = { enemyHpMult: mult, enemyDmgMult: mult, strategy: opts.strategy };
    if (opts.winRateTarget !== void 0 && opts.winRateTarget > 0) {
      if (!predictWinRateAtLeast(snap, secret, formation, layer, mods, opts.winRateTarget)) {
        stopReason = "winrate";
        break;
      }
    }
    const { plan, allies, enemies, scale } = buildUnits(snap, secret, formation, mods);
    applyClimbStrategy(allies, opts.strategy);
    const battleSeed = (secret.seed ^ layer * 2246822519 ^ 1597334677) >>> 0;
    const sim = makeSim({
      allies,
      enemies,
      arena: plan.arena,
      buildings: plan.buildings,
      layer,
      battleSeed,
      buildingScale: { hp: scale.hp * mult, dmg: scale.dmg * mult },
      vanEncounter: plan.vanEncounter
    });
    let steps = 0;
    while (!sim.over && steps < 20 * 180) {
      sim.tick(TICK);
      steps++;
    }
    if (sim.result === "win") {
      const gold = goldReward(layer);
      const drops = rollDrops(mulberry32(seeds.drops(secret.seed, layer)), layer, !!bossTierAt(layer, snap.mode));
      totalGold += gold;
      totalDrops.push(...drops);
      finalLayer = layer;
      layers.push({ layer, win: true, gold, drops });
    } else {
      failLayer = layer;
      finalLayer = snap.layer;
      layers.push({ layer, win: false, gold: 0, drops: [] });
      stopReason = "fail";
      break;
    }
  }
  return ok({ layers, finalLayer, stopReason, failLayer, totalGold, totalDrops });
}
function applyAutoClimb(snap, _secret, r) {
  let next = {
    ...snap,
    version: snap.version + 1,
    gold: snap.gold + r.totalGold,
    pendingDrops: [...snap.pendingDrops, ...r.totalDrops]
  };
  if (r.stopReason === "fail") {
    const failures = next.failures + 1;
    next = { ...next, failures, status: failures >= 3 ? "lost" : "active" };
  } else if (r.finalLayer > snap.layer) {
    const cap = capFor(next.mode);
    const layer = Math.min(r.finalLayer + 1, cap);
    next = {
      ...next,
      layer,
      status: r.finalLayer + 1 > cap ? "won" : "active",
      forgedThisLayer: [],
      fusedThisLayer: 0,
      reforgedThisLayer: false
    };
  }
  return next;
}
function buyItem(s, itemId) {
  if (s.status !== "active") return err("RUN_ENDED");
  const eq = s.shopStock.equipment.find((e) => e.id === itemId);
  const con = s.shopStock.consumables.find((c) => c.id === itemId);
  const item = eq ?? con;
  if (!item) return err("ITEM_GONE");
  const price = Math.round(item.basePrice * (1 - discountOf(s.tradeCount)));
  if (s.gold < price) return err("INSUFFICIENT_GOLD");
  return ok({
    ...s,
    version: s.version + 1,
    gold: s.gold - price,
    tradeCount: s.tradeCount + 1,
    opSeq: s.opSeq + 1,
    inventory: eq ? [...s.inventory, { ...eq, opened: true }] : s.inventory,
    consumables: con ? [...s.consumables, con] : s.consumables,
    shopStock: {
      equipment: s.shopStock.equipment.filter((e) => e.id !== itemId),
      consumables: s.shopStock.consumables.filter((c) => c.id !== itemId)
    }
  });
}
function sellItem(s, equipmentId) {
  if (s.status !== "active") return err("RUN_ENDED");
  const eq = s.inventory.find((e) => e.id === equipmentId);
  if (!eq) return err("ITEM_GONE");
  const d = discountOf(s.tradeCount);
  const price = Math.round(eq.basePrice * 0.5 * (1 - d * 0.5));
  return ok({
    ...s,
    version: s.version + 1,
    gold: s.gold + price,
    tradeCount: s.tradeCount + 1,
    opSeq: s.opSeq + 1,
    inventory: s.inventory.filter((e) => e.id !== equipmentId)
  });
}
function refreshShop(s, secret) {
  if (s.status !== "active") return err("RUN_ENDED");
  if (s.gold < REFRESH_COST2) return err("INSUFFICIENT_GOLD");
  const rc = s.refreshCount + 1;
  return ok({
    ...s,
    version: s.version + 1,
    gold: s.gold - REFRESH_COST2,
    refreshCount: rc,
    opSeq: s.opSeq + 1,
    shopStock: rollShopStock(mulberry32(seeds.shop(secret.seed, s.layer, rc)), 8)
  });
}
function refreshRecruit(s, secret) {
  if (s.status !== "active") return err("RUN_ENDED");
  if (s.gold < REFRESH_COST2) return err("INSUFFICIENT_GOLD");
  const rc = s.refreshCount + 1;
  return ok({
    ...s,
    version: s.version + 1,
    gold: s.gold - REFRESH_COST2,
    refreshCount: rc,
    opSeq: s.opSeq + 1,
    // v1.7 招募池刷新时即个体化（与 startRun 同源逻辑），价格据此浮动
    recruitPool: rollRecruitPool(mulberry32(seeds.recruit(secret.seed, s.layer, rc)), s.team).map((h, i) => variateHero(h, (seeds.recruit(secret.seed, s.layer, rc) ^ i * 2654435761) >>> 0, s.team.map((t) => t.personalName ?? t.name)))
  });
}
function openDrop(s, chestId) {
  const d = s.pendingDrops.find((x) => x.id === chestId);
  if (!d) return err("ITEM_GONE");
  const rest = s.pendingDrops.filter((x) => x.id !== chestId);
  if (d.reward.startsWith("gold")) {
    return ok({ ...s, version: s.version + 1, pendingDrops: rest, gold: s.gold + (d.gold ?? 0) });
  }
  return ok({
    ...s,
    version: s.version + 1,
    pendingDrops: rest,
    inventory: [...s.inventory, { ...d.equipment, opened: true }]
  });
}
function openDrops(s, chestIds) {
  const idSet = new Set(chestIds);
  const targets = s.pendingDrops.filter((x) => idSet.has(x.id));
  if (targets.length === 0) return err("ITEM_GONE", "\u6CA1\u6709\u53EF\u5F00\u542F\u7684\u5B9D\u7BB1");
  const openedIds = new Set(targets.map((x) => x.id));
  let gold = s.gold;
  const inventory = [...s.inventory];
  for (const d of targets) {
    if (d.reward.startsWith("gold")) gold += d.gold ?? 0;
    else inventory.push({ ...d.equipment, opened: true });
  }
  return ok({
    ...s,
    version: s.version + 1,
    pendingDrops: s.pendingDrops.filter((x) => !openedIds.has(x.id)),
    gold,
    inventory,
    opSeq: s.opSeq + targets.length
  });
}
function reforgeItem(s, equipmentId) {
  if (s.reforgedThisLayer) return err("REFORGE_LIMIT", "\u672C\u5C42\u5DF2\u91CD\u94F8\u8FC7\uFF0C\u8BF7\u63A8\u8FDB\u4E0B\u4E00\u5C42\u518D\u8BD5");
  const eq = s.inventory.find((e) => e.id === equipmentId);
  if (!eq) return err("ITEM_GONE", "\u88C5\u5907\u4E0D\u5B58\u5728");
  if (eq.rarity !== "normal") return err("NOT_REFORGEABLE", "\u4EC5\u767D\u8272\u88C5\u5907\u53EF\u91CD\u94F8");
  const rng = mulberry32(hashStr(`${s.runId}:${equipmentId}:${s.layer}`) >>> 0);
  const rarity = ["blue", "orange", "red"][Math.floor(rng() * 3)];
  const forged = { ...generateEquipment(rng, rarity), id: eq.id, opened: true };
  return ok({
    ...s,
    version: s.version + 1,
    reforgedThisLayer: true,
    inventory: s.inventory.map((e) => e.id === equipmentId ? forged : e),
    receipts: {
      ...s.receipts,
      lastReforge: { from: eq.rarity, to: rarity, itemId: forged.id, name: forged.name }
    }
  });
}
function resolveRandomEvent(s, layer, optionIndex) {
  if (layer !== s.layer) return err("LAYER_MISMATCH", "\u53EA\u80FD\u7ED3\u7B97\u5F53\u524D\u5C42\u5947\u9047");
  if (s.resolvedEvents.includes(layer)) return err("EVENT_DONE", "\u8BE5\u5C42\u5947\u9047\u5DF2\u7ED3\u7B97");
  const plan = genLayer(layer, s.renderSeed ?? 0, s.mode);
  const ev = plan.randomEvent;
  if (!ev) return err("EVENT_NONE", "\u672C\u5C42\u65E0\u5947\u9047");
  const opt = ev.options[optionIndex];
  if (!opt) return err("EVENT_OPTION", "\u9009\u9879\u4E0D\u5B58\u5728");
  const e = opt.effect;
  if (e.sacrificeLowest && s.inventory.length === 0) return err("NO_MATERIAL", "\u80CC\u5305\u4E3A\u7A7A\uFF0C\u65E0\u6CD5\u732E\u796D");
  if (e.gold && e.gold < 0 && s.gold + e.gold < 0) return err("INSUFFICIENT_GOLD", "\u91D1\u5E01\u4E0D\u8DB3");
  let gold = s.gold;
  let inventory = [...s.inventory];
  let score = s.score;
  if (e.gold) gold += e.gold;
  if (e.give) {
    const rng = mulberry32(((s.renderSeed ?? 0) ^ layer * 2654435761 ^ optionIndex * 40503) >>> 0);
    for (let i = 0; i < e.give.count; i++) {
      inventory.push(generateEquipment(rng, e.give.rarity));
    }
  }
  if (e.sacrificeLowest && inventory.length > 0) {
    const worst = inventory.slice().sort((a, b) => equipScore(a) - equipScore(b))[0];
    inventory = inventory.filter((x) => x.id !== worst.id);
  }
  if (e.score) score += e.score;
  return ok({
    ...s,
    version: s.version + 1,
    gold,
    inventory,
    score,
    resolvedEvents: [...s.resolvedEvents, layer],
    opSeq: s.opSeq + (e.give?.count ?? 0)
  });
}
function equipCapFor(h) {
  return h.traitId === "grower" ? TRAIT_CFG.growerEquipCap : EQUIP_SLOTS;
}
function equipItem(s, uid2, equipmentId) {
  const eq = s.inventory.find((e) => e.id === equipmentId);
  if (!eq) return err("ITEM_GONE");
  const hero = s.team.find((h) => h.uid === uid2);
  if (!hero) return err("TEAM_INVALID");
  const cur = s.equipped[uid2] ?? [];
  if (cur.length >= equipCapFor(hero)) return err("SLOT_FULL");
  if (!s.team.some((h) => h.uid === uid2)) return err("TEAM_INVALID");
  return ok({
    ...s,
    version: s.version + 1,
    inventory: s.inventory.filter((e) => e.id !== equipmentId),
    equipped: { ...s.equipped, [uid2]: [...cur, eq] }
  });
}
function unequipItem(s, uid2, equipmentId) {
  const cur = s.equipped[uid2] ?? [];
  const eq = cur.find((e) => e.id === equipmentId);
  if (!eq) return err("ITEM_GONE");
  return ok({
    ...s,
    version: s.version + 1,
    equipped: { ...s.equipped, [uid2]: cur.filter((e) => e.id !== equipmentId) },
    inventory: [...s.inventory, eq]
  });
}
function recruit(s, _secret, heroId) {
  if (s.status !== "active") return err("RUN_ENDED");
  if (s.team.length >= 7) return err("CAP_REACHED");
  const h = s.recruitPool.find((x) => x.id === heroId);
  if (!h) return err("ITEM_GONE");
  const preset = HERO_BY_ID[h.id]?.basePrimary;
  const cost = recruitCostOf(s.layer, h.basePrimary, preset);
  if (s.gold < cost) return err("INSUFFICIENT_GOLD");
  const uid2 = `H${s.opSeq + 1}`;
  return ok({
    ...s,
    version: s.version + 1,
    gold: s.gold - cost,
    opSeq: s.opSeq + 1,
    team: [...s.team, { ...h, uid: uid2, star: 1, dupIndex: s.team.filter((t) => t.id === heroId).length + 1 }],
    recruitPool: s.recruitPool.filter((x) => x.id !== heroId)
  });
}
function equipAll(s, uid2) {
  const targets = uid2 ? s.team.filter((h) => h.uid === uid2) : s.team;
  if (targets.length === 0) return err("TEAM_INVALID", "\u6CA1\u6709\u53EF\u88C5\u5907\u7684\u82F1\u96C4");
  const inv = [...s.inventory].sort((a, b) => equipScore(b) - equipScore(a));
  const eqMap = { ...s.equipped };
  let changed = 0;
  for (const h of targets) {
    const cap = equipCapFor(h);
    const cur = [...eqMap[h.uid] ?? []];
    while (cur.length < cap && inv.length) {
      cur.push(inv.shift());
      changed++;
    }
    eqMap[h.uid] = cur;
  }
  return ok({
    ...s,
    version: s.version + 1,
    inventory: inv,
    equipped: eqMap
  });
}

// packages/core/src/buildinfo.ts
var CORE_BUILD_HASH = "3f77e2b4cad6eaa133e38dfe33a7ed5383416c0fd2449386fd7b09ab1c22d5e0";
export {
  BREAKTHROUGH_MAIN_CHANCE,
  CORE_BUILD_HASH,
  CORE_VERSION,
  EQUIP_SLOTS,
  FUSE_PER_LAYER,
  GROWTH_STAT_KEYS,
  PRIMARY_KEYS,
  REFRESH_COST,
  SeqIdGen,
  TEAM_CAP,
  addGrowth,
  advanceLayer,
  advanceLayerTo,
  applyAutoClimb,
  applySettlement,
  autoClimb,
  buildUnits,
  buyItem,
  climbMult,
  createRun,
  discountOf,
  equipAll,
  equipItem,
  err,
  goldReward,
  hashStr,
  hashTrace,
  makeSim,
  makeWinRatePredictor,
  ok,
  openDrop,
  openDrops,
  planBattle,
  predictWinRate,
  predictWinRateAtLeast,
  recruit,
  recruitCostOf,
  reforgeItem,
  refreshRecruit,
  refreshShop,
  replayBattle,
  resolveRandomEvent,
  rollStarterKit,
  runBattle,
  seeds,
  sellItem,
  traceLine,
  unequipItem,
  upgradeHero
};
//# sourceMappingURL=index.js.map
