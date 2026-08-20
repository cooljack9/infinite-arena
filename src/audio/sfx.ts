// 程序化音效合成库（音频设计文档 §3/§5.2）
// 零采样文件依赖：全部用振荡器 + 噪声 + 包络实时生成 → 无加载、无 404、可离线。
// 每个合成器把节点接到传入的 dest（引擎侧为「voiceGain → panner → bus」）。
import type { AudioEventId, AudioVariant, SubClass, Gender } from '@arena/core/types';

export interface Timbre {
  /** 基频倍率（性别决定：男低女高） */
  pitch: number;
  /** 亮度倍率（性别决定：男沉女亮；作用于噪声滤波频率） */
  bright: number;
  /** 子类序号 0..8（用于叠加「签名音」辨识每个英雄的大招/重击）；-1 表示无 */
  accent: number;
}

export type SynthFn = (
  ctx: AudioContext,
  dest: AudioNode,
  t0: number,
  intensity: number,
  timbre?: Timbre,
) => void;

// ── 共享白噪声 buffer（一次生成，反复复用，省内存）──
let _noise: AudioBuffer | null = null;
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (_noise && _noise.sampleRate === ctx.sampleRate) return _noise;
  const len = Math.floor(ctx.sampleRate * 0.6);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  _noise = buf;
  return buf;
}

// 强度→音量系数：0.5..1.15，避免极弱或爆音
const vol = (i: number) => Math.max(0.5, Math.min(1.15, i || 1));

interface ToneOpt {
  type?: OscillatorType;
  f0: number;
  f1?: number;
  dur: number;
  peak?: number;
  attack?: number;
  /** v2.9.14：基频倍率（性别） */
  pitch?: number;
}
function tone(ctx: AudioContext, dest: AudioNode, t0: number, o: ToneOpt): void {
  const pitch = o.pitch ?? 1;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  const g = ctx.createGain();
  const peak = (o.peak ?? 0.4) * vol(1);
  const atk = o.attack ?? 0.005;
  osc.frequency.setValueAtTime(o.f0 * pitch, t0);
  if (o.f1 != null && o.f1 !== o.f0) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1 * pitch), t0 + o.dur);
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  osc.connect(g).connect(dest);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.03);
}

interface BurstOpt {
  dur: number;
  peak?: number;
  filter?: BiquadFilterType;
  freq?: number;
  freq1?: number;
  q?: number;
  /** v2.9.14：亮度倍率（性别）作用于滤波频率 */
  bright?: number;
}
function burst(ctx: AudioContext, dest: AudioNode, t0: number, o: BurstOpt): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const filt = ctx.createBiquadFilter();
  filt.type = o.filter ?? 'bandpass';
  const bright = o.bright ?? 1;
  filt.frequency.setValueAtTime((o.freq ?? 1200) * bright, t0);
  if (o.freq1 != null) filt.frequency.exponentialRampToValueAtTime(Math.max(40, o.freq1 * bright), t0 + o.dur);
  filt.Q.value = o.q ?? 1;
  const g = ctx.createGain();
  const atk = 0.002;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime((o.peak ?? 0.35) * vol(1), t0 + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  src.connect(filt).connect(g).connect(dest);
  src.start(t0);
  src.stop(t0 + o.dur + 0.03);
}

function chord(ctx: AudioContext, dest: AudioNode, t0: number, freqs: number[], o: Omit<ToneOpt, 'f0'>): void {
  for (const f of freqs) tone(ctx, dest, t0, { ...o, f0: f });
}

// ── v2.9.14 音效大升级：每个英雄（子类）× 性别 拥有独立音色特征 ──
// 性别：男低频沉、女高频亮；子类：签名根频决定大招/重击的「辨识音」。
const GENDER_TONE: Record<Gender, { pitch: number; bright: number }> = {
  male: { pitch: 0.82, bright: 0.85 },
  female: { pitch: 1.22, bright: 1.18 },
};
// 与 SUBCLASS_ORDER 一一对应的「签名根频」：大招起手后叠一个该频的三角波签名音
const SUBCLASS_ORDER: SubClass[] = [
  'physTank', 'magicTank', 'charge', 'hexblade', 'gunner', 'sniper', 'controller', 'summoner', 'healer',
];
const SUBCLASS_SIG: number[] = [196, 233, 165, 294, 262, 349, 220, 277, 330];

