# 接口契约（GameBackend）

> 这份契约是**唯一真理**：`LocalBackend` 与 `RemoteBackend` 实现同一个接口，前端只依赖接口。
> 所有类型直接复用 `src/types.ts` 的既有定义，不重新发明。

---

## 0. 设计原则

1. **命令-查询分离**：`query*` 只读，`do*` 改状态。改状态的一律返回**完整权威快照**，不返回增量。
2. **幂等**：所有写操作带 `idempotencyKey`，重复提交返回同一结果，不重复扣费。
3. **服务端只信自己**：请求里的 `gold` / `tradeCount` / `inventory` 一律忽略，以数据库为准。
4. **错误是数据不是异常**：返回 `{ ok: false, code, message }`，不抛异常（异常无法跨 HTTP 边界保真）。
5. **版本锚定**：每个响应带 `coreVersion`，与前端不一致时前端提示更新。
   自 v2.0.0 起它**与发布版本号统一为同一个号**（当前 `2.0.0`）—— 只要同一个 `battleSeed` 会算出不同结果
   （引擎数学、RNG 消费顺序、平衡数值）就必须升；纯渲染/UI 改动则不升。
   判定表见 `07_跨引擎浮点一致性.md` §6。

---

## 1. 通用信封

```ts
/** 所有写操作的通用请求头部 */
export interface CommandEnvelope {
  runId: string;
  /** 幂等键：客户端生成 uuid v4，3 秒倒计时内连点/重试靠它去重 */
  idempotencyKey: string;
  /** 客户端 core 版本，用于检测版本漂移 */
  coreVersion: string;
}

export type Result<T> =
  | { ok: true; data: T; coreVersion: string }
  | { ok: false; code: ErrCode; message: string; coreVersion: string };

export type ErrCode =
  | 'RUN_NOT_FOUND' | 'RUN_ENDED' | 'STATE_STALE'
  | 'INSUFFICIENT_GOLD' | 'ITEM_GONE' | 'SLOT_FULL'
  | 'LAYER_MISMATCH' | 'TEAM_INVALID' | 'CAP_REACHED'
  | 'FORGE_LOCKED' | 'FUSE_LIMIT' | 'NOT_FUSIBLE'
  | 'VERSION_MISMATCH' | 'RATE_LIMITED' | 'UNAUTHORIZED';
```

**为什么写操作返回完整快照而非增量**：增量需要客户端和服务端对"当前状态"有共识，一旦漂移就无法收敛。完整快照虽然大一点（约 2-8KB），但状态永远一致。这是用带宽换正确性，值得。

---

## 2. 核心状态快照

```ts
/** 一局游戏的完整权威状态。所有写操作都返回它 */
export interface RunSnapshot {
  runId: string;
  /** 乐观锁版本号：每次写 +1；客户端提交时带上，不匹配则 STATE_STALE */
  version: number;

  // ── run 域 ──
  layer: number;
  mode: GameMode;              // 'novice' | 'normal' | 'ironman'
  score: number;
  failures: number;            // 已用失败次数（允许 2 次）
  cap: number;                 // 本模式封顶层（novice=5 / endless=500）
  team: HeroDef[];             // 含 uid / star / growthBonus / mount / personality
  relics: RelicDef[];
  resolvedEvents: number[];
  status: 'active' | 'won' | 'lost';

  // ── economy 域 ──
  gold: number;
  inventory: Equipment[];
  pendingDrops: Chest[];
  equipped: Record<string, Equipment[]>;   // uid -> ≤6 件
  consumables: ConsumableItem[];
  shopStock: ShopStock;
  recruitPool: HeroDef[];
  tradeCount: number;
  refreshCount: number;
  forgedThisLayer: string[];
  fusedThisLayer: number;

  // ── 一次性回执（读取即清，用于 UI 弹窗）──
  receipts: {
    lastBreakthrough?: BreakthroughResult;
    lastMount?: MountResult;
    lastTransferLogs?: TransferLog[];
    lastKillGains?: Record<string, HeroGrowth>;
  };
}

/** 账号级元进度（跨局持久） */
export interface MetaSnapshot {
  bestLayer: number;
  endlessUnlocked: boolean;
  teamPresets: TeamPreset[];
  /** 纯客户端偏好，后端只做同步不做校验 */
  prefs: { battleSpeed: number; colorblind: boolean };
}
```

