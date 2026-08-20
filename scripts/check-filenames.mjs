#!/usr/bin/env node
// ── CI 闸门：仓库文件名长度检查（防 Runner ENAMETOOLONG）──
// 规则（CICD §11.1）：裸文件名(basename) ≤ 60 字节(UTF-8)，超出即 exit 1。
// 用法：node scripts/check-filenames.mjs [--limit 60]
// 实现：git ls-tree -r HEAD 从「已提交树」枚举（读对象库，不受 stale 索引 /
//       sparse-checkout / 持久化 Runner 陈旧索引条目影响，CI 上即使 docs/ 未落盘也能检查）。
//       语义上也更正确：闸门防的是「会被检出的提交内容」触发 Runner ENAMETOOLONG。
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const limitIdx = process.argv.indexOf('--limit');
const LIMIT = Number(limitIdx >= 0 ? process.argv[limitIdx + 1] : 60);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const out = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-tree', '-r', 'HEAD', '-z', '--name-only'], { cwd: ROOT, encoding: 'utf8' });

// git 可能仍按 core.quotepath 转义非 ASCII（\ooo 八进制）；先收集字节再整体 UTF-8 解码（勿逐字节 decode）
const unquote = (s) => {
  const bytes = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === '\\' && /^[0-7]{3}$/.test(s.slice(i + 1, i + 4))) {
      bytes.push(parseInt(s.slice(i + 1, i + 4), 8));
      i += 4;
    } else {
      bytes.push(...Buffer.from(s[i], 'utf8'));
      i++;
    }
  }
  return Buffer.from(bytes).toString('utf8');
};

const files = out.split('\0').filter(Boolean);

const bad = [];
for (const p of files) {
  const name = unquote(p).split('/').pop() ?? p; // basename（git 路径恒用 / 分隔）
  const bytes = Buffer.byteLength(name, 'utf8');
  if (bytes > LIMIT) bad.push(`${bytes}B  ${p}`);
}

if (bad.length) {
  console.error(`✗ ${bad.length} 个文件裸名超 ${LIMIT} 字节(UTF-8)（ENAMETOOLONG 风险，见 CICD §11）：`);
  for (const b of bad) console.error('  ' + b);
  process.exit(1);
}
console.log(`✓ 全部 ${files.length} 个跟踪文件裸名 ≤ ${LIMIT} 字节，文件名合规`);
