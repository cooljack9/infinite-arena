// 音频模块入口（音频设计文档 §4）
// 全局单例：游戏代码统一经 `audio.playCue(cue)` 触发音效，不直接碰 AudioContext。
import { AudioEngine } from './AudioEngine';

export const audio = new AudioEngine();
export { AudioEngine };
export type { AudioCue, AudioEventId } from '@arena/core/types';
