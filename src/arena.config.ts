// ── 全局开关：本地算 还是 云端算 ────────────────────────────
//
// 这是整套架构里**唯一需要人做决策的地方**。
// 改它不需要动任何业务代码——UI、状态、渲染层一行都不用改。
//
// 运营策略：
//   销量好 → useLocalComputation: false。每次攻击都过 Supabase，防外挂保排行榜。
//   销量差 → useLocalComputation: true。流量费归零，纯单机也照样能玩。

export interface ArenaConfig {
  /**
   *   true  → 本地算（LocalBackend）：0ms、0 流量、断网可玩；内存可改，排行榜不可信
   *   false → 云端算（RemoteBackend → Supabase Edge Function）：
   *           权威结算、种子服务端持有、可信排行榜；每次战斗 1 次 Edge 调用
   *
   * 线上排障可用 URL 参数临时覆盖：?backend=local / ?backend=remote
   */
  useLocalComputation: boolean;

  /**
   * 云端算时，服务不可用（免费版闲置 7 天会自动暂停 → 503）怎么办。
   *   true  → 回落本地算，该局标 unverified（不进排行榜、不发成就），恢复后补交复核
   *   false → 直接报错（适合赛季期间宁可不玩也不能脏数据）
   */
  fallbackToLocalOnError: boolean;

  supabaseUrl?: string;
  supabaseAnonKey?: string;

  /** 单次请求超时。Edge 冷启动可能到 3s，别设太短 */
  requestTimeoutMs: number;
}

// vite 注入 import.meta.env；node 环境（脚本/测试）下为 undefined，兜底为空对象
const env = ((import.meta as unknown as { env?: Record<string, string> }).env ?? {}) as Record<string, string>;

export const ARENA_CONFIG: ArenaConfig = {
  // 默认 true —— 没配后端时游戏也必须能玩，而不是白屏
  useLocalComputation: env.VITE_USE_LOCAL !== 'false',

  fallbackToLocalOnError: env.VITE_FALLBACK_LOCAL !== 'false',

  supabaseUrl: env.VITE_SUPABASE_URL,
  supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY,

  requestTimeoutMs: Number(env.VITE_REQUEST_TIMEOUT ?? 15000),
};

/** 配置自检：云端模式却缺地址，是最常见的部署事故，早点响 */
export function validateConfig(cfg: ArenaConfig = ARENA_CONFIG): void {
  if (!cfg.useLocalComputation && (!cfg.supabaseUrl || !cfg.supabaseAnonKey)) {
    throw new Error(
      '[arena.config] useLocalComputation=false 但缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY。'
      + '要么补上环境变量，要么把开关改回 true。',
    );
  }
}
