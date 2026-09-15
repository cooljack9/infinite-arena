# 无限勇者竞技场 · CI/CD 历史问题参考附录

> **用途**：本文是 [CICD.md](./CICD.md) 的**配套历史库**——只收历次发版事故、踩坑复盘、根因推导与时间线。执行流程去 CICD.md。
> 每条按「现象 → 根因 → 修复 → 教训」记录，便于下次遇到同类症状直接对照。

---

## 0. 事故总览（一表速查）

| 时间/版本 | 坑 | 性质 | 见章节 |
|---|---|---|---|
| 2026-08-10 | 静默回退 LOCAL，9 天零落库 | 流程缺失 | §1 |
| 1.9.0 | 改 core 漏部署 Edge，云端旧引擎漂移 | 前后端漂移 | §2 |
| 2.2.0 | `build:core --sync` npm 不透传 `--sync` | 同步失效 | §3 |
| v2.0.0 | 改 scaling/tutorial，云端须 rebuild core | 渲染旁路认知 | §4 |
| v2.9.x | 渲染特效不进 checksum，但 core 须同字节 | 隔离靠架构 | §5 |
| 通用 | CI 绿 ≠ 云端对（mock 假绿） | 验证缺陷 | §6 |
| **2.4.5（本次）** | mirror 脚本 base_tree bug 覆盖 dev root | 脚本 bug | §7-坑1 |
| **2.4.5（本次）** | 白试两串 `sb_secret_`，非 `sbp_` PAT | token 类型错 | §7-坑2 |
| **2.4.5（本次）** | 误信「git 被拦」走 API 逐文件，慢且坏 | 环境误判 | §7-坑3 |
| **2.4.5（本次）** | Bash shim 清空 PATH，命令全挂 | 工具环境 | §7-坑4 |

---

## 1. 2026-08-10 静默回退 LOCAL（9 天零落库）

- **现象**：local 仓被回退到旧状态，线上玩家 9 天没有任何新局落库（`runs`/`battles` 停滞），但无人察觉。
- **根因**：发版后没有强制「发布即落库验证」的硬门；回退操作未触发告警，远端 Pages 仍显示旧版本，表面「正常」。
- **修复**：确立铁律 §0.6.2（每局必落库）+ §0.6.5 发布前核验清单（缺落库验证禁止称全链路完成）+ B7 落库验证步骤。
- **教训**：**「页面能打开」≠「发布成功」**。每次发版必须实测一局确认 `runs.status` 终态 + `battles.client_checksum` 落库，不能只看部署 run 绿。

---

## 2. 1.9.0 前后端引擎漂移

- **现象**：CI parity 5/5 绿，但线上玩家实际跑的是旧引擎——胜负结果一致，战斗过程 / checksum 分叉，仅 parity 探针能测出。
- **根因**：改了 `packages/core/**` 后只推了 Pages（前端），**漏跑 `deploy-supabase.yml` 部署 Edge** → 云端 `game` 函数还是旧 core.js。
- **修复**：加 `deploy-supabase.yml` 自动闸门（push 命中 `packages/core/**` 或 `supabase/functions/**` 即自动部署 + parity）；铁律 §0.6.3 列为不可违背。
- **教训**：**前端推了 ≠ 后端同步了**。改 core/functions 后，B4（Edge 部署 + parity 5/5）是硬门，跳了就是漂移事故。

---

## 3. 2.2.0 `build:core --sync` 透传坑

- **现象**：`build:core` 跑完，但 Edge 云端 core.js 没更新，parity 在云端测出旧引擎。
- **根因**：`deploy-supabase.yml` 里写的是 `npm run build:core --sync`。**npm 不透传 `--sync` 给脚本**——`--sync` 被 npm 吞掉，只打包 dist、不同步 `_shared/core.js`。
- **修复**：全文档统一改为 `npm run build:core -- --sync`（`--` 强制分隔，把 `--sync` 透传给脚本）。CI 模板 §10 固化。
- **教训**：npm script 传参**必须 `--` 分隔**，否则子参数静默丢失、构建「成功」但行为错。

---

## 4. v2.0.0 UX 优化（渲染旁路认知）

- **现象**：改 `scaling.ts` / `tutorial.ts`（纯数据/常量，不进 checksum）→ 本地零影响，但远端玩家出现不一致。
- **根因**：这两个文件**纯数据/常量**，本不进引擎 checksum；但若动过含 core 逻辑的文件，云端 Edge 必须 `build:core -- --sync` 重建，否则 Remote 漂移。当时误判「只是 UX 文案」没重建。
- **修复**：任何触及 `packages/core/**` 的提交都走 B4。
- **教训**：**「我觉得只是文案/特效」不可信，隔离靠架构保证，不靠直觉**。凡动 core 子树，一律 rebuild+deploy+parity。

---

## 5. v2.9.x 渲染加强（隔离靠架构）

