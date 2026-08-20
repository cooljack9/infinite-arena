// 状态层类型定义：把原 store.ts 的单一 GameState 拆分为三个领域 slice 接口，
// 再组合成完整 GameState。各 slice 文件只 import 自己那一份接口，组合在 store.ts 完成。
import type {
  HeroDef, RelicDef, RunState, Equipment, Chest,
  ConsumableItem, HeroGrowth, GameMode, Vec2,
  BattleStatRow, BattleEvalState, PrimaryAttrs,
  BreakthroughResult, MountResult, TeamPreset,
} from '@arena/core/types';
import type { RunSnapshot, BattleResultDTO, AutoClimbResultDTO } from '@arena/core/contract';
import type { FormationPreset } from '@arena/core/gen/formation';
import type { ShopStock, TransferLog } from '@arena/core/content/equipment';
import type { ClimbStrategy } from '@arena/core/content/climb';

export type Screen = 'menu' | 'team' | 'pre' | 'battle' | 'inter' | 'result' | 'eval';

// vX 渲染质量档位：控制战斗背景粒子数 / 暴击外发光 / 暗角等视觉负荷。
// 高端设备拉满表现，低端设备一键省电（直接服务「增强表现」+「降低运算量」）。
export type RenderQuality = 'high' | 'standard' | 'low';

// v2.4.1 收敛为单套风格：仅保留初始 aurora（默认 :root），去除 neon/ember/light 三套可选主题，
// 节省 CSS 缓存体积与首屏主题切换运行时。换肤只需改 index.css 的 :root 变量。
export type Theme = 'aurora';

// v1.7 两段波等待文案：wave1 先显、约 halfMs 后切 wave2；phase 标记当前波次
export type FxBusyWaves = { wave1: string; wave2: string; phase: 1 | 2 };

// v1.8 布阵上下文：决定 PreBattle/BattleScreen 的生效层、敌强倍率与结算方式
export type BattleCtx =
  | { mode: 'normal' }
  | { mode: 'skip5' }
  | { mode: 'climb'; strategy: ClimbStrategy; winRateTarget: number };

// v1.8 自动爬塔播放会话（失败演示/停止按钮用）：idx = 当前播到第几层
export type ClimbSession = {
  result: AutoClimbResultDTO;
  idx: number;
  stopRequested: boolean;
} | null;

// v1.8.1 进战预热：爬塔间隙为下一层后台 startBattle，进入战斗时直接采用，消除「正在进入战场」黑屏。
// data = 完整 startBattle 返回；runLayer/模式用于匹配进入战斗时的上下文；key 为幂等 key 复用（避免重复结算）。
export type PrefetchBattle = {
  data: BattleResultDTO;
  runLayer: number;
  mode: BattleCtx['mode'];
  key: string;
};

interface LastResult { layer: number; score: number; win: boolean; mode: GameMode }

// ── 领域回执 / 预设类型（Pure Core 迁入 @arena/core/types，此处 re-export）──
// 契约（GameBackend）在 core 内引用它们；前端从 @arena/core/types 或本文件取均可。
export type {
  BreakthroughResult, MountResult, TeamPreset,
} from '@arena/core/types';

// ── meta：账号级持久化 + 导航 + 布阵 + 编队预设（跨局/跨会话保持）──
export interface MetaSlice {
  screen: Screen;
  bestLayer: number;
  lastResult: LastResult | null;
  // v2.1 模式系统（需求 §8.4）：无尽模式解锁为账号级持久化
  endlessUnlocked: boolean;
  selectedMode: GameMode;
  // v1.6 战斗倍速：玩家操作偏好，跨层/跨会话持久化
  battleSpeed: number;
  // v2.9.8 色盲友好双通道：阵营额外用「形状」区分（▲我方 / ▼敌方），不只靠红蓝
  colorblind: boolean;
  // vX 渲染质量档位：高 / 标准 / 省电（持久化偏好，跨会话保持）
  renderQuality: RenderQuality;
  // vX 界面主题：aurora（默认）/ neon / ember（持久化偏好，跨会话保持）
  theme: Theme;
  // v2.3 战前布阵：按 uid 记账，坐标是 tile 中心，跨层沿用
  formation: Record<string, Vec2>;
  formationPreset: FormationPreset;
  // v2.0 编队预设：当前编队选择 + 已保存预设
  teamSelection: string[];
  teamPresets: TeamPreset[];

