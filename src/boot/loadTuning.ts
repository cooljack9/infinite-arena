// ── 前端宿主：加载外部调参（Pure Core 净化后 fetch 归位到宿主）──
// 部署后放置 public/data/tuning.json 即可覆盖内置数值，无需改源码。
// 404 / 非 JSON 时静默回退内置默认值，不影响游戏运行。
import { applyTuning, type Tuning } from '@arena/core/content/tuning';

export async function loadTuning(): Promise<void> {
  try {
    const url = `${import.meta.env.BASE_URL}data/tuning.json`;
    const res = await fetch(url);
    if (!res.ok) return;
    const json = (await res.json()) as Tuning;
    if (json && typeof json === 'object') applyTuning(json);
  } catch {
    // 无外部配置 → 使用内置默认值（MOD 可选）
  }
}
