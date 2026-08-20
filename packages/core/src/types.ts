// 全局类型定义（对应需求 5.2/5.3、开发 §5、美术 §4/§6）

export type ClassCategory = 'tank' | 'warrior' | 'archer' | 'mage';
export type SubClass =
  | 'physTank' | 'magicTank'
  | 'charge' | 'hexblade'
  | 'gunner' | 'sniper'
  | 'controller' | 'summoner' | 'healer';

// ── 西方怪物皮（v2.5 需求 #2）──
// 与英雄共用 SubClass 的「机制骨架」（攻速/射程/特性），但拥有独立像素模板与配色，
// 因此视觉上完全不像任何职业、也不同于红染的普通敌人。龙/堕天使为 Boss 体型。
export type MonsterKind =
  | 'dragon'        // 西方邪恶龙（强力 Boss，titan）
  | 'fallen_angel'  // 堕天使（普通 Boss，colossal）
  | 'witch'         // 女巫
  | 'demon'         // 地狱恶魔
  | 'skeleton'      // 骷髅兵
  | 'gargoyle'      // 石像鬼
  | 'demon_wolf'    // 恶魔狼（兽类：可获自爆/下一站/双免轮换随机特性）
  | 'fae_wolf'      // 精灵狼 / 灵狼（兽类：同上）
  | 'van'          // v2.9.x 面包车（cosplay 五菱宏光）：车队冲锋 + 开门下人
  | 'van_person';  // v2.9.x 面包人：从车里下来的乘员（独立皮 —— 与车共用贴图会让"下人"这一幕读作车裂开）

// v1.8.4 兽类怪物专属随机特性（生成时按位置确定性 roll，见 content/beast.ts）
export type BeastTraitId =
  | 'selfdestruct'  // 自爆：死亡时对周围 2 格造成 35% 最大生命真实伤害
  | 'nest'          // 下一站：入场 2 秒后产 3~6 只小个体（生命减半·体型小 40%·移速快 30%），小个体复仇优先攻击击杀母体者
  | 'immunity';     // 双免轮换：每 3 秒在物理免疫 / 魔法免疫之间切换

export type DamageType = 'physical' | 'magic' | 'hybrid';

// 性别（v2.8）：所有职业存在男女差异，影响派生属性
// —— 女性攻速/暴击更高，男性爆伤/生命更高（详见 unit.ts 的 applyGender）。
export type Gender = 'male' | 'female';

/**
 * 性格（v3.1）：体型之外的第二条个体差异线，只影响**索敌偏好**，不给数值加成。
 * valiant 不畏强暴（>80% 生命）/ hunter 猎手（最低生命）/ breaker 攻坚者（敌方前排）
 * / assassin 专业刺客（敌方后排）/ savior 救困扶危（敌方最强者）/ steady 随遇而安（就近）
 */
export type PersonalityId =
  | 'valiant' | 'hunter' | 'breaker' | 'assassin' | 'savior' | 'steady';

export interface PrimaryAttrs {
  con: number; // 强壮
  str: number; // 力量
  agi: number; // 敏捷
  int: number; // 智力
}

export interface BaseValues {
  hp: number; pDmg: number; mDmg: number;
  atkSpeed: number; crit: number; moveSpeed: number;
}

export interface DerivedAttrs {
  hp: number;
  pDmg: number;
  mDmg: number;
  atkSpeed: number; // %
  dodge: number;     // %
  moveSpeed: number; // %
  crit: number;      // %
  critDmg: number;   // %
  pResist: number;   // %
  mResist: number;   // %
  heal: number;
  regenPct?: number;     // v1.5：每秒回血比例（0–1），天气「丰茂」写入
  dmgTakenMult?: number; // v1.5：受伤乘子（默认 1），天气「圣光」写入 ×0.88
}

// ── 体型系统（需求 v1.4 §5.2.1；美术 §4.5）──
// 体型只管三件事：生存 / 机动 / 体积，外加一条体型特性。绝不改伤害与射程。
// v2.3：新增 titan 档（Boss 专属），体型秩序改为 titan > colossal > heavy > medium > light > petite
export type BodyType =
  | 'giant'    // 巨灵：比泰坦更庞大（v2.8 新增）
  | 'titan'    // 泰坦
  | 'obese'    // 肥胖：宽厚迟缓、生命极高（v2.8 新增）
  | 'colossal' // 巨躯
  | 'heavy'    // 魁梧
  | 'medium'   // 标准
  | 'light'    // 轻捷
  | 'slim'     // 瘦小：纤细灵动（v2.8 新增）
  | 'petite'   // 精巧
  | 'gnome';   // 侏儒：最矮小、体积最小（v2.8 新增）

// ── 技能风格与施法距离（需求 v1.4 §5.4；美术 §7.1/§7.3.1）──
export type SkillStyle =
  | 'bulwark_taunt' | 'bulwark_shield' | 'charge_dash' | 'melee_burst'
  | 'projectile_volley' | 'precision_beam' | 'zone_control'
  | 'summon_rift' | 'blessing_field'
  | 'van_ram'; // v2.9.x 面包车撞击：伤害 ≈ 物理攻击 × 移速，命中击退前排

// 施法距离四档位，决定命中反馈的动画语言（美术 §7.3.1 ③）
export type RangeTier = 'self' | 'short' | 'mid' | 'long';

// v1.5 技能签名运动（美术 §7.3⑤）：在形状之上叠加的「动的方式」，
// 让玩家靠运动差异也能区分技能，不必死盯颜色（静止截图读不出，实时战斗里是强信号）。
export type VfxMotion =
  | 'expand_ring'     // bulwark_taunt：扩张环 + 同心双环（嘲讽波）
  | 'shield_pulse'    // bulwark_shield：护罩脉动 + 过冲
  | 'charge_wedge'    // charge_dash：拖影 + 指向冲击楔
  | 'nova_spin'       // melee_burst：放射 nova 旋转
  | 'volley_scatter'  // projectile_volley：多发交错扫射（左右错相位）
  | 'beam_split'      // precision_beam：细长激光 + 命中碎裂粒子
  | 'cage_spin'       // zone_control：牢笼旋转 + 十字扫描
  | 'taiji_spin'     // v2.5 中国风：太极八卦阵旋转环（控制师「太极封禁」）
  | 'rift_tear'       // summon_rift：裂隙竖向撕裂（上下张开）
  | 'blessing_rise'  // blessing_field：上飘光点群（缓升淡出）
  | 'blessing_vine'; // v2.5 中国风：青囊树藤上攀（牧师「青囊回春」）

