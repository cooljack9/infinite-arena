// 英雄人格化 · 成长原型 + 风格化声纹（应用层；不进 core，零 parity 风险）
// 确定性：原型 / 台词 / 体型成长均由 uid 种子化派生，禁 Math.random。
// 设计来源：docs/无限勇者竞技场-英雄人格化破局方案.md（v2.2 §2.1 / §2.4 / §2.5）
import { mulberry32 } from '@arena/core/engine/rng';
import type { HeroDef } from '@arena/core/types';

export type GrowthArchetype = 'prodigy' | 'specialist' | 'lateBloomer';

export interface ArchetypeInfo {
  id: GrowthArchetype;
  cn: string; // 徽章中文名（神化 / 极致 / 无界）
  motif: string; // 风格母题
  color: string; // 主色（徽章 / 光晕）
  glow: string; // 光晕 rgba
  tagline: string; // 一句话母题
  tone: string; // 叙事口吻
}

// 三原型各一套「气质」——对应方案 2.5.1：神化 / 极致 / 无界膨胀
export const ARCHETYPE_INFO: Record<GrowthArchetype, ArchetypeInfo> = {
  prodigy: {
    id: 'prodigy',
    cn: '神化',
    motif: '天选 · 神化',
    color: '#ffd24a',
    glow: 'rgba(255,210,74,0.30)',
    tagline: '他生来就该站在最前面。',
    tone: '霸气、笃定、略带不屑',
  },
  specialist: {
    id: 'specialist',
    cn: '极致',
    motif: '偏科 · 极致',
    color: '#4aa3ff',
    glow: 'rgba(74,163,255,0.30)',
    tagline: '别的我不管，这一项无人能及。',
    tone: '冷静、理性、专注',
  },
  lateBloomer: {
    id: 'lateBloomer',
    cn: '无界',
    motif: '破界 · 无界膨胀',
    color: '#ff6b9d',
    glow: 'rgba(255,107,157,0.34)',
    tagline: '他还远没到头——你以为这是极限？',
    tone: '沉默倔强，越成长越平静、越压迫',
  },
};

