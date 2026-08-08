// economy slice：金币 / 背包 / 商店 / 装备 / 锻造 / 合成 / 招募 / 突破。
// 这是 store 里随一局诞生、随一局清空的全部「局内经济」状态。部分 action（recruit /
// upgradeHero / rerollMount / sellHero）会写 run.team 字段，属于正常的跨 slice 写入。
import type { StateCreator } from 'zustand';
import type { GameState, EconomySlice } from './types';
import { PRIMARY_KEYS } from '@arena/core/types';
import {
  forgeEquipment, transferAffixes, fuseEquipment, fuseKindOf, equipScore, rollShopStock, generateEquipment,
} from '@arena/core/content/equipment';
import { mulberry32 } from '@arena/core/engine/rng';
import { rollMount, rollMountRarity } from '@arena/core/content/mounts';
import { dominantPrimary } from '@arena/core/content/consumables';
import { variateHero } from '@arena/core/content/variant';
import { rollRecruitPool } from '@arena/core/content/heroes';
import {
  discountOf, recruitCostOf, REFRESH_COST, FUSE_PER_LAYER, EQUIP_SLOTS, TEAM_CAP,
  BREAKTHROUGH_MAIN_CHANCE, hashStr, nextHeroUid,
} from './helpers';
import { isRemoteMode, remoteWrite } from '../../../backend/storeBridge';

/**
 * v3.3b 乐观买入（本地部分）：立即扣金入库，返回是否成交。
 * 云端确认由调用方负责（buyItem 单件后台确认 / buyAllShop 串行确认），避免并发乐观锁互踩。
 */
function buyLocal(get: () => GameState, set: (p: Partial<GameState>) => void, id: string): boolean {
  const eq = get().shopStock.equipment.find((s) => s.id === id);
  const con = get().shopStock.consumables.find((s) => s.id === id);
  const item = eq ?? con;
  if (!item) return false;
  const price = Math.round(item.basePrice * (1 - discountOf(get().tradeCount)));
  if (get().gold < price) return false;
  if (eq) {
    set({
      gold: get().gold - price,
      shopStock: { ...get().shopStock, equipment: get().shopStock.equipment.filter((s) => s.id !== id) },
      inventory: [...get().inventory, eq],
      tradeCount: get().tradeCount + 1,
    });
  } else {
    set({
      gold: get().gold - price,
      shopStock: { ...get().shopStock, consumables: get().shopStock.consumables.filter((s) => s.id !== id) },
      consumables: [...get().consumables, con as import('@arena/core/types').ConsumableItem],
      tradeCount: get().tradeCount + 1,
    });
  }
  return true;
}

/**
 * v3.4 乐观穿戴（本地部分）：立即把装备穿到目标身上（自动先摘同实例），返回是否成功。
 * 云端确认由调用方负责（equipItem 单件后台确认 / equipAll 串行确认），防并发乐观锁互踩。
 */
function equipLocal(get: () => GameState, set: (p: Partial<GameState>) => void, uid: string, eqId: string): boolean {
  const inv = get().inventory;
  const item = inv.find((s) => s.id === eqId);
  if (!item) return false;
  const equipped = { ...get().equipped };
  // 先从任何副本身上摘下（装备实例唯一）
  for (const k of Object.keys(equipped)) {
    equipped[k] = (equipped[k] ?? []).filter((e) => e.id !== eqId);
  }
  const cur = equipped[uid] ?? [];
  if (cur.length >= EQUIP_SLOTS) return false; // 槽位已满
  equipped[uid] = [...cur, item];
  set({ inventory: inv.filter((s) => s.id !== eqId), equipped });
  return true;
}

