# 无限勇者竞技场 · CI/CD 发版执行手册（v2.4.5 修订）

> **定位**：本文是**执行 runbook**——只保留选路、铁律、质量闸门、线性 checklist 与排障动作表。
> **历史事故 / 踩坑复盘 / 根因叙述**全部移到 👉 [CICDHISTORY.md](./CICDHISTORY.md)（含 2.4.5 发版踩的四坑、1.9.0/2.2.0 漂移、静默回退等）。本文排障表里的「根因」只给结论，细节去 history 查。
> 配套：[ARCHITECTURE.md](./ARCHITECTURE.md) ｜ 数据库预案：`docs/backend/线上数据库预案.md`

---

## 0. 一图选路（A / B / C）

| | **A 本地升级** | **B 全链路升级** | **C 线上维护** |
|---|---|---|---|
| 改动范围 | 本地 + local 仓 | 本地 + local + dev + 线上后端 + 压缩包 | dev + 线上后端 |
| 适用 | 纯本地自测，不上线 | 功能/修复要**上线给玩家** | 线上热修/查证/DB，本地不动 |
| 版本号 | 升唯一版本号 `X.Y.Z` | 升 `X.Y.Z`，且 **本地=dev=压缩包=线上=CORE_VERSION** 同步 | dev 沿用当前，不升号 |
| 触发 | local 仓 `ci.yml` + `android.yml`(打 tag) | A 全流程 + dev `deploy.yml`(Pages) + `deploy-supabase.yml`(Edge) | dev `deploy.yml` / `deploy-supabase.yml` / DB |
| 交付物 | Web 产物 + **APK**（私仓 artifact） | 同上 + **版本 zip**（网盘） | 无压缩包 |

**决策口诀**：只自己玩 → **A**；要上线给玩家（含黑屏/落库/玩法改动）→ **B**；玩家反馈线上问题快速修、不想动版本节奏 → **C**。

---

## 0.6 铁律（不可违背）

> 两次线上事故均因违反本节（详见 CICDHISTORY.md：① 2026-08-10 静默回退 LOCAL 9 天零落库；② 1.9.0 / 2.2.0 前后端引擎漂移）。

### 0.6.1 远程模式（前端必须连 Supabase）
- ✅ 线上构建**必须** remote：`deploy.yml` 注入 `VITE_USE_LOCAL=false` + `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`（仅限 Actions secrets）。
- ✅ 构建闸门：**未注入项目 ref `kohvqyullvhuwyyxltqa` 即 `exit 1`**（必须 grep 项目 ref，grep 通用域名 `supabase.co` 无效——库自带字面量）。
- ⛔ 严禁 `.env`/`.env.production` 提供这些值（密钥落仓 = 泄露）。严禁任何让 `import.meta.env` 编译成空对象 → `useLocalComputation=true` 的改动。

### 0.6.2 落库（每局进 Supabase）
- ✅ 线上每局落库：`runs`/`battles` 写入 Supabase；`runs.status` 必须出现 `won`/`lost`/`abandoned` 终态，不能全 `active`。
- ✅ 发布后实测：`node _db_recent.mjs` 查 `runs.status` 终态 + `battles.client_checksum` 落库。

### 0.6.3 parity（引擎逐 bit 一致）
- ✅ 改 `packages/core/**` 或 `supabase/functions/**`：`npm run build:core -- --sync`（**必须 `--` 分隔**）→ 部署 Edge → `verify-parity.mjs` 5/5。
- ✅ `verify-parity.mjs` **必须注入 env**（`SUPABASE_URL`/`SUPABASE_ANON_KEY`），否则静默退化为 mock 同进程结算 → 永远绿（假绿杀手）。
- ⛔ 严禁只推 Pages 不部署后端（= 前后端漂移，仅 parity 可测）。

### 0.6.4 密钥与安全
- ✅ 凭证只在 Actions secrets 与 Supabase 后台；anon key 可进前端 bundle；**service_role 永不下仓、永不到前端**。
- ⛔ 严禁含密钥的 `.env` 提交进仓库。