---

## 3. 战斗接口（核心）

### 3.1 战斗计划（进入战前布阵时调用）

```ts
/** 战前情报：地图、敌方编成、随机奇遇。不含结果 */
export interface BattlePlanDTO {
  layer: number;
  arena: ArenaDef;             // 含 theme / weather / tiles
  enemyPreview: {
    defs: EnemyDef[];
    bossTier?: 'strong' | 'normal';
    eliteBoss: boolean;
    isVacuum: boolean;
    isMutation: boolean;
    mutationRule?: string;
  };
  buildings: BuildingPlacement[];
  spawnAlly: Vec2[];
  spawnEnemy: Vec2[];
  bossPos?: Vec2;
  randomEvent?: RandomEvent;
}

queryBattlePlan(runId: string): Promise<Result<BattlePlanDTO>>;
```

> 战前计划由**后端生成**（`genLayer`），前端不自己算。
> 否则客户端可以枚举 seed 提前偷看 Boss 编成。

### 3.2 开战（5 秒倒计时时序的核心）

```ts
export interface StartBattleReq extends CommandEnvelope {
  /** 玩家布阵：uid -> tile 坐标 */
  formation: Record<string, Vec2>;
  /** 客户端本地时间戳，仅用于埋点分析延迟，不参与计算 */
  clientTs: number;
}

/** 后端权威结算结果 + 前端复现回放所需的全部输入 */
export interface BattleResultDTO {
  battleId: string;
  // ── 回放输入（前端靠这些本地跑出完全一致的战斗）──
  replay: {
    battleSeed: number;        // BattleSim 构造种子
    layer: number;
    mode: GameMode;
    arena: ArenaDef;
    /** 双方单位的初始快照（已含装备/成长/星级/坐骑加成的最终数值） */
    allies: UnitSnapshot[];
    enemies: UnitSnapshot[];
    buildings: BuildingPlacement[];
    buildingScale: { hp: number; dmg: number };
    /** 权威 trace 校验和：前端复现后比对，不一致=版本漂移 */
    checksum: string;
  };
  // ── 权威结果（前端不得自行判定）──
  outcome: {
    result: 'win' | 'lose';
    totalTicks: number;        // 前端可据此画进度条
    durationSec: number;
    stats: BattleStatRow[];    // 战后评价屏数据
    mvpUid: string | null;
    mvpStat: keyof PrimaryAttrs | null;
    mvpAdd: number;
    killGains: Record<string, HeroGrowth>;
    deadAllyUids: string[];    // ironman 永久移除用
  };
  // ── 结算后的权威状态 ──
  snapshot: RunSnapshot;       // 已含掉落、金币、层数推进
}

/**
 * 单位开局快照 = `Unit` 的全量深拷贝（tick 前抓取）。
 * 刻意**不做字段白名单**——理由见下方「血的教训」。
 */
export type UnitSnapshot = Unit;

startBattle(req: StartBattleReq): Promise<Result<BattleResultDTO>>;
```

#### 血的教训：这里原本是字段白名单，PoC 里翻了车

第一版契约老老实实列了 34 个字段。结果 PoC 一跑，**前端复现 168 tick、后端 144 tick**——
而且**胜负都是 win，肉眼完全看不出来**。逐字段 diff 后发现漏了 7 个：

| 漏掉的字段 | 开局真值 | 白名单版本 | 后果 |
|---|---|---|---|
| `skillCd` | `0`（技能就绪） | 误填 `skill.cd` | 全场技能节奏错位 |
| `dmgMult` | `1.06`（遗物加成） | 写死 `1` | 伤害整体偏低 |
| `combo` | `3` | 写死 `0` | 连击节奏错位 |
| `heavyBurst` | `1~2` | 写死 `0` | 重击节奏错位 |
| `dupIndex` | `1` | 漏 | — |
| `traitStacks` / `traitTimer` | 非 0 | 漏 | 特性行为偏移 |

