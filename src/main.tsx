import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { audio } from './audio';
import { loadTuning } from './boot/loadTuning';
import './index.css';

// 启动即加载可选外部调参（public/data/tuning.json），失败则静默回退内置默认
loadTuning();

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