### 0.6.5 发布前核验清单（缺任一项 = 禁止称「全链路完成」）
- [ ] `deploy.yml` 注入 `VITE_USE_LOCAL=false` + Supabase secrets ✅
- [ ] 构建闸门 grep 项目 ref `kohvqyullvhuwyyxltqa` 通过 ✅
- [ ] 若改 `core/**`/`functions/**`：`build:core -- --sync` + 部署 Edge + `verify-parity.mjs`(env 注入) 5/5 ✅
- [ ] 独立复验云端 `coreVersion` == `CORE_VERSION` ✅
- [ ] 线上自测一局：`runs` 终态 + `battles.client_checksum` 落库 ✅
- [ ] **APK 已取出并校验**（B 场景硬门，见 B1）✅
- [ ] 公仓 Pages 上线 + 源码镜像 + zip 仅存微云 ✅

### 0.6.6 完成标准
1. Pages = X.Y.Z ✅ 2. 云端 Edge 已部署且 parity 5/5（改了 core/functions 时）✅ 3. 前端 remote 模式并落库（bundle 含 `kohvqyullvhuwyyxltqa`）✅ 4. 本地/线上/CORE_VERSION 一致 ✅ 5. **APK 已交付** ✅

---

## 1. 仓库与交付拓扑（实际状态）

```
infinite-arena-local（私有，本地版权威仓）   infinite-arena-dev（私有，线上开发仓）
├─ 仓库根 = 应用源码                       ├─ infinite-arena/   应用源码（子树）
├─ .github/workflows/                     ├─ .github/workflows/
│   ├─ ci.yml     六闸门 + Web artifact     │   ├─ deploy.yml   发布 Pages
│   └─ android.yml APK（打 v* tag 触发）     │   └─ deploy-supabase.yml 后端+parity
└─ docs/CICD.md（本文档）                   └─ 设计文档 md

infinite-arena（公开，线上站点）
├─ master  ← Pages 产物（deploy.yml 推送）   └─ main ← 源码镜像
```

- **工作区**：本地源码在 `E:/t6/9801/repo`（即「本地仓」工作树）；临时脚本/产物在 `E:/t6/9801/` 或 `E:/t6/9801/release/`。
- **线上地址**：https://cooljack9.github.io/infinite-arena/
- **数据库 / Edge**：Supabase 项目 `kohvqyullvhuwyyxltqa`（Tokyo）；Edge Function `game`。
- **版本线**：本地版与线上版共用一条 `x.y.z` 线（历史规则末位曾要求 0，但 **2.4.x 已破例落地**，不要再造新号）。**五处版本号必须一致**：`package.json` / git tag / 压缩包 / 线上 Pages / Edge `CORE_VERSION`。

---

## 2. 质量闸门

| # | 闸门 | 命令 | 作用 |
|---|---|---|---|
| 1 | Typecheck | `npm run typecheck` | tsc --noEmit 零错误 |
| 2 | Guard | `npm run guard` | 确定性闸门：扫 `packages/core/src`，禁 Math.random/Date.now 直用 |
| 3 | Smoke | `npm run smoke` | 引擎冒烟 |
| 4 | Integration | `npm run integration` | 全流程集成 |
| 5 | Unit | `npm run test` | vitest（含 parity.test.ts 逐 bit 一致） |
| 6 | Build | `npm run build` | vite 生产构建 |
| + | Verify core sync | `build:core -- --sync` | Edge `core.js` 须与 `@arena/core` 同字节 |
| + | 云端 parity | `verify-parity.mjs` | 本地 vs 云端同种子 checksum 5/5 |

**本地坑位（真实 CI 无此问题）**：本地 `npm run build` 可能被安全删除钩子拦截（`emptyDir(dist)` 转回收站）→ 用 `vite build --outDir dist-tmp` 跳过；**构建以 CI 为准**。

---

## 3. ★ 场景 B：全链路升级（线性 checklist）

