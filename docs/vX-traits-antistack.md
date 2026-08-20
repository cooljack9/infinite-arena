# 角色特性扩展 vX · 反堆一人轻量方案 · 开发文档

> ⚠ **版本体系已统一**：本仓自 **v2.0.0** 起收敛为**单一版本基线** —— `package.json`、`CORE_VERSION`、git tag、压缩包、线上 Pages、全部文档共用唯一版本号 `2.0.0`。本文标题与正文中出现的其它 `vX.Y.Z` 均为**历史里程碑代号**，不再具有发布号效力（详见 `docs/INDEX.md`「版本体系」）。

> 版本基线：`infinite-arena@1.8.0`（antistack 分支）。
> 本文档对齐实现，覆盖两部分需求：① 反堆一人轻量方案**删除集中度闸门**（均衡队也会遇到死士）；② 新增 6 个「在基础数值上额外独立乘」的角色特性，且**所有角色随机产生特性**。
> 全链路测试全绿（见 §7）。所有 `[PLACEHOLDER]` 标记的数值为设计初值，待 playtest 校准。

---

## 0. 一句话结论

敌人按层低频给部分敌人打「针对最强」标记（同归于尽 / 捆仙绳），**不再区分队伍是堆一人还是均衡**；玩家每个英雄（含模板）在生成时从 15 种特性池随机抽到一种，新加的 6 种全是「对基础数值额外独立乘」的乘区，不污染既有百分比链路。

---

## 1. Fun Hypothesis & Design Pillars

- **Fun Hypothesis**：「一个神装单体 solo 全场」的爽感来自堆数值，但无聊且不可反制；用**结构性针对**（敌人专门处理最强单位）+ **个体随机特性**（每局每角色手感不同）制造「这局这队该怎么打」的决策，而不是「谁数值高谁赢」。
- **Design Pillars**（不可妥协的体验标准）：
  1. 死士**不能每关都出**——靠层深 + 概率 + 每场上限三层节流，否则变成随机性碾压。
  2. 均衡队**不豁免**死士——用户明确「不需要回避均衡队」，针对性是普适的。
  3. 新特性全是**独立乘区**——叠加在既有百分点上，不与其他 % 源线性膨胀成指数灾难。
  4. 特性**随机但确定性**——同 seed 同结果，回放/反作弊/复现不被破坏。

---

## 2. 反堆一人：轻量结构方案

### 2.1 两条敌人规则
| 标记 | 来源 | 效果 | 概率 |
|---|---|---|---|
| `focusRole: 'front'`（前排敌，射程 ≤ 2.5） | 死亡时 | 同归于尽：按 `frontMutualP` 带走我方当前最强英雄 | `frontMutualP = 0.30` `[PLACEHOLDER]` |
| `focusRole: 'back'`（后排敌，射程 > 2.5） | 施法时 | 捆仙绳：按 `backShackleP` 同时定身（stun）我方最强 + 施法怪自身；任一方死亡即解除 | `backShackleP = 0.40` `[PLACEHOLDER]` |

### 2.2 调度（「不能每关都出」）
- `onsetFloor = 8`：前 7 层自由试错，第 8 层起才出现死士。
- `applyChance = 0.18`：深层也只有约 1/5 敌人带标记，一波里通常 0~2 个。
- `maxFrontPerBattle = 2` / `maxBackPerBattle = 1`：每场最多 2 次换命 + 1 次封印，节奏可控。
- 召唤物 / Boss **不打标**（`isSummon` / `isBoss` 跳过）。

### 2.3 vX 变更：删除集中度闸门
- **移除** `concentration()` / `focusGate()` 与 `EnemyFocusCfg.gateLow/gateHigh`。`applyEnemyFocus` 现在只看 `layer ≥ onsetFloor` 与 `rng() < applyChance`，**与队伍集中度无关**。
- 含义：均衡队与堆一人队走同一套逻辑，都会按概率被打标。原「均衡队战斗结果与机制不存在逐 bit 一致」的零侵入保证**已主动放弃**（用户需求）。
- 死士徽记（UI）：渲染层在带标记敌人头顶画红色倒三角，`front` 描金边、`back` 描青边（`src/render/frame.ts`），让玩家**看见威胁**再决定走位。

