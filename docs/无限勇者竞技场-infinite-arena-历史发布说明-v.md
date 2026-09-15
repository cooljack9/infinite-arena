# 《无限勇者竞技场》（infinite-arena）历史发布说明（v2.3 – v2.6）

> ⚠ **版本体系已统一**：本仓自 **v2.0.0** 起收敛为**单一版本基线** —— `package.json`、`CORE_VERSION`、git tag、压缩包、线上 Pages、全部文档共用唯一版本号 `2.0.0`。本文标题与正文中出现的其它 `vX.Y.Z` 均为**历史里程碑代号**，不再具有发布号效力（详见 `docs/INDEX.md`「版本体系」）。

**文档版本**：合并版 V1.0
**修订日期**：2026-08-07
**说明**：原  /  /  /  四个文件合并为本篇，便于集中查阅历史发布记录。

---

## RELEASE v2.3

# 无限勇者竞技场 v2.3 发布说明

> 提交：`6178b4d`（本地已提交，待 push `master` 触发 CI/CD 自动部署公仓）
> 质量闸门：typecheck / 模板校验 / smoke / integration 全绿；build 产物正常

## 新需求落地

### 1. 像素贴图升级到 Steam 独立游戏水平
- `src/render/sprite-templates.ts`：9 个 20×20 角色模板 + 3 个 14×14 召唤模板，13 字符材质分层（金属/皮革/布料/皮肤/能量各自独立）。
- `src/render/sprites.ts` 重写：离屏 1:1 光栅化 + 缓存 + nearest 放大（每组合只光栅化一次）、选择性描边（主色压暗而非纯黑）、像素级 bloom（g/e 索引向四邻溢出，不用 shadowBlur）。
- 新增 `scripts/check-templates.mjs` 行宽校验脚本，已接入 `npm run verify` 闸门。

### 2. Boss 体型与技能更霸气
- `types.ts` BodyType 新增 `titan` 档；`classes.ts` BODY_INFO 新增 titan（renderPx 62 / sizeMult 1.85 / hpMult 2.20，碾压级体积）。
- 三个 Boss（巨像 / 虚空吞噬者 / 残影之王）全部绑定 `titan`；`frame.ts` 触发 Boss 强化渲染（暗红外描边 + 双层辉光 + 更强落地影）。
- 引擎层：`titan` 免疫击退与禁锢；分裂出的分身降档为 `colossal`。

### 3. 技能特效 / 控制 / 声音明显区分度
- 视觉：眩晕=旋转金星（黄）、定身=脚下绿锁链（绿）、嘲讽=头顶红箭头+脉冲红环（红），与减速冰蓝弧四色正交。
- 音效：`types.ts` + `sfx.ts` 新增 `cc_stun` / `cc_root` / `cc_taunt` 三类控制独立音色，在施法点实时触发。
- `skills.ts`：VFX_SCALE 1.4→1.5，Boss 覆盖色更红更大（践踏/吞噬/分裂）。

### 4. 战斗前可调整站位
- `src/game/gen/formation.ts`（纯函数布阵逻辑）+ `src/screens/FormationEditor.tsx`（点选+落点 UI，4 预设阵型 + 敌方列阵预览），经 store 状态层贯通 PreBattle / BattleScreen，所见即所战。

### 5. 试玩界面去除借鉴文案
- `MainMenu.tsx` 删除"参考：角斗士公会经理"字样，全局 grep 确认无残留。

## 变更文件（19 files, +1338 / −381）
`package.json` `package-lock.json` `src/types.ts` `src/audio/sfx.ts` `src/game/content/{classes,enemies,skills}.ts` `src/game/engine/{battle,unit}.ts` `src/game/state/store.ts` `src/render/{frame,sprites}.ts` `src/render/sprite-templates.ts` `src/screens/{BattleScreen,MainMenu,PreBattle,FormationEditor}.tsx` `src/game/gen/formation.ts` `scripts/check-templates.mjs`

## 待办
- `git push origin master`：当前沙箱网络拦截 GitHub 出站连接（Connection reset），需在可联网环境执行以触发 CI+CD 自动发布到公仓 Pages 与源码镜像。

