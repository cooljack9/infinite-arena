// ── LocalBackend：本地通路 ──
// 与 Supabase Edge Function 调用**完全相同的 rules 纯函数**，只是壳不同：
//   LocalBackend      : 内存/localStorage 取状态 → 调 rules → 存回
//   Edge Function     : Postgres 取状态       → 调 rules → 存回
// 规则只有一份，壳有两个。这是双通路不产生分歧的唯一保证。
//
// 注意：本类**不假装网络延迟**。倒计时属于表现层，由前端 useTimedAction 控制，
// 否则 10,080 场封测每场等 5 秒 = 14 小时。
import * as rules from '@arena/core/rules';
import type { RunSecret } from '@arena/core/rules';
import {
  ok, err, CORE_VERSION,
  type GameBackend, type Result, type RunSnapshot, type MetaSnapshot,
  type BattlePlanDTO, type BattleResultDTO, type StartRunReq, type StartBattleReq,
  type AckBattleReq, type CommandEnvelope, type ClimbOptsDTO, type AutoClimbRespDTO,
} from '@arena/core/contract';
import type { Vec2 } from '@arena/core/types';
import { DB } from '@arena/core/content/registry';

interface StoredRun { snapshot: RunSnapshot; secret: RunSecret }

export interface LocalStore {
  getRun(id: string): StoredRun | undefined;
  putRun(r: StoredRun): void;
  getMeta(): MetaSnapshot;
  putMeta(m: MetaSnapshot): void;
  /** 幂等缓存：倒计时内连点 / 网络重试去重 */
  getIdem(key: string): unknown | undefined;
  putIdem(key: string, value: unknown): void;
}

/** 默认内存实现（测试用）。生产走 IndexedDB 版本 */
export class MemoryStore implements LocalStore {
  private runs = new Map<string, StoredRun>();
  private idem = new Map<string, unknown>();
  private meta: MetaSnapshot = {
    bestLayer: 0, endlessUnlocked: false, teamPresets: [],
    prefs: { battleSpeed: 1, colorblind: false },
  };
  getRun(id: string) { return this.runs.get(id); }
  putRun(r: StoredRun) { this.runs.set(r.snapshot.runId, r); }
  getMeta() { return this.meta; }
  putMeta(m: MetaSnapshot) { this.meta = m; }
  getIdem(k: string) { return this.idem.get(k); }
  putIdem(k: string, v: unknown) { this.idem.set(k, v); }
}

export class LocalBackend implements GameBackend {
  private battles = new Map<string, { checksum: string; runId: string }>();
  private seq = 0;

  constructor(private store: LocalStore = new MemoryStore()) {}

  // ── 幂等包装：同 key 重复提交直接返回首次结果 ──
  private idem<T>(key: string, fn: () => Result<T>): Result<T> {
    const cached = this.store.getIdem(key);
    if (cached !== undefined) return cached as Result<T>;
    const res = fn();
    if (res.ok) this.store.putIdem(key, res);   // 只缓存成功结果，失败允许重试
    return res;
  }

  private load(runId: string): StoredRun | null {
    return this.store.getRun(runId) ?? null;
  }

  private commit(r: StoredRun): RunSnapshot {
    this.store.putRun(r);
    // 最佳层推进（只增不减）
    const meta = this.store.getMeta();
    if (r.snapshot.layer > meta.bestLayer) {
      this.store.putMeta({ ...meta, bestLayer: r.snapshot.layer });
    }
    if (r.snapshot.mode === 'novice' && r.snapshot.status === 'won' && !meta.endlessUnlocked) {
      this.store.putMeta({ ...this.store.getMeta(), endlessUnlocked: true });
    }
    return r.snapshot;
  }

  /** 统一的「取状态 → 调规则 → 存回」壳 */
  private mutate(
    req: CommandEnvelope,
    fn: (s: RunSnapshot, secret: RunSecret) => Result<RunSnapshot>,
  ): Promise<Result<RunSnapshot>> {
    return Promise.resolve(this.idem(req.idempotencyKey, () => {
      const cur = this.load(req.runId);
      if (!cur) return err<RunSnapshot>('RUN_NOT_FOUND');
      const res = fn(cur.snapshot, cur.secret);
      if (!res.ok) return res;
      return ok(this.commit({ snapshot: res.data, secret: cur.secret }));
    }));
  }

  // ── 查询 ──────────────────────────────────────────────

  async queryMeta(): Promise<Result<MetaSnapshot>> {
    return ok(this.store.getMeta());
  }

