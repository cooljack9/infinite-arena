# 《无限勇者竞技场》（infinite-arena）CI/CD 规范（合并版：Git 主线 + 网盘交付）

**文档版本**：V2.3（合并版；V2.3 起交付包**只放微云**，GitHub 公私仓均不再保留任何 zip，废弃私仓 Release 归档与 github.io 公仓托管）
**修订日期**：2026-08-07
**适用范围**：私仓 `cooljack9/infinite-arena-dev`（开发主仓，默认分支 `master`）；发版后通过 **百度网盘** 做国内整包分发
**配套文档**：`无限勇者竞技场_需求文档.md` / `开发文档.md` / `美术与战斗设计.md` / `装备与经济设计.md` / `音频设计文档.md`

> 本规范由原《Git 与 CI/CD 规范》（V1.0）与《网盘交付 CI/CD 规范》（V1.0）合并而成，统一描述「构建 → 发布 → 网盘分发」的完整流水线。GitHub 主线负责构建与公仓 Pages 发布；百度网盘负责国内整包镜像分发，二者互补而非替代。

---

## 1. 仓库拓扑

采用「私仓开发 + 公仓发布」的双仓结构：

| 仓库 | 可见性 | 角色 | 关键分支 |
|------|--------|------|----------|
| `cooljack9/infinite-arena-dev` | **私有** | 开发主仓：源码、设计文档、CI/CD 工作流都在此维护 | `master`（默认/生产） |
| `cooljack9/infinite-arena` | **公开** | 仅发布/展示，由本仓 Actions **自动推送，禁止手工修改** | `master`=Pages 产物源；`main`=源码镜像 |

- 线上试玩地址：`https://cooljack9.github.io/infinite-arena/`
- 公仓 `master` 采用 Pages **legacy 模式**（`branch=master`, `path=/`，base 固定为 `/infinite-arena/`），推上去即自动发布。
- 公仓 `main` 是源码镜像（应用目录为根，设计文档同步到 `docs/`），供外部阅读 / fork 源码。
- 百度网盘 `pagea` 文件夹：国内整包分发归档（见 §9），与 GitHub Pages 互为备份渠道。

> **为什么分公私双仓**：GitHub 免费方案的私有仓无法开启 Pages（`deploy-pages` 会直接 failure），故采用「私仓构建 → 推公仓 Pages」；再叠加网盘做国内可达的整包镜像。

---

## 2. 分支模型

- `master` 是唯一长期分支，也是受保护的生产分支；所有发布都来自 `master`。
- 本地直接基于 `master` 开发、提交、推送即可。重大特性建议开 `feature/xxx` 分支后提 PR 合入 `master`（PR 同样触发 `ci.yml` 门禁）。
- **绝不在公仓 `infinite-arena` 做任何手工提交**——它的 `master`/`main` 两个分支都由本仓自动维护。
- 网盘分发不依赖分支：每个发版仅取 `master` 上的源码打包，归档进网盘 `pagea`。

---

## 3. 本地开发规范

```bash
git clone https://github.com/cooljack9/infinite-arena-dev.git
cd infinite-arena-dev/infinite-arena
npm ci                # 安装依赖（锁定 package-lock.json，禁止 npm install 游离升级）
npm run dev           # 本地预览（Vite dev server）
npm run verify        # 提交前必跑：typecheck + smoke + integration
npm run build         # 生产构建；线上子路径验证用 BASE_PATH=/infinite-arena/
```

**提交前强制检查清单**
- [ ] `npm run verify` 全绿（四道闸门）
- [ ] `npm run build` 成功
- [ ] 设计文档改动已同步到仓库根目录（`无限勇者竞技场_*.md`）

---

## 4. 质量闸门（四道，任一失败即阻断发布）

| 闸门 | 命令 | 说明 |
|------|------|------|
| 类型检查 | `npm run typecheck` | `tsc --noEmit`，类型零错误 |
| 引擎冒烟 | `npm run smoke` | 战斗引擎 9 英雄特性绑定 + 实战机制触发校验 |
| 全流程集成 | `npm run integration` | 完整 run loop（编队 / 战斗 / 间歇 / 通关 / 失败） |
| 生产构建 | `npm run build` | Vite 打包产出 `infinite-arena/dist/` |

