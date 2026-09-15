// v3.1 性格系统（索敌偏好）
//
// 设计动机：此前「同队三个近战」的行为完全一致——都打最近的那个，
// 站位是玩家唯一能表达意图的手段，角色本身没有性格。
// 体型解决了「长得不一样」，性格要解决「打法不一样」：
// 同样一把剑，攻坚者去凿前排，专业刺客绕后掏输出，猎手追残血收人头。
//
// 约束：
//   1) 性格只影响**索敌偏好**，不给任何数值加成。它是风味与战术变量，
//      不是第三条养成线——否则玩家会去刷性格，而不是玩阵容。
//   2) 纯数据 + 纯函数，无随机、无副作用：战斗确定性不能被性格破坏。
//   3) 嘲讽（tauntUntil）优先级高于性格。控制类效果必须能压过个性，
//      否则前排的存在意义被削掉一半。
import { PersonalityId } from '../types';

export interface PersonalityInfo {
  id: PersonalityId;
  cn: string;
  /** 面板长描述 */
  desc: string;
  /** 一行短标签（棋子 tooltip / chip） */
  hint: string;
  /** 生成权重：随遇而安略高，避免全队都是极端个性 */
  weight: number;
  color: string;
}

export const PERSONALITIES: Record<PersonalityId, PersonalityInfo> = {
  valiant: {
    id: 'valiant', cn: '不畏强暴', weight: 1, color: '#ff8a5c',
    hint: '优先打满血敌人',
    desc: '专挑还站得笔直的打——优先攻击生命值高于 80% 的敌人。压制力强，但不擅长收尾。',
  },
  hunter: {
    id: 'hunter', cn: '猎手', weight: 1, color: '#6fd36f',
    hint: '优先打残血敌人',
    desc: '追着残血走——优先攻击当前生命百分比最低的敌人。收割效率高，容易被诱饵牵走。',
  },
  breaker: {
    id: 'breaker', cn: '攻坚者', weight: 1, color: '#5a9bd6',
    hint: '优先打敌方前排',
    desc: '硬碰硬凿开阵线——优先攻击敌方前排。稳，但很难摸到对面的输出核心。',
  },
  assassin: {
    id: 'assassin', cn: '专业刺客', weight: 1, color: '#c07bff',
    hint: '优先打敌方后排',
    desc: '绕开肉盾直取要害——优先攻击敌方后排。威胁最大，也最容易被前排半路截住。',
  },
  savior: {
    id: 'savior', cn: '救困扶危', weight: 1, color: '#ffd23f',
    hint: '优先打敌方最强者',
    desc: '谁最凶就冲谁——优先攻击战力评分最高的敌人。专治核心，代价是常年在啃硬骨头。',
  },
  steady: {
    id: 'steady', cn: '随遇而安', weight: 1.6, color: '#9aa4b8',
    hint: '就近选择目标',
    desc: '不挑食，谁近打谁（远程仍偏好残血）。没有偏科，也就没有短板。',
  },
};

export const PERSONALITY_IDS = Object.keys(PERSONALITIES) as PersonalityId[];

/** 加权抽取（确定性：由调用方传入 0~1 的随机数） */
export function rollPersonality(r: number): PersonalityId {
  const total = PERSONALITY_IDS.reduce((s, id) => s + PERSONALITIES[id].weight, 0);
  let x = r * total;
  for (const id of PERSONALITY_IDS) {
    x -= PERSONALITIES[id].weight;
    if (x <= 0) return id;
  }
  return 'steady';
}

export const personalityCn = (p?: PersonalityId) => (p ? PERSONALITIES[p].cn : '—');
