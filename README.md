# 无限勇者竞技场（Infinite Champion Arena）· v2.4.2

第一个稳定大版本。三人起队、七人满编，挑战无尽竞技场层。**前后端双通路架构**：可纯前端离线试玩，也可切云端（Supabase Edge Function 权威结算）。

> **版本体系（v2.0.0 起 · 单一版本基线）**：全仓只保留**唯一版本号 `2.0.0`** —— `package.json`、`CORE_VERSION`、git tag、压缩包、线上 Pages、全部文档共用同一个号。
> 原四套编号（`v1.9.0` 本地版线 / `v3.1.0` 后端线 / `4.0.0` 包版本线 / `4.2.0-van` 回放契约线）**已一次性作废**。
> ⚠ **破坏性**：`CORE_VERSION` 由 `4.2.0-van` 改为 `2.0.0`（号段回退），**旧 replay 与旧存档一律不可复用**，上线需清库或强制客户端刷新。

- 玩法参考：角斗士公会经理 · 挑战杯模式 + Roguelike 无尽模式
- 技术：Vite 5 + React 18 + TypeScript + Canvas 2D + **Pure Core 纯函数核心**（浏览器 / Deno 双端同字节）
- 云端：Supabase（Postgres + Edge Function + 匿名登录）
- 线上试玩：https://cooljack9.github.io/infinite-arena/

## 背景故事

万古之前，曦光联邦的贤者铸成「无限勇者竞技场」——一座自我演化的试炼之环，用以筛选能直面「虚空侵蚀」的英杰。每一层都由场域意志重新捏塑，越深法则越稀薄。玩家召集三名挚友踏入此门，至多扩至七人满编，向无尽层发起冲击。

- **主菜单「背景故事」**：查看完整世界观。
- **Boss 层（每 10 层）**：进入前显示该层 Boss 的台词。
- **通关 Demo（第 30 层胜利）**：解锁尾声剧情。

## 双通路架构（一句话）

**`packages/core` 是唯一真理来源**——LocalBackend 与云端 Edge Function 调用同一份 rules 纯函数，同输入必同输出（parity 逐 bit 校验）。前端默认本地算（零后端可玩），切云端 = 改一个环境变量重建。

| 模式 | 开关 | 行为 |
|---|---|---|
| **Local**（默认） | `VITE_USE_LOCAL=true` | store 直改本地状态，`core/dist` 本地引擎，可离线 |
| **Remote** | `VITE_USE_LOCAL=false` | 所有写操作 → Edge Function → 权威快照全量同步（防作弊、支持排行榜） |

详见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)（架构）与 [docs/CICD.md](./docs/CICD.md)（CI/CD + 数据库部署维护）。

## 本地运行

```bash
npm install
npm run dev          # 开发服务器（默认 Local 模式）
npm run verify       # 全量质量闸门（typecheck + check-templates + guard + smoke + integration + backend）
npm run build        # 产出静态文件到 dist/
npm run mock:edge    # 本地 mock 云端 Edge（Remote 模式联调用）
```

常用命令：`typecheck` / `guard`（确定性闸门）/ `smoke` / `integration` / `backend`（21 项契约测试）/ `test`（vitest 77，含 parity 10/10）/ `parity`（5 种子本地 vs 云端逐 bit 校验）/ `build:core`（重建核心产物）。

## 核心玩法（v1.0 已实现）

- **开局**：新手模式发教学装备包；普通/铁人无尽需解锁。出征台词 + 开战三段过场掩盖传参。
- **装备循环**：胜利掉落宝箱（单开/全开齐开动画）→ 穿戴（乐观即时）→ 商店买/售（购买乐观入库）；折扣随交易次数加深。
- **锻造工坊**：属性转移（素材词条按概率转移）、**白色装备重铸 → 随机彩色（蓝/橙/红，每层 1 次）**、合成升阶（2蓝→1橙 / 2橙→1红）、融合升星。
- **英雄养成**：招募（贺词动画）、升星（主属性+10%、随机 2×5% + 2×3%，封顶 5★）、突破。
- **战斗**：自动战斗 + 手动技能，BattleSim 全确定性；胜利/失败中央横幅 2s；战报屏（MVP + 成长）。
- **层推进**：每层结束休整（开箱/商店/招募/锻造）→ 下一层，Boss 每 10 层。

## 本仓库说明（本地版 · x.y0）

这是**本地/离线开发版**，与线上版（dev 仓 `infinite-arena-dev`）**共用同一版本号 `2.0.0`**：

- **前后端一致**：默认 `VITE_USE_LOCAL=true`（LocalBackend），纯前端、零后端、可离线、可在本机与安卓运行。
- **不依赖云端**：不连 Supabase，无云端存档/排行榜（本地存档即可）。
- **CI（私仓）**：推送到本私仓即跑质量闸门 + 构建 Web 产物（artifact）；打 `v*` tag 触发安卓 APK 构建（artifact）。详见 [docs/CICD.md](./docs/CICD.md)。
- 线上试玩（线上版）：https://cooljack9.github.io/infinite-arena/

## 安卓构建（Capacitor）

```bash
npm install
npm run build                # 产出 dist/（base=/）
npx cap add android          # 首次生成 android/
npx cap sync android         # 同步 web 资源到安卓
# 本机需 JDK17 + Android SDK（platforms;android-34, build-tools;34.0.0）
cd android && ./gradlew assembleDebug   # 产出 app-debug.apk
```

或直接推送 `v*` tag，由本私仓 CI 产出 APK artifact。

## 文档索引

- `docs/ARCHITECTURE.md` — v1.0 架构（Pure Core / 双通路 / 快照驱动 / 命令清单 / 数值规则）
- `docs/CICD.md` — CI/CD + 数据库部署维护（migration / Edge 部署 / 备份 / 监控 / 故障排查）
- `无限勇者竞技场_需求文档.md` / `_开发文档.md` / `_美术与战斗设计.md` / `_装备与经济设计.md` — 设计文档（镜像在公仓 docs/）
