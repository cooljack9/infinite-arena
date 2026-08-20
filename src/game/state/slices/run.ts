// run slice：局内生命周期 + 成长写回 + 战斗结算 + 随机奇遇。
// 这一份状态随一局开始而建立、结束而清空。部分 action 会写 meta（screen / bestLayer
// / endlessUnlocked / lastResult）或 economy（gold / inventory / equipped …）字段，
// 这是 zustand slices 模式的常态——set/get 操作的是完整 GameState，跨 slice 写入完全合法。
import type { StateCreator } from 'zustand';
import type { GameState, RunSlice } from './types';
import { mulberry32 } from '@arena/core/engine/rng';
import { genLayer } from '@arena/core/gen/levelGen';
import {
  generateEquipment, equipScore, rollDrops, rollShopStock,
} from '@arena/core/content/equipment';
import { rollGrowthPotion } from '@arena/core/content/consumables';
import { rollRecruitPool } from '@arena/core/content/heroes';
import { variateHero } from '@arena/core/content/variant';
import { NOVICE_CAP, bossTierAt } from '@arena/core/engine/scaling';
import {
  nextHeroUid, hashStr, addGrowth, rollStarterKit, goldReward,
  saveBest, saveEndless,
} from './helpers';
import { PRIMARY_KEYS, PrimaryAttrs, Chest } from '@arena/core/types';
import { CORE_VERSION } from '@arena/core/contract';
import { getBackend } from '../../../backend/index';
import { isRemoteMode, applySnapshot, genIdemKey, syncMeta, remoteWrite } from '../../../backend/storeBridge';
import {
  writeSave, readSave, type SaveSnapshot, type SaveMeta,
} from '../../saves';

