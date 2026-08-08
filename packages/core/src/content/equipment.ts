// 装备生成（装备与经济设计 §2/§9/§11）。确定性 RNG，所有数值带 rationale。
import {
  Rarity, AffixKey, Affix, AffixMode, Equipment, Chest, ChestReward, ConsumableItem, SubClass,
} from '../types';
import { ALL_SUBCLASSES } from './classes';
import { RNG, randInt, shuffle, pick } from '../engine/rng';
import { rollConsumable, CONSUMABLE_CHANCE } from './consumables';

// §2.1 词条池：单条普通品质随机区间
export const AFFIX_POOL: Record<AffixKey, { name: string; min: number; max: number }> = {
  pDmg:      { name: '物理伤害', min: 4, max: 9 },
  mDmg:      { name: '魔法伤害', min: 4, max: 9 },
  hp:        { name: '生命',     min: 25, max: 60 },
  atkSpeed:  { name: '攻速',     min: 3, max: 8 },
  crit:      { name: '暴击',     min: 2, max: 5 },
  critDmg:   { name: '暴击伤害', min: 6, max: 14 },
  pResist:   { name: '物理减伤', min: 3, max: 8 },
  mResist:   { name: '魔法减伤', min: 3, max: 8 },
  moveSpeed: { name: '移速',     min: 2, max: 6 },
  dodge:     { name: '闪避',     min: 2, max: 6 },
  heal:      { name: '治疗量',   min: 6, max: 16 },
};

// §2.2 品质倍率 + §9 掉落权重 + §11.3 基准价
interface RarityCfg { mult: number; affixMin: number; affixMax: number; weight: number; basePrice: number; prefix: string; }
export const RARITY_CFG: Record<Rarity, RarityCfg> = {
  normal: { mult: 1.0, affixMin: 1, affixMax: 1, weight: 68,  basePrice: 30,   prefix: '粗制' },
  blue:   { mult: 1.8, affixMin: 2, affixMax: 2, weight: 24,  basePrice: 120,  prefix: '精良' },
  orange: { mult: 3.0, affixMin: 2, affixMax: 3, weight: 6.5, basePrice: 400,  prefix: '卓越' },
  red:    { mult: 5.0, affixMin: 3, affixMax: 3, weight: 1.5, basePrice: 1200, prefix: '传说' },
};

const RARITY_CN: Record<Rarity, string> = { normal: '普通', blue: '蓝', orange: '橙', red: '红' };
export const rarityName = (r: Rarity) => RARITY_CN[r];

const AFFIX_NOUN: Record<AffixKey, string> = {
  pDmg: '利刃', mDmg: '法珠', hp: '壁垒', atkSpeed: '疾风', crit: '鹰眼',
  critDmg: '屠戮', pResist: '铁壁', mResist: '秘银', moveSpeed: '轻足', dodge: '幻影', heal: '圣疗',
};

const ALL_AFFIX_KEYS = Object.keys(AFFIX_POOL) as AffixKey[];

// v2.9.3：固定数值（flat）的物理/魔法减伤词条移除——3~8 点减伤在 75 封顶面前无意义，
// 还要在 applyEquipment 里多做一步运算。百分比（pct）减伤保留（乘区才有堆叠意义）。
const FLAT_BLOCKED: Set<AffixKey> = new Set(['pResist', 'mResist']);
const FLAT_KEYS = ALL_AFFIX_KEYS.filter((k) => !FLAT_BLOCKED.has(k));

// ── v1.6 百分比词条（附录 A.4.1）──
// 设计意图：flat（白值）是线性堆料，pct（百分比）是乘区。只有橙/红才产 pct，
// 于是「高品质装备值不值得留」有了除数值大小以外的第二个判断维度。
export const PCT_CHANCE: Record<Rarity, number> = { normal: 0, blue: 0, orange: 0.35, red: 0.50 };
export const PCT_RANGE: Record<Rarity, { min: number; max: number }> = {
  normal: { min: 0, max: 0 },
  blue:   { min: 0, max: 0 },
  orange: { min: 6,  max: 12 },
  red:    { min: 10, max: 18 },
};

