# 无限勇者竞技场 · CI/CD 与数据库部署维护文档（v1.0.0）

> 第一个稳定大版本的工程交付文档。覆盖：双仓结构、CI 六闸门、CD 发布、Supabase 数据库部署/维护/备份、Edge Function 部署、监控与故障排查。
> 配套文档：[ARCHITECTURE.md](./ARCHITECTURE.md)

---

## 1. 仓库与交付拓扑

```
infinite-arena-dev（私有，开发主仓）          infinite-arena（公开，线上）
├─ infinite-arena/      应用源码（权威）        ├─ master   ← Pages 产物（dist，自动）
├─ .github/workflows/                            └─ main     ← 源码镜像（自动）
│   ├─ ci.yml     质量闸门（六道）
│   └─ deploy.yml 发布（产物→公仓 master + 源码→公仓 main）
└─ 无限勇者竞技场_*.md   设计文档（镜像到公仓 docs/）
```

- **线上地址**：https://cooljack9.github.io/infinite-arena/（Pages legacy 模式：branch=master, path=/）
- **数据库**：Supabase 项目 `kohvqyullvhuwyyxltqa`（infinite-arena，Tokyo / ap-northeast-1）
- **Edge Function**：`game`（Deno + supabase-js）

## 2. CI：质量闸门（.github/workflows/ci.yml）

触发：push/PR 到 master（路径 `infinite-arena/**` 或 ci.yml）+ 手动 `workflow_dispatch`。

六道闸门（全部通过才绿，任一失败标红）：

| # | 闸门 | 命令 | 作用 |
|---|---|---|---|
| 1 | Typecheck | `npm run typecheck` | tsc --noEmit 零类型错误 |
| 2 | Guard | `npm run guard` | **确定性闸门**：扫 packages/core/src，禁止跨引擎不确定运算（Math.random/Date.now 直用等） |
| 3 | Smoke | `npm run smoke` | 战斗引擎冒烟（含受控数值探针） |
| 4 | Integration | `npm run integration` | 全流程集成（开局→战斗→结算→经济闭环） |
| 5 | Unit | `npm run test` | vitest 单测 |
| 6 | Build | `npm run build` | vite 生产构建（产物可发布） |

> 注意：本地 `npm run build` 可能被开发环境的安全删除钩子拦截（`emptyDir(dist)` 转回收站），**CI 环境无此钩子**，构建以 CI 为准。本地验证可 `vite build --outDir <新目录>`。

## 3. CD：发布（.github/workflows/deploy.yml）

