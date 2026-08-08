// 4 大类 9 子类元数据（需求 5.2；美术 §1/§4）+ 体型系统（需求 v1.4 §5.2.1）
import { ClassCategory, SubClass, DamageType, BodyType } from '../types';

export interface SubClassInfo {
  category: ClassCategory;
  name: string;
  cn: string;
  damageType: DamageType;
  attackRange: number; // 单位：tile
  color: string;  // 主色
  color2: string; // 辅色
  defaultBody: BodyType; // v1.4：子类默认体型（HeroDef.bodyType 可覆盖）
}

// v2.5 中国风子类命名 + 配色（与 skills.ts 的 SKILL_VFX 签名色对齐，服装与技能同色系）
export const SUBCLASS_INFO: Record<SubClass, SubClassInfo> = {
  physTank:   { category: 'tank',    name: 'physTank',   cn: '玄武前排',  damageType: 'physical', attackRange: 1.1, color: '#5a7bd6', color2: '#c9d4ff', defaultBody: 'colossal' },
  magicTank:  { category: 'tank',    name: 'magicTank',  cn: '符甲战将',  damageType: 'magic',    attackRange: 1.1, color: '#b06bff', color2: '#e0c9ff', defaultBody: 'heavy' },
  charge:     { category: 'warrior', name: 'charge',     cn: '突袭战士',  damageType: 'physical', attackRange: 2.5, color: '#ff4d3d', color2: '#ffd9b0', defaultBody: 'heavy' },
  hexblade:   { category: 'warrior', name: 'hexblade',   cn: '无名剑客',  damageType: 'hybrid',  attackRange: 3.0, color: '#cfe3ff', color2: '#eaf3ff', defaultBody: 'light' },
  gunner:     { category: 'archer',  name: 'gunner',     cn: '神机炮兵',  damageType: 'physical', attackRange: 5.0, color: '#ff9a3c', color2: '#ffd9a8', defaultBody: 'heavy' },
  sniper:     { category: 'archer',  name: 'sniper',     cn: '神射手',    damageType: 'physical', attackRange: 6.5, color: '#ffd84a', color2: '#fff2c9', defaultBody: 'light' },
  controller: { category: 'mage',    name: 'controller', cn: '太极术师',  damageType: 'magic',    attackRange: 6.0, color: '#7fe0d8', color2: '#d6fffb', defaultBody: 'medium' },
  summoner:   { category: 'mage',    name: 'summoner',  cn: '化生术师',  damageType: 'magic',    attackRange: 5.0, color: '#c79a5a', color2: '#e8d3ad', defaultBody: 'medium' },
  healer:     { category: 'mage',    name: 'healer',    cn: '回春医官',  damageType: 'magic',    attackRange: 5.0, color: '#4fd982', color2: '#d6ffe6', defaultBody: 'petite' },
};

export const ALL_SUBCLASSES: SubClass[] = Object.keys(SUBCLASS_INFO) as SubClass[];

// ── 体型规格表（需求 v1.4 §5.2.1 / 美术 §4.5）──
// 设计约束：hpMult 与 msMult 严格互逆（生存 ↔ 机动单轴权衡）；
// sizeMult 同时驱动像素渲染边长与受击半径（视觉即判定，不做欺骗性碰撞盒）；
// dodgeBonus 压在 ±6% 以内（防止小体型叠敏捷免疫远程）。
export interface BodyInfo {
  id: BodyType;
  cn: string;
  hpMult: number;     // B_hp
  msMult: number;     // B_ms
  asMult: number;     // B_as：攻速乘子 = 0.25 + 0.75×msMult（身材变化下半身>上肢，攻速只吃移速变化的75%；攻速基准=体型修正后）
  sizeMult: number;   // B_size：受击半径 + 像素缩放
  dodgeBonus: number; // B_dod（百分点）
  renderPx: number;   // 渲染边长（取偶数，避免像素糊边。基准 medium=34 = 26×1.3）
  outline: number;    // 描边宽度（px）
  trailFrames: number;// 移动残影帧数（速度的视觉编码）
  shadow: boolean;    // 脚下投影（重量暗示，仅巨躯）
  trait: string;      // 体型特性名
  traitDesc: string;
}

export const BASE_BODY_SCALE = 1.3;

