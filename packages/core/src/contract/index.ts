// ── GameBackend：前后端分离的唯一契约 ──
// LocalBackend（同进程）与 RemoteBackend（Supabase HTTP）实现同一个接口。
// 前端只依赖本接口，切换通路时业务代码零改动。
//
// 设计纪律（详见 docs/backend/02_接口契约.md）：
//   1. 命令-查询分离：query* 只读；写操作一律返回**完整权威快照**而非增量
//   2. 幂等：所有写操作带 idempotencyKey，倒计时内连点/重试不会重复扣费
//   3. 服务端只信自己：请求里的 gold/tradeCount/inventory 一律忽略，以存储为准
//   4. 错误是数据不是异常：返回 Result 而非 throw（异常无法跨 HTTP 边界保真）
import type {
  HeroDef, RelicDef, Equipment, Chest, ConsumableItem, GameMode, Vec2,
  PrimaryAttrs, HeroGrowth, BattleStatRow, ArenaDef, EnemyDef, RandomEvent,
  BuildingPlacement, Unit, VanEncounter,
} from '../types';
import type { ShopStock, TransferLog } from '../content/equipment';
import type { TeamPreset, BreakthroughResult, MountResult } from '../types';
import type { ClimbStrategy } from '../content/climb';

/**
 * core 版本号：前后端不一致时前端提示更新（防回放漂移）。
 *
 * ⚠️ 什么时候**必须**升这个号：任何改动会让同一个 `battleSeed` 算出不同结果的时候。
 * 它不是发布版本号，是**回放兼容性契约**——旧号存下来的 replay 必须能用同号的引擎放出来。
 *
 * 判断标准不是"改得多大"，而是"数值路径动没动"。典型的破坏性改动：
 *   - 引擎数学实现（`detmath.ts`）——哪怕只差 1 ULP
 *   - RNG 消费顺序 / 次数（多摇一次骰子，后面全错位）
 *   - 平衡性数值、技能公式、生成规则
 * 反之，渲染/UI/音效怎么改都不用动它（它们不进 checksum）。
 *
 * 4.1.0-detmath：演算路径切到确定性数学库。`dsin/dcos` 与原生 `Math.sin/cos`
 * 在约 25% 的输入上差 1 ULP，足以改变战斗走向（PoC 基准从 79 场/胜率 67%
 * 位移到 80 场/胜率 69%）。这是一次性的基准重置，换来跨 5 个运行时逐 bit 一致。
 * 详见 docs/backend/07_跨引擎浮点一致性.md。
 *
 * 4.2.0-van：场地抽取从"按数组下标平均分"改成显式权重表（DRAGON/CAGE/VAN 各 7%、
 * 普通 79%），并新增车队关 `vanEncounter`。三处踩到回放契约：
 *   1. `rollArenaArchetype` 的 RNG 消费次数与旧 `pick(SPECIAL)` 不同 → 之后所有骰子错位
 *   2. `ENEMIES_BY_CAT` 排除了 e_van/e_van_person → `pick()` 池长度变了，同 seed 抽出不同怪
 *   3. 车队关每次下人都摇特性 → 新增 RNG 消费点
 * 也就是说：4.1.0 存下来的 replay 用 4.2.0 引擎放**必然**漂移，必须靠版本号拦住，
 * 不能靠"看起来差不多"。前端撞到 VERSION_MISMATCH 会提示刷新，这是预期行为。
 */
export const CORE_VERSION = '2.2.0';

// ── 通用信封 ──────────────────────────────────────────────

export type ErrCode =
  | 'RUN_NOT_FOUND' | 'RUN_ENDED' | 'STATE_STALE'
  | 'INSUFFICIENT_GOLD' | 'ITEM_GONE' | 'SLOT_FULL'
  | 'LAYER_MISMATCH' | 'TEAM_INVALID' | 'CAP_REACHED'
  | 'FORGE_LOCKED' | 'FUSE_LIMIT' | 'NOT_FUSIBLE'
  | 'REFORGE_LIMIT' | 'NOT_REFORGEABLE'
  | 'EVENT_DONE' | 'EVENT_NONE' | 'EVENT_OPTION' | 'NO_MATERIAL'
  | 'VERSION_MISMATCH' | 'RATE_LIMITED' | 'UNAUTHORIZED'
  | 'DB_ERROR';

