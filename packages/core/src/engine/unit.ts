// 单位创建（开发 §5.2/§5.3）
import {
  HeroDef, EnemyDef, Unit, PrimaryAttrs, DerivedAttrs, Equipment, BodyType, AffixKey,
  HeroGrowth, GrowthStatKey, MountKind, MountRarity, Gender,
} from '../types';
import { derive } from './formulas';
import {
  SUBCLASS_INFO, BODY_INFO, hitRadiusOf, starMult, starGrowthBonus,
  skillPowerMult, skillStarCdr,
} from '../content/classes';
import { eqStarMult } from '../content/equipment';
import { applyTraitStatic } from '../content/traits';
import { dominantPrimary, BURST_MULT } from '../content/consumables';
import { MOUNTS, MOUNT_RARITY } from '../content/mounts';

let uid = 0;
export const nextId = () => `u${uid++}`;
/**
 * 把单位 id 计数器归零。**仅供"一次战斗构建"的同步作用域调用**（见 backend/rules.runBattle）。
 *
 * 为什么必须有：单位 id 会进入回放校验和。若沿用进程级递增值，同一 seed 在
 * 「刚启动的客户端」和「已经打了 50 场的服务端」会得到不同的 id（u0.. vs u250..），
 * checksum 直接漂移——PoC 实测就是这么翻车的：同种子跨后端实例结果不一致。
 * JS 单线程内"重置 → 构建 → 开打"是一段不可中断的同步代码，故此处安全。
 * （阶段 1 抽 @arena/core 时会改为注入式 IdGen，彻底消灭模块级可变状态。）
 */
export const resetUid = (n = 0) => { uid = n; };

// 装备词条并到二级属性（装备与经济设计 §2/§3）。软上限防极端值破坏模拟。
// v1.6：区分白值与百分比两个结算区——先把所有 flat 加完，再统一乘 pct。
// 顺序不能反：若边加边乘，装备的穿戴顺序会影响最终数值，那是隐蔽且难查的 bug。
const clampE = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export function applyEquipment(base: DerivedAttrs, eqs: Equipment[]): DerivedAttrs {
  const d: DerivedAttrs = { ...base };
  const pctAcc: Partial<Record<AffixKey, number>> = {};
  // v2.9.3 通用红装同款加成：同 family 件数 N → 该款每件词条 ×(1+5%N)，封顶 5 件 25%
  const famCount = new Map<string, number>();
  for (const eq of eqs) {
    if (eq.family) famCount.set(eq.family, (famCount.get(eq.family) ?? 0) + 1);
  }
  const famMult = new Map<string, number>();
  for (const [fam, n] of famCount) famMult.set(fam, 1 + 0.05 * Math.min(5, n));
  for (const eq of eqs) {
    const sm = eqStarMult(eq); // 红装星级整体放大词条（附录 A.5.2）
    const fm = eq.family ? (famMult.get(eq.family) ?? 1) : 1;
    for (const a of eq.affixes) {
      const v = a.value * sm * fm;
      if (a.mode === 'pct') pctAcc[a.key] = (pctAcc[a.key] ?? 0) + v;
      else d[a.key] += v;
    }
  }
  for (const [k, v] of Object.entries(pctAcc) as [AffixKey, number][]) {
    d[k] = d[k] * (1 + v / 100);
  }
  d.hp = Math.round(d.hp);
  d.pDmg = Math.round(d.pDmg);
  d.mDmg = Math.round(d.mDmg);
  d.dodge = clampE(d.dodge, 0, 90);
  d.moveSpeed = clampE(d.moveSpeed, 0, 80);
  d.crit = clampE(d.crit, 0, 90);
  d.atkSpeed = clampE(d.atkSpeed, 0, 250);
  return d;
}

// 一级属性 = (基础 × 星级乘子 + (成长 + 星级成长加成) × 层数) × (1 + 突破%)（需求 §5.3 / 附录 A.6）
// 星级作用在一级属性上，让它穿透整条转化链自然放大所有二级属性——
// 若直接乘二级属性会出现「升星加了血却没加暴击」的割裂感。
function primaryAtLevel(
  base: PrimaryAttrs, growth: PrimaryAttrs, level: number, star = 1,
  bonusPct?: Partial<PrimaryAttrs>,
): PrimaryAttrs {
  const lv = level - 1;
  const sm = starMult(star);
  const gb = starGrowthBonus(star);
  const bp = (k: keyof PrimaryAttrs) => 1 + (bonusPct?.[k] ?? 0) / 100;
  return {
    con: (base.con * sm + (growth.con + gb) * lv) * bp('con'),
    str: (base.str * sm + (growth.str + gb) * lv) * bp('str'),
    agi: (base.agi * sm + (growth.agi + gb) * lv) * bp('agi'),
    int: (base.int * sm + (growth.int + gb) * lv) * bp('int'),
  };
}

