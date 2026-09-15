// 音频引擎（音频设计文档 §4/§5）
// Web Audio 原生实现「中间件纪律」：事件系统 + 总线(VCA) + 语音预算 + 空间声像。
// 不依赖 FMOD/Wwise（Web 运行时不适用）。纯程序化音效与 BGM，零采样文件。
import type { AudioCue, AudioEventId } from '@arena/core/types';
import { SFX, deriveTimbre } from './sfx';

const MAX_SFX_VOICES = 20; // 战斗/技能可抢占
const MAX_VOICE_DUR = 0.65; // 最长语音上限（用于回收估算）


// ── BGM：程序化旋律循环（零采样文件，Web Audio 调度器）──
export type MusicTrack = 'battle' | 'shop';
/** MIDI 音高 → Hz */
const N = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// 战斗战歌（A 小调，132 BPM，2 小节 32 步，16 分音符）
const BATTLE_BPM = 132;
const BATTLE_STEPS = 32;
/** 每 2 步一个旋律音（0 = 休止）：A4 E5 C5 E5 | F4 C5 G5 C5 | G4 D5 B4 D5 | E4 B4 E5 B4 */
const BATTLE_MOTIF = [69, 76, 72, 76, 65, 72, 77, 72, 67, 74, 79, 74, 64, 71, 76, 71];
/** 每 4 步一换的低音进行：A2 F2 G2 E2 */
const BATTLE_BASS = [45, 41, 43, 40];

// 商店休息曲（大调和弦琶音，72 BPM，4 小节 16 步，8 分音符）
const SHOP_BPM = 72;
const SHOP_STEPS = 16;
/** 每 4 步一换的和弦：Amaj7 F#m7 Dmaj7 E7（每和弦 4 个琶音音） */
const SHOP_CHORDS: number[][] = [
  [57, 61, 64, 68], // Amaj7
  [54, 57, 61, 64], // F#m7
  [62, 66, 69, 73], // Dmaj7
  [64, 68, 71, 74], // E7
];
const SHOP_ARP = [0, 1, 2, 3, 2, 1]; // 琶音走向（每步换一个音）