  async queryRun(runId: string): Promise<Result<RunSnapshot>> {
    const r = this.load(runId);
    return r ? ok(r.snapshot) : err('RUN_NOT_FOUND');
  }

  async queryBattlePlan(runId: string): Promise<Result<BattlePlanDTO>> {
    const r = this.load(runId);
    if (!r) return err('RUN_NOT_FOUND');
    return rules.planBattle(r.snapshot, r.secret);
  }

  // ── 生命周期 ───────────────────────────────────────────

  async startRun(req: StartRunReq): Promise<Result<RunSnapshot>> {
    return this.idem(req.idempotencyKey, () => {
      const meta = this.store.getMeta();

      // 宿主职责一：生成 runId（本地时钟风格；远程用 crypto.randomUUID）
      const runId = `run_${Date.now().toString(36)}_${this.seq++}`;

      // 宿主职责二：生成根熵 seed。
      // 本地模式下 Math.random 合理（不上榜）；远程由后端 crypto 生成，
      // debugSeed 在 RemoteBackend 侧无条件剥离。规则组装交给 rules.createRun。
      const seed = req.debugSeed !== undefined
        ? (req.debugSeed >>> 0)
        // det-ok：这里要的就是不确定性——seed 是根熵源，不是演算的一部分。
        // 一旦生成，后续所有推导都由 mulberry32 从它派生，全程确定。
        : (Math.random() * 1e9) | 0;

      // 规则组装（与 Edge Function 同一份）：选人 → variateHero → 初始商店/招募池 → 拼快照
      const r = rules.createRun({
        runId, seed,
        heroIds: req.heroIds,
        mode: req.mode,
        endlessUnlocked: meta.endlessUnlocked,
      });
      if (!r.ok) return r;

      return ok(this.commit({ snapshot: r.data, secret: { seed } }));
    });
  }

  async abandonRun(req: CommandEnvelope): Promise<Result<MetaSnapshot>> {
    const cur = this.load(req.runId);
    if (!cur) return err('RUN_NOT_FOUND');
    this.store.putRun({ ...cur, snapshot: { ...cur.snapshot, status: 'lost' } });
    return ok(this.store.getMeta());
  }

  // v1.8：跳过本层功能下线；原 skipLayer 的「测试推进」职责独立为 advanceLayerTo（仅供 e2e）
  async advanceLayerTo(req: CommandEnvelope & { layer: number }): Promise<Result<RunSnapshot>> {
    return this.mutate(req, (s) => rules.advanceLayerTo(s, req.layer));
  }

  async advanceLayer(req: CommandEnvelope): Promise<Result<RunSnapshot>> {
    return this.mutate(req, (s) => rules.advanceLayer(s));
  }

  // ── 战斗 ──────────────────────────────────────────────

  async startBattle(req: StartBattleReq): Promise<Result<BattleResultDTO>> {
    return Promise.resolve(this.idem(req.idempotencyKey, () => {
      const cur = this.load(req.runId);
      if (!cur) return err<BattleResultDTO>('RUN_NOT_FOUND');

      // ① 权威结算（胜负在这里定，客户端只是回放；v1.8 battleOpts 支持下五层）
      const settled = rules.runBattle(cur.snapshot, cur.secret, req.formation, req.battleOpts);
      if (!settled.ok) return settled as Result<BattleResultDTO>;
      const r = settled.data;

      // ② 结算写回（发奖 / 推层 / 成长；v1.8 下五层按 battleOpts 多层发奖 / 扣 2 容错）
      const nextSnap = rules.applySettlement(cur.snapshot, cur.secret, r, req.battleOpts);
      const saved = this.commit({ snapshot: nextSnap, secret: cur.secret });

      const battleId = `b_${Date.now().toString(36)}_${this.seq++}`;
      this.battles.set(battleId, { checksum: r.checksum, runId: req.runId });

      return ok<BattleResultDTO>({
        battleId,
        replay: {
          battleSeed: r.battleSeed,
          layer: req.battleOpts?.effLayer ?? cur.snapshot.layer, // v1.8 下五层用生效层（建筑 level 入校验和）
          mode: cur.snapshot.mode,
          arena: r.arena,
          allies: r.allies,
          enemies: r.enemies,
          buildings: r.buildings,
          buildingScale: r.buildingScale,
          vanEncounter: r.vanEncounter,
          checksum: r.checksum,
        },
        outcome: {
          result: r.result,
          totalTicks: r.totalTicks,
          durationSec: r.durationSec,
          stats: r.stats,
          mvpUid: r.mvpUid,
          mvpStat: r.mvpStat,
          mvpAdd: r.mvpAdd,
          killGains: r.killGains,
          deadAllyUids: r.deadAllyUids,
        },
        snapshot: saved,
      });
    }));
  }

