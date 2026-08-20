#!/usr/bin/env node
// ── mock-edge.mjs：本地模拟 Supabase Edge Function ──────────
//
// 用途：
//   1. 本地全链路测试（RemoteBackend → mock server），验证 HTTP 通路与 LocalBackend 逐 bit 一致
//   2. 作为云端 Edge Function（supabase/functions/game/index.ts）的可运行参考实现——
//      除了「存储」用内存 Map 而非 Postgres，路由/幂等/乐观锁/种子保护逻辑完全一致。
//
// 启动：node scripts/mock-edge.mjs [port]   （默认 8787）
// 协议：POST /functions/v1/game  { action, payload }
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import * as core from '../packages/core/dist/index.js';

const PORT = Number(process.argv[2] ?? process.env.MOCK_EDGE_PORT ?? 8787);
const { CORE_VERSION, ok, err } = core;

// ── 内存存储（模拟 Postgres 的 runs/battles/idempotency_keys）──
const runs = new Map();      // runId -> { snapshot, secret, version }
const battles = new Map();   // battleId -> { runId, checksum, clientChecksum }
const idem = new Map();      // key -> response
const META = {
  bestLayer: 0,
  endlessUnlocked: true,     // mock 默认已解锁无尽，方便测 normal/endless
  teamPresets: [],
  prefs: { battleSpeed: 1, colorblind: false },
};

function withIdempotency(key, fn) {
  if (!key) return fn();
  if (idem.has(key)) return idem.get(key);
  const res = fn();
  idem.set(key, res);
  return res;
}

function stripSecrets(run) {
  const { secret, ...rest } = run;
  return rest;
}

function loadRun(runId) {
  const row = runs.get(runId);
  return row ? { ...row, snapshot: structuredClone(row.snapshot) } : null;
}
function saveRun(runId, snapshot, expectVersion) {
  const row = runs.get(runId);
  if (!row || row.version !== expectVersion) return false;
  row.snapshot = snapshot;
  row.version += 1;
  return true;
}

// ── 命令实现（与 supabase/functions/game 同构）────────────────

function mutate(p, fn) {
  const row = loadRun(p.runId);
  if (!row) return err('RUN_NOT_FOUND', '对局不存在');
  if (row.snapshot.status !== 'active') return err('RUN_ENDED', '对局已结束');
  const r = fn(row.snapshot, row.secret);
  if (!r.ok) return r;
  if (!saveRun(p.runId, r.data, row.version)) return err('STATE_STALE', '状态已过期');
  return r;
}

function handleStartRun(p) {
  const seed = (p.debugSeed !== undefined) ? (p.debugSeed >>> 0) : (Math.floor(Math.random() * 1e9) & 0xffffffff);
  const runId = `run_${randomUUID().slice(0, 8)}`;
  const r = core.createRun({
    runId, seed,
    heroIds: p.heroIds, mode: p.mode, endlessUnlocked: META.endlessUnlocked,
  });
  if (!r.ok) return r;
  runs.set(runId, { snapshot: r.data, secret: { seed }, version: 1 });
  return r;
}

function handleStartBattle(p) {
  const row = loadRun(p.runId);
  if (!row) return err('RUN_NOT_FOUND', '对局不存在');
  if (row.snapshot.status !== 'active') return err('RUN_ENDED', '对局已结束');

  // ★★★ 与 LocalBackend 同一个函数、同一份 dist 字节码 ★★★
  const battle = core.runBattle(row.snapshot, row.secret, p.formation ?? {}, p.battleOpts);
  if (!battle.ok) return battle;
  const next = core.applySettlement(row.snapshot, row.secret, battle.data, p.battleOpts);
  if (!saveRun(p.runId, next, row.version)) return err('STATE_STALE', '状态已过期');

  const battleId = `b_${randomUUID().slice(0, 8)}`;
  battles.set(battleId, { runId: p.runId, checksum: battle.data.checksum, clientChecksum: null });
  return ok({
    battleId,
    replay: {
      battleSeed: battle.data.battleSeed,
      layer: p.battleOpts?.effLayer ?? row.snapshot.layer, // v1.8 下五层用生效层
      mode: row.snapshot.mode,
      arena: battle.data.arena,
      allies: battle.data.allies,
      enemies: battle.data.enemies,
      buildings: battle.data.buildings,
      buildingScale: battle.data.buildingScale,
      checksum: battle.data.checksum,
    },
    outcome: {
      result: battle.data.result,
      totalTicks: battle.data.totalTicks,
      durationSec: battle.data.durationSec,
      stats: battle.data.stats,
      mvpUid: battle.data.mvpUid ?? null,
      mvpStat: battle.data.mvpStat ?? null,
      mvpAdd: battle.data.mvpAdd ?? 0,
      killGains: battle.data.killGains,
      deadAllyUids: battle.data.deadAllyUids,
    },
    snapshot: next,
  });
}

function handleAutoClimb(p) {
  const row = loadRun(p.runId);
  if (!row) return err('RUN_NOT_FOUND', '对局不存在');
  const r = core.autoClimb(row.snapshot, row.secret, p.formation ?? {}, p.opts);
  if (!r.ok) return r;
  const next = core.applyAutoClimb(row.snapshot, row.secret, r.data);
  if (!saveRun(p.runId, next, row.version)) return err('STATE_STALE', '状态已过期');
  return ok({ result: r.data, snapshot: next });
}

function handleAckBattle(p) {
  const b = battles.get(p.battleId);
  if (!b) return err('RUN_NOT_FOUND', '战斗记录不存在');
  const match = b.checksum === p.localChecksum;
  b.clientChecksum = p.localChecksum;
  const row = runs.get(b.runId);
  return ok({ checksumMatch: match, snapshot: row ? row.snapshot : null });
}

