// ── Deno 侧宿主端口（@arena/core 的 HostPorts 实现）──
// Edge Function 环境：熵源必须用 crypto（密码学安全），不能用 Math.random。
// 注：HostPorts 接口在 core 侧尚未实现（M2 待办），此处按契约自声明，两侧结构一致。

export interface HostPorts {
  clock: { now(): number };
  entropy: { seed(): number };
  id: { runId(): string; battleId(): string };
}

export function denoPorts(): HostPorts {
  return {
    clock:   { now: () => Date.now() },
    // ★ 密码学熵源：种子不可预测是反作弊的地基。
    //   Math.random 可预测 → 玩家枚举种子挑必出神装的开局，排行榜当场作废
    entropy: { seed: () => crypto.getRandomValues(new Uint32Array(1))[0] | 0 },
    id: {
      runId:    () => `run_${crypto.randomUUID().slice(0, 8)}`,
      battleId: () => `b_${crypto.randomUUID().slice(0, 8)}`,
    },
  };
}