  async ackBattle(req: AckBattleReq): Promise<Result<{ checksumMatch: boolean; snapshot: RunSnapshot }>> {
    const b = this.battles.get(req.battleId);
    const cur = this.load(req.runId);
    if (!cur) return err('RUN_NOT_FOUND');
    return ok({
      checksumMatch: !!b && b.checksum === req.localChecksum,
      snapshot: cur.snapshot,
    });
  }

  // v1.8 自动爬塔：权威逐层演算 + 结果写回（发奖/跳层/失败容错），返回新快照
  async autoClimb(req: CommandEnvelope & { opts: ClimbOptsDTO; formation: Record<string, Vec2> }): Promise<Result<AutoClimbRespDTO>> {
    return Promise.resolve(this.idem(req.idempotencyKey, () => {
      const cur = this.load(req.runId);
      if (!cur) return err<AutoClimbRespDTO>('RUN_NOT_FOUND');
      const r = rules.autoClimb(cur.snapshot, cur.secret, req.formation, req.opts);
      if (!r.ok) return r as Result<AutoClimbRespDTO>;
      const next = rules.applyAutoClimb(cur.snapshot, cur.secret, r.data);
      const saved = this.commit({ snapshot: next, secret: cur.secret });
      return ok<AutoClimbRespDTO>({ result: r.data, snapshot: saved });
    }));
  }

  // ── 经济（全部转调 rules 纯函数）────────────────────────

  buyItem(req: CommandEnvelope & { itemId: string }) {
    return this.mutate(req, (s) => rules.buyItem(s, req.itemId));
  }
  sellItem(req: CommandEnvelope & { equipmentId: string }) {
    return this.mutate(req, (s) => rules.sellItem(s, req.equipmentId));
  }
  refreshShop(req: CommandEnvelope) {
    return this.mutate(req, (s, sec) => rules.refreshShop(s, sec));
  }
  refreshRecruit(req: CommandEnvelope) {
    return this.mutate(req, (s, sec) => rules.refreshRecruit(s, sec));
  }
  recruit(req: CommandEnvelope & { heroId: string }) {
    return this.mutate(req, (s, sec) => rules.recruit(s, sec, req.heroId));
  }
  upgradeHero(req: CommandEnvelope & { uid: string }) {
    // 规则在 @arena/core/rules：升星占位（version+1），与 Edge Function 一致
    return this.mutate(req, (s) => rules.upgradeHero(s, req.uid));
  }
  openDrop(req: CommandEnvelope & { chestId: string }) {
    return this.mutate(req, (s) => rules.openDrop(s, req.chestId));
  }
  openDrops(req: CommandEnvelope & { chestIds: string[] }) {
    return this.mutate(req, (s) => rules.openDrops(s, req.chestIds));
  }

  reforgeItem(req: CommandEnvelope & { equipmentId: string }) {
    return this.mutate(req, (s) => rules.reforgeItem(s, req.equipmentId));
  }

  resolveRandomEvent(req: CommandEnvelope & { layer: number; optionIndex: number }) {
    return this.mutate(req, (s) => rules.resolveRandomEvent(s, req.layer, req.optionIndex));
  }
  equipItem(req: CommandEnvelope & { uid: string; equipmentId: string }) {
    return this.mutate(req, (s) => rules.equipItem(s, req.uid, req.equipmentId));
  }

  equipAll(req: CommandEnvelope & { uid?: string }) {
    return this.mutate(req, (s) => rules.equipAll(s, req.uid));
  }
  unequipItem(req: CommandEnvelope & { uid: string; equipmentId: string }) {
    return this.mutate(req, (s) => rules.unequipItem(s, req.uid, req.equipmentId));
  }

  // ── v2.4.4 通用数据回路（后端权威查表）─────────────────────
  // 与前端共用同一份 DB 注册表与查询语义；LRU 缓存命中即返回，不重复遍历内容表。
  // 这是「前后端查表走同一通用回路」在后端侧的落地：内容查询收口到 DB，而不是散落的数组 .find。
  getContent(table: string, id: unknown) {
    return ok(DB.get(table, id));
  }
  listContent(table: string) {
    return ok(DB.list(table));
  }
  queryContent(table: string, where?: Record<string, unknown>, opts?: { sort?: string; dir?: 1 | -1; limit?: number }) {
    return ok(DB.query(table, where, opts));
  }
}

export { CORE_VERSION };