export interface SkillDef {
  id: string;
  name: string;
  cd: number;
  damageType: DamageType;
  desc: string;
  skillStyle?: SkillStyle; // v1.4：动作语言
  castRange?: number;      // v1.4：施法距离（格）。同时驱动逻辑判定与特效尺寸
}

// v1.6：角色特性 ID（附录 A.1）。特性不再是展示字符串，而是战斗引擎可读的枚举。
// vX（用户需求）：扩展 6 个「额外独立乘」特性——fury/heart/slowburn/spacetime/returner/grower。
//   所有特性在招募/开局时由 variateHero 从全池随机分配（见 variant.ts rollTrait）。
export type TraitId =
  | 'bulwark' | 'spellbreak' | 'momentum' | 'bloodedge' | 'volley'
  | 'lethal'  | 'shackle'    | 'legion'   | 'grace'
  | 'fury'    | 'heart'      | 'slowburn' | 'spacetime' | 'returner' | 'grower';

// ── v1.7 成长系统（需求 v1.7 §2）──
// 「可成长的二级属性」= DerivedAttrs 中**非百分比**的那几项。
// 百分比属性（攻速/暴击/闪避/减伤/移速/暴伤）被排除在外是刻意的：
// 它们本身就是乘区，再叠一层百分比成长会在高层数指数爆炸，且大多有软上限，
// 成长到顶后玩家的击杀收益会静默归零——那比「不给成长」更伤体验。
export type GrowthStatKey = 'hp' | 'pDmg' | 'mDmg' | 'heal';
export const GROWTH_STAT_KEYS: GrowthStatKey[] = ['hp', 'pDmg', 'mDmg', 'heal'];
export const PRIMARY_KEYS: (keyof PrimaryAttrs)[] = ['con', 'str', 'agi', 'int'];

/** 角色的永久成长累积（击杀成长 / 成长药剂共用同一个容器） */
export interface HeroGrowth {
  primary?: Partial<PrimaryAttrs>;                        // 核心属性白值累加
  secondaryPct?: Partial<Record<GrowthStatKey, number>>;  // 二级属性成长（百分点）
}

/** 一次成长结算的明细，用于战斗飘字与休整屏回执 */
export interface GrowthRoll {
  primaryKey: keyof PrimaryAttrs;
  primaryAdd: number;
  secondaryKey: GrowthStatKey;
  secondaryPct: number;
}

export interface HeroDef {
  id: string;
  name: string;
  category: ClassCategory;
  subclass: SubClass;
  basePrimary: PrimaryAttrs;
  /** vX 模板原始基础值（variateHero 个体化前的预设值）。用于「成长率 = 基础值 / 初始设定值」：
   *  同一模板不同副本基础值漂移 ±75% → 成长率落在 [25%,175%]，使基础值本身成为成长潜力判定。
   *  仅在首次个体化的模板上记录；已个体化副本保留原值（?? 回退），保证确定性回放兼容。 */
  templateBase?: PrimaryAttrs;
  growth: PrimaryAttrs;
  skill: SkillDef;
  trait?: string;
  traitId?: TraitId;   // v1.6：接入战斗引擎的特性
  bodyType?: BodyType; // v1.4：缺省时取子类默认体型
  gender?: Gender;     // v2.8：性别（variateHero 确定性随机；影响派生属性）
  star?: number;       // v1.4：星级 1–5，缺省 1
  /**
   * v1.4：同名多份的序号（1 起）。
   * v3.1 起不再驱动显示名——显示名走 personalName，这个字段仅保留用于内部统计与存档兼容。
   */
  dupIndex?: number;
  /**
   * v3.1：个体姓名（如「孙澜」），由 variateHero 按种子确定性生成，同队去重。
   * HeroDef.name 仍是职业称号（如「铁壁镇守」），两者在面板上成对展示。
   */
  personalName?: string;
  /**
   * v3.1：性格（索敌偏好）。与 bodyType/gender 一样由 variateHero 按种子确定性生成，
   * 是「这一份副本」的固有属性，不随升星/装备变化。
   */
  personality?: PersonalityId;
  // v1.6：五星后继续购买触发的属性突破累积（百分比，无上限；附录 A.6）
  bonusPct?: Partial<PrimaryAttrs>;
  // v2.6 §2：5★ 时随机获得的坐骑。写在 HeroDef 上而非 Unit 上，
  // 因为它必须跨层持久化——每场战斗重新随机一只坐骑等于没有坐骑。
  mount?: MountKind;
  mountRarity?: MountRarity; // v2.9.3 坐骑品质（蓝/橙/紫，面板可刷新召唤）
  // ── v1.7 §1：队伍成员实例唯一 id ──
  // 同一模板（id）现在允许上场多份，装备栏、成长、升星都必须按「这一份」来记账，
  // 因此队伍里的每个成员都持有 uid；HEROES 里的模板也带 uid（= 模板 id），
  // 但真正进队伍的副本会由 store 分配全新且唯一的 uid。
  uid: string;
  // v1.7 §2：永久成长累积（击杀 / 药剂）
  growthBonus?: HeroGrowth;
  // v1.7 §4：爆发药剂已对该副本生效，待下一场战斗开始时消耗
  pendingBurst?: boolean;
  // vX 英雄数值微调（按需求逐项百分比/百分点，作用于派生属性，仅本英雄生效）
  mods?: HeroStatMods;
  // vX 普攻伤害构成（物/法占比）；指定后覆盖默认的 hybrid=(p+m)/2 规则
  atkRatio?: { p: number; m: number };
}

