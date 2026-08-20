# 无限勇者竞技场 · v2.0.0 架构文档

> 当前维护版本 **v2.0.0**（全仓单一版本基线：`package.json` / `CORE_VERSION` / 全部文档共用同一个号，详见 INDEX.md「版本体系」）。本文档描述当前线上架构：**Pure Core 纯函数层 + 前后端双通路 + Supabase 云端权威结算**。
> 配套文档：[CICD.md](./CICD.md)（CI/CD 与数据库部署维护）。

---

## 1. 架构总览

```
┌─────────────────────────── 浏览器 ───────────────────────────┐
│                                                              │
│  React UI（screens/*）                                       │
│    └─ Zustand store（game/state/slices/*）                   │
│         ├─ Local 模式：store 直改本地状态（纯前端，可离线）     │
│         └─ Remote 模式：store → storeBridge → GameBackend    │
│                              │                               │
└──────────────────────────────┼───────────────────────────────┘
                               │ fetch（POST JSON）
                    ┌──────────▼──────────┐        ┌─────────────┐
                    │  Supabase Edge      │        │  mock-edge  │
                    │  Function `game`    │◄───────│  (本地联调)  │
                    │  (Deno + supabase-js)│        └─────────────┘
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Postgres（runs /   │
                    │  battles / profiles │
                    │  / idempotency_keys │
                    │  + RLS + 物化视图    │
                    └─────────────────────┘
```

**核心思想：`packages/core` 是唯一真理来源。** LocalBackend 与 Edge Function 调用的是**同一份** rules 纯函数——只要输入相同，浏览器 / Deno / Node 必然得到完全一致的结果（parity 逐 bit 校验保证）。

## 2. 分层

| 层 | 位置 | 职责 | 纪律 |
|---|---|---|---|
| **contract** | `packages/core/src/contract` | 快照类型（RunSnapshot/MetaSnapshot）、Result、ErrCode、GameBackend 接口 | 零依赖 |
| **engine** | `packages/core/src/engine` | rng / 属性公式 / 难度缩放 / 战斗模拟（BattleSim） | 确定性，无 Math.random 污染权威流 |
| **content** | `packages/core/src/content` | 职业 / 技能 / 英雄 / 装备 / 遗物 / 竞技场 / 商店 | 纯数据 + 纯函数 |
| **gen** | `packages/core/src/gen` | 程序化关卡生成（levelGen / formation） | 种子驱动 |
| **rules** | `packages/core/src/rules` | **命令规则层**：createRun / startBattle / buyItem / upgradeHero / reforgeItem … | `(state, input) => Result<state>`，不碰 IO |
| **storeBridge** | `src/backend/storeBridge.ts` | applySnapshot（快照→store 映射）/ remoteWrite（云端写执行器）/ isRemoteMode | Remote 模式唯一入口 |
| **backend** | `src/backend/LocalBackend.ts` / `RemoteBackend.ts` | GameBackend 两个实现 | 契约一致 |
| **UI** | `src/screens/*` | 页面与动画 | 不直接算权威数值（Remote） |

## 3. 双通路（Local / Remote）

- **Local（`VITE_USE_LOCAL=true`，默认）**：store 直改本地状态，`packages/core/dist/index.js` 作为本地引擎。零后端可玩，单机演示 / 离线 / 测试。
- **Remote（`VITE_USE_LOCAL=false`）**：store action → `storeBridge.remoteWrite` → Edge Function → 权威快照 `applySnapshot` 全量同步 store。**云端是唯一真相**，防作弊、支持排行榜。

### 3.1 快照驱动
`RunSnapshot` 涵盖全部局内状态（run 域 + economy 域 + receipts）。任何云端操作返回新快照，前端整体替换——不会分叉。

### 3.2 renderSeed 解耦
快照中的 `renderSeed` 与权威根种子**完全解耦**（云端覆写为独立随机）。前端所有 genLayer / 战斗观感渲染读 `run.seed`（= renderSeed），代码零改动；权威结算用服务端种子，玩家无法反推/作弊。

