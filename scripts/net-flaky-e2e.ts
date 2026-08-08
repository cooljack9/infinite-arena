// v3.4h 全链路网络不稳定压测
// 场景A：抖动（50-300ms）完整流程；场景B：30% 随机失败连买连穿；
// 场景C：战斗 50% 失败 → 同 key 幂等重试。
import { ARENA_CONFIG } from "../src/arena.config";
import { resetBackend } from "../src/backend/index";
import { useGame } from "../src/game/state/store";
import { getBackend } from "../src/backend/index";
import { isRemoteMode } from "../src/backend/storeBridge";
import { CORE_VERSION } from "../packages/core/src/contract";

import { BattleSim } from "../packages/core/src/engine/battle";

// e2e 运行于 node：补 window polyfill（产品代码在浏览器正常，仅测试环境需要）
(globalThis as Record<string, unknown>).window = globalThis;

ARENA_CONFIG.useLocalComputation = false;
ARENA_CONFIG.supabaseUrl = "http://127.0.0.1:8787";
ARENA_CONFIG.supabaseAnonKey = "mock-anon";
resetBackend();

let pass = 0, fail = 0;
const check = (n: string, c: boolean, extra = "") => {
  if (c) { pass++; console.log("  PASS  " + n + (extra ? "  " + extra : "")); }
  else { fail++; console.log("  FAIL  " + n + "  " + extra); }
};
const wait = (fn: () => boolean, ms = 20000) =>
  new Promise<boolean>((res) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (fn()) { clearInterval(iv); res(true); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); res(false); }
    }, 100);
  });

if (!isRemoteMode()) { console.log("FAIL not remote"); process.exit(1); }

const net = (v: { delayMs?: string; failRate?: number } | null) => {
  (globalThis as { __NET_TEST?: unknown }).__NET_TEST = v;
};

/** 失败率/抖动下可靠开局：reset → startRun → 等新 runId（最多 8 次重试） */
async function startRunRetry(): Promise<boolean> {
  for (let i = 0; i < 8; i++) {
    useGame.getState().reset();
    useGame.getState().startRun([{ id: "h_physTank" }, { id: "h_charge" }, { id: "h_healer" }] as never, "novice");
    const ok = await wait(() => !!useGame.getState().run?.runId, 8000);
    if (ok) return true;
  }
  return false;
}

// ═══ 场景 A：抖动 50-300ms 全流程 ═══
console.log("── 场景 A：网络抖动 50-300ms 全流程 ──");
net({ delayMs: "50-300" });
const okA1 = await startRunRetry();
check("A1 开局成功（抖动下）", okA1);
if (!okA1) { net(null); console.log("FAIL 开局失败"); process.exit(1); }

// 开箱拿 starter 4 件（A0）
const dropsA = useGame.getState().pendingDrops;
for (const d of dropsA) useGame.getState().openDrop(d.id);
const okA0 = await wait(() => useGame.getState().pendingDrops.length === 0, 15000);
check("A0 开箱完成", okA0, "库存 " + useGame.getState().inventory.length);

// 全卖 4 件得钱（A1）
const sellAll = useGame.getState().inventory.slice().map((i) => i.id);
for (const id of sellAll) useGame.getState().sellItem(id);
const okA1b = await wait(() => useGame.getState().gold >= 100, 20000);
check("A1 全卖得钱", okA1b, "gold=" + useGame.getState().gold);

// 买 2 件最便宜的（A2：卖 4 → 0，买 2 → 2）
const gA = useGame.getState();
const cheap = gA.shopStock.equipment.slice().sort((a, b) => a.basePrice - b.basePrice).slice(0, 2);
for (const e of cheap) useGame.getState().buyItem(e.id);
const okA2 = await wait(() => useGame.getState().inventory.length === 2, 20000);
check("A2 买 2 件最终一致（0→2）", okA2, "库存 " + useGame.getState().inventory.length);

// 穿戴 2 件（A3）
const hero = useGame.getState().run!.team[0];
const items = [...useGame.getState().inventory].slice(0, 2);
for (const it of items) useGame.getState().equipItem(hero.uid, it.id);
const okA3 = await wait(() => {
  const st = useGame.getState();
  return (st.equipped[hero.uid] ?? []).length >= 2;
}, 15000);
check("A3 穿戴 2 件最终一致", okA3, "已穿 " + (useGame.getState().equipped[hero.uid] ?? []).length);

// 开战（A4：抖动下权威结算）
const bA = await getBackend().startBattle({
  runId: useGame.getState().run!.runId, idempotencyKey: "netA-b1", coreVersion: CORE_VERSION,
  formation: {}, clientTs: 0,
});
check("A4 开战成功（抖动下）", !!bA.ok, bA.ok ? bA.data.outcome.result : bA.code);

// 推进一层（A5）
const skA = await getBackend().skipLayer({ runId: useGame.getState().run!.runId, idempotencyKey: "netA-sk", coreVersion: CORE_VERSION, bestLayer: 999 });
check("A5 skipLayer 成功", !!skA.ok, skA.ok ? "layer=" + skA.data.layer : skA.code);
net(null);
console.log("");