// 英雄数值微调（集中管理，便于平衡调参；乘区语义，1.10 = +10%）
export interface HeroStatMods {
  hpMul?: number;        // 生命乘区，0.9 = -10%
  pDmgMul?: number;      // 物理攻击乘区，0.7 = -30%
  atkSpeedMul?: number;  // 攻速乘区，1.10 = +10%
  moveSpeedMul?: number; // 移速乘区，1.05 = +5%（与 atkSpeedMul 对称）
}

export interface EnemyDef {
  id: string;
  name: string;
  category: ClassCategory;
  subclass: SubClass;
  basePrimary: PrimaryAttrs;
  skill?: SkillDef;
  isBoss?: boolean;
  bodyType?: BodyType; // v2.3：Boss 体型档（titan）；缺省取子类默认体型
  gender?: Gender;     // v2.8：性别（无则按 id 哈希确定性回退）
  monsterKind?: MonsterKind; // v2.5：西方怪物皮（独立精灵模板，不走职业模板/红染）
  /** v1.8.4 兽类专属随机特性（buildWaves 按位置确定性注入，前后端一致） */
  beastTrait?: BeastTraitId;
}

export interface RelicDef {
  id: string;
  name: string;
  desc: string;
  mod?: Partial<Record<keyof DerivedAttrs, number>> & { dmgMult?: number; hpMult?: number };
}

export interface TalentDef {
  id: string;
  name: string;
  desc: string;
}

export type ArenaArchetype =
  | 'A1' | 'A3' | 'A6'
  | 'RIVER' | 'JIANGE' | 'DRAGON' | 'CAGE'
  | 'VAN'; // v2.9.x 面包车特殊关（cosplay 五菱宏光）：车队冲锋→开门逐人下落

// ── v2.2 模式（需求 §8：新手模式 / 普通无尽 / 铁人无尽）──
// 新手模式：有限战役（5 层 + 弹窗教学），通关后解锁两种无尽模式。
// 普通无尽：常规深塔（至 500 层登顶），战斗中阵亡的角色下一场自动复活。
// 铁人无尽：同深塔，但角色一旦在战斗中阵亡即永久消失（permadeath）。
export type GameMode = 'novice' | 'normal' | 'ironman';

// ── 地图主题皮（需求 v1.4 §4.4.8；美术 §3.4）──
// 主题与布局正交：布局管战术，主题管世界。6 主题 × 布局 = 低成本视觉多样性。
export type MapTheme = 'sandstone' | 'frost' | 'magma' | 'void' | 'verdant' | 'sanctum';

export interface ThemeInfo {
  id: MapTheme;
  cn: string;
  floorA: string;
  floorB: string;
  wall: string;
  prop: string;
  accent: string;
  particle: 'sand' | 'mist' | 'ember' | 'star' | 'leaf' | 'dust';
  outlineUnits?: boolean; // void 主题强制给单位加亮边（美术 §3.4.4）
}

// ── 环境天气与增益（需求 v1.5 §3.4.5；美术 §3.4.5）──
// 每个主题自带一套天气，给场上双方施加同一个增益（环境中性，不偏袒任一方）。
// 由主题推导（确定性，随层深循环），在战斗开始时写进双方派生属性，零运行时随机。
export type WeatherKind = 'sandstone' | 'frost' | 'magma' | 'void' | 'verdant' | 'sanctum';

export interface WeatherDef {
  kind: WeatherKind;
  cn: string;            // 中文名（横幅 / HUD 显示）
  icon: string;          // emoji 图标（HUD 小标签）
  moveSpeedAdd?: number; // 移速加成（百分点）：sandstone +10
  atkSpeedAdd?: number;  // 攻速加成（百分点，负 = 攻击间隔变长）：frost −12
  dmgMul?: number;       // 伤害乘子：magma ×1.12
  critAdd?: number;      // 暴击加成（百分点）：void +8
  regenPct?: number;     // 每秒回血比例（0–1）：verdant 0.012
  dmgTakenMul?: number;  // 受伤乘子：sanctum ×0.88（−12% 受伤）
}

export interface ArenaDef {
  id: ArenaArchetype;
  name: string;
  width: number;
  height: number;
  tiles: string[]; // 每行符号：#墙 .地 P掩体 S我方 E敌方 B Boss台 ~虚空
  theme?: MapTheme; // v1.4：按层深注入
  fade?: number;    // v1.4：循环褪色级数 cycle（0–4）
  weather?: WeatherDef; // v1.5：环境天气增益（由 withTheme 按主题自动挂上）
  /** 本层层号（由 withTheme 按层深注入）。反"堆一人"敌方针对被动按层调度需要它；
   *  缺省（老回放/单测直接用 ARENAS.x）视为 0 层 = 不触发，向后兼容。 */
  layer?: number;
  dragonNests?: number; // v2.9.3 疯狂龙巢：本图强制出现的恶龙巢/巢穴数量（3+），levelGen 布点
  hazardBase?: string;  // v2.9.3 '~' 危险地形底色（楚河汉界=水蓝 / 八角笼=岩浆红；默认虚空黑）
  hazardWave?: string;  // v2.9.3 '~' 波纹/熔光扫色（与 hazardBase 配套）
}

export type BattleEventType =
  | 'damage' | 'heal' | 'death' | 'projectile'
  | 'nova' | 'shield' | 'root' | 'summon' | 'text';

export interface Vec2 { x: number; y: number; }

export interface BattleEvent {
  type: BattleEventType;
  from?: Vec2;
  to?: Vec2;
  pos?: Vec2;
  color?: string;
  text?: string;
  crit?: boolean;
  amount?: number;
  id?: string;
}

export interface FloatText { x: number; y: number; text: string; color: string; ttl: number; }
export interface Projectile { x: number; y: number; tx: number; ty: number; color: string; ttl: number; prevX?: number; prevY?: number; heavy?: boolean; }

