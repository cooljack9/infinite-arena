import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { audio } from './audio';
import { loadTuning } from './boot/loadTuning';
import { loadTheme } from './game/state/slices/helpers';
import './index.css';

// 启动即加载可选外部调参（public/data/tuning.json），失败则静默回退内置默认
loadTuning();

// vX 主题：渲染前先按持久化偏好落到 <html data-theme>，避免首帧默认主题闪烁
document.documentElement.setAttribute('data-theme', loadTheme());

// ── 音频解锁 + 全局 UI 点击音（音频设计文档 §4）──
// 浏览器自动播放策略：AudioContext 必须在用户手势后才能出声，故首次交互解锁。
window.addEventListener('pointerdown', () => audio.resume(), { passive: true });
// 委托监听：所有 <button> 点击给一个 ui_click 反馈，无需逐个屏幕改 onClick。
document.addEventListener('click', (e) => {
  const el = e.target as HTMLElement | null;
  if (el && el.closest('button')) audio.playCue({ id: 'ui_click' });
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// React 首帧绘制后淡出并移除启动加载层（避免 JS 加载期间用户只看到黑屏）
requestAnimationFrame(() => {
  const boot = document.getElementById('boot-loader');
  if (boot) {
    boot.classList.add('hidden');
    setTimeout(() => boot.remove(), 380);
  }
});

// v2.4.4 PWA 离线：仅生产构建注册 Service Worker（dev 模式 HMR 与 SW 缓存会打架）
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[SW] 注册失败，离线不可用：', err);
    });
  });
}