// 走 uiBus 的事件：永不被抢占，恒最高优先级
const UI_EVENTS = new Set<AudioEventId>([
  'ui_click', 'ui_open', 'ui_error', 'ui_purchase',
  'wave_start', 'victory', 'defeat',
]);

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private uiBus!: GainNode;

  // 语音追踪：sfx 可抢占，ui 仅做回收
  private sfxVoices = new Map<GainNode, number>(); // voiceGain -> endsAt
  private uiVoices = new Map<GainNode, number>();

  private _muted = false;
  private _volume = 0.8;
  private intensity = 0;
  private ambience: { osc: OscillatorNode[]; filter: BiquadFilterNode; lfo: OscillatorNode } | null = null;

  /** 必须在用户手势后调用（浏览器自动播放策略） */
  resume(): void {
    if (!this.ctx) this.init();
    if (this.ctx!.state === 'suspended') void this.ctx!.resume();
  }

  private init(): void {
    const Ctor: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this._muted ? 0 : this._volume;
    this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.25; // BGM 基础音量（setIntensity 0.25~0.55 调制）
    this.musicBus.connect(this.master);

    this.uiBus = this.ctx.createGain();
    this.uiBus.gain.value = 1.0;
    this.uiBus.connect(this.master);
  }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v));
    if (this.master && !this._muted) this.master.gain.value = this._volume;
  }
  get muted(): boolean { return this._muted; }
  toggleMute(): boolean {
    this._muted = !this._muted;
    if (this.master) this.master.gain.value = this._muted ? 0 : this._volume;
    return this._muted;
  }

  /** 自适应音乐参数（音频设计文档 §6）：驱动 BGM 增益/明亮度（0.25~0.55） */
  setIntensity(v: number): void {
    this.intensity = Math.max(0, Math.min(1, v));
    if (this.musicBus) {
      this.musicBus.gain.value = 0.25 + 0.3 * this.intensity;
    }
    if (this.ambience) {
      // 张力越高，铺底滤波越开（更亮、更具临场感）
      const now = this.ctx!.currentTime;
      this.ambience.filter.frequency.setTargetAtTime(180 + 700 * this.intensity, now, 0.3);
    }
  }

  /** 程序化低频铺底（自适应音乐的基础实现；默认不自动启动，由战斗屏调用） */
  startAmbience(): void {
    if (!this.ctx) this.init();
    if (this.ambience) return;
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 180 + 700 * this.intensity;
    filter.Q.value = 0.7;
    filter.connect(this.musicBus);

    const a = ctx.createOscillator();
    a.type = 'sine';
    a.frequency.value = 55; // A1 低频铺底
    const b = ctx.createOscillator();
    b.type = 'sine';
    b.frequency.value = 55 * 1.5; // 纯五度，增加厚度
    b.detune.value = 6;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    a.connect(g); b.connect(g); g.connect(filter);

    // LFO 缓慢起伏（呼吸感）
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.2;
    lfo.connect(lfoGain).connect(g.gain);

    a.start(); b.start(); lfo.start();
    this.ambience = { osc: [a, b], filter, lfo };
  }

  stopAmbience(): void {
    if (!this.ambience) return;
    const { osc, lfo } = this.ambience;
    try { osc.forEach((o) => o.stop()); lfo.stop(); } catch { /* already stopped */ }
    this.ambience = null;
  }

  // ── BGM：程序化旋律循环（战歌 / 休息曲）─────────────────
  private music: { timer: number; nextNote: number; step: number; track: MusicTrack } | null = null;

  /** 播放背景音乐（同轨不重启；切轨先停旧）。须在用户手势后调用（resume 已处理）。 */
  playMusic(track: MusicTrack): void {
    if (!this.ctx) this.init();
    if (this.music && this.music.track === track) return;
    this.stopMusic();
    const ctx = this.ctx!;
    if (ctx.state === 'suspended') void ctx.resume();
    this.music = {
      timer: window.setInterval(() => this.scheduleMusic(), 30),
      nextNote: ctx.currentTime + 0.08,
      step: 0,
      track,
    };
  }

  stopMusic(): void {
    if (!this.music) return;
    clearInterval(this.music.timer);
    this.music = null;
  }

  private scheduleMusic(): void {
    const m = this.music;
    if (!m) return;
    const ctx = this.ctx!;
    const LOOKAHEAD = 0.12; // 提前 120ms 调度音符，杜绝断音
    while (m.nextNote < ctx.currentTime + LOOKAHEAD) {
      if (m.track === 'battle') this.scheduleBattle(m.nextNote, m.step);
      else this.scheduleShop(m.nextNote, m.step);
      m.step = (m.step + 1) % (m.track === 'battle' ? BATTLE_STEPS : SHOP_STEPS);
      m.nextNote += 60 / (m.track === 'battle' ? BATTLE_BPM : SHOP_BPM) / (m.track === 'battle' ? 4 : 2);
    }
  }

  /** 战歌（132BPM）：鼓点 + 低音进行 + 明亮旋律琶音 */
  private scheduleBattle(t0: number, step: number): void {
    // 鼓：每 4 步底鼓，第 4/12 步军鼓
    if (step % 4 === 0) this.playKick(t0, 0.5);
    if (step === 4 || step === 12) this.playSnare(t0, 0.28);
    // 低音：每 4 步一换（A F G E 进行）
    this.playNote(N(BATTLE_BASS[Math.floor(step / 4) % 4]), t0, 0.22, 0.32, 'sawtooth');
    // 旋律：每 2 步一个音（休止符跳过）
    if (step % 2 === 0) {
      const midi = BATTLE_MOTIF[(step / 2) % BATTLE_MOTIF.length];
      if (midi > 0) this.playNote(N(midi), t0, 0.3, 0.2, 'triangle');
    }
  }

  /** 休息曲（72BPM）：大七和弦琶音，柔和 sine */
  private scheduleShop(t0: number, step: number): void {
    const chord = SHOP_CHORDS[Math.floor(step / 4) % SHOP_CHORDS.length];
    const idx = SHOP_ARP[step % SHOP_ARP.length];
    this.playNote(N(chord[idx]), t0, 1.6, 0.14, 'sine');
    // 低八度根音垫底（每 4 步）
    if (step % 4 === 0) this.playNote(N(chord[0] - 12), t0, 2.4, 0.12, 'triangle');
  }

  /** 单音合成（连到 musicBus） */
  private playNote(freq: number, t0: number, dur: number, gain: number, type: OscillatorType): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.musicBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  /** 底鼓：正弦下扫 120→40Hz */
  private playKick(t0: number, gain: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t0);
    osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    osc.connect(g);
    g.connect(this.musicBus);
    osc.start(t0);
    osc.stop(t0 + 0.2);
  }

  /** 军鼓：高通噪声短爆 */
  private playSnare(t0: number, gain: number): void {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * 0.12);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    src.connect(hp); hp.connect(g); g.connect(this.musicBus);
    src.start(t0);
  }

  /** 事件接口：所有音效的唯一入口（音频设计文档 §4） */
  playCue(cue: AudioCue): void {
    if (this._muted) return;
    if (!this.ctx) this.init();
    const ctx = this.ctx!;
    if (ctx.state === 'suspended') void ctx.resume();

    const synth = SFX[cue.id];
    if (!synth) return;

    const t0 = ctx.currentTime + 0.001;
    const panner = ctx.createStereoPanner();
    panner.pan.value = this.panFor(cue);

    const isUi = UI_EVENTS.has(cue.id);
    const bus = isUi ? this.uiBus : this.sfxBus;
    const voice = ctx.createGain();
    voice.gain.value = 1;
    voice.connect(panner);
    panner.connect(bus);

    // 回收已结束语音
    const now = ctx.currentTime;
    this.prune(now);

    // 语音预算：sfx 超限抢占最旧（ui 永不抢占）
    if (!isUi) {
      while (this.sfxVoices.size >= MAX_SFX_VOICES) {
        let oldest: GainNode | null = null;
        let oldestEnd = Infinity;
        for (const [v, ends] of this.sfxVoices) {
          if (ends < oldestEnd) { oldestEnd = ends; oldest = v; }
        }
        if (!oldest) break;
        oldest.gain.value = 0; // 静音即「抢占」
        oldest.disconnect();
        this.sfxVoices.delete(oldest);
      }
    }

    // v2.9.14：角色特征 → 音色（性别基频/亮度 + 子类签名音）；无 variant 时为默认音色。
    const timbre = cue.variant ? deriveTimbre(cue.variant) : undefined;
    synth(ctx, voice, t0, cue.gain ?? 1, timbre);
    const endsAt = t0 + MAX_VOICE_DUR;
    if (isUi) this.uiVoices.set(voice, endsAt);
    else this.sfxVoices.set(voice, endsAt);

    // 定时清理（兜底，防止极端情况下 Map 堆积）
    window.setTimeout(() => {
      this.uiVoices.delete(voice);
      this.sfxVoices.delete(voice);
    }, MAX_VOICE_DUR * 1000 + 200);
  }

  private panFor(cue: AudioCue): number {
    if (cue.x == null || cue.arenaW == null || cue.arenaW <= 0) return 0;
    return Math.max(-1, Math.min(1, (cue.x / cue.arenaW) * 2 - 1));
  }

  private prune(now: number): void {
    for (const [v, ends] of this.sfxVoices) if (ends <= now) { v.disconnect(); this.sfxVoices.delete(v); }
    for (const [v, ends] of this.uiVoices) if (ends <= now) { v.disconnect(); this.uiVoices.delete(v); }
  }
}