同时诊断出**第二个 bug**：`primary/derived/skill` 是引用共享，**5/5 单位的 `derived`
在战斗中被就地 mutate**。快照虽在 tick 前抓，但 JSON 序列化发生在战斗结束后，
前端拿到的是"结束态"冒充"开局态"。

**结论：白名单的问题不是"这次漏了"，而是引擎每加一个字段就会再漏一次，且静默。**

所以契约改为全量深拷贝，实现只有一行：

```ts
function toSnapshot(u: Unit): UnitSnapshot {
  return JSON.parse(JSON.stringify(u)) as UnitSnapshot;
}
```

**为什么是 JSON round-trip 而不是 `structuredClone`**（这一条是刻意的）：

> 远程通路必然经过 JSON 序列化，`undefined` 字段会消失。本地通路若用
> `structuredClone` 保留 `undefined`，就会出现**"本地测全过、上线就漂"**的经典事故。
> 主动把传输损耗前置到本地，两条通路才真正同构。

代价：单位快照 ~0.6 KB，一场 5–6 个单位共 5.5–6.6 KB。相对逐 tick 事件流仍有
4.5×（第 1 层）到 19×（第 3 层）的优势，且**不随战斗时长增长**。

### 3.2.1 前后端唯一的装配入口（禁止各写各的）

`replay` 包不是"给前端自己组装的原料"。装配顺序本身就是协议的一部分——
建筑 id 计数器必须在 `spawnBuildings` 之前归零，而单位 id 计数器由 `buildUnits` 消耗。
任何一边自己手写这段，都会在某次重构后悄悄错位，**表现为"胜负一样、过程不同"**。

所以 core 只暴露两个函数，前后端各调一个：

```ts
// 服务端：从 RunSnapshot 推导输入 → 跑权威结算
export function runBattle(snap, secret, formation): Result<SettleResult>

// 客户端：只吃 replay 包 → 复现同一过程
export function replayBattle(replay, onTick?): {
  sim: BattleSim; totalTicks: number; result: 'win' | 'lose'; checksum: string;
}

// 两者内部共用（不对外）
function makeSim(i: SimInput): BattleSim   // 装配顺序的唯一真理
function traceLine(sim, step): string      // 指纹算法的唯一真理
```

> 前端**不得**自己 `new BattleSim(...)`。PoC 最初就是自己写了一遍重建逻辑，
> 测的其实是"我抄对了没"，而不是"架构成不成立"。改为共用 `replayBattle` 后，
> 80 场战斗 checksum 全等（并已在 5 个 JS 运行时上复验，见 `07_跨引擎浮点一致性.md`）。

### 3.3 战斗回执（前端播放完毕后确认）

```ts
export interface AckBattleReq extends CommandEnvelope {
  battleId: string;
  /** 前端本地复现算出的校验和，用于监测版本漂移 */
  localChecksum: string;
}
/** 服务端记录 checksum 是否一致（用于灰度期监控），返回最新快照 */
ackBattle(req: AckBattleReq): Promise<Result<{ checksumMatch: boolean; snapshot: RunSnapshot }>>;
```

**为什么要 ack**：战斗结果在 `startBattle` 时已落库（防止玩家看到输了就断线重来）。
`ack` 只做两件事：① 上报 checksum 供监控；② 推进 UI 状态机。**不影响结算**。

---

## 4. 经济接口（3 秒倒计时时序）

所有经济操作签名统一，返回完整快照：

