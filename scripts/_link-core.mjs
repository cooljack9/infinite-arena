// 手动建立 workspace 链接（npm install 在本环境卡死时的替代）
import { mkdirSync, existsSync, symlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const nm = join('node_modules', '@arena');
mkdirSync(nm, { recursive: true });
const target = join(nm, 'core');

if (!existsSync(target)) {
  try {
    symlinkSync(join('..', '..', 'packages', 'core'), target, 'junction');
    console.log('已创建 junction: node_modules/@arena/core -> packages/core');
  } catch (e) {
    console.error('symlink 失败:', e.message);
    process.exit(1);
  }
} else {
  console.log('链接已存在');
}

// 验证解析
const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
console.log('解析 @arena/core OK:', pkg.name, pkg.version);