### 3.3 幂等与乐观锁
- 每个写请求带 `idempotencyKey`（storeBridge 生成，对局内单调）→ 云端 `idempotency_keys` 表去重，网络重试不会重复结算。
- 云端写回用**乐观锁**：`saveRun` 检查 `version` 匹配才更新（`version+1`），多标签页并发写只成功一个（其余 `STATE_STALE`）。
- **批量命令**（openDrops）单次写全开，避免并发乐观锁互踩；buyAllShop 云端串行逐件确认。

### 3.4 鉴权（匿名登录）
- 项目开启 GoTrue 匿名登录（`external_anonymous_users_enabled=true`），`runs.user_id` 外键 → `auth.users`。
- `RemoteBackend.ensureSession()`：首次请求自动 `POST /auth/v1/signup`（匿名）拿 JWT → 缓存 localStorage（`arena.sb.session`）→ 后续带用户身份；401 自动失效重建。
- 写操作无有效用户 → `401 UNAUTHORIZED` 正确拒绝。

### 3.5 乐观 UI（v3.2/3.3）
- **零成本操作**（穿戴/卸载/购买/商店刷新）本地立即生效 + 云端后台确认（最终一致）。
- **有资源消耗且需展示结果**（升星/重铸/融合/招募）→ 3s 动画缓冲 + 全局交互锁（`fxBusy` 悬浮遮罩），掩盖云端往返延迟。
- 开战/出征：全屏台词/三段过场掩盖 startBattle / startRun 传参。

## 4. GameBackend 命令清单（v1.0 全部已部署验证）

| 类别 | 命令 | 说明 |
|---|---|---|
| 查询 | queryMeta / queryRun / queryBattlePlan | 账号元数据 / 对局 / 战斗计划 |
| 开局 | startRun / abandonRun | 种子服务端生成；弃局 |
| 层推进 | skipLayer / advanceLayer | 跳层（需 bestLayer）/ 层内推进 |
| 战斗 | startBattle / ackBattle | 权威结算 + 回放；客户端确认 |
| 商店 | buyItem / sellItem / refreshShop | 含批量（buyAllShop = 串行确认） |
| 招募 | recruit / refreshRecruit | 英雄副本招募 |
| 英雄 | upgradeHero | 升星：主属性+10%、随机2×5%、随机2×3%（可含主属性），封顶5★ |
| 装备 | openDrop / openDrops / reforgeItem / equipItem / unequipItem | 单开/批量开箱；白装重铸→随机彩色（每层1次）；穿戴 |
| 内部 | `__parityBattle` | 校验用（checksum 与本地引擎对照） |

**云端暂无命令**（Remote 模式禁用，防状态分叉）：forge（旧锻造）/ fuse（合成）/ transferForge / useConsumable / resolveRandomEvent / rerollMount / sellHero。Local 模式保留。

## 5. 核心数值规则（v1.0 已实现）

- **升星**：星级+1（封顶5★）；主属性+10%、随机2属性+5%、随机2属性+3%（可含主属性）；确定性种子 `hash(runId:uid:star)`；累积进 `bonusPct`。
- **重铸**：白色装备 → 随机蓝/橙/红（1/3 均匀）；每层限1次（`reforgedThisLayer`，层推进重置）；保留原装备 id。
- **商店折扣**：`discount = clamp(tradeCount×0.025, 0, 0.5)`；买价 `base×(1−折扣)`，卖价 `base×0.5×(1−折扣×0.5)`。
- **战斗**：BattleSim 全确定性（同 seed 逐 bit 一致）；`enemyScale` 线性→平方根边际递减；Boss 层每 10 层（titan / colossal）。

## 6. 目录结构（v1.0）