// 技能特效形状（需求 v1.3）：每个签名技绑定唯一几何形状，渲染按 shape 分支（美术 §7.3）
export type VfxShape =
  | 'ring' | 'bubble' | 'nova' | 'beam' | 'trail' | 'cage' | 'rift' | 'light' | 'shock'
  | 'blade' | 'sun' | 'quake'; // v2.9.3：通天刀/太阳爆闪/地震裂痕（镇岳怒吼·泰山压顶）

export interface Effect {
  shape: VfxShape;
  x: number; y: number;       // 世界格坐标（主锚点）
  tx?: number; ty?: number;  // beam/trail 的目标坐标
  r: number;                  // 基础半径（世界格），渲染时按进度扩展
  color: string;
  ttl: number;                // 剩余寿命（秒）
  maxTtl: number;             // 总寿命（用于计算动画进度）
  // ── v1.4 施法距离可视化（美术 §7.3.1）──
  dashed?: boolean;   // 起手距离环：虚线 = 范围提示，实线 = 实际效果
  alphaFrom?: number; // 起始透明度（缺省 1）
  alphaTo?: number;   // 结束透明度（缺省 0）
  tier?: RangeTier;   // 所属距离档位，驱动命中反馈分级
  thickness?: number; // beam 线宽（由 castRange 推导，禁止硬编码）
  delay?: number;     // 延迟出现（秒），用于 long 档的「预警→兑现」两段
  // ── v1.5 技能签名（美术 §7.3⑤）──
  motion?: VfxMotion; // 签名运动：drawEffect 据其做旋转/扫射等差异
  sizeMul?: number;   // 签名尺寸倍率：半径再 × VFX_SCALE × sizeMul（缺省 1）
}