export type Result<T> =
  | { ok: true; data: T; coreVersion: string }
  | { ok: false; code: ErrCode; message: string; coreVersion: string };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data, coreVersion: CORE_VERSION });
/**
 * `message` 必须显式标注 `: string`。
 * 若写成 `message = code`（靠默认值推断），TS 会把参数类型收窄成 `ErrCode`，
 * 于是任何人类可读的说明文字都会编译失败——typecheck 已经抓到过两次。
 * `code` 给程序判断，`message` 给人看，两者不是同一种东西。
 */
export const err = <T = never>(code: ErrCode, message: string = code): Result<T> =>
  ({ ok: false, code, message, coreVersion: CORE_VERSION });

/** 所有写操作的通用请求头部 */
export interface CommandEnvelope {
  runId: string;
  /** 幂等键：客户端生成 uuid，倒计时内连点/网络重试靠它去重 */
  idempotencyKey: string;
  coreVersion: string;
}

// ── 状态快照 ──────────────────────────────────────────────

/** 一局游戏的完整权威状态。所有写操作都返回它 */
export interface RunSnapshot {
  runId: string;
  /** 乐观锁版本号：每次写 +1 */
  version: number;

  // run 域
  layer: number;
  mode: GameMode;
  score: number;
  failures: number;
  cap: number;
  team: HeroDef[];
  relics: RelicDef[];
  resolvedEvents: number[];
  status: 'active' | 'won' | 'lost';

  // economy 域
  gold: number;
  inventory: Equipment[];
  pendingDrops: Chest[];
  equipped: Record<string, Equipment[]>;
  consumables: ConsumableItem[];
  shopStock: ShopStock;
  recruitPool: HeroDef[];
  tradeCount: number;
  refreshCount: number;
  forgedThisLayer: string[];
  fusedThisLayer: number;
  /** v3.3 白色装备重铸（每层限一次，置 true 后本层不可再重铸；层推进时重置） */
  reforgedThisLayer: boolean;
  /** 替代 inventory.length 入种子：单调递增，不受背包状态影响 */
  opSeq: number;

  /**
   * 前端渲染种子（与权威根种子**完全解耦**）：
   *   - 权威结算（胜负/掉落/商店）只用服务端 secret，renderSeed 不参与任何结算；
   *   - 前端 Remote 模式下本地模拟/地图预览用 renderSeed 代替 run.seed（根种子不下发）；
   *   - Local 模式由 rules 从 seed 确定性派生；云端模式由宿主覆写为独立随机（不可反推）。
   */
  renderSeed: number;

  /** 一次性回执（读取即清，用于 UI 弹窗） */
  receipts: {
    lastBreakthrough?: BreakthroughResult | null;
    lastMount?: MountResult | null;
    lastTransferLogs?: TransferLog[];
    lastKillGains?: Record<string, HeroGrowth> | null;
    /** v3.3 重铸回执：{from, to, itemId, name} */
    lastReforge?: { from: string; to: string; itemId: string; name: string } | null;
  };
}

/** 账号级元进度（跨局持久） */
export interface MetaSnapshot {
  bestLayer: number;
  endlessUnlocked: boolean;
  teamPresets: TeamPreset[];
  prefs: { battleSpeed: number; colorblind: boolean };
}

// ── 战斗 ──────────────────────────────────────────────────