```
infinite-arena/
  packages/core/          纯函数核心（contract/engine/content/gen/rules）
    dist/index.js         build-core.mjs 单文件 ESM 产物（浏览器/Deno 双端同字节）
  src/
    arena.config.ts       环境配置（useLocalComputation / supabaseUrl / anonKey）
    backend/              LocalBackend / RemoteBackend / storeBridge / index（getBackend 工厂）
    game/state/           Zustand store（slices: run/economy/meta）
    game/engine|content|gen  旧版目录（与 core 同步的宿主侧实现，逐步收敛到 core）
    screens/              页面（MainMenu/TeamBuilder/PreBattle/BattleScreen/Intermission/…）
    render/               Canvas 渲染（sprites/ArenaCanvas）
  supabase/
    migrations/           0001_schema ~ 0004_security_hardening
    functions/game/       Edge Function（index.ts 路由 + _shared/db.ts + ports.deno.ts + core.js）
  scripts/                build-core / verify-parity / mock-edge / guard / e2e / smoke / integration
  docs/                   本文档 + CICD.md
```

## 7. 本地开发

```bash
npm install
npm run dev            # Vite 开发服务器（默认 Local 模式）
npm run typecheck      # tsc --noEmit
npm run guard          # 确定性闸门（扫 packages/core/src 禁不确定运算）
npm run smoke          # 战斗引擎冒烟
npm run integration    # 全流程集成
npm run backend        # LocalBackend/RemoteBackend 契约测试（21 项）
npm run test           # vitest（77 项 / 7 文件，含 parity 10/10）
npm run verify         # 四闸门 + guard + 冒烟 + 集成 + backend（本地全量）
npm run build:core     # 重建 core 单文件产物（--sync 同步到 supabase/_shared）
npm run parity         # 5 种子本地 vs 云端逐 bit 校验
npm run mock:edge      # 本地 mock Edge（127.0.0.1:8787），配合 Remote 模式联调
```

**切换云端模式**：`.env.production` 中 `VITE_USE_LOCAL=false` + Supabase URL/anon key（构建时注入）；本地联调指向 `http://127.0.0.1:8787`（mock）。

---

## 8. 前端 UX 层与组件（v2.0.0）

UI 层（`src/screens/*`、`src/components/*`）在 v2.0.0 叠加了一套「教学 + 帮助 + 图鉴 + 战场角标」体系，把原本只在新手模式出现的引导扩展到**全模式可查**，并补齐封测反馈（v2.9.12）点名的「高阶机制无解释 / 内容不可见」缺口。本节的完整改动清单与上线闸门见 §9。

### 8.1 教学与帮助系统
- **TutorialOverlay（教学云朵浮层）**：`src/screens/TutorialOverlay.tsx` + `packages/core/src/content/tutorial.ts`。
  - 云朵对话框锚定到界面真实 DOM（`id="tut-*"`），画箭头指向被讲元素；**仅新手模式触发**。
  - **v2.0.0 修复（蘑菇云按钮点不到）**：旧版用写死 `BUBBLE_H=132` 求顶边，长文案教学点实际更高会把「下一步」挤出屏底。改为**渲染后测量真实高度（`cloudRef.offsetHeight`）重算顶边** + `.tut-cloud` 加 `max-height/overflow` 限高滚动；并新增「关闭」+「下一步」双按钮 + 右上角 ✕，按钮永不被挤出屏。
  - 新增 `tut-dont`（「不再显示教学」勾选 → 写 `localStorage`）；主菜单「重置教学」可恢复。
- **HelpButton + MechanismHelp（全模式「?」说明）**：`src/components/HelpButton.tsx`、`src/components/MechanismHelp.tsx`。
  - 复用 `.tut-cloud` 视觉与真实高度测量，**不依赖新手模式**，任何模式都可点「?」看云朵说明。
  - 已挂接：PreBattle（真空期 / 突变层 / 当前遗物 / 增益三选一 / 随机奇遇）、IntermissionHub（下五层 / 自动爬塔）。
