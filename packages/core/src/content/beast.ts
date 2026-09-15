// v1.8.4 兽类怪物专属随机特性（需求：#5 部分兽类怪物可获得专属随机特性）。
//
// 设计：
//  1) 「兽类」= monsterKind ∈ {demon, gargoyle, dragon, demon_wolf, fae_wolf}
//     （恶魔/石像鬼/龙/恶魔狼/精灵狼，直觉意义上的"兽"；龙已加兽类标签，新增两狼）。
//  2) 特性按 **位置确定性派生**（beastTraitFor(enemyId, layer, waveIdx, i)）——
//     不消费 buildWaves 的 rng 流（避免改动既有波次生成的确定性顺序），
//     前端 genLayer 与后端 buildUnits 都调 buildWaves，同一 (layer, waveIdx, i) 同敌人 → 同特性。
//  3) 概率 35% 获得三特性之一（hash 均匀分布），同 seed 同敌人必然同特性。
import type { BeastTraitId, MonsterKind } from '../types';
import { hashStr } from '../rules/economy';

/** 视为「兽类」的 monsterKind（可获专属随机特性） */
export const BEAST_MONSTER_KINDS: MonsterKind[] = ['demon', 'gargoyle', 'dragon', 'demon_wolf', 'fae_wolf'];

export const isBeastEnemy = (kind?: MonsterKind): boolean =>
  !!kind && (BEAST_MONSTER_KINDS as string[]).includes(kind);

/** 三特性中文名 / 说明 / 图标色（渲染层用） */
export const BEAST_TRAIT_INFO: Record<BeastTraitId, { name: string; desc: string; color: string }> = {
  selfdestruct: {
    name: '自爆',
    desc: '死亡时对周围 2 格造成 35% 最大生命真实伤害',
    color: '#ff5a3c',
  },
  nest: {
    name: '下一站',
    desc: '入场 2 秒后产 3~6 只小个体（生命减半·体型小 40%·移速快 30%），小个体复仇优先攻击击杀母体者',
    color: '#ffb15a',
  },
  immunity: {
    name: '双免轮换',
    desc: '每 3 秒在物理免疫 / 魔法免疫之间切换',
    color: '#7ad0ff',
  },
};

const BEAST_TRAITS: BeastTraitId[] = ['selfdestruct', 'nest', 'immunity'];
const BEAST_CHANCE = 35; // %：兽类敌人获得专属特性的概率

/**
 * 按位置确定性派生兽类特性（不消费 rng 流）：
 * hash(`${enemyId}|${layer}|${waveIdx}|${i}`) → <35% 概率 → 三特性之一。
 */
export function beastTraitFor(
  enemyId: string,
  layer: number,
  waveIdx: number,
  i: number,
): BeastTraitId | undefined {
  const h = hashStr(`${enemyId}|${layer}|${waveIdx}|${i}`) >>> 0;
  if (h % 100 >= BEAST_CHANCE) return undefined;
  return BEAST_TRAITS[h % BEAST_TRAITS.length];
}