> **口诀**：升号 → 五门禁 → 推 local+APK → 镜像 dev → 打 tag → 后端 parity → 验证线上 → 打 zip+网盘 → 落库验证。
> **铁则**：每步「验证通过」打勾后才进下一步。**APK（B1）与后端 parity（B4）是硬门，跳任一 = 丢三落四。**

### B0. 升版本号 + 本地五门禁
```bash
cd E:/t6/9801/repo
# 改 package.json version 为 X.Y.Z（同时更新 version_note 头部一行说明）
npm run typecheck && npm run guard && npm run smoke && npm run integration && npm run test && npm run build
# 若改了 packages/core/** 或 supabase/functions/**，先同步后端核心：
npm run build:core -- --sync
git add -A -v && git commit -m "feat(X.Y.Z): <一句话>" && git log -1 --oneline
```
✅ 门：六闸门全过、commit 已建。

### B1. 推 local 仓 + 取 APK（🔴 硬门，不可跳过）
```bash
# 把本地 2.4.5 源码推上 infinite-arena-local（保留其 .github/workflows）：
# 推荐：git 克隆覆盖法（见 §5，比 Git Data API 稳且快）
# 打 tag 触发 android.yml：
gh api -X POST repos/cooljack9/infinite-arena-local/git/refs -f ref=refs/tags/vX.Y.Z -f sha=<local 新commit>
gh run list --repo cooljack9/infinite-arena-local --limit 4
# 等 CI(本地版) + Build Android APK 两个 run 均 success
# 取出 APK：
gh run download <android-run-id> -n app-debug.apk -D E:/t6/9801/release --repo cooljack9/infinite-arena-local
# 校验 + 重命名：
python -c "import shutil;open('E:/t6/9801/release/app-debug.apk','rb').read(4)==b'PK\x03\x04' or exit(1);shutil.copy('E:/t6/9801/release/app-debug.apk','E:/t6/9801/release/app-debug-X.Y.Z.apk')"
```
✅ 门：`Build Android APK` run = success；`app-debug-X.Y.Z.apk` 存在且 zip magic `504b0304` 合法。

### B2. 镜像 dev 仓（触发 Pages / Edge）+ 失败恢复
```bash
# 推荐：git 克隆覆盖法推 dev（见 §5），只动 infinite-arena/ 子树、保留根 .github
# 或沿用脚本（有风险，见下）：node E:/t6/9801/_mirror_local_to_dev.mjs --push
```
> ⚠️ **mirror 脚本的雷**（根因与恢复见 CICDHISTORY.md §2.4.5-坑1）：旧 `_mirror_local_to_dev.mjs` 曾因 `base_tree` 用错把整个 dev root 覆盖，导致 `.github/workflows` 与 release docs 全丢、CI 不触发。
> **恢复流程（若 dev root `.github` 丢失）**：以「旧好 root」的真实 tree 为 `base_tree`，仅把 `infinite-arena/` 子树覆盖为新源码，建 commit 后 `PATCH master`（取旧 root tree sha → 取新源码 tree sha → `POST /git/trees` 带 base_tree 覆盖 `infinite-arena` → commit(parent=当前 master) → force PATCH）。**恢复后立刻 `gh run list` 确认 CI 被触发**。
> **首选仍是 §5 的 git 克隆覆盖法**——它天然保留 `.github`，不会出这个雷。

### B3. 打 dev tag + 确认 deploy run
```bash
gh api -X POST repos/cooljack9/infinite-arena-dev/git/refs -f ref=refs/tags/vX.Y.Z -f sha=<dev 新commit>
gh run list --repo cooljack9/infinite-arena-dev --limit 4
# 等 Build and Publish to Public Pages（deploy.yml）success
```
✅ 门：Pages run = success；公仓 `main` 的 `package.json` 版本 = X.Y.Z。