export interface Unit {
  id: string;
  side: 'ally' | 'enemy';
  /** v3.1：显示名 = 个体姓名（我方）/ 怪物名（敌方）。不再带罗马数字后缀 */
  name: string;
  /** v3.1：职业称号（如「铁壁镇守」）。仅我方英雄有，用于姓名旁的身份标签 */
  title?: string;
  /** v3.1：性格（索敌偏好）。仅我方英雄有；召唤物/敌方按各自既有逻辑索敌 */
  personality?: PersonalityId;
  category: ClassCategory;
  subclass: SubClass;
  damageType: DamageType;
  // vX 普攻伤害构成（英雄级覆盖，详见 HeroDef.atkRatio）；存在时 basicAttack 据此混算物/法
  atkRatio?: { p: number; m: number };
  x: number;
  y: number;
  prevX?: number;  // 渲染插值：上一 tick 的 x（动画/位移解耦用，见 ArenaCanvas alpha）
  prevY?: number;  // 渲染插值：上一 tick 的 y
  hp: number;
  maxHp: number;
  primary: PrimaryAttrs;
  derived: DerivedAttrs;
  cd: number;
  skill: SkillDef;
  skillCd: number;
  targetId?: string;
  retargetAt?: number; // v2.9.5 重新索敌节流窗口（仅 this.time 门控，确定性安全）
  alive: boolean;
  /** v2.4.4 地块攻速乘子：站在水域(w)=0.88（攻速 −12%），其余 1 */
  tileSpdMul?: number;
  /** v2.4.4 地块受伤乘子：掩体(P)=0.85 / Boss 王座(B 且 isBoss)=0.80，其余 1 */
  tileDmgTaken?: number;
  /** v2.4.4 最近一次受击的伤害类型（渲染层按类型上色受击闪光，纯表现字段） */
  flashType?: DamageType;
  shield: number;
  rootUntil: number;
  stunUntil: number;
  tauntUntil: number;
  dmgMult: number;
  level: number;
  isBoss?: boolean;
  isSummon?: boolean;
  summonUntil?: number;
  flash: number; // 受击白闪计时
  // ── v1.4 ──
  bodyType: BodyType;      // 体型，驱动像素缩放 / 受击半径 / 体型特性
  gender: Gender;         // v2.8：性别（影响派生属性：女攻速/暴击↑，男爆伤/生命↑）
  hitRadius: number;       // 受击半径（世界格）= 0.42 × B_size
  star?: number;           // 星级（1–5）
  dupIndex?: number;       // 同名多份序号
  summonKind?: SummonKind; // 召唤物类型（仅 isSummon 时有值）
  summonTotal?: number;    // 召唤物总时长（用于 HUD 倒计时条）
  monsterKind?: MonsterKind; // v2.5：西方怪物皮（驱动 MONSTER_TEMPLATES 独立渲染）
  focusRole?: 'front' | 'back'; // 反堆一人·敌方针对最强被动标记（coherence.ts）
  /** 反堆一人·捆仙绳：被封印的另一方 unit.id（施法怪 ↔ 被锁英雄互指）。
   *  任一方死亡时在 killIfDown 里解除对方封印 —— 这就是「除非有人被击杀才解除」。 */
  shackleWith?: string;
  // 体型特性运行时状态
  braceUntil?: number;   // 魁梧「稳桩」减伤截止时刻
  glideUntil?: number;   // 轻捷「滑步」加速截止时刻
  lastDodgeAt?: number;  // 上次闪避成功时刻
  // ── v2.9 轻击/重击系统（确定性派生：同 key 同参数）──
  combo?: number;           // 自上次重击序列以来的轻击计数
  heavyAt?: number;         // 触发重击序列的轻击阈值（3~8）
  heavyBurst?: number;      // 当前重击序列剩余次数（1~2）
  heavyBurstCount?: number; // 每轮重击序列总数（1~2）
  heavyLock?: number;       // 重击序列结束后的休息截止时刻（≈1.8~3.8s）
  lightAs?: number;         // 轻击攻速（130~161 = 每秒 1.3~1.6 次）
  heavyAs?: number;         // 重击攻速（26~57 = 每秒 0.26~0.57 次，驱动重击休息期）
  heavyArmorUntil?: number; // 重击霸体截止（期间免疫被推开）
  isHeavyHit?: boolean;     // 最近一次普攻是否重击（渲染层读：重击动画/弹道）
  heavyReady?: boolean;     // v2.9.1：下次普攻将是重击（渲染层画蓄力预警金光圈）
  kdUntil?: number;         // 被击倒截止时刻（近战重击击倒）
  baseMove?: number;        // v2.9.3：单位基础移速（无装备/坐骑/天气，移速衰减阈值基准）
  // ── v1.6 角色特性运行时状态（附录 A.1）──
  traitId?: TraitId;      // 绑定的特性
  traitStacks?: number;   // 通用叠层计数（势能层数 / 速射层数 / 受击次数）
  lifestealStacks?: number; // v3.0 势能·技能吸血层数（普攻叠层，脱战每秒衰减 1 层）
  traitTimer?: number;    // 通用计时器（预留：层数衰减）
  lastHitTargetId?: string; // volley：上一次攻击的目标（换目标清零）
  lastBasicAt?: number;     // v3.0 势能·脱战计时：上一次普攻时刻（驱动技能吸血衰减）
  slowUntil?: number;      // shackle：减速截止时刻
  slowPct?: number;        // shackle：减速幅度（百分点）
  ccColor?: string;        // v2.9.3：当前控制/减速效果的来源色（渲染层画腿部持续光，直到控制消失）
  // ── vX 新增 6 特性·运行时状态 ──
  sizeScale?: number;      // 体型连续缩放（×命中半径/渲染格；默认 1）。成长者开局 0.7、归来者复活 ×1.3
  rangeBonus?: number;     // 射程附加值（格），归来者复活 +2
  heartTim?: number;       // 大心脏：4s 窗口计时
  heartLoss?: number;      // 大心脏：窗口内累计受伤
  slowTim?: number;        // 慢热型：每秒全属性 +2% 的累加计时
  stTim?: number;          // 时空拓印：3s 受伤窗口计时
  stLoss?: number;         // 时空拓印：窗口内累计受伤
  stCdUntil?: number;      // 时空拓印：瞬移冷却截止（>= this.time 不可再瞬移）
  returnerUsed?: number;   // 归来者：本场已复活次数（封顶 1）
  returnerDrain?: boolean; // 归来者：复活后每秒流失 8% 生命
  // ── v1.8.4 兽类专属特性运行时状态 ──
  beastTrait?: BeastTraitId; // 兽类专属特性（自爆/下一站/双免轮换）
  immunityPhase?: number;    // immunity：0=无免疫 1=物理免疫 2=魔法免疫（每 3 秒切换）
  isBeastling?: boolean;     // nest：小个体标记（复仇索敌 + 渲染缩放）
  parentId?: string;         // nest：小个体的母体 id
  vengeTargetId?: string;    // nest：小个体复仇目标（击杀母体者的 unit.id；母体存活时为空）
  nestDone?: boolean;        // nest：母体是否已产过仔
  // ── v1.7 §2 ──
  // 指回队伍成员实例。击杀成长必须落到「哪一份」角色身上，
  // 而 Unit.id 每场战斗都会重新生成，无法跨层记账，所以单独存 uid。
  heroUid?: string;
  // v2.9.8 召唤物反查主人：女娲的召唤物要能把「普攻降 CD / 击杀触发大招」记回本体，
  // 但召唤物自身没有 heroUid（不参与击杀成长记账），所以单独存主人的 heroUid。
  casterHeroUid?: string;
  // ── v2.6 §2 坐骑 ──
  mount?: MountKind;   // 5★ 解锁的坐骑；有值即渲染坐骑并启用坐骑技能
  mountRarity?: MountRarity; // v2.9.3 坐骑品质（蓝/橙/紫，ride 加成乘子 1/1.5/2.2）
  mountCd?: number;    // 坐骑技能剩余 CD（与 skillCd 完全独立）
  mountSkill?: SkillDef;
  skillCdr?: number;   // v2.9.3 专属红装 + v3.1 星级合并后的大招冷却缩减（封顶 55%）
  /**
   * v3.1 签名技效果乘子（技能等级 = 星级，+18%/星）。
   * 作用于签名技的伤害 / 护盾 / 治疗 / 召唤物强度，不作用于普攻与坐骑技——
   * 坐骑有自己的品质乘子，两套乘区叠在一起会让 5★ 紫骑变成无法平衡的双重指数。
   */
  skillPower?: number;
  // ── v2.6 §2 动作状态（渲染层读取，全部由 BattleSim 确定性写入）──
  // 不放在渲染层自己推算：渲染帧率不固定，靠帧间差分算出来的"是否在移动"
  // 会在低帧率下抖动，而且回放时和实况对不上。
  facing?: 1 | -1;        // 朝向：1 右 / -1 左
  attackAnimAt?: number;  // 上次普攻时刻（驱动出手前压 + 收势）
  castAnimAt?: number;    // 上次施法时刻（驱动起手上浮）
  moveAnimUntil?: number; // 移动动作持续到的时刻（驱动步态摆动）
  // ── v2.7 动作系统：尸体窗口 ──
  // 死亡时刻（引擎在 killIfDown 写入）。死亡单位在 units 中保留 CORPSE_TTL 秒，
  // alive=false 且 deadAt 已置：渲染层据 age 播「倒下→渐隐」；索敌/攻击已全部按 alive 过滤，尸体不参与战斗。
  deadAt?: number;
  // ── v2.6 §3 建筑 ──
  isBuilding?: boolean;
  buildingKind?: BuildingKind;
  spawnTimer?: number;    // 距下次产兵的秒数
  spawnedTotal?: number;  // 本场已产出总数（对齐 BuildingDef.spawn.cap）
  // ── v2.9.6 战后评价统计（确定性累计，仅作展示/奖励，不回写战斗逻辑）──
  dmgDealt?: number;      // 本场造成的总伤害
  dmgTaken?: number;      // 本场承受的总伤害
  healDone?: number;      // 本场造成的总治疗
  moveDist?: number;      // 本场累计移动距离（世界格）
  // ── v2.9.6 龙吐息（重做）：元素 + 状态效果 ──
  dragonElement?: 'fire' | 'ice' | 'poison'; // 龙的属性（火/冰/毒），仅龙类单位有值
  burnUntil?: number;     // 灼烧 DoT 截止时刻（火龙吐息）
  burnDps?: number;       // 灼烧每秒伤害（占最大生命比例，0~1）
  poisonUntil?: number;   // 剧毒截止时刻（毒龙吐息，每秒 5% 最大生命）
  freezeUntil?: number;   // 冰冻截止时刻（冰龙吐息，期间不可行动，等同定身）
  // ── v2.9.x 面包车特殊关·运行时状态 ──
  vanBuffUntil?: number;  // 面包车开场移速翻倍截止时刻（期间 derived.moveSpeed ×2）
  vanRamDone?: boolean;   // 面包车是否已撞击过（撞击后切「开门」状态，开始逐人下落）
  vanDropTimer?: number;  // 下一辆面包车距下次下落一人的秒数
  vanDropLeft?: number;   // 该面包车剩余可下落的面包人数
}