function handleParity(p) {
  // 与 scripts/parity-harness.ts 相同的构造路径：createRun → advance → battle
  const runId = `parity_${p.seed}_${p.layer}`;
  const started = core.createRun({
    runId, seed: p.seed >>> 0,
    heroIds: ['h_physTank', 'h_charge', 'h_healer'],
    mode: p.mode ?? 'normal', endlessUnlocked: true,
  });
  if (!started.ok) return started;
  let snap = started.data;
  for (let i = 1; i < p.layer; i++) {
    const adv = core.advanceLayer(snap);
    if (!adv.ok) break;
    snap = adv.data;
  }
  const battle = core.runBattle(snap, { seed: p.seed >>> 0 }, {});
  if (!battle.ok) return battle;
  return ok({ checksum: battle.data.checksum, totalTicks: battle.data.totalTicks, outcome: battle.data.result });
}

// ── 路由 ──────────────────────────────────────────────────
const handlers = {
  queryMeta:        () => ok(META),
  queryRun:         (p) => { const row = loadRun(p.runId); return row ? ok(row.snapshot) : err('RUN_NOT_FOUND'); },
  queryBattlePlan:  (p) => { const row = loadRun(p.runId); return row ? core.planBattle(row.snapshot, row.secret) : err('RUN_NOT_FOUND'); },

  startRun:         (p) => handleStartRun(p),
  abandonRun:       (p) => {
    const row = loadRun(p.runId);
    if (!row) return err('RUN_NOT_FOUND');
    // 与真实 Edge handleAbandon 一致：显式落库（saveRun 带乐观锁版本）
    saveRun(p.runId, { ...row.snapshot, status: 'lost' }, row.version);
    return ok(META);
  },
  advanceLayer:     (p) => mutate(p, (s) => core.advanceLayer(s)),
  advanceLayerTo:   (p) => mutate(p, (s) => core.advanceLayerTo(s, p.layer)),
  autoClimb:        (p) => handleAutoClimb(p),

  startBattle:      (p) => handleStartBattle(p),
  ackBattle:        (p) => handleAckBattle(p),

  buyItem:          (p) => mutate(p, (s) => core.buyItem(s, p.itemId)),
  sellItem:         (p) => mutate(p, (s) => core.sellItem(s, p.equipmentId)),
  refreshShop:      (p) => mutate(p, (s, sec) => core.refreshShop(s, sec)),
  recruit:          (p) => mutate(p, (s, sec) => core.recruit(s, sec, p.heroId)),
  refreshRecruit:   (p) => mutate(p, (s, sec) => core.refreshRecruit(s, sec)),
  upgradeHero:      (p) => mutate(p, (s) => core.upgradeHero(s, p.uid)),
  openDrop:         (p) => mutate(p, (s) => core.openDrop(s, p.chestId)),
  openDrops:        (p) => mutate(p, (s) => core.openDrops(s, p.chestIds)),
  reforgeItem:      (p) => mutate(p, (s) => core.reforgeItem(s, p.equipmentId)),
  resolveRandomEvent:(p) => mutate(p, (s) => core.resolveRandomEvent(s, p.layer, p.optionIndex)),
  equipItem:        (p) => mutate(p, (s) => core.equipItem(s, p.uid, p.equipmentId)),
  equipAll:         (p) => mutate(p, (s) => core.equipAll(s, p.uid)),
  unequipItem:      (p) => mutate(p, (s) => core.unequipItem(s, p.uid, p.equipmentId)),

  __parityBattle:   (p) => handleParity(p),
};

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (req.method !== 'POST') { res.writeHead(405).end(); return; }

  let body = '';
  for await (const chunk of req) body += chunk;
  let parsed;
  try { parsed = JSON.parse(body); } catch { res.writeHead(400).end('bad json'); return; }

  const { action, payload = {} } = parsed;
  // ── 网络不稳定模拟（v3.4h）：__net.delayMs（支持 "min-max" 抖动）/ __net.failRate ──
  // 在幂等之前拦截（失败=请求未到达服务器），环境变量 MOCK_NET_DELAY / MOCK_NET_FAIL 兜底。
  const net = {
    delayMs: payload.__net?.delayMs ?? process.env.MOCK_NET_DELAY,
    failRate: payload.__net?.failRate ?? (process.env.MOCK_NET_FAIL ? Number(process.env.MOCK_NET_FAIL) : undefined),
  };
  delete payload.__net;
  if (net.delayMs) {
    const [min, max] = String(net.delayMs).split('-').map(Number);
    const d = max ? min + Math.random() * (max - min) : min;
    await new Promise((r) => setTimeout(r, d));
  }
  if (net.failRate && Math.random() < net.failRate) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(err('NETWORK_FAIL', '模拟网络不稳定')));
    return;
  }
  const handler = handlers[action];
  const result = handler
    ? withIdempotency(payload.idempotencyKey, () => handler(payload))
    : err('RUN_NOT_FOUND', `未知 action: ${action}`);

  // 版本闸门（与云端一致）：客户端版本对不上拒算
  const clientVer = req.headers['x-core-version'] ?? payload.coreVersion;
  if (clientVer && clientVer !== CORE_VERSION && action !== '__parityBattle') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(err('VERSION_MISMATCH', `服务端引擎 ${CORE_VERSION}，请刷新`)));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ...result, coreVersion: CORE_VERSION }));
});

server.listen(PORT, () => {
  console.log(`[mock-edge] 监听 :${PORT}  引擎 ${CORE_VERSION}`);
  console.log(`[mock-edge] POST /functions/v1/game  { action, payload }`);
});