// 品质等级（用于转移成功率与合成判定）
export const QUALITY_LEVEL: Record<Rarity, number> = { normal: 0, blue: 1, orange: 2, red: 3 };

// 红装星级词条倍率（附录 A.5.2）：1★=1.00 → 5★=2.00
export const eqStarMult = (eq: Equipment): number =>
  eq.rarity === 'red' ? 1 + 0.25 * (Math.max(1, Math.min(5, eq.star ?? 1)) - 1) : 1;

/** 装备显示名：红装带星级前缀（附录 A.5.2） */
export const equipDisplayName = (eq: Equipment): string => {
  const s = eq.rarity === 'red' ? Math.max(1, Math.min(5, eq.star ?? 1)) : 0;
  return s > 1 ? `${'★'.repeat(s)} ${eq.name}` : eq.name;
};

// ── v2.7 §1.3 装备综合评分（「一键全部装备」的排序依据）──
// 需要一个能横跨品质/星级/白值/百分比四个维度的单一标量，否则一键装备只能
// 按背包顺序发放——那等于把红装塞给不需要的人，比不做还糟。
//
// 归一化口径：每条白值词条折算成「相对该词条普通品质上限的倍数」。
// 于是 hp+60（上限 60）与 pDmg+9（上限 9）都记 1.0 分，不同量纲之间可加。
// 百分比条按 1% = 0.12 分计价（10% ≈ 1.2 条满值白装词条）——pct 是乘区，
// 在装备成型后收益高于白值，给它一点溢价，但不至于让 6% 的橙装压过满值红装。
// 负数词条（重铸失败惩罚）自然记负分，一键装备会把它们排到最后。
const PCT_SCORE_PER_POINT = 0.12;
export function equipScore(eq: Equipment): number {
  const sm = eqStarMult(eq);
  let s = 0;
  for (const a of eq.affixes) {
    const v = a.value * sm;
    if (a.mode === 'pct') s += v * PCT_SCORE_PER_POINT;
    else s += v / Math.max(1, AFFIX_POOL[a.key].max);
  }
  // 同分时让高品质排前面（同分多发生在白装之间，影响很小，但要保证排序稳定）
  return Math.round((s + QUALITY_LEVEL[eq.rarity] * 0.001) * 1000) / 1000;
}

let eid = 0;
const nextEqId = () => `e${eid++}`;

function rollRarity(rng: RNG): Rarity {
  const total = (Object.values(RARITY_CFG) as RarityCfg[]).reduce((s, c) => s + c.weight, 0);
  let r = rng() * total;
  for (const [k, c] of Object.entries(RARITY_CFG) as [Rarity, RarityCfg][]) {
    if (r < c.weight) return k;
    r -= c.weight;
  }
  return 'normal';
}

function rollAffixes(rng: RNG, rarity: Rarity): Affix[] {
  const cfg = RARITY_CFG[rarity];
  const count = randInt(rng, cfg.affixMin, cfg.affixMax);
  const keys = shuffle(rng, ALL_AFFIX_KEYS).slice(0, count);
  const pctChance = PCT_CHANCE[rarity];
  const out: Affix[] = [];
  const usedPct = new Set<AffixKey>(); // 同一件装上每种 pct 只允许一条（附录 A.4.2）
  for (const key of keys) {
    if (pctChance > 0 && rng() < pctChance && !usedPct.has(key)) {
      const pr = PCT_RANGE[rarity];
      usedPct.add(key);
      out.push({ key, value: randInt(rng, pr.min, pr.max), mode: 'pct' });
    } else {
      // flat：固定数值减伤词条（pResist/mResist）不再产出，改抽其他词条（v2.9.3）。
      // 替换池排除「本件已选 key」与「已加入 out 的 key」——否则前一个被替换进
      // out 的 key（如 pDmg）会在后一个减伤词条替换时再次被抽中，产生重复 flat 条目
      const usedKeys = new Set(keys);
      for (const a of out) usedKeys.add(a.key);
      const candidates = FLAT_KEYS.filter((k) => !usedKeys.has(k));
      const fk = FLAT_BLOCKED.has(key)
        ? (candidates.length ? pick(rng, candidates) : pick(rng, FLAT_KEYS))
        : key;
      const pool = AFFIX_POOL[fk];
      const base = randInt(rng, pool.min, pool.max);
      out.push({ key: fk, value: Math.max(1, Math.round(base * cfg.mult)), mode: 'flat' });
    }
  }
  return out;
}

