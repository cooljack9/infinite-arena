import type { CapacitorConfig } from '@capacitor/core';

// 本地版（x.y0）：纯前端，前后端一致，不连云端。
// webDir 指向 vite 构建产物 dist/；androidScheme 用 https 避免 file:// 限制。
const config: CapacitorConfig = {
  appId: 'com.infinitearena.local',
  appName: '无限勇者竞技场(本地)',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
