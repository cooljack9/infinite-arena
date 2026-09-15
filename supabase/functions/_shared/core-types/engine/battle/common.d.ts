export declare const clamp: (v: number, lo: number, hi: number) => number;
export declare const BOSS_CLONE_COUNT = 2;
export declare const BOSS_CLONE_HP = 0.5;
export declare const BOSS_CLONE_DMG = 0.6;
export declare const BOSS_CLONE_DURATION = 8;
/**
 * 两点距离。**刻意不用 `Math.hypot`。**
 *
 * ECMA-262 把 `Math.hypot` 列为 implementation-approximated，允许各引擎有 ULP 级差异；
 * 而 `+ - * /` 与 `Math.sqrt` 被 IEEE 754 要求正确舍入，跨引擎必然逐 bit 相同。
 *
 * 实测（`floatscan.html`，每函数 20000 输入的 bit 级指纹）：
 *   Math.hypot          Chromium f55f4904… / Firefox e468ad8e… / WebKit c71f7ecd…  ← 三者互不相同
 *   sqrt(dx*dx+dy*dy)   三引擎均为 b03249dc…                                        ← 一致
 *
 * 这不是理论洁癖：换用 hypot 时，18 场基准战斗里第 18 场在三引擎上分别跑出
 * 621 / 607 / 651 tick——服务端结算与玩家看到的过程会对不上。
 *
 * 溢出风险不存在：坐标是格子数（0–40 量级），dx*dx 最大约 1600，
 * 离 double 上限还差 300 个数量级。详见 docs/backend/07_跨引擎浮点一致性.md
 */
export declare const dist: (a: {
    x: number;
    y: number;
}, b: {
    x: number;
    y: number;
}) => number;
/** 向量长度。同 `dist` 的理由：禁止 `Math.hypot`，见上方注释。 */
export declare const len2d: (dx: number, dy: number) => number;
export declare const nextBuildingId: () => string;
/** 同 unit.ts 的 resetUid：建筑 id 同样进入校验和，回放前必须对齐起点。 */
export declare const resetBuildingId: (n?: number) => void;
