# 无限勇者竞技场 · v1.0 架构文档

> 第一个稳定大版本（v1.0.0）。本文档描述当前线上架构：**Pure Core 纯函数层 + 前后端双通路 + Supabase 云端权威结算**。
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
npm run test           # vitest（17 项）
npm run verify         # 四闸门 + guard + 冒烟 + 集成 + backend（本地全量）
npm run build:core     # 重建 core 单文件产物（--sync 同步到 supabase/_shared）
npm run parity         # 5 种子本地 vs 云端逐 bit 校验
npm run mock:edge      # 本地 mock Edge（127.0.0.1:8787），配合 Remote 模式联调
```

**切换云端模式**：`.env.production` 中 `VITE_USE_LOCAL=false` + Supabase URL/anon key（构建时注入）；本地联调指向 `http://127.0.0.1:8787`（mock）。
