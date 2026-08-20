# PoC 验证报告 · 双通路后端

> 代码：`src/backend/*` + `scripts/backend-poc.ts`
> 运行：`npm run backend`（已并入 `npm run verify` 第五道闸门）

---

## 0. 为什么要写这份 PoC

前面五份文档都在**声称**一件事：

> 因为战斗引擎是确定性的，后端只需下发 `battleSeed + 开局快照 + checksum`，
> 前端跑同一份引擎就能完全复现。

这是整个架构的**承重墙**。如果它不成立，后面的双通路、倒计时、Supabase 全部要推倒重来。
所以在写任何 Edge Function 之前，先用最小代价把这堵墙压一遍。

结论：**墙立住了，但过程中真的塌了两次**（§3），这两次比"全绿"更值得记录。

---

## 1. 跑了什么

```
                    ┌──────────── src/backend/rules.ts ────────────┐
                    │  纯函数：(state, input) => Result<state>       │
                    │  不碰 IO / zustand / Date.now / Math.random   │
                    └──────┬────────────────────────┬───────────────┘
                           │                        │
              LocalBackend │                        │ RemoteBackend（阶段 3）
            （同进程/IndexedDB）                    （Supabase Edge Function）
                           │                        │
                           └────► GameBackend 接口 ◄─┘
                                        │
                                    前端只依赖这个
```

PoC 实现了左半边（`LocalBackend` + `MemoryStore`），并验证 5 组命题。

## 2. 验证结果（21/21 PASS）

| # | 命题 | 结果 |
|---|---|---|
| 1 | 全链路：开局 → 战前计划 → 开战 → 结算 → 商店 | 6/6 PASS |
| 2 | **承重假设**：后端权威算 + 前端本地复现 | 4/4 PASS |
| 3 | 幂等：3 秒倒计时内连点只扣一次钱 | 7/7 PASS |
| 4 | 回放包体积 vs 逐 tick 事件流 | 1/1 PASS |
| 5 | 权威性：客户端拿不到根种子 | 3/3 PASS |

### 2.1 承重假设（最关键的一组）

```
样本         10 局 / 80 场战斗（novice + normal，1–15 层，胜率 69%）
tick 数全等  80 / 80
checksum     80 / 80  bit 级一致
跨实例       同种子在两个独立 LocalBackend 实例上结果一致
后端耗时     均值 12.22ms/场（新手短局 3.3ms，无尽深层 307 tick 约 15.2ms）
```

「跨实例一致」这一条尤其重要：它等价于**"服务端算的 = 玩家手机上放的"**，
也等价于**可复现 = 可申诉、可回放、可反作弊**。

> 这 80 场只证明了**同一个运行时内**可复现。真正的考验是换引擎——
> 见 §6 与 `07_跨引擎浮点一致性.md`，那里踩到了本项目最大的一个坑。

### 2.2 幂等（对应「3 秒倒计时」需求）

模拟玩家在倒计时内狂点 5 次（同一 `idempotencyKey`）：

```
买「粗制法珠」标价 30 → 实扣 30（5 次请求 5 次返回成功）
背包只 +1（0 → 1）
该货位已从商店移除
换幂等键重买已售出商品 → ITEM_GONE   ← 幂等层没吞掉真实校验
换幂等键买另一件      → 86 → 57      ← 新意图确实再次扣费
```

后两条是刻意加的**反向验证**。只测"连点不重复扣费"是不够的——
一个永远返回缓存的坏实现也能过。必须同时证明它**没有**把真实的第二次意图吃掉。

### 2.3 包体积（修正了文档里的虚报数字）

| 层 | 单位数 | 逐 tick 事件流 | replay 包 | 压缩比 |
|---|---|---|---|---|
| 1 | 5 | 24.6 KB | 5.5 KB | 4.5× |
| 2 | 5 | 53.9 KB | 5.6 KB | 9.6× |
| 3 | 6 | 125.6 KB | 6.6 KB | **19.0×** |
| 4 | 5 | 75.6 KB | 5.7 KB | 13.3× |

