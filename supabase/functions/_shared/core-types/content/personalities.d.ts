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
export declare const PERSONALITIES: Record<PersonalityId, PersonalityInfo>;
export declare const PERSONALITY_IDS: PersonalityId[];
/** 加权抽取（确定性：由调用方传入 0~1 的随机数） */
export declare function rollPersonality(r: number): PersonalityId;
export declare const personalityCn: (p?: PersonalityId) => string;