> **⚠️ 涉及 `packages/core/**` 的改动（如数值 / 教学 / 难度常量）**：本 §4 四道闸门**不含** core 同步部署。任何改了 `packages/core`（或 `supabase/functions/**`）的提交，线上发版前必须额外走「重建 core → 部署 Edge → verify-parity 5/5」（见 `CICD.md` §B3.5 / §12 `deploy-supabase.yml` 自动部署）。`ci.yml` 的 `build:core --check` 只校验不部署。否则前后端引擎漂移（`CICD.md` §9「1.9.0 事故」）。示例（v2.0.0 UX 优化）：`scaling.ts` 的 `NOVICE_CAP` 5→10、`tutorial.ts` 教学扩展均属此类，虽 Local 模式零影响，Remote 发版仍须同步 core。
> **v2.9.x 面包车特殊关（强触发，比上一轮 UX 优化更重）**：本次改了 `levelGen.ts`/`enemies.ts`/`battle.ts`/`types.ts`/`rules/index.ts`/`contract/index.ts` 六处 core，且**动了 RNG 消费顺序 + 引擎数学 + 回放契约**（`vanEncounter` 进 replay 包）。`CORE_VERSION` 统一收敛到 **`2.0.0`**，旧 replay 不可复用。本次 parity 实测还抓到一个存量 bug：`resetBuildingId` 原被关在 `if(buildings.length)` 内，车队关无建筑导致 `b*` id 跨场泄漏、前后端 checksum 分叉但胜负一致——已修（详见 `ARCHITECTURE.md` §9.3 / `CICD.md` §2.2）。**这类"胜负一样、过程不同"的漂移只有 parity 测得到，本地四道闸门全绿也会漏**，故 core 同步 + verify-parity 5/5 不可省。前端 `battleBuild.ts` 已统一走 `makeSim`，后续 core 装配改动只改一处。
> **v2.9.x 渲染加强 + 引擎轻量化（parity-safe 类）**：第二轮改了 `battle.ts`（effect 上限 + `ultBurst`/`ultRadial` 收敛 + `TRAIT_VFX` 特性特效 + 面包车开门 + 建筑产兵预警）、`skills.ts`（`VFX_SCALE` 1.85→1.0）、`frame.ts`/`ArenaCanvas.tsx`（粒子 46→28）。关键点：`BattleSim.effects` 是**纯渲染旁路**，不进 `traceLine` 校验和，故特效收敛 = **不改 checksum、不改战斗数学** → verify-parity 5/5 天然通过，`CORE_VERSION` 不升号（详见 `ARCHITECTURE.md` §9.6 / `CICD.md` §2.2）。仍按程序走 `build:core --sync` + 部署 + 5/5，但预期全绿。切勿因「只是特效」跳过同步——隔离靠架构（effects 不进 traceLine）保证，不靠主观判断。
> **v2.9.x 出生 easing + 龙巢动画（parity-safe 类 · 第三轮）**：`battle.ts` 在 `spawnFromBuilding` 按 `buildingKind` 给 `dragon_nest`/`dragon_lair` 追加专属产兵 effect（纯 emit）；`frame.ts` 加出生 easing（`birthStart`/`birthScale` 纯渲染检测新增 id 驱动 0→1 弹出，零 sim 写入）。两者同样不进 `traceLine`、不改战斗数学 → verify-parity 5/5 仍过，`CORE_VERSION` 不升号（详见 `ARCHITECTURE.md` §9.8）。六项系统需求至此全部闭合，完整工程压缩包按本规范 §9.5 上传微云 `pagea/` 为唯一发布源。

---

## 5. CI 工作流（`.github/workflows/ci.yml`）

- **触发**：push / PR 到 `master`，且变更命中 `infinite-arena/**` 或 `.github/workflows/ci.yml`。
- **职责**：纯门禁，不发布，无需任何密钥（`permissions: contents: read`）。
- **步骤**：`checkout` → `setup-node@22`（缓存 npm）→ `npm ci` → typecheck → smoke → integration → build。
- **并发**：`concurrency.cancel-in-progress: true`，同分支新 push 会取消旧运行，省算力。
- **失败处理**：任一步骤非零退出即标红，阻断合入；不涉及发布，不污染公仓。

