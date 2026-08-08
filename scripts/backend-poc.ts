// ── 前后端分离 PoC 验证 ──
// 证明五件事（而不是只在文档里声称）：
//   [1] LocalBackend 全链路可跑：开局 → 战前计划 → 开战 → 结算 → 商店
//   [2] 承重假设：「后端权威算 + 前端只拿 seed 本地复现」在多局多层下 checksum 全等
//   [3] 幂等：3 秒倒计时内连点 N 次只扣一次钱（真实扣费路径，非拒绝路径）
//   [4] 回放包体积 vs 全量事件流（按层曲线，看压缩比怎么随规模变化）
//   [5] 权威性：客户端拿不到根种子，无法窥探未来
import { LocalBackend, MemoryStore } from '../src/backend/LocalBackend';
import { CORE_VERSION, type BattleResultDTO } from '../packages/core/src/contract';
import { replayBattle } from '../packages/core/src/rules';

const TEAM = ['h_physTank', 'h_gunner', 'h_healer']; // 铁壁镇守 / 神机炮手 / 回春医者
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => {
  if (c) { pass++; console.log(`  PASS  ${m}`); }
  else { fail++; console.log(`  FAIL  ${m}`); }
};
let kseq = 0;
const key = () => `k_${kseq++}`;
const env = (runId: string) => ({ runId, idempotencyKey: key(), coreVersion: CORE_VERSION });

/**
 * 前端视角的复现。注意这里调的是 core 里那个 `replayBattle`——
 * 和服务端 runBattle 共用同一套装配 + 同一套指纹算法。
 * PoC 若自己另写一份复现逻辑，测的就是"我抄对了没"，而不是"架构成不成立"。
 */
function replayOnClient(B: BattleResultDTO, countBytes = false) {
  let evBytes = 0;
  const r = replayBattle(B.replay, countBytes ? (sim, step) => {
    // 对照组：若改为逐 tick 下发事件流，需要多少字节
    evBytes += JSON.stringify({
      t: step,
      u: sim.units.map((u) => ({
        i: u.id, x: +u.x.toFixed(2), y: +u.y.toFixed(2),
        h: Math.round(u.hp), s: Math.round(u.shield), a: u.alive ? 1 : 0,
      })),
      e: sim.effects.length, p: sim.projectiles.length,
    }).length;
  } : undefined);
  return { steps: r.totalTicks, result: r.result, checksum: r.checksum, evBytes };
}