/** 战前情报：地图 / 敌方编成 / 随机奇遇。**不含结果** */
export interface BattlePlanDTO {
  layer: number;
  arena: ArenaDef;
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

/**
 * 单位开局快照 = `Unit` 的**完整深拷贝**（makeAlly/makeEnemy 产物，tick 前抓取）。
 *
 * 刻意不做字段白名单。PoC 实测教训：白名单版本漏了 `skillCd`（开局 0 = 技能就绪，
 * 误填 skill.cd = 要等满 CD）、`dmgMult`（遗物加成 1.06 被写死 1）、`combo`、
 * `heavyBurst`、`traitStacks` 等 7 个字段，导致前端复现从 144 tick 漂到 168 tick——
 * **胜负还一致，所以肉眼看不出来**，只有 checksum 抓得住。
 *
 * 白名单的问题不是"这次漏了"，是"引擎每加一个字段就会再漏一次，且静默"。
 * 全量深拷贝让快照随 Unit 定义自动演进：加字段自动带上，改语义 checksum 立刻报警。
 * 代价：单位快照 ~0.6KB，15 单位约 9KB，相对 48KB 事件流仍有 5× 以上优势。
 */
export type UnitSnapshot = Unit;

export interface StartBattleReq extends CommandEnvelope {
  formation: Record<string, Vec2>;
  /** 仅用于埋点分析延迟，不参与计算 */
  clientTs: number;
  /** v1.8 下五层挑战结算参数（普通战斗缺省） */
  battleOpts?: BattleOptsDTO;
}

/** v1.8 下五层挑战：战斗与结算的可选参数（缺省 = 普通战斗，行为与旧版一致） */
export interface BattleOptsDTO {
  /** 生效层：敌人按这层的缩放出（下五层 = 当前层+5）；缺省 = 当前层 */
  effLayer?: number;
  enemyHpMult?: number;
  enemyDmgMult?: number;
  /** 胜利时按这些层逐层发奖（下五层 = [N+1..N+5]，奖励基础 = 五层之和） */
  rewardLayers?: number[];
  /** 掉落用「高奖 +10%」表（下五层） */
  highBonus?: boolean;
  /** 失败扣的容错次数（下五层 = 2） */
  loseFailures?: number;
}

// ── v1.8 自动爬塔 ─────────────────────────────────────────

export interface ClimbOptsDTO {
  strategy: ClimbStrategy;
  /** 预计胜率目标（0~1，UI 51%~100%）；缺省 = 不设阈值 */
  winRateTarget?: number;
  /** 单轮最多爬几层（默认 10） */
  maxLayers?: number;
}

export interface ClimbLayerResultDTO {
  layer: number;
  win: boolean;
  gold: number;
  drops: Chest[];
}

export interface AutoClimbResultDTO {
  layers: ClimbLayerResultDTO[];
  finalLayer: number;
  stopReason: 'cap' | 'winrate' | 'fail' | 'done';
  failLayer: number | null;
  totalGold: number;
  totalDrops: Chest[];
}

/** 自动爬塔命令响应：爬塔明细 + 写回后的完整权威快照（契约纪律：写操作返回全量快照） */
export interface AutoClimbRespDTO {
  result: AutoClimbResultDTO;
  snapshot: RunSnapshot;
}

/** 后端权威结算结果 + 前端本地复现回放所需的全部输入 */
export interface BattleResultDTO {
  battleId: string;
  /** 回放输入：前端靠这些跑出与后端完全一致的战斗（约 2-6KB，vs 事件流 111KB） */
  replay: {
    battleSeed: number;
    layer: number;
    mode: GameMode;
    arena: ArenaDef;
    allies: UnitSnapshot[];
    enemies: UnitSnapshot[];
    buildings: BuildingPlacement[];
    buildingScale: { hp: number; dmg: number };
    /**
     * v2.9.x 面包车关车队配置。缺省 = 非车队关。
     * 必须进 replay 包：车队的撞击/开门/卸人全由它驱动，漏传则前端回放出一堆
     * 静止的面包车，而胜负可能一样——1.9.0 那类"肉眼查不出"的引擎漂移。
     */
    vanEncounter?: VanEncounter;
    /** 权威 trace 校验和：前端复现后比对，不一致 = 版本漂移 */
    checksum: string;
  };
  /** 权威结果：前端**不得**自行判定胜负 */
  outcome: {
    result: 'win' | 'lose';
    totalTicks: number;
    durationSec: number;
    stats: BattleStatRow[];
    mvpUid: string | null;
    mvpStat: keyof PrimaryAttrs | null;
    mvpAdd: number;
    killGains: Record<string, HeroGrowth>;
    deadAllyUids: string[];
  };
  /** 结算后的权威状态（已含掉落、金币、层数推进） */
  snapshot: RunSnapshot;
}

export interface AckBattleReq extends CommandEnvelope {
  battleId: string;
  /** 前端本地复现算出的校验和，用于监测版本漂移 */
  localChecksum: string;
}

export interface StartRunReq {
  heroIds: string[];
  mode: GameMode;
  idempotencyKey: string;
  coreVersion: string;
  /**
   * 指定 run 根种子。**仅 LocalBackend 生效**——回归测试与"复现这一局"需要它。
   *
   * RemoteBackend 必须无条件忽略本字段：种子是整局所有掉落/Boss/商店的母体，
   * 允许客户端指定 = 允许玩家枚举种子挑一个必出神装的开局，排行榜当场作废。
   * 服务端一律自行生成并存进 runs.seed（该列永不下发，见 03_数据库设计.md）。
   */
  debugSeed?: number;
}

// ── 接口本体 ──────────────────────────────────────────────

export interface GameBackend {
  // 查询
  queryMeta(): Promise<Result<MetaSnapshot>>;
  queryRun(runId: string): Promise<Result<RunSnapshot>>;
  queryBattlePlan(runId: string): Promise<Result<BattlePlanDTO>>;

