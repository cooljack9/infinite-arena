# 概览：《无限勇者竞技场》大规模模拟封测

## 做了什么

从 `https://github.com/cooljack9/infinite-arena-dev` 拉取项目（infinite-arena v2.9.12），搭建 headless 封测流水线，驱动**真实 `BattleSim` 引擎**跑了 **10,080 场战斗**（84 组三人阵容 × 30 层 × 4 种子），耗时 35.4 秒，并输出完整反馈报告。

## 技术路径

环境里 npm CLI 不可用（长路径问题），走了这条链路：

```
手写 cbt.ts 封测驱动
  → 用 node fetch 直接从 npm registry 拉 esbuild 0.28.1 + @esbuild/win32-x64
  → esbuild bundle（消除 type-only import，Node 原生 strip-types 搞不定）
  → Node 22 执行 cbt.bundle.mjs
```

关键判断：`engine + content + gen` 三层是 headless-safe 的，不依赖 React / 渲染 / zustand，所以可以直接跑生产战斗内核而非模型近似。

## 核心结论

**工程质量扎实，数值配平有结构性问题。**

| 维度 | 结果 |
|---|---|
| 崩溃 | **0 / 10,080** ✅ |
| 确定性回放违例 | **0** ✅ |
| 性能 | 3.3ms/场，284.7 场/秒 ✅ |
| 难度曲线 | 锯齿断崖，每 5 层一堵墙 🔴 |
| 成长配平 | 玩家输出仅为敌人 38% 🔴 |
| 阵容极差 | 39.2pp（54.2% vs 15.0%） 🟠 |

**三个 P0**

1. **titan Boss 层（n%5=0）胜率 8.1%**，普通层 38.9% —— 每 5 层一次劝退（已对 `scaling.ts` 取证）
2. **玩家线性成长 vs 敌人指数成长** —— 平均推进深度仅 **4.86 层**
3. **L10/L20/L30 三重规则叠加**（titan + vacuum + mutation 撞同层）—— **L30 是 336 场全败**

**三个 P1**

- `h_summoner` 统治版本（+11.0pp，Top20 占 15 席）→ 策略空间会坍缩
- `h_charge` 负收益（−6.9pp，Bottom20 占 14 席）→ 陷阱选项，挨打最狠（敌方输出 3,451 全场最高）
- 双坦阵容全线不可用（23.3%，最低 15.0%）→ 打不死也打不动

**一个待研发确认**：`坚壁 / 大招 / 闪避 / 龙吐息 / 击倒 / 击退` 6 个特性 **零触发**。「大招」若真的从未释放，是 P0 功能 bug；也可能只是日志文案不匹配。

## 重要口径

模拟采用**裸装基线** —— `makeAlly(hero, lvl, [])`，无装备、无天赋、无坐骑、无 build。所以：

- 绝对胜率**不等于**真实玩家体验（真实会更高）
- 阵容/层/英雄之间的**相对对比完全有效**（同一基线）

## 产出

- `无限勇者竞技场_模拟封测反馈报告.md` —— 完整反馈报告（12 节 + 附录，含逐层数据、Top/Bottom 阵容、带代码的调优方案、验收指标）
- `cbt-sim/cbt.ts` / `build.mjs` / `cbt.bundle.mjs` —— 可复跑的封测流水线
- `cbt-sim/cbt-aggregate.json` / `cbt-results.json` —— 原始数据

## 复跑

```bash
cd cbt-sim
node cbt.bundle.mjs --maxLayer 30 --seeds 4     # 全量，35 秒
node cbt.bundle.mjs --maxLayer 30 --seeds 16    # 高精度，2.4 分钟
```

## 后续建议

改完数值后按报告第十一节复跑，重点盯 8 个验收指标，其中**崩溃 0 / 确定性违例 0 必须保持** —— 这是改数值时最容易被意外破坏的两项。