---

## RELEASE v2.4

# 无限勇者竞技场 v2.4 发布说明

> 版本：`package.json` 2.4.0（version_note 同步）
> 质量闸门：`npm run verify`（typecheck / check-templates / smoke / integration）全绿；`npm run build` 产物正常
> 发布：push `master` 触发 CI+CD 自动部署公仓 Pages 与源码镜像（见 `无限勇者竞技场_Git与CI_CD规范.md`）

## 新需求落地（5 项）

### 1. 难度曲线平滑（需求 #1）
- `src/game/engine/scaling.ts` 的 `segmentMult(n)` 原在 10/30/60 层阶梯跳变（1 → 1.3 → 1.6 → 2），造成「过一层突然难一大截」的悬崖感（10→11 层敌人强度 +36%）。
- 改为随层深连续线性增长：`Math.min(1.9, 1 + 0.008 * Math.max(0, n - 1))`（每深 1 层 +0.8%，封顶 1.9）。与 `enemyScale` 亚线性 √(n/20) 缩放叠加后整体平滑，玩家构筑收益持续有效，不再有突兀难度台阶。

### 2. 布阵射程圈居中修复（需求 #2）
- 根因：网格容器是 block 级 flex item 会撑满宽度，`justifyContent:'center'` 把网格轨道整体右移，而叠加的绝对定位射程圈从 padding 盒左缘 0 起算，导致圈偏左、不以小兵为中心。
- `src/screens/FormationEditor.tsx` 改为 `width:'fit-content'`（网格贴合内容，轨道从 padding 盒左缘 0 起排）+ `alignSelf:'center'`（在父容器水平居中）。射程圈绘制逻辑（left:6 + floor(x)*(CELL+1) + CELL/2）与真实格中心对齐，修复错位。

### 3. 射程站位教学（需求 #3）
- `src/game/content/tutorial.ts` 在 `layer 1 / screen:'pre'` 新增 2 个教学点（「射程与站位」「怎么摆」），锚定 `PreBattle` 的 `id="tut-formation"`（战前布阵标题）。
- 文案讲清射程圈含义（能打到的最远格数）与前后排站位对输出/承伤的影响，降低新手布阵门槛；与 v2.3「战前可调整站位」联动。
- `scripts/integration.ts` 教学断言同步为 6 组 / 层序 `[1,1,2,3,4,5]` / 含 `tut-formation`。

### 4. Boss 关卡密度提升（需求 #4）
- `src/game/engine/scaling.ts` 新增 `bossTierAt(n, mode)`：每 5 关 `'strong'`（titan 体型、最霸气），每 3 关 `'normal'`（colossal 体型、压制感但非碾压）；新手模式（`mode==='novice'`）仅封顶层（`n >= NOVICE_CAP=5`）放一个普通 Boss 作收尾，保持入门温和。
- `src/game/content/enemies.ts` 新增 3 个 colossal 普通 Boss：角斗场守卫（物理坦克）/ 预言魔像（魔法坦克）/ 血色劫掠者（辟邪剑）；导出 `NORMAL_BOSSES`（colossal 池）/ `STRONG_BOSSES`（titan 池）；`bossSkill` 增加 mini-boss 分支。
- `src/game/gen/encounter.ts` 的 `buildWaves(rng, n, bossTier)` 按 tier 从对应池取 Boss 波；`src/game/gen/levelGen.ts` 的 `genLayer` 注入 `bossTier` 并 `ensureBossPlatform(arena)` 保证 A1/A3/A6 等原布局无 Boss 台时也注入 2×2 `B` 块；`LayerPlan` 新增 `bossTier?: 'strong' | 'normal'`。

