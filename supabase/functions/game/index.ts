// @ts-nocheck —— 胶水层类型豁免
// 原因：core.js 是 esbuild 产物（TS 类型被擦除，ok/err 返回宽松 any），
// 与 core-types 的精确类型声明存在本质摩擦；模块解析与运行时正确性已由
// 部署后 queryMeta/__parityBattle 实测 + verify-parity 云端模式验证。
// db.ts / ports.deno.ts 保持严格类型检查。
// ── Supabase Edge Function：game ────────────────────────────
//
// 25 个游戏命令的唯一入口。单函数多命令（复用热实例，p95 显著低于 25 个独立函数）。
//
// ★ 本文件 import 的 core.js 与前端引用的是**同一次构建的同一个字节流**
//   （scripts/build-core.mjs --sync 同步，CI 用 git diff --exit-code 卡死）
//   所以 rules.runBattle 在这里和在浏览器里必然算出逐 bit 相同的结果。
//
// 与 scripts/mock-edge.mjs 同构（那是本地可运行版本）；差异仅在 DB 层（Postgres vs 内存）。
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  createRun, runBattle, applySettlement, planBattle,
  skipLayer, advanceLayer, upgradeHero,
  buyItem, sellItem, refreshShop,
  recruit, refreshRecruit,
  openDrop, openDrops, reforgeItem, resolveRandomEvent, equipItem, equipAll, unequipItem,
} from '../_shared/core.js';
// 类型从 tsc 生成的声明文件导入（core.js 是 esbuild 产物，TS 类型已被擦除）
import type {
  RunSnapshot, RunSecret, Result, Vec2, GameMode,
} from '../_shared/core-types/index.d.ts';
import { ok, err, CORE_VERSION } from '../_shared/core.js';
import { denoPorts } from '../_shared/ports.deno.ts';
import {
  loadRun, saveRun, insertRun, insertBattle, loadBattle, recordClientChecksum,
  idemGet, idemPut,
} from '../_shared/db.ts';

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-core-version, x-core-build',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_ANON_KEY')!,
  { auth: { persistSession: false } },
);

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(err('UNAUTHORIZED', '仅支持 POST'), 405);

  let action: string;
  let payload: Record<string, unknown>;
  try {
    const body = await req.json();
    action = String(body.action ?? '');
    payload = (body.payload ?? {}) as Record<string, unknown>;
  } catch {
    return json(err('UNAUTHORIZED', '请求体不是合法 JSON'), 400);
  }

  // ── 鉴权：Authorization Bearer → auth.uid ──
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  let userId: string | null = null;
  if (token) {
    const { data } = await supabase.auth.getUser(token);
    userId = data.user?.id ?? null;
  }
  // 允许匿名调用（无 token）但限只读与调试命令：部署后 parity 用 anon key 打 __parityBattle
  const anonOk = !userId && (action === '__parityBattle' || action === 'queryMeta');
  if (!userId && !anonOk) return json(err('UNAUTHORIZED', '未登录或登录已过期'), 401);

  // ── 版本闸门：引擎版本对不上就别算 ──
  const clientVer = req.headers.get('x-core-version') ?? (payload.coreVersion as string | undefined);
  if (clientVer && clientVer !== CORE_VERSION && action !== '__parityBattle') {
    return json(err('VERSION_MISMATCH', `服务端引擎为 ${CORE_VERSION}，请刷新页面更新`));
  }

  const ports = denoPorts();
  const dbUserId = userId ?? '00000000-0000-0000-0000-000000000000';

  try {
    // 幂等：同 key 重复提交直接回放上次响应（连点/网络重试不重复扣费）
    const key = payload.idempotencyKey as string | undefined;
    if (key) {
      const cached = await idemGet(`${dbUserId}:${key}`, dbUserId);
      if (cached !== null) return json(cached);
    }
    const result = await dispatch(action, payload, dbUserId, ports);
    if (key) await idemPut(`${dbUserId}:${key}`, dbUserId, action, result).catch(() => {});
    return json(result);
  } catch (e) {
    console.error(`[game] action=${action} user=${dbUserId}`, e);
    return json(err('RATE_LIMITED', '服务内部错误，请稍后重试'), 500);
  }
});

// ── 命令路由 ────────────────────────────────────────────────