// v2.9.3 红色专属/通用装备：红装 = 9 件职业专属 + 5 件通用（14 种等权）。
// 专属红装：穿戴者职业匹配时触发专属特效（主属性 +20%、大招 CDR 10% + 每星 5% 封顶 45%）。
// 通用红装：同款 N 件 → 每件词条 ×(1+5%N)，封顶 5 件 25%（无专属特性）。
const SPECIAL_NAMES: Record<SubClass, string> = {
  physTank: '玄武·镇岳重盾', magicTank: '符甲·玄符道袍', charge: '突袭·偃月长刀',
  hexblade: '剑客·无名古剑', gunner: '炮手·神机火铳', sniper: '神射·落日神弓',
  controller: '太极·阴阳罗盘', summoner: '化生·造化陶土', healer: '回春·百草葫芦',
};
const SPECIAL_AFFIXES: Record<SubClass, AffixKey[]> = {
  physTank: ['hp', 'pDmg'], magicTank: ['hp', 'mDmg'], charge: ['pDmg', 'hp'],
  hexblade: ['pDmg', 'crit'], gunner: ['pDmg', 'atkSpeed'], sniper: ['pDmg', 'critDmg'],
  controller: ['mDmg', 'atkSpeed'], summoner: ['mDmg', 'hp'], healer: ['heal', 'hp'],
};
const GENERIC_FAMILIES: { family: string; name: string }[] = [
  { family: 'pojun', name: '破军' }, { family: 'xuanlin', name: '玄鳞' },
  { family: 'yunwen', name: '云纹' }, { family: 'tiangong', name: '天工' },
  { family: 'jiuyao', name: '九曜' },
];

// 专属红装：核心词条（职业主属性向，高值）+ 1 个随机词条，共 3 条（红装标准）
function genSpecial(sub: SubClass, rng: RNG, r: Rarity): Equipment {
  const mult = RARITY_CFG[r].mult;
  const core = SPECIAL_AFFIXES[sub];
  const affixes: Affix[] = core.map((k) => {
    const pool = AFFIX_POOL[k];
    const base = randInt(rng, Math.round(pool.max * 0.8), pool.max);
    return { key: k, value: Math.max(1, Math.round(base * mult)), mode: 'flat' };
  });
  // 第三条：从剩余词条里抽（排除核心两个与 flat 减伤，避免重复/违禁）
  const rest = (Object.keys(AFFIX_POOL) as AffixKey[]).filter(
    (k) => !core.includes(k) && !FLAT_BLOCKED.has(k),
  );
  const k3 = pick(rng, rest);
  const p3 = AFFIX_POOL[k3];
  affixes.push({ key: k3, value: Math.max(1, Math.round(randInt(rng, p3.min, p3.max) * mult)), mode: 'flat' });
  return {
    id: nextEqId(),
    name: SPECIAL_NAMES[sub],
    rarity: r,
    affixes,
    opened: false,
    basePrice: RARITY_CFG[r].basePrice,
    star: 1,
    special: sub,
  };
}

// 通用红装：随机 3 词条 + 系列标记
function genGeneric(fam: { family: string; name: string }, rng: RNG, r: Rarity): Equipment {
  const affixes = rollAffixes(rng, r);
  return {
    id: nextEqId(),
    name: fam.name,
    rarity: r,
    affixes,
    opened: false,
    basePrice: RARITY_CFG[r].basePrice,
    star: 1,
    family: fam.family,
  };
}

// 生成一件装备（可指定品质；不指定则按掉落权重 roll）
export function generateEquipment(rng: RNG, rarity?: Rarity): Equipment {
  const r = rarity ?? rollRarity(rng);
  if (r === 'red') {
    // v2.9.3 红装 = 9 专属 + 5 通用，14 种等权
    const n = Math.floor(rng() * 14);
    if (n < 9) return genSpecial(ALL_SUBCLASSES[n], rng, r);
    return genGeneric(GENERIC_FAMILIES[n - 9], rng, r);
  }
  const affixes = rollAffixes(rng, r);
  const primary = affixes[0].key;
  return {
    id: nextEqId(),
    name: RARITY_CFG[r].prefix + AFFIX_NOUN[primary],
    rarity: r,
    affixes,
    opened: false,
    basePrice: RARITY_CFG[r].basePrice,
  };
}