### B4. 后端 Edge + parity 5/5（🔴 硬门，改了 core/functions 时必须）
```bash
# 自动：dev push 命中 packages/core/** 或 supabase/functions/** 会自动跑 deploy-supabase.yml
#       → build:core -- --sync → Deploy 201 → Parity 5/5。等该 run = success 即可。
# 手动兜底（CI 不可用 / 需重跑）：
gh workflow run deploy-supabase.yml --repo cooljack9/infinite-arena-dev
gh run watch <run-id> --repo cooljack9/infinite-arena-dev
```
> 🔴 **Supabase token 铁律（本次白试两次的坑，详见 CICDHISTORY.md §2.4.5-坑2）**：
> `deploy-supabase.yml` 调用的 `api.supabase.com/v1/projects/.../functions/deploy` 需要**账号级 Personal Access Token**。
> - ✅ **正确**：`https://supabase.com/dashboard/account/tokens` 生成的**账号 PAT**，格式 `<SUPABASE_PAT>` 长 JWT。用 `gh secret set SUPABASE_ACCESS_TOKEN --repo cooljack9/infinite-arena-dev --body "<SUPABASE_PAT>"` 写入。
> - ⛔ **错误**：项目 `anon` / `service_role` key、数据库连接串、`sb_secret_` 开头的字符串——这些是**项目级 key**，调 Management API 会报 `JWT could not be decoded` / `Unauthorized`。
> - 失效表现：Deploy 401/403 → 换新 `sbp_` PAT 重跑即可。
> - ⛔ **严禁把真实 Supabase 密钥明文写进任何 `docs/` 文件**（含本文档与 `CICDHISTORY.md`）：GitHub push protection（`GH013: Push cannot contain secrets`）认两类 Supabase Secret Key——`sbp_` 账号 PAT 与 `sb_secret_` 项目级 key——任一写进文档都会被拦下，导致公开仓 `main` 镜像步骤 failure（2026-09-15 实测：`CICDHISTORY.md` 第 96 行沉淀两串 `sb_secret_` key，main 镜像持续红，但 live 站点与 Edge 不受影响）。文档内 token 一律用占位符 `<SUPABASE_PAT>` / `<SUPABASE_ANON_KEY>` / `<SUPABASE_PROJECT_KEY_1>` 等。

### B5. 验证线上 = X.Y.Z
```bash
# 抓线上主 JS 包，确认含本版 core 指纹（或 package.json 版本）
curl -sL https://cooljack9.github.io/infinite-arena/ -o /tmp/pages_index.html
# 浏览器 Ctrl+F5 硬刷，确认新功能（如镜头双模式、killfeed 姓名化）就位
```
✅ 门：线上 bundle 含本版特征；旧 bundle 缓存已破。

### B6. 打 zip + 网盘（微云权威 + 百度 /pagea）
```bash
cd E:/t6/9801/repo
git archive --format=zip HEAD -o E:/t6/9801/infinite-arena-vX.Y.Z.zip
# 校验含 docs/CICD.md + docs/ARCHITECTURE.md：
python -c "import zipfile;z=zipfile.ZipFile('E:/t6/9801/infinite-arena-vX.Y.Z.zip');print('CICD' in [n for n in z.namelist() if 'docs/CICD.md' in n], 'ARCH' in str([n for n in z.namelist() if 'ARCHITECTURE.md' in n]))"
```
> **网盘铁律**：zip **只存微云**（唯一权威源，长期不删）；百度网盘 `/pagea` 作国内分发（zip 无法被匿名抓取器拉取，需客户端/网页手动传，每 1~2 周批量一次）。**GitHub 公私仓不存 zip**。
> ⚠️ 网盘连接器无 delete API，误传脏文件只能网页端手动清理；同名重传自动加时间戳后缀 → 发版后人工核对 `pagea/`。

### B7. 落库验证（可选但建议）
```bash
node E:/t6/9801/_db_recent.mjs   # 查 runs.status 终态 + battles.client_checksum 落库
# 或直接探活 Edge：curl -s -o /dev/null -w "%{http_code}" -X POST https://kohvqyullvhuwyyxltqa.supabase.co/functions/v1/game
# 预期 405（部署存活、拒绝 GET 正常）
```

