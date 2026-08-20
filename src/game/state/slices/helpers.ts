// 状态层共享辅助（原 store.ts 抽出，供各 slice 复用）。
//
// Pure Core 拆分后本文件只剩**前端宿主职责**：
//   · localStorage 持久化（账号级偏好）
//   · 渲染偏好（倍速档位、回放速度曲线）
//   · 模块级 uid 序列（同名多份副本标识）
// 领域公式（折扣曲线 / 招募定价 / 金币奖励 / 成长合并 / 哈希 / 初始装备包）
// 已迁至 @arena/core/rules/economy —— 见下方 re-export，保持既有引用面不破。

import { EQUIP_SLOTS } from '@arena/core/rules/economy';
import type { TeamPreset } from './types';

// ── 领域公式（re-export from @arena/core，保证前后端同一份）──
export {
  EQUIP_SLOTS, TEAM_CAP, REFRESH_COST, FUSE_PER_LAYER,
  rollStarterKit, BREAKTHROUGH_MAIN_CHANCE,
  discountOf, recruitCostOf, goldReward, hashStr, addGrowth,
} from '@arena/core/rules/economy';

// ── 装备上限（与 @arena/core/rules/index.ts::equipCapFor 同源）──
// 成长者（grower）仅能装备 3 件，其余 6 件。前端预览/一键装备/上限拦截统一走这里，
// 避免与引擎规则漂移。
import { TRAIT_CFG } from '@arena/core/content/traits';
export function equipCapOf(hero: { traitId?: string } | undefined | null): number {
  return hero?.traitId === 'grower' ? TRAIT_CFG.growerEquipCap : EQUIP_SLOTS;
}

// ── 常量（前端专属）──
export const MAX_PRESETS = 3;    // v2.0 编队预设上限

// v1.6 §A.2：倍速可选项（玩家操作偏好，跨层/跨会话持久化）。
export const SPEED_OPTIONS = [0.5, 1, 1.5, 2, 3, 4] as const;
export const clampSpeed = (v: number) => Math.max(0.5, Math.min(4, v));

// v2.9.14：层内「演示预热 → 正常 → 渐进加速」播放速度曲线。
// 仅作用于渲染层回放速度（acc 累加系数），不影响 sim.time / 战斗结果（确定性零影响）。
// 与玩家手动倍速相乘：默认 1× 时即纯曲线；玩家拉满 4× 时曲线仍叠加其上。
export const LAYER_PREHEAT_SEC = 10;      // 前 10s：60% 播放速度（演示预热过程）
export const LAYER_NORMAL_SEC = 20;       // 10~20s：正常 100% 速度
export const LAYER_ACCEL_STEP_SEC = 5;    // 20s 后每 5s 提速一次
export const LAYER_ACCEL_PER_STEP = 0.2;  // 每次 +20% 播放速度
export const LAYER_SPEED_CAP = 3;         // 加速封顶，避免 maxSteps 失控
export function layerTimeScale(t: number): number {
  if (t < LAYER_PREHEAT_SEC) return 0.6;
  if (t < LAYER_NORMAL_SEC) return 1;
  const steps = Math.floor((t - LAYER_NORMAL_SEC) / LAYER_ACCEL_STEP_SEC);
  return Math.min(LAYER_SPEED_CAP, 1 + LAYER_ACCEL_PER_STEP * steps);
}

// ── 持久化（localStorage 读写集中在此，调用方 try/catch 忽略失败）──
export const loadBest = (): number => {
  try { return parseInt(localStorage.getItem('ia_best') || '0', 10) || 0; }
  catch { return 0; }
};
export const saveBest = (v: number) => {
  try { localStorage.setItem('ia_best', String(v)); } catch { /* ignore */ }
};

// v2.1：无尽模式解锁状态（账号级，持久化）。
const ENDLESS_UNLOCK_KEY = 'ia_endless_unlocked';
export const loadEndless = (): boolean => {
  try { return localStorage.getItem(ENDLESS_UNLOCK_KEY) === '1'; }
  catch { return false; }
};
export const saveEndless = (v: boolean) => {
  try { localStorage.setItem(ENDLESS_UNLOCK_KEY, v ? '1' : '0'); } catch { /* ignore */ }
};

// v2.9.8 色盲友好模式（账号级，持久化）。
// 战场原本只靠「蓝=我方 / 红=敌方」一个颜色通道区分阵营，红绿色盲玩家在
// 混战里根本分不清谁是谁。开启后追加一条与颜色完全无关的**形状通道**
// （我方头顶 ▲ 实线环，敌方头顶 ▼ 虚线环），并把血条换成蓝/橙这对色盲安全色。
const COLORBLIND_KEY = 'ia_colorblind';
export const loadColorblind = (): boolean => {
  try { return localStorage.getItem(COLORBLIND_KEY) === '1'; }
  catch { return false; }
};
export const saveColorblind = (v: boolean) => {
  try { localStorage.setItem(COLORBLIND_KEY, v ? '1' : '0'); } catch { /* ignore */ }
};

export const loadSpeed = (): number => {
  try {
    const v = parseFloat(localStorage.getItem('ia_speed') || '1');
    return Number.isFinite(v) ? clampSpeed(v) : 1;
  } catch { return 1; }
};
export const saveSpeed = (v: number) => {
  try { localStorage.setItem('ia_speed', String(v)); } catch { /* ignore */ }
};

// vX 渲染质量档位（账号级，持久化）：high / standard / low。
const RENDER_Q_KEY = 'ia_render_q';
export const RENDER_Q_DEFAULT = 'standard' as const;
export const loadRenderQuality = (): 'high' | 'standard' | 'low' => {
  try {
    const v = localStorage.getItem(RENDER_Q_KEY);
    return v === 'high' || v === 'standard' || v === 'low' ? v : RENDER_Q_DEFAULT;
  } catch { return RENDER_Q_DEFAULT; }
};
export const saveRenderQuality = (v: 'high' | 'standard' | 'low') => {
  try { localStorage.setItem(RENDER_Q_KEY, v); } catch { /* ignore */ }
};

// v2.4.1 单套风格：仅 aurora 固定主题，省去 localStorage 读取与运行时切换。
export const THEME_DEFAULT = 'aurora' as const;
export const loadTheme = (): 'aurora' => THEME_DEFAULT;

export const loadPresets = (): TeamPreset[] => {
  try {
    const arr = JSON.parse(localStorage.getItem('ia_presets') || '[]');
    return Array.isArray(arr) ? arr.slice(0, MAX_PRESETS) : [];
  } catch { return []; }
};
export const savePresets = (p: TeamPreset[]) => {
  try { localStorage.setItem('ia_presets', JSON.stringify(p)); } catch { /* ignore */ }
};

// 模块级 uid 序列（同名多份副本的唯一标识，非 store 状态）。
let heroUidSeq = 0;
export const nextHeroUid = () => `H${++heroUidSeq}`;