### 5. 允许失败 2 次（需求 #5）
- `src/types.ts` 的 `RunState.failures: number`（本局已用掉的失败次数，初始 0）；`src/game/state/store.ts` 新增 `setFailures(n)` 并接入 `startRun` 归零。
- `src/screens/BattleScreen.tsx` 失败分支：前两次 `failures = run.failures + 1` 后 `setScreen('pre')` 退回同一层——因 `run.seed` 不变，**所见即所战、同层敌人完全一致**，玩家可在原布阵上修正重试；第 3 次失败才 `finishBattle(false, layer, score)` 真正终结。
- `src/screens/PreBattle.tsx` 状态行显示「剩余容错：N 次」（`Math.max(0, 2 - failures)`）；`src/screens/ResultScreen.tsx` 在 `!win && failures >= 3` 时打「已用完 2 次容错机会，本局终结」标签。
- 铁人模式：容错重试仅在同层重打、不触发 `removeDeadAllies`；永久死亡仍只在胜利结算时移除阵亡勇者。

## 文档对齐
- `无限勇者竞技场_开发文档.md`：§6.7 教学系统更新为 6 组 / 层序 `[1,1,2,3,4,5]` 并新增 §6.7.1 射程站位教学；新增 §6.8 容错机制；§7 关卡生成 snippet 改为 `bossTierAt` + `ensureBossPlatform` + 连续 `segmentMult`，并补充 v2.4 难度曲线 / Boss 密度说明；§12 新增 §12.6 v2.4 实现清单。
- `src/game/content/tutorial.ts` 头部注释同步为 v2.4 结构。

## 变更文件（13 files）
`package.json` `package-lock.json`（版本号） `src/types.ts` `src/game/engine/scaling.ts` `src/game/content/enemies.ts` `src/game/content/tutorial.ts` `src/game/gen/encounter.ts` `src/game/gen/levelGen.ts` `src/game/state/store.ts` `src/screens/BattleScreen.tsx` `src/screens/FormationEditor.tsx` `src/screens/PreBattle.tsx` `src/screens/ResultScreen.tsx` `scripts/integration.ts` `无限勇者竞技场_开发文档.md`

## 待办
- `git push origin master`：触发 CI+CD 自动发布公仓 Pages 与源码镜像（设计文档同步到公仓 `main/docs/`）。

---

## RELEASE v2.5

# 无限勇者竞技场 v2.5 发布说明

> 版本：`package.json` 2.5.0（version_note 同步）
> 质量闸门：`npm run verify`（typecheck / check-templates / smoke / integration）全绿；`npm run build` 产物正常
> 发布：push `master` 触发 CI+CD 自动部署公仓 Pages 与源码镜像（见 `无限勇者竞技场_Git与CI_CD规范.md`）

## 新需求落地（2 项）

### 1. 英雄中国风化（需求 #1）
将 9 名勇者及其技能、服装、特效全面中国神话化，服装主色与技能签名色同一色系：

| 子类 | 原勇者 | v2.5 中国风勇者 | 技能（中国风） | 签名色 |
|------|--------|----------------|---------------|--------|
| sniper（弓手） | 鹰眼游侠 | **后羿** | 后羿射日（9 格单体 400% 物伤） | 射日金 `#ffcf4d` |
| summoner（召唤师） | 傀儡召唤师 | **女娲** | 抟土造人（捏泥卫/藤甲仆/灵火童） | 抟土泥绿 `#c79a5a` |
| controller（控制师） | 时停术士 | **太极宗师** | 太极封禁（太极八卦锁 6 格定身） | 太极玉 `#7fe0d8` |
| physTank（法肉盾） | 铁壁守卫 | **玄武镇岳**（前排玄武战将） | 镇岳怒吼 | 玄武蓝 `#5a7bd6` |
| healer（牧师） | 圣光牧师 | **华佗** | 青囊回春（青藤绕身回血） | 青囊绿 `#4fd982` |
| charge（狂袭骑士） | 狂袭骑士 | **关羽** | 青龙偃月斩 | 关公赤 `#ff4d3d` |
| hexblade（剑客） | 噬魔剑客 | **无名剑客** | 无形剑罡（霜白剑气） | 剑客霜白 `#cfe3ff` |
| gunner（枪炮手） | 风暴炮手 | **神机炮手** | 神火霹雳（中国炮兵风） | 神机铜 `#ff9a3c` |
| magicTank | 奥盾祭司 | **符甲战将** | 符甲护盾 | 符甲紫 `#b06bff` |

