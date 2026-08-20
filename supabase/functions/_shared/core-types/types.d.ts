export type ClassCategory = 'tank' | 'warrior' | 'archer' | 'mage';
export type SubClass = 'physTank' | 'magicTank' | 'charge' | 'hexblade' | 'gunner' | 'sniper' | 'controller' | 'summoner' | 'healer';
export type MonsterKind = 'dragon' | 'fallen_angel' | 'witch' | 'demon' | 'skeleton' | 'gargoyle';
export type DamageType = 'physical' | 'magic' | 'hybrid';
export type Gender = 'male' | 'female';
/**
 * 性格（v3.1）：体型之外的第二条个体差异线，只影响**索敌偏好**，不给数值加成。
 * valiant 不畏强暴（>80% 生命）/ hunter 猎手（最低生命）/ breaker 攻坚者（敌方前排）
 * / assassin 专业刺客（敌方后排）/ savior 救困扶危（敌方最强者）/ steady 随遇而安（就近）
 */
export type PersonalityId = 'valiant' | 'hunter' | 'breaker' | 'assassin' | 'savior' | 'steady';
export interface PrimaryAttrs {
    con: number;
    str: number;
    agi: number;
    int: number;
}
export interface BaseValues {
    hp: number;
    pDmg: number;
    mDmg: number;
    atkSpeed: number;
    crit: number;
    moveSpeed: number;
}
export interface DerivedAttrs {
    hp: number;
    pDmg: number;
    mDmg: number;
    atkSpeed: number;
    dodge: number;
    moveSpeed: number;
    crit: number;
    critDmg: number;
    pResist: number;
    mResist: number;
    heal: number;
    regenPct?: number;
    dmgTakenMult?: number;
}
export type BodyType = 'giant' | 'titan' | 'obese' | 'colossal' | 'heavy' | 'medium' | 'light' | 'slim' | 'petite' | 'gnome';
export type SkillStyle = 'bulwark_taunt' | 'bulwark_shield' | 'charge_dash' | 'melee_burst' | 'projectile_volley' | 'precision_beam' | 'zone_control' | 'summon_rift' | 'blessing_field';
export type RangeTier = 'self' | 'short' | 'mid' | 'long';
export type VfxMotion = 'expand_ring' | 'shield_pulse' | 'charge_wedge' | 'nova_spin' | 'volley_scatter' | 'beam_split' | 'cage_spin' | 'taiji_spin' | 'rift_tear' | 'blessing_rise' | 'blessing_vine';
export interface SkillDef {
    id: string;
    name: string;
    cd: number;
    damageType: DamageType;
    desc: string;
    skillStyle?: SkillStyle;
    castRange?: number;
}
export type TraitId = 'bulwark' | 'spellbreak' | 'momentum' | 'bloodedge' | 'volley' | 'lethal' | 'shackle' | 'legion' | 'grace';
export type GrowthStatKey = 'hp' | 'pDmg' | 'mDmg' | 'heal';
export declare const GROWTH_STAT_KEYS: GrowthStatKey[];
export declare const PRIMARY_KEYS: (keyof PrimaryAttrs)[];
/** 角色的永久成长累积（击杀成长 / 成长药剂共用同一个容器） */
export interface HeroGrowth {
    primary?: Partial<PrimaryAttrs>;
    secondaryPct?: Partial<Record<GrowthStatKey, number>>;
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
    growth: PrimaryAttrs;
    skill: SkillDef;
    trait?: string;
    traitId?: TraitId;
    bodyType?: BodyType;
    gender?: Gender;
    star?: number;
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
    bonusPct?: Partial<PrimaryAttrs>;
    mount?: MountKind;
    mountRarity?: MountRarity;
    uid: string;
    growthBonus?: HeroGrowth;
    pendingBurst?: boolean;
    mods?: HeroStatMods;
    atkRatio?: {
        p: number;
        m: number;
    };
}
export interface HeroStatMods {
    hpMul?: number;
    pDmgMul?: number;
    atkSpeedMul?: number;
    moveSpeedMul?: number;
}
export interface EnemyDef {
    id: string;
    name: string;
    category: ClassCategory;
    subclass: SubClass;
    basePrimary: PrimaryAttrs;
    skill?: SkillDef;
    isBoss?: boolean;
    bodyType?: BodyType;
    gender?: Gender;
    monsterKind?: MonsterKind;
}
export interface RelicDef {
    id: string;
    name: string;
    desc: string;
    mod?: Partial<Record<keyof DerivedAttrs, number>> & {
        dmgMult?: number;
        hpMult?: number;
    };
}
export interface TalentDef {
    id: string;
    name: string;
    desc: string;
}
export type ArenaArchetype = 'A1' | 'A3' | 'A6' | 'RIVER' | 'JIANGE' | 'DRAGON' | 'CAGE';
export type GameMode = 'novice' | 'normal' | 'ironman';
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
    outlineUnits?: boolean;
}
export type WeatherKind = 'sandstone' | 'frost' | 'magma' | 'void' | 'verdant' | 'sanctum';
export interface WeatherDef {
    kind: WeatherKind;
    cn: string;
    icon: string;
    moveSpeedAdd?: number;
    atkSpeedAdd?: number;
    dmgMul?: number;
    critAdd?: number;
    regenPct?: number;
    dmgTakenMul?: number;
}
export interface ArenaDef {
    id: ArenaArchetype;
    name: string;
    width: number;
    height: number;
    tiles: string[];
    theme?: MapTheme;
    fade?: number;
    weather?: WeatherDef;
    dragonNests?: number;
    hazardBase?: string;
    hazardWave?: string;
}
export type BattleEventType = 'damage' | 'heal' | 'death' | 'projectile' | 'nova' | 'shield' | 'root' | 'summon' | 'text';
export interface Vec2 {
    x: number;
    y: number;
}
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
export interface FloatText {
    x: number;
    y: number;
    text: string;
    color: string;
    ttl: number;
}
export interface Projectile {
    x: number;
    y: number;
    tx: number;
    ty: number;
    color: string;
    ttl: number;
    prevX?: number;
    prevY?: number;
    heavy?: boolean;
}
export type VfxShape = 'ring' | 'bubble' | 'nova' | 'beam' | 'trail' | 'cage' | 'rift' | 'light' | 'shock' | 'blade' | 'sun' | 'quake';
export interface Effect {
    shape: VfxShape;
    x: number;
    y: number;
    tx?: number;
    ty?: number;
    r: number;
    color: string;
    ttl: number;
    maxTtl: number;
    dashed?: boolean;
    alphaFrom?: number;
    alphaTo?: number;
    tier?: RangeTier;
    thickness?: number;
    delay?: number;
    motion?: VfxMotion;
    sizeMul?: number;
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
    atkRatio?: {
        p: number;
        m: number;
    };
    x: number;
    y: number;
    prevX?: number;
    prevY?: number;
    hp: number;
    maxHp: number;
    primary: PrimaryAttrs;
    derived: DerivedAttrs;
    cd: number;
    skill: SkillDef;
    skillCd: number;
    targetId?: string;
    retargetAt?: number;
    alive: boolean;
    shield: number;
    rootUntil: number;
    stunUntil: number;
    tauntUntil: number;
    dmgMult: number;
    level: number;
    isBoss?: boolean;
    isSummon?: boolean;
    summonUntil?: number;
    flash: number;
    bodyType: BodyType;
    gender: Gender;
    hitRadius: number;
    star?: number;
    dupIndex?: number;
    summonKind?: SummonKind;
    summonTotal?: number;
    monsterKind?: MonsterKind;
    braceUntil?: number;
    glideUntil?: number;
    lastDodgeAt?: number;
    combo?: number;
    heavyAt?: number;
    heavyBurst?: number;
    heavyBurstCount?: number;
    heavyLock?: number;
    lightAs?: number;
    heavyAs?: number;
    heavyArmorUntil?: number;
    isHeavyHit?: boolean;
    heavyReady?: boolean;
    kdUntil?: number;
    baseMove?: number;
    traitId?: TraitId;
    traitStacks?: number;
    lifestealStacks?: number;
    traitTimer?: number;
    lastHitTargetId?: string;
    lastBasicAt?: number;
    slowUntil?: number;
    slowPct?: number;
    ccColor?: string;
    heroUid?: string;
    casterHeroUid?: string;
    mount?: MountKind;
    mountRarity?: MountRarity;
    mountCd?: number;
    mountSkill?: SkillDef;
    skillCdr?: number;
    /**
     * v3.1 签名技效果乘子（技能等级 = 星级，+18%/星）。
     * 作用于签名技的伤害 / 护盾 / 治疗 / 召唤物强度，不作用于普攻与坐骑技——
     * 坐骑有自己的品质乘子，两套乘区叠在一起会让 5★ 紫骑变成无法平衡的双重指数。
     */
    skillPower?: number;
    facing?: 1 | -1;
    attackAnimAt?: number;
    castAnimAt?: number;
    moveAnimUntil?: number;
    deadAt?: number;
    isBuilding?: boolean;
    buildingKind?: BuildingKind;
    spawnTimer?: number;
    spawnedTotal?: number;
    dmgDealt?: number;
    dmgTaken?: number;
    healDone?: number;
    moveDist?: number;
    dragonElement?: 'fire' | 'ice' | 'poison';
    burnUntil?: number;
    burnDps?: number;
    poisonUntil?: number;
    freezeUntil?: number;
}
export interface BattleStatRow {
    id: string;
    side: 'ally' | 'enemy';
    name: string;
    dmgDealt: number;
    dmgTaken: number;
    healDone: number;
    moveDist: number;
    heroUid?: string;
}
export interface BattleEvalState {
    rows: BattleStatRow[];
    winner: 'win' | 'lose';
    currentLayer: number;
    nextLayer: number;
    cap: number;
    mvpUid: string | null;
    mvpStat: keyof PrimaryAttrs | null;
    mvpAdd: number;
}
export type MountKind = 'elephant' | 'leopard' | 'tiger' | 'redhare' | 'ox';
export type MountRarity = 'blue' | 'orange' | 'purple';
export interface MountDef {
    kind: MountKind;
    name: string;
    desc: string;
    /** 骑乘常驻加成：上马即写入派生属性，永久生效 */
    ride: {
        hpPct?: number;
        pDmgPct?: number;
        moveSpeedAdd?: number;
        atkSpeedAdd?: number;
        critAdd?: number;
        pResistAdd?: number;
        dodgeAdd?: number;
    };
    /** 坐骑技能（独立 CD，走 BattleSim.castMountSkill） */
    skill: SkillDef;
    /** 像素配色：主色 / 暗部 / 点缀（鬃毛、纹路、鞍鞯） */
    body: string;
    dark: string;
    accent: string;
}
export type BuildingKind = 'barracks' | 'tower_wood' | 'tower_rock' | 'tower_iron' | 'dragon_nest' | 'dragon_lair';
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
}
/** 建筑在地图上的落点（由 levelGen 确定性生成） */
export interface BuildingPlacement {
    kind: BuildingKind;
    pos: Vec2;
}
export type SummonKind = 'bulwark' | 'sprinter' | 'arcanist';
export interface SummonTemplate {
    kind: SummonKind;
    name: string;
    bodyType: BodyType;
    hpRatio: number;
    atkRatio: number;
    moveMult: number;
    range: number;
    duration: number;
    color: string;
    riftColor: string;
    riftW: number;
    riftH: number;
    spawnAnim: number;
    logReason: string;
}
export type Rarity = 'normal' | 'blue' | 'orange' | 'red';
export type AffixKey = 'pDmg' | 'mDmg' | 'hp' | 'atkSpeed' | 'crit' | 'critDmg' | 'pResist' | 'mResist' | 'moveSpeed' | 'dodge' | 'heal';
export type AffixMode = 'flat' | 'pct';
export interface Affix {
    key: AffixKey;
    value: number;
    mode?: AffixMode;
}
export interface Equipment {
    id: string;
    name: string;
    rarity: Rarity;
    affixes: Affix[];
    opened: boolean;
    basePrice: number;
    star?: number;
    special?: SubClass;
    family?: string;
}
export type ChestReward = 'equip_normal' | 'gold_small' | 'equip_high' | 'equip_rare' | 'gold_large';
export interface Chest {
    id: string;
    reward: ChestReward;
    equipment?: Equipment;
    gold?: number;
}
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
}
export interface EventEffect {
    /** 金币增减（可为负） */
    gold?: number;
    /** 获得装备：指定品质与数量（确定性生成） */
    give?: {
        rarity: Rarity;
        count: number;
    };
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
    mode: GameMode;
    failures: number;
}
export type AudioEventId = 'ui_click' | 'ui_open' | 'ui_error' | 'ui_purchase' | 'hit_melee' | 'hit_ranged' | 'crit' | 'hit_heavy' | 'dodge' | 'heal' | 'shield_up' | 'death_ally' | 'death_enemy' | 'summon_spawn' | 'summon_expire' | 'cast_generic' | 'cast_taunt' | 'cast_ward' | 'cast_charge' | 'cast_hexburst' | 'cast_barrage' | 'cast_deadshot_warn' | 'cast_deadshot_fire' | 'cast_timelock' | 'cast_summon' | 'cast_groupheal' | 'cast_boss_stomp' | 'cast_boss_devour_warn' | 'cast_boss_devour' | 'cast_boss_split' | 'cc_stun' | 'cc_root' | 'cc_taunt' | 'wave_start' | 'victory' | 'defeat';
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
export interface MountResult {
    heroUid: string;
    kind: MountKind;
}
export interface TeamPreset {
    name: string;
    ids: string[];
}