### ✅ B 完成标准 checklist（逐项打勾才算完）
- [ ] B0 六闸门全过，commit 已建
- [ ] B1 **APK 已取出**（app-debug-X.Y.Z.apk，magic 合法）
- [ ] B2 dev 已镜像，`.github/workflows` 完好，CI 已触发
- [ ] B3 Pages 已发布，公仓版本 = X.Y.Z
- [ ] B4 **后端 Edge 已部署 + parity 5/5**（改了 core/functions 时）
- [ ] B5 线上 bundle 含本版特征
- [ ] B6 zip 已打（含 docs），已传微云 + /pagea
- [ ] B7 落库验证通过（runs 终态 + checksum）

---

## 4. 场景 A / C（精简）

**A 本地升级** = B0 + B1（只到「推 local + 取 APK」，不做 dev/线上）。完成标准：local master = X.Y.Z；CI(本地版) ✅；APK 已取。

**C 线上维护** = 只动 dev 仓或线上后端，本地不动、不打包：
- 改 `infinite-arena/**` → 自动触发 `deploy.yml`（Pages）。
- 改 `supabase/functions/**` 或 `packages/core/**` → 必须走 B4 后端部署 + parity（只推 Pages = 漂移）。
- 查证：`node _db_recent.mjs` / `_db_query.mjs`；Edge 日志在 Supabase Dashboard → Edge Functions → game → Logs。
- DB 维护：`supabase db push --db-url <url>`（见 §1 项目 ref）；只读迁移 `0005_readonly_access.sql` 不入仓。

---

## 5. 推送方式：git push 优先，Git Data API 兜底

> **本环境实测**：`git push` / `git ls-remote` 经 HTTPS **可用**（私有仓鉴权已缓存）。**优先用 git push / 克隆覆盖，不要走 Git Data API 逐文件推**——逐文件 API 既慢（255 文件曾跑满 600s 超时）又易把 dev root 覆盖坏（详见 CICDHISTORY.md §2.4.5-坑3）。

### 5.1 推荐：git 克隆覆盖法（推 local / dev 都适用）
```bash
# 推 dev（保留根 .github）：
git clone https://github.com/cooljack9/infinite-arena-dev.git _dev_clone
cd _dev_clone
git -C E:/t6/9801/repo archive HEAD | tar -x -C .   # 覆盖 infinite-arena/ 子树源码
git rm -r --ignore-unmatch $(git ls-files | grep -v '^infinite-arena/')   # 仅清理非子树陈旧文件（按需）
git add -A && git commit -m "feat(X.Y.Z): ..." && git push origin master
# 推 local（保留其 .github/workflows）：
git clone https://github.com/cooljack9/infinite-arena-local.git _local_clone
cd _local_clone
git -C E:/t6/9801/repo ls-files | grep -v '^.github/' > /tmp/src.txt   # 排除 .github，保留 local 的 workflow
# 复制清单内文件进 _local_clone → git add -A → commit → push master → tag vX.Y.Z → push origin vX.Y.Z
```

### 5.2 bash 退化 workaround（本会话实测，详见 CICDHISTORY.md §2.4.5-坑4）
Bash 工具 shim 会清空 PATH，`git`/`gh`/`head`/`cat`/`mkdir`/`ls` 全 `command not found`。解法：
- `git.exe` 绝对路径：`C:/Users/username/.workbuddy/binaries/PortableGit/versions/1.2.0/cmd/git.exe`
- `gh.exe` 绝对路径：`C:/Program Files\GitHub CLI\gh.exe`
- 用 **Python `subprocess`** 调上述 exe（定位用 `glob.glob('.../**/git.exe', recursive=True)`），输出重定向到文件再用 Read 看（避免 `| cat` 断管）。

