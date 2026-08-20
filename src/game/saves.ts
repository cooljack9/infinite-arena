// v1.8.3 三存档系统（本地模式）：3 个槽位，每槽一局的完整可恢复快照（localStorage）。
// 云端模式进度由账号保留（Supabase runs 表），本地槽不复制云端局内数据；
// 恢复/删除/绑定逻辑在 run slice 内，本文件只做序列化读写（try/catch 全忽略失败，不拖垮游戏）。
import type {
  HeroDef, RunState, Equipment, Chest, ConsumableItem, HeroGrowth, Vec2, GameMode,
  BreakthroughResult, MountResult,
} from '@arena/core/types';
import type { ShopStock, TransferLog } from '@arena/core/content/equipment';

export type SaveSlotId = 0 | 1 | 2;
export const SAVE_SLOTS: SaveSlotId[] = [0, 1, 2];

/** 一局可恢复的完整状态（本地模式全部局内字段 + 布阵沿用） */
export interface SaveSnapshot {
  run: RunState;
  resolvedEvents: number[];
  seenArenaHints: string[];
  gold: number;
  inventory: Equipment[];
  pendingDrops: Chest[];
  equipped: Record<string, Equipment[]>;
  tradeCount: number;
  shopStock: ShopStock;
  consumables: ConsumableItem[];
  forgedThisLayer: string[];
  recruitPool: HeroDef[];
  fusedThisLayer: number;
  reforgedThisLayer: boolean;
  refreshCount: number;
  lastTransferLogs: TransferLog[];
  lastBreakthrough: BreakthroughResult | null;
  lastMount: MountResult | null;
  lastKillGains: Record<string, HeroGrowth> | null;
  lastReforge: { from: string; to: string; itemId: string; name: string } | null;
  formation: Record<string, Vec2>;
}

/** 槽位摘要（主菜单卡片展示用，避免读整份快照） */
export interface SaveMeta {
  slot: SaveSlotId;
  mode: GameMode;
  layer: number;
  score: number;
  teamNames: string[];
  savedAt: number;
}

const KEY = (s: SaveSlotId) => `ia_save_${s}`;
export const ACTIVE_SLOT_KEY = 'ia_save_active';

/** 读取槽位摘要（无存档返回 null） */
export function readSaveMeta(slot: SaveSlotId): SaveMeta | null {
  try {
    const raw = localStorage.getItem(KEY(slot));
    if (!raw) return null;
    const j = JSON.parse(raw);
    return j?.meta ?? null;
  } catch { return null; }
}

/** 读取槽位完整快照（meta + snap） */
export function readSave(slot: SaveSlotId): { meta: SaveMeta; snap: SaveSnapshot } | null {
  try {
    const raw = localStorage.getItem(KEY(slot));
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j?.meta || !j?.snap) return null;
    return { meta: j.meta, snap: j.snap };
  } catch { return null; }
}

/** 写入槽位（meta + snap 一起） */
export function writeSave(slot: SaveSlotId, meta: SaveMeta, snap: SaveSnapshot) {
  try {
    localStorage.setItem(KEY(slot), JSON.stringify({ meta, snap }));
  } catch { /* 配额/隐私模式等失败静默 */ }
}

/** 删除槽位 */
export function deleteSave(slot: SaveSlotId) {
  try { localStorage.removeItem(KEY(slot)); } catch { /* ignore */ }
}

/** 当前激活槽位（新游戏/自动保存写到哪里） */
export function getActiveSlot(): SaveSlotId | null {
  try {
    const v = parseInt(localStorage.getItem(ACTIVE_SLOT_KEY) ?? '', 10);
    return v === 0 || v === 1 || v === 2 ? (v as SaveSlotId) : null;
  } catch { return null; }
}
export function setActiveSlot(slot: SaveSlotId | null) {
  try {
    if (slot === null) localStorage.removeItem(ACTIVE_SLOT_KEY);
    else localStorage.setItem(ACTIVE_SLOT_KEY, String(slot));
  } catch { /* ignore */ }
}
