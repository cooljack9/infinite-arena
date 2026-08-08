// v2.6 §2 坐骑系统（五星解锁）
//
// 设计立场：
//   坐骑不是又一层数值。它要回答一个具体问题——「这个角色现在能做到什么它以前做不到的事」。
//   所以五只坐骑的技能全部对应各自动物**在现实里最突出的那一个物理特征**，
//   而不是随手挂五个不同颜色的 AoE：
//     战象 = 质量   → 踏地震荡，范围眩晕（唯一提供群体硬控的坐骑）
//     玄豹 = 爆发   → 一步扑到残血脸上，收割
//     白额虎 = 威慑 → 虎啸慑退，群体减速 + 自身增伤
//     赤兔 = 速度   → 全队提速，唯一的团队增益坐骑
//     蛮牛 = 冲量   → 直线贯穿，撞飞一整条线
//   五个定位互不重叠，抽到哪只都会改变这个角色在阵中的用法，这才配得上「五星奖励」。
//
// 数值纪律：
//   ride 加成刻意做得「有代价」——战象加血抗但减速，玄豹加爆发但不加生存。
//   全是纯增益的坐骑会让 5★ 变成无脑数值台阶，玩家不会为「抽到哪只」产生任何情绪。
import { MountDef, MountKind, MountRarity } from '../types';
import { RNG } from '../engine/rng';

// v2.9.3 坐骑品质：蓝/橙/紫三档，ride 加成乘子 1.0 / 1.5 / 2.2。
// 坐骑无升级系统——只有面板「刷新召唤」能换（重 roll 种类 + 品质）。
export const MOUNT_RARITY: Record<MountRarity, { cn: string; mult: number; weight: number; color: string }> = {
  blue:   { cn: '蓝',   mult: 1.0, weight: 55, color: '#5aa2ff' },
  orange: { cn: '橙',   mult: 1.5, weight: 33, color: '#ff9a3c' },
  purple: { cn: '紫',   mult: 2.2, weight: 12, color: '#c07bff' },
};
export const MOUNT_RARITY_KEYS: MountRarity[] = ['blue', 'orange', 'purple'];

/** 按权重抽品质：蓝 55% / 橙 33% / 紫 12% */
export function rollMountRarity(rng: RNG): MountRarity {
  const total = MOUNT_RARITY_KEYS.reduce((s, k) => s + MOUNT_RARITY[k].weight, 0);
  let t = rng() * total;
  for (const k of MOUNT_RARITY_KEYS) {
    t -= MOUNT_RARITY[k].weight;
    if (t <= 0) return k;
  }
  return 'blue';
}

