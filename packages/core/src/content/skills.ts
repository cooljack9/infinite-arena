// 职业技能定义（美术 §7.1；需求 5.2/§5.4）
// v1.4：每个技能追加 skillStyle（动作语言）与 castRange（施法距离，格）。
// castRange 同时驱动逻辑判定与特效尺寸——逻辑和视觉共用同一个数，
// 顺带杜绝「策划改了射程但美术特效没跟着改」的经典 bug。
// v1.5：在 skillStyle 之上挂「技能签名系统」——颜色跟技能走，叠加尺寸与运动，
// 让同一子类的不同技能一眼可分（详见美术 §7.3⑤）。
import { SkillDef, SubClass, RangeTier, SkillStyle, VfxMotion } from '../types';

// v1.5 全局放大系数（美术 §7.3⑤）：所有技能特效半径在 v1.4 距离驱动之上再 ×1.85，
// 这是「更明显」的硬指标。尺寸一律 = castRange × TILE × VFX_SCALE × sizeMul。
// v2.3 从 1.4 → 1.5：配合 titan Boss 的更大施法范围，整体特效存在感进一步拉满。
// v2.8 从 1.5 → 1.85：用户反馈技能特效太弱，全局放大系数上调。
export const VFX_SCALE = 1.85;

// 技能签名表（美术 §7.3⑤）：每个 skillStyle 绑定一套签名（色 + 尺寸倍率 + 签名运动）。
// 无论谁放，同一技能颜色恒定——叠加形状与运动形成三重识别。
export interface SkillVfx {
  color: string;     // 签名色（跟技能走，不跟施法者）
  sizeMul: number;   // 尺寸倍率（在 VFX_SCALE 之上再乘）
  motion: VfxMotion; // 签名运动
}

// v2.5 中国风配色：射日金 / 青囊绿 / 太极玉 / 抟土泥绿 / 关公赤 / 剑客霜白 / 神机铜光
export const SKILL_VFX: Record<SkillStyle, SkillVfx> = {
  bulwark_taunt:     { color: '#4d7cff', sizeMul: 1.45, motion: 'expand_ring' },
  bulwark_shield:    { color: '#b06bff', sizeMul: 1.20, motion: 'shield_pulse' },
  charge_dash:       { color: '#ff4d3d', sizeMul: 1.35, motion: 'charge_wedge' },
  melee_burst:       { color: '#cfe3ff', sizeMul: 1.50, motion: 'nova_spin' },
  projectile_volley: { color: '#ffae3d', sizeMul: 1.30, motion: 'volley_scatter' },
  precision_beam:    { color: '#ffcf4d', sizeMul: 1.20, motion: 'beam_split' },
  zone_control:      { color: '#7fe0d8', sizeMul: 1.45, motion: 'taiji_spin' },
  summon_rift:       { color: '#c79a5a', sizeMul: 1.35, motion: 'rift_tear' },
  blessing_field:    { color: '#4fd982', sizeMul: 1.45, motion: 'blessing_vine' },
};

// Boss 覆盖色（u.isBoss 时强制换成压迫感配色，与友方同名技能区分，美术 §7.3⑤）：
// 玩家已经用 9 个签名技学会了这套视觉词汇，Boss 复用等于认知直接迁移；
// Boss 的压迫感该来自数值和尺寸，不该来自玩家看不懂的新颜色。
export const BOSS_VFX_OVERRIDE: Record<string, { color: string; sizeMul: number }> = {
  boss_stomp:  { color: '#ff1f1f', sizeMul: 1.65 },  // v2.3 更红更大：践踏是 Boss 招牌，必须全场最炸
  boss_devour: { color: '#ff2e6a', sizeMul: 1.40 },  // 吞噬：品红深渊感，比 stom 更「邪」
  boss_split:  { color: '#ff3b3b', sizeMul: 1.55 },  // 分裂：裂痕红色，配合 colossal 分身
  m_dragon_skill:  { color: '#ff3b1f', sizeMul: 1.70 },  // v2.5 西方邪龙：焚世龙息，赤红灼烧感
  m_angel_skill:   { color: '#ffd23f', sizeMul: 1.45 },  // v2.5 堕天审判：审判金光，神圣而压迫
};

/** 取某技能的签名视觉（含 Boss 覆盖）。仅对真实技能调用（'none' 已被 short-circuit）。 */
export function vfxOf(skill: SkillDef, isBoss?: boolean): SkillVfx {
  const style = skill.skillStyle ?? 'melee_burst';
  const base = SKILL_VFX[style];
  if (isBoss && BOSS_VFX_OVERRIDE[skill.id]) {
    const o = BOSS_VFX_OVERRIDE[skill.id];
    return { color: o.color, sizeMul: o.sizeMul, motion: base.motion };
  }
  return base;
}

