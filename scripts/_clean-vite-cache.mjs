// 清理被锁的 vite 缓存（npm install 残留进程占用）
import { rmSync, existsSync } from 'node:fs';

const target = 'node_modules/.vite';
if (existsSync(target)) {
  try {
    rmSync(target, { recursive: true, force: true });
    console.log('已清理 .vite 缓存');
  } catch (e) {
    console.error('清理失败:', e.message);
    process.exit(1);
  }
} else {
  console.log('.vite 缓存不存在');
}
