// 背景故事与剧情（简单叙事层；无尽模式叙事节拍）
import { ClassCategory } from '../types';

// 主菜单「背景故事」全文
export const INTRO = `万古之前，曦光联邦的贤者以星髓与誓约铸成「无限勇者竞技场」——一座自我演化的试炼之环，用以筛选能直面「虚空侵蚀」的英杰。每一层都由场域意志重新捏塑：石环、柱林、双子祭坛……越往深处，现实的法则越稀薄。

传说当挑战者触及第三十层，便有资格窥见竞技场真正的喉咙。而你，将召集三名挚友踏入此门——若幸存，至多可扩至七人满编，向无尽层发起冲击。门后没有终点，只有更深的饥饿。`;

// 各职业一句出战台词（氛围用）
export const HERO_CALL: Record<ClassCategory, string> = {
  tank: '我以血肉为墙，挡在你与湮灭之间。',
  warrior: '冲锋，便是我的祷词。',
  archer: '箭所至处，不必近身。',
  mage: '法则，由我重写。',
};

// Boss 层（每 10 层）叙事台词
export const BOSS_LINES: Record<number, { boss: string; line: string }> = {
  10: { boss: '巨像', line: '渺小的躯壳，也妄想丈量永恒？' },
  20: { boss: '虚空', line: '你踏过的每一层，都是我曾吞下的世界。' },
  30: { boss: '回响', line: '你，不过是上一个挑战者未散的残影。' },
};

export const bossLineFor = (layer: number) => BOSS_LINES[layer] ?? null;

// 通关 Demo（第 30 层胜利）尾声
export const EPILOGUE = `当回响碎裂，竞技场豁然寂静。你终于看清：它从来不是试炼，而是虚空本身——以无尽层为胃，以挑战者为食。你赢了这一程，但门后仍有更深的饥饿。传说，仍在续写。`;
