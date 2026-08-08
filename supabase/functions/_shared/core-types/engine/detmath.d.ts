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
/** 确定性 sin。跨引擎逐 bit 一致；与 `Math.sin` 的偏差 ≤ ~1 ULP。 */
export declare function dsin(x: number): number;
/** 确定性 cos。跨引擎逐 bit 一致；与 `Math.cos` 的偏差 ≤ ~1 ULP。 */
export declare function dcos(x: number): number;
/** 整数次幂：平方求幂，只用乘除，天然确定。 */
export declare function dpowi(base: number, n: number): number;
/**
 * 确定性 pow。**演算路径上必须用它替代 `Math.pow`。**
 *
 * 常见指数走精确快路（0/1/2/±0.5/整数），其余走 e^(y·ln x)。
 * 快路的意义不只是性能：`y === 0.5 → Math.sqrt` 由 IEEE 754 正确舍入，
 * 结果与绝大多数引擎的 `Math.pow(x, 0.5)` 完全相同，因此把默认配置
 * （`enemyScale` 的 expHp/expDmg = 0.5）的数值平衡原样保下来了。
 */
export declare function dpow(x: number, y: number): number;
/**
 * 把单位向量 (x, y) 旋转 θ 弧度。用于「以某个朝向为基准偏转固定角度」的场景，
 * 可以完全避开 `atan2`——它是本库里唯一没有实现的超越函数，因为压根不需要。
 */
export declare function drot(x: number, y: number, theta: number): {
    x: number;
    y: number;
};
/** 度 → 弧度。乘法，确定。 */
export declare const DEG: number;
