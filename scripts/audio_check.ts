// 临时验证：仿真是否真实产出音频事件（trust-but-verify）
import { BattleSim } from '../packages/core/src/engine/battle';
import { makeAlly, makeEnemy } from '../packages/core/src/engine/unit';
import { genLayer } from '../packages/core/src/gen/levelGen';
import { HEROES } from '../packages/core/src/content/heroes';
import { enemyScale } from '../packages/core/src/engine/scaling';
import { Unit, HeroDef, EnemyDef, LayerPlan } from '../packages/core/src/types';

function buildSim(layer: number, team: HeroDef[], plan: LayerPlan, waves: EnemyDef[], seed: number) {
  const allies: Unit[] = team.map((h, i) => {
    const u = makeAlly(h, 1 + Math.floor((layer - 1) / 2), []);
    const p = plan.spawnAlly[i % plan.spawnAlly.length];
    u.x = p.x; u.y = p.y + (i - 1) * 1.1;
    return u;
  });
  const scale = enemyScale(layer);
  const eLevel = 1 + Math.floor(layer / 4);
  const enemies: Unit[] = waves.map((e, i) => {
    const u = makeEnemy(e, eLevel, scale.hp, scale.dmg);
    const p = plan.spawnEnemy[i % plan.spawnEnemy.length];
    u.x = p.x; u.y = p.y + (i - 1) * 1.1;
    return u;
  });
  return new BattleSim([...allies, ...enemies], plan.arena, seed);
}

const team = [HEROES[0], HEROES[3], HEROES[7]];
let total = 0;
const byId: Record<string, number> = {};
// 测 2 个普通层 + 1 个 Boss 层（残影之王在层 20，吞噬在层 10，践踏在层 5）
for (const layer of [3, 10, 20]) {
  const plan = genLayer(layer, 999 + layer);
  const sim = buildSim(layer, team, plan, plan.waves.flat(), 999 + layer);
  let ticks = 0;
  while (!sim.over && ticks < 20 * 120) {
    sim.tick(1 / 20);
    for (const c of sim.drainAudioCues()) {
      total++;
      byId[c.id] = (byId[c.id] ?? 0) + 1;
    }
    ticks++;
  }
}
console.log(`总事件数: ${total}`);
console.log('按事件分布:');
for (const [k, v] of Object.entries(byId).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(22)} ${v}`);
}
if (total === 0) { console.error('✗ 零事件——音频接线失败'); process.exit(1); }
if (!byId['hit_melee'] && !byId['hit_ranged'] && !byId['crit']) { console.error('✗ 无任何命中音'); process.exit(1); }
if (!byId['victory'] && !byId['defeat']) { console.error('✗ 无胜负音'); process.exit(1); }
console.log('✓ 仿真正常产出音频事件，接线 OK');
