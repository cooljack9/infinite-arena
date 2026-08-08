/**
 * 确定性数学库（deterministic math）——跨 JS 引擎逐 bit 一致的超越函数。
 *
 * ## 为什么需要它
 *
 * ECMA-262 对 `Math` 的精度分成两档：
 *
 * | 档位                        | 成员                                          | 跨引擎 |
 * |-----------------------------|-----------------------------------------------|--------|
 * | IEEE 754 要求正确舍入        | `+ - * /`、`Math.sqrt`、`Math.round/floor/abs` | 逐 bit 一致 |
 * | implementation-approximated | `sin cos tan atan2 hypot exp log pow cbrt`     | **允许各引擎不同** |
 *
 * 第二档规范原文只要求"实现应当使用被广泛接受的近似算法"，没有任何 ULP 约束。
 * 实测（`floatscan.html`，每函数 20000 组输入的 bit 级指纹）：
 *
 * ```
 *              Chromium/V8   Firefox/SpiderMonkey   WebKit/JSC
 *   Math.cos    9f2a1c04…         3b71ee58…          c0d4a917…    ← 三者互不相同
 *   Math.pow    5e88bd10…         a1c7042f…          a1c7042f…    ← V8 与另两家不同
 *   Math.sqrt   4c2b9f7e…         4c2b9f7e…          4c2b9f7e…    ← 一致
 * ```
 *
 * 本项目的后端下发的是「种子 + 开局快照 + 结果」，前端本地跑同一份 `BattleSim` 复现过程。
 * 演算路径上只要出现一次第二档函数，Safari 玩家看到的战斗过程就会和服务端结算对不上
 * ——实测 18 场基准战斗里第 18 场三引擎分别跑出 621 / 607 / 651 tick。
 *
 * ## 本模块的做法
 *
 * 全部只用第一档运算（`+ - * /`、`Math.sqrt`、`Math.round`、DataView 位操作）重写。
 * 这些运算的结果由 IEEE 754 唯一确定，任何符合规范的引擎都必然给出同一个 bit 串。
 *
 * **注意本模块不追求"与 `Math.*` 结果相同"，只追求"处处相同"。** 与 V8 的偏差在
 * 1 ULP 量级（~2e-16 相对误差），对游戏数值毫无影响；而"处处相同"是架构的承重假设。
 *
 * 详见 docs/backend/07_跨引擎浮点一致性.md
 */

// ── 位级工具：用 DataView 拆装 double。规范精确定义，无实现自由度 ──────────

const _dv = new DataView(new ArrayBuffer(8));

/** 精确构造 2^e（e 为整数）。用于 ldexp，全程无舍入。 */
function pow2i(e: number): number {
  if (e >= -1022 && e <= 1023) {
    _dv.setUint32(0, ((e + 1023) << 20) >>> 0, false);
    _dv.setUint32(4, 0, false);
    return _dv.getFloat64(0, false);
  }
  // 超出正规数范围：拆成两步（本项目用不到，留作完备性）
  if (e > 1023) return pow2i(1023) * pow2i(e - 1023);
  return pow2i(-1022) * pow2i(e + 1022);
}

/** 把 x 拆成 m * 2^e，m ∈ [0.5, 1)。仅支持有限正数。 */
function frexp(x: number): { m: number; e: number } {
  let v = x;
  let bias = 0;
  if (v < 2.2250738585072014e-308) { v *= 9007199254740992; bias = -53; } // 次正规数先放大 2^53
  _dv.setFloat64(0, v, false);
  const hi = _dv.getUint32(0, false);
  const e = ((hi >>> 20) & 0x7ff) - 1022;
  // 把指数域改写成 1022（即 2^-1）→ 尾数不变，值落进 [0.5, 1)
  _dv.setUint32(0, ((hi & 0x800fffff) | (1022 << 20)) >>> 0, false);
  return { m: _dv.getFloat64(0, false), e: e + bias };
}

// ── sin / cos ────────────────────────────────────────────────────────────
//
// Cody-Waite argument reduction（把 π/2 拆成 hi+lo 两段，抵消大角度时的相消误差）
// + fdlibm 的 kernel 多项式（在 [-π/4, π/4] 上误差 < 1 ULP，是 glibc/musl 同款系数）。

// π/2 拆成 hi + lo 两段，且 **hi 的低 33 位刻意清零**（fdlibm 的 pio2_1）。
// 这样 k * PIO2_HI 在 |k| < 2^20 时是精确乘法、不产生舍入——
// 直接用「离 π/2 最近的 double」会让 k=25 时 k*hi 就吃掉 3.6e-15 的误差，
// 实测正是这一项把 |x|≤40 区间的 sin 误差顶到 3.6e-15（超出验收线）。
const PIO2_HI = 1.57079632673412561417;     // 0x3FF921FB_54400000，低 33 位为 0
const PIO2_LO = 6.07710050650619224932e-11; // π/2 − PIO2_HI（余下部分）
const TWO_OVER_PI = 0.6366197723675814;     // 2/π

const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03;
const S3 = -1.98412698298579493134e-04, S4 = 2.75573137070700676789e-06;
const S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03;
const C3 = 2.48015872894767294178e-05, C4 = -2.75573143513906633035e-07;
const C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;

/** sin 核函数，仅在 |x| ≤ π/4 有效 */
function kSin(x: number): number {
  const z = x * x;
  return x + x * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
}

/** cos 核函数，仅在 |x| ≤ π/4 有效 */
function kCos(x: number): number {
  const z = x * x;
  return 1 - 0.5 * z + z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
}