### 5.3 Git Data API 兜底（仅当 `git push` 真报 github.com:443 阻断时）
1. `GET /git/refs/heads/<branch>` → HEAD；`GET /git/commits/<HEAD>` → 真实 base_tree sha。
2. 改动集：`git diff --name-only <parent> <head>`；逐文件 → `\r\n→\n` → base64 → `POST /git/blobs`（建议 `--input -` 传 JSON，node `fetch` 最稳）。
3. `POST /git/trees` **带 `base_tree`**（不带会丢光其余文件）+ entries（覆盖）+ 删除条目（`sha: null`）。
4. `POST /git/commits`（parents=[远程 HEAD]，fast-forward）→ `PATCH /git/refs/heads/<branch>` `{sha, force:false}`。
5. tag：`POST /git/refs`（`refs/tags/vX.Y.Z`）；移动旧 tag `PATCH .../git/refs/tags/<tag>` `-F force=true` **会触发** `push: tags` workflow。
> 注意：API 推送的 commit sha 与本地不同（仅元数据差异），本地不能直接 fast-forward。

---

## 6. 产物取出（artifact 下载）

```bash
# Web 产物：
gh run download <ci-run-id> -n web-build -D E:/t6/9801/_out --repo cooljack9/infinite-arena-local
# APK：
gh run download <android-run-id> -n app-debug.apk -D E:/t6/9801/release --repo cooljack9/infinite-arena-local
```
验证 APK：前 4 字节 `504b0304`（zip magic），大小 ~4.7MB。交付命名 `app-debug-X.Y.Z.apk`。

---

## 7. 版本同步五件套

| 项 | 规则 |
|---|---|
| package.json `version` | 每次升级唯一真源，先改它 |
| git tag（local + dev） | 与 package.json 一致：`vX.Y.Z` |
| 线上 Pages | 由 dev 镜像的 package.json/Build 决定，deploy 后验证 commit msg |
| 压缩包 | `infinite-arena-vX.Y.Z.zip`，放微云（权威）+ 百度 `/pagea`，GitHub 不存 |
| 云端 Edge Function | 与 package.json 同步部署（B4）+ parity 5/5——改 core/functions 后必做 |

**顺序**：升 package.json → `build:core -- --sync`（若改 core）→ 提交 local → 推 local（CI/APK）→ 镜像 dev（Pages）→ 打 tag → 部署 Edge + parity 5/5 → 打包 zip → 传网盘。任一版本号不一致 = 事故；缺后端 = 漂移事故。

---

## 8. 故障排查（动作表）

| 症状 | 根因（结论） | 修复动作 |
|---|---|---|
| 进战黑屏 | 云端 startBattle 在战斗屏挂载后才发 | `PreBattle.confirm()` 布阵完成即发 |
| battles 全 `active` / checksum 空 | 前端未调 abandonRun/ackBattle | IntermissionHub「放弃」→ lost；结算回传 checksum |
| 开局 401 | 写操作需 auth.user；匿名无身份 | 项目开匿名登录 + 匿名会话 |
| 一直卡第一层 | setLayer 误加 Remote 短路 | setLayer 恢复纯前端；云端 layer 只由 startBattle 推进 |
| verify-parity 5/5 绿但云端 coreVersion 旧 | `build:core` 漏 `--` → 不同步 core.js | 改 `npm run build:core -- --sync` |
| CI 内 parity 绿但云端漂移 | 改 core/functions 未重部署 Edge | 执行 B4（build:core -- --sync → 部署 → parity 5/5）|
| Deploy 401/403 `JWT could not be decoded` | `SUPABASE_ACCESS_TOKEN` 非 `sbp_` 账号 PAT | 换 `sbp_` PAT（account/tokens）重跑（§B4 铁律）|
| dev root `.github` 被镜像覆盖、CI 不触发 | mirror 脚本 base_tree bug 整体覆盖 root | 按 §B2 恢复流程重建 root（保留 `.github`）；以后用 §5.1 克隆覆盖法 |
| 打 tag 422 Reference already exists | tag 名被旧基线占用 | `GET /git/refs/tags/<tag>` 看现指向 → `PATCH -F force=true` 移动到新 commit |
| 本地 build safe-delete | 开发机注入删除 shim | `vite build --outDir dist-tmp` 或 CI 为准 |
| 长文件名 `File name too long` | Runner 加密层 FS 单名 ~143 字节上限 | `docs/` 改名 ≤60 字节合法 UTF-8（`git mv`，勿 sparse-checkout 绕）|
| bash `git/gh/head/cat` command not found | Bash shim 清空 PATH | §5.2 绝对路径 + Python subprocess |