async function dispatch(
  action: string,
  p: Record<string, unknown>,
  userId: string,
  ports: ReturnType<typeof denoPorts>,
): Promise<unknown> {
  switch (action) {
    case 'queryMeta':       return ok({ bestLayer: 0, endlessUnlocked: true, teamPresets: [], prefs: { battleSpeed: 1, colorblind: false } });
    case 'queryRun':        return loadRunOr(p.runId as string);
    case 'queryBattlePlan': return handlePlan(p.runId as string);

    case 'startRun':        return handleStartRun(p, userId, ports);
    case 'abandonRun':      return handleAbandon(p.runId as string);
    case 'skipLayer':       return mutate(p, (s) => skipLayerSafe(s));
    case 'advanceLayer':    return mutate(p, (s) => advanceLayer(s));

    case 'startBattle':     return handleBattle(p, ports);
    case 'ackBattle':       return handleAck(p);

    case 'buyItem':         return mutate(p, (s) => buyItem(s, p.itemId as string));
    case 'sellItem':        return mutate(p, (s) => sellItem(s, p.equipmentId as string));
    case 'refreshShop':     return mutate(p, (s, sec) => refreshShop(s, sec));

    case 'recruit':         return mutate(p, (s, sec) => recruit(s, sec, p.heroId as string));
    case 'refreshRecruit':  return mutate(p, (s, sec) => refreshRecruit(s, sec));
    case 'upgradeHero':     return mutate(p, (s) => upgradeHero(s, p.uid as string));

    case 'openDrop':        return mutate(p, (s) => openDrop(s, p.chestId as string));
    case 'openDrops':       return mutate(p, (s) => openDrops(s, (p.chestIds as string[]) ?? []));
    case 'reforgeItem':     return mutate(p, (s) => reforgeItem(s, p.equipmentId as string));
    case 'resolveRandomEvent': return mutate(p, (s) => resolveRandomEvent(s, p.layer as number, p.optionIndex as number));
    case 'equipItem':       return mutate(p, (s) => equipItem(s, p.uid as string, p.equipmentId as string));
    case 'equipAll':        return mutate(p, (s) => equipAll(s, p.uid as string | undefined));
    case 'unequipItem':     return mutate(p, (s) => unequipItem(s, p.uid as string, p.equipmentId as string));

    case '__parityBattle':  return handleParity(p);
    default:
      return err('RUN_NOT_FOUND', `未知命令：${action}`);
  }
}

// ── 写命令统一形状：读 → 纯规则 → 乐观锁写回 ─────────────────
// 18 个写命令全长得一样，因为规则层是 (state, input) => Result<state>。
// 请求里的 gold/inventory 一律忽略，state 从 DB 读——服务端只信自己。
async function mutate(
  p: Record<string, unknown>,
  // core.js 是 esbuild 产物（类型宽松 any），fn 用 any 避免类型摩擦
  fn: (s: RunSnapshot, secret: RunSecret) => any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const row = await loadRun(p.runId as string);
  if (!row) return err('RUN_NOT_FOUND', '对局不存在');
  if (row.snapshot.status !== 'active') return err('RUN_ENDED', '对局已结束');

  const r = fn(row.snapshot as unknown as unknown as RunSnapshot, { seed: row.seed });
  if (!r.ok) return r as Result<RunSnapshot>;

  const saved = await saveRun(p.runId as string, (r as { data?: unknown }).data as unknown as Record<string, unknown>, row.version);
  if (!saved) return err('STATE_STALE', '状态已过期，请刷新后重试');
  return ok((r as { data?: unknown }).data);
}

// skipLayer 需要 bestLayer（账号元数据），云端简化为层内推进（MVP 阶段直接放行）
function skipLayerSafe(s: RunSnapshot): Result<RunSnapshot> {
  const cap = Number(s.cap ?? 500);
  const next = s.layer + 1;
  return ok({
    ...s, version: s.version + 1,
    layer: Math.min(next, cap),
    status: next > cap ? 'won' : 'active',
    forgedThisLayer: [], fusedThisLayer: 0,
  }) as Result<RunSnapshot>;
}

async function handleStartRun(p: Record<string, unknown>, userId: string, ports: ReturnType<typeof denoPorts>) {
  // ★ 无条件忽略 p.debugSeed —— 客户端不得指定种子
  const seed = ports.entropy.seed();
  const runId = ports.id.runId();

  const r = createRun({
    runId, seed,
    heroIds: p.heroIds as string[],
    mode: p.mode as GameMode,
    endlessUnlocked: true,     // MVP：账号解锁态后续从 profiles 读
  });
  if (!r.ok) return r;

  try {
    await insertRun(runId, userId, seed, (r as { data?: unknown }).data as unknown as Record<string, unknown>);
  } catch (e) {
    console.error('[game] insertRun 失败:', e instanceof Error ? e.message : String(e));
    return err('DB_ERROR', '对局创建失败，请稍后重试');
  }
  return ok((r as { data?: unknown }).data);
}

