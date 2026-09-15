// 战斗引擎共享常量与纯函数（从 battle.ts 抽出，供 BattleSim 与各子模块复用）
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ── Boss 分裂参数（美术 §7.2.1）──
// [PLACEHOLDER] 三个数都没经过 playtest。rationale 如下，验证路径见美术 §7.2.1：
// COUNT=2 —— 设计意图是「站位压力」而非「伤害压力」，砍成 1 个就退化成普通小怪；
// HP=50%   —— 低于这个数分身会被 AoE 秒掉，玩家读不到"分裂发生过"；
// DMG=60%  —— 2 个分身合计 120% 本体输出，加上本体是 220%，是明确的威胁升级但不至于秒队。
export const BOSS_CLONE_COUNT = 2;
export const BOSS_CLONE_HP = 0.5;
export const BOSS_CLONE_DMG = 0.6;
export const BOSS_CLONE_DURATION = 8;

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
export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
};

/** 向量长度。同 `dist` 的理由：禁止 `Math.hypot`，见上方注释。 */
export const len2d = (dx: number, dy: number) => Math.sqrt(dx * dx + dy * dy);

// 建筑与建筑产出物的 id 计数器。刻意不复用 unit.ts 的 nextId()——
// 那个计数器由 UI 侧的单位构建驱动，仿真内部再去 ++ 它会让「同一 seed 同一层」
// 的 id 取决于玩家之前打开过几次编队界面，破坏回放一致性。
let bId = 0;
export const nextBuildingId = () => `b${bId++}`;
/** 同 unit.ts 的 resetUid：建筑 id 同样进入校验和，回放前必须对齐起点。 */
export const resetBuildingId = (n = 0) => { bId = n; };