// FNV-1a 哈希 → 种子，让同一份副本（uid）永远拿到同一原型，跨会话稳定
function seedFromUid(uid?: string, id?: string): number {
  const s = uid ?? id ?? '';
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

// 由 uid 确定性派生成长原型（34% / 33% / 33%，不依赖战斗结算）
export function archetypeOf(hero: Pick<HeroDef, 'uid' | 'id'>): GrowthArchetype {
  const r = mulberry32(seedFromUid(hero.uid, hero.id))();
  if (r < 0.34) return 'prodigy';
  if (r < 0.67) return 'specialist';
  return 'lateBloomer';
}

// 风格化声纹：原型 × 个体 的组合台词（确定性，纯展示，给角色「声纹」）
const VOICE: Record<GrowthArchetype, string[]> = {
  prodigy: ['敌人还没看清，已经结束了。', '让我上，其余人看着就行。', '胜利从来不需要商量。'],
  specialist: ['数据不会说谎，弱点暴露了。', '把一件事做到极致，就够了。', '多余的动作，都是浪费。'],
  lateBloomer: ['现在笑还太早。', '我只是在等一个起点。', '你以为这是极限？'],
};

export function personaVoice(hero: Pick<HeroDef, 'uid' | 'id'>): string {
  const pool = VOICE[archetypeOf(hero)];
  const r = mulberry32(seedFromUid(hero.uid, hero.id) ^ 0x5bd1e995)();
  return pool[Math.floor(r * pool.length)];
}

// 晚成型「无界膨胀」——render-only 体型成长倍率（绝不动战斗 bodyType / hitRadius，零 parity 风险）。
// level 越高缩放越强，封顶 1.6，营造「永远在长、没有上限」的压迫感。
export function lateBloomerScale(level: number): number {
  if (level <= 1) return 1;
  return Math.min(1.6, 1 + Math.min(0.6, (level - 1) * 0.012));
}

// ─────────────────────────────────────────────────────────────
// 成长自我选择（方案 §2.2 / §2.4）：角色有意志，每 2 层 + Boss 层主动提出成长方向，
// 玩家拍板。原型决定「他能长成什么」（期望 + 风格），随机只作用于具体选项与幅度。
// 写入已有的 HeroGrowth（由 makeAlly::applyGrowthPct 应用），真实影响战力，零 core 改动。
// ─────────────────────────────────────────────────────────────
import type { PrimaryAttrs, GrowthStatKey, HeroGrowth } from '@arena/core/types';
import { PRIMARY_KEYS, GROWTH_STAT_KEYS } from '@arena/core/types';
import { bossTierAt } from '@arena/core/engine/scaling';
import type { GameMode } from '@arena/core/types';

export interface GrowthOption {
  id: string;
  label: string;     // 成长方向名（如「破界·初醒」）
  line: string;      // 角色台词（带意志）
  primary?: Partial<PrimaryAttrs>;             // 核心属性增益（con/str/agi/int）
  secondaryPct?: Partial<Record<GrowthStatKey, number>>; // 二级属性增益（hp/pDmg/mDmg/heal）
  tags: string[];     // 风格标签（用于传记展示）
}

// 三原型各一套成长方向池。选项虽少但覆盖攻/守/技/续，原型决定调性。
const POOL: Record<GrowthArchetype, GrowthOption[]> = {
  prodigy: [
    { id: 'p_feng', label: '王气·锋芒', line: '既然要赢，就要赢得漂亮。', primary: { str: 3 }, tags: ['攻', '天选'] },
    { id: 'p_sheng', label: '圣体·不衰', line: '我的身体，就是答案。', secondaryPct: { hp: 4 }, tags: ['守', '天选'] },
    { id: 'p_tong', label: '神识·通明', line: '看穿你，只用一瞬。', primary: { int: 3 }, tags: ['技', '天选'] },
    { id: 'p_xian', label: '捷影·先机', line: '比你快，比你想得快。', primary: { agi: 3 }, tags: ['敏', '天选'] },
    { id: 'p_ya', label: '霸者·压制', line: '在我的领域，无人能越。', secondaryPct: { pDmg: 3 }, tags: ['攻', '天选'] },
    { id: 'p_hu', label: '天命·庇护', line: '命不该绝的人，自然有人护。', secondaryPct: { heal: 3 }, tags: ['续', '天选'] },
  ],
  specialist: [
    { id: 's_zhuan', label: '一念·专精', line: '把一件事，做到极致。', primary: { str: 5 }, tags: ['攻', '偏科'] },
    { id: 's_tie', label: '铁壁·独尊', line: '我的防御，就是进攻。', secondaryPct: { hp: 6 }, tags: ['守', '偏科'] },
    { id: 's_rui', label: '锐锋·极致', line: '多余的动作，都是浪费。', secondaryPct: { pDmg: 6 }, tags: ['攻', '偏科'] },
    { id: 's_xuan', label: '玄术·归一', line: '术法一道，我已通明。', secondaryPct: { mDmg: 6 }, tags: ['术', '偏科'] },
    { id: 's_xu', label: '续命·不息', line: '只要还有一口气，就治得回来。', secondaryPct: { heal: 6 }, tags: ['续', '偏科'] },
    { id: 's_ji', label: '机变·极致', line: '快到你看不见，就是极致。', primary: { agi: 5 }, tags: ['敏', '偏科'] },
  ],
  lateBloomer: [
    { id: 'l_zhe', label: '蛰伏·蓄势', line: '现在笑还太早。', primary: { con: 2 }, tags: ['守', '破界'] },
    { id: 'l_po', label: '破界·初醒', line: '我只是在等一个起点。', primary: { str: 2 }, tags: ['攻', '破界'] },
    { id: 'l_qian', label: '潜龙·在渊', line: '你以为这是极限？', primary: { int: 2 }, tags: ['术', '破界'] },
    { id: 'l_hou', label: '厚积·薄发', line: '每一次跌倒，都是积累。', secondaryPct: { hp: 3 }, tags: ['守', '破界'] },
    { id: 'l_nu', label: '怒涛·渐起', line: '潮水，才刚涨起来。', secondaryPct: { pDmg: 3 }, tags: ['攻', '破界'] },
    { id: 'l_mian', label: '绵长·不绝', line: '越往后，我越不会倒。', secondaryPct: { heal: 3 }, tags: ['续', '破界'] },
  ],
};

// 原型成长乘子（无界膨胀的核心数值）。晚型随存活层递增，封顶 ×2；
// 早熟初期强但乘子低（0.85）；专精居中（1.0）。让「前期拖后腿、后期反超」真实成立。
export function growthMultiplier(arch: GrowthArchetype, layer: number): number {
  if (arch === 'lateBloomer') return 1 + Math.min(1.0, layer / 40); // L1=1 → L40+=2
  if (arch === 'prodigy') return 0.85;
  return 1.0;
}

// 把选项基增益按原型乘子放大，得到实际写入 HeroGrowth 的增量（确定性，乘子仅取决于原型+层）
export function scaleGrowthOption(opt: GrowthOption, arch: GrowthArchetype, layer: number): HeroGrowth {
  const m = growthMultiplier(arch, layer);
  const primary: Partial<PrimaryAttrs> = {};
  for (const k of PRIMARY_KEYS) {
    const v = opt.primary?.[k];
    if (v) primary[k] = Math.round(v * m * 100) / 100;
  }
  const secondaryPct: Partial<Record<GrowthStatKey, number>> = {};
  for (const k of GROWTH_STAT_KEYS) {
    const v = opt.secondaryPct?.[k];
    if (v) secondaryPct[k] = Math.round(v * m * 100) / 100;
  }
  return { primary, secondaryPct };
}

// 由 uid + layer 确定性派生「本层该角色提出的成长方向」（同层同角色稳定，换层变化）
export function rollGrowthOption(hero: Pick<HeroDef, 'uid' | 'id'>, layer: number): GrowthOption {
  const arch = archetypeOf(hero);
  const pool = POOL[arch];
  const r = mulberry32((seedFromUid(hero.uid, hero.id) ^ (layer * 2654435761)) >>> 0)();
  return pool[Math.floor(r * pool.length) % pool.length];
}

// 触发判定：每 2 层 + Boss 层必触发（方案 §2.2）。Boss 层用 core 的 bossTierAt 同源判定，保证前后端一致。
export function shouldOfferGrowth(layer: number, mode: GameMode): boolean {
  if (layer % 2 === 0) return true;
  return bossTierAt(layer, mode) !== undefined;
}

// 一次成长抉择的持久化记录（用于传记「意志履历」展示）
export interface GrowthChoiceRecord {
  uid: string;
  layer: number;
  optionId: string;
  label: string;
  archetype: GrowthArchetype;
  tags: string[];
}