// v2.8：体型谱系扩为 10 档（用户需求：从瘦小到肥胖、从侏儒到巨大、从敏捷到慢动作）。
// 排序按 sizeMult 降序：giant > titan > obese > colossal > heavy > medium > light > slim > petite > gnome。
// 设计约束不变：hpMult 与 msMult 严格互逆（生存 ↔ 机动单轴权衡）；
// dodgeBonus 压在 ±7% 以内（gnome 突破原 ±6% 上限一档，对应最极端的敏捷谱）。
export const BODY_INFO: Record<BodyType, BodyInfo> = {
  giant:    { id: 'giant',    cn: '巨灵', hpMult: 2.60, msMult: 0.42, asMult: 0.565, sizeMult: 2.10, dodgeBonus: -10, renderPx: 70, outline: 3, trailFrames: 0, shadow: true,  trait: '巨压', traitDesc: '免疫击退/禁锢；周围友军受到的击退 −50%；基础攻击不可被闪避' },
  titan:    { id: 'titan',    cn: '泰坦', hpMult: 2.20, msMult: 0.50, asMult: 0.625, sizeMult: 1.85, dodgeBonus: -8,  renderPx: 62, outline: 3, trailFrames: 0, shadow: true,  trait: '碾压', traitDesc: '免疫击退/禁锢；周围友军受到的击退 −50%；体型即压迫' },
  obese:    { id: 'obese',    cn: '肥胖', hpMult: 1.65, msMult: 0.65, asMult: 0.738, sizeMult: 1.55, dodgeBonus: -5,  renderPx: 54, outline: 2, trailFrames: 0, shadow: true,  trait: '厚皮', traitDesc: '受击退距离 −50%；受到的治疗效果 +15%' },
  colossal: { id: 'colossal', cn: '巨躯', hpMult: 1.50, msMult: 0.67, asMult: 0.753, sizeMult: 1.45, dodgeBonus: -6,  renderPx: 50, outline: 2, trailFrames: 0, shadow: true,  trait: '压迫', traitDesc: '免疫击退；周围友军受到的击退 −50%' },
  heavy:    { id: 'heavy',    cn: '魁梧', hpMult: 1.20, msMult: 0.83, asMult: 0.873, sizeMult: 1.18, dodgeBonus: -3,  renderPx: 40, outline: 2, trailFrames: 0, shadow: false, trait: '稳桩', traitDesc: '单次受伤≥15%最大HP时，1.5s内减伤10%' },
  medium:   { id: 'medium',   cn: '标准', hpMult: 1.00, msMult: 1.00, asMult: 1.000, sizeMult: 1.00, dodgeBonus: 0,   renderPx: 34, outline: 1, trailFrames: 0, shadow: false, trait: '通用', traitDesc: '无修正（所有系数的调参锚点）' },
  light:    { id: 'light',    cn: '轻捷', hpMult: 0.83, msMult: 1.20, asMult: 1.150, sizeMult: 0.82, dodgeBonus: 3,   renderPx: 28, outline: 1, trailFrames: 1, shadow: false, trait: '滑步', traitDesc: '闪避成功后 0.8s 内移速 +20%' },
  slim:     { id: 'slim',     cn: '瘦小', hpMult: 0.78, msMult: 1.28, asMult: 1.210, sizeMult: 0.78, dodgeBonus: 4,   renderPx: 26, outline: 1, trailFrames: 1, shadow: false, trait: '灵巧', traitDesc: '闪避成功后 0.8s 内移速 +25%（滑步进阶）；受击半径更小' },
  petite:   { id: 'petite',   cn: '精巧', hpMult: 0.67, msMult: 1.50, asMult: 1.375, sizeMult: 0.70, dodgeBonus: 6,   renderPx: 24, outline: 1, trailFrames: 2, shadow: false, trait: '难瞄', traitDesc: '距攻击者≥4格时，受到的远程伤害 −8%' },
  gnome:    { id: 'gnome',    cn: '侏儒', hpMult: 0.58, msMult: 1.72, asMult: 1.540, sizeMult: 0.60, dodgeBonus: 7,   renderPx: 20, outline: 1, trailFrames: 2, shadow: false, trait: '极难瞄', traitDesc: '距攻击者≥4格时，受到的远程伤害 −12%' },
};

export const ALL_BODY_TYPES: BodyType[] = Object.keys(BODY_INFO) as BodyType[];

// 受击半径（世界格）：需求 §5.3 公式 R_hit = 0.42 × B_size
export const hitRadiusOf = (b: BodyType) => 0.42 * BASE_BODY_SCALE * BODY_INFO[b].sizeMult;

// 星级属性乘子：需求 §5.3 S_attr = 1 + 0.18 × (star − 1)，作用在一级属性上
export const starMult = (star = 1) => 1 + 0.18 * (Math.max(1, Math.min(5, star)) - 1);
// 星级成长加成：growth + 1 / 星（深层拉开差距的关键，比 0.18 重要）
export const starGrowthBonus = (star = 1) => Math.max(1, Math.min(5, star)) - 1;

// ── v3.1 升星强化签名技 ──
// 旧版升星只放大一级属性，签名技的倍率写死在 battle.ts 里，
// 于是「1★ 和 5★ 的大招长得一模一样」——玩家的直观感受就是「技能一开始就满级」。
// 现在把「技能等级 = 星级」落成真实数值：
//   · 技能效果（伤害/护盾/治疗/召唤物强度）+18%/星，与一级属性同节奏，读数直观
//   · 技能冷却 −4%/星（5★ −16%），封顶由 unit.ts 与装备缩减合并后统一压在 55%
// 之所以复用 0.18 这个系数：升星的收益曲线应当只有一条，
// 两条不同斜率的曲线会让玩家算不清"这一星到底值不值"。
export const skillLevelOf = (star = 1) => Math.max(1, Math.min(5, Math.round(star)));
export const skillPowerMult = (star = 1) => 1 + 0.18 * (skillLevelOf(star) - 1);
export const skillStarCdr = (star = 1) => 0.04 * (skillLevelOf(star) - 1);