  setScreen: (s: Screen) => void;
  /** v3.2b 全局动画锁：动画播放期间为悬浮提示文字（非 null 即锁定），App 根渲染遮罩屏蔽一切交互并居中展示文字。
   *  v1.7 起可为单行字符串（旧式）或两段波对象（新两段波文案）。 */
  fxBusy: string | FxBusyWaves | null;
  setFxBusy: (label: string | null) => void;
  /** v1.7 两段波：先显 wave1，halfMs 后自动切 wave2（由调用方原有 setTimeout 在 ~1.25s 清掉 fxBusy） */
  setFxBusyWaves: (wave1: string, wave2: string, halfMs?: number) => void;
  /** v3.3c 出征台词（编队完成 → 布阵）：phase 1 = 三人踏上道路，phase 2 = 等待命运；App 全局覆盖层展示 */
  departScene: { heroes: Array<{ name: string; cls: string }>; phase: 1 | 2 } | null;
  setDepartScene: (s: { heroes: Array<{ name: string; cls: string }>; phase: 1 | 2 } | null) => void;
  setSelectedMode: (m: GameMode) => void;
  setBattleSpeed: (v: number) => void;
  setColorblind: (v: boolean) => void;
  setRenderQuality: (v: RenderQuality) => void;
  setFormation: (f: Record<string, Vec2>, preset?: FormationPreset) => void;
  setTeamSelection: (ids: string[]) => void;
  savePreset: (name: string) => void;
  applyPreset: (index: number) => void;
  deletePreset: (index: number) => void;
  // v1.8 布阵上下文（下一层 / 下五层 / 自动爬塔）
  battleCtx: BattleCtx;
  setBattleCtx: (c: BattleCtx) => void;
  // v1.8 自动爬塔播放会话
  climbSession: ClimbSession;
  setClimbSession: (s: ClimbSession) => void;
  // v1.8.3 三存档：当前激活槽位（新游戏/自动保存写到这里；null = 不绑定存档）
  activeSlot: import('../../saves').SaveSlotId | null;
  setActiveSlot: (s: import('../../saves').SaveSlotId | null) => void;
}

// ── run：局内生命周期 + 成长写回 + 战斗结算 + 随机奇遇（随一局而始末）──
export interface RunSlice {
  run: RunState | null;
  resolvedEvents: number[]; // 已结算随机奇遇的层号（同一层只结算一次）
  /**
   * 云端模式：当前层战斗的权威结算结果（BattleScreen 挂载时由 startBattle 预取，
   * onEnd 用它结算胜负/掉落/成长，本地模拟仅作观感渲染）。
   */
  battleRemote: {
    outcome: BattleResultDTO['outcome'];
    snapshot: RunSnapshot;
    replay: BattleResultDTO['replay'];
  } | null;
  setBattleRemote: (d: RunSlice['battleRemote']) => void;
  clearBattleRemote: () => void;
  // v1.8.1 进战预热缓存（见 PrefetchBattle）
  prefetchBattle: PrefetchBattle | null;
  setPrefetchBattle: (d: PrefetchBattle | null) => void;

