// v2.4.7 整备界面拆分 · 共享类型
// 页面键 + 装备子页签 + 「建议下一步」跳页目标。
export type PageKey = 'report' | 'team' | 'supply' | 'gear';
export type GearSub = 'equip' | 'forge';
export type GuideTarget = { page: PageKey; sub?: GearSub };