export const MOUNTS: Record<MountKind, MountDef> = {
  elephant: {
    kind: 'elephant',
    name: '战象',
    desc: '披甲巨象。踏地如擂鼓，四周敌人站不稳脚。生存与硬控换机动。',
    ride: { hpPct: 0.25, pResistAdd: 8, moveSpeedAdd: -8 },
    skill: {
      id: 'mount_stomp',
      name: '巨象踏阵',
      cd: 11,
      damageType: 'physical',
      desc: '巨象前足踏地，2.8 格内敌人受 220% 物伤并眩晕 1.2 秒',
      skillStyle: 'melee_burst',
      castRange: 2.8,
    },
    body: '#8d8f9c', dark: '#5b5d68', accent: '#c9a227',
  },
  leopard: {
    kind: 'leopard',
    name: '玄豹',
    desc: '黑纹金瞳的猎豹。锁定残血目标一跃即至，专司收割。',
    ride: { critAdd: 10, moveSpeedAdd: 18, atkSpeedAdd: 8 },
    skill: {
      id: 'mount_pounce',
      name: '疾影猎杀',
      cd: 9,
      damageType: 'physical',
      desc: '扑向 7 格内血量最低的敌人，造成 300% 物伤且必定暴击',
      skillStyle: 'charge_dash',
      castRange: 7.0,
    },
    body: '#2f2b3a', dark: '#1a1722', accent: '#e8b23a',
  },
  tiger: {
    kind: 'tiger',
    name: '白额虎',
    desc: '额有王纹的猛虎。一声长啸，四方胆寒——敌人迟滞，骑手气盛。',
    ride: { pDmgPct: 0.18, critAdd: 5, hpPct: 0.08 },
    skill: {
      id: 'mount_roar',
      name: '猛虎啸山',
      cd: 12,
      damageType: 'physical',
      desc: '虎啸慑敌：4 格内敌人减速 50% 持续 2.5 秒，自身伤害提升 25% 持续 5 秒',
      skillStyle: 'bulwark_taunt',
      castRange: 4.0,
    },
    body: '#e8c07a', dark: '#8a6231', accent: '#2b2b2b',
  },
  redhare: {
    kind: 'redhare',
    name: '赤兔',
    desc: '日行千里的赤色神驹。它带起的风会推着整条战线一起前进。',
    ride: { moveSpeedAdd: 30, atkSpeedAdd: 12, dodgeAdd: 6 },
    skill: {
      id: 'mount_gallop',
      name: '千里神驹',
      cd: 14,
      damageType: 'physical',
      desc: '策马扬尘：自身与 5 格内友军移速 +60%、攻速 +25%，持续 5 秒',
      skillStyle: 'blessing_field',
      castRange: 5.0,
    },
    body: '#c0392b', dark: '#7b2318', accent: '#f0d060',
  },
  ox: {
    kind: 'ox',
    name: '蛮牛',
    desc: '双角包铁的巨牛。低头冲起来就不会拐弯，正面挡路的全部撞飞。',
    ride: { hpPct: 0.18, pDmgPct: 0.12, pResistAdd: 5, moveSpeedAdd: -4 },
    skill: {
      id: 'mount_gore',
      name: '蛮牛冲撞',
      cd: 10,
      damageType: 'physical',
      desc: '沿直线冲撞 6 格，途经敌人受 200% 物伤、被撞开并定身 1 秒',
      skillStyle: 'charge_dash',
      castRange: 6.0,
    },
    body: '#4a4238', dark: '#2a251f', accent: '#d9cbb0',
  },
};

export const MOUNT_KINDS: MountKind[] = ['elephant', 'leopard', 'tiger', 'redhare', 'ox'];

/**
 * 随机抽一只坐骑。
 * 五只等权——刻意不做稀有度分层：坐骑之间是「定位不同」而非「强弱不同」，
 * 一旦分了稀有度，玩家就会开始 SL 刷坐骑，而这局游戏的 seed 是锁定的，
 * 那只会变成「重开一局」的挫败感来源。
 */
export function rollMount(rng: RNG): MountKind {
  return MOUNT_KINDS[Math.floor(rng() * MOUNT_KINDS.length)];
}

export const mountOf = (k: MountKind): MountDef => MOUNTS[k];

/** 骑乘加成的可读摘要（角色面板用）——v2.9.3 按品质乘子缩放后展示 */
export function rideSummary(kind: MountKind, rarity?: MountRarity): string {
  const r = MOUNTS[kind].ride;
  const m = rarity ? MOUNT_RARITY[rarity].mult : 1;
  const parts: string[] = [];
  const add = (v: number | undefined, name: string, pct = false) => {
    if (!v) return;
    const x = v * m;
    parts.push(`${name} ${x > 0 ? '+' : ''}${pct ? Math.round(x * 100) + '%' : Math.round(x)}`);
  };
  add(r.hpPct, '生命', true);
  add(r.pDmgPct, '物伤', true);
  add(r.moveSpeedAdd, '移速');
  add(r.atkSpeedAdd, '攻速');
  add(r.critAdd, '暴击');
  add(r.pResistAdd, '物抗');
  add(r.dodgeAdd, '闪避');
  return parts.join(' · ');
}