export const createRunSlice: StateCreator<GameState, [], [], RunSlice> = (set, get) => ({
  run: null,
  resolvedEvents: [],
  seenArenaHints: [],
  battleEval: null,
  battleRemote: null,

  setBattleRemote: (d) => set({ battleRemote: d }),
  clearBattleRemote: () => set({ battleRemote: null }),
  prefetchBattle: null,
  setPrefetchBattle: (d) => set({ prefetchBattle: d }),

  startRun: (team, mode = get().selectedMode) => {
    if (isRemoteMode()) {
      // ── 云端模式：开局由 Edge Function 权威创建（种子服务端生成，客户端不指定）──
      // 模式解锁判断交给云端（endlessUnlocked 以云端 meta 为准），前端不本地降级
      // v3.4i 网络/会话类失败自动重试（冷启动慢、token 过期重建等瞬时故障一次点到底）
      const attempt = (n: number): void => {
        void (async () => {
          try {
            const r = await getBackend().startRun({
              heroIds: team.map((h) => h.id),
              mode,
              idempotencyKey: genIdemKey(),
              coreVersion: CORE_VERSION,
            });
            if (r.ok) {
              try {
                applySnapshot(set, r.data);
              } catch (e) {
                console.warn('[arena] 开局快照应用异常:', e);
                set({ departScene: null, fxBusy: '开局数据异常，请重试' });
                window.setTimeout(() => set({ fxBusy: null }), 1250);
                return;
              }
              set({ screen: 'pre', formation: {}, battleRemote: null, battleCtx: { mode: 'normal' }, climbSession: null });
              void syncMeta(set);
              return;
            }
            // 瞬时故障（超时/会话失效/服务不可用）自动重试；业务错误如实提示
            if (n < 3 && (r.code === 'RATE_LIMITED' || r.code === 'UNAUTHORIZED')) {
              console.warn(`[arena] 开局 ${r.code}，${n + 1} 秒后自动重试`);
              window.setTimeout(() => attempt(n + 1), 1200);
              return;
            }
            console.warn('[arena] 云端开局被拒:', r.code, r.message);
            set({ departScene: null, fxBusy: `开局失败（${r.code}），请重试` });
            window.setTimeout(() => set({ fxBusy: null }), 1800);
          } catch (e) {
            if (n < 3) {
              console.warn('[arena] 云端开局异常，自动重试:', e);
              window.setTimeout(() => attempt(n + 1), 1200);
              return;
            }
            console.warn('[arena] 云端开局异常:', e);
            set({ departScene: null, fxBusy: '开局失败（网络异常），请重试' });
            window.setTimeout(() => set({ fxBusy: null }), 1800);
          }
        })();
      };
      attempt(1);
      return;
    }

    // v2.2 安全护栏：普通/铁人无尽模式未解锁时强制回退新手，避免越权开局
    const effectiveMode = (mode === 'normal' || mode === 'ironman') && !get().endlessUnlocked ? 'novice' : mode;

    // ── 本地模式：原逻辑（runId 仅本地标识，不进任何云端请求）──
    const seed = (Math.random() * 1e9) | 0;    const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    const shop = rollShopStock(rng, 8); // 初始商店 8 件（含一次性物品），局内不刷新
    // v2.1 角色特性分离：给每一份初始队员分配 uid / 1★ / dupIndex=1，并用 run.seed 混盐做差异化
    // v3.1：姓名逐个生成并累积去重，开局三人不会撞名
    const takenNames: string[] = [];
    const teamWithUid = team.map((_, i) => {
      const h = team[i];
      const vseed = (seed ^ ((i + 1) * 0x9e3779b1)) >>> 0;
      const v = variateHero(h, vseed, takenNames);
      if (v.personalName) takenNames.push(v.personalName);
      return { ...v, uid: nextHeroUid(), star: h.star ?? 1, dupIndex: h.dupIndex ?? 1 };
    });
    // v2.6 §1：新手模式发放教学初始装备包（2 蓝 + 2 白）；无尽模式白手起家是核心张力
    const starter = effectiveMode === 'novice' ? rollStarterKit(rng) : [];
    set({
      run: {
        runId: `local-${seed.toString(36)}`,
        layer: 1, team: teamWithUid, relics: [], score: 0, seed, mode: effectiveMode, failures: 0,
      },
      screen: 'pre',
      formation: {},     // v2.3：新开一局清空布阵，避免上一局的 uid 残留占位
      gold: 0,
      inventory: starter,
      pendingDrops: [],
      equipped: {},
      seenArenaHints: [],
      tradeCount: 0,
      shopStock: shop,
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
      resolvedEvents: [],
      battleRemote: null,
      battleCtx: { mode: 'normal' },   // v2.10 防御：新开一局清除上局残留的 skip5/爬塔上下文
      climbSession: null,
    });
    // v1.8.3 三存档：新开局若绑定了槽位，立即把初始快照写入该槽（此后 settle 自动更新）
    if (get().activeSlot !== null && get().run) get().saveToSlot();
  },

  // §9 胜利掉落：宝箱（数量随关型） + 金币奖励 + v1.3 英雄招募池刷新
  // v1.7 §3：boss 层（每 10 层）掉 8~12 箱，小关 3~6 箱
  // v1.8：opts.layers 支持下五层按多层逐层发奖（奖励基础 = 五层之和，池按 poolLayer 刷一次）、
  //       highBonus 用「高奖 +10%」掉落表；不传 = 旧行为逐 bit 相同。
  collectLoot: (layer, opts) => {
    if (isRemoteMode()) return;

    const run = get().run;
    if (!run) return;
    const layers = opts?.layers && opts.layers.length ? opts.layers : [layer];
    const poolLayer = opts?.poolLayer ?? layer;
    let goldGain = 0;
    const drops: Chest[] = [];
    for (const L of layers) {
      const rng = mulberry32((run.seed + L * 7919) >>> 0);
      const boss = bossTierAt(L, run.mode) !== undefined; // v2.4：Boss 关按新密度判定
      drops.push(...rollDrops(rng, L, boss, opts?.highBonus));
      goldGain += goldReward(L);
    }
    // v1.7 胜利掉落同时刷新招募池，且池内英雄即个体化（基础值/体型/姓名各异），价格据此浮动
    const rrng = mulberry32((run.seed + poolLayer * 104729 + 7) >>> 0);
    const taken = run.team.map((h) => h.personalName ?? h.name);
    set({
      pendingDrops: [...get().pendingDrops, ...drops],
      gold: get().gold + goldGain,
      recruitPool: rollRecruitPool(rrng, run.team).map((h, i) =>
        variateHero(h, (run.seed ^ (poolLayer * 2654435761) ^ (i * 0x9e3779b1)) >>> 0, taken)),
    });
  },

  // v1.8 自动爬塔奖励入账（本地模式；播放逐层发奖或成功路径一次性发奖）
  climbReward: (gold, drops) => {
    if (isRemoteMode()) return;
    set({
      gold: get().gold + gold,
      pendingDrops: [...get().pendingDrops, ...drops],
    });
  },

  // 进入新层：重置锻造/合成的每层限制，并清空一次性反馈
  // 注：云端模式下 layer 由权威快照推进，此处仅作前端导航/显示过渡（不产生权威分叉，
  // 下次云端快照会覆盖）；Remote 模式 inter 屏已改为不调 setLayer（见 IntermissionHub）。
  setLayer: (n) => {
    const run = get().run;
    if (!run) return;
    set({
      run: { ...run, layer: n },
      forgedThisLayer: [],
      fusedThisLayer: 0,
      reforgedThisLayer: false,
      lastTransferLogs: [],
      lastBreakthrough: null,
      lastKillGains: null,
    });
  },

  addScore: (s) => {
    if (isRemoteMode()) return;

    const run = get().run;
    if (!run) return;
    set({ run: { ...run, score: run.score + s } });
  },

  // v2.4 容错：记录本局已用掉的失败次数（不切换界面，由调用方决定重试还是结束）
  setFailures: (n) => {
    if (isRemoteMode()) return;

    const run = get().run;
    if (!run) return;
    set({ run: { ...run, failures: n } });
  },

  addRelic: (r) => {
    if (isRemoteMode()) return;

    const run = get().run;
    if (!run) return;
    set({ run: { ...run, relics: [...run.relics, r] } });
  },

  finishBattle: (win, layer, score) => {
    const run = get().run;
    const mode = run?.mode ?? 'novice';
    // v2.2 解锁无尽：新手模式打通封顶层（NOVICE_CAP=5）即「通关」，解锁两种无尽模式
    let endlessUnlocked = get().endlessUnlocked;
    if (win && mode === 'novice' && layer >= NOVICE_CAP) {
      endlessUnlocked = true;
      saveEndless(true);
    }
    const newBest = Math.max(get().bestLayer, layer);
    saveBest(newBest);
    set({
      bestLayer: newBest,
      endlessUnlocked,
      lastResult: { layer, score, win, mode },
      screen: 'result',
    });
  },

  // v2.2 铁人无尽（permadeath）：把本场战斗中阵亡的友方副本永久移除。
  // 阵亡角色的装备卸回背包（可复用），但角色本身不再复活。至少保留 1 名勇者。
  removeDeadAllies: (uids) => {
    if (isRemoteMode()) return;

    const run = get().run;
    if (!run || run.team.length <= 1) return;
    const uidSet = new Set(uids);
    const removed = run.team.filter((h) => uidSet.has(h.uid));
    if (removed.length === 0 || removed.length >= run.team.length) return;
    const eqs = removed.flatMap((h) => get().equipped[h.uid] ?? []);
    const equipped = { ...get().equipped };
    for (const h of removed) delete equipped[h.uid];
    set({
      run: { ...run, team: run.team.filter((h) => !uidSet.has(h.uid)) },
      equipped,
      inventory: [...get().inventory, ...eqs],
    });
  },

  // v1.7 §2：战斗结束后把击杀成长写回对应副本。gains 按 uid 索引，已逐 key 累加。
  commitGrowth: (gains) => {
    if (isRemoteMode()) return;

    const run = get().run;
    if (!run) return;
    const team = run.team.map((h) => {
      const g = gains[h.uid];
      return g ? { ...h, growthBonus: addGrowth(h.growthBonus, g) } : h;
    });
    set({ run: { ...run, team }, lastKillGains: gains });
  },

  // v2.9.6 战后评价：记录战报快照，并把「继续」前的中转屏设为 eval。
  // MVP = 友方（造成伤害 + 治疗）最高者；win 时额外 +1 随机一级属性成长（写回 growthBonus）。
  // 云端模式：MVP 成长已由服务端 settle 应用进快照，此处仅记录战报，不再本地加成长。
  recordBattleEval: (rows, winner, currentLayer, nextLayer, cap, mvp?: { uid: string | null; stat: keyof PrimaryAttrs | null; add: number }) => {
    if (isRemoteMode()) {
      set({
        battleEval: {
          rows, winner, currentLayer, nextLayer, cap,
          mvpUid: mvp?.uid ?? null, mvpStat: mvp?.stat ?? null, mvpAdd: mvp?.add ?? 0,
        },
        screen: 'eval',
      });
      return;
    }
    let mvpUid: string | null = null;
    let best = -1;
    for (const r of rows) {
      if (r.side !== 'ally' || !r.heroUid) continue;
      const score = r.dmgDealt + r.healDone;
      if (score > best) { best = score; mvpUid = r.heroUid; }
    }
    let mvpStat: keyof PrimaryAttrs | null = null;
    let mvpAdd = 0;
    if (winner === 'win' && mvpUid) {
      const run = get().run;
      if (run) {
        const k = PRIMARY_KEYS[Math.floor(Math.random() * PRIMARY_KEYS.length)] as keyof PrimaryAttrs;
        mvpStat = k; mvpAdd = 1;
        const team = run.team.map((h) =>
          h.uid === mvpUid ? { ...h, growthBonus: addGrowth(h.growthBonus, { primary: { [k]: 1 } }) } : h,
        );
        set({ run: { ...run, team } });
      }
    }
    set({
      battleEval: { rows, winner, currentLayer, nextLayer, cap, mvpUid, mvpStat, mvpAdd },
      screen: 'eval',
    });
  },

  // 进入战斗即消耗爆发标记（仅对下一场生效）
  consumeBurst: (uid) => {
    if (isRemoteMode()) return;

    const run = get().run;
    if (!run) return;
    const hero = run.team.find((h) => h.uid === uid);
    if (!hero || !hero.pendingBurst) return;
    const team = run.team.map((h) => (h.uid === uid ? { ...h, pendingBurst: false } : h));
    set({ run: { ...run, team } });
  },

  // v1.7 §4：使用一次性物品。成长药剂立即结算一次成长；爆发药剂打 pendingBurst 标记。
  useConsumable: (id, uid) => {
    if (isRemoteMode()) return;

    const run = get().run;
    if (!run) return;
    const item = get().consumables.find((c) => c.id === id);
    if (!item) return;
    const hero = run.team.find((h) => h.uid === uid);
    if (!hero) return;
    if (item.kind === 'burst') {
      const team = run.team.map((h) => (h.uid === uid ? { ...h, pendingBurst: true } : h));
      set({ run: { ...run, team }, consumables: get().consumables.filter((c) => c.id !== id) });
      return;
    }
    // growth
    const seed = (run.seed ^ hashStr(id) ^ (get().tradeCount * 40503)) >>> 0;
    const roll = rollGrowthPotion(mulberry32(seed));
    const g = {
      primary: { [roll.primaryKey]: roll.primaryAdd },
      secondaryPct: { [roll.secondaryKey]: roll.secondaryPct },
    };
    const team = run.team.map((h) => (h.uid === uid ? { ...h, growthBonus: addGrowth(h.growthBonus, g) } : h));
    set({ run: { ...run, team }, consumables: get().consumables.filter((c) => c.id !== id) });
  },

  // ── 随机奇遇事件结算（需求：随机事件）──
  // 战前布阵选择某选项后调用：按选项 effect 确定性结算金币 / 装备 / 积分，
  // 同一层只结算一次（resolvedEvents 记录已处理的层）。装备产出用层种子派生，完全可复现。
  resolveRandomEvent: (layer, optionIndex) => {
    if (isRemoteMode()) {
      // v3.4 云端权威结算（此前短路导致点了没反应）
      void remoteWrite(get, set, (b, env) => b.resolveRandomEvent({ ...env, layer, optionIndex }));
      return;
    }

    const run = get().run;
    if (!run) return;
    // 只允许结算「当前所在层」的奇遇；否则传陈旧层号即可绕过去重刷金。
    if (layer !== run.layer) return;
    if (get().resolvedEvents.includes(layer)) return;
    const plan = genLayer(layer, run.seed, run.mode);
    const ev = plan.randomEvent;
    if (!ev) return;
    const opt = ev.options[optionIndex];
    if (!opt) return;
    const e = opt.effect;
    // 献祭类选项必须真的付出一件装备才给钱；背包为空时直接拒绝（无源之汇）。
    if (e.sacrificeLowest && get().inventory.length === 0) return;
    // 付费类选项买不起就不成交，金币不允许为负。
    if (e.gold && e.gold < 0 && get().gold + e.gold < 0) return;

    let gold = get().gold;
    let inventory = [...get().inventory];
    let score = run.score;

    if (e.gold) gold += e.gold;
    if (e.give) {
      const rng = mulberry32((run.seed ^ (layer * 2654435761) ^ (optionIndex * 40503)) >>> 0);
      for (let i = 0; i < e.give.count; i++) {
        inventory.push(generateEquipment(rng, e.give.rarity));
      }
    }
    if (e.sacrificeLowest && inventory.length > 0) {
      // 销毁背包评分最低的一件装备（不改变期望，纯取舍）
      const worst = inventory.slice().sort((a, b) => equipScore(a) - equipScore(b))[0];
      inventory = inventory.filter((x) => x.id !== worst.id);
    }
    if (e.score) score += e.score;

    set({
      gold,
      inventory,
      run: { ...run, score },
      resolvedEvents: [...get().resolvedEvents, layer],
    });
  },

  // v3.4e 特殊地图（八角笼/疯狂龙巢）首次出现提示已读（本局只提示一次）
  markArenaSeen: (id) => {
    if (get().seenArenaHints.includes(id)) return;
    set({ seenArenaHints: [...get().seenArenaHints, id] });
  },

  reset: () =>
    set({
      run: null,
      screen: 'menu',
      battleEval: null,
      battleRemote: null,
      lastResult: null,
      gold: 0,
      inventory: [],
      pendingDrops: [],
      equipped: {},
      seenArenaHints: [],
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
      resolvedEvents: [],
      departScene: null,
      battleCtx: { mode: 'normal' },   // v2.10 防御：结束/放弃本局时清除 skip5/爬塔上下文
      climbSession: null,
    }),

  // ══ v1.8.3 三存档（本地模式）══
  // 保存当前局到激活槽位；云端模式不落本地槽（进度由账号保留）。
  saveToSlot: () => {
    const slot = get().activeSlot;
    const run = get().run;
    if (slot === null || !run || isRemoteMode()) return false;
    const meta: SaveMeta = {
      slot,
      mode: run.mode,
      layer: run.layer,
      score: run.score,
      teamNames: run.team.map((h) => h.personalName ?? h.name),
      savedAt: Date.now(),
    };
    const snap: SaveSnapshot = {
      run: JSON.parse(JSON.stringify(run)) as typeof run,
      resolvedEvents: [...get().resolvedEvents],
      seenArenaHints: [...get().seenArenaHints],
      gold: get().gold,
      inventory: JSON.parse(JSON.stringify(get().inventory)),
      pendingDrops: JSON.parse(JSON.stringify(get().pendingDrops)),
      equipped: JSON.parse(JSON.stringify(get().equipped)),
      tradeCount: get().tradeCount,
      shopStock: JSON.parse(JSON.stringify(get().shopStock)),
      consumables: JSON.parse(JSON.stringify(get().consumables)),
      forgedThisLayer: [...get().forgedThisLayer],
      recruitPool: JSON.parse(JSON.stringify(get().recruitPool)),
      fusedThisLayer: get().fusedThisLayer,
      reforgedThisLayer: get().reforgedThisLayer,
      refreshCount: get().refreshCount,
      lastTransferLogs: JSON.parse(JSON.stringify(get().lastTransferLogs)),
      lastBreakthrough: get().lastBreakthrough,
      lastMount: get().lastMount,
      lastKillGains: get().lastKillGains,
      lastReforge: get().lastReforge,
      formation: get().formation,
    };
    writeSave(slot, meta, snap);
    return true;
  },

  // 从槽位恢复整局（本地模式）：把快照灌回 store，进入休整屏继续挑战。
  loadSlot: (slot) => {
    if (isRemoteMode()) return false; // 云端进度走账号，不用本地槽
    const saved = readSave(slot);
    if (!saved) return false;
    const { snap } = saved;
    set({
      run: JSON.parse(JSON.stringify(snap.run)),
      resolvedEvents: [...snap.resolvedEvents],
      seenArenaHints: [...snap.seenArenaHints],
      gold: snap.gold,
      inventory: JSON.parse(JSON.stringify(snap.inventory)),
      pendingDrops: JSON.parse(JSON.stringify(snap.pendingDrops)),
      equipped: JSON.parse(JSON.stringify(snap.equipped)),
      tradeCount: snap.tradeCount,
      shopStock: JSON.parse(JSON.stringify(snap.shopStock)),
      consumables: JSON.parse(JSON.stringify(snap.consumables)),
      forgedThisLayer: [...snap.forgedThisLayer],
      recruitPool: JSON.parse(JSON.stringify(snap.recruitPool)),
      fusedThisLayer: snap.fusedThisLayer,
      reforgedThisLayer: snap.reforgedThisLayer,
      refreshCount: snap.refreshCount,
      lastTransferLogs: JSON.parse(JSON.stringify(snap.lastTransferLogs)),
      lastBreakthrough: snap.lastBreakthrough,
      lastMount: snap.lastMount,
      lastKillGains: snap.lastKillGains,
      lastReforge: snap.lastReforge,
      formation: snap.formation,
      battleRemote: null,
      prefetchBattle: null,
      battleCtx: { mode: 'normal' },
      climbSession: null,
      screen: 'inter', // 回到休整屏（战斗间隙存档，从这里继续最安全）
    });
    return true;
  },

  // 新游戏绑定槽位：设 activeSlot + 进选人页；startRun 成功后自动写入初始快照
  bindSlot: (slot) => {
    get().setActiveSlot(slot);
    get().setScreen('team');
  },
});