// 体型系数作用在二级属性上（需求 §5.3）：只改 HP / 移速 / 攻速 / 闪避 / 体积，
// 绝不改伤害与射程——放到一级属性上会连带加物理伤害，破坏「体型不改伤害」红线。
// 攻速基准 = 体型修正后的值（B_as）：下游装备/坐骑/天气的攻速加成都叠加在这之上。
export function applyBody(d: DerivedAttrs, body: BodyType): DerivedAttrs {
  const b = BODY_INFO[body];
  return {
    ...d,
    hp: Math.round(d.hp * b.hpMult),
    moveSpeed: d.moveSpeed * b.msMult,
    atkSpeed: d.atkSpeed * b.asMult,
    dodge: Math.max(0, Math.min(75, d.dodge + b.dodgeBonus)),
  };
}

// v2.8 性别属性修正（用户需求：女攻速/暴击更高，男爆伤/生命更高）。
// 位置与 applyBody 并列（个体底色区）：修正量直接落在二级属性上，
// 攻速/暴击/爆伤都是百分点，hp 是百分比倍率，全乘区可叠加不破坏平衡。
// 女：攻速 +8%、暴击 +5%；男：爆伤 +25%、生命 ×1.08。
export function applyGender(d: DerivedAttrs, g?: Gender): DerivedAttrs {
  if (g === 'female') {
    return {
      ...d,
      atkSpeed: clampE(d.atkSpeed + 8, 0, 250),
      crit: clampE(d.crit + 5, 0, 90),
    };
  }
  if (g === 'male') {
    return {
      ...d,
      critDmg: d.critDmg + 25,
      hp: Math.round(d.hp * 1.08),
    };
  }
  return d;
}

// v2.8 性别解析：显式 gender 优先；缺省时按「模板名 + 子类」哈希确定性回退。
// 关键：绝不使用递增的 uid——那会让 smoke 两次回放的同一模板得到不同性别，破坏确定性。
const hashStr = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
};
export const genderOf = (def?: Gender, key?: string): Gender =>
  def ?? ((hashStr(key ?? '') & 1) === 0 ? 'female' : 'male');

// ── v2.9 轻击/重击参数（确定性派生）────────────────────────────────
// 每个单位按「模板名+子类」哈希派生一套轻/重击节奏：
//   轻击攻速 130~161（每秒 1.3~1.6 次）；重击攻速 26~57（每秒 0.26~0.57 次，
//   驱动重击序列后的休息期 ≈1.8~3.8s）；每 3~8 次轻击触发 1~2 次重击。
// 与 genderOf 同约束：绝不用递增 uid 做哈希源，否则 smoke 回放分叉。
export interface CombatParams {
  lightAs: number;         // 轻击攻速（攻速数值，100 = 每秒 1 次）
  heavyAs: number;         // 重击攻速（攻速数值）
  heavyAt: number;         // 轻击触发重击的阈值（3~8）
  heavyBurstCount: number; // 每轮重击序列次数（1~2）
}
export const combatParamsOf = (key?: string): CombatParams => {
  const h = hashStr(key ?? '');
  return {
    lightAs: 130 + (h & 31),          // 130~161
    heavyAs: 26 + ((h >>> 5) & 31),   // 26~57
    heavyAt: 3 + ((h >>> 10) % 6),    // 3~8
    heavyBurstCount: 1 + ((h >>> 16) & 1), // 1~2
  };
};