- **现象**：增删 `effects` 渲染特效后，担心 parity 不过。
- **根因**：`effects` 数组是**纯渲染旁路**；`traceLine` 只抓坐标/hp/alive，不抓 effects → 增删特效不进 checksum，`verify-parity` 5/5 天然过。但 `battle.ts`/`skills.ts` 仍属 core，云端必须同字节。
- **修复**：架构层面确保渲染旁路不进 checksum；core 文件仍走 B4。
- **教训**：校验通过是**架构隔离的结果**，不是「这次恰好没碰引擎」的运气。结构变了要回看 traceLine 抓了什么。

---

## 6. 通用陷阱：CI 绿 ≠ 云端对（mock 假绿）

- **现象**：`verify-parity.mjs` 本地 5/5 全绿，云端却跑旧引擎，长时间没人发现。
- **根因**：`verify-parity.mjs` 若**未注入 env**（`SUPABASE_URL`/`SUPABASE_ANON_KEY`），会静默退化为同进程 mock 结算 → 永远绿（假绿杀手）。另外只看 CI 内的 parity gate，没独立复验云端 `coreVersion`。
- **修复**：铁律 §0.6.3 要求 verify-parity **必须注入 env**；部署后独立复验云端 `coreVersion`（Edge `__parityBattle` 探针）+ 注入 env 重跑 parity。
- **教训**：**没有 env 注入的 parity 是假绿**。线上终态必须用真实远端 seed 跑，不能信同进程模拟。

---

## 7. 2.4.5 全链路发版踩的四坑（本次，最完整复盘）

> 背景：v2.4.5 场景 B 全链路（镜头双模式 + 选队长 + killfeed 姓名化）。代码侧 parity-safe（仅 death cue 加 victim/killer 透传 + leaderUid 可选类型字段，CORE_VERSION 冻结 2.2.0）。下面四坑全在「照 CICD 文档做」时暴露，已反向修进 CICD.md。

### 坑1：mirror 脚本 `base_tree` bug 整体覆盖 dev root

- **现象**：`_mirror_local_to_dev.mjs --push` 后，dev master 的 root 顶层**完全不含 `.github`**，变成平铺源码（`src/`、`packages/`…），CI 三条管线一条都不触发，runs 停在原地。
- **根因**：脚本第 151 行把 `base_tree` 设成了 `infinite-arena/` 子树自身的 sha，再把这个「子树内容树」直接当 commit 的 tree 并 PATCH 到 master → 等于用平铺源码**整体替换 dev root**，`.github`、release docs、`infinite-arena/` 包装层全没了。
- **修复**：写 `_reconstruct_dev.mjs` 经 Git Data API 重建——取「旧好 root」(c84e60dc) 的真实 tree sha 作 `base_tree`，仅把 `infinite-arena/` 子树覆盖为新源码（442ef165 的 tree），建 commit（parent=当前 master）后 force PATCH。重建后 master=8277f7b，`.github/workflows` + `infinite-arena/` 子树全部就位，force PATCH 实际触发了 CI。
- **教训（已固化进 CICD.md）**：
  1. **首选 git 克隆覆盖法（§5.1）** 推 dev——它天然保留根 `.github`，不出这个雷；
  2. 若真用 mirror 脚本，必须确认 `base_tree` 用的是 **dev root tree**，不是子树 sha；
  3. 推完立刻 `gh run list` 确证 CI 被触发，没触发先怀疑 `.github` 丢了。

### 坑2：Supabase token 类型错（白试两串 `sb_secret_`）

- **现象**：`deploy-supabase.yml` 卡在 Deploy Edge Function 步骤，先报 `HTTP 401 {"message":"Unauthorized"}`，换了新串后变 `HTTP 401 {"message":"JWT could not be decoded"}`。
- **根因**：用户给的是 `<SUPABASE_PROJECT_KEY_1>` 与 `<SUPABASE_PROJECT_KEY_2>`（即 `sb_secret_` 开头的两串）——**项目级 key**（anon/service_role 或连接串前缀），**不是账号级 Personal Access Token**。（注：`sb_secret_` 前缀同样会被 GitHub push protection 当 Supabase Secret Key 拦下，文档里一律用占位符，禁止写真值——见 §密钥铁律）Management API `api.supabase.com/v1/projects/.../functions/deploy` 只认账号 PAT；项目 key 拿去 `Bearer` 鉴权会被当 JWT 解码 → `JWT could not be decoded`。错误消息变化（Unauthorized→could not be decoded）恰好证明 secret 写入正常、新值送达了 Supabase，纯粹是格式不对。
- **修复**：用户在 `https://supabase.com/dashboard/account/tokens` 生成**账号 PAT**（`<SUPABASE_PAT>`），`gh secret set SUPABASE_ACCESS_TOKEN` 写入后重跑 → Edge 部署 ✅ + parity 5/5 ✅。
- **教训（已固化进 CICD.md §B4 铁律）**：
  - ✅ 正确：`<SUPABASE_PAT>...` 长 JWT（account/tokens 生成，新格式）；
  - ⛔ 错误：`sb_secret_` 开头、anon/service_role key、数据库连接串——这些调 Management API 一律失败；
  - PAT 有效期选长一点，别又 30 天过期（旧 token 正是满 30 天 401）。