- **新手战役延长**：`packages/core/src/engine/scaling.ts` 的 `NOVICE_CAP` 由 `5` → `10`，`packages/core/src/content/tutorial.ts` 教学组扩至 **10 组 / 23 个教学点（覆盖层 1–10）**，补齐 真空 / 突变 / 遗物 / 增益三选一 / 随机奇遇 / 下五层 / 自动爬塔 / 冲刺通关 等高阶机制的现场教学（真空 / 突变在第 10 层现场演示，因二者本就在 `n%10` 触发）。

### 8.2 图鉴 Codex
- `src/screens/Codex.tsx`：游戏内收集图鉴模态（英雄 / 职业 / 特性 / 遗物 / 增益 五分区 + 各分区总数 + 本局在队 ★ 标记）。
- 主菜单入口（`MainMenu`）新增「图鉴」按钮 + 「重置教学」开关；解决封测反馈中「6 特性零触发 + 无图鉴 → 内容不可见、硬核期待落空」。

### 8.3 战场体型 / 性别角标（色盲双通道）
- `src/screens/BattleScreen.tsx`：每上场勇者技能条角标显示 体型（中文：极瘦 / 瘦 / 标准 / 壮 / 魁梧 / 巨兽）+ 性别（♀ / ♂），图标 + 文字双通道，色盲可辨。

### 8.4 休整屏减负（UX-4）
- `src/screens/intermission/IntermissionHub.tsx`：药剂 / 招募 等「可选」操作收进 `<details>` 折叠区（移动端默认收起）；前进按钮（下一层 / 下五层 / 自动爬塔 / 放弃）抽成**常驻底部行动栏（sticky）**，保留全部 `tut-*` 锚点。

### 8.5 共享 UI 令牌（UX-9 三屏统一）
- `src/index.css` 新增：`.help-btn`（统一「?」按钮）、`.unit-tag`（体型 / 性别角标）、`.section-title` / `.action-bar` / `.collapsible`（休整屏 / 主菜单复用）。

## 9. 本次 UX 优化改动清单（v2.0.0 追加：UX-4~UX-9 全量落地）

来源：全类型用户深度测试调研（仓库外交付 `全类型用户深度测试调研报告.md`，附录 C 含逐项映射）。

| 文件 | 类型 | 改动 | 触及 `packages/core` | CI/CD 影响 |
|---|---|---|---|---|
| `packages/core/src/engine/scaling.ts` | 改 | `NOVICE_CAP` 5→10（新手战役延长） | ✅ | **是**：core 改动，上线须 `build:core --sync` + 部署 Edge + parity |
| `packages/core/src/content/tutorial.ts` | 改 | 教学组 6→10、教学点扩至 23（覆盖层 1–10 全机制） | ✅ | **是**：同上 |
| `src/screens/TutorialOverlay.tsx` | 重写 | 测真实高度修蘑菇云按钮 + 关闭 / 下一步双按钮 + 跳过 | — | 否（仅前端，走普通 CI 闸门） |
| `src/components/HelpButton.tsx` | 新增 | 统一「?」说明按钮 | — | 否 |
| `src/components/MechanismHelp.tsx` | 新增 | 全模式可触发说明云（复用 `.tut-cloud`） | — | 否 |
| `src/screens/PreBattle.tsx` | 改 | 真空 / 突变 / 遗物 / 三选一 / 奇遇 挂「?」+ 锚点 + MechanismHelp | — | 否 |
| `src/screens/intermission/IntermissionHub.tsx` | 改 | 可选区折叠 + sticky 行动栏 + 下五层 / 爬塔「?」 | — | 否 |
| `src/screens/BattleScreen.tsx` | 改 | 体型 / 性别角标（色盲双通道） | — | 否 |
| `src/screens/MainMenu.tsx` | 改 | 图鉴入口 + 重置教学开关 | — | 否 |
| `src/screens/Codex.tsx` | 新增 | 游戏内收集图鉴 | — | 否 |
| `src/index.css` | 改 | 新增 `.help-btn/.unit-tag/.section-title/.action-bar/.collapsible` + tut-* 限高 | — | 否 |

