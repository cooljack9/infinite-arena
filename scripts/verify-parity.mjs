#!/usr/bin/env node
// ── verify-parity.mjs：同种子，本地 vs Edge，比 checksum ─────
//
// 这套架构的试金石。detmath 存在的意义就是让下面断言恒真；
// guard-determinism.mjs 是静态防线，本脚本是动态防线。
// 部署后必跑（CI deploy-supabase.yml 调用）；无云端配置时退化为本地自洽校验。
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ── 通过 esbuild 把 TS 源打包成 node 可加载的临时 ESM ──
const TMP = join(tmpdir(), `arena-parity-${process.pid}.mjs`);
await build({
  entryPoints: [join(ROOT, 'scripts/parity-harness.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: TMP, logLevel: 'error',
});
const harness = await import(`file://${TMP.replace(/\\/g, '/')}`);

const URL_BASE = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const USE_MOCK = !URL_BASE || !ANON;

const CASES = [
  { seed: 1,        layer: 1,  mode: 'novice'  },
  { seed: 42,       layer: 5,  mode: 'normal'  },
  { seed: 1337,     layer: 10, mode: 'endless' },
  { seed: 99991,    layer: 25, mode: 'endless' },
  { seed: 20250808, layer: 40, mode: 'endless' },
];

let failed = 0;

if (USE_MOCK) {
  console.log('⚠ 未配置 SUPABASE_URL/ANON_KEY —— 本地自洽模式（同一后端实例两次结算必须逐 bit 一致）');
  for (const c of CASES) {
    const a = await harness.localBattle(c.seed, c.layer, c.mode);
    const b = await harness.localBattle(c.seed, c.layer, c.mode);
    if (!a.ok || !b.ok) { console.error(`✗ seed=${c.seed} 本地跑失败`); failed++; continue; }
    if (a.checksum !== b.checksum) {
      console.error(`✗ seed=${c.seed} 同输入两次结果不同——核心非确定性！`);
      failed++;
    } else {
      console.log(`✓ seed=${String(c.seed).padStart(9)} layer=${String(c.layer).padStart(2)}  checksum=${a.checksum.slice(0, 16)}…  ticks=${a.ticks}`);
    }
  }
  console.log(`\n${failed ? `✗ ${failed} 失败` : '✓ 核心确定性验证通过（mock 模式）'}`);
  process.exit(failed ? 1 : 0);
}

// ── 真实云端校验：本地 vs Edge ──
console.log(`云端校验：${URL_BASE}/functions/v1/game`);
for (const c of CASES) {
  const local = await harness.localBattle(c.seed, c.layer, c.mode);
  if (!local.ok) { console.error(`✗ seed=${c.seed} 本地失败：${local.message}`); failed++; continue; }

  const res = await fetch(`${URL_BASE}/functions/v1/game`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      'X-Core-Version': harness.CORE_VERSION,
    },
    body: JSON.stringify({ action: '__parityBattle', payload: { seed: c.seed, layer: c.layer, mode: c.mode } }),
  });
  if (!res.ok) { console.error(`✗ seed=${c.seed} Edge HTTP ${res.status}`); failed++; continue; }
  const remote = await res.json();
  if (!remote.ok) { console.error(`✗ seed=${c.seed} Edge 错误：${remote.code} ${remote.message}`); failed++; continue; }

  if (local.checksum !== remote.data.checksum) {
    console.error(`✗ seed=${c.seed} 引擎漂移！`);
    console.error(`    local  checksum=${local.checksum}  ticks=${local.ticks}  result=${local.outcome}`);
    console.error(`    remote checksum=${remote.data.checksum}  ticks=${remote.data.totalTicks}  result=${remote.data.outcome}`);
    failed++;
  } else {
    console.log(`✓ seed=${String(c.seed).padStart(9)} layer=${String(c.layer).padStart(2)}  checksum=${local.checksum.slice(0, 16)}…  ticks=${local.ticks}`);
  }
}

console.log(failed ? `\n✗ ${failed}/${CASES.length} 漂移，禁止上线` : `\n✓ ${CASES.length}/${CASES.length} 前后端逐 bit 一致`);
process.exit(failed ? 1 : 0);