- `src/game/content/heroes.ts`：9 名勇者改名（`h_sniper`→后羿、`h_summoner`→女娲、`h_controller`→太极宗师、`h_physTank`→玄武镇岳、`h_healer`→华佗、`h_charge`→关羽、`h_hexblade`→无名剑客、`h_gunner`→神机炮手、`h_magicTank`→符甲战将），属性与特性保持不变，仅名称/叙事中国化。
- `src/game/content/skills.ts`：9 个技能改名 + 中国风描述（后羿射日 / 抟土造人 / 太极封禁 / 镇岳怒吼 / 青囊回春 / 青龙偃月斩 / 无形剑罡 / 神火霹雳 / 符甲护盾）；`SKILL_VFX` 签名色板改为中国风（射日金、青囊绿、太极玉、抟土泥绿、关公赤、剑客霜白、神机铜、玄武蓝、符甲紫）。
- `src/game/content/classes.ts`：9 个子类中文名（玄武前排 / 符甲战将 / 武圣突袭 / 无名剑客 / 神机炮手 / 神射手·后羿 / 太极宗师 / 女娲造人 / 青囊神医）+ 服装主辅色与签名色对齐。

### 2. 西方怪物加入（需求 #2）
新增 6 种西方邪恶怪物，拥有**独立像素模板 + 独立调色板**（不走职业模板、不做红染），与英雄视觉完全正交：

- **深渊邪龙**（titan 强力 Boss）：每 5 关接替普通 Boss 出场，技能「焚世龙息」（赤红灼烧 VFX 覆盖）。
- **堕天炽天使**（colossal 普通 Boss）：每 3 关接替出场，技能「堕天审判」（审判金光 VFX 覆盖）。
- **黑渊女巫 / 炼狱恶魔 / 枯骨战士 / 石翼魔像**：常规波次怪，分别复用召唤 / 突袭 / 嘲讽 机制骨架，但拥有专属像素皮与西方风味技能名（咒怨召唤 / 炼狱爆发 / 骸骨突袭 / 石化咆哮）。

实现要点：
- `src/types.ts`：新增 `MonsterKind` 联合类型（dragon / fallen_angel / witch / demon / skeleton / gargoyle），并在 `EnemyDef` 与 `Unit` 上增加 `monsterKind?`。
- `src/render/sprite-templates.ts`：新增 `MONSTER_TEMPLATES`（6 套，均 20×20 行宽一致，经 `check-templates` 校验）与 `MONSTER_PALETTE`（a 主体 / b 辅色 / g 发光 / o 描边）。
- `src/render/sprites.ts`：`drawSprite` 新增 `monsterKind` 分支——独立光栅化缓存键，使用怪物模板与调色板（龙/堕天使走 Boss 强化渲染路径：暗红外描边 + 双层辉光），不参与敌方红染。
- `src/game/engine/unit.ts`：`makeEnemy` 拷贝 `enemy.monsterKind` 到 `Unit`。
- `src/game/content/enemies.ts`：新增西方怪物 `EnemyDef`（带 `monsterKind` 与西方技能名）；dragon/fallen_angel 经 `bodyType` 接入 `STRONG_BOSSES`/`NORMAL_BOSSES`，其余自动进入 `ENEMIES_BY_CAT` 常规波次。

### 3. 太极 / 青囊 VFX（随上述中国风化联动）
- `src/render/frame.ts` 的 `drawEffect`：
  - `zone_control` + `taiji_spin` 运动：旋转八卦环（8 段径向短划代表八卦方位）+ 中央太极阴阳鱼，作为控制师「太极封禁」专属特效。
  - `blessing_field` + `blessing_vine` 运动：从底部上攀的树藤 + 顶端嫩叶光点，作为牧师「青囊回春」专属特效（呼应青囊绿光晕）。
- `src/types.ts`：VfxMotion 新增 `taiji_spin` / `blessing_vine`。