### 9.1 验证结果（v2.0.0 本次改动）
- `tsc --noEmit` ✅ 零类型错误；
- `vite build` ✅（127 模块，无错误）；
- `vitest` **77/77 通过**（含 `test/parity.test.ts` 前后端逐 bit 一致性 10 项 → 证明 `packages/core` 改动**未破坏战斗回放校验和**）；
- `npm run guard`（确定性闸门）通过：纯数据 / 常量改动，未引入不确定运算。

### 9.2 ⚠️ 上线闸门（核心改动必读）
- **本次改动触及 `packages/core/**`（scaling.ts、tutorial.ts），属于 CICD.md §2「Verify core sync / 云端 parity 闸门」的触发条件**：本地前端构建虽已验证通过，但 `tutorial.ts` 纯数据、`scaling.ts` 仅改常量，**不改变战斗回放 checksum**（已 vitest parity 10/10 验证），故 **Local 模式零影响**；**一旦走 Remote 模式 / 线上发版，必须按 CICD.md §B3.5（或触发 `deploy-supabase.yml`）执行 `npm run build:core --sync` → 部署 Edge Function → `node scripts/verify-parity.mjs` 5/5 一致，否则前后端引擎漂移**（详见 CICD.md §9「1.9.0 事故」）。
- `ci.yml` 的 `node scripts/build-core.mjs --check`（Verify core sync）**只校验不部署**；漏部署仍会漂移，线上发版不可省 B3.5。

### 9.3 v2.9.x 面包车特殊关 + 箭塔定位确认（Phase C）

来源：用户需求「面包车特殊关 + 动画加强 + 特性特效 + 箭塔重写 + 巢穴动画 + 运算轻量化」。
本次交付范围：**车队关 + 箭塔定位确认**（渲染加强 / 特性特效 / 巢穴动画 / 运算轻量化留待下一轮）。
核心同步闸门：**触发**（见下方「触及 core」列 + 9.2 同款 B3.5 流程），`CORE_VERSION` 统一收敛为 **`2.0.0`**（v2.0.0 单一版本基线；RNG 路径变更叠加号段回退，旧 replay 一律不可复用）。

