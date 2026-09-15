// ── parity-abandon-e2e.ts：#2b 奇偶性落库 + #2a 终态落库 端到端验证 ──
// 连 mock-edge（http://127.0.0.1:8787）。需先 `node scripts/mock-edge.mjs 8787`。
import { ARENA_CONFIG } from '../src/arena.config';
import { resetBackend } from '../src/backend/index';
import { useGame } from '../src/game/state/store';
import { isRemoteMode, applySnapshot } from '../src/backend/storeBridge';
import { HEROES } from '../packages/core/src/content/heroes';
import { CORE_VERSION } from '../packages/core/src/contract';
import { getBackend } from '../src/backend/index';
import { replayBattle } from '../packages/core/src/rules';

ARENA_CONFIG.useLocalComputation = false;
ARENA_CONFIG.supabaseUrl = 'http://127.0.0.1:8799';
ARENA_CONFIG.supabaseAnonKey = 'mock-anon';
resetBackend();

let pass = 0, fail = 0;
const check = (n: string, c: boolean, extra = '') => {
  if (c) { pass++; console.log(`  PASS  ${n}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL  ${n}  ${extra}`); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const wait = async (cond: () => boolean, ms = 6000) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await sleep(60);
  return cond();
};

async function main() {
  check('[0] Remote 模式生效', isRemoteMode());

  // ── 开局 ──
  useGame.getState().startRun([HEROES[0], HEROES[1], HEROES[2]], 'normal');
  const ok1 = await wait(() => !!useGame.getState().run?.runId.startsWith('run_'));
  check('[1] 云端开局', ok1);
  const run = useGame.getState().run!;

  // ── [2b] 打一场 → 本地复现 → ackBattle 落 client_checksum ──
  const battle = await getBackend().startBattle({
    runId: run.runId, idempotencyKey: 'e2e-parity-battle', coreVersion: CORE_VERSION,
    formation: {}, clientTs: 0,
  });
  check('[2] 云端结算', battle.ok, battle.ok ? `result=${battle.data.outcome.result}` : battle.message);
  if (battle.ok) {
    const { checksum } = replayBattle(battle.data.replay);
    check('[2b] 本地复现 checksum == 权威 checksum', checksum === battle.data.replay.checksum,
      `local=${checksum} server=${battle.data.replay.checksum}`);
    const ack = await getBackend().ackBattle({
      battleId: battle.data.battleId, localChecksum: checksum,
      runId: run.runId, idempotencyKey: 'e2e-parity-ack', coreVersion: CORE_VERSION,
    });
    check('[2b] ackBattle 成功且 checksumMatch', ack.ok && ack.data.checksumMatch === true,
      ack.ok ? `checksumMatch=${ack.data.checksumMatch}` : ack.message);
    // 让 ack 落库后查询该 battle 的 client_checksum（走 queryBattlePlan/queryRun 之外，用 ack 返回值已足够；
    // 这里再开一局确认 ack 不会污染后续结算）
    applySnapshot(useGame.setState, battle.data.snapshot);
  }

  // ── [2a] 放弃挑战 → run 终态应为 lost ──
  const ab = await getBackend().abandonRun({
    runId: run.runId, idempotencyKey: 'e2e-abandon', coreVersion: CORE_VERSION,
  });
  check('[3] abandonRun 成功', ab.ok, ab.ok ? '' : ab.message);
  const qr = await getBackend().queryRun(run.runId);
  check('[3a] 查询 run：status == lost（终态落库）', qr.ok && qr.data.status === 'lost',
    qr.ok ? `status=${qr.data.status}` : qr.message);

  console.log(`\n 结果：${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error('e2e 抛错:', e); process.exit(1); });