---

## 3. 角色特性池：所有角色随机产生

- **旧**：`HEROES` 模板每个英雄绑死一个 `traitId`（铁壁镇守=坚壁、无形剑客=魔刃……），9 个角色玩法同质化、且「千人一面」。
- **新**：`HEROES` 模板**不再绑特性**（`traitId: undefined`）；`variateHero` 在生成时调用 `rollTrait(rng)` 从**全池 15 种**等权随机分配一个。已生成 / 已存档副本的 `traitId` 保留（`??` 短路），满足旧存档兼容。
- **确定性**：`rollTrait` 消费调用方种子流一次，同 seed 必得同特性（smoke / integration / vitest 均有断言）。

---

## 4. 六个新特性

> 统一纪律：所有动态效果在 `battle.ts` 钩子里处理，静态削在 `makeAlly → applyTraitStatic` 里用 `staticMul` 独立乘；不碰经济源汇（见 §5）。

| # | 特性 | 触发 | 数值（TRAIT_CFG） | 接入钩子 | 设计 rationale |
|---|---|---|---|---|---|
| 1 | **愤怒燃烧者** fury | 每有 1 名友军英雄阵亡 | 双攻 & 攻速 **+10%**（独立乘，可叠加） | `killIfDown` → 遍历 fury 友军 `pDmg/mDmg/atkSpeed ×1.10` | 惩罚减员、奖励翻盘；独立乘避免与装备 % 叠成指数。 |
| 2 | **大心脏** heart | 4s 滚动窗口内累计受伤 < 50% 最大生命 | 回血 50% 最大生命；永久 +2% 攻速、+2% 双攻 | `tick` 窗口求值；`traitOnHit` 累计 `heartLoss` | 奖励消耗战 / 拉扯，克制爆发；窗口制防「站桩白嫖」。 |
| 3 | **慢热型** slowburn | 开局削 + 之后每秒成长 | 开局 攻速 ×0.7 / 双攻 ×0.6；之后**每秒全属性 +2%**（独立乘） | `makeAlly` staticMul + `tick` 每秒 `×1.02` | 反 rush、奖励长局； ramp 用独立乘，封顶靠战斗时长而非硬上限。 |
| 4 | **时空拓印** spacetime | 布阵任意格；3s 内累计受伤 > 30% 最大生命 | 瞬移到 ≥4 格外（每 6s 最多一次） | `deployableFor`（全图可站）/ `tick` 窗口 + `teleportAway` | 位置安全阀门；全图布阵给操作上限，瞬移给保命下限。 |
| 5 | **归来者** returner | 每场可死一次 | 防御恒 0；死亡随机 1 项非防御属性永久 +4%（带出）；复活后 体型 +30% / 射程 +2 / 攻速·移速 +15% / 每秒流失 8% 生命 | `killIfDown` 复活分支 + `tick` 流失 | 玻璃大炮 + 第二条命；流失是软 sink，避免「复活即无敌」。 |
| 6 | **成长者** grower | 开局削 + 每次击杀/助攻 + 仅 3 装备 + 30% 秒杀更小体型 | 开局全属性 ×0.85 / 体型 −30%；每次击杀/助攻 全属性 +10%（独立乘）+ 体型 +0.2%~1%；仅 3 装备槽；30% 概率秒杀体型更小敌人 | `makeAlly` staticMul+sizeScale / `killIfDown` 成长 / `applyDamage` 秒杀 / `equipCapFor=3` | 雪球型；**3 装备槽是防通胀的 sink**，限制其滚雪球幅度。 |