// v1.7 §2：永久成长的二级属性区。
// 位置刻意排在装备之后、特性之前——成长是「这一份角色自己练出来的」，
// 应当吃到装备白值的收益（练得越久，装备越值钱），但不该被特性天赋再放大一轮。
export function applyGrowthPct(d: DerivedAttrs, g?: HeroGrowth): DerivedAttrs {
  const pct = g?.secondaryPct;
  if (!pct) return d;
  const out: DerivedAttrs = { ...d };
  for (const [k, v] of Object.entries(pct) as [GrowthStatKey, number][]) {
    if (!v) continue;
    out[k] = out[k] * (1 + v / 100);
  }
  out.hp = Math.round(out.hp);
  out.pDmg = Math.round(out.pDmg);
  out.mDmg = Math.round(out.mDmg);
  return out;
}

// v2.6 §2 骑乘加成（坐骑常驻属性区）
// 位置：排在特性之后、作为**最后一个乘区**。理由是坐骑是 5★ 才解锁的终局资源，
// 它应当吃到前面全部投入（装备/成长/特性）的收益——那正是「练到 5★」的回报。
// 但百分比项一律用软上限收口，避免赤兔（+30 移速 +12 攻速）叠满装备后
// 出现「移速拉满、全场没人能碰到他」的退化局面。
export function applyMount(d: DerivedAttrs, kind?: MountKind, rarity?: MountRarity): DerivedAttrs {
  if (!kind) return d;
  const r = MOUNTS[kind].ride;
  // v2.9.3 坐骑品质乘子：蓝 ×1.0 / 橙 ×1.5 / 紫 ×2.2（ride 加成整体缩放）
  const m = rarity ? MOUNT_RARITY[rarity].mult : 1;
  const out: DerivedAttrs = { ...d };
  if (r.hpPct) out.hp = Math.round(out.hp * (1 + r.hpPct * m));
  if (r.pDmgPct) out.pDmg = Math.round(out.pDmg * (1 + r.pDmgPct * m));
  if (r.moveSpeedAdd) out.moveSpeed = clampE(out.moveSpeed + r.moveSpeedAdd * m, 0, 95);
  if (r.atkSpeedAdd) out.atkSpeed = clampE(out.atkSpeed + r.atkSpeedAdd * m, 0, 260);
  if (r.critAdd) out.crit = clampE(out.crit + r.critAdd * m, 0, 92);
  if (r.pResistAdd) out.pResist = clampE(out.pResist + r.pResistAdd * m, 0, 80);
  if (r.dodgeAdd) out.dodge = clampE(out.dodge + r.dodgeAdd * m, 0, 90);
  return out;
}

/**
 * v3.1 显示名 = 个体姓名。
 *
 * 旧版是「职业称号 + 罗马数字」（铁壁镇守 II / III）。那套编号在部署页与战报里
 * 反复出现，把三个属性、体型、性别都不同的角色写成了同一个人的三份拷贝，
 * 既不好看，也和 variant.ts 的个体化设计互相拆台。
 * 现在每份副本自带姓名（variateHero 生成），职业称号退居为身份标签单独展示。
 * personalName 缺失时（旧存档 / 未个体化的模板）回退到称号，不再追加任何后缀。
 */
export const displayName = (hero: { name: string; personalName?: string }) =>
  hero.personalName || hero.name;

export interface AllyOpts {
  /** v1.7 §4：爆发药剂生效中——主属性 ×1.5，仅本场 */
  burst?: boolean;
}