| 文件 | 类型 | 改动 | 触及 `packages/core` | CI/CD 影响 |
|---|---|---|---|---|
| `packages/core/src/gen/levelGen.ts` | 改 | 特殊关由「数组长度均分」改为显式权表（DRAGON/CAGE/VAN 各 7%、普通 79%）；层 ≥3 才出特殊关；新增 `rollVanEncounter`（车 4~8 × 人 4~10，向 `peopleTotalBand` 28~48 收敛，独立区间方差从 5× 压到 1.7×）；VAN 层只放车队波次、不放建筑 | ✅ | **是**：RNG 消费顺序变了，旧 replay 漂移 |
| `packages/core/src/content/enemies.ts` | 改 | 新增 `e_van` / `e_van_person` 定义；`VAN_CFG`（`peopleTotalBand`/`concurrentPeopleCap`/`openingBuffSec` 等）；`ENEMIES_BY_CAT` 排除 van 专用 id（修了一处池污染 bug：van 之前会漏进普通波次且悄悄改变 `pick()` 池长，破坏种子可复现） | ✅ | **是**：生成规则变了 |
| `packages/core/src/engine/battle.ts` | 改 | 车队脚本引擎核心：`van_ram` 撞击 + 击退（`vanKnockback` 抗性规则镜像分离推力）+ 开场 10s 移速翻倍（乘在速度项而非属性，因 `moveSpeed` 被 clamp 到 [0,80]，乘属性只变 17%）、撞击伤害 ≈ pDmg×移速；`tickVanConvoy` 逐人下落（state-on-unit，死车不再下人）；`setVanEncounter` 装配钩子；`makeSim` 的 `resetBuildingId(0)` 从 `if(buildings)` 内**挪到无条件**（修出一个存量 parity bug：车队关无建筑 → b* id 计数器跨场泄漏 → 前后端 checksum 分叉但胜负一致） | ✅ | **是**：引擎数学 + id 分配路径都动了 |
| `packages/core/src/types.ts` | 改 | `MonsterKind` 加 `'van_person'`；`VanEncounter` 接口加 `dropInterval`/`concurrentPeopleCap`；`BuildingDef` 删除从未被消费的 `traits?: TraitId[]` 字段，改注释明确「建筑产兵结构保证无特性」 | ✅ | **是**：类型即契约 |
| `src/render/sprite-templates.ts` | 改 | 新增 `van_person` 20×20 像素模板 + `MONSTER_PALETTE` 配色（独立皮，避免「下人」读作车裂开） | — | 否（仅前端渲染） |
| `packages/core/src/rules/index.ts` | 改 | `SimInput`/`SettleResult` 加 `vanEncounter?`；`makeSim` 调用 `setVanEncounter`（spawnBuildings 之后）；6 处 `makeSim` 调用点传 `vanEncounter`；`resetBuildingId(0)` 无条件化（见上） | ✅ | **是**：parity 命门 |
| `packages/core/src/contract/index.ts` | 改 | `BattleResultDTO.replay` 加 `vanEncounter?`（防 replay 漂移）；`CORE_VERSION` → `2.0.0` | ✅ | **是**：契约 + 版本号 |
| `src/backend/LocalBackend.ts` | 改 | replay 装配补 `vanEncounter: r.vanEncounter` | — | 否（仅前端，但漏配会静默降级成静止面包车） |
| `src/game/battleBuild.ts` | 改 | 本地模式装配由手写 `new BattleSim` 改为**统一走 `makeSim`**（修第二份装配代码漂移；玩家看到的 sim 与判胜负的 sim 此前可能不一致——"看着赢了却判输"的根因） | — | 否（仅前端） |
| `packages/core/src/content/buildings.ts` | 改 | **箭塔（读法 A）**：现状已满足「低伤/低血/无特性/无意义」，数值不动；三座塔 `threat` 文案改为「可绕开，非核心威胁」，顶部注释写明塔的设计定位就是路边骚扰 | ✅ | 否（仅文案/注释，不进 checksum；但属 core，发版仍随包同步即可） |
| `test/van-roll.test.ts` | 新增 | 17 项：权重漂移 / 边界泄漏 / 编成方差收敛 / 池污染 四类，验证 levelGen 车队抽取 | — | 否（测试） |
| `test/parity.test.ts` | 改 | `runAt` 修复（原误用 `advanceLayer` 只 `version+1` 不推层，5 个用例其实全在第 1 层 → 假覆盖）；`packReplay` 抽成函数保证契约字段集一致；**新增车队关专项 parity**（抽到真落在 VAN 的 seed + 「漏配 vanEncounter → checksum 必变」负向用例 + 「真的下人了」断言） | — | 否（测试） |

### 9.4 验证结果（v2.9.x Phase C）
- `tsc --noEmit` ✅ 零类型错误；
- `vitest` **77/77 通过**（原 73 + 新增 4 车队 parity 用例；parity 由 6/6 → 10/10，含「漏配 vanEncounter 必漂移」负向断言）；
- 本次 parity 实测抓到一个**存量 bug**：`resetBuildingId` 原被关在 `if(buildings.length)` 内，车队关（无建筑）面包人 id 跨场泄漏，前后端 checksum 分叉但胜负一致——已修（见 §9.3 battle.ts / rules/index.ts 行）。
- `CORE_VERSION` 已统一为 `2.0.0`，旧号 replay 前端会提示刷新（预期行为，非异常）。