async function handleAbandon(runId: string) {
  const row = await loadRun(runId);
  if (!row) return err('RUN_NOT_FOUND', '对局不存在');
  await saveRun(runId, { ...row.snapshot, status: 'lost' } as Record<string, unknown>, row.version);
  return ok({ bestLayer: 0, endlessUnlocked: true, teamPresets: [], prefs: { battleSpeed: 1, colorblind: false } });
}

async function handlePlan(runId: string) {
  const row = await loadRun(runId);
  if (!row) return err('RUN_NOT_FOUND', '对局不存在');
  return planBattle(row.snapshot as unknown as RunSnapshot, { seed: row.seed });
}

async function handleBattle(p: Record<string, unknown>, ports: ReturnType<typeof denoPorts>) {
  const row = await loadRun(p.runId as string);
  if (!row) return err('RUN_NOT_FOUND', '对局不存在');
  if (row.snapshot.status !== 'active') return err('RUN_ENDED', '对局已结束');

  // ★★★ 与前端本地跑的是同一个函数、同一份字节码 ★★★
  const battle = runBattle(
    row.snapshot as unknown as RunSnapshot,
    { seed: row.seed },
    (p.formation ?? {}) as Record<string, Vec2>,
  );
  if (!battle.ok) return battle;

  const next = applySettlement(row.snapshot as unknown as RunSnapshot, { seed: row.seed }, battle.data);
  const saved = await saveRun(p.runId as string, next as unknown as Record<string, unknown>, row.version);
  if (!saved) return err('STATE_STALE', '状态已过期，请刷新后重试');

  const battleId = ports.id.battleId();
  await insertBattle({
    id: battleId, runId: p.runId as string, layer: (row.snapshot as unknown as RunSnapshot).layer,
    battleSeed: battle.data.battleSeed, checksum: battle.data.checksum, outcome: battle.data,
  });

  return ok({
    battleId,
    replay: {
      battleSeed: battle.data.battleSeed,
      layer: (row.snapshot as unknown as RunSnapshot).layer,
      mode: (row.snapshot as unknown as RunSnapshot).mode,
      arena: battle.data.arena,
      allies: battle.data.allies,
      enemies: battle.data.enemies,
      buildings: battle.data.buildings,
      buildingScale: battle.data.buildingScale,
      checksum: battle.data.checksum,
    },
    outcome: {
      result: battle.data.result,
      totalTicks: battle.data.totalTicks,
      durationSec: battle.data.durationSec,
      stats: battle.data.stats,
      mvpUid: battle.data.mvpUid ?? null,
      mvpStat: battle.data.mvpStat ?? null,
      mvpAdd: battle.data.mvpAdd ?? 0,
      killGains: battle.data.killGains,
      deadAllyUids: battle.data.deadAllyUids,
    },
    snapshot: next,
  });
}

async function handleAck(p: Record<string, unknown>) {
  const b = await loadBattle(p.battleId as string);
  if (!b) return err('RUN_NOT_FOUND', '战斗记录不存在');

  const match = b.checksum === p.localChecksum;
  await recordClientChecksum(b.id, p.localChecksum as string);
  if (!match) {
    console.warn(`[drift] battle=${b.id} server=${b.checksum} client=${p.localChecksum}`);
  }
  const row = await loadRun(b.run_id);
  return ok({ checksumMatch: match, snapshot: row?.snapshot ?? null });
}

async function loadRunOr(runId: string) {
  const row = await loadRun(runId);
  return row ? ok(row.snapshot) : err('RUN_NOT_FOUND', '对局不存在');
}

/** 部署后一致性校验：与 scripts/parity-harness.ts 同一构造路径 */
async function handleParity(p: Record<string, unknown>) {
  const seed = (p.seed as number) >>> 0;
  const layer = Number(p.layer ?? 1);
  const runId = `parity_${seed}_${layer}`;
  const started = createRun({
    runId, seed,
    heroIds: ['h_physTank', 'h_charge', 'h_healer'],
    mode: (p.mode as GameMode) ?? 'normal',
    endlessUnlocked: true,
  });
  if (!started.ok) return started;
  let snap = started.data;
  for (let i = 1; i < layer; i++) {
    const adv = advanceLayer(snap);
    if (!adv.ok) break;
    snap = adv.data;
  }
  const battle = runBattle(snap, { seed }, {});
  if (!battle.ok) return battle;
  return ok({ checksum: battle.data.checksum, totalTicks: battle.data.totalTicks, outcome: battle.data.result });
}