> 早期文档写的「0.14 KB / 783×」是**只算 seed + checksum、漏算开局快照**的虚报，已修正。

真正重要的是曲线形状而非某个倍数：

- replay 包 = O(units)，**完全不随战斗时长变化**
- 事件流 = O(units × ticks)

所以越到高层差距越大。第 3 层 6 个单位打满就 19×，而 replay 还是 6.6 KB。

---

## 3. 过程中翻的三次车

### ① 快照字段白名单 → 168 vs 144 tick，而胜负一样

第一版 `UnitSnapshot` 手写了 34 个字段的白名单。跑出来：

```
后端结果：win / 144 tick
前端复现：win / 168 tick     ← 胜负一致，肉眼看不出问题
FAIL  校验和 bit 级一致
```

写了逐字段 diff 探针，发现漏了 7 个字段：

| 字段 | 开局真值 | 白名单版本 | 后果 |
|---|---|---|---|
| `skillCd` | `0`（技能就绪） | 误填 `skill.cd` | 全场技能节奏错位 |
| `dmgMult` | `1.06`（遗物） | 写死 `1` | 伤害偏低 |
| `combo` | `3` | 写死 `0` | 连击错位 |
| `heavyBurst` | `1~2` | 写死 `0` | 重击错位 |
| `dupIndex` / `traitStacks` / `traitTimer` | 非 0 | 漏 | 特性偏移 |

**教训**：白名单的问题不是"这次漏了"，而是引擎每加一个字段就会再漏一次，且静默。
改为 `UnitSnapshot = Unit` 全量深拷贝。

### ② 引用共享 → tick 前抓的快照被战斗改写

同一个探针查出：**5/5 单位的 `derived` 对象在战斗中被就地 mutate**。

快照虽然在 tick 之前抓，但 `primary/derived/skill` 是**引用**，
而 JSON 序列化发生在战斗结束之后 —— 前端拿到的是"结束态"冒充"开局态"。

深拷贝一并解决。并且刻意用 **JSON round-trip 而非 `structuredClone`**：

> 远程通路必然经过 JSON 序列化（`undefined` 会消失）。本地通路若用
> `structuredClone` 保留 `undefined`，就会出现"本地测全过、上线就漂"。
> 主动把传输损耗前置到本地，两条通路才真正同构。

### ③ 模块级 id 计数器 → 跨实例 checksum 漂移

`同种子跨后端实例结果一致` 这条一开始是 **FAIL**。

原因：`src/game/engine/unit.ts` 的 `let uid = 0` 是**进程级**的。
新建的 `be2` 虽是全新后端实例，但 `uid` 早被 `be` 跑过的 50 场推到了 250+，
于是同一 seed 在两边生成 `u0..` 和 `u250..`，而 id 进入 checksum → 直接漂。

这坐实了 §4 的 P0-1 不是洁癖，而是**真实会炸的 bug**。已落过渡方案：

```ts
export const resetUid = (n = 0) => { uid = n; };          // unit.ts
export const resetBuildingId = (n = 0) => { bId = n; };   // battle/common.ts
```

调用点收敛进 `rules.buildUnits` / `rules.makeSim`，前后端都不许自己写。

> 讽刺的是 `common.ts` 的原注释已经写了"否则会破坏回放一致性"——
> 作者意识到了风险，但解法只是把计数器拆成两个，仍然是进程级全局。

### ④ 附带修掉一个类型陷阱

`typecheck` 抓到两处报错，根因是 `err()` 的签名：

```ts
// ❌ message 的类型被默认值推断成 ErrCode，传中文说明会编译失败
export const err = <T>(code: ErrCode, message = code): Result<T> => ...

// ✅
export const err = <T>(code: ErrCode, message: string = code): Result<T> => ...
```

这也解释了 PoC 早期日志里 `err=RUN_ENDED RUN_ENDED` 的重复输出。
`code` 给程序判断，`message` 给人看，两者不该是同一种东西。