// ── v2.9.6 战后评价：单角色统计行 + 评价屏快照 ──
// 仅作展示 / MVP 奖励记账，不回写任何战斗逻辑（确定性安全）。
export interface BattleStatRow {
  id: string;
  side: 'ally' | 'enemy';
  name: string;
  dmgDealt: number;      // 造成伤害
  dmgTaken: number;      // 承受伤害
  healDone: number;      // 治疗量
  moveDist: number;      // 移动距离（世界格）
  heroUid?: string;      // 仅友方角色有值，用于 MVP 成长写回
}

export interface BattleEvalState {
  rows: BattleStatRow[];
  winner: 'win' | 'lose';
  currentLayer: number;  // 刚打完的层
  nextLayer: number;     // 下一层（win 且未封顶时有意义）
  cap: number;           // 本模式封顶层
  mvpUid: string | null;        // MVP 友方 heroUid
  mvpStat: keyof PrimaryAttrs | null; // 随机奖励的一级属性
  mvpAdd: number;               // 奖励数值（1 点）
}

// ── v2.6 §2 坐骑系统（五星解锁）──
// 角色升到 5★ 时随机获得一只坐骑，此后常驻上马状态。
// 坐骑做两件事，且只做这两件：
//   ① 骑乘加成（ride）——常驻改派生属性，体现「这匹畜生本身的物理特性」；
//   ② 坐骑技能（skill）——独立 CD，与角色本身的技能互不占用、互不打断。
// 刻意不做「上下马」状态机：自动战斗里玩家不操作单位，一个玩家无法干预的状态机
// 只会制造无法归因的随机性，那是噪声不是深度。
export type MountKind =
  | 'elephant'  // 大象·战象
  | 'leopard'   // 豹子·玄豹
  | 'tiger'     // 老虎·白额虎
  | 'redhare'   // 赤兔
  | 'ox';       // 牛·蛮牛

// v2.9.3 坐骑品质：蓝/橙/紫（ride 加成乘子 1.0 / 1.5 / 2.2，无升级系统，面板可刷新召唤）
export type MountRarity = 'blue' | 'orange' | 'purple';

export interface MountDef {
  kind: MountKind;
  name: string;   // 坐骑名（战象 / 玄豹 / 白额虎 / 赤兔 / 蛮牛）
  desc: string;   // 图鉴描述
  /** 骑乘常驻加成：上马即写入派生属性，永久生效 */
  ride: {
    hpPct?: number;         // 生命 %（乘算）
    pDmgPct?: number;       // 物伤 %
    moveSpeedAdd?: number;  // 移速百分点
    atkSpeedAdd?: number;   // 攻速百分点
    critAdd?: number;       // 暴击百分点
    pResistAdd?: number;    // 物抗百分点
    dodgeAdd?: number;      // 闪避百分点
  };
  /** 坐骑技能（独立 CD，走 BattleSim.castMountSkill） */
  skill: SkillDef;
  /** 像素配色：主色 / 暗部 / 点缀（鬃毛、纹路、鞍鞯） */
  body: string;
  dark: string;
  accent: string;
}

// ── v2.6 §3 敌方补给建筑（地图随机生成）──
// 建筑是「不会动、但会源源不断产出威胁」的敌方单位。它的战术意义在于：
// 玩家必须在「先拆建筑」与「先打主力」之间做取舍——拆得太晚会被小兵淹没，
// 冲得太早会一头撞进塔的火力圈加驻守小兵。这才是「合理站位拆除，否则风险大」。
export type BuildingKind =
  | 'barracks'     // 营房：持续产普通小兵，全场累计上限 8
  | 'tower_wood'   // 木塔：低血低伤，驻守 1 兵
  | 'tower_rock'   // 岩石塔：中血中伤，驻守 1~2 兵
  | 'tower_iron'   // 铁塔：高血高伤，驻守 2 兵
  | 'dragon_nest'  // 恶龙巢：产幼龙（Boss 幼体），上限 3
  | 'dragon_lair'; // 恶龙巢穴：额外 1 条成年龙 + 4 条幼龙

/** 建筑产出的单位类型 */
export type BuildingSpawnKind = 'soldier' | 'whelp' | 'adult_dragon';