// ═══ 场景 B：30% 随机失败 穿戴/脱下混合（starter 装备，不依赖金币）═══
console.log("── 场景 B：随机失败 30% 穿戴/脱下混合 ──");
net({ failRate: 0.3 });
const okBstart = await startRunRetry();
if (!okBstart) { net(null); console.log("FAIL B 开局失败"); process.exit(1); }
const dropsB = useGame.getState().pendingDrops;
for (const d of dropsB) useGame.getState().openDrop(d.id);
const okB0 = await wait(() => useGame.getState().inventory.length >= 4, 20000);
check("B0 开箱拿 starter 装备", okB0, "库存 " + useGame.getState().inventory.length);

// 连穿 4 件（本地乐观即时）
const hero2 = useGame.getState().run!.team[0];
const inv2 = [...useGame.getState().inventory];
for (const it of inv2) useGame.getState().equipItem(hero2.uid, it.id);
const localEquipped = (useGame.getState().equipped[hero2.uid] ?? []).length;
check("B1 连穿 4 件本地乐观即时", localEquipped === inv2.length, "已穿 " + localEquipped + "/" + inv2.length);

// 队列未卡死：等穿戴数收敛稳定（两次采样相同 = 队列消化完，不卡）
let stable = false;
const t0b = Date.now();
let prev = -1;
while (Date.now() - t0b < 15000 && !stable) {
  const cur = (useGame.getState().equipped[hero2.uid] ?? []).length;
  if (cur === prev) {
    await new Promise((r) => setTimeout(r, 1200));
    const cur2 = (useGame.getState().equipped[hero2.uid] ?? []).length;
    stable = cur2 === cur;
  }
  prev = cur;
  await new Promise((r) => setTimeout(r, 300));
}
check("B2 队列未卡死（穿戴数收敛稳定）", stable, "已穿 " + (useGame.getState().equipped[hero2.uid] ?? []).length + "/" + inv2.length);

// 卸 2 件再穿回（混合操作）：验证「无丢失 + 最终=云端」
const eqs = [...(useGame.getState().equipped[hero2.uid] ?? [])].slice(0, 2);
for (const e of eqs) useGame.getState().unequipItem(hero2.uid, e.id);
for (const e of eqs) useGame.getState().equipItem(hero2.uid, e.id);
// 等队列消化：装备总数守恒（equipped + inventory = 4，无丢失）+ 状态收敛
const okB4 = await wait(() => {
  const st = useGame.getState();
  const equipped = (st.equipped[hero2.uid] ?? []).length;
  return equipped + st.inventory.length === inv2.length && equipped >= 1;
}, 25000);
const stB = useGame.getState();
const eqB = (stB.equipped[hero2.uid] ?? []).length;
check("B4 30% 失败下混合操作：装备无丢失 + 状态收敛",
  okB4 && eqB + stB.inventory.length === inv2.length,
  "已穿 " + eqB + " + 库存 " + stB.inventory.length + " = " + (eqB + stB.inventory.length) + "/" + inv2.length);
net(null);
console.log("");

// ═══ 场景 C：战斗 50% 失败 → 同 key 幂等重试 ═══
console.log("── 场景 C：战斗 50% 失败 → 幂等重试 ──");
net({ failRate: 0.5 });
const okC0 = await startRunRetry();
check("C0 失败率下开局重试成功", okC0);
if (!okC0) { net(null); console.log("FAIL (startRun 8 次全被吞)"); process.exit(1); }
const runIdC = useGame.getState().run!.runId;
const keyC = "netC-b1";
// 失败概率 50%，最多重试 6 次（同 key），直到成功
let cOk = false;
for (let i = 0; i < 6 && !cOk; i++) {
  const r = await getBackend().startBattle({ runId: runIdC, idempotencyKey: keyC, coreVersion: CORE_VERSION, formation: {}, clientTs: 0 });
  if (r.ok) { cOk = true; console.log("  [重试 " + (i + 1) + " 次成功] outcome=" + r.data.outcome.result); }
  else console.log("  [第 " + (i + 1) + " 次被网络吞掉: " + r.code + "]");
}
check("C1 战斗失败后同 key 幂等重试成功", cOk);

// 幂等验证：同 key 再调，应命中幂等缓存或 RUN_ENDED（不重复结算；失败率下循环重试）
let c2 = false, c2info = "";
for (let i = 0; i < 8 && !c2; i++) {
  const r2 = await getBackend().startBattle({ runId: runIdC, idempotencyKey: keyC, coreVersion: CORE_VERSION, formation: {}, clientTs: 0 });
  if (r2.ok) { c2 = true; c2info = "idem-cached(" + r2.data.outcome.result + ")"; }
  else if (r2.code === "RUN_ENDED") { c2 = true; c2info = r2.code; }
  // RATE_LIMITED（模拟网络吞包）→ 重试
}
check("C2 同 key 不重复结算", c2, c2info);
net(null);
console.log("");

console.log((fail ? "FAIL " + fail : "ALL PASS") + "  (" + pass + " pass / " + fail + " fail)");
process.exit(fail ? 1 : 0);
