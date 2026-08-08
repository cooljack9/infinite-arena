// ── 跨运行时确定性验证 ──
// Supabase Edge Function 跑在 Deno（V8）上，玩家浏览器也是 V8/JSC/SpiderMonkey，
// 本地测试跑在 Node（V8）。三者若对同一 seed 算出不同 checksum，整个"后端算+前端放"
// 的架构会在**上线当天**才暴雷。
//
// 风险点是真实存在的：引擎核心演算路径大量使用 Math.hypot / cos / sin / atan2
// （移动、索敌、锥形 AoE 判定），而 ECMA-262 对这些**超越函数只要求近似**，
// 明确允许各实现有 ULP 级差异——不像 +-*/ 那样被 IEEE 754 严格规定。
//
// 用法：本脚本输出一行 JSON 指纹，用 node 和 deno 各跑一次，比对即可。
//   node  node_modules/.cache/xrt.mjs
//   deno  run --allow-read node_modules/.cache/xrt.mjs
import { LocalBackend, MemoryStore } from '../src/backend/LocalBackend';
import { CORE_VERSION } from '../packages/core/src/contract';
import { replayBattle } from '../packages/core/src/rules';
import { dsin, dcos, dpow } from '../packages/core/src/engine/detmath';
import { mulberry32 } from '../packages/core/src/engine/rng';

async function main() {
  const be = new LocalBackend(new MemoryStore());
  const sums: string[] = [];
  const ticks: number[] = [];

  // 固定 3 组种子 × 逐层推进，覆盖不同竞技场/敌配/建筑
  for (const seed of [20260808, 777001, 424242]) {
    const s = await be.startRun({
      heroIds: ['h_physTank', 'h_gunner', 'h_healer'],
      mode: 'normal', idempotencyKey: `x_${seed}`,
      coreVersion: CORE_VERSION, debugSeed: seed,
    });
    if (!s.ok) throw new Error('startRun failed');
    for (let L = 0; L < 8; L++) {
      const cur = await be.queryRun(s.data.runId);
      if (!cur.ok || cur.data.status !== 'active') break;
      const b = await be.startBattle({
        runId: s.data.runId, idempotencyKey: `x_${seed}_${L}`,
        coreVersion: CORE_VERSION, formation: {}, clientTs: 0,
      });
      if (!b.ok) break;
      // 同时记录服务端 checksum 与本地复现 checksum
      const r = replayBattle(b.data.replay);
      sums.push(b.data.replay.checksum, r.checksum);
      ticks.push(b.data.outcome.totalTicks);
    }
  }

  // 裸浮点探针。分成两组，构成一组对照实验：
  //   native  —— 直接调 Math.*，预期在不同引擎上出现差异（这是问题本身）
  //   det     —— detmath 的替代实现，预期处处相同（这是修复的证据）
  // 只报告 native 漂而不报告 det 不漂，等于没证明修复有效。
  const nativeProbe = {
    hypot: Math.hypot(3.7, 8.3).toString(),
    hypot2: Math.hypot(1e-8, 1.0000000001).toString(),
    atan2: Math.atan2(0.30000000000000004, 7.7).toString(),
    cos: Math.cos(0.6154797086703873).toString(),
    sin: Math.sin(2.4980915447965089).toString(),
    pow: Math.pow(1.0000001, 10000).toString(),
    sqrt: Math.sqrt(2).toString(),          // IEEE 754 严格规定，应必然一致
  };
  // 对 detmath 做批量采样后压成一个指纹——单点相同可能是巧合，2 万点相同不是
  const rng = mulberry32(20260808);
  let acc = '';
  for (let i = 0; i < 20000; i++) {
    const x = rng() * 80 - 40;
    acc += dsin(x).toString() + dcos(x).toString() + dpow(rng() * 50 + 1e-3, rng() * 6 - 3).toString();
  }
  const detProbe = {
    samples: 20000,
    digest: acc.split('').reduce((h, c) => { h = ((h << 5) - h + c.charCodeAt(0)) | 0; return h; }, 0).toString(16),
    dsin: dsin(2.4980915447965089).toString(),
    dcos: dcos(0.6154797086703873).toString(),
    dpow: dpow(1.0000001, 10000).toString(),
  };

  console.log(JSON.stringify({
    battles: ticks.length,
    ticks,
    sums,   // 逐场 checksum，便于定位是哪一场漂
    // 把所有 checksum 再压成一个指纹，方便一眼比对
    fingerprint: sums.join(',').split('').reduce((h, c) => {
      h = ((h << 5) - h + c.charCodeAt(0)) | 0; return h;
    }, 0).toString(16),
    nativeProbe,
    detProbe,
  }));
}
main().catch((e) => { console.error(e); throw e; });
