// 验证 dist 产物可被任意 ESM 运行时加载（模拟 Deno 场景）
// 注：@arena/core 顶层为扁平导出（export * from './rules' 等），无命名空间对象
const m = await import('../packages/core/dist/index.js');
console.log('加载 OK，导出符号数:', Object.keys(m).length);
console.log('CORE_VERSION:', m.CORE_VERSION, '| BUILD_HASH:', m.CORE_BUILD_HASH.slice(0, 12));

const r = m.createRun({
  runId: 't1', seed: 42,
  heroIds: ['h_physTank', 'h_charge', 'h_healer'],
  mode: 'normal', endlessUnlocked: true,
});
console.log('createRun:', r.ok
  ? `OK layer=${r.data.layer} team=${r.data.team.length} status=${r.data.status}`
  : r.message);
if (!r.ok) process.exit(1);
console.log('dist 产物验证通过');