---

## 4. 一个被误判为 bug 的正确行为

`[3] 幂等` 最初 FAIL，报 `RUN_ENDED`。查下来是**测试设计错了**：
novice 模式打通第 5 层即 `status='won'`，此时买东西返回 `RUN_ENDED` 是**正确**的。

改为先用 novice 通关解锁无尽，再开一局 `normal` 做商店测试。
顺带多验证了一条：**通关新手后自动解锁无尽模式**。

> 记下来是因为：如果当时"顺手把 RUN_ENDED 判断放宽"，就会在结算后
> 留下一个可以继续买东西的漏洞。**测试失败时，先怀疑测试。**

---

## 5. 已固化的回归保护

PoC 已并入 `verify`，成为第五道闸门：

```bash
npm run verify
#  typecheck → check-templates → smoke → integration → backend
```

意味着以后任何人改动引擎/规则，只要破坏了"后端算 = 前端放"这条承重假设，
**CI 立刻红**，而不是等到上线后玩家反馈"结算跟播放对不上"。

---

## 6. PoC 尚未覆盖的（阶段 3 待办）

| 项 | 说明 |
|---|---|
| `RemoteBackend` | 仅文档设计，Edge Function 未实现 |
| 真实 Postgres / RLS | 当前用 `MemoryStore`，未验证 SQL 与乐观锁并发 |
| `upgradeHero` | LocalBackend 里仍是占位，升星规则未抽进 rules |
| 网络异常路径 | 超时/重连/版本漂移的实际表现（设计见 `04_倒计时与时序.md`） |
| 移动端真机 | 桌面 WebKit 已过，但 iOS Safari 未必同版本 JSC，需真机复验 |

### 6.1 已销号：跨运行时一致性 ✅

本报告初版把这条列为"最需要优先做"，理由是：

> 浮点行为在不同 JS 引擎上理论一致（IEEE 754 + ES 规范），
> 但 `Math.hypot` / `Math.pow` 等超越函数的精度实现允许有差异。

**这个担心被证实了，而且比预想的更严重。** 实测不只是跨厂商会漂，
**同一个 V8 的不同大版本也会漂**（Node 22 的 V8 12.4 vs Deno 2.9 的 V8 15.0，
`sin/cos/pow/atan2/exp/log` 六个函数摘要全不同）——
意味着 Supabase 静默升级一次运行时，就能打断全部存量玩家的回放。

处理方式不是"在 Deno 上重跑一遍 PoC 确认没事"，而是**从演算路径上根除这类函数**：

| 措施 | 落点 |
|---|---|
| 新增确定性数学库 `detmath.ts`（只用强制正确舍入的第一档运算重写） | `engine/detmath.ts` + 9 项单测 |
| `dist()`/`len2d()` 用 `sqrt(dx²+dy²)` 替代 `hypot` | `battle/common.ts` |
| `sin/cos/atan2/pow` → `dsin/dcos/drot/dpow/dpowi` | `battle.ts`、`scaling.ts`、`arenas.ts` |
| 静态闸门，headless 三层出现第二档 `Math.*` 或 `**` 即 CI 红 | `scripts/guard-determinism.mjs`（已进 `npm run verify`） |

验证：**五个运行时**（Node 22.13 / Deno 2.9.5 / Chromium 151 / Firefox 153 / WebKit 26.5）
跑同一组基准战斗，36 个 checksum（18 权威 + 18 复现）逐 bit 全等。
完整推演过程、五运行时对照表与性能代价见 **`07_跨引擎浮点一致性.md`**。

复现命令：

```bash
npm run guard                       # 静态闸门
node  node_modules/.cache/xrt.mjs   # Node（V8 12.4）
deno  run --allow-read node_modules/.cache/xrt.mjs   # Deno（V8 15.0，≈Edge Function）
# 浏览器：打开 selfcheck.html，实验组全绿即通过
```