  startRun: (team: HeroDef[], mode?: GameMode) => void;
  /** v1.8：opts.layers 支持下五层按多层发奖（奖励基础 = 五层之和）、highBonus 高奖 +10% 表 */
  collectLoot: (layer: number, opts?: { layers?: number[]; highBonus?: boolean; poolLayer?: number }) => void;
  /** v1.8 自动爬塔奖励入账（逐层/一次性；本地模式） */
  climbReward: (gold: number, drops: Chest[]) => void;
  setLayer: (n: number) => void;
  addScore: (s: number) => void;
  setFailures: (n: number) => void;
  addRelic: (r: RelicDef) => void;
  finishBattle: (win: boolean, layer: number, score: number) => void;
  // v2.2 铁人无尽：把本场阵亡的友方副本永久移除
  removeDeadAllies: (uids: string[]) => void;
  // 击杀成长写回（按 uid）
  commitGrowth: (gains: Record<string, HeroGrowth>) => void;
  // v2.9.6 战后评价：记录本场战报并（win 时）给 MVP 友方 +1 随机一级属性成长。
  // 战机结束（无论胜负）先落到 eval 屏，再由该屏继续按钮决定去 inter / pre / finishBattle。
  battleEval: BattleEvalState | null;
  recordBattleEval: (
    rows: BattleStatRow[], winner: 'win' | 'lose',
    currentLayer: number, nextLayer: number, cap: number,
    mvp?: { uid: string | null; stat: keyof PrimaryAttrs | null; add: number },
  ) => void;
  // 进入战斗即消耗爆发标记
  consumeBurst: (uid: string) => void;
  // 使用一次性物品（成长/爆发药剂）
  useConsumable: (id: string, uid: string) => void;
  // 随机奇遇事件结算
  resolveRandomEvent: (layer: number, optionIndex: number) => void;
  /** v3.4e 本局已提示过特殊地图的 arena id（八角笼/疯狂龙巢首次出现说明；本地导航字段，不进云端快照） */
  seenArenaHints: string[];
  markArenaSeen: (id: string) => void;
  reset: () => void;
  // v1.8.3 三存档：保存当前局到激活槽位（本地模式；返回是否成功）、
  // 从槽位恢复整局、新游戏绑定槽位（startRun 成功后自动写入初始快照）
  saveToSlot: () => boolean;
  loadSlot: (slot: import('../../saves').SaveSlotId) => boolean;
  bindSlot: (slot: import('../../saves').SaveSlotId) => void;
}

// ── economy：金币 / 背包 / 商店 / 装备 / 锻造 / 招募 / 突破（全部局内经济）──
export interface EconomySlice {
  gold: number;
  inventory: Equipment[];        // 已拥有的已开箱装备
  pendingDrops: Chest[];         // 未开箱的掉落箱
  equipped: Record<string, Equipment[]>; // uid -> 已穿戴装备（≤6）
  tradeCount: number;            // 累计买+卖次数，驱动折扣
  shopStock: ShopStock;          // 商店当前库存
  consumables: ConsumableItem[]; // 已购买的未使用一次性物品
  forgedThisLayer: string[];     // 本层已锻造的装备 id（每件每层限 1 次）
  recruitPool: HeroDef[];        // 层间英雄招募池
  fusedThisLayer: number;        // 本层已合成次数
  reforgedThisLayer: boolean;    // v3.3 本层是否已重铸（每层限一次）
  refreshCount: number;          // 累计刷新次数（掺入种子）
  lastTransferLogs: TransferLog[];      // 最近一次属性转移的逐条结果
  lastBreakthrough: BreakthroughResult | null; // 最近一次属性突破
  lastMount: MountResult | null;               // 最近一次 5★ 坐骑解锁回执
  lastKillGains: Record<string, HeroGrowth> | null; // 本场击杀成长回执（按 uid）
  lastReforge: { from: string; to: string; itemId: string; name: string } | null; // v3.3 最近一次重铸回执

  openDrop: (id: string) => void;
  /** 批量开箱（全部开启）：云端走批量命令（单次写防乐观锁互踩），本地循环单开 */
  openDrops: (ids: string[]) => void;
  /** v3.3 白色装备重铸 → 随机彩色（蓝/橙/红），每层一次 */
  reforgeItem: (id: string) => void;
  buyItem: (id: string) => void;
  buyAllShop: () => number;    // 一键全买；返回成交件数
  sellItem: (id: string) => void;
  equipItem: (uid: string, eqId: string) => void;
  equipAll: (uid?: string) => number; // 一键装备；返回穿上的件数
  unequipItem: (uid: string, eqId: string) => void;
  forge: (equipmentId: string, consumeIds: string[]) => void;
  transferForge: (targetId: string, materialIds: string[]) => void;
  transferForgeAll: (targetId: string) => void; // 一键熔炼
  fuse: (aId: string, bId: string) => void;
  canFuse: (aId: string, bId: string) => boolean;
  refreshShop: (free?: boolean) => void;
  refreshRecruit: () => void;
  recruit: (heroId: string) => void;
  upgradeHero: (uid: string) => void; // 升星 / 突破（与招募解耦）
  rerollMount: (uid: string) => void; // 坐骑刷新召唤
  sellHero: (uid: string) => void;
  recruitCost: () => number;        // 当前层招募价
  discount: () => number;           // tradeCount × 0.025，封顶 0.5
}

export type GameState = MetaSlice & RunSlice & EconomySlice;