```ts
// ── 商店 ──
buyItem(req: CommandEnvelope & { itemId: string }): Promise<Result<RunSnapshot>>;
buyAllShop(req: CommandEnvelope): Promise<Result<RunSnapshot & { purchased: number }>>;
sellItem(req: CommandEnvelope & { equipmentId: string }): Promise<Result<RunSnapshot>>;
refreshShop(req: CommandEnvelope): Promise<Result<RunSnapshot>>;

// ── 招募 / 升星 ──
refreshRecruit(req: CommandEnvelope): Promise<Result<RunSnapshot>>;
recruit(req: CommandEnvelope & { heroId: string }): Promise<Result<RunSnapshot>>;
/** 升星；5★ 后自动转为属性突破，结果在 receipts.lastBreakthrough */
upgradeHero(req: CommandEnvelope & { uid: string }): Promise<Result<RunSnapshot>>;
sellHero(req: CommandEnvelope & { uid: string }): Promise<Result<RunSnapshot>>;
rerollMount(req: CommandEnvelope & { uid: string }): Promise<Result<RunSnapshot>>;

// ── 装备 ──
openDrop(req: CommandEnvelope & { chestId: string }): Promise<Result<RunSnapshot>>;
equipItem(req: CommandEnvelope & { uid: string; equipmentId: string }): Promise<Result<RunSnapshot>>;
unequipItem(req: CommandEnvelope & { uid: string; equipmentId: string }): Promise<Result<RunSnapshot>>;
equipAll(req: CommandEnvelope & { uid?: string }): Promise<Result<RunSnapshot & { equipped: number }>>;

// ── 锻造 / 合成 ──
forge(req: CommandEnvelope & { equipmentId: string; consumeIds: string[] }): Promise<Result<RunSnapshot>>;
transferForge(req: CommandEnvelope & { targetId: string; materialIds: string[] }): Promise<Result<RunSnapshot>>;
fuse(req: CommandEnvelope & { aId: string; bId: string }): Promise<Result<RunSnapshot>>;

// ── 消耗品 / 事件 ──
useConsumable(req: CommandEnvelope & { itemId: string; uid: string }): Promise<Result<RunSnapshot>>;
resolveRandomEvent(req: CommandEnvelope & { layer: number; optionIndex: number }): Promise<Result<RunSnapshot>>;
```

### 4.1 服务端种子派生规则（必须与现有实现完全一致）

后端计算这些操作时，种子派生**照抄现有公式**，但所有输入取自数据库而非请求：

| 操作 | 种子公式（`run.seed` 为根） |
|---|---|
| 关卡生成 | `mulberry32(seed + layer * 7919)` |
| 掉落 | `seed ^ (layer * 7919)` |
| 商店刷新 | `seed ^ (layer * 7919) ^ (refreshCount * 0x9e3779b1)` |
| 招募刷新 | `seed ^ (layer * 104729) ^ (refreshCount * 0x85ebca77)` |
| 锻造 | `seed ^ (layer * 2654435761) ^ (tradeCount * 40503) ^ (inventory.length * 2246822519)` |
| 属性转移 | `seed ^ (layer * 0x27d4eb2d) ^ (tradeCount * 40503) ^ (inventory.length * 2246822519)` |
| 合成 | `seed ^ (layer * 0x85ebca6b) ^ (fusedThisLayer * 0xc2b2ae35) ^ (inventory.length * 2654435761)` |
| 突破 | `seed ^ hashStr(uid) ^ imul(累计层 + 1, 0x27d4eb2d)` |
| 战斗 | `(seed + layer) >>> 0` |
| **MVP 奖励（新增）** | `seed ^ (layer * 0x1b873593) ^ hashStr(mvpUid)` ← 修复 `Math.random` |

> ⚠ **`inventory.length` 入种子是个隐患**：它意味着"背包里多一件装备，锻造结果就变"。
> 单机无所谓，但服务器化后，任何导致背包长度不同步的 bug 都会让结果分歧。
> **建议（非阻塞）**：改用单调递增的 `opSeq`（每次经济操作 +1）替代 `inventory.length`，语义更清晰且不受背包状态影响。
> 若要保持存档兼容可暂时保留，但需在 §5 的迁移期做双跑比对。

---

## 5. 生命周期与元进度

