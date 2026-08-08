// 召唤师三类召唤物（需求 v1.4 §5.2.2；美术 §7.4）
//
// 原设计「召唤 1 个 150%INT 的通用单位」的致命问题是：它不产生任何玩家决策。
// 拆成三类之后，每类服务一个明确的战场缺口，且选型规则可播报——
// 自动战斗里最忌讳「召唤了但玩家不知道为什么」。
import { SummonKind, SummonTemplate, Unit } from '../types';

// HP × 攻击 的乘积近似守恒（13200 / 10400 / 9900）。
// 肉盾略高是因为它的攻击几乎不产出，把预算还回生存是合理的。
export const SUMMON_TEMPLATES: Record<SummonKind, SummonTemplate> = {
  bulwark: {
    kind: 'bulwark',
    name: '石魂卫',
    bodyType: 'heavy',
    hpRatio: 2.20, atkRatio: 0.60,
    moveMult: 0.75, range: 1.1,
    duration: 18,           // 要撑过一整个交火窗口才有意义
    color: '#8a7a5a', riftColor: '#8a7a5a',
    riftW: 30, riftH: 54,   // 最宽的裂隙 = 最重的出场
    spawnAnim: 0.35,
    logReason: '阵线告急',
  },
  sprinter: {
    kind: 'sprinter',
    name: '影刃仆',
    bodyType: 'petite',
    hpRatio: 0.80, atkRatio: 1.30,
    moveMult: 1.60,         // 全场最快。「极速冲刺」四个字必须由数值兑现
    range: 1.1,
    duration: 10,           // 冲刺型只在窗口期有用，长了就是站场刷屏
    color: '#4a2a6a', riftColor: '#4a2a6a',
    riftW: 12, riftH: 40,   // 细长裂隙 + 0.08s 瞬开
    spawnAnim: 0.08,
    logReason: '捕捉残血',
  },
  arcanist: {
    kind: 'arcanist',
    name: '咒火灵',
    bodyType: 'light',
    hpRatio: 0.90, atkRatio: 1.10,
    moveMult: 1.00, range: 5.5,
    duration: 14,           // 消耗需要时间累积，但不该盖过本体
    color: '#ff6b2a', riftColor: '#ff6b2a',
    riftW: 22, riftH: 40,
    spawnAnim: 0.40,        // 由火星聚合成形
    logReason: '战线胶着',
  },
};

export const MAX_SUMMONS = 2; // 保住铺场体感，挡住深层刷屏与可读性崩坏

/**
 * 召唤选型（需求 §5.2.2）。
 * 三条判定的价值不在于最优，而在于**可播报**——日志打一行字，
 * 玩家立刻建立「原来它会看场上情况」的心智模型。
 * lastKind 用于保底轮换：连出三个同类型，玩家只会觉得系统坏了。
 */
export function pickSummonKind(
  allies: Unit[],
  enemies: Unit[],
  lastKind?: SummonKind,
): { kind: SummonKind; reason: string } {
  const order: SummonKind[] = [];

  const aliveTanks = allies.filter(
    u => u.alive && !u.isSummon && (u.subclass === 'physTank' || u.subclass === 'magicTank'),
  ).length;
  if (aliveTanks === 0) order.push('bulwark');

  const hasWounded = enemies.some(u => u.alive && u.hp / Math.max(1, u.maxHp) < 0.40);
  if (hasWounded) order.push('sprinter');

  order.push('arcanist');
  // 兜底把三类都塞进候选，保证轮换永远有解
  for (const k of ['bulwark', 'sprinter', 'arcanist'] as SummonKind[]) {
    if (!order.includes(k)) order.push(k);
  }

  const kind = order.find(k => k !== lastKind) ?? order[0];
  return { kind, reason: SUMMON_TEMPLATES[kind].logReason };
}