export function makeAlly(
  hero: HeroDef, level: number, equipment: Equipment[] = [], opts: AllyOpts = {},
): Unit {
  const star = hero.star ?? 1;
  const bodyType = hero.bodyType ?? SUBCLASS_INFO[hero.subclass].defaultBody;
  const gender = genderOf(hero.gender, hero.name + hero.subclass);
  const primary = primaryAtLevel(hero.basePrimary, hero.growth, level, star, hero.bonusPct);

  // v1.7 §2：击杀 / 成长药剂累积的核心属性白值。
  // 放在突破百分比之外做纯加法——若让它吃 bonusPct 的乘区，
  // 五星突破角色的每次击杀收益会随突破层数无限放大，形成正反馈失控。
  const gp = hero.growthBonus?.primary;
  if (gp) {
    for (const k of ['con', 'str', 'agi', 'int'] as (keyof PrimaryAttrs)[]) {
      primary[k] += gp[k] ?? 0;
    }
  }

  // v1.7 §4：爆发药剂只增强「主属性」（基础核心属性最高的那一项），
  // 作用在一级属性上，于是它自然穿透整条转化链——
  // 力量型吃到的是伤害，强壮型吃到的是血量，同一瓶药对不同职业给出不同答案。
  if (opts.burst) {
    const k = dominantPrimary(hero.basePrimary);
    primary[k] *= BURST_MULT;
  }

  // v2.9.3 专属红装：穿戴本职业专属 → 主属性独立提升 20%（作用在一级属性，穿透整条链）
  // + 大招冷却缩减 10% + (星-1)×5%，封顶 45%
  let skillCdr = 0;
  for (const eq of equipment) {
    if (eq.special === hero.subclass) {
      const k = dominantPrimary(hero.basePrimary);
      primary[k] *= 1.2;
      skillCdr = Math.min(0.45, 0.10 + ((eq.star ?? 1) - 1) * 0.05);
      break;
    }
  }
  // v3.1 升星强化签名技：星级冷却缩减与装备缩减相加后统一封顶 55%。
  // 封顶必须做在合并之后——分别封顶会让「5★角色 + 5★专属」拿到 45%+16%=61%，
  // 大招循环快到能盖住整局节奏
  const totalSkillCdr = Math.min(0.55, skillCdr + skillStarCdr(star));

  // v1.6：特性静态加成排在装备与体型之后——它是角色的「天赋底色」，
  // 不该被装备的百分比乘区放大，否则堆装会让特性差异指数级膨胀。
  // v2.8：性别修正与体型并列（个体底色区），排在成长/坐骑之前。
  const derived: DerivedAttrs = applyMount(
    applyTraitStatic(
      applyGrowthPct(applyGender(applyBody(applyEquipment(derive(primary), equipment), bodyType), gender), hero.growthBonus),
      hero.traitId,
    ),
    hero.mount,
    hero.mountRarity,
  );
  // v3.0 双坦：普攻改为「守御」附加伤害，蓄力更重，基础攻速 -10%。
  if (hero.subclass === 'physTank' || hero.subclass === 'magicTank') {
    derived.atkSpeed *= 0.9;
  }
  // v2.6 §2：坐骑技能是**独立 CD**，与角色技能互不占用。
  // 开场给 40% CD 起手（不是 0）：满 CD 开局会让五只坐骑在第一秒同时放大招，
  // 一场战斗最精彩的瞬间不该发生在玩家还没看清场面的时候。
  const mountSkill = hero.mount ? MOUNTS[hero.mount].skill : undefined;
  return {
    id: nextId(),
    side: 'ally',
    mount: hero.mount,
    mountRarity: hero.mountRarity, // v2.9.3 坐骑品质（渲染光环 + 面板展示）
    mountSkill,
    mountCd: mountSkill ? mountSkill.cd * 0.4 : undefined,
    name: displayName(hero),
    title: hero.name, // v3.1 职业称号（战斗 HUD / 战报里与姓名成对展示）
    personality: hero.personality, // v3.1 性格 → battle.ts::acquireTarget 索敌偏好
    category: hero.category,
    subclass: hero.subclass,
    damageType: SUBCLASS_INFO[hero.subclass].damageType,
    x: 0, y: 0,
    hp: derived.hp, maxHp: derived.hp,
    primary, derived,
    cd: 0, skill: hero.skill, skillCd: 0,
    alive: true, shield: 0, rootUntil: 0, stunUntil: 0, tauntUntil: 0,
    dmgMult: 1, level, flash: 0,
    bodyType, gender, hitRadius: hitRadiusOf(bodyType),
    star, dupIndex: hero.dupIndex ?? 1,
    traitId: hero.traitId, traitStacks: 0, traitTimer: 0,
    heroUid: hero.uid, // v1.7 §2：击杀成长的记账凭据
    // v2.9 轻/重击节奏（确定性派生，不消耗战斗随机流）
    // 第三参数只对我方治疗职业开：敌方邪术祭司走原随机节奏，不吃这套治疗定档
    ...initCombat(
      genderOf(hero.gender, hero.name + hero.subclass),
      hero.name + hero.subclass,
      hero.subclass === 'healer',
    ),
    // v2.9.3 基础移速（衰减基准）：agi 派生 × 体型乘子（装备/坐骑/天气是"加成"不算基础）
    baseMove: derive(primary).moveSpeed * BODY_INFO[bodyType].msMult,
    // v2.9.3 专属红装 + v3.1 星级冷却缩减（合并后封顶 0.55）
    skillCdr: totalSkillCdr > 0 ? totalSkillCdr : undefined,
    // v3.1 升星强化签名技：技能等级 = 星级，效果 +18%/星
    skillPower: skillPowerMult(star),
  };
}

