// ── RemoteBackend：走 Supabase Edge Function 的权威通路 ──────
//
// 与 LocalBackend 实现同一个 GameBackend 接口。上层业务代码分辨不出
// 自己在用哪个——这是 useLocalComputation 开关能"零改动切换"的前提。
//
// 设计要点：
//   1. 25 个方法全是同一个 POST，靠 action 字段路由（单函数复用冷启动实例）
//   2. Result<T> 而非 throw —— 错误是数据，要跨 HTTP 边界保真
//   3. v3.4h 不再降级 —— 网络失败如实返回，由前端乐观更新 + 串行队列 + 重试兜底；
//      旧"回落本地 + unverified + syncOffline 补交"会造成本地/云端双局分叉，
//      且 syncOffline 无云端路由（补交必失败），已整体移除
import type {
  GameBackend, Result, MetaSnapshot, RunSnapshot, BattlePlanDTO,
  BattleResultDTO, CommandEnvelope, StartRunReq, StartBattleReq, AckBattleReq,
} from '@arena/core/contract';
import { err, CORE_VERSION } from '@arena/core/contract';
import { CORE_BUILD_HASH } from '@arena/core';

export interface RemoteBackendConfig {
  /** https://<ref>.supabase.co 或本地 mock（http://127.0.0.1:8787） */
  baseUrl: string;
  anonKey: string;
  /** 惰性求值：token 会过期刷新，不能在构造时固化 */
  getToken?: () => string | null;
  /** 单次请求超时（ms）。Edge 冷启动可能到 3s，别设太短 */
  timeoutMs?: number;
}

export class RemoteBackend implements GameBackend {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  /** 匿名会话 token（GoTrue signInAnonymously；refresh 后失效需重建） */
  private sessionToken: string | null = null;
  private sessionPromise: Promise<string | null> | null = null;
  /** v3.4i signup 冷却：匿名注册有频率限制，失败后短窗内不重复撞限流 */
  private lastSignupAt = 0;
  private static readonly SESSION_KEY = 'arena.sb.session';

  constructor(private readonly cfg: RemoteBackendConfig) {
    this.endpoint = `${cfg.baseUrl.replace(/\/+$/, '')}/functions/v1/game`;
    this.timeoutMs = cfg.timeoutMs ?? 15_000;
  }

  private isCloud(): boolean {
    return this.cfg.baseUrl.includes('supabase.co');
  }