---

## 6. CD 工作流（`.github/workflows/deploy.yml`）

- **触发**：push 到 `master`（命中源码 / 工作流），或手动 `workflow_dispatch`。
- **职责**：构建并把产物发布到公仓 Pages + 镜像源码。
- **步骤**：
  1. 三道闸门（typecheck / smoke / integration）任一失败即中止，**绝不把跑不起来的版本推上公网**。
  2. `npm run build`，注入 `BASE_PATH=/infinite-arena/`（与公仓 Pages 子路径一致）。
  3. `infinite-arena/dist/` → 推公仓 `master`（Pages 源），写入 `.nojekyll` 与产物说明 README。
  4. `infinite-arena/` 源码 → 镜像公仓 `main`，根目录设计文档同步到 `docs/`。
- **所需密钥**：`secrets.PAGES_PUSH_TOKEN`（见第 7 节）。
- **发布 Summary**：自动输出线上地址、产物分支、源码分支。

---

## 7. 密钥与权限配置

`deploy.yml` 需要把产物推到公仓，因此本仓需配置一个对公仓有写权限的 Personal Access Token：

1. GitHub → 个人 **Settings → Developer settings → Personal access tokens → Fine-grained token**。
2. 权限：对仓库 `cooljack9/infinite-arena` 赋予 `Contents: Read and write`。
3. 本仓 `infinite-arena-dev` → **Settings → Secrets and variables → Actions → New repository secret**。
4. Name：`PAGES_PUSH_TOKEN`，Value：上面生成的 token。

> 公仓 Pages 开启：公仓 **Settings → Pages → Build and deployment → Source** 选 **Deploy from a branch**，Branch 选 `master` / `/(root)`。legacy 模式下推即发布。

---

## 8. 版本与提交规范

- 版本号写在 `infinite-arena/package.json` 的 `version` 与 `version_note`，并**必须与 `packages/core/src/contract/index.ts` 的 `CORE_VERSION` 完全一致**（v2.0.0 起单一版本轴）。
- 重大版本提交信息需概括核心变更（便于自动部署 Summary 与公仓镜像说明），例如：
  `v2.0: 数值膨胀根治 / 编队预设 / 跳过已通关层 / 外部调参 MOD 化 / 移动端适配`。
- 每次 push `master` 都会触发一次完整 CI+CD；避免无意义高频 push。
- 发版后按 §9 把整包交付网盘。

---

## 9. 网盘交付（国内整包分发）

### 9.1 为什么需要
GitHub Pages 在国内访问不稳定，且免费私有仓无法开 Pages；公仓 Pages 是「对外展示」主渠道。百度网盘作为**国内镜像分发渠道**：把「源码 + 全部设计/需求/封测/发布文档」整包交付给协作者、测试与存档，不依赖外网。本规范定义「每次发版后，如何半自动地把成品交付到网盘」，与 GitHub CI/CD 互补而非替代。

### 9.2 触发时机
- 每次发布新版本（`package.json` 的 `version` 升级，如 `v2.9.13`）并 push `master`、GitHub Pages 上线后。
- 或应需求手动补传文档 / 重打包。

### 9.3 归档约定（pagea）
- 所有版本「含全文档」压缩包统一放在网盘根目录 **`pagea` 文件夹**，**扁平排列、一个版本一个 zip**（文件名自带版本号+commit，天然按版本顺序排好）。
- 每版的 `无限勇者竞技场_vX.Y.Z` 子文件夹：继续放该版的散装 md 文档（发布说明、本规范、需求/设计/封测等）。
- `pagea` 仅建一次；后续只把新版本 zip 传进去。旧版本 zip 如须保留可移入 `pagea/archive/`，保持顶层只留最新。

### 9.4 交付物清单
| 位置 | 文件 | 说明 |
|------|------|------|
| `pagea/` | `infinite-arena-vX.Y.Z-<commit>.zip` | 完整可重建工程（含 `docs/` 全文档） |
| `无限勇者竞技场_vX.Y.Z/` | `vX.Y.Z发布说明.md`、本规范、需求/设计/封测等 md | 散装文档，便于单篇查看 |