触发：push 到 master（infinite-arena/** 或 deploy.yml）+ `workflow_dispatch`。**concurrency 防并发发布**。

流程：`checkout → npm ci → 三道前置闸门（typecheck/smoke/integration，失败即不发布）→ build（BASE_PATH=/infinite-arena/）→ 双推`：

1. **产物 → 公仓 master**：`dist/` 目录 git push --force（Pages 源，一推即自动发布）
2. **源码 → 公仓 main**：应用目录 + 设计文档镜像

> 私仓免费方案无法启用 Pages，故采用"私仓开发 + 公仓发布"双仓方案。

## 4. 数据库部署与维护（Supabase）

### 4.1 结构（migrations）

| 文件 | 内容 |
|---|---|
| `0001_schema.sql` | runs（快照+seed+乐观锁 version）/ battles / idempotency_keys 表 |
| `0002_rls.sql` | 行级安全：用户只见自己的 run / battle；profiles 触发器 |
| `0003_views_leaderboard.sql` | 排行榜物化视图 |
| `0004_security_hardening.sql` | REVOKE handle_new_user 的 PUBLIC 执行权限（防绕过 RLS） |

### 4.2 应用迁移（db push）

```bash
# 密码含特殊字符必须 URL 编码（编码脚本见 _db-push.cjs，勿手写 URL）
supabase db push --db-url "postgresql://postgres:<URL编码密码>@db.<ref>.supabase.co:5432/postgres"
# 或走 IPv4 连接池（本机 IPv6 直连不可达时）：
#   aws-0-ap-northeast-1.pooler.supabase.com:5432
```

> 项目刚创建时 DNS 可能只解析到 IPv6（本机不可达）——等几分钟或直接用 pooler。

### 4.3 Edge Function 部署

```bash
supabase functions deploy game --project-ref <ref> --use-api   # --use-api 免本地 Docker
```

**部署前必须通过 `deno check`**（本地装 deno，用 dl.deno.land 镜像 + `--ssl-no-revoke`）：

```bash
DENO_NPM_REGISTRY=https://registry.npmmirror.com deno check --node-modules-dir=auto supabase/functions/game/index.ts
```

关键约束：
- `_shared/core.js` 与浏览器端**同字节**（`npm run build:core --sync` 生成 + 同步）
- 类型声明目录 `_shared/core-types/` 由 tsc 生成 + 脚本补 Deno 显式 `.d.ts` 后缀（Deno 要求）
- **任何 core/契约改动 → 重建 core → 同步 dev-new → 重新部署 Edge**（部署一次成功，勿反复试错）

### 4.4 备份与恢复

- 日常：Supabase 平台自动备份（Dashboard → Database → Backups，免费档每日）。
- 手动快照：`supabase db dump --db-url <url>`（schema + data）。
- **无独立恢复演练需求**（MVP 阶段数据可重建：表结构来自 migrations，游戏数据可重开）。

### 4.5 监控

- Edge Function 日志：Dashboard → Edge Functions → `game` → Logs；或 Management API `GET /v1/projects/<ref>/functions/game/logs`。
- 数据健康：`runs` 表行数 / version 递增 / battles checksum 各异（脚本 `_dbg-db.mjs` / `_dbg-battles.mjs` 用 deno + supabase-js 直查）。
- **云端 parity 巡检**：`npm run parity`（5 种子本地 vs 云端 checksum `17fc2ac17cd4bb` 一致 = 引擎无漂移）。

## 5. 版本发布流程（首个大版本 v1.0.0 起）

1. **全链路终测**：`_full-check.mjs` 13 项（匿名登录→开局→战斗→经济→层推进→parity→401 防护）+ 升星/重铸/购买云端实测。
2. 更新 package.json `version` → `1.0.0`（+ 本文件/README 同步）。
3. 提交推送 dev 仓 → 手动触发 CI + deploy（或自动触发）。
4. 打 tag：`git tag v1.0.0` + 推送（GitHub Releases 可选）。
5. 公仓 Pages 自动更新，线上验证 HTTP 200 + 产物版本。
6. **交付包 → 微云（唯一发布源，V2.3 起必须）**：见 §5.1。

### 5.1 微云交付（交付包唯一权威存档）

> 原则（来自《CI/CD 规范》V2.3）：完整包（源码+文档 zip）**只放微云**，GitHub 公私仓不保留任何 zip；微云是交付包唯一发布源与兜底，**长期存留不删**。

1. **打包**：`git archive --format=zip HEAD -o base.zip infinite-arena`（dev 仓）→ 用 python 把仓库根 `无限勇者竞技场_*.md` 追加进 `infinite-arena/docs/` → 产出 `infinite-arena-vX.Y.Z-<sha>.zip`（约 1MB）。
2. **上传**（WorkBuddy 微云连接器，`mcp__tencent-weiyun__weiyun.upload`）：
   - 先 `gen_block_info_list.py <zip>` 计算两阶段上传参数（file_sha / block_sha_list / check_sha / check_data，流式 SHA1 内部状态，脚本内置实现）
   - `weiyun.upload` 预上传（filename/file_size/file_sha/block_sha_list/check_sha/check_data/file_md5/pdir_key=根目录 key）
   - `file_exist=false` 时按返回 channel_list 逐片 `weiyun.upload`（upload_key/ex/channel_id/file_data=分片 base64）
   - 或直接跑 `upload_to_weiyun.py <zip> --token <mcp_token> --pdir_key <根目录key>`（脚本内置分片+重试）
3. **补传文档 md**：README / ARCHITECTURE / CICD 等经 upload 上传到根目录或 `无限勇者竞技场_vX.Y.Z/` 目录。
4. **定期人工转存网盘**（每 1~2 周）：微云下载最新 zip → 百度网盘 `/pagea`（zip 无法被网盘匿名抓取，人工半自动）。

**微云连接器使用要点**：
- 凭证由 WorkBuddy 应用管理（`connectors/<id>/mcp.json` 注册 + 加密 credentials），**MCP 工具调用时自动注入 WyHeader**，无需 mcporter。
- 根目录 pdir_key 从 `weiyun.list` 响应顶层获取（如 `c1172c2bf0a739ae12b58dcd423dce4a`）。
- 已归档：`infinite-arena-v2.9.14-877d639.zip` / `infinite-arena-v3.1.0-d9c55bc.zip` / `infinite-arena-v1.0.0-0545c87.zip`。

## 6. 故障排查清单（实战沉淀）

| 症状 | 根因 | 修复 |
|---|---|---|
| 开局 401（选角色没反应） | 云端写操作要求 auth.user；匿名试玩无身份 | 项目开匿名登录（Management API PATCH external_anonymous_users_enabled=true）+ RemoteBackend 匿名会话（signup + localStorage 缓存） |
| 一层打完后画面不动 | `insertRun` 缺 user_id/version、**错误被静默吞掉**（无 error 检查）→ startRun 假成功、DB 无记录 → startBattle RUN_NOT_FOUND | insertRun 补字段 + **失败必须抛**（ErrCode DB_ERROR）；saveRun 判定改 `data.length`（PostgREST update 的 count 恒 null） |
| 一直卡第一层 | `setLayer` 被误加 Remote 短路 + inter next() 手动 +1 与云端推进语义冲突 | setLayer 恢复（纯前端导航）；云端 layer 只由 startBattle 权威推进 |
| 宝箱全开只开一部分 | 逐箱并发写 → 乐观锁 version 互踩 | 批量命令 `openDrops`（单次写） |
| 云端 BOOT_ERROR | core 缺 upgradeHero（LocalBackend 占位未提升）/ ports.deno.ts 首行 `#` / 类型声明缺 `.d.ts` 后缀 | deno check 本地复现后一次修好再部署 |
| 本地 build 报 safe-delete | 开发环境注入删除 shim（CI 无此问题） | `vite build --outDir <新目录>` 跳过 emptyDir，或以 CI 构建为准 |
| mock e2e 假失败（ITEM_GONE） | mock 进程残留旧局状态 | 重跑前 `netstat` 查 8787 PID + `taskkill`，重启干净 mock |

## 7. 安全基线（v1.0 已落实）

- ✅ anon/authenticated 无法直调 `handle_new_user`（SECURITY DEFINER 防绕过 RLS）
- ✅ RLS：用户只见自己的 run/battle
- ✅ 写操作幂等（idempotency_keys）+ 乐观锁（version）
- ✅ 匿名试玩可玩（匿名登录），写操作必须带有效用户 JWT
- ⚠️ 已知边界（生产化前需加固）：anon 可写 runs/battles（MVP 设计）；建议补"单用户最多 3 局 active"+"battles 只能引用自己的 run_id"限流；密码泄露检测不适用（匿名无密码）
