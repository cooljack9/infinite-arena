import { Unit, FloatText, Projectile, ArenaDef, Effect, AudioCue, HeroGrowth, BuildingPlacement, BattleStatRow } from '../types';
import { RNG } from './rng';
export { applyRelics } from './battle/relics';
export declare const CORPSE_TTL = 1.2;
export declare class BattleSim {
    units: Unit[];
    projectiles: Projectile[];
    floaters: FloatText[];
    effects: Effect[];
    time: number;
    over: boolean;
    result: 'win' | 'lose' | null;
    W: number;
    H: number;
    rng: RNG;
    atkRng: RNG;
    arena: ArenaDef;
    killGains: Map<string, HeroGrowth>;
    private damagers;
    private deadAllies;
    private openingCastDone;
    private spawnSeq;
    /** 取下一个场内生成物 id（召唤物 / 分身共用序列，保证全局唯一） */
    private nextSpawnId;
    constructor(units: Unit[], arena: ArenaDef, seed: number);
    /**
     * v1.5 环境天气增益（美术 §3.4.5）：应用到场上双方，环境中性不偏袒任一方。
     * 应用一次、持续整场，不在 tick 里反复乘，避免浮点漂移。
     * 回血类（verdant）只写 regenPct，由 tick 按 dt 结算；其余直接改派生属性/伤害乘子。
     */
    private applyWeather;
    arenaTile(r: number, c: number): string;
    /** v2.9.3 瓦片可行走性：墙 # 与危险地形 ~ 不可通行（地面/P掩体/S/E/Boss台 可站） */
    private isWalkable;
    private pathCache;
    /** BFS 从单位所在格到目标格的最短路径（4 邻接，返回从下一格开始的路径；目标不可达返回空） */
    private pathTo;
    terrainCraters: {
        x: number;
        y: number;
        r: number;
    }[];
    terrainSlashs: {
        x0: number;
        y0: number;
        x1: number;
        y1: number;
        w: number;
    }[];
    /** 技能砸出的大坑（镇岳怒吼：玄武踏碎地面成坑）。范围随施法者体型缩放 */
    private markCrater;
    /** 单点武器劈出的刀痕（青龙偃月斩：刀劈一线焦土 + 裂纹）。宽度随攻击者体型 */
    private markSlash;
    private alive;
    private nearest;
    private farthest;
    private lowestHp;
    private emit;
    /**
     * 起手距离环（需求 v1.4 §5.4 三件套 ①；美术 §7.3.1）
     * 施法瞬间在脚下画半径 = 真实施法距离的虚线圆，0.25s，alpha 0.35→0。
     * 让玩家一眼看到「这技能能够多远」。castRange=0（self 档）不画——
     * 画一个半径 0 的圈是噪声。
     */
    private windup;
    /** ③④ 冲击 + 收尾层。core=爆点色（亮），echo=扩散色（浅），quake=地面余波色（暗，可省） */
    private ultBurst;
    /**
     * ② 副体层·环形阵列：以 (x,y) 为心、rad 为半径均分 n 个点，逐点错时 emit 同一形状。
     * 三角函数是确定性的，不碰随机流。
     */
    private ultRadial;
    /** ④ 收尾层·技能名横幅：大招是这一局的高光时刻，得报出名字 */
    private ultName;
    /** 技能施法距离（格）。逻辑判定与特效尺寸共用同一个数。 */
    private castRangeOf;
    /** 取施法距离内的敌人（v1.4：技能不再「全体生效」，否则距离环就没有意义） */
    private inCastRange;
    /** 战斗日志（自动战斗必须可播报，需求 §5.2.2） */
    log: string[];
    /**
     * 音频事件汇（音频设计文档 §4）
     * 纯数据：仿真只 push cue，渲染层在 tick 外 drain 消费。不 import 音频模块，
     * 对确定性零影响——这只是往数组里追加，不参与任何模拟数学。
     */
    audioCues: AudioCue[];
    private emitAudio;
    /** 渲染层每帧调用：取走并清空本帧累积的音频事件 */
    drainAudioCues(): AudioCue[];
    private pushLog;
    /**
     * 延迟结算队列（美术 §7.3.1 ③「先告知，再兑现」）
     * 原实现里 long 档的预警线是**画在伤害之后**的——飘字和"预警"同时出现，
     * 预警就成了事后追认，玩家体感是「我血怎么突然没了」。这不是难度，是信息缺失。
     * 加这个队列让伤害真的落在预警线之后，0.22s 的屏息才成立。
     * 用 filter 保序处理，不引入非确定性（固定步长下回放结果一致）。
     */
    private pending;
    private schedule;
    private runPending;
    private acquireTarget;
    /**
     * v3.1 性格偏好索敌。
     *
     * 关键取舍：**不做纯优先级，做「偏好分 − 距离」的加权**。
     * 纯优先级会让一个近战刺客无视贴脸的坦克，横穿整张图去够后排法师——
     * 路上被四个人围殴致死，玩家看到的不是"性格"，是"AI 犯蠢"。
     * 用 PREF_W 格的距离预算把偏好换算成"我愿意为这个目标多走几步"，
     * 偏好足够强时依然会绕后，但不会做出自杀式远征。
     */
    private byPersonality;
    private moveToward;
    /** 攻击方特性对本次伤害的乘子（致命 / 禁锢 / 速射） */
    private traitOutMult;
    /** 受击方特性钩子（在扣血之后、死亡判定之前调用） */
    private traitOnHit;
    /** 统一死亡结算（含魔刃击杀回响）。反弹伤害也要走这里，否则会出现 hp<0 的活人 */
    private killIfDown;
    /** v1.7 §2：取走本场击杀成长账本（按 heroUid 索引），供 BattleScreen 写回 store */
    getKillGains(): Record<string, HeroGrowth>;
    /** v1.7 §2（改）：把一次击杀成长按倍率 mul 缩放基础值（核心 +0.5 / 二级 +1%）累加到指定 heroUid 账本 */
    private creditKillGrowth;
    /** 按 heroUid 反查战场单位名（助攻日志用；找不到回落勇者） */
    private heroName;
    /** v2.2 铁人无尽：取走本场阵亡的友方副本 uid（供 BattleScreen 在胜利后永久移除） */
    getDeadAllyUids(): string[];
    private dampAtkSpeed;
    private dampMoveSpeed;
    /** 实际攻击间隔（秒）。势能层数在这里兑现为攻速 */
    private attackInterval;
    private lightInterval;
    private heavyLockDuration;
    /**
     * 轻/重击节奏判定（纯状态机，不结算效果）。
     * 抽出来的理由：v2.9.8 奶妈把「普攻」改成了「治疗」，但节奏必须和其他职业完全一致
     * ——如果治疗普攻自己再写一份 combo/heavyBurst 逻辑，两份状态机迟早会漂移。
     */
    private rollHeavy;
    /** 一次普攻收尾：写主节奏冷却（轻击攻速）+ 预测下一次是否重击 */
    private finishAttackRhythm;
    /** 轻/重击攻击统一入口：判定节奏 → 动画 → 结算 → 主节奏冷却（轻击攻速） */
    private performAttack;
    /**
     * v2.9.8：返回该单位对应的「女娲本体」——
     * 传入女娲自己 → 返回自己；传入她的召唤物 → 返回主人；其余情况返回 null。
     * 只认友方：敌方召唤系单位不吃这套强化（这是英雄专属加强，不是全局机制）。
     */
    private nuwaOwnerOf;
    /** v2.9.8 共鸣②：普攻削减女娲大招冷却 1s（冷却已就绪时不再空转累计） */
    private nuwaResonate;
    /**
     * v2.9.8 共鸣③：女娲 / 其召唤物击杀敌人 → 大招冷却清零并立刻再放一次。
     * 放在 killIfDown 尾部调用。summon 技能本身不造成伤害，故不会与 killIfDown 递归。
     */
    private nuwaKillRecast;
    /** 是否走「重击转治疗」的分流：仅我方非召唤的治疗职业 */
    private isHealAttacker;
    /** 治疗射程：沿用其普攻射程（治疗职业 5 格），逻辑判定与特效尺寸共用同一个数 */
    private healRangeOf;
    /**
     * 选疗目标：血量百分比最低的友方主力（同时用作「本次重击值不值得转治疗」的判据）。
     * 召唤物/建筑不占治疗资源——它们本就是消耗品，把奶量喂给 18s 后自然消散的石魂卫是纯亏。
     * 全队满血时：有「恩泽」（溢疗转盾）才继续奶（溢出真能变成护盾），否则返回 null → 该拍改打敌人。
     */
    private pickHealTarget;
    /**
     * 重击群疗结算：以奶妈为心、治疗射程为半径的一圈群疗。
     * 单体系数打 6 折，命中人数越多总量越高——让「站位聚拢」成为一个有收益的选择。
     * 倍率沿用伤害重击的同源扰动（atkRng 独立流，不污染主随机流）：230%~360%。
     */
    private healBurst;
    /** 召唤位上限（军团 +1） */
    private maxSummonsFor;
    private lateDecay;
    private effResist;
    private effCritDmg;
    private applyDamage;
    /** 闪避判定 + 轻捷/灵巧「滑步」联动（需求 §5.2.1；v2.8 slim 进阶） */
    private tryDodge;
    private applyHeal;
    /**
     * v3.1 签名技效果乘子（技能等级 = 星级，+18%/星）。
     * 只在 castSkill 内部显式相乘，不塞进 dealSkill——
     * dealSkill 同时服务坐骑技与元素附伤，塞进去会让坐骑吃两层星级乘区。
     */
    private skillPow;
    private dealSkill;
    private basicAttack;
    /** 单位普攻射程：召唤物用模板射程，其余用子类射程 */
    private attackRangeOf;
    private colorOf;
    /**
     * 三类召唤物之一（需求 v1.4 §5.2.2；美术 §7.4）
     * 属性全部按召唤者 INT 折算，体型来自模板——石魂卫魁梧、影刃仆精巧、咒火灵轻捷，
     * 玩家在它开打之前就能从剪影认出它是什么类型。
     */
    private makeSummon;
    /**
     * Boss 分身（美术 §7.2.1）
     * 走召唤物基础设施（isSummon + summonUntil），所以：
     *  · 不计入胜负判定 —— 杀光分身不算赢，逼玩家找本体
     *  · 用召唤物的窄 HUD —— 屏幕不会被 3 条 Boss 血条淹没
     * 分身不再分裂（skillCd 拉到无穷），否则 12s 一轮就是指数爆炸。
     */
    private makeClone;
    private lastSummonKind?;
    private shouldCast;
    /**
     * 施放技能。v1.4 三条纪律：
     *  1) 任何 castRange > 0 的技能都先发起手距离环（三件套 ①）
     *  2) 特效主尺寸 = castRange × TILE，禁止硬编码（三件套 ②）
     *  3) 命中反馈时长按四档位取 TIER_TTL（三件套 ③）
     */
    private castSkill;
    private dragonBreath;
    private shouldCastMount;
    /**
     * 施放坐骑技能。五只坐骑对应五种「这只畜生本身会做的事」：
     *   战象踩踏 / 玄豹扑杀 / 白额虎咆哮 / 赤兔疾驰 / 蛮牛顶撞
     * 每一个都复用已有的 VFX 签名管线（vfxOf → emit），不新增渲染分支：
     * 新增分支意味着新增一套需要单独调的视觉参数，而坐骑技能的辨识度
     * 靠的是「形状 + 颜色 + 文案」，已有的九种签名足够覆盖。
     */
    private castMountSkill;
    private faceToward;
    private attackAnim;
    private castAnim;
    private moveAnim;
    /** 本场已生成的建筑（按 kind 计数，供上限与战报使用） */
    buildings: Unit[];
    /**
     * 建筑落地。血量按层深 scaleHp 放大，与波次怪同一条缩放线——
     * 否则 20 层时营房会脆得像纸，「拆楼」这个决策直接消失。
     */
    spawnBuildings(placements: BuildingPlacement[], layer: number, scaleHp: number, scaleDmg: number): void;
    private buildingInitialSpawn;
    /** 建筑产出一个单位。位置绕建筑均匀散布，避免全部叠在同一个像素上 */
    private spawnFromBuilding;
    /** 建筑每帧行为：塔开火 / 产兵器计时。建筑不索敌移动、不施法。 */
    private tickBuilding;
    private buildScaleHp;
    private buildScaleDmg;
    setBuildingScale(hp: number, dmg: number): void;
    forceCast(subclass: string): boolean;
    addUnits(units: Unit[]): void;
    tick(dt: number): void;
    private checkOver;
    /** v2.9.6 战后评价：返回所有非建筑单位的本场统计（确定性累计，仅作展示 / MVP 奖励记账）。 */
    getBattleStats(): BattleStatRow[];
}
