// v1.8.3 三存档核心序列化测试（node 环境 + localStorage 内存 stub）。
// 覆盖：写入/读取往返、摘要、删除、激活槽位持久化、槽位隔离。
import { describe, it, expect, beforeEach } from 'vitest';

// ── localStorage stub（node 无 localStorage；saves.ts 仅在函数调用时访问）──
const mem = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(),
  },
  configurable: true,
});

import {
  writeSave, readSave, readSaveMeta, deleteSave,
  getActiveSlot, setActiveSlot, SAVE_SLOTS,
  type SaveMeta, type SaveSnapshot,
} from '../src/game/saves';

const fakeSnap = (layer: number): SaveSnapshot => ({
  run: {
    runId: 'local-test', layer, team: [], relics: [], score: 100, seed: 42, mode: 'novice', failures: 0,
  },
  resolvedEvents: [], seenArenaHints: [],
  gold: 50, inventory: [], pendingDrops: [], equipped: {}, tradeCount: 0,
  shopStock: { equipment: [], consumables: [] }, consumables: [],
  forgedThisLayer: [], recruitPool: [], fusedThisLayer: 0, reforgedThisLayer: false,
  refreshCount: 0, lastTransferLogs: [], lastBreakthrough: null, lastMount: null,
  lastKillGains: null, lastReforge: null, formation: {},
});

const fakeMeta = (slot: 0 | 1 | 2, layer: number, savedAt: number): SaveMeta => ({
  slot, mode: 'novice', layer, score: 100, teamNames: ['甲', '乙'], savedAt,
});

beforeEach(() => mem.clear());

describe('saves 序列化', () => {
  it('写入→读取往返一致（meta + snap 完整还原）', () => {
    const slot = 0;
    writeSave(slot, fakeMeta(slot, 3, 1234), fakeSnap(3));
    const r = readSave(slot);
    expect(r).not.toBeNull();
    expect(r!.meta.layer).toBe(3);
    expect(r!.snap.run.layer).toBe(3);
    expect(r!.snap.run.seed).toBe(42);
    expect(r!.snap.run.mode).toBe('novice');
    expect(r!.snap.gold).toBe(50);
  });

  it('三个槽位互相隔离（写 0 不影响 1/2）', () => {
    writeSave(0, fakeMeta(0, 3, 1), fakeSnap(3));
    expect(readSaveMeta(1)).toBeNull();
    expect(readSaveMeta(2)).toBeNull();
    writeSave(2, fakeMeta(2, 9, 2), fakeSnap(9));
    expect(readSaveMeta(0)!.layer).toBe(3);
    expect(readSaveMeta(2)!.layer).toBe(9);
    expect(readSave(1)).toBeNull();
  });

  it('删除槽位后不可读', () => {
    writeSave(1, fakeMeta(1, 5, 1), fakeSnap(5));
    deleteSave(1);
    expect(readSave(1)).toBeNull();
    expect(readSaveMeta(1)).toBeNull();
  });

  it('损坏 JSON 返回 null 不抛异常', () => {
    mem.set('ia_save_0', '{oops');
    expect(readSave(0)).toBeNull();
    expect(readSaveMeta(0)).toBeNull();
  });

  it('SAVE_SLOTS 恒为 [0,1,2]', () => {
    expect(SAVE_SLOTS).toEqual([0, 1, 2]);
  });
});

describe('激活槽位持久化', () => {
  it('设置→读取往返', () => {
    expect(getActiveSlot()).toBeNull();
    setActiveSlot(1);
    expect(getActiveSlot()).toBe(1);
    setActiveSlot(0);
    expect(getActiveSlot()).toBe(0);
  });

  it('null 清除激活槽', () => {
    setActiveSlot(2);
    setActiveSlot(null);
    expect(getActiveSlot()).toBeNull();
  });
});
