#!/usr/bin/env node
// ── verify-snapshot-packing.mjs ──────────────────────────────────────────────────
// P1 快照字段精简的回归闸门：防止「渲染层新增 Unit 字段读取却忘了加入 packSurface.UNIT_FIELDS」
// 导致 Worker 快照缺失该字段、视觉静默回归（TypeScript 不会报错，只能运行时/此脚本暴露）。
//
// 两层校验：
//   ① 静态：穷举 src/render 全部 `u.<field>` 读取集合 R，断言 R ⊆ UNIT_FIELDS(P)。
//   ② 动态：esbuild 打包 snapshot-pack-harness.ts，跑一场真实战斗 600 tick，
//      断言 packUnit 对任意 tick/单位都产出含全部 UNIT_FIELDS 的对象，且必填数值有限。
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RENDER_DIR = join(ROOT, 'src/render');
const PACK = join(RENDER_DIR, 'packSurface.ts');

let failed = 0;
const fail = (m) => { console.error('  ✗ ' + m); failed++; };
const ok = (m) => console.log('  ✓ ' + m);

// ── ① 静态：渲染读取集合 R ⊆ UNIT_FIELDS P ──
console.log('① 静态契约：渲染读取字段 ⊆ packSurface.UNIT_FIELDS');
const renderReads = new Set();
for (const f of readdirSync(RENDER_DIR)) {
  if (!/\.(ts|tsx)$/.test(f)) continue;
  const src = readFileSync(join(RENDER_DIR, f), 'utf8');
  // 匹配 `u.<field>` 与 `unit.<field>`（渲染层单位变量约定名）
  for (const re of [/\b[u]\.([A-Za-z_$][\w$]*)/g, /\bunit\.([A-Za-z_$][\w$]*)/g]) {
    let m;
    while ((m = re.exec(src))) renderReads.add(m[1]);
  }
}
const packSrc = readFileSync(PACK, 'utf8');
const arrMatch = packSrc.match(/UNIT_FIELDS\s*=\s*\[([\s\S]*?)\]/);
if (!arrMatch) { fail(`无法在 packSurface.ts 解析 UNIT_FIELDS`); process.exit(1); }
const P = new Set(
  (arrMatch[1].match(/['"]([A-Za-z_$][\w$]*)['"]/g) || []).map((s) => s.slice(1, -1)),
);
console.log(`  渲染读取字段 R=${renderReads.size} 个，UNIT_FIELDS P=${P.size} 个`);

for (const r of [...renderReads].sort()) {
  if (!P.has(r)) fail(`渲染读取了字段 "${r}"，但不在 UNIT_FIELDS 中（快照会缺失 → 需补入 packSurface.ts）`);
}
if (failed === 0) ok('所有渲染读取字段均已纳入快照白名单');

// ── ② 动态：真实战斗断言 packUnit 不丢字段 ──
console.log('② 动态契约：真实战斗 packUnit 产出含全部白名单字段');
const TMP = join(tmpdir(), `arena-pack-${process.pid}.mjs`);
await build({
  entryPoints: [join(ROOT, 'scripts/snapshot-pack-harness.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: TMP, logLevel: 'error',
});
const harness = await import(`file://${TMP.replace(/\\/g, '/')}`);
const res = harness.runPackCheck();
if (!res.ok) {
  for (const e of res.errors) fail(e);
} else {
  ok(`600 tick 战斗内 packUnit 始终含全部 ${P.size} 字段（ticks=${res.ticks}, units=${res.unitCount}）`);
}

console.log(failed === 0 ? '\n✓ 快照字段精简契约校验通过' : `\n✗ 快照字段精简契约校验失败（${failed} 项）`);
process.exit(failed === 0 ? 0 : 1);