export const SKILLS: Record<string, SkillDef> = {
  taunt:     { id: 'taunt',     name: '镇岳怒吼', cd: 8,  damageType: 'physical', desc: '怒吼震慑 3 格内敌人 3 秒，自身减伤提升',        skillStyle: 'bulwark_taunt',     castRange: 3.0 },
  ward:      { id: 'ward',      name: '符甲护盾', cd: 10, damageType: 'magic',    desc: '凝符为甲，获得吸收护盾，反弹部分魔伤',          skillStyle: 'bulwark_shield',    castRange: 0 },
  charge:    { id: 'charge',    name: '偃月突斩', cd: 6,  damageType: 'physical', desc: '拖刀突进 6 格内最远敌人，250%物伤+晕1秒',     skillStyle: 'charge_dash',       castRange: 6.0 },
  hexburst:  { id: 'hexburst',  name: '无形剑罡', cd: 7,  damageType: 'hybrid',   desc: '周身 2.5 格 AoE 180%混伤，剑气无痕',           skillStyle: 'melee_burst',       castRange: 2.5 },
  barrage:   { id: 'barrage',   name: '神火霹雳', cd: 5,  damageType: 'physical', desc: '5 连射 80%物伤，命中 6 格内随机敌人',           skillStyle: 'projectile_volley', castRange: 6.0 },
  deadshot:  { id: 'deadshot',  name: '贯日神射', cd: 9,  damageType: 'physical', desc: '9 格内单体 400%物伤，蓄力贯日一击',           skillStyle: 'precision_beam',    castRange: 9.0 },
  timelock:  { id: 'timelock',  name: '太极封禁', cd: 12, damageType: 'magic',    desc: '太极八卦锁 6 格内敌人 2.5 秒 + 120%魔伤',      skillStyle: 'zone_control',      castRange: 6.0 },
  summon:    { id: 'summon',    name: '抟土化生', cd: 14, damageType: 'magic',    desc: '按战况捏出泥卫/藤甲仆/灵火童之一',            skillStyle: 'summon_rift',       castRange: 5.0 },
  groupheal: { id: 'groupheal', name: '青藤回春', cd: 10, damageType: 'magic',    desc: '治疗 5 格内队友 200%智力，青藤绕身回血',        skillStyle: 'blessing_field',    castRange: 5.0 },
  // Boss 技（美术 §7.2.1）：不新开风格枚举，从 9 种里复用。
  // 玩家已经用 9 个签名技学会了这套视觉词汇，Boss 复用等于认知直接迁移；
  // Boss 的压迫感该来自数值和尺寸，不该来自玩家看不懂。
  boss_stomp:  { id: 'boss_stomp',  name: '泰山压顶', cd: 8,  damageType: 'physical', desc: '3.5 格内 300%物伤 + 击退',  skillStyle: 'bulwark_taunt', castRange: 3.5 },
  boss_devour: { id: 'boss_devour', name: '噬魂', cd: 10, damageType: 'magic',    desc: '吸取 8 格内敌方 10%最大生命', skillStyle: 'zone_control',  castRange: 8.0 },
  boss_split:  { id: 'boss_split',  name: '裂魂分身', cd: 12, damageType: 'physical', desc: '回复 20% 生命并分裂出 2 个分身（8s）', skillStyle: 'summon_rift', castRange: 0 },
};

// 子类 → 签名技 id
export const SUBCLASS_SKILL: Record<SubClass, string> = {
  physTank: 'taunt', magicTank: 'ward',
  charge: 'charge', hexblade: 'hexburst',
  gunner: 'barrage', sniper: 'deadshot',
  controller: 'timelock', summoner: 'summon', healer: 'groupheal',
};

// ── 施法距离四档位（美术 §7.3.1 ③）──
// 档位决定命中反馈的动画语言，不是装饰性分类。
export function rangeTier(castRange = 0): RangeTier {
  if (castRange <= 1.5) return 'self';
  if (castRange <= 3.5) return 'short';
  if (castRange <= 6.5) return 'mid';
  return 'long';
}

// 各档位的特效总时长（秒）。数值来自美术 §7.3.1 ③ 的时间轴编排。
export const TIER_TTL: Record<RangeTier, number> = {
  self: 0.65,  // 内缩汇聚 → 成型过冲 → 脉动（加长，存在感更足）
  short: 0.62, // 顿地 → 瞬时外扩（无飞行段，近战爽感来自零延迟）
  mid: 0.85,   // 发射闪光 → 可见飞行体 → 落点小爆
  long: 1.10,  // 预警细线 0.22s → 瞬时激光 → 残线滞留更久
};

// long 档的预警线时长：先告知，再兑现。玩家在这 0.22s 里会屏息。
export const LONG_WARN_TIME = 0.22;

// mid 档飞行耗时随距离增长（美术 §7.3.1 ③）
export const midFlightTime = (castRange: number) => 0.15 + castRange * 0.025;

// beam 线宽由 castRange 推导——远程激光更粗更实（美术 §7.3.1 ②）
export const beamThickness = (castRange: number) => 3 + castRange * 0.45;
