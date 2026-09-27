// P0-2 量化分析：比对「敌方技能正确攻击玩家」（faction-fixed）与「敌方自伤」（baseline）
// 两套战斗引擎下，治疗职业探针（heroes[0,1,8] @ layers 2-7）承受的伤害与胜负。
// 用法：node scripts/run-ts.mjs scripts/p02_analysis.ts
// 不修改引擎，纯观测。输出 JSON 摘要 + 每怪物签名技的 dmgDealt 分布。
import { BattleSim } from '../packages/core/src/engine/battle';
import { makeAlly, makeEnemy } from '../packages/core/src/engine/unit';
import { HEROES } from '../packages/core/src/content/heroes';
import { ENEMIES } from '../packages/core/src/content/enemies';
import { ARENAS, parseSpawns } from '../packages/core/src/content/arenas';
import { buildWaves } from '../packages/core/src/gen/encounter';
import { mulberry32 } from '../packages/core/src/engine/rng';
import { enemyScale } from '../packages/core/src/engine/scaling';
import { HeroDef } from '../packages/core/src/types';

const TICK = 1 / 20;
const SEEDS = Array.from({ length: 20 }, (_, s) => 800 + s);

function runProbe(heroIdx: number[], seed: number, layer: number) {
  const arena = ARENAS.A1;
  const spawns = parseSpawns(arena);
  const rng = mulberry32(seed);
  const sc = enemyScale(layer);
  const allies = heroIdx.map((i) => {
    const u = makeAlly(HEROES[i] as HeroDef, 5 + layer, []);
    const p = spawns.ally[i % spawns.ally.length];
    u.x = p.x; u.y = p.y;
    return u;
  });
  const waves = buildWaves(rng, layer, false);
  const enemies = waves[0].map((e, k) => {
    const u = makeEnemy(e, 5 + layer, sc.hp, sc.dmg);
    const p = spawns.enemy[k % spawns.enemy.length];
    u.x = p.x; u.y = p.y;
    return u;
  });
  const sim = new BattleSim([...allies, ...enemies], arena, seed);

  const prevHp = new Map<string, number>();
  let allyDmgTaken = 0;
  let steps = 0;
  while (!sim.over && steps < 20 * 120) {
    for (const a of sim.units) if (a.side === 'ally' && !a.isSummon) prevHp.set(a.id, a.hp);
    sim.tick(TICK);
    steps++;
    for (const a of sim.units) {
      if (a.side !== 'ally' || a.isSummon) continue;
      const prev = prevHp.get(a.id);
      if (prev !== undefined) allyDmgTaken += Math.max(0, prev - a.hp);
    }
  }

  const allyHeal = sim.units.filter((u) => u.side === 'ally').reduce((s, u) => s + (u.healDone ?? 0), 0);
  const healer = sim.units.find((u) => u.side === 'ally' && u.subclass === 'healer' && !u.isSummon);
  // 每怪物签名技 dmgDealt 分布（faction-fixed 下即「打给玩家的伤害」）
  const bySkill = new Map<string, number>();
  for (const u of sim.units) {
    if (u.side !== 'enemy') continue;
    bySkill.set(u.skill.id, (bySkill.get(u.skill.id) ?? 0) + (u.dmgDealt ?? 0));
  }
  return {
    result: sim.result,
    steps,
    allyDmgTaken,
    allyHeal,
    healerAlive: healer ? healer.alive : false,
    bySkill: Object.fromEntries([...bySkill.entries()].sort((a, b) => b[1] - a[1])),
  };
}

let wins = 0;
let healerAliveGames = 0;
let totalDmg = 0;
let totalHeal = 0;
let totalSteps = 0;
const skillAgg = new Map<string, number>();
const detail: any[] = [];

for (const s of SEEDS) {
  const layer = 2 + (s % 6);
  const r = runProbe([0, 1, 8], s, layer);
  if (r.result === 'win') wins++;
  if (r.healerAlive) healerAliveGames++;
  totalDmg += r.allyDmgTaken;
  totalHeal += r.allyHeal;
  totalSteps += r.steps;
  for (const [k, v] of Object.entries(r.bySkill)) skillAgg.set(k, (skillAgg.get(k) ?? 0) + v);
  detail.push({ seed: s, layer, ...r, bySkill: undefined });
}

console.log(JSON.stringify({
  games: SEEDS.length,
  winRate: +(wins / SEEDS.length).toFixed(3),
  healerAliveRate: +(healerAliveGames / SEEDS.length).toFixed(3),
  avgAllyDmgTaken: Math.round(totalDmg / SEEDS.length),
  avgAllyHeal: Math.round(totalHeal / SEEDS.length),
  avgSteps: Math.round(totalSteps / SEEDS.length),
  avgDurationSec: +(totalSteps / SEEDS.length / 20).toFixed(1),
  enemySkillDmgByType: Object.fromEntries([...skillAgg.entries()].sort((a, b) => b[1] - a[1])),
}, null, 2));