  /**
   * 匿名登录（仅云端）：写操作需要真实 auth.user（runs.user_id 有 FK → auth.users）。
   * token 持久化到 localStorage 复用；401 时由调用方清空触发重建。
   * mock 环境（非 supabase.co）没有 auth 端点，跳过登录直接用 anonKey。
   */
  private ensureSession(): Promise<string | null> {
    if (!this.isCloud()) return Promise.resolve(null);
    if (this.sessionToken) return Promise.resolve(this.sessionToken);
    if (!this.sessionPromise) {
      this.sessionPromise = (async () => {
        try {
          const store = typeof localStorage !== 'undefined' ? localStorage : null;
          const cached = store?.getItem(RemoteBackend.SESSION_KEY);
          if (cached) {
            try {
              const c = JSON.parse(cached) as { a?: string; r?: string } | null;
              // v3.4i 优先用 refresh_token 续期（匿名 JWT 1h 过期；刷新 ≠ 新注册，不撞 GoTrue 限流）
              if (c?.r) {
                const t = await this.refreshSession(c.r);
                if (t) {
                  this.sessionToken = t;
                  store?.setItem(RemoteBackend.SESSION_KEY, JSON.stringify({ a: t, r: c.r }));
                  return t;
                }
              } else if (c?.a) {
                this.sessionToken = c.a; // 旧格式（仅 access）
                return c.a;
              }
            } catch { /* 缓存损坏：忽略走 signup */ }
          }
          // v3.4i signup 冷却：失败/限流后 10s 内不重复注册（避免连续开局失败）
          if (Date.now() - this.lastSignupAt < 10000) return null;
          this.lastSignupAt = Date.now();
          const res = await fetch(`${this.cfg.baseUrl.replace(/\/+$/, '')}/auth/v1/signup`, {
            method: 'POST',
            headers: { apikey: this.cfg.anonKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: {} }),
          });
          const b = await res.json();
          if (b?.access_token) {
            this.sessionToken = b.access_token;
            try {
              store?.setItem(RemoteBackend.SESSION_KEY, JSON.stringify({ a: b.access_token, r: b.refresh_token }));
            } catch { /* 隐私模式等 */ }
            return b.access_token;
          }
          return null;
        } catch {
          return null;
        } finally {
          this.sessionPromise = null;
        }
      })();
    }
    return this.sessionPromise;
  }

  /** GoTrue refresh_token 续期：匿名会话过期后优先刷新，而非重新 signup */
  private async refreshSession(refreshToken: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.cfg.baseUrl.replace(/\/+$/, '')}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: this.cfg.anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const b = await res.json();
      return b?.access_token ?? null;
    } catch {
      return null;
    }
  }

  private invalidateSession(): void {
    // v3.4i 只清内存 access：localStorage 里的 refresh_token 留给下次续期（不重注册、不撞限流）
    this.sessionToken = null;
  }

  // ── 传输层 ────────────────────────────────────────────────

  private async call<T>(action: string, payload: unknown = {}): Promise<Result<T>> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const session = await this.ensureSession();
      const token = session ?? this.cfg.getToken?.() ?? null;
      // 测试钩子（v3.4h 网络不稳压测）：仅当全局 __NET_TEST 存在时透传，生产无值零影响
      const netTest = (globalThis as { __NET_TEST?: { delayMs?: string; failRate?: number } }).__NET_TEST;
      const reqPayload = netTest && typeof payload === 'object' && payload !== null
        ? { ...payload, __net: netTest }
        : payload;
      const res = await fetch(this.endpoint, {
        method: 'POST',
        signal: ac.signal,
        headers: {
          'Content-Type': 'application/json',
          apikey: this.cfg.anonKey,
          Authorization: `Bearer ${token ?? this.cfg.anonKey}`,
          'X-Core-Version': CORE_VERSION,
          'X-Core-Build': CORE_BUILD_HASH,
        },
        body: JSON.stringify({ action, payload: reqPayload }),
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          this.invalidateSession(); // 匿名 token 过期：下次请求重建
          return err<T>('UNAUTHORIZED', '登录已过期，请重试');
        }
        if (res.status >= 500) return err<T>('RATE_LIMITED', `服务暂时不可用 (${res.status})`);
        if (res.status === 429) return err<T>('RATE_LIMITED', '操作过于频繁，请稍候');
        return err<T>('RATE_LIMITED', `请求失败 (${res.status})`);
      }

      const body = (await res.json()) as Result<T>;
      if (body.ok === false && body.coreVersion !== CORE_VERSION) {
        return err<T>('VERSION_MISMATCH', `客户端 ${CORE_VERSION} / 服务端 ${body.coreVersion}，请刷新页面`);
      }
      return body;
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      return err<T>('RATE_LIMITED', aborted ? '请求超时' : '网络不可用');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * v3.4h 统一入口：网络/服务失败如实返回（不降级）——前端乐观更新 + 串行队列 +
   * 失败提示/重试已兜底；降级会制造本地/云端双局分叉（已移除）。
   */
  private async callOr<T>(
    action: string,
    payload: unknown,
    _localFn: (b: GameBackend) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    return this.call<T>(action, payload);
  }

  // ── 查询 ──────────────────────────────────────────────────

  queryMeta(): Promise<Result<MetaSnapshot>> {
    return this.callOr('queryMeta', {}, (b) => b.queryMeta());
  }
  queryRun(runId: string): Promise<Result<RunSnapshot>> {
    return this.callOr('queryRun', { runId }, (b) => b.queryRun(runId));
  }
  queryBattlePlan(runId: string): Promise<Result<BattlePlanDTO>> {
    return this.callOr('queryBattlePlan', { runId }, (b) => b.queryBattlePlan(runId));
  }

  // ── 生命周期 ──────────────────────────────────────────────

  startRun(req: StartRunReq): Promise<Result<RunSnapshot>> {
    // ★ debugSeed 在此剥离：种子是掉落/Boss/商店的母体，允许客户端指定 = 允许刷开局
    const { debugSeed: _drop, ...safe } = req;
    return this.callOr('startRun', safe, (b) => b.startRun(req));
  }
  abandonRun(req: CommandEnvelope): Promise<Result<MetaSnapshot>> {
    return this.callOr('abandonRun', req, (b) => b.abandonRun(req));
  }
  skipLayer(req: CommandEnvelope): Promise<Result<RunSnapshot>> {
    return this.callOr('skipLayer', req, (b) => b.skipLayer(req));
  }
  advanceLayer(req: CommandEnvelope): Promise<Result<RunSnapshot>> {
    return this.callOr('advanceLayer', req, (b) => b.advanceLayer(req));
  }

  // ── 战斗 ──────────────────────────────────────────────────

  startBattle(req: StartBattleReq): Promise<Result<BattleResultDTO>> {
    return this.callOr('startBattle', req, (b) => b.startBattle(req));
  }
  ackBattle(req: AckBattleReq): Promise<Result<{ checksumMatch: boolean; snapshot: RunSnapshot }>> {
    return this.callOr('ackBattle', req, (b) => b.ackBattle(req));
  }

  // ── 商店 ──────────────────────────────────────────────────

  buyItem(req: CommandEnvelope & { itemId: string }): Promise<Result<RunSnapshot>> {
    return this.callOr('buyItem', req, (b) => b.buyItem(req));
  }
  sellItem(req: CommandEnvelope & { equipmentId: string }): Promise<Result<RunSnapshot>> {
    return this.callOr('sellItem', req, (b) => b.sellItem(req));
  }
  refreshShop(req: CommandEnvelope): Promise<Result<RunSnapshot>> {
    return this.callOr('refreshShop', req, (b) => b.refreshShop(req));
  }

  // ── 英雄 ──────────────────────────────────────────────────

  recruit(req: CommandEnvelope & { heroId: string }): Promise<Result<RunSnapshot>> {
    return this.callOr('recruit', req, (b) => b.recruit(req));
  }
  refreshRecruit(req: CommandEnvelope): Promise<Result<RunSnapshot>> {
    return this.callOr('refreshRecruit', req, (b) => b.refreshRecruit(req));
  }
  upgradeHero(req: CommandEnvelope & { uid: string }): Promise<Result<RunSnapshot>> {
    return this.callOr('upgradeHero', req, (b) => b.upgradeHero(req));
  }

  // ── 装备 ──────────────────────────────────────────────────

  openDrop(req: CommandEnvelope & { chestId: string }): Promise<Result<RunSnapshot>> {
    return this.callOr('openDrop', req, (b) => b.openDrop(req));
  }
  openDrops(req: CommandEnvelope & { chestIds: string[] }): Promise<Result<RunSnapshot>> {
    return this.callOr('openDrops', req, (b) => b.openDrops(req));
  }

  reforgeItem(req: CommandEnvelope & { equipmentId: string }): Promise<Result<RunSnapshot>> {
    return this.callOr('reforgeItem', req, (b) => b.reforgeItem(req));
  }

  resolveRandomEvent(req: CommandEnvelope & { layer: number; optionIndex: number }): Promise<Result<RunSnapshot>> {
    return this.callOr('resolveRandomEvent', req, (b) => b.resolveRandomEvent(req));
  }
  equipItem(req: CommandEnvelope & { uid: string; equipmentId: string }): Promise<Result<RunSnapshot>> {
    return this.callOr('equipItem', req, (b) => b.equipItem(req));
  }

  equipAll(req: CommandEnvelope & { uid?: string }): Promise<Result<RunSnapshot>> {
    return this.callOr('equipAll', req, (b) => b.equipAll(req));
  }
  unequipItem(req: CommandEnvelope & { uid: string; equipmentId: string }): Promise<Result<RunSnapshot>> {
    return this.callOr('unequipItem', req, (b) => b.unequipItem(req));
  }
}