  // 生命周期
  startRun(req: StartRunReq): Promise<Result<RunSnapshot>>;
  abandonRun(req: CommandEnvelope): Promise<Result<MetaSnapshot>>;
  advanceLayer(req: CommandEnvelope): Promise<Result<RunSnapshot>>;
  // v1.8：测试专用推进（advanceLayerTo），玩家功能「跳过本层」已整体下线
  advanceLayerTo(req: CommandEnvelope & { layer: number }): Promise<Result<RunSnapshot>>;

  // 战斗
  startBattle(req: StartBattleReq): Promise<Result<BattleResultDTO>>;
  ackBattle(req: AckBattleReq): Promise<Result<{ checksumMatch: boolean; snapshot: RunSnapshot }>>;
  // v1.8 自动爬塔（一次性传送 ≤10 层结果；本地模式由前端直调 core，远程走这里权威结算）
  autoClimb(req: CommandEnvelope & { opts: ClimbOptsDTO; formation: Record<string, Vec2> }): Promise<Result<AutoClimbRespDTO>>;

  // 商店
  buyItem(req: CommandEnvelope & { itemId: string }): Promise<Result<RunSnapshot>>;
  sellItem(req: CommandEnvelope & { equipmentId: string }): Promise<Result<RunSnapshot>>;
  refreshShop(req: CommandEnvelope): Promise<Result<RunSnapshot>>;

  // 英雄
  recruit(req: CommandEnvelope & { heroId: string }): Promise<Result<RunSnapshot>>;
  refreshRecruit(req: CommandEnvelope): Promise<Result<RunSnapshot>>;
  upgradeHero(req: CommandEnvelope & { uid: string }): Promise<Result<RunSnapshot>>;

  // 装备
  openDrop(req: CommandEnvelope & { chestId: string }): Promise<Result<RunSnapshot>>;
  /** 批量开箱（一次开全部，单次写；「全部开启」按钮专用，避免并发乐观锁互踩） */
  openDrops(req: CommandEnvelope & { chestIds: string[] }): Promise<Result<RunSnapshot>>;
  /** v3.3 白色装备重铸 → 随机彩色（蓝/橙/红），每层一次 */
  reforgeItem(req: CommandEnvelope & { equipmentId: string }): Promise<Result<RunSnapshot>>;
  equipItem(req: CommandEnvelope & { uid: string; equipmentId: string }): Promise<Result<RunSnapshot>>;
  /** v3.4b 一键装备（批量单次写，空槽最多优先；防逐件确认中间快照回退） */
  equipAll(req: CommandEnvelope & { uid?: string }): Promise<Result<RunSnapshot>>;
  unequipItem(req: CommandEnvelope & { uid: string; equipmentId: string }): Promise<Result<RunSnapshot>>;
  /** v3.4 随机奇遇（战前抉择，确定性结算；此前 Remote 短路导致云端点了没反应） */
  resolveRandomEvent(req: CommandEnvelope & { layer: number; optionIndex: number }): Promise<Result<RunSnapshot>>;
}