## 文档对齐
- `无限勇者竞技场_开发文档.md`：§6（英雄/技能/配色）、§7（敌人生成）、美术 §7.3（特效）补充 v2.5 中国风英雄、西方怪物、太极封禁 / 青囊回春 VFX 说明；§12 新增 v2.5 实现清单。
- `RELEASE_v2.4.md` 之前的临时脚本 `tmp_gen_monsters.mjs` 清理（如仍存在）。

## 变更文件（约 10 files）
`package.json` `src/types.ts` `src/game/content/heroes.ts` `src/game/content/skills.ts` `src/game/content/classes.ts` `src/game/content/enemies.ts` `src/render/sprite-templates.ts` `src/render/sprites.ts` `src/render/frame.ts` `src/game/engine/unit.ts` `无限勇者竞技场_开发文档.md`

## 待办
- `git push origin master`：触发 CI+CD 自动发布公仓 Pages 与源码镜像（设计文档同步到公仓 `main/docs/`）。

---

## RELEASE v2.6

# 无限勇者竞技场 v2.6 发布说明

> 版本：`package.json` 2.6.0（version_note 同步）
> 质量闸门：`npm run verify`（typecheck / check-templates / smoke / integration）全绿；`npm run build` 产物正常
> 发布：push `master` 触发 CI+CD 自动部署公仓 Pages 与源码镜像（见 `无限勇者竞技场_Git与CI_CD规范.md`）

## 新需求落地（3 项）

### 1. 教学初始装备包（需求 #1）
新手模式开局直接发放 **4 件已开箱装备 = 2 蓝 + 2 白**，让玩家第一时间看懂经济系统：

- 蓝装用于演示「2 蓝 → 1 橙」合成；白装作为**附魔属性转移**素材 + 重铸对象。
- 教学弹窗新增「初始装备包」「白装附魔」两组教学点，与既有升星/卖出/合成/重铸/购买/刷新/射程站位并列；合成产出、附魔销毁素材、刷新结果均有明确 UI 反馈。
- 普通无尽 / 铁人无尽**不发**初始包，保持长线经济。

实现要点：
- `src/game/content/tutorial.ts`：`INITIAL_KIT`（2 蓝 + 2 白，全部 `unlocked`）。
- `src/game/state/store.ts`：`startRun` 新手分支写入背包。
- `scripts/integration.ts`：v2.6 教学组断言（开局 4 件 / 含 2 蓝 / 含 2 白 / 蓝装可合成产出 1 橙 / 附魔后素材白装销毁 / 普通无尽不发）。

### 2. 五星国风坐骑（需求 #2）
角色达到 **5★** 随机解锁坐骑，坐骑技能独立于英雄技能 CD：

- 5 种坐骑（贴合中国风性情，各有独立 CD 技能）：战象（践踏震慑）/ 玄豹（迅袭连爪）/ 猛虎（虎啸威压）/ 赤兔（赤兔冲阵）/ 青牛（蛮牛顶撞）。
- `Unit.mount` + `HeroDef.mount`（经 `rollMount` 解锁）；坐骑技能走 `Unit.mountCd`，由 `castMountSkill` 触发，与英雄 `skillCd` 完全独立。

像素与渲染：
- `src/render/sprite-templates.ts`：新增 `MOUNT_TEMPLATES`（5 套 24×14 侧视，朝右、渲染层 `ctx.scale(-1,1)` 镜像朝左）+ `MOUNT_TPL_W/H`。
- `src/render/sprites.ts`：新增 `drawMount`（按 `MOUNTS[kind].body/accent/dark` 光栅化；步态 `moving` 上下错相摆动 + 技能就绪 `ready` 呼吸辉光环 + 落地影）+ 导出 `MOUNT_RIDER_LIFT`（骑手相对坐骑背脊上抬量）。
- `src/render/frame.ts` 的 `drawUnit`：坐骑存在时**分层绘制**（先 `drawMount` 坐骑下沉、再 `drawSprite` 骑手按 `MOUNT_RIDER_LIFT` 上抬坐于背脊），整组用 `ctx.save(); translate(cx*2,0); scale(-1,1)` 按 `u.facing` 镜像，骑手与坐骑朝向一致。

