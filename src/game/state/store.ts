// 游戏状态（开发 §5 状态层 / 需求 8）。meta 用 localStorage 持久化；装备经济为局内状态。
//
// v2.9.5：把原单文件 970 行 god-store 拆分为三个领域 slice（见 ./slices/），
// 用 zustand 的 slices 组合模式合成**单一** useGame store——对外 selector API 完全不变，
// 所有 screen 零改动。三个 slice：
//   · meta.ts    —— 账号级持久化 + 导航 + 战前布阵 + 编队预设（跨局/跨会话保持）
//   · run.ts     —— 局内生命周期 + 成长写回 + 战斗结算 + 随机奇遇（随一局始末）
//   · economy.ts —— 金币 / 背包 / 商店 / 装备 / 锻造 / 合成 / 招募 / 突破（全部局内经济）
// 注：原评审里的 battle / tutorial / inventory 并非独立 store 域——战斗模拟在 engine/battle.ts、
// 教学 seen 集合在 TutorialOverlay 局部状态、inventory 是 economy 的自然一部分，故不单列。
import { create } from 'zustand';
import { createMetaSlice } from './slices/meta';
import { createRunSlice } from './slices/run';
import { createEconomySlice } from './slices/economy';
import type { GameState } from './slices/types';

export const useGame = create<GameState>()((...a) => ({
  ...createMetaSlice(...a),
  ...createRunSlice(...a),
  ...createEconomySlice(...a),
}));

// ── 保持原有导出契约不变（screen 与脚本零改动）──
export type {
  Screen, BreakthroughResult, MountResult, TeamPreset,
} from './slices/types';
export { SPEED_OPTIONS, BREAKTHROUGH_MAIN_CHANCE } from './slices/helpers';
