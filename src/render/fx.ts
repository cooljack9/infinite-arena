// 全局打击感渲染状态机（v2.9.1 / v2.9.2 手感分层）
// 从 frame.ts 抽出：命中顿帧 / 震屏 / 全屏闪光 的分级触发与帧间自收敛状态。
// 状态由本模块独占持有（单例），frame.ts 的 drawFrame 直接读写同一对象，语义不变。

// ── v2.9.1 全局打击感渲染状态（帧间自收敛：sim 暂停/重开/倍速切换自动复位，零漂移）──
// v2.9.2 手感分层：重击 < 技能起手 < 技能爆发（特殊技规格必须明显高于重击）
export const fx = {
  stopUntil: 0,          // hit-stop 顿帧截止（墙钟秒）
  frozenT: null as number | null, // 顿帧期间冻结的渲染时间
  shakeUntil: 0,         // 震屏截止
  shakeAmp: 0,           // 震幅 px
  shakeDur: 0.18,        // 震屏衰减时长
  flashUntil: 0,         // 全屏闪光截止
  flashColor: '255,236,200', // 闪光色（rgb 三元组）
  flashAmp: 0,           // 闪光强度
  flashDur: 0.10,        // 闪光时长
  lastSimT: -1,          // 上一帧 sim.time（检测战斗重开）
  lastCastAt: -1,        // 上次技能起手反馈的 castAnimAt（防连续顿帧）
};

// hex 色 → "r,g,b"（全屏闪光用）
export const hexRgb = (hex: string): string => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '255,255,255';
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
};

// 分级触发：stop 顿帧 / amp+dur 震屏 / fa+fd 技能色闪光。多源并存取最强（max/覆盖）。
export const triggerFx = (
  wall: number,
  stop: number, amp: number, dur: number,
  col: string | null, fa: number, fd: number,
) => {
  if (stop > 0) { fx.stopUntil = Math.max(fx.stopUntil, wall + stop); fx.frozenT = null; }
  if (amp > 0 && dur > 0) {
    const until = wall + dur;
    if (until >= fx.shakeUntil) { fx.shakeUntil = until; fx.shakeAmp = Math.max(fx.shakeAmp, amp); fx.shakeDur = dur; }
  }
  if (fa > 0 && fd > 0) {
    const until = wall + fd;
    if (until > fx.flashUntil) { fx.flashUntil = until; fx.flashColor = col ?? '255,236,200'; fx.flashAmp = fa; fx.flashDur = fd; }
  }
};