export interface BuildingDef {
  kind: BuildingKind;
  name: string;
  desc: string;
  /** 基准生命（再按层深 scaleHp 放大） */
  hp: number;
  bodyType: BodyType;
  /** 塔类攻击：营房 / 巢穴不攻击，字段留空 */
  atk?: number;
  range?: number;
  atkInterval?: number;
  /** 产兵配置：不产兵的建筑留空 */
  spawn?: {
    kind: BuildingSpawnKind;
    /** 开场立即产出的数量（塔上驻守兵 / 巢穴里已成形的龙） */
    initial: number;
    /** 后续每隔多少秒产 1 个；<=0 表示只产 initial 那一批 */
    interval: number;
    /** 本场累计产出上限（含 initial） */
    cap: number;
  };
  /** 出现的最低层数 —— 恶龙巢穴不该在第 3 层就砸脸 */
  minLayer: number;
  /** 随机权重 */
  weight: number;
  /** 威胁提示（战前情报面板 / 战斗日志） */
  threat: string;
  color: string;
  dark: string;
  accent: string;
  /**
   * 建筑产出物**始终无特性**（v2.9.x 需求 #4「箭塔…无特性」）。
   *
   * 刻意不在这里挂 traits 字段：`spawnFromBuilding` 只按 `SPAWN_TEMPLATES` 造单位、
   * 不调 `rollTrait`——建筑产兵走的是和兽类特性池完全独立的线。塔就是"路边可拆的
   * 骚扰"，不是需要专门应对的火力点（那是恶龙巢的事）。任何把特性塞进建筑产兵的
   * 改动，都会违反这条设计意图，先回来改这里和 spawnFromBuilding，再动数值。
   */
  // 注：历史上这里有过 `traits?: TraitId[]`，但从未被引擎消费，且与"无特性"约束
  // 自相矛盾，已于 v2.9.x 删除。不要为了"看起来完整"把它加回来。
}

/** 建筑在地图上的落点（由 levelGen 确定性生成） */
export interface BuildingPlacement {
  kind: BuildingKind;
  pos: Vec2;
}

// ── 召唤师三类召唤物（需求 v1.4 §5.2.2；美术 §7.4）──
export type SummonKind = 'bulwark' | 'sprinter' | 'arcanist';

export interface SummonTemplate {
  kind: SummonKind;
  name: string;
  bodyType: BodyType;
  hpRatio: number;    // × 召唤者 INT
  atkRatio: number;   // × 召唤者 INT
  moveMult: number;   // × 基准移速
  range: number;      // 攻击射程（格）
  duration: number;   // 持续（秒）
  color: string;
  riftColor: string;
  riftW: number;      // 裂隙宽（px）
  riftH: number;      // 裂隙高（px）
  spawnAnim: number;  // 出场动画时长（秒）
  logReason: string;  // 战斗日志理由（自动战斗必须可播报）
}

// ── 装备与经济（需求 5.6/5.7；装备与经济设计 §2/§3）──
export type Rarity = 'normal' | 'blue' | 'orange' | 'red';

// AffixKey 与 DerivedAttrs 的字段名一一对应（便于 applyEquipment 直接累加）
export type AffixKey =
  | 'pDmg' | 'mDmg' | 'hp' | 'atkSpeed' | 'crit' | 'critDmg'
  | 'pResist' | 'mResist' | 'moveSpeed' | 'dodge' | 'heal';

// v1.6：词条区分「白值(flat)」与「百分比(pct)」两种模式（附录 A.4）。
// flat 可无限叠加同名条目并累加数值；pct 每种 key 只允许存在一条（取最大值）。
export type AffixMode = 'flat' | 'pct';

export interface Affix { key: AffixKey; value: number; mode?: AffixMode; }

export interface Equipment {
  id: string;
  name: string;
  rarity: Rarity;
  affixes: Affix[];
  opened: boolean;   // 是否已开箱（未开启时 UI 显示「?」）
  basePrice: number; // 品质基准价（普通30/蓝120/橙400/红1200）
  star?: number;     // v1.6：红装星级 1–5，词条整体 ×(1+0.25×(star-1))（附录 A.5）
  special?: SubClass; // v2.9.3 专属红装：穿戴者职业匹配时触发专属特效（主属性+20%、大招CDR）
  family?: string;    // v2.9.3 通用红装系列：同款 N 件每件词条 ×(1+5%N)，封顶 5 件 25%
}

// ── v1.7 §3 宝箱（需求 v1.7 §3）──
// 箱子不再等价于「一件装备」，而是一次掉落表抽取的结果：可能是装备，也可能是金钱。
// 因此 pendingDrops 的元素类型从 Equipment 升级为 Chest——
// 若继续复用 Equipment 并用特殊字段冒充金钱，背包/锻造/合成的每个过滤器都要加特判，
// 那是典型的「用错的类型换一时省事」。
export type ChestReward =
  | 'equip_normal'  // 40% 普通装备
  | 'gold_small'    // 20% 少量金钱
  | 'equip_high'    // 20% 高级装备
  | 'equip_rare'    // 10% 稀有装备
  | 'gold_large';   // 10% 大量金钱

export interface Chest {
  id: string;
  reward: ChestReward;
  equipment?: Equipment; // reward 为 equip_* 时有值
  gold?: number;         // reward 为 gold_* 时有值
}

// ── v1.7 §4 一次性物品（需求 v1.7 §4）──
export type ConsumableKind = 'growth' | 'burst';

export interface ConsumableItem {
  id: string;
  kind: ConsumableKind;
  name: string;
  desc: string;
  basePrice: number;
}

export interface LayerPlan {
  layer: number;
  arena: ArenaDef;
  waves: EnemyDef[][];
  isVacuum: boolean;
  isMutation: boolean;
  mutationRule?: string;
  encounterBudget: number;
  spawnAlly: Vec2[];
  spawnEnemy: Vec2[];
  bossPos?: Vec2;
  /** v2.4 Boss 分级：'strong' = titan 强力 Boss（每 5 关），'normal' = colossal 普通 Boss（每 3 关） */
  bossTier?: 'strong' | 'normal';
  /** 精英 Boss 层（每 10 层）：强力 Boss 的强化变体，战前/战斗中给出醒目提示 */
  eliteBoss?: boolean;
  /** 本层随机奇遇事件（进入战前布阵时出现的二选一/三选一抉择） */
  randomEvent?: RandomEvent;
  /** v2.6 §3：本层随机生成的敌方补给建筑（含落点） */
  buildings: BuildingPlacement[];
  /** v2.9.x 面包车特殊关：本层若有，则开场车队冲锋 → 开门逐人下落（见 coherence/battle） */
  vanEncounter?: VanEncounter;
}

