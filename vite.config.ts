import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { compression } from 'vite-plugin-compression2';
import path from 'node:path';

// GitHub Pages 以子路径提供。CI 中设置 BASE_PATH（含仓库名与子目录）；本地回退到 /infinite-arena/
const base = process.env.BASE_PATH || (process.env.GITHUB_PAGES === 'true' ? '/infinite-arena/' : '/');

export default defineConfig({
  base,
  plugins: [
    react(),
    // vX 打包瘦身：构建后预生成 .br（brotli）/ .gz 压缩资产，交由支持内容协商的 CDN/网关直接吐压缩版，
    // 省去传输期压缩开销（GitHub Pages 不自动协商，须配支持 precompressed 的 host；本地 preview 只读原文件）。
    compression({ algorithm: 'brotli', threshold: 1024, deleteOriginalAssets: false }),
    compression({ algorithm: 'gzip', threshold: 1024, deleteOriginalAssets: false }),
  ],
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
    // vX 收敛：移除 manualChunks 过度分包。首屏收敛为单包（main），
    // React + 状态管理 + 菜单 UI 一次就绪；core 引擎等重型依赖随懒加载屏（BattleScreen 等）
    // 由 PreBattle 进战前预载，不占首屏请求预算。首屏请求 5→1，缓存碎片减少，TTI 更稳。
    rollupOptions: {
      // dev 验收页不进产物（preview.html / src/dev/ 仅用于本地渲染验收）
      input: { main: 'index.html' },
    },
  },
});
