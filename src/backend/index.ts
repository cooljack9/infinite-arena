// ── 双通路入口：前端唯一的后端获取点 ──
//
// 前端任何地方都只写 `getBackend()`，永远拿到 GameBackend 接口。
// 底下是本地库还是 Supabase HTTP，业务代码不关心、也无从得知——
// 切换只发生在这一个文件里。
//
//   本地通路：单机可玩、断网可玩、开发期零依赖、自动化测试直接调
//   服务器通路：权威结算、跨设备存档、排行榜、反作弊
import type { GameBackend } from '@arena/core/contract';
import { LocalBackend, MemoryStore, type LocalStore } from './LocalBackend';
import { RemoteBackend } from './RemoteBackend';
import { ARENA_CONFIG } from '../arena.config';

export type BackendMode = 'local' | 'remote';

export interface BackendConfig {
  mode: BackendMode;
  /** remote 模式必填（缺省取 ARENA_CONFIG.supabaseUrl） */
  baseUrl?: string;
  /** remote 模式的鉴权 token 取值函数（惰性求值：token 会过期刷新） */
  getToken?: () => string | null;
  /** local 模式的存储实现，缺省用内存（生产应传 IndexedDB 版） */
  store?: LocalStore;
  /** remote 模式缺省取 ARENA_CONFIG.fallbackToLocalOnError */
  fallbackToLocalOnError?: boolean;
}

let cached: GameBackend | null = null;
let cachedMode: BackendMode | null = null;

/**
 * 决定用哪条通路。优先级（从高到低）：
 *   1. 显式传入的 config.mode
 *   2. URL 参数 ?backend=local|remote  ← 便于线上一键对比排障
 *   3. ARENA_CONFIG.useLocalComputation 总开关
 *   4. 兜底 local
 *
 * 兜底选 local 而不是 remote 是刻意的：**没配好后端时游戏应该还能玩**，
 * 而不是白屏。单机可玩是基本盘，联机是增强。
 */
function resolveMode(explicit?: BackendMode): BackendMode {
  if (explicit) return explicit;
  if (typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search).get('backend');
    if (q === 'local' || q === 'remote') return q;
  }
  return ARENA_CONFIG.useLocalComputation ? 'local' : 'remote';
}

export function configureBackend(cfg: Partial<BackendConfig> = {}): GameBackend {
  const mode = resolveMode(cfg.mode);
  if (cached && cachedMode === mode) return cached;

  if (mode === 'remote') {
    const baseUrl = cfg.baseUrl ?? ARENA_CONFIG.supabaseUrl;
    const anonKey = ARENA_CONFIG.supabaseAnonKey;
    if (!baseUrl || !anonKey) {
      throw new Error(
        '[backend] remote 模式缺少 baseUrl/anonKey。'
        + '检查 arena.config.ts：VITE_USE_LOCAL=false 时必须配 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY。'
        + '（本地联调可配 VITE_SUPABASE_URL=http://127.0.0.1:8787）',
      );
    }
    // v3.4h 移除离线降级（会制造双局分叉）：RemoteBackend 不再接 fallback
    cached = new RemoteBackend({
      baseUrl, anonKey,
      getToken: cfg.getToken,
      timeoutMs: ARENA_CONFIG.requestTimeoutMs,
    });
    cachedMode = mode;
    return cached;
  }

  cached = new LocalBackend(cfg.store ?? new MemoryStore());
  cachedMode = mode;
  return cached;
}

/** 前端全局取后端。首次调用会按环境自动决定通路。 */
export function getBackend(): GameBackend {
  return cached ?? configureBackend();
}

/** 测试用：强制重置，下次 getBackend 重新决策 */
export function resetBackend(): void {
  cached = null;
  cachedMode = null;
}

export { LocalBackend, MemoryStore } from './LocalBackend';
export { RemoteBackend } from './RemoteBackend';
export type { LocalStore } from './LocalBackend';
export * from '@arena/core/contract';