// v2.9.9 我方治疗职业的节奏定档（不走哈希随机）。
// 理由：她的「重击」是全队唯一的常规治疗来源，治疗间隔不能交给 heavyAt 3~8 的随机派生——
// 实测 heavyAt=8 的治疗者在 5 秒短局里一次都奶不出来（队伍掉到 24% 血仍零治疗）。
// 定档目标：治疗间隔 ≈ 3 拍轻击(~2.1s) + 休息期(~1.0s) ≈ 3s 一次，
// 5 秒的局能奶 1~2 次、10 秒的局能奶 3~4 次——足以救场，又远达不到"每拍都奶"的常驻泵。
// [PLACEHOLDER · 验证路径：smoke 断言「掉血局中有治疗的比例 ≥90%」与「伤害占比 <15%」]
const HEALER_RHYTHM = {
  heavyAt: 3,          // 每 3 次轻击触发一次群疗（原随机 3~8）
  heavyBurstCount: 2,  // 群疗连打 2 拍：把"奶到了"做成一个能看见的双段事件
  heavyAs: 70,         // 休息期 = 攻击间隔 × 100/70 ≈ 1.43×（原 26~57 档 → 1.8~3.8×）
};

// v2.9：从 CombatParams 写 Unit 的攻击节奏字段（combo 从 0 开始，首轮先打轻击）
const initCombat = (g: Gender, key: string, healRhythm = false) => {
  const base = combatParamsOf(key + ':' + g);
  const p = healRhythm ? { ...base, ...HEALER_RHYTHM } : base;
  return {
    // 治疗职业 combo 预充满：进入射程的第一拍就是群疗。
    // 与女娲「开局立即造化」同构——开场即有可见的职业身份表达；
    // 满血开场时这一拍经「恩泽」转成全队护盾，提前量变成资源而不是空放。
    combo: healRhythm ? p.heavyAt : 0,
    heavyAt: p.heavyAt, heavyBurst: p.heavyBurstCount, heavyBurstCount: p.heavyBurstCount,
    heavyLock: 0, lightAs: p.lightAs, heavyAs: p.heavyAs, heavyArmorUntil: 0, isHeavyHit: false,
    heavyReady: false,
  };
};

export function makeEnemy(enemy: EnemyDef, level: number, scaleHp: number, scaleDmg: number): Unit {
  const bodyType = enemy.bodyType ?? SUBCLASS_INFO[enemy.subclass].defaultBody;
  const gender = genderOf(enemy.gender, enemy.name + enemy.subclass);
  const primary = primaryAtLevel(enemy.basePrimary, { con: 1, str: 1, agi: 1, int: 1 }, level);
  const derived: DerivedAttrs = applyGender(applyBody(derive(primary), bodyType), gender);
  derived.hp = Math.round(derived.hp * scaleHp);
  const maxHp = derived.hp;
  return {
    id: nextId(),
    side: 'enemy',
    name: enemy.name,
    category: enemy.category,
    subclass: enemy.subclass,
    damageType: enemy.skill ? SUBCLASS_INFO[enemy.subclass].damageType : 'physical',
    x: 0, y: 0,
    hp: maxHp, maxHp,
    primary, derived,
    cd: 0, skill: enemy.skill ?? { id: 'none', name: '普攻', cd: 0, damageType: 'physical', desc: '' },
    skillCd: 0,
    alive: true, shield: 0, rootUntil: 0, stunUntil: 0, tauntUntil: 0,
    dmgMult: scaleDmg, level,
    isBoss: enemy.isBoss, flash: 0,
    bodyType, gender, hitRadius: hitRadiusOf(bodyType) * (enemy.isBoss ? 1.6 : 1),
    monsterKind: enemy.monsterKind, // v2.5：西方怪物皮，驱动独立精灵模板
    // v2.9 轻/重击节奏（确定性派生）
    ...initCombat(gender, enemy.name + enemy.subclass),
    // v2.9.3 基础移速（衰减基准）
    baseMove: derive(primary).moveSpeed * BODY_INFO[bodyType].msMult,
  };
}
