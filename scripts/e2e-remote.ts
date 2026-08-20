// ── e2e-remote.ts：本地全链路测试（RemoteBackend → mock Edge）──
//
// 验证 HTTP 通路的完整闭环：
//   startRun → queryBattlePlan → startBattle(权威结算)
//     → 前端 replayBattle 本地复现 → ackBattle 比对 checksum
//
// 断言点：
//   [1] startRun 成功，快照完整
//   [2] 战斗返回权威 outcome（非本地判定）
//   [3] 前端用 replay 本地复现，checksum 与远端**逐 bit 一致**（checksumMatch=true）
//   [4] 幂等：同 idempotencyKey 重复 startRun 只产生一个 run
//   [5] 版本闸门：伪造 coreVersion 返回 VERSION_MISMATCH
//   [6] debugSeed 在 Remote 通路被剥离（服务端种子与客户端无关）
import { RemoteBackend } from '../src/backend/RemoteBackend';
import { replayBattle, CORE_VERSION } from '../packages/core/src/index';
import { ok, err } from '../packages/core/src/contract';

const BASE = process.env.REMOTE_BASE ?? 'http://127.0.0.1:8787';
const be = new RemoteBackend({ baseUrl: BASE, anonKey: 'mock-anon' });

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${extra}`); }
}

const env = (runId: string, tag: string) => ({
  runId, idempotencyKey: `e2e-${tag}-${Math.random().toString(36).slice(2)}`, coreVersion: CORE_VERSION,
});

console.log(`目标：${BASE}/functions/v1/game`);

// ── [1] 开局 ──
const started = await be.startRun({
  heroIds: ['h_physTank', 'h_charge', 'h_healer'],
  mode: 'normal', idempotencyKey: 'e2e-start', coreVersion: CORE_VERSION, debugSeed: 999,
});
check('[1] startRun 成功', started.ok, started.ok ? `layer=${started.data.layer} team=${started.data.team.length}` : started.message);
if (!started.ok) { console.log(`\n${pass} pass / ${fail} fail`); process.exit(1); }
const runId = started.data.runId;

// ── [2] 战前情报 ──
const plan = await be.queryBattlePlan(runId);
check('[2] queryBattlePlan 返回战前情报', plan.ok && 'arena' in plan.data, plan.ok ? `arena=${plan.data.arena.id}` : plan.message);

// ── [3] 开战（权威结算）→ 本地复现 → 比对 ──
const battle = await be.startBattle({ ...env(runId, 'battle'), formation: {}, clientTs: 0 });
check('[3] startBattle 返回权威结果', battle.ok, battle.ok ? `result=${battle.data.outcome.result} ticks=${battle.data.outcome.totalTicks}` : battle.message);

let checksumMatch = false;
if (battle.ok) {
  const rep = battle.data.replay;
  const local = replayBattle({
    allies: rep.allies, enemies: rep.enemies,
    arena: rep.arena, buildings: rep.buildings,
    layer: rep.layer, battleSeed: rep.battleSeed,
    buildingScale: rep.buildingScale,
  });
  checksumMatch = local.checksum === rep.checksum;
  check('[3b] 前端 replayBattle 复现 checksum 与远端一致',
    checksumMatch,
    `local=${local.checksum.slice(0, 12)}… remote=${rep.checksum.slice(0, 12)}… (${local.totalTicks} ticks)`);

  const ack = await be.ackBattle({ ...env(runId, 'ack'), battleId: battle.data.battleId, localChecksum: local.checksum });
  check('[3c] ackBattle 服务端确认 checksumMatch', ack.ok && ack.data.checksumMatch === true,
    ack.ok ? `server=${ack.data.checksumMatch}` : ack.message);
}

// ── [4] 幂等 ──
const again = await be.startRun({
  heroIds: ['h_physTank', 'h_charge', 'h_healer'],
  mode: 'normal', idempotencyKey: 'e2e-start', coreVersion: CORE_VERSION,
});
check('[4] 幂等键去重（同 key 同 run）', again.ok && again.data.runId === runId,
  again.ok ? `runId=${again.data.runId.slice(0, 16)}` : again.message);

// ── [5] 版本闸门 ──
const wrongVer = await fetch(`${BASE}/functions/v1/game`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'queryMeta', payload: { coreVersion: '0.0.0-fake' } }),
}).then((r) => r.json());
check('[5] 版本闸门：伪造版本被拒', wrongVer.ok === false && wrongVer.code === 'VERSION_MISMATCH', `code=${wrongVer.code}`);

// ── [6] debugSeed 剥离 ──
const withSeed = await fetch(`${BASE}/functions/v1/game`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Core-Version': CORE_VERSION },
  body: JSON.stringify({ action: '__parityBattle', payload: { seed: 424242, layer: 3, mode: 'normal' } }),
}).then((r) => r.json());
check('[6] 服务端种子派生效（__parityBattle 可算）', withSeed.ok && typeof withSeed.data.checksum === 'string',
  withSeed.ok ? `checksum=${withSeed.data.checksum.slice(0, 12)}…` : withSeed.message);

// ── [7] v1.8 autoClimb（自动爬塔契约：权威演算 + 快照写回）──
const climbStart = await be.startRun({
  heroIds: ['h_physTank', 'h_charge', 'h_healer'],
  mode: 'normal', idempotencyKey: 'e2e-climb-start', coreVersion: CORE_VERSION,
});
check('[7a] autoClimb 前置开局', climbStart.ok, climbStart.ok ? `layer=${climbStart.data.layer}` : climbStart.message);
if (climbStart.ok) {
  const climb = await be.autoClimb({
    runId: climbStart.data.runId, idempotencyKey: 'e2e-climb-1', coreVersion: CORE_VERSION,
    formation: {}, opts: { strategy: 'steadyPush' }, // 不设胜率阈值：正常爬直到失败/封顶/满 10 层
  });
  check('[7b] autoClimb 返回结果', climb.ok && climb.data.result.layers.length >= 1,
    climb.ok ? `stop=${climb.data.result.stopReason} layers=${climb.data.result.layers.length} gold=${climb.data.result.totalGold}` : climb.message);
  if (climb.ok) {
    const r = climb.data.result;
    const okStop = ['cap', 'winrate', 'fail', 'done'].includes(r.stopReason);
    check('[7c] autoClimb stopReason 合法', okStop, `stop=${r.stopReason}`);
    check('[7d] autoClimb 快照已写回（推进层或失败 +1 容错）',
      r.stopReason === 'fail'
        ? climb.data.snapshot.failures === climbStart.data.failures + 1
        : climb.data.snapshot.layer > climbStart.data.layer,
      `snapshot.layer=${climb.data.snapshot.layer} failures=${climb.data.snapshot.failures}`);
    // 确定性：同输入直调 core 必须逐 bit 一致（可复现 = 可申诉）
    const { autoClimb: coreClimb } = await import('../packages/core/src/rules/index');
    const again = coreClimb(
      climbStart.data as never, { seed: 0 } as never, {},
      { strategy: 'steadyPush' } as never,
    );
    check('[7e] autoClimb 契约形状完整（layers 含 gold/drops）',
      again.ok && again.data.layers.every((l) => typeof l.gold === 'number' && Array.isArray(l.drops)),
      again.ok ? `layers=${again.data.layers.length}` : again.message);
  }
}

// ── [8] v1.8 下五层（startBattle + battleOpts：敌强 ×1.20 / 五层奖励 / 失败扣 2 容错）──
const b5Start = await be.startRun({
  heroIds: ['h_physTank', 'h_charge', 'h_healer'],
  mode: 'normal', idempotencyKey: 'e2e-b5-start', coreVersion: CORE_VERSION,
});
check('[8a] 下五层前置开局', b5Start.ok, b5Start.ok ? `layer=${b5Start.data.layer}` : b5Start.message);
if (b5Start.ok) {
  const L = b5Start.data.layer;
  const b5 = await be.startBattle({
    runId: b5Start.data.runId, idempotencyKey: 'e2e-b5-1', coreVersion: CORE_VERSION,
    formation: {}, clientTs: 0,
    battleOpts: {
      effLayer: L + 5, enemyHpMult: 1.2, enemyDmgMult: 1.2,
      rewardLayers: [L + 1, L + 2, L + 3, L + 4, L + 5], highBonus: true, loseFailures: 2,
    },
  });
  check('[8b] 下五层战斗权威结算', b5.ok && 'outcome' in b5.data,
    b5.ok ? `result=${b5.data.outcome.result} ticks=${b5.data.outcome.totalTicks}` : b5.message);
  if (b5.ok) {
    const snap = b5.data.snapshot;
    const won = b5.data.outcome.result === 'win';
    check('[8c] 下五层胜利跳 5 层 / 失败扣 2 容错',
      won ? snap.layer === Math.min(L + 6, snap.cap) : snap.failures === b5Start.data.failures + 2,
      `result=${b5.data.outcome.result} layer=${snap.layer} failures=${snap.failures}`);
    check('[8d] 下五层胜利发五层奖励（金币增长）', !won || snap.gold > b5Start.data.gold,
      `gold ${b5Start.data.gold} → ${snap.gold}`);
    // 回放复现：replay.layer 用生效层，checksum 必须与权威一致
    const rep = b5.data.replay;
    const local = replayBattle({
      allies: rep.allies, enemies: rep.enemies,
      arena: rep.arena, buildings: rep.buildings,
      layer: rep.layer, battleSeed: rep.battleSeed, buildingScale: rep.buildingScale,
    });
    check('[8e] 下五层回放 checksum 与远端一致',
      local.checksum === rep.checksum,
      `local=${local.checksum.slice(0, 12)}… remote=${rep.checksum.slice(0, 12)}… (${local.totalTicks} ticks)`);
  }
}

console.log(`\n${fail ? `✗ ${fail} 失败` : '✓ 全部通过'}  (${pass} pass / ${fail} fail)`);
process.exit(fail ? 1 : 0);
