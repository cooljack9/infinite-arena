#!/usr/bin/env node
// ── build-core.mjs：把 @arena/core 打成单文件 ESM ─────────────
//
// "一次编写，随处运行"的物理保证：
//   1. esbuild bundle packages/core/src/index.ts → dist/index.js（无外部 import，Deno 直接可吃）
//   2. 算 sha256 写 BUILD_HASH.txt + 烘焙进 buildinfo.ts（运行时可互校）
//   3. --sync 时复制到 supabase/functions/_shared/core.js（与前端同一字节流）
//
// 用法：
//   node scripts/build-core.mjs            构建
//   node scripts/build-core.mjs --sync     构建 + 同步到 supabase/_shared
//   node scripts/build-core.mjs --check    校验产物与源码一致（CI 用）
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = resolve(ROOT, 'packages/core');
const OUT = resolve(CORE, 'dist/index.js');
const SHARED = resolve(ROOT, 'supabase/functions/_shared/core.js');

const args = new Set(process.argv.slice(2));
const SYNC = args.has('--sync');
const CHECK = args.has('--check');

async function writeBuildInfo(hash) {
  await writeFile(
    resolve(CORE, 'src/buildinfo.ts'),
    `// 自动生成，请勿手改 —— by scripts/build-core.mjs\n`
      + `export const CORE_BUILD_HASH = '${hash}';\n`,
    'utf8',
  );
}

async function bundle() {
  const result = await build({
    entryPoints: [resolve(CORE, 'src/index.ts')],
    outfile: OUT,
    bundle: true,
    format: 'esm',
    // neutral：既不假设 node 也不假设 browser。核心本不该碰平台 API，
    // 万一有人偷偷 import 了 'node:fs'，这里直接构建失败——正是我们想要的。
    platform: 'neutral',
    target: 'es2020',
    minify: false,          // 不压缩：Edge 端调试要看堆栈；体积不是瓶颈（~200KB）
    sourcemap: true,
    treeShaking: true,
    legalComments: 'none',
    logLevel: 'warning',
  });
  if (result.errors.length) throw new Error('esbuild 失败');
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function main() {
  if (!existsSync(CORE)) {
    console.error(`✗ 找不到 ${CORE}`);
    process.exit(1);
  }

  // 第 1 趟：占位 hash 打一次，得到不含 hash 的产物指纹（stable）
  await writeBuildInfo('0'.repeat(64));
  await bundle();
  const stable = sha256(await readFile(OUT));

  // 第 2 趟：把真 hash 烘焙进源码再打一次（产物含自指纹，两个宿主比这个值）
  await writeBuildInfo(stable);
  await bundle();

  await mkdir(resolve(CORE, 'dist'), { recursive: true });
  await writeFile(resolve(CORE, 'dist/BUILD_HASH.txt'), stable + '\n', 'utf8');

  const bytes = (await readFile(OUT)).length;
  console.log(`✓ core 打包完成：${(bytes / 1024).toFixed(1)} KB，指纹 ${stable.slice(0, 16)}…`);

  if (SYNC || CHECK) {
    await mkdir(dirname(SHARED), { recursive: true });
    if (CHECK) {
      if (!existsSync(SHARED)) {
        console.error(`✗ 缺少 ${SHARED}，先跑 npm run build:core -- --sync`);
        process.exit(1);
      }
      const cur = sha256(await readFile(SHARED));
      const nxt = sha256(await readFile(OUT));
      if (cur !== nxt) {
        console.error(`✗ supabase/_shared/core.js 与源码不一致！前后端将算出不同结果。`);
        console.error(`  修复：node scripts/build-core.mjs --sync`);
        process.exit(1);
      }
      console.log('✓ Edge 侧 core 与源码一致');
    } else {
      await copyFile(OUT, SHARED);
      await copyFile(OUT + '.map', SHARED + '.map').catch(() => {});
      console.log(`✓ 已同步 → ${SHARED}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