```ts
// ── run 生命周期 ──
startRun(req: Omit<CommandEnvelope,'runId'> & {
  heroIds: string[];          // 恰好 3 个
  mode: GameMode;
}): Promise<Result<RunSnapshot>>;   // 后端分配 runId + seed

queryRun(runId: string): Promise<Result<RunSnapshot>>;
abandonRun(req: CommandEnvelope): Promise<Result<MetaSnapshot>>;

/** 跳过已通关层（layer <= bestLayer 时可用） */
skipLayer(req: CommandEnvelope): Promise<Result<RunSnapshot>>;

/** 进入下一层（战后评价屏「继续」）*/
advanceLayer(req: CommandEnvelope): Promise<Result<RunSnapshot>>;

// ── meta ──
queryMeta(): Promise<Result<MetaSnapshot>>;
saveTeamPreset(req: { name: string; ids: string[] }): Promise<Result<MetaSnapshot>>;
deleteTeamPreset(req: { index: number }): Promise<Result<MetaSnapshot>>;
savePrefs(req: { battleSpeed?: number; colorblind?: boolean }): Promise<Result<MetaSnapshot>>;
```

---

## 6. 完整接口定义

```ts
export interface GameBackend {
  // 查询
  queryMeta(): Promise<Result<MetaSnapshot>>;
  queryRun(runId: string): Promise<Result<RunSnapshot>>;
  queryBattlePlan(runId: string): Promise<Result<BattlePlanDTO>>;

  // 生命周期
  startRun(req: StartRunReq): Promise<Result<RunSnapshot>>;
  abandonRun(req: CommandEnvelope): Promise<Result<MetaSnapshot>>;
  skipLayer(req: CommandEnvelope): Promise<Result<RunSnapshot>>;
  advanceLayer(req: CommandEnvelope): Promise<Result<RunSnapshot>>;

  // 战斗
  startBattle(req: StartBattleReq): Promise<Result<BattleResultDTO>>;
  ackBattle(req: AckBattleReq): Promise<Result<{ checksumMatch: boolean; snapshot: RunSnapshot }>>;

  // 经济（见 §4，共 18 个）
  buyItem(...): Promise<Result<RunSnapshot>>;
  /* ... */

  // meta
  saveTeamPreset(...): Promise<Result<MetaSnapshot>>;
  deleteTeamPreset(...): Promise<Result<MetaSnapshot>>;
  savePrefs(...): Promise<Result<MetaSnapshot>>;
}
```

---

## 7. HTTP 映射（RemoteBackend）

单个 Edge Function 走 action 路由，避免几十个函数各自冷启动：

```
POST /functions/v1/game
{
  "action": "shop.buy",
  "runId": "...",
  "idempotencyKey": "...",
  "coreVersion": "2.0.0",
  "payload": { "itemId": "..." }
}
```

| action | 对应方法 |
|---|---|
| `run.start` / `run.query` / `run.abandon` / `run.skip` / `run.advance` | 生命周期 |
| `battle.plan` / `battle.start` / `battle.ack` | 战斗 |
| `shop.buy` / `shop.buyAll` / `shop.sell` / `shop.refresh` | 商店 |
| `hero.recruit` / `hero.refreshPool` / `hero.upgrade` / `hero.sell` / `hero.rerollMount` | 英雄 |
| `equip.open` / `equip.wear` / `equip.remove` / `equip.wearAll` | 装备 |
| `forge.reforge` / `forge.transfer` / `forge.fuse` | 锻造 |
| `item.use` / `event.resolve` | 杂项 |
| `meta.query` / `meta.savePreset` / `meta.deletePreset` / `meta.savePrefs` | 元进度 |

**为什么单函数多 action**：Supabase Edge Function 冷启动约 100-300ms。
30 个函数各自冷启动，玩家在休整屏点几下就会命中多次冷启动。
单函数常驻后，所有 action 共享同一个热实例。

---

## 8. LocalBackend 实现要点

```ts
export class LocalBackend implements GameBackend {
  // 直接调用 @arena/core 的纯函数，零网络、零序列化
  async buyItem(req) {
    const run = this.store.get(req.runId);
    if (!run) return err('RUN_NOT_FOUND');
    // ↓ 与 Edge Function 内部调用的是同一个函数
    const next = rules.buyItem(run, req.payload.itemId);
    if (!next.ok) return next;
    this.store.put(next.data);
    return ok(next.data);
  }
}
```

**纪律**：`rules.*` 是纯函数 `(state, input) => Result<state>`，不碰 IO。
`LocalBackend` 与 Edge Function 都只是"把状态取出来 → 调 rules → 存回去"的壳。
壳可以有两个，**规则只能有一份**。