### 9.5 标准流程（V2.3：只放微云，GitHub 不保留 zip，2026-08-07 起）
> **原则**：完整包（源码+文档）**只存在于微云（私有中转）**，绝不上任何 GitHub 仓库——公仓 Pages 本就禁放 zip，私仓 Release 自 V2.3 起也不再归档；微云是交付包的唯一发布源与兜底，「交付包不裸奔」靠微云保证。
> **中继通道实测结论**（2026-08-07）：网盘 `file_upload_by_url` 抓取器仅能匿名 GET 公网 URL；`github.com`（Release/raw）**1003 不可达**；`github.io`（Pages）**可达但属公仓，禁用**；CloudStudio 可达但**拒二进制/zip、文本 ≤150KB**；**微云 download 直链需 cookie、分享链接是 SPA 页面、私有云存储要鉴权**——均无法被网盘匿名抓取。因此**zip 进网盘无法全自动，改为人工作业**（见步骤 3），文档等文本仍可自动传。
1. **打包**：`git archive --format=zip HEAD -o base.zip infinite-arena` + 把仓库根 12 份 md 用 `zipfile` append 写入 `infinite-arena/docs/`（参考 `infinite-arena/_mk_release_zip.py`，注意 `--format=zip` 默认是 tar）。
   > 产出：`infinite-arena-vX.Y.Z-<sha>.zip`（约 470 KB）。
2. **上传微云（私有，唯一发布源）**：用微云连接器脚本上传 zip 到微云根目录（`connector-tencent-weiyun/scripts/upload_to_weiyun.py` 或等效本地脚本，自动读本地文件并 base64 分片上传）。**微云是交付包的唯一权威存档与兜底，长期存留、不再删除**（自 V2.3 起私仓 Release 不再归档，故微云副本必须保留）。
3. **定期人工转存网盘（每 1~2 周一次，半自动）**：从微云（客户端 / download 直链带 cookie）下载最新 zip → 百度网盘网页/客户端上传到 `/pagea`。zip 无法自动抓取是网盘抓取器能力的硬限制（见 9.6），按此节奏批量处理即可。
4. **传文本 md（自动）**：`file_upload_by_content`（`content`=markdown、`filename`=xxx.md、`dir=/无限勇者竞技场_vX.Y.Z`），单文件 ≤ 2 万字。

### 9.6 关键约束与已知坑
| 项目 | 说明 |
|------|------|
| 无删除 API | 网盘 MCP 仅 `make_dir/upload/list/meta/rename/copy/move/search`，**无 delete**；误传/重传脏文件只能在网页端手动清理 |
| 文件夹路径 | 必须传原始 `/pagea`，**禁止**对 `/` 做 `%2F` 编码 |
| 二进制上传 | 只能走 `file_upload_by_url`（需公网 URL）或**人工**；`file_upload_by_content` 仅限文本 |
| 域名可达性（实测） | `github.io` 可达但属公仓**禁用**；`github.com` 1003 不可达；CloudStudio 可达但拒二进制、文本 ≤150KB；微云 download 需 cookie / share 为 SPA 页面，均不可匿名抓取 |
| 微云（发布源） | 上传可自动（连接器脚本）；下载需登录/cookie（人工）；**长期存留不删**（自 V2.3 起为唯一发布源，须保留） |
| 文本上限 | `file_upload_by_content` 单文件 ≤ 2 万字；超长文档需拆文件或改走 URL |
| 命名冲突 | 同名重传自动加时间戳后缀，旧件残留 → 发版后人工核对 |
| 不保留 zip | 自 V2.3 起，GitHub 公私仓均**不再保留任何 zip**（公仓 Pages 本就禁放；私仓 Release 也取消归档）；交付包只在微云 |

### 9.7 与 GitHub CI/CD 职责边界
| 渠道 | 负责 | 触发 | 产物 |
|------|------|------|------|
| GitHub `ci.yml` | 质量门禁（typecheck/smoke/integration/build） | push/PR `master` | 阻断 / 通过 |
| GitHub `deploy.yml` | 构建 + 推公仓 Pages + 镜像源码 | push `master` | 线上试玩 `cooljack9.github.io/infinite-arena/`（纯产物，无 zip） |
| 微云 | 交付包唯一发布源（私有，长期存留） | 发版后自动上传 | `infinite-arena-vX.Y.Z-<sha>.zip` |
| 微云 | 私有中转（短期存留，用完即删） | 发版后自动上传 | zip 中转副本 |
| **百度网盘** | 国内整包分发（人工定期转存） | 每 1~2 周批量 | 网盘 `pagea/` |

