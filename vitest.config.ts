import { defineConfig } from 'vitest/config';
import path from 'node:path';
import os from 'node:os';

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@arena\/core$/, replacement: path.resolve(__dirname, 'packages/core/src/index.ts') },
      { find: /^@arena\/core\/(.+)$/, replacement: path.resolve(__dirname, 'packages/core/src/$1') },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // 缓存放系统临时目录：node_modules/.vite 在本环境会被 npm 进程锁住（EPERM）
    cache: { dir: path.join(os.tmpdir(), 'arena-vitest-cache') },
  },
});
