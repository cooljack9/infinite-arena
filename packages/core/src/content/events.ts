// 随机奇遇事件池（需求：随机事件）。
//
// 设计约束（与全局「确定性」一致）：
//  · 事件本身由层种子确定性抽取——同一 seed 的同一层必然抽到同一个事件。
//  · 每个选项的「结果」在生成事件时就已算定并写进 effect / desc，
//    玩家看到的就是实际会发生的，不存在「选完才翻骰子」的暗箱。
//  · 效果只动金币 / 背包装备 / 积分，不碰战斗单位，结算可逆、可预期。
import { RandomEvent } from '../types';
import { RNG } from '../engine/rng';

/**
 * 按层种子确定性抽取一个随机事件（或 undefined 表示本层无事件）。
 * 触发节奏：每层基础概率 35%，且避开第 1 层（留给教学）与 Boss 层（避免信息过载）。
 */
export function rollRandomEvent(rng: RNG, layer: number, isBoss: boolean): RandomEvent | undefined {
  if (layer <= 1) return undefined;
  if (isBoss) return undefined;
  if (rng() >= 0.35) return undefined;

  // 统一签名为 (rng) => RandomEvent：多数事件不需要额外随机，但幸运宝箱要在生成时就定胜负。
  const pool: ((r: RNG) => RandomEvent)[] = [mysticMerchant, wanderingVault, sacrificeAltar, luckyChest];
  const pickIdx = Math.floor(rng() * pool.length) % pool.length;
  return pool[pickIdx](rng);
}

// ① 神秘商人：花钱买装备（确定性定价）
function mysticMerchant(): RandomEvent {
  return {
    id: 'mystic_merchant',
    title: '神秘商人',
    desc: '一名披斗篷的商人拦在路口，向你兜售刚从秘境里淘来的装备。',
    options: [
      { label: '花 80 金币 · 蓝装×1', desc: '购入 1 件蓝装（确定性生成）', effect: { gold: -80, give: { rarity: 'blue', count: 1 } } },
      { label: '花 220 金币 · 橙装×1', desc: '购入 1 件橙装（确定性生成）', effect: { gold: -220, give: { rarity: 'orange', count: 1 } } },
      { label: '不买，赶路', desc: '无事发生', effect: {} },
    ],
  };
}

// ② 流浪宝库：免费二选一（装备 or 金币）
function wanderingVault(): RandomEvent {
  return {
    id: 'wandering_vault',
    title: '流浪宝库',
    desc: '一尊无主宝箱静静立在墙角，里面似乎只容你取走一样东西。',
    options: [
      { label: '取 橙装×1', desc: '获得 1 件随机橙装', effect: { give: { rarity: 'orange', count: 1 } } },
      { label: '取 300 金币', desc: '直接拿钱走人', effect: { gold: 300 } },
      { label: '不碰，怕有诈', desc: '无事发生', effect: {} },
    ],
  };
}

// ③ 献祭祭坛：献出最差的一件装备换金币
function sacrificeAltar(): RandomEvent {
  return {
    id: 'sacrifice_altar',
    title: '古老祭坛',
    desc: '祭坛低语：献上一件装备，换取它的精华所化的金币。',
    options: [
      { label: '献祭最差装备 · +180 金币', desc: '销毁背包评分最低的一件装备，得 180 金币', effect: { gold: 180, sacrificeLowest: true } },
      { label: '不献祭', desc: '无事发生', effect: {} },
    ],
  };
}

// ④ 幸运宝箱：结果在生成时即确定（写进 desc，绝不暗箱）
function luckyChest(rng: RNG): RandomEvent {
  const win = rng() < 0.5;
  return {
    id: 'lucky_chest',
    title: '幸运宝箱',
    desc: win
      ? '箱锁一碰就开，金光四溢——里面是 400 金币！'
      : '箱里藏着的不是财宝，而是一窝伏击的刺客，你损失了 150 金币才突围。',
    options: [
      { label: win ? '开箱 · +400 金币' : '开箱 · -150 金币', desc: win ? '稳稳落袋' : '遭遇伏击', effect: { gold: win ? 400 : -150 } },
      { label: '不打开', desc: '绕道而行', effect: {} },
    ],
  };
}
