// 卡住检测压力测试：复现「战斗中有时候会卡住一些角色」
// 检测两类异常：
//   ① NaN 数值（位置/hp/cd/moveSpeed/atkSpeed）—— 成长/装备数值膨胀溢出
//   ② 单位在「双方都有存活单位」前提下连续 3 秒(60 tick)无移动且无攻击 —— AI 卡死
import { BattleSim } from '../packages/core/src/engine/battle';
import { makeAlly, makeEnemy } from '../packages/core/src/engine/unit';
import { HEROES } from '../packages/core/src/content/heroes';
import { ENEMIES } from '../packages/core/src/content/enemies';
import { ARENAS, parseSpawns } from '../packages/core/src/content/arenas';
import { buildWaves } from '../packages/core/src/gen/encounter';
import { mulberry32 } from '../packages/core/src/engine/rng';
import { enemyScale } from '../packages/core/src/engine/scaling';

const TICK = 1 / 20;
const STUCK_TICKS = 160; // 8 秒无行动判定真卡死

function probe(layer: number, seed: number, arenaId: string) {
  const arena = ARENAS[arenaId as keyof typeof ARENAS];
  if (!arena) return null;
  const spawns = parseSpawns(arena);
  const rng = mulberry32(seed);
  const sc = enemyScale(layer);

  const allies = HEROES.slice(0, 7).map((h, k) => {
    const u = makeAlly(h, 5 + layer, []);
    const p = spawns.ally[k % spawns.ally.length];
    u.x = p.x; u.y = p.y;
    return u;
  });
  const waves = buildWaves(rng, layer, true);
  const enemies = waves[0].map((e, k) => {
    const u = makeEnemy(e, 5 + layer, sc.hp, sc.dmg);
    const p = spawns.enemy[k % spawns.enemy.length];
    u.x = p.x; u.y = p.y;
    return u;
  });

  const sim = new BattleSim([...allies, ...enemies], arena, seed);
  const lastAction = new Map<string, number>(); // id -> 最后行动 tick
  const lastX = new Map<string, number>();
  const lastY = new Map<string, number>();
  const prevDmg = new Map<string, number>();
  const prevHeal = new Map<string, number>();
  const stuck: string[] = [];
  const nanUnits: string[] = [];

  let steps = 0;
  const MAX = 20 * 180;
  while (!sim.over && steps < MAX) {
    sim.tick(TICK);
    steps++;
    // 检测 NaN
    for (const u of sim.units) {
      if (u.alive && (Number.isNaN(u.x) || Number.isNaN(u.y) || Number.isNaN(u.hp) ||
          Number.isNaN(u.cd) || Number.isNaN(u.derived?.moveSpeed) || Number.isNaN(u.derived?.atkSpeed))) {
        nanUnits.push(`${u.name}#${u.id} x=${u.x} y=${u.y} hp=${u.hp} cd=${u.cd} ms=${u.derived?.moveSpeed} as=${u.derived?.atkSpeed}`);
      }
    }
    // 双方都有存活非召唤非建筑单位？
    const alliesAlive = sim.alive('ally').filter((x) => !x.isSummon && !x.isBuilding).length;
    const enemiesAlive = sim.alive('enemy').filter((x) => !x.isSummon && !x.isBuilding).length;
    if (alliesAlive === 0 || enemiesAlive === 0) continue;
    // 检测卡住：存活单位连续 STUCK_TICKS 无移动且无「新伤害/新治疗」；
    // 被控制中（root/stun/freeze/kd 未过）不判卡住（定身/眩晕是正常控制效果）
    for (const u of sim.units) {
      if (!u.alive || u.isBuilding) continue;
      const ctrl = u.rootUntil > sim.time || u.stunUntil > sim.time ||
        (u.freezeUntil ?? 0) > sim.time || (u.kdUntil ?? 0) > sim.time;
      if (ctrl) { lastAction.set(u.id, steps); prevDmg.set(u.id, u.dmgDealt ?? 0); prevHeal.set(u.id, u.healDone ?? 0); lastX.set(u.id, u.x); lastY.set(u.id, u.y); continue; }
      const moved = u.x !== lastX.get(u.id) || u.y !== lastY.get(u.id);
      const dmgNow = u.dmgDealt ?? 0;
      const healNow = u.healDone ?? 0;
      const acted = dmgNow - (prevDmg.get(u.id) ?? 0) > 0 || healNow - (prevHeal.get(u.id) ?? 0) > 0;
      if (moved || acted) lastAction.set(u.id, steps);
      prevDmg.set(u.id, dmgNow);
      prevHeal.set(u.id, healNow);
      lastX.set(u.id, u.x);
      lastY.set(u.id, u.y);
      if (lastAction.get(u.id) !== undefined && steps - (lastAction.get(u.id) ?? steps) >= STUCK_TICKS) {
        stuck.push(`${u.name}#${u.id} side=${u.side} x=${u.x.toFixed(1)},${u.y.toFixed(1)} cd=${u.cd.toFixed(2)} tgt=${u.targetId ?? '-'} stun=${u.stunUntil - sim.time} root=${u.rootUntil - sim.time} freeze=${(u.freezeUntil ?? 0) - sim.time} kd=${(u.kdUntil ?? 0) - sim.time} atTick=${steps}`);
        lastAction.set(u.id, steps); // 只报一次
      }
    }
  }
  return { layer, seed, arenaId, result: sim.result, steps, stuck, nanUnits, unitCount: sim.units.length };
}

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${msg}`);
  if (!cond) fail++;
};

const seeds = [1, 8, 16, 42, 99, 256, 512, 888];
const arenas = ['A1', 'CAGE', 'DRAGON'];
const layers = [1, 5, 15, 30, 60];

console.log('\n[卡住/NaN 压测] 层数×种子×地图 全组合');
let totalStuck = 0;
let totalNaN = 0;
let combos = 0;
for (const arenaId of arenas) {
  for (const layer of layers) {
    for (const seed of seeds) {
      combos++;
      const r = probe(layer, seed, arenaId);
      if (!r) continue;
      if (r.stuck.length) {
        totalStuck += r.stuck.length;
        console.log(`  STUCK layer=${layer} seed=${seed} arena=${arenaId} result=${r.result} steps=${r.steps}`);
        for (const s of r.stuck.slice(0, 6)) console.log(`      - ${s}`);
      }
      if (r.nanUnits.length) {
        totalNaN += r.nanUnits.length;
        console.log(`  NAN  layer=${layer} seed=${seed} arena=${arenaId}`);
        for (const n of r.nanUnits.slice(0, 6)) console.log(`      - ${n}`);
      }
    }
  }
}
console.log(`共 ${combos} 组组合，卡住单位 ${totalStuck} 个，NaN 单位 ${totalNaN} 个`);
ok(totalStuck === 0, '无单位卡住（3 秒无行动）');
ok(totalNaN === 0, '无 NaN 数值');

console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