// ══════════════════════════════════════════════════════════════
// v1.7 §3 宝箱掉落（需求 v1.7 §3）
// ══════════════════════════════════════════════════════════════
// 旧版：每场固定 3–5 箱，每箱必出装备，品质按全局权重。
// 新版把「箱子数量」与「箱子内容」拆成两个独立旋钮：
//   数量 —— 小关 3~6，Boss 关 8~12（Boss 关的仪式感来自体量，而非稀有度暴涨）
//   内容 —— 固定 5 档掉落表，其中 30% 是金钱
// 让金钱进入掉落表是关键改动：v1.6 的金币只从「通关奖励」一个水龙头流入，
// 商店、锻造、招募、刷新却有四个出水口，后期必然干涸。

/** 箱子数量：Boss 关 8~12，小关卡 3~6（需求 v1.7 §3） */
export const chestCount = (rng: RNG, boss: boolean): number =>
  boss ? randInt(rng, 8, 12) : randInt(rng, 3, 6);

/** 掉落表：40% 普通装备 / 20% 少量金钱 / 20% 高级装备 / 10% 稀有装备 / 10% 大量金钱 */
export const CHEST_TABLE: { reward: ChestReward; p: number }[] = [
  { reward: 'equip_normal', p: 0.40 },
  { reward: 'gold_small',   p: 0.20 },
  { reward: 'equip_high',   p: 0.20 },
  { reward: 'equip_rare',   p: 0.10 },
  { reward: 'gold_large',   p: 0.10 },
];

/** 稀有档的内部构成：橙 80% / 红 20% —— 折算后红装约占总掉落 2%，与 v1.6 的 1.5% 基本持平 */
const RARE_RED_CHANCE = 0.20;

/** 金钱档面额随层数线性走高，保证中后期的箱子不会变成「捡几块钱」 */
export const chestGold = (rng: RNG, layer: number, big: boolean): number =>
  big ? randInt(rng, 35 + 12 * layer, 65 + 22 * layer)
      : randInt(rng, 8 + 3 * layer, 16 + 5 * layer);

function rollChestReward(rng: RNG): ChestReward {
  let r = rng();
  for (const row of CHEST_TABLE) {
    if (r < row.p) return row.reward;
    r -= row.p;
  }
  return 'equip_normal';
}

let cidx = 0;
const nextChestId = () => `k${cidx++}`;

/** 开一个箱：按掉落表决定是装备还是金钱 */
export function rollChest(rng: RNG, layer: number): Chest {
  const reward = rollChestReward(rng);
  switch (reward) {
    case 'gold_small':
      return { id: nextChestId(), reward, gold: chestGold(rng, layer, false) };
    case 'gold_large':
      return { id: nextChestId(), reward, gold: chestGold(rng, layer, true) };
    case 'equip_high':
      return { id: nextChestId(), reward, equipment: generateEquipment(rng, 'blue') };
    case 'equip_rare':
      return {
        id: nextChestId(), reward,
        equipment: generateEquipment(rng, rng() < RARE_RED_CHANCE ? 'red' : 'orange'),
      };
    default:
      return { id: nextChestId(), reward, equipment: generateEquipment(rng, 'normal') };
  }
}

/** 一场战斗的全部掉落箱 */
export function rollDrops(rng: RNG, layer: number, boss: boolean): Chest[] {
  const n = chestCount(rng, boss);
  return Array.from({ length: n }, () => rollChest(rng, layer));
}

// §11.1 商店库存：按权重生成装备，另有 20% 货位产出一次性物品（需求 v1.7 §4）
export interface ShopStock {
  equipment: Equipment[];
  consumables: ConsumableItem[];
}