### 9.8 发版核对清单
- [ ] GitHub Pages 已上线（`deploy.yml` 绿）；公仓根目录**无 zip**
- [ ] 本地 `infinite-arena-vX.Y.Z-<sha>.zip` 含 `docs/` 全文档（12 篇）
- [ ] zip 已上传**微云**（唯一发布源，长期存留），并记录 file_id（私仓 Release 不再归档，故微云副本必须保留）
- [ ] 版本子文件夹 md（发布说明、本规范）已传网盘
- [ ] 定期：微云 zip → 百度网盘 `/pagea`（每 1~2 周一次）

---

## 10. 常用命令速查

| 目的 | 命令 |
|------|------|
| 克隆开发主仓 | `git clone https://github.com/cooljack9/infinite-arena-dev.git` |
| 进入应用目录 | `cd infinite-arena-dev/infinite-arena` |
| 本地预览 | `npm run dev` |
| 提交前校验 | `npm run verify` |
| 生产构建（含线上子路径） | `BASE_PATH=/infinite-arena/ npm run build` |
| 线上试玩 | 打开 `https://cooljack9.github.io/infinite-arena/` |
| 手动触发发布 | 仓库 **Actions → Build and Publish to Public Pages → Run workflow** |
| 源码打包 | `git archive --format=zip HEAD -o base.zip infinite-arena`（注意 `--format=zip`，默认是 tar） |
| 文档并入 zip | `zipfile` append 模式把仓库根 12 份 md 写入 `infinite-arena/docs/`（参考 `_mk_release_zip.py`） |
| 交付包发布源 | 仅微云（私有，长期存留）；GitHub 公私仓均不再保留 zip（V2.3 废弃私仓 Release 归档） |
| 微云上传 | 微云连接器脚本 `upload_to_weiyun.py`（自动，私有中转，用完即删） |
| 网盘传 zip | **人工**：微云下载 → 百度网盘客户端/网页传 `/pagea`（每 1~2 周批量） |
| 网盘传文本 | `file_upload_by_content`（`dir=/无限勇者竞技场_vX.Y.Z`，≤2万字） |

---

## 11. 文档清单（本仓根目录 `docs/`，单一来源，自动镜像公仓 `docs/`）

| 文件 | 内容 |
|------|------|
| `无限勇者竞技场_需求文档.md` | 产品需求（原《优化方向需求文档》已作废） |
| `无限勇者竞技场_开发文档.md` | 开发 / 架构 |
| `无限勇者竞技场_美术与战斗设计.md` | 美术与战斗表现 |
| `无限勇者竞技场_装备与经济设计.md` | 装备 / 经济子系统 |
| `无限勇者竞技场_音频设计文档.md` | 音频 |
| `前端架构评审报告-v2.9.4.md` | 前端架构评审（历史里程碑） |
| `无限勇者竞技场_RELEASE_历史.md` | 历史发布说明（v2.3–v2.6 合并） |
| `v2.0.0-发布说明.md` | 最新版变更摘要（当前基线） |
| `v3.1.0-发布说明.md` | 历史里程碑变更摘要 |
| `v2.9.14发布说明.md` | 上一版变更摘要 |
| `v2.9.13发布说明.md` | 更早一版变更摘要 |
| `无限勇者竞技场_模拟封测反馈报告.md` | 模拟封测反馈 |
| `无限勇者竞技场_CI_CD规范.md` | **本规范**（Git 主线 + 网盘交付，由原两份合并） |
| `overview.md` | 项目概览 |

> 所有 `无限勇者竞技场_*.md` 会在 CD 阶段自动镜像到公仓 `main/docs/`（`overview.md`、`vX.Y.Z发布说明.md` 无此前缀，不镜像，仅在完整包 zip 的 `docs/` 内）。原《优化方向需求文档》《Git 与 CI/CD 规范》《网盘交付 CI/CD 规范》均已作废/合并。新增设计文档请沿用 `无限勇者竞技场_` 前缀，便于自动同步。
