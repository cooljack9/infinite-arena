// ── run-ts.mjs：把 TS 脚本 esbuild 打包到系统临时目录再执行 ──
// 本环境 sandbox 拦「写项目内文件」，但 tmpdir 可写（verify-parity 已验证）。
// 用法：node scripts/run-ts.mjs scripts/smoke.ts [args...]
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { spawn } from 'node:child_process';

const entry = process.argv[2];
if (!entry) { console.error('用法：node scripts/run-ts.mjs <entry.ts> [args...]'); process.exit(1); }

const base = entry.split('/').pop().replace('.ts', '');
const out = join(tmpdir(), `arena-${base}-${process.pid}.mjs`);

try {
  await build({
    entryPoints: [entry],
    bundle: true, platform: 'node', format: 'esm',
    outfile: out, logLevel: 'error',
  });
} catch (e) {
  console.error('esbuild 失败:', e.message);
  process.exit(1);
}

// 用子进程跑，保持退出码传播（子进程退出码 > 0 时本进程也失败）
const args = [out, ...process.argv.slice(3)];
const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
child.on('exit', (code) => {
  try { rmSync(out, { force: true }); } catch { /* tmp 清理失败可忽略 */ }
  process.exit(code ?? 1);
});