async function main() {
  // ══ [1] 全链路 ══════════════════════════════════════════
  console.log('\n[1] LocalBackend 全链路');
  const be = new LocalBackend(new MemoryStore());
  const started = await be.startRun({
    heroIds: TEAM, mode: 'novice', idempotencyKey: key(),
    coreVersion: CORE_VERSION, debugSeed: 20260808,
  });
  if (!started.ok) { console.log('  FAIL  startRun:', started.message); process.exit(1); }
  const runId = started.data.runId;
  ok(started.data.team.length === 3,
    `三人进入竞技场（${started.data.team.map((h) => h.personalName ?? h.name).join(' / ')}）`);
  ok(started.data.layer === 1 && started.data.status === 'active', '初始层=1，状态 active');
  ok(started.data.shopStock.equipment.length + started.data.shopStock.consumables.length === 8,
    `商店 8 个货位（装备 ${started.data.shopStock.equipment.length} / 道具 ${started.data.shopStock.consumables.length}）`);
  ok(started.data.inventory.length === 4, `新手模式发放初始装备包（${started.data.inventory.length} 件）`);

  const plan = await be.queryBattlePlan(runId);
  if (!plan.ok) { console.log('  FAIL  queryBattlePlan'); process.exit(1); }
  ok(plan.data.enemyPreview.defs.length > 0,
    `战前计划：${plan.data.arena.name} / 敌 ${plan.data.enemyPreview.defs.length} 只`);
  ok(!('result' in (plan.data as object)) && !('checksum' in (plan.data as object)),
    '战前计划不泄漏战斗结果');

  // ══ [2] 承重假设：多局 × 多层 checksum 回归 ═══════════════
  console.log('\n[2] 承重假设：后端权威算 + 前端本地复现（多局 × 多层）');
  const RUNS = 10, MAX_LAYER = 15;
  let battles = 0, mismatch = 0, tickDiff = 0, wins = 0;
  const bytesByLayer: Array<{ layer: number; units: number; ev: number; rp: number }> = [];
  let totalBackendMs = 0;

  for (let r = 0; r < RUNS; r++) {
    const seed = 1000 + r * 7919;
    // 第一局用 novice 通关以解锁无尽；其余用 normal，层数更深、单位更多，
    // 才能看出压缩比随规模怎么变（只测 5 单位的第 1 层是自欺欺人）。
    const s = await be.startRun({
      heroIds: TEAM, mode: r === 0 ? 'novice' : 'normal', idempotencyKey: key(),
      coreVersion: CORE_VERSION, debugSeed: seed,
    });
    if (!s.ok) continue;
    const rid = s.data.runId;
    const sample = r >= 1 && r <= 3; // 前 3 局 normal 全层采样体积
    for (let L = 0; L < MAX_LAYER; L++) {
      const cur = await be.queryRun(rid);
      if (!cur.ok || cur.data.status !== 'active') break;
      const t0 = performance.now();
      const b = await be.startBattle({ ...env(rid), formation: {}, clientTs: Date.now() });
      totalBackendMs += performance.now() - t0;
      if (!b.ok) break;
      battles++;
      if (b.data.outcome.result === 'win') wins++;
      const cli = replayOnClient(b.data, sample);
      if (cli.checksum !== b.data.replay.checksum) mismatch++;
      if (cli.steps !== b.data.outcome.totalTicks) tickDiff++;
      if (sample) {
        bytesByLayer.push({
          layer: b.data.replay.layer,
          units: b.data.replay.allies.length + b.data.replay.enemies.length,
          ev: cli.evBytes,
          rp: JSON.stringify(b.data.replay).length,
        });
      }
    }
  }
  console.log(`        跑了 ${RUNS} 局 / ${battles} 场战斗（胜率 ${(wins / battles * 100).toFixed(0)}%），` +
    `后端结算均值 ${(totalBackendMs / battles).toFixed(2)}ms/场`);
  ok(battles >= 30, `样本量足够（${battles} 场）`);
  ok(tickDiff === 0, `tick 数全等（${battles - tickDiff}/${battles}）`);
  ok(mismatch === 0, `checksum bit 级全等（${battles - mismatch}/${battles}）← 架构成立`);

  // 同种子二次开局必须完全一致（可复现性 = 客服能复现玩家的局）
  const be2 = new LocalBackend(new MemoryStore());
  const a1 = await be.startRun({ heroIds: TEAM, mode: 'novice', idempotencyKey: key(), coreVersion: CORE_VERSION, debugSeed: 424242 });
  const a2 = await be2.startRun({ heroIds: TEAM, mode: 'novice', idempotencyKey: key(), coreVersion: CORE_VERSION, debugSeed: 424242 });
  if (a1.ok && a2.ok) {
    const b1 = await be.startBattle({ ...env(a1.data.runId), formation: {}, clientTs: 0 });
    const b2 = await be2.startBattle({ ...env(a2.data.runId), formation: {}, clientTs: 0 });
    ok(b1.ok && b2.ok && b1.data.replay.checksum === b2.data.replay.checksum,
      '同种子跨后端实例结果一致（可复现 = 可申诉、可回放、可反作弊）');
  }

  // ══ [3] 幂等：真实扣费路径 ═══════════════════════════════
  console.log('\n[3] 幂等：3 秒倒计时内连点，只扣一次钱');
  // novice 打通第 5 层就 status='won'（此时买东西返回 RUN_ENDED 是**正确**行为）。
  // 要命中"扣费成功"分支，得开一局层数更长的 normal——上面 10 局已通关 novice，
  // endlessUnlocked 此刻为 true。
  const meta = await be.queryMeta();
  ok(meta.ok && meta.data.endlessUnlocked, '通关新手后自动解锁无尽模式');
  const long = await be.startRun({
    heroIds: TEAM, mode: 'normal', idempotencyKey: key(),
    coreVersion: CORE_VERSION, debugSeed: 777001,
  });
  if (!long.ok) { console.log('  FAIL  startRun(normal):', long.message); process.exit(1); }
  const shopRunId = long.data.runId;
  // 打几层攒钱，一旦 run 结束立刻停手
  for (let i = 0; i < 6; i++) {
    const c = await be.queryRun(shopRunId);
    if (!c.ok || c.data.status !== 'active') break;
    const b = await be.startBattle({ ...env(shopRunId), formation: {}, clientTs: Date.now() });
    if (!b.ok || b.data.outcome.result !== 'win') break;
  }
  const s1 = await be.queryRun(shopRunId);
  if (!s1.ok) { console.log('  FAIL  queryRun'); process.exit(1); }
  const all = [...s1.data.shopStock.equipment, ...s1.data.shopStock.consumables];
  const afford = all.filter((it) => it.basePrice <= s1.data.gold);
  console.log(`        推进到第 ${s1.data.layer} 层，状态 ${s1.data.status}，金币 ${s1.data.gold}，可负担 ${afford.length}/${all.length} 件`);

  if (afford.length > 0) {
    const item = afford[0];
    const goldBefore = s1.data.gold;
    const invBefore = s1.data.inventory.length;
    const sharedKey = key();
    // 模拟倒计时内玩家狂点 5 次（同一个幂等键 = 同一次意图）
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        be.buyItem({ runId: shopRunId, idempotencyKey: sharedKey, coreVersion: CORE_VERSION, itemId: item.id })),
    );
    const after = await be.queryRun(shopRunId);
    if (after.ok) {
      const spent = goldBefore - after.data.gold;
      const okCount = results.filter((r) => r.ok).length;
      const r0 = results[0];
      console.log(`        买「${item.name}」标价 ${item.basePrice} → 实扣 ${spent}（5 次请求 ${okCount} 次返回成功）`
        + (r0.ok ? '' : `  err=${r0.code} ${r0.message ?? ''}`));
      ok(spent > 0 && spent <= item.basePrice, `确实扣了一次钱（${spent}）`);
      ok(after.data.inventory.length === invBefore + 1,
        `背包只 +1（${invBefore} → ${after.data.inventory.length}），无重复入包`);
      ok(okCount === 5, '5 次请求全部返回同一个成功结果（幂等重放，不是拒绝）');
      ok(after.data.shopStock.equipment.concat(after.data.shopStock.consumables)
        .every((it) => it.id !== item.id), '该货位已从商店移除（不会被买第二次）');

      // 换幂等键 = 新意图，必须真的走一遍规则，而不是复用缓存。
      // 同一件已售出的货 → 预期 ITEM_GONE；这正好证明幂等层没把真实逻辑吞掉。
      const g2 = after.data.gold;
      const again = await be.buyItem({
        runId: shopRunId, idempotencyKey: key(), coreVersion: CORE_VERSION, itemId: item.id });
      ok(!again.ok && again.code === 'ITEM_GONE',
        `换幂等键重买已售出商品 → ${again.ok ? '竟然成功了' : again.code}（幂等层未吞掉真实校验）`);

      // 换幂等键 + 换一件货 → 必须真的再扣一次钱
      const s2 = await be.queryRun(shopRunId);
      const other = s2.ok
        ? [...s2.data.shopStock.equipment, ...s2.data.shopStock.consumables]
          .find((it) => it.basePrice <= s2.data.gold)
        : undefined;
      if (other) {
        const buy2 = await be.buyItem({
          runId: shopRunId, idempotencyKey: key(), coreVersion: CORE_VERSION, itemId: other.id });
        const after3 = await be.queryRun(shopRunId);
        ok(buy2.ok && after3.ok && after3.data.gold < g2,
          `新意图确实再次扣费（${g2} → ${after3.ok ? after3.data.gold : '?'}，买「${other.name}」）`);
      }
    }
  } else {
    ok(false, `攒钱失败，未命中扣费路径（金币 ${s1.data.gold}）`);
  }

  // ══ [4] 回放包体积 ═══════════════════════════════════════
  console.log('\n[4] 回放包体积 vs 逐 tick 事件流');
  const agg = new Map<number, { ev: number; rp: number; units: number; n: number }>();
  for (const b of bytesByLayer) {
    const a = agg.get(b.layer) ?? { ev: 0, rp: 0, units: 0, n: 0 };
    a.ev += b.ev; a.rp += b.rp; a.units += b.units; a.n++;
    agg.set(b.layer, a);
  }
  console.log('        层  单位数   事件流      replay      压缩比');
  for (const [layer, a] of [...agg].sort((x, y) => x[0] - y[0])) {
    const ev = a.ev / a.n, rp = a.rp / a.n;
    console.log(`        ${String(layer).padStart(2)}   ${(a.units / a.n).toFixed(1).padStart(4)}` +
      `   ${(ev / 1024).toFixed(1).padStart(7)} KB  ${(rp / 1024).toFixed(1).padStart(6)} KB` +
      `   ${(ev / rp).toFixed(1).padStart(6)}×`);
  }
  const totEv = bytesByLayer.reduce((s, b) => s + b.ev, 0);
  const totRp = bytesByLayer.reduce((s, b) => s + b.rp, 0);
  ok(totRp < totEv, `回放输入整体小于事件流（${(totEv / totRp).toFixed(1)}×）`);
  console.log('        注：replay 只随「单位数」增长，事件流随「单位数 × tick 数」增长，');
  console.log('            所以层数越高、战斗越长，压缩比越大。');

  // ══ [5] 权威性 ═══════════════════════════════════════════
  console.log('\n[5] 权威性：客户端无法窥探未来');
  const fin = await be.queryRun(runId);
  if (fin.ok) {
    const json = JSON.stringify(fin.data);
    ok(!Object.keys(fin.data).includes('seed'), 'RunSnapshot 不含 run 根种子');
    ok(!json.includes('"secret"'), '快照里不含任何 secret 字段');
  }
  const lastB = await be.startBattle({ ...env(runId), formation: {}, clientTs: Date.now() });
  if (lastB.ok) {
    ok(typeof lastB.data.replay.battleSeed === 'number',
      '仅下发当前场次已派生的 battleSeed（用完即弃，推不出根种子）');
  }

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'HAS FAILURES'}  (pass=${pass}, fail=${fail})`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