### 9.5 ⚠️ 上线闸门（v2.9.x Phase C 核心改动必读）
- **本次触及 `packages/core/**`（levelGen / enemies / battle / types / rules / contract）且 RNG 路径与引擎数学均变更** → 属 CICD.md §2 / §B3.5 的强触发条件。**Local 模式**：前端与 `LocalBackend` 同进程同字节，已 parity 10/10 验证可跑；**Remote 模式 / 线上发版**：必须 `npm run build:core --sync` → 部署 Edge Function → `node scripts/verify-parity.mjs` **5/5** 一致，否则旧客户端 replay 漂移。
- `build:core --check` 只校验不部署，漏部署 = 线上漂移，不可省 B3.5。
- 箭塔改动（buildings.ts）只动文案/注释，不进 checksum，但随 core 包一起同步即可，不必单独升号。

### 9.6 v2.9.x 渲染加强 + 引擎轻量化（Phase C · 第二轮）

来源：用户需求②「战斗动画效果加强 + 运算减少 + 特效与实际范围对齐 + 降光污染 + 地形改变细致」、③「特性战斗中设置合理特效」、⑤「巢穴兵营动画优化」、⑥「重击/轻击/大招运算逻辑轻量化」。表现优先级：**稳帧 + 克制（移动端中端，稳定 60fps）**。

**核心事实（决定本轮回馈能否动 parity）**：`BattleSim.effects` 是**纯渲染旁路**——`traceLine`（parity 校验和）只抓单位坐标/hp/alive，**不抓 `effects` 数组**。所以「增删/收敛特效 emit」不进 checksum，**天然 parity-safe**。但 `battle.ts`/`skills.ts` 仍属 `packages/core/**`，core 同步闸门程序上仍触发（见 9.7）。

**刻意不动的部分（防 parity 漂移）**：战斗数学——`attackInterval`/`rollHeavy`/`lightInterval`/`heavyLockDuration`/`finishAttackRhythm`、击退、伤害结算——全部**未改**。需求⑥「运算轻量化」通过「少分配/少绘制 VFX 对象」实现（effect 上限 + 半径减半 + 堆叠 emit 收敛），而非改战斗公式。这是有意为之：任何改 `u.cd`/`u.combo`/`u.hp` 的逻辑都走 checksum，会破 parity。

| 文件 | 类型 | 改动 | 触及 `packages/core` | CI/CD 影响 |
|---|---|---|---|---|
| `packages/core/src/engine/battle.ts` | 改 | **引擎轻量化 + 特效克制**：① `emit()` 加 `MAX_EFFECTS=64` 硬上限（超出丢弃最旧，防光污染/掉帧尖峰）；② `ultBurst` 由 4 个 effect（nova+shock+quake+ring）→ 2 个（nova+shock），删冗余余波/回吸；③ `ultRadial` 环形阵列 `n` 上限 4（原 6~8 满屏刀阵）；④ 新增 `TRAIT_VFX` 映射 + 在 `applyDamage`/`traitOnHit` 挂特性触发小特效（lethal/shackle/volley/heart/spacetime 等）；⑤ 面包车**开门**瞬间 emit（第一人下车画车门光+光圈）；⑥ 建筑产兵**预警环**（在单位拔出处额外在建筑物本体点一圈） | ✅ | 程序触发 core 同步；但**不进 checksum、不改战斗数学**，verify-parity 5/5 仍过 |
| `packages/core/src/content/skills.ts` | 改 | **特效与实际范围对齐**：`VFX_SCALE` 1.85 → **1.0**。原 1.85× 是「光污染 + 特效不贴合判定」根因（视觉半径 ≈ 实际 2.4×，玩家学到错误安全距离）；回落到 1.0 后视觉半径 = `castRange × sizeMul`，`sizeMul`(0.9~1.5) 是有意的签名强调而非任意膨胀 | ✅ | 纯常量，不进 checksum，Local 零影响 |
| `src/render/frame.ts` | 改 | **稳帧**：背景粒子预算 `makeParticles(46)` → **28**；`VFX_SCALE` 消费（半径减半） | — | 否（仅前端渲染） |
| `src/render/ArenaCanvas.tsx` | 改 | 同上，粒子预算 46 → 28 | — | 否（仅前端渲染） |