export const createEconomySlice: StateCreator<GameState, [], [], EconomySlice> = (set, get) => ({
  gold: 0,
  inventory: [],
  pendingDrops: [],
  equipped: {},
  tradeCount: 0,
  shopStock: { equipment: [], consumables: [] },
  consumables: [],
  forgedThisLayer: [],
  recruitPool: [],
  fusedThisLayer: 0,
  reforgedThisLayer: false,
  refreshCount: 0,
  lastTransferLogs: [],
  lastBreakthrough: null,
  lastMount: null,
  lastKillGains: null,
  lastReforge: null,

  openDrop: (id) => {
  if (isRemoteMode()) {
    void remoteWrite(get, set, (b, env) => b.openDrop({ ...env, chestId: id }));
    return;
  }

    const drop = get().pendingDrops.find((d) => d.id === id);
    if (!drop) return;
    if (drop.reward.startsWith('gold')) {
      set({
        pendingDrops: get().pendingDrops.filter((d) => d.id !== id),
        gold: get().gold + (drop.gold ?? 0),
      });
    } else {
      const opened = { ...(drop.equipment as import('@arena/core/types').Equipment), opened: true };
      set({
        pendingDrops: get().pendingDrops.filter((d) => d.id !== id),
        inventory: [...get().inventory, opened],
      });
    }
  },

  // v3.2 批量开箱（全部开启）：云端单次写（防并发乐观锁互踩只开一部分）；本地循环单开
  openDrops: (ids) => {
    if (isRemoteMode()) {
      void remoteWrite(get, set, (b, env) => b.openDrops({ ...env, chestIds: ids }));
      return;
    }
    for (const id of ids) get().openDrop(id);
  },

  // ── v3.3 白色装备重铸 → 随机彩色（蓝/橙/红），每层一次 ──
  reforgeItem: (id) => {
    if (isRemoteMode()) {
      void remoteWrite(get, set, (b, env) => b.reforgeItem({ ...env, equipmentId: id }));
      return;
    }
    // 本地模式：与 rules.reforgeItem 同规则（确定性种子 + 随机三色 + 每层一次）
    const inv = get().inventory;
    const eq = inv.find((e) => e.id === id);
    if (!eq || eq.rarity !== 'normal' || get().reforgedThisLayer) return;
    const run = get().run;
    if (!run) return;
    const seed = hashStr(`${run.runId}:${id}:${run.layer}`) >>> 0;
    const rng = mulberry32(seed);
    const rarity = (['blue', 'orange', 'red'] as const)[Math.floor(rng() * 3)];
    const forged = { ...generateEquipment(rng, rarity), id: eq.id, opened: true };
    set({
      inventory: inv.map((e) => (e.id === id ? forged : e)),
      reforgedThisLayer: true,
      lastReforge: { from: eq.rarity, to: rarity, itemId: forged.id, name: forged.name },
    });
  },

  buyItem: (id) => {
    // ── v3.3b 乐观更新：本地立即扣金入库（金币后端权威，云端快照最终覆盖）──
    if (!buyLocal(get, set, id)) return;
    // 云端模式：后台确认（快照最终覆盖，权威以云端为准；本地已校验金币，云端不会拒绝）
    if (isRemoteMode()) {
      void remoteWrite(get, set, (b, env) => b.buyItem({ ...env, itemId: id }));
    }
  },

  // ── 一键全买：逐件走 buyItem（折扣依赖 tradeCount），买不起的货位跳过，买空即免费刷新 ──
  buyAllShop: () => {
  if (isRemoteMode()) {
    const run = get().run;
    if (!run) return 0;
    const ids = [
      ...get().shopStock.equipment.map((e) => e.id),
      ...get().shopStock.consumables.map((c) => c.id),
    ];
    if (ids.length === 0) return 0;
    // v3.3b 本地乐观全买（只做本地部分——buyItem 会并发云端写 → 乐观锁互踩）
    for (const id of ids) buyLocal(get, set, id);
    // 买空即免费刷新（本地即时生效）
    if (get().shopStock.equipment.length === 0 && get().shopStock.consumables.length === 0) {
      get().refreshShop(true);
    }
    // v3.4b 云端确认统一走全局串行队列（前一条确认后发下一条，杜绝乐观锁互踩）
    for (const id of ids) {
      void remoteWrite(get, set, (b, env) => b.buyItem({ ...env, itemId: id }));
    }
    return ids.length;
  }

    const before = get().shopStock;
    if (before.equipment.length === 0 && before.consumables.length === 0) return 0;
    const ids = [
      ...before.equipment.map((e) => ({ id: e.id, p: e.basePrice })),
      ...before.consumables.map((c) => ({ id: c.id, p: c.basePrice })),
    ].sort((a, b) => a.p - b.p).map((x) => x.id);

    let bought = 0;
    for (const id of ids) {
      get().buyItem(id);
      // 以「货位是否消失」判定成交，而不是看金币变化
      const stock = get().shopStock;
      if (!stock.equipment.some((e) => e.id === id) && !stock.consumables.some((c) => c.id === id)) bought++;
    }

    const after = get().shopStock;
    if (after.equipment.length === 0 && after.consumables.length === 0) {
      get().refreshShop(true); // 买空即免费补货
    }
    return bought;
  },

  sellItem: (id) => {
  if (isRemoteMode()) {
    void remoteWrite(get, set, (b, env) => b.sellItem({ ...env, equipmentId: id }));
    return;
  }

    const item = get().inventory.find((s) => s.id === id);
    if (!item) return;
    const price = Math.round(item.basePrice * 0.5 * (1 - discountOf(get().tradeCount) * 0.5));
    set({
      gold: get().gold + price,
      inventory: get().inventory.filter((s) => s.id !== id),
      tradeCount: get().tradeCount + 1,
    });
  },

  equipItem: (uid, eqId) => {
    // v3.4 乐观穿戴：本地立即生效（复用 equipLocal），云端后台确认（快照最终覆盖）
    if (!equipLocal(get, set, uid, eqId)) return;
    if (isRemoteMode()) {
      void remoteWrite(get, set, (b, env) => b.equipItem({ ...env, uid, equipmentId: eqId }));
    }
  },

  // ── 一键装备：传 uid 只填该勇者空槽；不传则全队按「空槽最多者优先」轮转发放 ──
  equipAll: (uid) => {
  if (isRemoteMode()) {
    const run = get().run;
    if (!run) return 0;
    const targets = uid ? run.team.filter((h) => h.uid === uid) : run.team;
    if (targets.length === 0) return 0;
    // v3.4b 本地乐观全部穿上（即时反馈）+ 云端**单次批量命令** equipAll 确认
    // （一次写回最终快照，杜绝逐件确认的中间快照把乐观状态覆盖回去 = "自动脱"根因）
    let done = 0;
    const pool = [...get().inventory];
    for (const item of pool) {
      const before = get().equipped;
      let target = null;
      let free = 0;
      for (const h of targets) {
        const f = 6 - (before[h.uid] ?? []).length;
        if (f > free) { free = f; target = h; }
      }
      if (!target || free === 0) break;
      if (equipLocal(get, set, target.uid, item.id)) done++;
    }
    void remoteWrite(get, set, (b, env) => b.equipAll({ ...env, uid }));
    return done;
  }

    const run = get().run;
    if (!run) return 0;
    const pool = [...get().inventory].sort((a, b) => equipScore(b) - equipScore(a));
    if (pool.length === 0) return 0;

    const equipped: Record<string, import('@arena/core/types').Equipment[]> = {};
    for (const k of Object.keys(get().equipped)) equipped[k] = [...(get().equipped[k] ?? [])];

    const targets = uid ? run.team.filter((h) => h.uid === uid) : run.team;
    if (targets.length === 0) return 0;
    for (const h of targets) if (!equipped[h.uid]) equipped[h.uid] = [];

    const used = new Set<string>();
    for (const item of pool) {
      let best: string | null = null;
      let bestFree = 0;
      for (const h of targets) {
        const free = EQUIP_SLOTS - equipped[h.uid].length;
        if (free > bestFree) { bestFree = free; best = h.uid; }
      }
      if (!best) break; // 全队槽位已满
      equipped[best].push(item);
      used.add(item.id);
    }
    if (used.size === 0) return 0;

    set({ equipped, inventory: get().inventory.filter((e) => !used.has(e.id)) });
    return used.size;
  },

  unequipItem: (uid, eqId) => {
  if (isRemoteMode()) {
    // 乐观更新：卸装零成本，本地立即生效，云端后台确认
    const equipped = { ...get().equipped };
    const cur = equipped[uid] ?? [];
    const item = cur.find((e) => e.id === eqId);
    if (!item) return;
    equipped[uid] = cur.filter((e) => e.id !== eqId);
    set({ equipped, inventory: [...get().inventory, item] });
    void remoteWrite(get, set, (b, env) => b.unequipItem({ ...env, uid, equipmentId: eqId }));
    return;
  }

    const equipped = { ...get().equipped };
    const cur = equipped[uid] ?? [];
    const item = cur.find((e) => e.id === eqId);
    if (!item) return;
    equipped[uid] = cur.filter((e) => e.id !== eqId);
    set({ equipped, inventory: [...get().inventory, item] });
  },

  // §12 锻造：仅普通装备，每件每层限 1 次；可消耗 N 件废普通装提升品质成功率
  forge: (equipmentId, consumeIds) => {
    if (isRemoteMode()) return;

    const target = get().inventory.find((e) => e.id === equipmentId);
    if (!target || target.rarity !== 'normal') return;        // 仅普通装备可锻造
    if (get().forgedThisLayer.includes(equipmentId)) return;   // 本层已锻造

    const consumeSet = new Set(consumeIds);
    const consumed = get().inventory.filter(
      (e) => consumeSet.has(e.id) && e.id !== equipmentId && e.rarity === 'normal',
    );
    const N = consumed.length;

    const run = get().run;
    const seed = run
      ? (run.seed ^ (run.layer * 2654435761) ^ (get().tradeCount * 40503) ^ (get().inventory.length * 2246822519)) >>> 0
      : (Math.random() * 1e9) | 0;
    const forged = forgeEquipment(target, N, mulberry32(seed));

    const remaining = get().inventory.filter((e) => e.id !== equipmentId && !consumeSet.has(e.id));
    set({
      inventory: [...remaining, forged],
      forgedThisLayer: [...get().forgedThisLayer, equipmentId],
    });
  },

  // ── v1.6 §A.4 属性转移锻造 ──
  transferForge: (targetId, materialIds) => {
    if (isRemoteMode()) return;

    const inv = get().inventory;
    const target = inv.find((e) => e.id === targetId);
    if (!target) return;
    if (get().forgedThisLayer.includes(targetId)) return;

    const matSet = new Set(materialIds.filter((id) => id !== targetId));
    const materials = inv.filter((e) => matSet.has(e.id));
    if (materials.length === 0) return;

    const run = get().run;
    const seed = run
      ? (run.seed ^ (run.layer * 0x27d4eb2d) ^ (get().tradeCount * 40503) ^ (inv.length * 2246822519)) >>> 0
      : (Math.random() * 1e9) | 0;
    const { result, logs } = transferAffixes(target, materials, mulberry32(seed));

    const remaining = inv.filter((e) => e.id !== targetId && !matSet.has(e.id));
    set({
      inventory: [...remaining, result],
      forgedThisLayer: [...get().forgedThisLayer, targetId],
      lastTransferLogs: logs,
    });
  },

  // ── 一键熔炼：把背包里除核心装以外的全部装备一次性喂进去（复用 transferForge 链路）──
  transferForgeAll: (targetId) => {
    if (isRemoteMode()) return;

    const inv = get().inventory;
    if (!inv.some((e) => e.id === targetId)) return;
    const materialIds = inv.filter((e) => e.id !== targetId).map((e) => e.id);
    if (materialIds.length === 0) return;
    get().transferForge(targetId, materialIds);
  },

  canFuse: (aId, bId) => {
    if (isRemoteMode()) return false;

    const inv = get().inventory;
    const a = inv.find((e) => e.id === aId);
    const b = inv.find((e) => e.id === bId);
    if (!a || !b) return false;
    if (get().fusedThisLayer >= FUSE_PER_LAYER) return false;
    return fuseKindOf(a, b) !== null;
  },

  // ── v1.6 §A.5 合成：2 蓝→1 橙 / 2 橙→1 红 / 红+红→升星（封顶 5★）──
  fuse: (aId, bId) => {
    if (isRemoteMode()) return;

    const inv = get().inventory;
    const a = inv.find((e) => e.id === aId);
    const b = inv.find((e) => e.id === bId);
    if (!a || !b) return;
    if (get().fusedThisLayer >= FUSE_PER_LAYER) return;
    if (!fuseKindOf(a, b)) return;

    const run = get().run;
    const seed = run
      ? (run.seed ^ (run.layer * 0x85ebca6b) ^ (get().fusedThisLayer * 0xc2b2ae35) ^ (inv.length * 2654435761)) >>> 0
      : (Math.random() * 1e9) | 0;
    const product = fuseEquipment(a, b, mulberry32(seed));
    if (!product) return;

    const remaining = inv.filter((e) => e.id !== aId && e.id !== bId);
    set({
      inventory: [...remaining, product],
      fusedThisLayer: get().fusedThisLayer + 1,
    });
  },

  // ── v1.6 §A.7 1 金币刷新（free=true 用于「一键全买」后的免费补货）──
  refreshShop: (free = false) => {
  if (isRemoteMode()) {
    void remoteWrite(get, set, (b, env) => b.refreshShop(env));
    return;
  }

    if (!free && get().gold < REFRESH_COST) return;
    const run = get().run;
    const rc = get().refreshCount + 1;
    const seed = run
      ? (run.seed ^ (run.layer * 7919) ^ (rc * 0x9e3779b1)) >>> 0
      : (Math.random() * 1e9) | 0;
    set({
      gold: get().gold - (free ? 0 : REFRESH_COST),
      shopStock: rollShopStock(mulberry32(seed), 8),
      refreshCount: rc,
    });
  },

  refreshRecruit: () => {
  if (isRemoteMode()) {
    void remoteWrite(get, set, (b, env) => b.refreshRecruit(env));
    return;
  }

    const run = get().run;
    if (!run) return;
    if (get().gold < REFRESH_COST) return;
    const rc = get().refreshCount + 1;
    const seed = (run.seed ^ (run.layer * 104729) ^ (rc * 0x85ebca77)) >>> 0;
    set({
      gold: get().gold - REFRESH_COST,
      recruitPool: rollRecruitPool(mulberry32(seed), run.team),
      refreshCount: rc,
    });
  },

  // v1.3 英雄招募 / v1.7 §1：重复招募同一角色 = 新增一份副本（独立 uid / dupIndex），与升星/突破解耦
  recruit: (heroId) => {
  if (isRemoteMode()) {
    void remoteWrite(get, set, (b, env) => b.recruit({ ...env, heroId: heroId }));
    return;
  }

    const run = get().run;
    if (!run) return;
    const hero = get().recruitPool.find((h) => h.id === heroId);
    if (!hero) return;
    const cost = recruitCostOf(run.layer);
    if (get().gold < cost) return;
    if (run.team.length >= TEAM_CAP) return; // 满编不可再招募
    const dupIndex = run.team.filter((h) => h.id === heroId).length + 1;
    const vseed = (run.seed ^ hashStr(heroId) ^ (get().refreshCount * 0x9e3779b1)) >>> 0;
    // v3.1：把队内已用姓名传进去做去重——招到第二个「铁壁镇守」时，
    // 玩家应该看到的是两个不同的人，而不是两个同名的人
    const taken = run.team.map((h) => h.personalName ?? h.name);
    const copy = { ...variateHero(hero, vseed, taken), uid: nextHeroUid(), star: 1, dupIndex };
    set({
      gold: get().gold - cost,
      run: { ...run, team: [...run.team, copy] },
      recruitPool: get().recruitPool.filter((h) => h.id !== heroId),
      lastBreakthrough: null,
      lastMount: null,
    });
  },

  // v1.7 §1：对某一特定副本升星；满 5★ 后继续升级 = 随机属性突破（+3%~5%，无上限）。
  upgradeHero: (uid) => {
  if (isRemoteMode()) {
    void remoteWrite(get, set, (b, env) => b.upgradeHero({ ...env, uid: uid }));
    return;
  }

    const run = get().run;
    if (!run) return;
    const idx = run.team.findIndex((h) => h.uid === uid);
    if (idx < 0) return;
    const cost = recruitCostOf(run.layer);
    if (get().gold < cost) return;

    const cur = run.team[idx];
    const star = cur.star ?? 1;
    const team = [...run.team];

    if (star < 5) {
      const nextStar = star + 1;
      const mount = nextStar >= 5 && !cur.mount
        ? rollMount(mulberry32((run.seed ^ hashStr(cur.uid) ^ (run.layer * 0x85ebca6b)) >>> 0))
        : cur.mount;
      const mountRarity = nextStar >= 5 && !cur.mountRarity && mount
        ? rollMountRarity(mulberry32((run.seed ^ hashStr(cur.uid) ^ (run.layer * 0x85ebca6b) ^ 0x9e3779b9) >>> 0))
        : cur.mountRarity;
      team[idx] = { ...cur, star: nextStar, mount, mountRarity };
      set({
        gold: get().gold - cost,
        run: { ...run, team },
        lastBreakthrough: null,
        lastMount: mount && mount !== cur.mount ? { heroUid: cur.uid, kind: mount } : null,
      });
      return;
    }

    // 已满 5★ → 一级属性突破 +3%~5%（无上限，金币的长期出口）
    const bonusPct = { ...(cur.bonusPct ?? {}) };
    const accum = Math.round(Object.values(bonusPct).reduce<number>((s, v) => s + (v ?? 0), 0) * 10);
    const seed = (
      run.seed ^ (run.layer * 0x6a09e667) ^ (get().tradeCount * 0xbb67ae85) ^ (run.score * 13)
      ^ hashStr(cur.uid) ^ Math.imul(accum + 1, 0x27d4eb2d)
    ) >>> 0;
    const rng = mulberry32(seed);

    const main = dominantPrimary(cur.basePrimary);
    const hitMain = rng() < BREAKTHROUGH_MAIN_CHANCE;
    const others = PRIMARY_KEYS.filter((k) => k !== main);
    const key = hitMain
      ? main
      : (others[Math.floor(rng() * others.length)] ?? main);

    const add = Math.round((3 + rng() * 2) * 10) / 10; // 3.0 ~ 5.0，保留 1 位小数
    bonusPct[key] = Math.round(((bonusPct[key] ?? 0) + add) * 10) / 10;
    team[idx] = { ...cur, bonusPct };
    set({
      gold: get().gold - cost,
      run: { ...run, team },
      lastBreakthrough: { heroId: cur.id, heroUid: cur.uid, key, add, main: hitMain },
      lastMount: null,
    });
  },

  // v2.9.3 坐骑刷新召唤：消耗金币重 roll 坐骑种类 + 品质（蓝/橙/紫）。
  rerollMount: (uid) => {
    if (isRemoteMode()) return;

    const run = get().run;
    if (!run) return;
    const hero = run.team.find((h) => h.uid === uid);
    if (!hero || !hero.mount) return;
    const cost = Math.min(2000, 500 + 200 * (get().tradeCount % 8));
    if (get().gold < cost) return;
    const rng = mulberry32((run.seed ^ hashStr(uid) ^ (get().tradeCount * 0x1b873593)) >>> 0);
    const mount = rollMount(rng);
    const mountRarity = rollMountRarity(rng);
    const team = run.team.map((h) => (h.uid === uid ? { ...h, mount, mountRarity } : h));
    set({
      gold: get().gold - cost,
      run: { ...run, team },
      lastMount: { heroUid: uid, kind: mount },
    });
  },

  // v1.7 §1：出售不需要的副本。返还 80% 招募价，卸下装备回到背包，至少保留 1 名。
  sellHero: (uid) => {
    if (isRemoteMode()) return;

    const run = get().run;
    if (!run) return;
    if (run.team.length <= 1) return; // 至少留一名勇者
    const hero = run.team.find((h) => h.uid === uid);
    if (!hero) return;
    const refund = Math.round(recruitCostOf(run.layer) * 0.8);
    const eqs = get().equipped[uid] ?? [];
    const equipped = { ...get().equipped };
    delete equipped[uid];
    set({
      gold: get().gold + refund,
      run: { ...run, team: run.team.filter((h) => h.uid !== uid) },
      equipped,
      inventory: [...get().inventory, ...eqs],
    });
  },

  recruitCost: () => recruitCostOf(get().run?.layer ?? 1),

  discount: () => discountOf(get().tradeCount),
});