### 4.1 数值初值（待 playtest）
- fury：`furyPerDeathPct = 0.10`
- heart：`heartWindow = 4` / `heartHealPct = 0.50` / `heartAsPct = 0.02` / `heartDmgPct = 0.02`
- slowburn：`slowRampPct = 0.02`（每秒全属性）
- spacetime：`stWindow = 3` / `stLossPct = 0.30` / `stMinDist = 4` / `stCd = 6`
- returner：`reviveHpPct = 0.60` / `bodyPct = 0.30` / `range = 2` / `asPct = 0.15` / `msPct = 0.15` / `drainPct = 0.08` / `permanentPct = 4`
- grower：`bodyPct = 0.30` / `rampPct = 0.10` / `instakillP = 0.30` / `bodyMin = 0.002` / `bodyMax = 0.010` / `equipCap = 3`

---

## 5. 经济与系统交互

- **Sources & Sinks 体检**：6 个新特性**不引入任何新货币源**（无新金币/装备产出）；全部是战斗乘区。
  - 唯一新增 sink：**成长者 3 装备槽**——限制其装备滚雪球，避免后期单机碾压。
  - 归来者 8%/s 流失是**战斗内软 sink**（逼玩家速战速决），不进经济。
  - 死士机制纯战斗，无经济副作用。
- **系统交互矩阵**：
  - spacetime 全图布阵 ↔ FormationEditor 绿区：`deployableFor(hero)` 对 spacetime 走 `allStandable`，其余走原 `isDeployable`（左 1–6 列）。
  - 成长者 3 槽 ↔ 装备系统：前端 `equipCapOf` 与引擎 `equipCapFor` 同源（`growerEquipCap = 3`），预览/一键装备/上限拦截统一。
  - 死士徽记 ↔ 渲染：仅视觉提示，不改动索敌/伤害逻辑。
- **无新增系统打架风险**：新特性全部落在既有钩子（killIfDown / traitOnHit / applyDamage / tick / makeAlly），未新增全局状态机。

---

## 6. 调参入口（集中管理）

- 敌人针对：`EnemyFocusCfg`（`packages/core/src/engine/coherence.ts`）。
- 特性数值：`TRAIT_CFG`（`packages/core/src/content/traits.ts`）。
- 特性静态乘区：`TRAITS[id].staticMul` → `applyTraitStatic`（在装备/体型/性别之后，独立乘）。
- 调参应通过 tuning.json override `overrideEnemyFocus` / `TRAIT_CFG`，不改硬编码。

---

## 7. 全链路测试结论（全绿）

| 闸门 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | ✅ |
| 确定性守卫（无 banned 调用） | `npm run guard` | ✅ |
| 回放逐 bit 一致（parity） | `npm run parity` | ✅ 5 seed × layer 全通过 |
| 冒烟（脚本） | `npm run smoke` | ✅ ALL PASS |
| 集成 | `npm run integration` | ✅ ALL PASS |
| 单元（vitest） | `npm run test` | ✅ 29 passed（含重写后的 `coherence.test.ts` 12 + `battle.smoke.test.ts` 8） |
| 生产构建 | `npm run build` | ✅ 452 KB / gzip 159 KB |
| 全链路 verify | `npm run verify` | ✅ typecheck+check-templates+guard+smoke+integration+backend 全过 |

### 测试随实现更新
- 因「模板不再绑固定特性」，原断言「9 英雄全部绑定特性 / 9 种特性互不重复」改为「variateHero 分配池中有效特性 + 跨种子覆盖多种」；并新增**确定性单元校验**（slowburn ×0.7/×0.6、grower ×0.85/体型−30%、returner 防御=0），比日志关键词更硬。
- 治疗职业伤害占比探针：钉死三人原特性（momentum/volley/grace）还原标定基线——随机化会漂移队伍 DPS/奶量，使 <15% 阈值失去参照。
- 集中度闸门测试整体移除（concentration/focusGate 已删）。

---

## 8. 已知风险 / 待 playtest

- `[PLACEHOLDER]` 全部数值（§4.1）为初值，需实机校准：重点关注慢热型后期是否过强、归来者 8%/s 流失是否过软、成长者 30% 秒杀是否破坏体验。
- 特性随机后，单局强度方差变大——需在无尽曲线上验证不出现「随机到垃圾特性必败层」。
- 死士 `applyChance = 0.18` 在深层高密度敌人下是否仍「不每关都出」，需高层实测。
