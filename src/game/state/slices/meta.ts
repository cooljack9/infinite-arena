// meta slice：账号级持久化 + 导航 + 战前布阵 + 编队预设。
// 这一份状态跨局/跨会话保持，是 store 里最稳定、最少变动的部分，单独拆出后
// 既易于定位，也把「偏好/持久化」与「局内经济」彻底分开。
import type { StateCreator } from 'zustand';
import type { GameState, MetaSlice } from './types';
import {
  loadBest, loadEndless, loadSpeed, loadPresets, savePresets, clampSpeed,
  loadColorblind, saveColorblind,
  MAX_PRESETS,
} from './helpers';
import { HEROES } from '@arena/core/content/heroes';

export const createMetaSlice: StateCreator<GameState, [], [], MetaSlice> = (set, get) => ({
  screen: 'menu',
  bestLayer: loadBest(),
  lastResult: null,
  endlessUnlocked: loadEndless(),
  selectedMode: 'novice',
  battleSpeed: loadSpeed(),
  // v2.9.8 色盲友好双通道（账号级偏好，跨局/跨会话保持）
  colorblind: loadColorblind(),

  // v2.3 战前布阵：空表 = 尚未自定义，进战时按预设自动生成
  formation: {},
  formationPreset: 'line',

  // v2.0 编队预设
  teamSelection: HEROES.slice(0, 3).map((h) => h.id),
  teamPresets: loadPresets(),

  setScreen: (screen) => set({ screen }),
  fxBusy: null,
  setFxBusy: (label) => set({ fxBusy: label }),
  departScene: null,
  setDepartScene: (d) => set({ departScene: d }),

  // v2.1 模式选择（主菜单/编队界面设定，startRun 时作为本局模式）
  setSelectedMode: (m) => set({ selectedMode: m }),

  setBattleSpeed: (v) => {
    const s = clampSpeed(v);
    try { localStorage.setItem('ia_speed', String(s)); } catch { /* ignore */ }
    set({ battleSpeed: s });
  },

  // v2.9.8 色盲友好双通道：渲染层每帧从 store 读，改完立刻生效（无需重开战斗）
  setColorblind: (v) => {
    saveColorblind(v);
    set({ colorblind: v });
  },

  // v2.3 战前布阵：PreBattle 确认开战时写回，BattleScreen 读取并覆盖出生点
  setFormation: (f, preset) =>
    set(preset ? { formation: f, formationPreset: preset } : { formation: f }),

  // ── v2.0 编队预设 ──
  setTeamSelection: (ids) => set({ teamSelection: ids }),

  savePreset: (name) => {
    const ids = get().teamSelection;
    if (ids.length !== 3) return; // 仅恰好 3 人时可保存
    const presets = [
      ...get().teamPresets,
      { name: name.trim() || `预设 ${get().teamPresets.length + 1}`, ids: [...ids] },
    ].slice(-MAX_PRESETS);
    savePresets(presets);
    set({ teamPresets: presets });
  },

  applyPreset: (index) => {
    const p = get().teamPresets[index];
    if (p) set({ teamSelection: [...p.ids] });
  },

  deletePreset: (index) => {
    const presets = get().teamPresets.filter((_, i) => i !== index);
    savePresets(presets);
    set({ teamPresets: presets });
  },
});
