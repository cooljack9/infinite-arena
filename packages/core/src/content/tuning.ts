// 外部调参 / MOD 化（对齐《优化方向需求文档》§6.2 开源二次开发适配）
//
// Pure Core：本文件零 IO。核心只负责「应用调参」；
// 数据怎么来（前端 fetch tuning.json / Edge 从 DB 读）由宿主负责。
// 前端实现见 src/boot/loadTuning.ts。

import { overrideScaling, type ScaleCfg } from '../engine/scaling';

export interface Tuning {
  /** 无尽缩放曲线参数（见 scaling.ts 的 ScaleCfg） */
  scaling?: Partial<ScaleCfg>;
}

/** 当前生效的调参（可被运行时覆盖） */
export const TUNING: Tuning = {};

/** 合并外部调参并即时应用到各子系统 */
export function applyTuning(t: Tuning): void {
  if (t.scaling) overrideScaling(t.scaling);
  Object.assign(TUNING, t);
}