### 3. 敌方补给建筑（需求 #3）
地图按合理站位**随机刷敌方补给建筑**，要求玩家「权衡拆除」，否则高风险（拆光建筑仍会被已产出的兵拖垮，反之建筑持续产兵）：

- 军帐 barracks：产普通兵（本场上限 **8**）。
- 木塔 / 石塔 / 铁塔：远程造成伤害，塔上各驻 **1~2** 守兵；铁塔熔炉口发光。
- 龙巢 dragon_nest：产幼龙（Boss 幼体，上限 **3**）。
- 龙穴 dragon_lair：额外 **+1 成年龙 + 4 幼龙**。
- 建筑计入敌方胜利条件。

实现要点：
- `src/types.ts`：新增 `BuildingKind` + `Unit.isBuilding/buildingKind/spawnTimer`。
- `src/game/content/buildings.ts`：`BUILDINGS`（6 类，各自 `color/dark/accent` + `spawn` 上限）。
- `src/game/engine/battle.ts`：`tickBuilding` 驱动产兵（受各 `cap` 限制）与塔 `basicAttack` 远程伤害。
- `src/render/sprite-templates.ts`：新增 `BUILDING_TEMPLATES`（6 套 20×20 对称、带功能开口）+ `BUILDING_TPL_SIZE`。
- `src/render/sprites.ts`：新增 `drawBuilding`（不吃 `reshapeByBody`、不吃红染，自有配色 + 红地基环；按 `hpFrac` 下沉压暗 + <35% 余烬、按 `spawnTimer<1.5s` 顶部产兵预警脉冲）。
- `src/render/frame.ts` 的 `drawUnit`：`u.isBuilding` 时跳过阵营蓝环、改调 `drawBuilding`。

### 4. 单位动作表现（v2.6 渲染层消费引擎字段）
引擎在 `battle.ts` 写入动作时刻，`frame.ts` 的 `drawUnit` 统一消费：

| 字段 | 渲染表现 |
|------|----------|
| `u.facing` | 骑手 + 坐骑整组按朝向镜像 |
| `u.attackAnimAt` | 0~100ms 收势后拽、100~320ms 前冲 |
| `u.castAnimAt` | 起手后 280ms 内抬升再落回（吟唱） |
| `u.moveAnimUntil` | 移动中额外上下错相摆动 |

## 文档对齐
- `无限勇者竞技场_开发文档.md`：§12.8 新增 v2.6 实现清单（教学初始装备包 / 五星坐骑 / 敌方补给建筑）。
- `无限勇者竞技场_需求文档.md`：§18 新增 v2.6 需求对齐（18.1 初始装备包 / 18.2 五星坐骑 / 18.3 敌方补给建筑）。
- `无限勇者竞技场_美术与战斗设计.md`：§10 新增 v2.6 坐骑与建筑像素表现 + 单位动作表现表。
- `无限勇者竞技场_Git与CI_CD规范.md`：本版本起补齐 `.github/workflows/ci.yml` 与 `deploy.yml`（此前仅规范未落地）。

## 变更文件
`package.json` `src/types.ts` `src/game/content/tutorial.ts` `src/game/content/buildings.ts` `src/game/content/mounts.ts` `src/game/state/store.ts` `src/game/engine/battle.ts` `src/game/engine/unit.ts` `src/game/gen/levelGen.ts` `src/render/sprite-templates.ts` `src/render/sprites.ts` `src/render/frame.ts` `src/screens/BattleScreen.tsx` `src/screens/Intermission.tsx` `scripts/integration.ts` `scripts/_gen_tpl.py`（新增）` .github/workflows/ci.yml`（新增）` .github/workflows/deploy.yml`（新增）` 无限勇者竞技场_开发文档.md` `无限勇者竞技场_需求文档.md` `无限勇者竞技场_美术与战斗设计.md`

## 待办
- `git push origin master`：触发 CI（四道闸门）+ CD（构建并推送公仓 Pages 与源码镜像，设计文档同步到公仓 `main/docs/`）。

---

