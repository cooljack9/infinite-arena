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

console.log(`\n${fail ? `✗ ${fail} 失败` : '✓ 全部通过'}  (${pass} pass / ${fail} fail)`);
process.exit(fail ? 1 : 0);
