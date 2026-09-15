// 诊断第 5 层 stats ally 数量
const URL = "http://127.0.0.1:8787/functions/v1/game";
const call = (a, p) => fetch(URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: a, payload: p }) }).then((r) => r.json());
const r = await call("startRun", { heroIds: ["h_physTank", "h_charge", "h_healer"], mode: "normal", idempotencyKey: "diag-5-" + Math.random().toString(36).slice(2, 8), coreVersion: "2.0.0" });
const runId = r.data.runId;
for (let l = 1; l < 5; l++) {
  const sk = await call("advanceLayerTo", { runId, idempotencyKey: "sk-" + l + "-" + Math.random().toString(36).slice(2, 8), coreVersion: "2.0.0", layer: l + 1 });
  if (!sk.ok) { console.log("adv", l, "FAIL", sk.code); break; }
}
const b = await call("startBattle", { runId, idempotencyKey: "b-5", coreVersion: "2.0.0", formation: {}, clientTs: 0 });
if (!b.ok) { console.log("battle FAIL", b.code); process.exit(1); }
const stats = b.data.outcome.stats;
console.log("stats 总数:", stats.length);
console.log("ally:", stats.filter((s) => s.side === "ally").map((s) => s.name + "[" + s.heroUid + "]"));
console.log("enemy:", stats.filter((s) => s.side === "enemy").map((s) => s.name));
console.log("replay allies:", b.data.replay.allies.map((a) => a.name + "[" + a.heroUid + "]"));