export function rollShopStock(rng: RNG, count = 8): ShopStock {
  const equipment: Equipment[] = [];
  const consumables: ConsumableItem[] = [];
  for (let i = 0; i < count; i++) {
    // 逐货位独立判定，而不是「固定取 20% 的整数个」——
    // 后者会让 8 格永远恰好 1.6→2 瓶药，玩家两层之后就能背出库存结构。
    if (rng() < CONSUMABLE_CHANCE) {
      consumables.push(rollConsumable(rng));
    } else {
      const e = generateEquipment(rng);
      e.opened = true;
      equipment.push(e);
    }
  }
  return { equipment, consumables };
}

// ── §12 锻造系统（仅普通装备）──
// §12.2 负面词条（惩罚用）：以负值 Affix 表示，applyEquipment 自然扣减
export const NEGATIVE_AFFIXES: Affix[] = [
  { key: 'pDmg', value: -3 },
  { key: 'hp', value: -15 },
  { key: 'atkSpeed', value: -3 },
  { key: 'crit', value: -2 },
];

// §12.1 品质成功率：消耗 N 件废普通装提升；封顶 0.95
export const forgeSuccessRate = (consumeN: number): number =>
  Math.max(0, Math.min(0.95, 0.45 + consumeN * 0.11));

const inRange = (rng: RNG, pool: { min: number; max: number }, mult: number, lo: number, hi: number): number => {
  const base = pool.min + rng() * (pool.max - pool.min);
  return Math.max(1, Math.round(base * mult * (lo + rng() * (hi - lo))));
};

// 锻造一件普通装备：100% 重roll 词条；成功率决定「高值区」或触发惩罚
export function forgeEquipment(eq: Equipment, consumeN: number, rng: RNG): Equipment {
  const successRate = forgeSuccessRate(consumeN);
  const success = rng() < successRate;
  const mult = RARITY_CFG[eq.rarity].mult;

  let affixes: Affix[] = eq.affixes
    .map((a) => {
      if (!success) return { ...a };
      // v2.9.3 flat 减伤词条移除：锻造时一并清除（不再重 roll 成 pResist/mResist）
      if (a.mode !== 'pct' && FLAT_BLOCKED.has(a.key)) return null;
      if (a.mode === 'pct') {
        const pr = PCT_RANGE[eq.rarity];
        return { key: a.key, mode: 'pct' as AffixMode, value: Math.max(1, randInt(rng, Math.round(pr.min * 0.8), pr.max)) };
      }
      return { key: a.key, mode: 'flat' as AffixMode, value: inRange(rng, AFFIX_POOL[a.key], mult, 0.7, 1.0) };
    })
    .filter((a): a is Affix => a !== null);

  if (!success) {
    const penalty = pick(rng, ['reduce', 'weaken', 'remove', 'negative'] as const);
    if (penalty === 'reduce' && affixes.length > 0) {
      const i = randInt(rng, 0, affixes.length - 1);
      affixes = affixes.map((a, idx) => (idx === i ? { ...a, value: Math.max(1, Math.round(a.value * 0.7)) } : a));
    } else if (penalty === 'weaken' && affixes.length > 0) {
      const i = randInt(rng, 0, affixes.length - 1);
      affixes = affixes.map((a, idx) =>
        idx === i
          ? a.mode === 'pct'
            ? { ...a, value: Math.max(1, Math.round(a.value * 0.5)) }
            : { key: a.key, mode: 'flat' as AffixMode, value: inRange(rng, AFFIX_POOL[a.key], mult, 0.3, 0.6) }
          : a,
      );
    } else if (penalty === 'remove' && affixes.length > 1) {
      const i = randInt(rng, 0, affixes.length - 1);
      affixes = affixes.filter((_, idx) => idx !== i);
    } else {
      affixes = [...affixes, { ...pick(rng, NEGATIVE_AFFIXES) }];
    }
  }

  return { ...eq, affixes };
}

// ══════════════════════════════════════════════════════════════
// v1.6 §A.4 属性转移（Affix Transfer）
// ══════════════════════════════════════════════════════════════
// 与「重 roll 式锻造」的关键区别：转移是**单向累积**——目标装备原有词条一条不动，
// 素材词条只做加法。这让玩家的每一次投入都不会倒退，锻造从赌博变成了养成。

export interface TransferLog {
  key: AffixKey;
  keyName: string;
  mode: AffixMode;
  value: number;
  ok: boolean;
  note: string;
}