**未做（已在第三轮收尾，见 §9.8）**：
- 面包人/召唤物**出生 easing**（视觉 scale-in）：第三轮改为**纯渲染侧**实现（检测 `sim.units` 中新增 id 驱动 0→1 弹出，不写 sim 状态），无需契约改动，parity 天然安全。
- 巢穴（龙巢）产兵动画：第三轮在 `spawnFromBuilding` 给 `dragon_nest` 加专属 nova pop、`dragon_lair` 成年龙破壳 quake，纯 emit 不进 checksum。

### 9.7 验证结果（v2.9.x Phase C · 第二轮）
- `tsc --noEmit` ✅ 零类型错误；
- `vitest` **77/77 通过**（parity 10/10 不变 —— 证明 effects 收敛零回归；`CORE_VERSION` 保持 `2.0.0`，未升号）；
- `vite build` ✅（127 模块，无错误）；
- **关键结论**：本轮回馈全部是「渲染旁路 / 常量」，未动战斗数学、未动 replay 契约字段 → 不触发 `CORE_VERSION` 升号，verify-parity 5/5 天然通过。core 同步闸门仍按程序走一遍（`build:core --sync` + 部署 + 5/5），但预期全绿，无旧客户端 replay 漂移风险。

### 9.8 v2.9.x 出生 easing + 龙巢动画收尾（Phase C · 第三轮）

来源：闭合 §9.6 两条 deferred。表现优先级不变（稳帧 + 克制）。

**核心事实（与 §9.6 同源）**：出生 easing 与龙巢特效都落在 `effects`（纯渲染旁路）或 `frame.ts`（纯渲染），**不进 `traceLine` 校验和** → parity-safe，不改 `CORE_VERSION`。

| 文件 | 类型 | 改动 | 触及 `packages/core` | CI/CD 影响 |
|---|---|---|---|---|
| `src/render/frame.ts` | 改 | **出生 easing**：模块级 `birthStart: Map<id, t>` + `birthScale(id,t)`（0.18s ease-out quad）；`drawUnit` 整体包裹 `ctx.scale(0→1)` 弹出，尸体提前 return 前/函数尾各防御性 `restore`；`drawScene` 每帧收集存活 id、`birthStart` 清理离场单位防长局内存泄漏。纯渲染，零 sim 写入 | — | 否（仅前端渲染） |
| `packages/core/src/engine/battle.ts` | 改 | **龙巢/龙穴产兵动画**：`spawnFromBuilding` 在通用预警环之上，按 `buildingKind` 追加专属 effect——`dragon_nest` 孵蛋 nova（nest accent）、`dragon_lair` 且 idx===0 成年龙破壳 quake（lair accent）。纯 `emit`，不写单位状态 → 不进 checksum | ✅ | 程序触发 core 同步；不进 checksum、不改战斗数学，verify-parity 5/5 仍过 |

**验证（第三轮）**：`tsc --noEmit` ✅；`vitest` **77/77**（parity 10/10 不变）；`vite build` ✅。六项系统需求（①面包车特殊关 ②动画加强+运算减少+特效贴合+降光污染+地形细致 ③特性战斗中特效 ④箭塔重写 ⑤巢穴兵营动画 ⑥重击/轻击/大招轻量化）全部闭合。

**交付**：完整工程压缩包（源码 + docs 全文档，排除 node_modules/dist）按 CI-CD 规范 §9.5 上传**微云** `pagea/` 目录，为唯一发布源。

