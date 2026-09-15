// ── DB 访问层：runs/battles/idempotency_keys/game_config ─────
// 客户端 RLS 只读不写；本层以 service_role 身份读写（绕过 RLS）。
// 核心纪律：snapshot 与 seed 是两列，天然不会误下发。
import { createClient } from 'npm:@supabase/supabase-js@2';
import { CORE_VERSION } from './core.js';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

export interface RunRow {
  id: string;
  version: number;
  snapshot: Record<string, unknown>;
  seed: number;
  status: string;
}

/** 读对局（snapshot + secret 分离，见 0001_schema.sql） */
export async function loadRun(runId: string): Promise<RunRow | null> {
  const { data, error } = await supabase
    .from('runs')
    .select('id, version, snapshot, seed, status')
    .eq('id', runId)
    .maybeSingle();
  if (error || !data) return null;
  return data as RunRow;
}

/**
 * 乐观锁写回：version 对不上 → 影响 0 行 → 返回 false（STATE_STALE）。
 * 挡多标签页并发与恶意重放；网络重试靠 idempotency_keys。
 */
export async function saveRun(runId: string, snapshot: Record<string, unknown>, expectVersion: number): Promise<boolean> {
  // ★ 判定用 data.length：update 的 count 恒为 null（PostgREST 实测），data 才是更新到的行；
  //   用 count 判定会永远 false → 假 STATE_STALE。故直接 .select('id') 取行数，无需强转 hack。
  const { error, data } = await supabase
    .from('runs')
    .update({
      snapshot,
      version: expectVersion + 1,
      layer: (snapshot.layer as number) ?? 1, // 排行榜物化视图按此列排序
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .eq('version', expectVersion)
    .select('id');
  return !error && Array.isArray(data) && data.length > 0;
}

/** 新建对局（seed 只在写路径出现，读走 runs_public 视图） */
// ★ 必须带 user_id（表 NOT NULL + FK auth.users）；失败必须抛——
//   静默吞错 = startRun 假成功 → 后续 startBattle 查不到 run → 玩家画面卡死（已踩坑）
export async function insertRun(runId: string, userId: string, seed: number, snapshot: Record<string, unknown>): Promise<void> {
  // ★ 必须带 user_id（表 NOT NULL + FK auth.users）；core_version 列 NOT NULL 取 CORE_VERSION
  //   （snapshot 是 RunSnapshot，无 coreVersion 字段）；失败必须抛——
  //   静默吞错 = startRun 假成功 → 后续 startBattle 查不到 run → 玩家画面卡死（已踩坑）
  const { error } = await supabase.from('runs').insert({
    id: runId, user_id: userId, seed, snapshot,
    core_version: CORE_VERSION,
    // ★ 与快照一致：createRun 的 version=0；DB 默认 1 会导致乐观锁错位
    version: (snapshot.version as number) ?? 0,
    status: 'active',
  });
  if (error) throw new Error(`insertRun failed: ${error.message}`);
}

export async function insertBattle(row: {
  id: string; runId: string; layer: number; battleSeed: number;
  checksum: string; outcome: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.from('battles').insert({
    id: row.id, run_id: row.runId, layer: row.layer,
    battle_seed: row.battleSeed, checksum: row.checksum, outcome: row.outcome,
  });
  if (error) throw new Error(`insertBattle failed: ${error.message}`);
}

export async function loadBattle(battleId: string) {
  const { data } = await supabase.from('battles').select('*').eq('id', battleId).maybeSingle();
  return data ?? null;
}

/** 同层幂等：取某对局某一层最近一次已结算的 battle 行（重复开战/重试时直接回放，不再重算） */
export async function loadBattleByRunLayer(runId: string, layer: number) {
  const { data } = await supabase
    .from('battles')
    .select('*')
    .eq('run_id', runId)
    .eq('layer', layer)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function recordClientChecksum(battleId: string, checksum: string): Promise<void> {
  await supabase.from('battles').update({ client_checksum: checksum }).eq('id', battleId);
}

/** 幂等：同 key 第二次进来直接回放上次响应（24h 后 cron 清理） */
export async function idemGet(key: string, userId: string): Promise<unknown | null> {
  const { data } = await supabase
    .from('idempotency_keys').select('response')
    .eq('key', key).eq('user_id', userId)
    .maybeSingle();
  return data?.response ?? null;
}
export async function idemPut(key: string, userId: string, action: string, response: unknown): Promise<void> {
  await supabase.from('idempotency_keys').insert({ key, user_id: userId, action, response });
}