/** 单条词条转移成功率：P = 0.35 + 0.10 × 素材品质等级（35% / 45% / 55% / 65%） */
export const transferRate = (materialRarity: Rarity): number =>
  0.35 + 0.10 * QUALITY_LEVEL[materialRarity];

export function transferAffixes(
  target: Equipment,
  materials: Equipment[],
  rng: RNG,
): { result: Equipment; logs: TransferLog[] } {
  const affixes: Affix[] = target.affixes.map((a) => ({ ...a, mode: a.mode ?? 'flat' }));
  const logs: TransferLog[] = [];

  for (const mat of materials) {
    const rate = transferRate(mat.rarity);
    const matMult = eqStarMult(mat); // 红装素材带星级加成，星越高转移出的数值越大
    for (const src of mat.affixes) {
      const mode: AffixMode = src.mode ?? 'flat';
      const value = Math.max(1, Math.round(src.value * matMult));
      const keyName = AFFIX_POOL[src.key].name;
      if (rng() >= rate) {
        logs.push({ key: src.key, keyName, mode, value, ok: false, note: '转移失败' });
        continue;
      }
      if (mode === 'flat') {
        // 白值：同 key 累加，不同 key 无限追加
        const hit = affixes.find((a) => a.key === src.key && (a.mode ?? 'flat') === 'flat');
        if (hit) {
          hit.value += value;
          logs.push({ key: src.key, keyName, mode, value, ok: true, note: `累加 → ${hit.value}` });
        } else {
          affixes.push({ key: src.key, value, mode: 'flat' });
          logs.push({ key: src.key, keyName, mode, value, ok: true, note: '新增白值条目' });
        }
      } else {
        // 百分比：同 key 只保留一条，取较大值
        const hit = affixes.find((a) => a.key === src.key && a.mode === 'pct');
        if (hit) {
          if (value > hit.value) {
            const old = hit.value;
            hit.value = value;
            logs.push({ key: src.key, keyName, mode, value, ok: true, note: `覆盖 ${old}% → ${value}%` });
          } else {
            logs.push({ key: src.key, keyName, mode, value, ok: true, note: `低于现有 ${hit.value}%，未覆盖` });
          }
        } else {
          affixes.push({ key: src.key, value, mode: 'pct' });
          logs.push({ key: src.key, keyName, mode, value, ok: true, note: '新增百分比条目' });
        }
      }
    }
  }

  return { result: { ...target, affixes }, logs };
}

// ══════════════════════════════════════════════════════════════
// v1.6 §A.5 合成与红装升星
// ══════════════════════════════════════════════════════════════

/** 合成升阶映射：蓝→橙、橙→红。红装不走升阶，走升星。 */
const FUSE_UP: Partial<Record<Rarity, Rarity>> = { blue: 'orange', orange: 'red' };

export type FuseKind = 'upgrade' | 'ascend';

/** 判断两件装备能否合成，返回合成类型；不可合成返回 null */
export function fuseKindOf(a: Equipment, b: Equipment): FuseKind | null {
  if (a.id === b.id) return null;
  if (a.rarity !== b.rarity) return null;
  if (a.rarity === 'red') {
    // 红 + 红 = 升星；目标（a）必须未满 5 星
    return (a.star ?? 1) < 5 ? 'ascend' : null;
  }
  return FUSE_UP[a.rarity] ? 'upgrade' : null;
}

/**
 * 执行合成。
 * - upgrade：2 件同阶（蓝/橙）→ 1 件随机高阶，词条全新生成
 * - ascend：红 + 红 → 目标 star + 1（封顶 5），词条不变、由 eqStarMult 统一放大
 */
export function fuseEquipment(a: Equipment, b: Equipment, rng: RNG): Equipment | null {
  const kind = fuseKindOf(a, b);
  if (!kind) return null;
  if (kind === 'ascend') {
    return { ...a, star: Math.min(5, (a.star ?? 1) + 1) };
  }
  const up = FUSE_UP[a.rarity]!;
  const eq = generateEquipment(rng, up);
  eq.opened = true; // 合成产物直接可用，不需要再开箱
  return eq;
}