/**
 * 把 x 规约到 [-π/4, π/4]，返回余数与象限号（0..3）。
 * 全部是 `Math.round` + 加减乘 —— 都由规范/IEEE 754 唯一确定。
 */
function reduce(x: number): { r: number; q: number } {
  const k = Math.round(x * TWO_OVER_PI);            // Math.round 由规范精确定义
  const r = x - k * PIO2_HI;                        // 精确（PIO2_HI 低位清零）
  return { r: r - k * PIO2_LO, q: ((k % 4) + 4) % 4 };
}

/** 确定性 sin。跨引擎逐 bit 一致；与 `Math.sin` 的偏差 ≤ ~1 ULP。 */
export function dsin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const { r, q } = reduce(x);
  switch (q) {
    case 0: return kSin(r);
    case 1: return kCos(r);
    case 2: return -kSin(r);
    default: return -kCos(r);
  }
}

/** 确定性 cos。跨引擎逐 bit 一致；与 `Math.cos` 的偏差 ≤ ~1 ULP。 */
export function dcos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const { r, q } = reduce(x);
  switch (q) {
    case 0: return kCos(r);
    case 1: return -kSin(r);
    case 2: return -kCos(r);
    default: return kSin(r);
  }
}

// ── log2 / exp2 / pow ────────────────────────────────────────────────────

const LOG2E = 1.4426950408889634;
const LN2 = 0.6931471805599453;
const SQRT1_2 = 0.7071067811865476;

/** 确定性 ln。atanh 级数（收敛快、对 m≈1 相对误差友好）。仅支持有限正数。 */
function dlog(x: number): number {
  const { m: m0, e: e0 } = frexp(x);
  // 把尾数挪到 [√2/2, √2)，让 t=(m-1)/(m+1) 落在 |t| ≤ 0.1716
  const m = m0 < SQRT1_2 ? m0 * 2 : m0;
  const e = m0 < SQRT1_2 ? e0 - 1 : e0;
  const t = (m - 1) / (m + 1);
  const t2 = t * t;
  // ln(m) = 2t·(1 + t²/3 + t⁴/5 + … + t²⁰/21)，末项余项 < 1e-17
  const s = 1 + t2 * (1 / 3 + t2 * (1 / 5 + t2 * (1 / 7 + t2 * (1 / 9 + t2 * (1 / 11
    + t2 * (1 / 13 + t2 * (1 / 15 + t2 * (1 / 17 + t2 * (1 / 19 + t2 * (1 / 21))))))))));
  return 2 * t * s + e * LN2;
}

/** 确定性 e^z。|z| ≤ 0.35 时用 Taylor；超出先做整数拆分。 */
function dexp(z: number): number {
  const n = Math.round(z * LOG2E);          // z ≈ n·ln2 + f
  const f = z - n * LN2;
  // e^f，|f| ≤ 0.3466，Taylor 到 13 阶余项 < 5e-18
  const e = 1 + f * (1 + f * (1 / 2 + f * (1 / 6 + f * (1 / 24 + f * (1 / 120 + f * (1 / 720
    + f * (1 / 5040 + f * (1 / 40320 + f * (1 / 362880 + f * (1 / 3628800 + f * (1 / 39916800
    + f * (1 / 479001600)))))))))))); // eslint-disable-line
  return e * pow2i(n);
}

/** 整数次幂：平方求幂，只用乘除，天然确定。 */
export function dpowi(base: number, n: number): number {
  let e = n < 0 ? -n : n;
  let b = base;
  let r = 1;
  while (e > 0) {
    if (e & 1) r *= b;
    b *= b;
    e >>>= 1;
  }
  return n < 0 ? 1 / r : r;
}

/**
 * 确定性 pow。**演算路径上必须用它替代 `Math.pow`。**
 *
 * 常见指数走精确快路（0/1/2/±0.5/整数），其余走 e^(y·ln x)。
 * 快路的意义不只是性能：`y === 0.5 → Math.sqrt` 由 IEEE 754 正确舍入，
 * 结果与绝大多数引擎的 `Math.pow(x, 0.5)` 完全相同，因此把默认配置
 * （`enemyScale` 的 expHp/expDmg = 0.5）的数值平衡原样保下来了。
 */
export function dpow(x: number, y: number): number {
  if (y === 0) return 1;
  if (y === 1) return x;
  if (y === 2) return x * x;
  if (y === -1) return 1 / x;
  if (x === 1) return 1;
  if (y === 0.5) return Math.sqrt(x);
  if (y === -0.5) return 1 / Math.sqrt(x);
  if (Number.isInteger(y) && y >= -1024 && y <= 1024) return dpowi(x, y);
  // det-ok：±Infinity / NaN 的组合语义由规范 21.3.2.26 逐条穷举定死，无实现自由度
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Math.pow(x, y);
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x < 0) return NaN;                                                  // 非整数指数 + 负底
  return dexp(y * dlog(x));
}

/**
 * 把单位向量 (x, y) 旋转 θ 弧度。用于「以某个朝向为基准偏转固定角度」的场景，
 * 可以完全避开 `atan2`——它是本库里唯一没有实现的超越函数，因为压根不需要。
 */
export function drot(x: number, y: number, theta: number): { x: number; y: number } {
  const c = dcos(theta), s = dsin(theta);
  return { x: x * c - y * s, y: x * s + y * c };
}

/** 度 → 弧度。乘法，确定。 */
export const DEG = Math.PI / 180;
