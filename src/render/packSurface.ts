// 仿真快照的「渲染读取字段」白名单 + 打包器。
//
// 背景：Worker 路径每 50ms 把整份战斗状态 postMessage 回主线程，postMessage 会对整条
// 消息做结构化克隆。Unit 接口有 ~110 字段，但渲染层（drawFrame / ArenaCanvas / sprites）
// 实际只读取其中约 48 个；其余多为引擎内部数据（primary/derived/skill/mountSkill 嵌套对象、
// name/title 字符串），是每帧克隆最贵且完全无用的部分。
//
// 本模块把快照里的 units 从「整份 Unit」降级为「仅渲染读取字段的 Pick」，显著缩小跨线程
// 克隆体积与 GC 压力。'arena' 静态数据不走快照（见 SimController）。
//
// ⚠ 维护契约：若渲染层新增对 Unit 字段的读取，必须同步加入 UNIT_FIELDS，否则该字段在
//    Worker 快照里缺失 → 视觉回归且 TypeScript 不会报错（运行时才暴露）。
//    校验脚本 scripts/verify-snapshot-packing.mjs 会在静态（R⊆P）与动态（真实战斗断言）
//    两个层面守住这条契约 —— 改渲染读取字段后务必跑 `npm run packcheck`。
//
// 注意：本文件刻意使用相对路径引入 core 类型，以便 Node(esbuild) 校验脚本也能直接打包，
// 不依赖 Vite 的 @arena/core 别名。
import type { Unit } from '../../packages/core/src/types';

/** 渲染层实际读取的 Unit 字段（与 src/render 全部 `u.<field>` 访问逐一对应，穷举所得）。 */
export const UNIT_FIELDS = [
  // 身份 / 阵营
  'id', 'side', 'subclass', 'bodyType', 'gender',
  // 位置 / 插值
  'x', 'y', 'prevX', 'prevY', 'facing',
  // 生命 / 护盾
  'hp', 'maxHp', 'shield', 'alive',
  // 战斗动作状态（渲染层读取，引擎确定性写入）
  'attackAnimAt', 'castAnimAt', 'moveAnimUntil', 'deadAt', 'flash', 'isHeavyHit', 'heavyReady',
  // 受控 / 位移状态
  'rootUntil', 'stunUntil', 'tauntUntil', 'kdUntil', 'slowUntil', 'ccColor',
  // 体型 / 外观
  'hitRadius', 'star', 'dupIndex', 'summonKind', 'monsterKind', 'mount', 'mountRarity', 'mountCd',
  // 召唤 / 建筑
  'isSummon', 'summonUntil', 'summonTotal', 'isBuilding', 'buildingKind', 'spawnTimer',
  // 特性 / 焦点
  'traitId', 'traitStacks', 'focusRole',
  // 坐骑 / 滑步 / 稳桩
  'braceUntil', 'glideUntil', 'lastDodgeAt',
  // Boss 标记
  'isBoss',
] as const;

export type PackedUnit = Pick<Unit, (typeof UNIT_FIELDS)[number]>;

/** 把完整 Unit 打包为仅含渲染字段的精简对象。只复制 UNIT_FIELDS，跳过所有引擎内部字段。 */
export function packUnit(u: Unit): PackedUnit {
  const o: Record<string, unknown> = {};
  const src = u as unknown as Record<string, unknown>;
  for (const k of UNIT_FIELDS) o[k] = src[k];
  return o as PackedUnit;
}
