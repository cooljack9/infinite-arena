import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// GitHub Pages 以子路径提供。CI 中设置 BASE_PATH（含仓库名与子目录）；本地回退到 /infinite-arena/
const base = process.env.BASE_PATH || (process.env.GITHUB_PAGES === 'true' ? '/infinite-arena/' : '/');

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: [
      // @arena/core → packages/core/src（dev/build 直读同一份源码；Edge 用 dist 产物，
      // 两侧一致性由 scripts/verify-parity.mjs + CI git diff 保证）
      { find: /^@arena\/core$/, replacement: path.resolve(__dirname, 'packages/core/src/index.ts') },
      { find: /^@arena\/core\/(.+)$/, replacement: path.resolve(__dirname, 'packages/core/src/$1') },
    ],
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      // dev 验收页不进产物（preview.html / src/dev/ 仅用于本地渲染验收）
      input: { main: 'index.html' },
    },
  },
});