### 坑3：误信「git 被拦」→ 走 Git Data API 逐文件推（慢且坏）

- **现象**：文档原 §6/§13.5 坚称「github.com:443 被拦，必须走 Git Data API 逐文件推」。实测据此把 255 个文件逐个 `POST /git/blobs`，跑满 600s 超时、网络抖动下 SIGTERM，且埋下坑1 的 root 覆盖雷。
- **根因**：环境假设过时。本环境 `git push` / `git ls-remote` 经 HTTPS **实际可用**（私有仓鉴权已缓存），文档里的「git 被拦」结论不成立。
- **修复**：改用 **git 克隆覆盖法**（§5.1）——克隆 local 仓 → 用 `git archive` 覆盖源码（保留 `.github/workflows`）→ 一次 `git push` → 打 `v2.4.5` tag 触发 `android.yml` 出 APK。一次 push 完成，无逐文件 API。
- **教训（已固化进 CICD.md §5）**：**git push 优先，Git Data API 仅当 `git push` 真报 443 阻断时兜底**。逐文件 API 既慢又易破坏树结构，能不用就不用。

### 坑4：Bash shim 清空 PATH，命令全 `command not found`

- **现象**：Bash 工具里 `git`/`gh`/`head`/`cat`/`mkdir`/`ls`/`dir` 全部 command not found，管道 `| cat` 断管，连 `wc`/`base64` 也被干掉，环境反复退化。
- **根因**：WorkBuddy Bash 工具的 shim 在某些回合清空 PATH，只留极简环境。
- **修复**：
  - 用 **Python `subprocess`** 调绝对路径 exe，输出重定向到文件再用 Read 看（绕开所有管道命令）；
  - 真实路径：`git.exe` = `C:/Users/username/.workbuddy/binaries/PortableGit/versions/1.2.0/cmd/git.exe`；`gh.exe` = `C:/Program Files\GitHub CLI\gh.exe`（用 `glob.glob('.../**/git.exe', recursive=True)` 定位最稳）；
  - `gh` 输出落文件 → Read，避免 `| cat` / `| head` 断管。
- **教训（已固化进 CICD.md §5.2）**：环境一退化就切 Python subprocess + 绝对路径，别跟 shim 较劲。

---

## 8. 历史 war story 之外的「这次文档本身的问题」

> 用户原话：「照着一个完整的文档做做得屎一样丢三落四。」复盘文档自身缺陷（已在新 CICD.md 修）：

1. **APK 藏在场景 A 里没有硬门** → 直接跳到镜像 dev，local 仓 APK 整段被跳过。现改为 B1 🔴 硬门，完成标准 checklist 强制勾选。
2. **mirror 破坏恢复流程缺失** → 文档只警告「覆盖会丢部署」，没写「丢了怎么恢复」，被迫现场发明重建脚本。现补 §B2 恢复流程 + 首选克隆覆盖法。
3. **Supabase token 说不清** → 没一句话区分「账号 PAT」与「项目 key」，白试两串 `sb_secret_`。现 §B4 铁律显式对比。
4. **git 被拦假设错误** → 坚称必须走 API，导致慢+坏。现 §5 改 git push 优先。
5. **路径/脚本名对不上** → 文档写 `E:/t6/9100/_push_local_*.mjs`，实际 `E:/t6/9801/_mirror_local_to_dev.mjs`。现全文统一 `E:/t6/9801`。
6. **war story 淹没 runbook** → 历史复盘占近半篇幅，执行步骤被稀释。现拆分：执行留 CICD.md，历史全移本文。

---

## 9. 修订记录

| 版本 | 改动 |
|---|---|
| v2.4.5（本次） | 原单文件 623 行 → 拆为 CICD.md（执行，精简）+ CICDHISTORY.md（历史）；补 B1/B4 硬门、mirror 恢复、token 铁律、git push 优先、bash 退化 workaround；统一路径 `E:/t6/9801`；war story 下沉 |


## 🔒 密钥铁律（2026-09-15 追加）

- ⛔ **严禁把真实 Supabase 密钥明文写进任何 `docs/` 文件**。GitHub push protection 认两类 Supabase Secret Key：
  - `sbp_` 开头 = 账号级 Personal Access Token（PAT）；
  - `sb_secret_` 开头 = 项目级 key（anon/service_role / 连接串前缀）。
  两者任一写进文档都会被 GH013 拦下，导致公开仓 `main` 镜像步骤 failure。
- 文档里 token 一律用占位符：`<SUPABASE_PAT>` / `<SUPABASE_ANON_KEY>` / `<SUPABASE_PROJECT_KEY_1>` 等。
- 原因：本文档曾沉淀真实 `sbp_` PAT 与两串 `sb_secret_` key，公开仓 `main` 镜像步骤持续 GH013 失败；这些已按暴露处理，需在 Supabase 后台轮换（revoke + 重建）。
- 密钥只在 CI secrets（`SUPABASE_ACCESS_TOKEN` 等）与本地 `.env`（不入库）流转。
