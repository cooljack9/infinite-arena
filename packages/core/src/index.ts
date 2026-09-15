// ── @arena/core 统一出口（Pure Core）────────────────────────
// 前端与 Supabase Edge Function 都从这里消费。零依赖、零 IO。
//
// engine/content/gen 三个子域不在此聚合（文件多、符号名易冲突），
// 前端按需 subpath 导入：@arena/core/engine/rng、@arena/core/content/equipment 等。
export * from './types';
export * from './contract';
export * from './rules';
export * from './rules/economy';
export { CORE_BUILD_HASH } from './buildinfo';