export function deriveTimbre(v: AudioVariant): Timbre {
  const g = GENDER_TONE[v.gender] ?? { pitch: 1, bright: 1 };
  const accent = SUBCLASS_ORDER.indexOf(v.subclass);
  return { pitch: g.pitch, bright: g.bright, accent: accent >= 0 ? accent : -1 };
}

// 子类签名音：在基础施法/重击音之上叠一个短促三角波，使每个英雄的招式可辨识
function accentPing(c: AudioContext, d: AudioNode, t: number, accent: number): void {
  if (accent < 0) return;
  const f = SUBCLASS_SIG[accent] ?? 330;
  tone(c, d, t + 0.02, { type: 'triangle', f0: f, f1: f * 1.5, dur: 0.12, peak: 0.12 });
}

// ── 事件 → 合成器注册表 ──
export const SFX: Partial<Record<AudioEventId, SynthFn>> = {
  // ── UI（2D，居中）──
  ui_click: (c, d, t) => tone(c, d, t, { type: 'square', f0: 660, f1: 880, dur: 0.05, peak: 0.16 }),
  ui_open: (c, d, t) => tone(c, d, t, { type: 'triangle', f0: 440, f1: 660, dur: 0.12, peak: 0.18 }),
  ui_error: (c, d, t) => tone(c, d, t, { type: 'square', f0: 200, f1: 140, dur: 0.16, peak: 0.2 }),
  ui_purchase: (c, d, t) => {
    tone(c, d, t, { type: 'square', f0: 880, dur: 0.07, peak: 0.18 });
    tone(c, d, t + 0.08, { type: 'square', f0: 1320, dur: 0.09, peak: 0.18 });
  },

  // ── 战斗反馈（世界空间）──
  // 轻击：随性别基频/亮度变化（v2.9.14 音效大升级）
  hit_melee: (c, d, t, i, tb) => {
    const p = tb?.pitch ?? 1, b = tb?.bright ?? 1;
    tone(c, d, t, { type: 'sine', f0: 150 * p, f1: 60 * p, dur: 0.09, peak: 0.5 * vol(i) });
    burst(c, d, t, { dur: 0.06, peak: 0.32 * vol(i), filter: 'lowpass', freq: 2200 * b, q: 0.7 });
  },
  hit_ranged: (c, d, t, i, tb) => {
    const p = tb?.pitch ?? 1, b = tb?.bright ?? 1;
    tone(c, d, t, { type: 'sine', f0: 1300 * p, f1: 900 * p, dur: 0.06, peak: 0.28 * vol(i) });
    burst(c, d, t, { dur: 0.03, peak: 0.12 * vol(i), filter: 'highpass', freq: 3000 * b });
  },
  // 暴击：随性别基频/亮度变化
  crit: (c, d, t, i, tb) => {
    const p = tb?.pitch ?? 1, b = tb?.bright ?? 1;
    tone(c, d, t, { type: 'sine', f0: 200 * p, f1: 80 * p, dur: 0.1, peak: 0.55 * vol(i) });
    burst(c, d, t, { dur: 0.07, peak: 0.38 * vol(i), filter: 'bandpass', freq: 4000 * b, q: 0.8 });
    tone(c, d, t, { type: 'triangle', f0: 2000 * p, f1: 2600 * p, dur: 0.08, peak: 0.22 * vol(i) });
  },
  // 重击（v2.9.14 新增）：比轻击更厚重的低频撞击 + 子类签名音
  hit_heavy: (c, d, t, i, tb) => {
    const p = tb?.pitch ?? 1, b = tb?.bright ?? 1;
    tone(c, d, t, { type: 'sine', f0: 90 * p, f1: 45 * p, dur: 0.16, peak: 0.6 * vol(i) });
    burst(c, d, t, { dur: 0.12, peak: 0.42 * vol(i), filter: 'lowpass', freq: 1400 * b, q: 0.6 });
    tone(c, d, t, { type: 'triangle', f0: 320 * p, f1: 160 * p, dur: 0.1, peak: 0.2 * vol(i) });
    if (tb) accentPing(c, d, t, tb.accent);
  },
  dodge: (c, d, t) => burst(c, d, t, { dur: 0.12, peak: 0.16, filter: 'bandpass', freq: 1800, freq1: 3200, q: 1.2 }),
  heal: (c, d, t) => chord(c, d, t, [520, 780, 1040], { type: 'sine', dur: 0.28, peak: 0.14, attack: 0.01 }),
  shield_up: (c, d, t) => {
    tone(c, d, t, { type: 'sine', f0: 700, f1: 760, dur: 0.22, peak: 0.16 });
    tone(c, d, t, { type: 'sine', f0: 1050, dur: 0.22, peak: 0.09 });
  },
  death_ally: (c, d, t) => tone(c, d, t, { type: 'sawtooth', f0: 400, f1: 120, dur: 0.32, peak: 0.32, attack: 0.01 }),
  death_enemy: (c, d, t) => {
    burst(c, d, t, { dur: 0.16, peak: 0.28, filter: 'lowpass', freq: 1400, q: 0.6 });
    tone(c, d, t, { type: 'square', f0: 220, f1: 80, dur: 0.16, peak: 0.22 });
  },
  summon_spawn: (c, d, t) => tone(c, d, t, { type: 'sine', f0: 200, f1: 900, dur: 0.26, peak: 0.22 }),
  summon_expire: (c, d, t) => tone(c, d, t, { type: 'sine', f0: 600, f1: 200, dur: 0.15, peak: 0.12 }),

  // ── 技能起手/结算（世界空间）──
  // v2.9.14：每个大招在基础音色之上叠加「子类签名音」（accentPing），
  // 并随性别基频/亮度变化，使 9 英雄 × 男女 的招式释放各具辨识度。
  cast_generic: (c, d, t, _i, tb) => {
    const b = tb?.bright ?? 1;
    burst(c, d, t, { dur: 0.12, peak: 0.22, filter: 'bandpass', freq: 900, freq1: 2600 * b, q: 0.9 });
    if (tb) accentPing(c, d, t, tb.accent);
  },
  cast_taunt: (c, d, t, _i, tb) => {
    const p = tb?.pitch ?? 1;
    tone(c, d, t, { type: 'square', f0: 160 * p, f1: 200 * p, dur: 0.16, peak: 0.26 });
    if (tb) accentPing(c, d, t, tb.accent);
  },
  cast_ward: (c, d, t, _i, tb) => {
    const p = tb?.pitch ?? 1;
    chord(c, d, t, [520 * p, 780 * p], { type: 'sine', dur: 0.26, peak: 0.16 });
    if (tb) accentPing(c, d, t, tb.accent);
  },
  cast_charge: (c, d, t, i, tb) => {
    const p = tb?.pitch ?? 1, b = tb?.bright ?? 1;
    tone(c, d, t, { type: 'sawtooth', f0: 200 * p, f1: 720 * p, dur: 0.18, peak: 0.24 });
    burst(c, d, t, { dur: 0.08, peak: 0.18 * vol(i), filter: 'bandpass', freq: 1800 * b, q: 0.9 });
    if (tb) accentPing(c, d, t, tb.accent);
  },
  cast_hexburst: (c, d, t, _i, tb) => {
    const b = tb?.bright ?? 1;
    burst(c, d, t, { dur: 0.1, peak: 0.32, filter: 'bandpass', freq: 3000 * b, q: 1 });
    if (tb) accentPing(c, d, t, tb.accent);
  },
  cast_barrage: (c, d, t, _i, tb) => {
    const p = tb?.pitch ?? 1;
    for (let k = 0; k < 5; k++) {
      tone(c, d, t + k * 0.045, { type: 'square', f0: (1400 - k * 120) * p, f1: 600 * p, dur: 0.04, peak: 0.18 });
    }
    if (tb) accentPing(c, d, t, tb.accent);
  },
  cast_deadshot_warn: (c, d, t, _i, tb) => {
    const p = tb?.pitch ?? 1;
    tone(c, d, t, { type: 'sine', f0: 1600 * p, dur: 0.22, peak: 0.16 });
    if (tb) accentPing(c, d, t, tb.accent);
  },
  cast_deadshot_fire: (c, d, t, i, tb) => {
    const p = tb?.pitch ?? 1, b = tb?.bright ?? 1;
    tone(c, d, t, { type: 'sawtooth', f0: 300 * p, f1: 2000 * p, dur: 0.12, peak: 0.36 });
    burst(c, d, t, { dur: 0.06, peak: 0.2 * vol(i), filter: 'highpass', freq: 3500 * b });
    if (tb) accentPing(c, d, t, tb.accent);
  },
  cast_timelock: (c, d, t, _i, tb) => {
    const p = tb?.pitch ?? 1;
    chord(c, d, t, [880 * p, 1320 * p], { type: 'sine', dur: 0.2, peak: 0.16 });
    if (tb) accentPing(c, d, t, tb.accent);
  },
  cast_summon: (c, d, t, _i, tb) => {
    const p = tb?.pitch ?? 1;
    tone(c, d, t, { type: 'sine', f0: 150 * p, f1: 1000 * p, dur: 0.3, peak: 0.22 });
    if (tb) accentPing(c, d, t, tb.accent);
  },
  cast_groupheal: (c, d, t, _i, tb) => {
    const p = tb?.pitch ?? 1;
    chord(c, d, t, [520 * p, 659 * p, 784 * p], { type: 'sine', dur: 0.3, peak: 0.14 });
    if (tb) accentPing(c, d, t, tb.accent);
  },
  cast_boss_stomp: (c, d, t, _i, tb) => {
    const b = tb?.bright ?? 1;
    tone(c, d, t, { type: 'sine', f0: 70, f1: 40, dur: 0.32, peak: 0.6 });
    burst(c, d, t, { dur: 0.2, peak: 0.36, filter: 'lowpass', freq: 800 * b, q: 0.5 });
    if (tb) accentPing(c, d, t, tb.accent);
  },
  cast_boss_devour_warn: (c, d, t, _i, tb) => {
    const p = tb?.pitch ?? 1;
    tone(c, d, t, { type: 'sine', f0: 110 * p, dur: 0.22, peak: 0.2 });
    if (tb) accentPing(c, d, t, tb.accent);
  },
  cast_boss_devour: (c, d, t, i, tb) => {
    const p = tb?.pitch ?? 1, b = tb?.bright ?? 1;
    tone(c, d, t, { type: 'sawtooth', f0: 400 * p, f1: 80 * p, dur: 0.22, peak: 0.26 });
    burst(c, d, t, { dur: 0.16, peak: 0.22 * vol(i), filter: 'bandpass', freq: 1600 * b, q: 0.8 });
    if (tb) accentPing(c, d, t, tb.accent);
  },
  cast_boss_split: (c, d, t, _i, tb) => {
    const p = tb?.pitch ?? 1, b = tb?.bright ?? 1;
    tone(c, d, t, { type: 'sawtooth', f0: 500 * p, f1: 120 * p, dur: 0.25, peak: 0.28 });
    burst(c, d, t, { dur: 0.18, peak: 0.26, filter: 'bandpass', freq: 2000 * b, freq1: 500, q: 0.8 });
    if (tb) accentPing(c, d, t, tb.accent);
  },

  // ── 控制结算（世界空间）：三类控制音色完全分离，玩家闭眼也能分辨被控类型 ──
  // 眩晕：金属撞击 + 高频叮（"被砸晕了"）；定身：冰晶碎裂（"被冻住"）；
  // 嘲讽：低沉号角 + 回声（"被逼着看向某人"）。
  cc_stun: (c, d, t, i) => {
    tone(c, d, t, { type: 'square', f0: 180, f1: 90, dur: 0.12, peak: 0.4 * vol(i) });
    tone(c, d, t + 0.02, { type: 'triangle', f0: 2600, f1: 3200, dur: 0.09, peak: 0.2 * vol(i) });
    burst(c, d, t, { dur: 0.08, peak: 0.3 * vol(i), filter: 'bandpass', freq: 1600, q: 1.2 });
  },
  cc_root: (c, d, t, i) => {
    burst(c, d, t, { dur: 0.14, peak: 0.3 * vol(i), filter: 'highpass', freq: 4200, q: 0.9 });
    tone(c, d, t + 0.005, { type: 'sine', f0: 1400, f1: 700, dur: 0.16, peak: 0.18 * vol(i) });
  },
  cc_taunt: (c, d, t, i) => {
    tone(c, d, t, { type: 'sawtooth', f0: 120, f1: 150, dur: 0.22, peak: 0.34 * vol(i) });
    tone(c, d, t + 0.12, { type: 'sawtooth', f0: 120, f1: 150, dur: 0.22, peak: 0.22 * vol(i), attack: 0.02 });
  },

  // ── 状态转场（2D）──
  wave_start: (c, d, t) => {
    tone(c, d, t, { type: 'triangle', f0: 440, dur: 0.14, peak: 0.2 });
    tone(c, d, t + 0.12, { type: 'triangle', f0: 660, dur: 0.18, peak: 0.2 });
  },
  victory: (c, d, t) => chord(c, d, t, [523, 659, 784, 1046], { type: 'triangle', dur: 0.5, peak: 0.18, attack: 0.01 }),
  defeat: (c, d, t) => chord(c, d, t, [440, 370, 294, 220], { type: 'sawtooth', dur: 0.6, peak: 0.16, attack: 0.01 }),
};