/**
 * 面包车特殊关配置（cosplay 五菱宏光）。
 * 设计（需求原文）：开场 4~8 辆面包车组成车队撞向前排（击退阵型），
 * 撞击完毕后开门，每辆车逐个下落 4~10 个面包人（属性 = 车 1/2，移速 +30%、攻速 +50%）。
 * 面包车专属：开场 10s 移速翻倍，撞击伤害 ≈ 物理攻击 × 移速（开场快威胁大、后续明显下降）。
 */
export interface VanEncounter {
  /** 车队规模（4~8） */
  vanCount: number;
  /** 每辆车的面包人数量（4~10） */
  peoplePerVan: number;
  /** 面包车基础属性（随层深 scaleHp/scaleAtk 放大） */
  vanBasePrimary: PrimaryAttrs;
  /** 面包人属性 = 车基础 × 此乘子（0.5） */
  personPrimaryMul: number;
  /** 面包人移速加成（百分点，+30） */
  personMoveSpeedAdd: number;
  /** 面包人攻速加成（百分点，+50） */
  personAtkSpeedAdd: number;
  /** 开场移速翻倍持续秒数（10） */
  openingBuffSec: number;
  /** 逐人下落间隔（秒）：一个个下来，不是同帧爆兵 */
  dropInterval: number;
  /** 同屏面包人上限：超出则下人排队等空位（帧率优先于观感） */
  concurrentPeopleCap: number;
}

// ── 随机奇遇事件（需求：随机事件；战前布阵出现的抉择，确定性生成）──
// 每个选项的效果在生成时即由种子确定，玩家选择后由 store.resolveRandomEvent 结算。
export interface EventEffect {
  /** 金币增减（可为负） */
  gold?: number;
  /** 获得装备：指定品质与数量（确定性生成） */
  give?: { rarity: Rarity; count: number };
  /** 献祭背包评分最低的一件装备 */
  sacrificeLowest?: boolean;
  /** 积分增减 */
  score?: number;
}

export interface EventOption {
  label: string;
  desc: string;
  effect: EventEffect;
}

export interface RandomEvent {
  id: string;
  title: string;
  desc: string;
  /** 选项；最后一个通常为「离开 / 不触发」 */
  options: EventOption[];
}

export interface RunState {
  /** 权威对局 id（云端模式写命令必带；本地模式由 startRun 生成） */
  runId: string;
  layer: number;
  team: HeroDef[];
  relics: RelicDef[];
  score: number;
  seed: number;
  mode: GameMode;      // v2.2：本局模式（新手 / 普通无尽 / 铁人无尽）
  failures: number;    // v2.4：本局已用掉的失败次数（允许失败 2 次，第 3 次才真正结束）
  // 注：随机奇遇的「已结算层」记在 store 顶层的 resolvedEvents（与 fusedThisLayer 等局内计数同级）。
}

// ── 音频事件（音频设计文档 §3/§4；开发 §5）──
// 纯数据：仿真只生产 cue（push 到数组），由渲染层在 tick 外消费。
// 绝不反向 import 音频模块，故对确定性零影响。
export type AudioEventId =
  // 界面（2D，居中）
  | 'ui_click' | 'ui_open' | 'ui_error' | 'ui_purchase'
  // 战斗反馈（世界空间，按 x 声像）
  | 'hit_melee' | 'hit_ranged' | 'crit' | 'hit_heavy' | 'dodge' | 'heal' | 'shield_up'
  | 'death_ally' | 'death_enemy' | 'summon_spawn' | 'summon_expire'
  // 技能起手/结算（世界空间）
  | 'cast_generic'
  | 'cast_taunt' | 'cast_ward' | 'cast_charge' | 'cast_hexburst'
  | 'cast_barrage' | 'cast_deadshot_warn' | 'cast_deadshot_fire'
  | 'cast_timelock' | 'cast_summon' | 'cast_groupheal'
  | 'cast_boss_stomp' | 'cast_boss_devour_warn' | 'cast_boss_devour' | 'cast_boss_split'
  // 控制结算（世界空间）：三类控制各有独立音色，听见即知道中了哪种（美术 §7.5）
  | 'cc_stun' | 'cc_root' | 'cc_taunt'
  // 状态转场（2D）
  | 'wave_start' | 'victory' | 'defeat';

/** 音效「角色特征」标记：用于让同一事件按英雄（子类）× 性别 呈现不同音色（v2.9.14 音效大升级） */
export interface AudioVariant {
  subclass: SubClass;
  gender: Gender;
}

export interface AudioCue {
  id: AudioEventId;
  /** 世界坐标（格），用于立体声声像；省略则居中（UI/状态音） */
  x?: number;
  /** 竞技场宽（格），用于把 x 归一化到声像；省略则居中 */
  arenaW?: number;
  /** 强度 0..1，用于动态音量/音色（重击 vs 轻击）；缺省 1 */
  gain?: number;
  /** 角色特征：命中/施法事件带上，渲染层据此派生性别基频 + 子类签名音 */
  variant?: AudioVariant;
}

// ── 领域回执 / 预设类型（原 src/game/state/slices/types.ts 迁入）──
// 这些是「前后端都要理解的领域事实」，随 GameBackend 契约进 core：
//   BreakthroughResult / MountResult 由写操作作为一次性回执下发；
//   TeamPreset 是账号级元数据（MetaSnapshot 引用）。

// v1.6 §A.6：五星后属性突破结果回执（一次性，任何后续操作清空）
export interface BreakthroughResult {
  heroId: string;
  heroUid: string;
  key: keyof PrimaryAttrs;
  add: number;
  main: boolean;
  /** v3.2 升星：随机 +5% 的两个属性（可含主属性） */
  p5?: (keyof PrimaryAttrs)[];
  /** v3.2 升星：随机 +3% 的两个属性（可含主属性） */
  p3?: (keyof PrimaryAttrs)[];
}

// v2.6 §2：最近一次「升到 5★ 并获得坐骑」的回执（一次性）
export interface MountResult { heroUid: string; kind: MountKind; }

// v2.0 编队预设（最多 3 套）
export interface TeamPreset { name: string; ids: string[]; }