> 以上每条的**完整复盘、时间线、根因推导**见 [CICDHISTORY.md](./CICDHISTORY.md)。

---

## 9. 安全基线（已落实 / 已知边界）

- ✅ anon/authenticated 无法直调 `handle_new_user`（SECURITY DEFINER 防绕过 RLS）
- ✅ RLS：用户只见自己的 run/battle
- ✅ 写操作幂等（idempotency_keys）+ 乐观锁（version）
- ✅ 匿名试玩可玩，写操作必须带有效用户 JWT
- ⚠️ 已知边界（生产化前加固）：anon 可写 runs/battles；建议补「单用户最多 3 局 active」+「battles 只能引用自己 run_id」限流

---

## 10. deploy-supabase.yml 模板（已建 ✅，防后端漏部署根治）

> dev 仓 `.github/workflows/deploy-supabase.yml`（commit df76ba8）+ 3 个 secret 已配置；`workflow_dispatch` 验证 run `31508724418` success。`push` 命中 `infinite-arena/supabase/functions/**` 或 `infinite-arena/packages/core/**` 即自动部署 + parity 闸门。

```yaml
name: Deploy Supabase Edge + Parity Gate
on:
  push:
    branches: [master]
    paths:
      - 'infinite-arena/supabase/functions/**'
      - 'infinite-arena/packages/core/**'
  workflow_dispatch:
permissions:
  contents: read
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: ./infinite-arena/package-lock.json
      - name: Install
        working-directory: ./infinite-arena
        run: npm ci
      - name: Rebuild core + verify sync
        working-directory: ./infinite-arena
        run: npm run build:core -- --sync   # ⚠️ 必须 -- 分隔
      - name: Deploy Edge Function (Management API)
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: |
          python - "${{ secrets.SUPABASE_ACCESS_TOKEN }}" <<'PY'
          import os, sys, json, requests
          token = sys.argv[1]
          base = "infinite-arena/supabase/functions"
          parts = []
          for dp, _, fs in os.walk(base):
              for f in fs:
                  p = os.path.join(dp, f); rel = p.replace(os.sep, "/")
                  parts.append(("file", (rel, open(p, "rb"), "application/octet-stream")))
          parts.append(("metadata", (None, json.dumps({
              "verify_jwt": False,
              "entrypoint_path": "supabase/functions/game/index.ts",
              "import_map_path": None,
          }), "application/json")))
          r = requests.post(
              "https://api.supabase.com/v1/projects/kohvqyullvhuwyyxltqa/functions/deploy?slug=game&bundleOnly=false",
              headers={"Authorization": f"Bearer {token}"}, files=parts, timeout=300)
          print(r.status_code, r.text[:400])
          if r.status_code != 201: sys.exit(1)
          PY
      - name: Parity gate (local vs cloud, 5/5)
        working-directory: ./infinite-arena
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
        run: node scripts/verify-parity.mjs   # 含「引擎漂移」即失败
```

**启用（一次人工配置，之后全自动）**：
```bash
gh secret set SUPABASE_ACCESS_TOKEN --repo cooljack9/infinite-arena-dev --body "<SUPABASE_PAT>"
gh secret set SUPABASE_URL        --repo cooljack9/infinite-arena-dev --body "https://kohvqyullvhuwyyxltqa.supabase.co"
gh secret set SUPABASE_ANON_KEY   --repo cooljack9/infinite-arena-dev --body "<anon key，来自 .env.production>"
```
